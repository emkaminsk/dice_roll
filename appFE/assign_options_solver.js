// Assign Options solver — pure and DOM-free. Hands out labels to people, round by
// round: every present person gets exactly `perPerson` different labels per round,
// no label exceeds its slots, "once per person" labels never reach the same person
// twice in the whole draw. All randomness comes from the injected randomIndex
// (crypto RNG); the complete result is computed before the UI reveals anything.
// createSolver is self-contained so it can be stringified into an inline Worker.
(function () {
  function createSolver(randomIndex) {
    const MAX_ROUNDS = 20;
    const FAST_TRIES = 200;
    const FAST_MS = 60;
    const TIME_MS = 1500;
    const POLISH_MS = 300;

    function now() { return Date.now(); }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    function range(n) { const out = []; for (let i = 0; i < n; i++) out.push(i); return out; }
    function intIn(v, lo, hi, dflt) {
      const n = parseInt(v, 10);
      if (!isFinite(n)) return dflt;
      return Math.max(lo, Math.min(hi, n));
    }

    // Normalise a setup into index-based arrays. Away and unnamed people are out.
    function model(setup) {
      const s = (setup && setup.settings) || {};
      const people = ((setup && setup.people) || []).filter((p) => p && String(p.name || '').trim() !== '' && !p.absent);
      const labels = ((setup && setup.labels) || []).filter((l) => l && String(l.name || '').trim() !== '');
      const P = people.length;
      const L = labels.length;
      const m = {
        people, labels, P, L,
        R: intIn(s.rounds, 1, MAX_ROUNDS, 1),
        A: intIn(s.perPerson, 1, 1000, 1),
        variety: s.variety !== false,
        exact: s.allowUnfilled === false,
        slots: [], inf: [], once: [], cap: [],
      };
      labels.forEach((l, i) => {
        const inf = l.slots === null || l.slots === undefined || l.slots === '' || l.slots === Infinity;
        const n = inf ? P : Math.max(1, parseInt(l.slots, 10) || 1);
        m.inf[i] = inf;
        m.slots[i] = n;
        m.cap[i] = Math.min(n, P); // nobody gets a label twice in one round
        m.once[i] = l.once === true;
      });
      m.nOnce = m.once.filter(Boolean).length;
      m.nRep = L - m.nOnce;
      m.finiteSum = m.slots.reduce((acc, n, i) => acc + (m.inf[i] ? 0 : n), 0);
      m.hasInf = m.inf.some(Boolean);
      return m;
    }

    // Cheap necessary conditions, run on every edit. The solver is the truth.
    function hintsFor(m) {
      const out = [];
      const err = (code, message) => out.push({ level: 'error', code, message });
      if (!m.P || !m.L) return out;
      const { P, L, A, R } = m;
      const demand = P * A;
      const who = `${plural(P, 'person', 'people')} × ${A} = ${plural(demand, 'pick')} per round`;
      if (A > L) {
        err('distinct', `Each person needs ${plural(A, 'different label')} per round, but there ${L === 1 ? 'is' : 'are'} only ${plural(L, 'label')}.`);
      }
      if (!m.hasInf && m.finiteSum < demand) {
        err('supply', `${who}, but the labels offer only ${plural(m.finiteSum, 'slot')}.`);
      }
      if (m.exact) {
        if (!m.hasInf && m.finiteSum > demand) {
          err('exact', `“Allow unfilled slots” is off, so every slot must be used: the labels offer ${plural(m.finiteSum, 'slot')} per round but ${who}.`);
        } else if (m.hasInf && m.finiteSum > demand) {
          err('exact', `“Allow unfilled slots” is off: the labels with a fixed number of slots already need ${plural(m.finiteSum, 'pick')} per round, but ${who}.`);
        }
        m.labels.forEach((l, i) => {
          if (m.inf[i]) return;
          if (m.slots[i] > P) {
            err('exact-slots', `“${l.name}” has ${plural(m.slots[i], 'slot')}, but only ${plural(P, 'person', 'people')} can take it per round (“Allow unfilled slots” is off).`);
          } else if (m.once[i] && m.slots[i] * R > P) {
            err('exact-once', `“${l.name}” must go to ${m.slots[i]} ${m.slots[i] === 1 ? 'person' : 'people'} in each of ${plural(R, 'round')} — ${m.slots[i] * R} different people (once per person) — but there ${P === 1 ? 'is' : 'are'} only ${P}.`);
          }
        });
      }
      if (m.nOnce && A <= L) {
        const avail = m.nOnce + m.nRep * R;
        if (avail < A * R) {
          err('per-person', `Each person needs ${plural(A * R, 'pick')} over ${plural(R, 'round')}, but only ${avail} are possible for them (${m.nOnce} once-per-person + ${m.nRep} repeatable × ${R}).`);
        }
        let total = 0;
        for (let i = 0; i < L; i++) total += m.once[i] ? Math.min(m.cap[i] * R, P) : m.cap[i] * R;
        const need = demand * R;
        if (total < need && !out.some((h) => h.code === 'supply')) {
          err('once', `Over ${plural(R, 'round')} everyone together needs ${plural(need, 'pick')}, but the labels can give at most ${total} — “once per person” labels reach each person only once (short by ${need - total}).`);
        }
      }
      return out;
    }

    function validateHints(setup) { return hintsFor(model(setup)); }

    // ---- One round: b-matching (people need A, labels offer cap, edges 0/1) -----

    // count[p*L+l] = how often p holds l over all *other* finished rounds.
    function allowed(m, count, p, l) { return !(m.once[l] && count[p * m.L + l] > 0); }

    function fastRound(m, count, deadline) {
      const { P, L, A } = m;
      const tokens0 = [];
      for (let l = 0; l < L; l++) for (let k = 0; k < m.cap[l]; k++) tokens0.push(l);
      const hold = new Uint8Array(P * L);
      const load = new Int32Array(L);
      const stop = Math.min(deadline, now() + FAST_MS);
      for (let t = 0; t < FAST_TRIES; t++) {
        if (t && now() > stop) break;
        const tokens = shuffle(tokens0.slice());
        const taken = new Uint8Array(tokens.length);
        const order = shuffle(range(P));
        hold.fill(0); load.fill(0);
        let ok = true;
        for (let pass = 0; pass < A && ok; pass++) {
          for (let oi = 0; oi < P; oi++) {
            const p = order[oi];
            let pickAt = -1;
            for (let sweep = m.variety ? 0 : 1; sweep < 2 && pickAt < 0; sweep++) {
              for (let i = 0; i < tokens.length; i++) {
                if (taken[i]) continue;
                const l = tokens[i];
                if (hold[p * L + l] || !allowed(m, count, p, l)) continue;
                if (sweep === 0 && count[p * L + l] > 0) continue; // variety: new labels first
                pickAt = i;
                break;
              }
            }
            if (pickAt < 0) { ok = false; break; }
            taken[pickAt] = 1;
            hold[p * L + tokens[pickAt]] = 1;
            load[tokens[pickAt]] += 1;
          }
        }
        if (ok && m.exact) {
          for (let l = 0; l < L; l++) if (!m.inf[l] && load[l] !== m.cap[l]) { ok = false; break; }
        }
        if (ok) return { hold: hold.slice(), load: load.slice(), fast: true };
      }
      return null;
    }

    // Randomised augmenting paths (max flow). Exact fit: first saturate every
    // fixed-slot label, then top up with unlimited ones — flow on a label never
    // drops while augmenting, so the first phase's saturation survives.
    function flowRound(m, count, deadline) {
      const { P, L, A } = m;
      const hold = new Uint8Array(P * L);
      const load = new Int32Array(L);
      const got = new Int32Array(P);
      const seenL = new Uint8Array(L);
      const seenP = new Uint8Array(P);
      let phaseOk = () => true;
      let timedOut = false;
      let steps = 0;

      function labelOrder(u) {
        const ls = shuffle(range(L));
        if (m.variety) {
          // Stable sort keeps the random order among labels with the same history.
          return ls.map((l, i) => ({ l, i, c: count[u * L + l] })).sort((a, b) => a.c - b.c || a.i - b.i).map((x) => x.l);
        }
        return ls;
      }
      function dfs(u) {
        if ((++steps & 255) === 0 && now() > deadline) { timedOut = true; return false; }
        if (timedOut) return false;
        seenP[u] = 1;
        const ls = labelOrder(u);
        for (let k = 0; k < L; k++) {
          const l = ls[k];
          if (!phaseOk(l) || hold[u * L + l] || !allowed(m, count, u, l) || seenL[l]) continue;
          if (load[l] < m.cap[l]) { hold[u * L + l] = 1; load[l] += 1; return true; }
        }
        for (let k = 0; k < L; k++) {
          const l = ls[k];
          if (!phaseOk(l) || hold[u * L + l] || !allowed(m, count, u, l) || seenL[l]) continue;
          seenL[l] = 1;
          const start = randomIndex(P);
          for (let j = 0; j < P; j++) {
            const v = (start + j) % P;
            if (seenP[v] || !hold[v * L + l]) continue;
            if (dfs(v)) { hold[v * L + l] = 0; hold[u * L + l] = 1; return true; }
            if (timedOut) return false;
          }
        }
        return false;
      }
      function fill() {
        let progress = true;
        while (progress) {
          progress = false;
          const order = shuffle(range(P));
          for (let i = 0; i < P; i++) {
            const u = order[i];
            if (got[u] >= A) continue;
            seenL.fill(0); seenP.fill(0);
            if (dfs(u)) { got[u] += 1; progress = true; }
            if (timedOut) return;
          }
        }
      }
      if (m.exact) {
        phaseOk = (l) => !m.inf[l];
        fill();
        if (timedOut) return { timedOut: true };
        for (let l = 0; l < L; l++) if (!m.inf[l] && load[l] !== m.cap[l]) return null;
        phaseOk = () => true;
      }
      fill();
      if (timedOut) return { timedOut: true };
      for (let p = 0; p < P; p++) if (got[p] !== A) return null;
      return { hold, load, fast: false };
    }

    // Can the remaining rounds still be filled, given once-labels already used?
    function lookAhead(m, count, remaining) {
      if (!remaining || !m.nOnce) return true;
      const { P, L, A } = m;
      const perRoundOnce = Math.max(0, A - m.nRep);
      const usedBy = new Int32Array(L);
      for (let p = 0; p < P; p++) {
        let free = 0;
        for (let l = 0; l < L; l++) {
          if (!m.once[l]) continue;
          if (count[p * L + l] > 0) usedBy[l] += 1; else free += 1;
        }
        if (free < perRoundOnce * remaining) return false;
      }
      let total = 0;
      for (let l = 0; l < L; l++) {
        const left = P - usedBy[l];
        if (m.once[l]) {
          total += Math.min(m.cap[l] * remaining, left);
          if (m.exact && !m.inf[l] && left < m.cap[l] * remaining) return false;
        } else total += m.cap[l] * remaining;
      }
      return total >= P * A * remaining;
    }

    function repeatsOf(count) {
      let r = 0;
      for (let i = 0; i < count.length; i++) if (count[i] > 1) r += count[i] - 1;
      return r;
    }

    // Prefer variety: random swaps inside a round that keep it valid and never
    // increase the number of repeats (a person getting a label again).
    function polish(m, rounds, count, free) {
      const { P, L } = m;
      const deadline = now() + POLISH_MS;
      let repeats = repeatsOf(count);
      let stale = 0;
      let it = 0;
      const pen = (c) => (c > 1 ? c - 1 : 0);
      while (repeats > 0 && stale < 20000) {
        if ((++it & 63) === 0 && now() > deadline) break;
        const r = free[randomIndex(free.length)];
        const rd = rounds[r];
        const a = randomIndex(P);
        const mine = [];
        for (let l = 0; l < L; l++) if (rd.hold[a * L + l]) mine.push(l);
        const x = mine[randomIndex(mine.length)];
        let delta = 0;
        if (randomIndex(3) === 0) {
          // Trade x for a label with a spare slot this round.
          const z = randomIndex(L);
          if (z === x || rd.hold[a * L + z] || rd.load[z] >= m.cap[z]) { stale++; continue; }
          if (m.exact && !m.inf[x]) { stale++; continue; }
          if (m.once[z] && count[a * L + z] > 0) { stale++; continue; }
          const cx = count[a * L + x];
          const cz = count[a * L + z];
          delta = pen(cx - 1) - pen(cx) + pen(cz + 1) - pen(cz);
          if (delta > 0) { stale++; continue; }
          rd.hold[a * L + x] = 0; rd.hold[a * L + z] = 1;
          rd.load[x] -= 1; rd.load[z] += 1;
          count[a * L + x] -= 1; count[a * L + z] += 1;
        } else {
          const b = randomIndex(P);
          if (b === a) { stale++; continue; }
          const theirs = [];
          for (let l = 0; l < L; l++) if (rd.hold[b * L + l] && !rd.hold[a * L + l]) theirs.push(l);
          if (!theirs.length || rd.hold[b * L + x]) { stale++; continue; }
          const y = theirs[randomIndex(theirs.length)];
          if (m.once[y] && count[a * L + y] > 0) { stale++; continue; }
          if (m.once[x] && count[b * L + x] > 0) { stale++; continue; }
          const ax = count[a * L + x], ay = count[a * L + y], bx = count[b * L + x], by = count[b * L + y];
          delta = pen(ax - 1) - pen(ax) + pen(ay + 1) - pen(ay) + pen(by - 1) - pen(by) + pen(bx + 1) - pen(bx);
          if (delta > 0) { stale++; continue; }
          rd.hold[a * L + x] = 0; rd.hold[a * L + y] = 1;
          rd.hold[b * L + y] = 0; rd.hold[b * L + x] = 1;
          count[a * L + x] -= 1; count[a * L + y] += 1;
          count[b * L + y] -= 1; count[b * L + x] += 1;
        }
        repeats += delta;
        stale = delta < 0 ? 0 : stale + 1;
      }
      return repeats;
    }

    // Kept rounds: { [roundIndex]: { [personId]: [labelId, …] } } → fixed holds.
    function keptRounds(m, keep) {
      const out = {};
      if (!keep || typeof keep !== 'object') return out;
      const pIdx = {};
      const lIdx = {};
      m.people.forEach((p, i) => { pIdx[p.id] = i; });
      m.labels.forEach((l, i) => { lIdx[l.id] = i; });
      Object.keys(keep).forEach((key) => {
        const r = parseInt(key, 10);
        if (!(r >= 0 && r < m.R)) return;
        const hold = new Uint8Array(m.P * m.L);
        const load = new Int32Array(m.L);
        const src = keep[key] || {};
        Object.keys(src).forEach((pid) => {
          if (!(pid in pIdx)) return;
          (src[pid] || []).forEach((lid) => {
            if (!(lid in lIdx)) return;
            const i = pIdx[pid] * m.L + lIdx[lid];
            if (!hold[i]) { hold[i] = 1; load[lIdx[lid]] += 1; }
          });
        });
        out[r] = { hold, load, kept: true };
      });
      return out;
    }

    function addCount(m, count, rd, sign) {
      for (let i = 0; i < rd.hold.length; i++) if (rd.hold[i]) count[i] += sign;
    }

    function toResult(m, rounds) {
      return rounds.map((rd) => {
        const assignments = {};
        m.people.forEach((p, pi) => {
          const ids = [];
          for (let l = 0; l < m.L; l++) if (rd.hold[pi * m.L + l]) ids.push(m.labels[l].id);
          assignments[p.id] = ids;
        });
        const free = {};
        m.labels.forEach((l, li) => {
          if (!m.inf[li] && m.slots[li] > rd.load[li]) free[l.id] = m.slots[li] - rd.load[li];
        });
        return { assignments, free };
      });
    }

    // Draw every round. opts.keep fixes rounds; opts.timeMs overrides the budget.
    function run(setup, opts) {
      const o = opts || {};
      const m = model(setup);
      if (!m.P) return { status: 'empty', message: 'Add at least one person who is here (step 1) to hand out labels.' };
      if (!m.L) return { status: 'empty', message: 'Add at least one label (step 2) to hand out.' };
      const problems = hintsFor(m);
      if (problems.length) return { status: 'infeasible', reasons: problems.map((h) => h.message) };
      const started = now();
      const deadline = started + (o.timeMs || TIME_MS);
      const fixed = keptRounds(m, o.keep);
      const freeRounds = range(m.R).filter((r) => !fixed[r]);
      let attempts = 0;
      let allFast = true;
      while (true) {
        attempts += 1;
        const count = new Int32Array(m.P * m.L);
        const rounds = [];
        Object.keys(fixed).forEach((r) => { rounds[r] = fixed[r]; addCount(m, count, fixed[r], 1); });
        let failed = false;
        let timedOut = false;
        for (let k = 0; k < freeRounds.length; k++) {
          const r = freeRounds[k];
          let rd = fastRound(m, count, deadline);
          if (rd) {
            addCount(m, count, rd, 1);
            if (!lookAhead(m, count, freeRounds.length - k - 1)) { addCount(m, count, rd, -1); rd = null; }
          }
          if (!rd) {
            allFast = false;
            rd = flowRound(m, count, deadline);
            if (rd && rd.timedOut) { timedOut = true; break; }
            if (rd) {
              addCount(m, count, rd, 1);
              if (!lookAhead(m, count, freeRounds.length - k - 1)) { failed = true; break; }
            }
          }
          if (!rd) { failed = true; break; }
          rounds[r] = rd;
        }
        if (!failed && !timedOut) {
          let method = allFast && attempts === 1 ? 'deal' : 'search';
          let repeats = repeatsOf(count);
          if (m.variety && repeats > 0 && freeRounds.length && m.R > 1) {
            repeats = polish(m, rounds, count, freeRounds);
            method += '+polish';
          }
          return { status: 'ok', rounds: toResult(m, rounds), repeats, method, attempts, ms: now() - started };
        }
        // Without once-per-person labels every round stands alone, so a round the
        // flow can't fill proves the setup impossible.
        if (failed && !m.nOnce) {
          return { status: 'infeasible', reasons: ['No valid assignment exists for these labels and slots.'] };
        }
        if (timedOut || now() > deadline) {
          return { status: 'timeout', reasons: [] };
        }
      }
    }

    return { validateHints, run, MAX_ROUNDS };
  }

  const api = createSolver(randomIndex);
  api.createSolver = createSolver;
  window.AssignOptionsSolver = api;
})();
