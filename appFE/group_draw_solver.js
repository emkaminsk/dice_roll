// Group Draw solver — pure and DOM-free (see .ai/spec-group-draw.md §5).
// The complete assignment is computed here first; the UI only reveals it.
// All randomness comes from the injected fair randomIndex() (random.js), so the
// same factory source can also run inside an inline Web Worker.
(function (root) {
  function createSolver(randomIndex) {
    const NODE_LIMIT = 50000;
    const TIME_MS = 1500;
    const FAST_TRIES = 200;
    const FAST_MS = 250;
    const BLAME_RULES = 30;
    const BLAME_MS = 200;
    const FULL_MS = 300; // budget for "every rule, nice-to-have included" before falling back
    const POLISH_MS = 400;
    const MAX_ROUNDS = 10;
    const EPS = 1e-9;
    // Rule types that can be marked nice-to-have (rule.soft). Size and the
    // structural keep-together rules are always "must".
    const SOFTABLE = { count: true, sum: true, apart: true, even: true, pin: true, pair: true };

    function now() {
      return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    // In-place Fisher–Yates with the fair RNG.
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    function range(n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(i);
      return out;
    }

    function isEmpty(v) { return v === null || v === undefined || v === ''; }
    function keyOf(v) { return isEmpty(v) ? null : String(v); }
    function bound(v) {
      if (isEmpty(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function over(x, lo, hi) {
      if (x < lo) return lo - x;
      if (x > hi) return x - hi;
      return 0;
    }

    function attrMap(setup) {
      const map = {};
      (setup.attributes || []).forEach((a) => { map[a.id] = a; });
      return map;
    }

    function groupCount(setup) {
      const n = parseInt(setup.groups && setup.groups.count, 10);
      return Number.isFinite(n) && n >= 1 ? n : 2;
    }

    function groupName(setup, g) {
      const names = (setup.groups && setup.groups.names) || [];
      const name = names[g] && String(names[g]).trim();
      const word = String((setup.groups && setup.groups.label) || '').trim() || 'Group';
      return name || `${word} ${g + 1}`;
    }

    function isAllScope(scope) {
      return scope === 'all' || scope === undefined || scope === null;
    }

    // A scope is 'all', one group index, or an array of group indexes.
    function scopeList(scope) {
      return Array.isArray(scope) ? scope : [scope];
    }

    function scopeHas(scope, g) {
      return scopeList(scope).indexOf(g) !== -1;
    }

    // A count rule matches people having ALL of its conditions: the main
    // attrId/value plus optional extra ones in rule.and. Duplicates collapse.
    function conditionsOf(rule) {
      const out = [];
      const seen = {};
      [{ attrId: rule.attrId, value: rule.value }].concat(Array.isArray(rule.and) ? rule.and : []).forEach((c) => {
        const key = `${c && c.attrId}|${c ? keyOf(c.value) : null}`;
        if (!seen[key]) { seen[key] = true; out.push({ attrId: c && c.attrId, value: c ? keyOf(c.value) : null }); }
      });
      return out;
    }

    function condText(conds, attrs) {
      return conds.map((c) => `${attrs[c.attrId] ? attrs[c.attrId].name : '?'} = ${c.value}`).join(' and ');
    }

    // Nice-to-have rules are optimised after the must rules are met. Balancing
    // a total ("spread evenly" by sum) is an objective, so it is always soft.
    function isSoft(rule) {
      if (!rule) return false;
      if (rule.type === 'even' && rule.by === 'sum') return true;
      if (rule.type === 'pair' && rule.mode !== 'apart') return false;
      return !!rule.soft && !!SOFTABLE[rule.type];
    }

    // People taking part in the draw: named and not marked absent.
    function activePeople(setup) {
      return (setup.people || []).filter((p) => p && !p.absent && String(p.name || '').trim() !== '');
    }

    function pairPeople(rule, byId) {
      const seen = {};
      return (Array.isArray(rule.people) ? rule.people : []).filter((id) => {
        if (!byId[id] || seen[id]) return false;
        seen[id] = true;
        return true;
      });
    }

    function personName(setup, id) {
      const p = (setup.people || []).find((x) => x && x.id === id);
      return p ? String(p.name || '').trim() || '?' : '?';
    }

    // A rule the solver can act on: known type, valid attribute of the right
    // kind (labels match exact text), scope inside the groups, and — for
    // person rules — people who take part in this draw.
    function usable(rule, attrs, G, byId) {
      if (!rule) return false;
      if (!isAllScope(rule.scope)) {
        const list = scopeList(rule.scope);
        if (!list.length || !list.every((g) => Number.isInteger(g) && g >= 0 && g < G)) return false;
      }
      if (rule.type === 'size') return true;
      if (rule.type === 'pin') return !!byId[rule.personId] && Number.isInteger(rule.group) && rule.group >= 0 && rule.group < G;
      if (rule.type === 'pair') return (rule.mode === 'apart' || rule.mode === 'together') && pairPeople(rule, byId).length >= 2;
      const a = attrs[rule.attrId];
      if (!a) return false;
      if (rule.type === 'even') return rule.by === 'sum' ? a.kind === 'integer' : true;
      if (rule.type === 'count') {
        const conds = conditionsOf(rule);
        const byAttr = {};
        return conds.every((c) => {
          if (!attrs[c.attrId] || c.value === null) return false;
          // Two different values of one attribute can never both hold.
          if (c.attrId in byAttr) return false;
          byAttr[c.attrId] = true;
          return true;
        });
      }
      if (rule.type === 'sum') return a.kind === 'integer';
      return rule.type === 'apart' || rule.type === 'together';
    }

    function rangeText(min, max) {
      const lo = bound(min);
      const hi = bound(max);
      if (lo !== null && hi !== null) return lo === hi ? `exactly ${lo}` : `${lo}–${hi}`;
      if (lo !== null) return `at least ${lo}`;
      if (hi !== null) return `at most ${hi}`;
      return 'any';
    }

    function describeRule(rule, setup) {
      const a = attrMap(setup)[rule.attrId];
      const an = a ? a.name : '?';
      const scope = isAllScope(rule.scope) ? 'each group' : scopeList(rule.scope).map((g) => groupName(setup, g)).join(', ');
      const r = rangeText(rule.min, rule.max);
      switch (rule.type) {
        case 'size': return `Group size ${r} (${scope})`;
        case 'count': return `${condText(conditionsOf(rule), attrMap(setup))}: ${r} (${scope})`;
        case 'sum': return `Sum of ${an}: ${r} (${scope})`;
        case 'apart': {
          const k = Math.max(1, bound(rule.k) || 1);
          return `Keep apart by ${an}: at most ${k} per value in a group`;
        }
        case 'together': {
          const vals = (rule.values || []).filter((v) => keyOf(v) !== null);
          return `Keep together by ${an}${vals.length ? ` (${vals.join(', ')})` : ''}`;
        }
        case 'even': return rule.by === 'sum' ? `Balance the total of ${an} across groups` : `Spread ${an} evenly`;
        case 'pin': return `${personName(setup, rule.personId)} in ${groupName(setup, rule.group)}`;
        case 'pair': {
          const names = (rule.people || []).map((id) => personName(setup, id));
          return `${names.join(rule.mode === 'apart' ? ' not with ' : ' with ')}`;
        }
        default: return 'Unknown rule';
      }
    }

    // Expand scoped rules into per-group bounds. A specific-group rule replaces
    // the all-groups rule(s) for that target in that group; several rules of the
    // same scope intersect.
    function scoped(list, G, dMin, dMax) {
      const out = {
        min: new Array(G).fill(dMin), max: new Array(G).fill(dMax),
        minSrc: new Array(G).fill(null), maxSrc: new Array(G).fill(null),
      };
      function apply(rule, g) {
        const lo = bound(rule.min);
        const hi = bound(rule.max);
        if (lo !== null && lo >= out.min[g]) { out.min[g] = lo; out.minSrc[g] = rule.id; }
        if (hi !== null && hi <= out.max[g]) { out.max[g] = hi; out.maxSrc[g] = rule.id; }
      }
      list.filter((r) => isAllScope(r.scope)).forEach((r) => {
        for (let g = 0; g < G; g++) apply(r, g);
      });
      for (let g = 0; g < G; g++) {
        const own = list.filter((r) => !isAllScope(r.scope) && scopeHas(r.scope, g));
        if (!own.length) continue;
        out.min[g] = dMin; out.max[g] = dMax;
        out.minSrc[g] = null; out.maxSrc[g] = null;
        own.forEach((r) => apply(r, g));
      }
      return out;
    }

    // Normalize a setup into the solver model: per-group bounds, encoded people,
    // keep-together blocks (a block is placed as one unit). With
    // opts.hardOnly the nice-to-have rules are left out (the "must" model).
    function normalizeRules(setup, opts) {
      const hardOnly = !!(opts && opts.hardOnly);
      const attrs = attrMap(setup);
      const G = groupCount(setup);
      const people = activePeople(setup);
      const n = people.length;
      const byId = {};
      people.forEach((p, i) => { byId[p.id] = i + 1; });
      const usableRules = (setup.rules || []).filter((r) => usable(r, attrs, G, byId));
      const softIds = {};
      usableRules.forEach((r) => { if (isSoft(r)) softIds[r.id] = true; });
      const rules = hardOnly ? usableRules.filter((r) => !softIds[r.id]) : usableRules;
      const val = (p, attrId) => (p.values ? p.values[attrId] : null);

      const sizeRules = rules.filter((r) => r.type === 'size');
      const balance = !sizeRules.length && !(setup.options && setup.options.balance === false);
      let size;
      if (balance) {
        const lo = Math.floor(n / G);
        const hi = Math.ceil(n / G);
        size = {
          min: new Array(G).fill(lo), max: new Array(G).fill(hi),
          minSrc: new Array(G).fill('balance'), maxSrc: new Array(G).fill('balance'),
        };
      } else {
        size = scoped(sizeRules, G, 0, Infinity);
      }

      // "Spread evenly" by value is a count rule per value present, with the
      // bounds worked out from the people: floor/ceil of (how many) / groups.
      const countRules = rules.filter((r) => r.type === 'count');
      const sumRules = rules.filter((r) => r.type === 'sum');
      rules.filter((r) => r.type === 'even').forEach((r) => {
        if (r.by === 'sum') {
          const total = people.reduce((s, p) => s + (bound(val(p, r.attrId)) || 0), 0);
          sumRules.push({ id: r.id, type: 'sum', attrId: r.attrId, scope: 'all', min: Math.floor(total / G), max: Math.ceil(total / G) });
          return;
        }
        const tally = {};
        const order = [];
        people.forEach((p) => {
          const k = keyOf(val(p, r.attrId));
          if (k === null) return;
          if (!(k in tally)) { tally[k] = 0; order.push(k); }
          tally[k]++;
        });
        order.forEach((k) => {
          countRules.push({ id: r.id, type: 'count', attrId: r.attrId, value: k, scope: 'all', min: Math.floor(tally[k] / G), max: Math.ceil(tally[k] / G) });
        });
      });

      // Count constraints, one per distinct set of conditions (order-free).
      const countMap = {};
      countRules.forEach((r) => {
        const conds = conditionsOf(r);
        const key = conds.map((c) => `${c.attrId}|${c.value}`).sort().join('&');
        (countMap[key] = countMap[key] || { conds, rules: [] }).rules.push(r);
      });
      const counts = Object.keys(countMap).map((key) => {
        const c = countMap[key];
        return Object.assign({ key, conds: c.conds, label: condText(c.conds, attrs) }, scoped(c.rules, G, 0, Infinity));
      });
      // A pin is a count of one particular person: at least 1 in the pinned group.
      const pinMap = {};
      rules.filter((r) => r.type === 'pin').forEach((r) => {
        (pinMap[r.personId] = pinMap[r.personId] || []).push(r);
      });
      Object.keys(pinMap).forEach((personId) => {
        const con = {
          key: 'pin:' + personId, pin: true, person: personId, label: String(people[byId[personId] - 1].name).trim(),
          min: new Array(G).fill(0), max: new Array(G).fill(Infinity),
          minSrc: new Array(G).fill(null), maxSrc: new Array(G).fill(null),
        };
        pinMap[personId].forEach((r) => { con.min[r.group] = 1; con.minSrc[r.group] = r.id; });
        counts.push(con);
      });
      const matches = (p, conds) => conds.every((c) => keyOf(val(p, c.attrId)) === c.value);
      const hit = (p, con) => (con.pin ? p.id === con.person : matches(p, con.conds));

      const sumMap = {};
      sumRules.forEach((r) => {
        (sumMap[r.attrId] = sumMap[r.attrId] || []).push(r);
      });
      // Sum violations are measured in "typical person" units so that they are
      // comparable with head-count violations when rules have to be traded off.
      const sums = Object.keys(sumMap).map((attrId) => {
        const mags = people.map((p) => Math.abs(bound(val(p, attrId)) || 0)).filter((x) => x > 0);
        const unit = mags.length ? Math.max(1, mags.reduce((s, x) => s + x, 0) / mags.length) : 1;
        return Object.assign({ attrId, unit }, scoped(sumMap[attrId], G, -Infinity, Infinity));
      });

      const apartMap = {};
      rules.filter((r) => r.type === 'apart').forEach((r) => {
        const k = Math.max(1, bound(r.k) || 1);
        const cur = apartMap[r.attrId];
        if (!cur || k < cur.k) apartMap[r.attrId] = { attrId: r.attrId, k, src: r.id };
      });
      const aparts = Object.keys(apartMap).map((id) => {
        const a = apartMap[id];
        a.index = {};
        a.values = [];
        people.forEach((p) => {
          const k = keyOf(val(p, id));
          if (k !== null && !(k in a.index)) { a.index[k] = a.values.length; a.values.push(k); }
        });
        a.V = a.values.length;
        return a;
      });
      // "A not with B" is a keep-apart over just those people.
      rules.filter((r) => r.type === 'pair' && r.mode === 'apart').forEach((r) => {
        const ids = pairPeople(r, byId);
        const members = {};
        ids.forEach((id) => { members[id] = true; });
        aparts.push({
          attrId: null, pair: true, k: 1, src: r.id, members, index: {}, V: 1,
          values: [ids.map((id) => String(people[byId[id] - 1].name).trim()).join(' and ')],
        });
      });

      // Per-person aggregates: [index, amount] pairs for each constraint family.
      const aggs = people.map((p) => {
        const agg = { size: 1, c: [], s: [], a: [] };
        counts.forEach((c, ci) => { if (hit(p, c)) agg.c.push([ci, 1]); });
        sums.forEach((s, si) => {
          const v = bound(val(p, s.attrId));
          if (v) agg.s.push([si, v]);
        });
        aparts.forEach((a, ai) => {
          if (a.pair) { if (a.members[p.id]) agg.a.push([ai, 0, 1]); return; }
          const k = keyOf(val(p, a.attrId));
          if (k !== null) agg.a.push([ai, a.index[k], 1]);
        });
        return agg;
      });

      // Keep-together: union-find over people sharing a (selected) value, plus
      // "A with B" person rules.
      const parent = range(n);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      rules.filter((r) => r.type === 'together').forEach((r) => {
        const only = (r.values || []).map(keyOf).filter((v) => v !== null);
        const first = {};
        people.forEach((p, i) => {
          const k = keyOf(val(p, r.attrId));
          if (k === null || (only.length && only.indexOf(k) === -1)) return;
          if (k in first) parent[find(i)] = find(first[k]);
          else first[k] = i;
        });
      });
      rules.filter((r) => r.type === 'pair' && r.mode === 'together').forEach((r) => {
        const ids = pairPeople(r, byId);
        ids.forEach((id) => { parent[find(byId[id] - 1)] = find(byId[ids[0]] - 1); });
      });
      const blockOf = {};
      const blocks = [];
      for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!(r in blockOf)) { blockOf[r] = blocks.length; blocks.push({ members: [] }); }
        blocks[blockOf[r]].members.push(i);
      }
      blocks.forEach((b) => { b.agg = mergeAggs(b.members.map((i) => aggs[i])); });

      // Groups with identical constraints are interchangeable while empty.
      const sig = range(G).map((g) => JSON.stringify([
        size.min[g], size.max[g],
        counts.map((c) => [c.min[g], c.max[g]]),
        sums.map((s) => [s.min[g], s.max[g]]),
      ]));

      return { setup, G, n, people, rules, balance, size, counts, sums, aparts, aggs, blocks, sig, matches, hit, softIds };
    }

    function mergeAggs(list) {
      const out = { size: 0, c: [], s: [], a: [] };
      const cm = {}; const sm = {}; const am = {};
      list.forEach((agg) => {
        out.size += agg.size;
        agg.c.forEach(([ci, x]) => { cm[ci] = (cm[ci] || 0) + x; });
        agg.s.forEach(([si, x]) => { sm[si] = (sm[si] || 0) + x; });
        agg.a.forEach(([ai, v, x]) => { const k = ai + ':' + v; am[k] = (am[k] || 0) + x; });
      });
      Object.keys(cm).forEach((k) => out.c.push([+k, cm[k]]));
      Object.keys(sm).forEach((k) => { if (sm[k]) out.s.push([+k, sm[k]]); });
      Object.keys(am).forEach((k) => {
        const parts = k.split(':');
        out.a.push([+parts[0], +parts[1], am[k]]);
      });
      return out;
    }

    // ---- Group statistics -------------------------------------------------

    function newStats(m) {
      return {
        size: new Array(m.G).fill(0),
        cnt: m.counts.map(() => new Array(m.G).fill(0)),
        sum: m.sums.map(() => new Array(m.G).fill(0)),
        ap: m.aparts.map((a) => new Int32Array(m.G * Math.max(1, a.V))),
      };
    }

    function addAgg(m, st, agg, g, sign) {
      st.size[g] += sign * agg.size;
      agg.c.forEach(([ci, x]) => { st.cnt[ci][g] += sign * x; });
      agg.s.forEach(([si, x]) => { st.sum[si][g] += sign * x; });
      agg.a.forEach(([ai, v, x]) => { st.ap[ai][g * m.aparts[ai].V + v] += sign * x; });
    }

    // Violation amount of one group; 0 means every rule holds there.
    function groupCost(m, st, g) {
      let c = over(st.size[g], m.size.min[g], m.size.max[g]);
      m.counts.forEach((con, ci) => { c += over(st.cnt[ci][g], con.min[g], con.max[g]); });
      m.sums.forEach((con, si) => { c += over(st.sum[si][g], con.min[g], con.max[g]) / con.unit; });
      m.aparts.forEach((a, ai) => {
        const arr = st.ap[ai];
        const base = g * a.V;
        for (let v = 0; v < a.V; v++) if (arr[base + v] > a.k) c += arr[base + v] - a.k;
      });
      return c;
    }

    function totalCost(m, st) {
      let c = 0;
      for (let g = 0; g < m.G; g++) c += groupCost(m, st, g);
      return c;
    }

    function ruleLabel(m, id) {
      if (id === 'balance') return 'Balanced group sizes';
      const r = (m.setup.rules || []).find((x) => x.id === id);
      return r ? describeRule(r, m.setup) : '';
    }

    function violationList(m, st) {
      const out = [];
      const setup = m.setup;
      const attrs = attrMap(setup);
      const push = (g, ruleId, what, x, lo, hi, kind) => {
        const amount = over(x, lo, hi);
        if (!amount) return;
        const low = x < lo;
        out.push({
          group: g, ruleId, amount, kind,
          message: `${groupName(setup, g)}: ${what} is ${x} — ${amount} ${low ? 'below the minimum' : 'over the maximum'} of ${low ? lo : hi}`,
        });
      };
      for (let g = 0; g < m.G; g++) {
        const sz = st.size[g];
        push(g, sz < m.size.min[g] ? m.size.minSrc[g] : m.size.maxSrc[g], 'size', sz, m.size.min[g], m.size.max[g], 'size');
        m.counts.forEach((con, ci) => {
          const x = st.cnt[ci][g];
          if (con.pin) {
            if (x < con.min[g]) out.push({ group: g, ruleId: con.minSrc[g], amount: 1, kind: 'pin', message: `${groupName(setup, g)}: ${con.label} should be here` });
            return;
          }
          push(g, x < con.min[g] ? con.minSrc[g] : con.maxSrc[g], `count of ${con.label}`, x, con.min[g], con.max[g], 'count');
        });
        m.sums.forEach((con, si) => {
          const x = st.sum[si][g];
          const a = attrs[con.attrId];
          push(g, x < con.min[g] ? con.minSrc[g] : con.maxSrc[g], `sum of ${a ? a.name : '?'}`, x, con.min[g], con.max[g], 'sum');
        });
        m.aparts.forEach((a, ai) => {
          if (a.pair) {
            const x = st.ap[ai][g];
            if (x > 1) out.push({ group: g, ruleId: a.src, amount: x - 1, kind: 'pair', message: `${groupName(setup, g)}: ${x} of ${a.values[0]} are together but should be apart` });
            return;
          }
          const an = attrs[a.attrId] ? attrs[a.attrId].name : '?';
          for (let v = 0; v < a.V; v++) {
            const x = st.ap[ai][g * a.V + v];
            if (x > a.k) {
              out.push({
                group: g, ruleId: a.src, amount: x - a.k, kind: 'apart',
                message: `${groupName(setup, g)}: ${x} people share ${an} = ${a.values[v]} (keep apart allows ${a.k})`,
              });
            }
          }
        });
      }
      out.forEach((v) => { v.rule = ruleLabel(m, v.ruleId); v.soft = !!m.softIds[v.ruleId]; });
      return out;
    }

    function groupsFromAssign(m, personGroup) {
      const groups = range(m.G).map(() => []);
      personGroup.forEach((g, i) => { groups[g].push(m.people[i].id); });
      return groups;
    }

    // Check an arbitrary result ({ groups: [[personId…]] }) against the setup.
    function evaluate(setup, groups) {
      const m = normalizeRules(setup);
      const st = newStats(m);
      const index = {};
      m.people.forEach((p, i) => { index[p.id] = i; });
      groups.forEach((ids, g) => ids.forEach((id) => {
        if (id in index) addAgg(m, st, m.aggs[index[id]], g, 1);
      }));
      const violations = violationList(m, st);
      // Keep-together is structural: report any block split across groups.
      const where = {};
      groups.forEach((ids, g) => ids.forEach((id) => { where[id] = g; }));
      m.blocks.forEach((b) => {
        const gs = {};
        b.members.forEach((i) => { gs[where[m.people[i].id]] = true; });
        if (Object.keys(gs).length > 1) {
          violations.push({ group: null, ruleId: null, soft: false, amount: Object.keys(gs).length - 1, kind: 'together', rule: 'Keep together', message: `A keep-together set is split across ${Object.keys(gs).length} groups` });
        }
      });
      return violations;
    }

    // ---- Fast path: rejection sampling ----------------------------------

    // A random size vector within the per-group bounds that adds up to n.
    function randomSizes(m) {
      const sizes = m.size.min.slice();
      let rest = m.n - sizes.reduce((s, x) => s + x, 0);
      if (rest < 0) return null;
      while (rest > 0) {
        const open = [];
        for (let g = 0; g < m.G; g++) if (sizes[g] < m.size.max[g]) open.push(g);
        if (!open.length) return null;
        sizes[open[randomIndex(open.length)]]++;
        rest--;
      }
      return sizes;
    }

    function fastPath(m, tries) {
      if (m.blocks.some((b) => b.members.length > 1)) return null;
      const stop = now() + FAST_MS;
      for (let t = 0; t < tries && (t < 10 || now() < stop); t++) {
        const sizes = randomSizes(m);
        if (!sizes) return null;
        const order = shuffle(range(m.n));
        const personGroup = new Array(m.n);
        const st = newStats(m);
        let pos = 0;
        sizes.forEach((sz, g) => {
          for (let j = 0; j < sz; j++) {
            const i = order[pos++];
            personGroup[i] = g;
            addAgg(m, st, m.aggs[i], g, 1);
          }
        });
        if (totalCost(m, st) === 0) return personGroup;
      }
      return null;
    }

    // ---- Constructive path: randomized backtracking ----------------------

    function blockOrder(m) {
      const totals = m.counts.map(() => 0);
      const apTotals = m.aparts.map((a) => new Array(a.V).fill(0));
      m.aggs.forEach((agg) => {
        agg.c.forEach(([ci, x]) => { totals[ci] += x; });
        agg.a.forEach(([ai, v, x]) => { apTotals[ai][v] += x; });
      });
      const sumOf = (arr) => arr.reduce((s, x) => s + x, 0);
      const cWeight = m.counts.map((c, ci) => {
        const have = Math.max(1, totals[ci]);
        const room = sumOf(c.max);
        return sumOf(c.min) / have + (Number.isFinite(room) ? have / Math.max(1, room) : 0);
      });
      const score = (b) => {
        let s = b.agg.size;
        b.agg.c.forEach(([ci]) => { s += cWeight[ci]; });
        b.agg.a.forEach(([ai, v]) => { s += apTotals[ai][v] / (m.G * m.aparts[ai].k); });
        if (b.agg.s.length) s += 0.5;
        return s;
      };
      const scored = shuffle(range(m.blocks.length)).map((b) => [b, score(m.blocks[b])]);
      scored.sort((x, y) => y[1] - x[1]); // stable: random tie-break from the shuffle
      return scored.map((x) => x[0]);
    }

    function backtrack(m, limits) {
      const G = m.G;
      const st = newStats(m);
      const rem = { n: m.n, cnt: m.counts.map(() => 0), pos: m.sums.map(() => 0), neg: m.sums.map(() => 0), ap: m.aparts.map((a) => new Array(a.V).fill(0)) };
      m.aggs.forEach((agg) => {
        agg.c.forEach(([ci, x]) => { rem.cnt[ci] += x; });
        agg.s.forEach(([si, x]) => { if (x > 0) rem.pos[si] += x; else rem.neg[si] += x; });
        agg.a.forEach(([ai, v, x]) => { rem.ap[ai][v] += x; });
      });
      // Per-block positive/negative sum parts, to keep remaining bounds exact.
      const bSum = m.blocks.map((b) => {
        const parts = [];
        b.members.forEach((i) => m.aggs[i].s.forEach(([si, x]) => parts.push([si, x])));
        return parts;
      });

      function remove(bi, sign) {
        const agg = m.blocks[bi].agg;
        rem.n -= sign * agg.size;
        agg.c.forEach(([ci, x]) => { rem.cnt[ci] -= sign * x; });
        agg.a.forEach(([ai, v, x]) => { rem.ap[ai][v] -= sign * x; });
        bSum[bi].forEach(([si, x]) => {
          if (x > 0) rem.pos[si] -= sign * x; else rem.neg[si] -= sign * x;
        });
      }

      function sizeOk() {
        let need = 0; let cap = 0;
        for (let h = 0; h < G; h++) {
          need += Math.max(0, m.size.min[h] - st.size[h]);
          cap += Math.max(0, m.size.max[h] - st.size[h]);
        }
        return need <= rem.n && cap >= rem.n;
      }
      function countOk(ci) {
        const con = m.counts[ci];
        const cur = st.cnt[ci];
        let need = 0; let cap = 0;
        for (let h = 0; h < G; h++) {
          const lo = con.min[h] - cur[h];
          if (lo > 0) {
            need += lo;
            if (lo > m.size.max[h] - st.size[h]) return false;
          }
          cap += Math.max(0, Math.min(con.max[h] - cur[h], m.size.max[h] - st.size[h]));
        }
        return need <= rem.cnt[ci] && cap >= rem.cnt[ci];
      }
      function roomOk(g) {
        const room = m.size.max[g] - st.size[g];
        for (let ci = 0; ci < m.counts.length; ci++) {
          if (m.counts[ci].min[g] - st.cnt[ci][g] > room) return false;
        }
        return true;
      }
      function apartOk(ai, v) {
        const a = m.aparts[ai];
        let cap = 0;
        for (let h = 0; h < G; h++) {
          cap += Math.max(0, Math.min(a.k - st.ap[ai][h * a.V + v], m.size.max[h] - st.size[h]));
        }
        return cap >= rem.ap[ai][v];
      }
      function sumOk(si) {
        const con = m.sums[si];
        for (let h = 0; h < G; h++) {
          const cur = st.sum[si][h];
          if (cur + rem.pos[si] < con.min[h] || cur + rem.neg[si] > con.max[h]) return false;
        }
        return true;
      }
      function rootOk() {
        if (!sizeOk()) return false;
        for (let ci = 0; ci < m.counts.length; ci++) if (!countOk(ci)) return false;
        for (let g = 0; g < G; g++) if (!roomOk(g)) return false;
        for (let ai = 0; ai < m.aparts.length; ai++) {
          for (let v = 0; v < m.aparts[ai].V; v++) if (!apartOk(ai, v)) return false;
        }
        for (let si = 0; si < m.sums.length; si++) if (!sumOk(si)) return false;
        return true;
      }
      function canPlace(agg, g) {
        if (st.size[g] + agg.size > m.size.max[g]) return false;
        for (const [ci, x] of agg.c) if (st.cnt[ci][g] + x > m.counts[ci].max[g]) return false;
        for (const [ai, v, x] of agg.a) {
          const a = m.aparts[ai];
          if (st.ap[ai][g * a.V + v] + x > a.k) return false;
        }
        return true;
      }
      function prune(agg, g) {
        if (!sizeOk() || !roomOk(g)) return false;
        for (const [ci] of agg.c) if (!countOk(ci)) return false;
        for (const [ai, v] of agg.a) if (!apartOk(ai, v)) return false;
        for (const [si] of agg.s) if (!sumOk(si)) return false;
        return true;
      }

      if (!rootOk()) return { status: 'infeasible' };

      const blockGroup = new Array(m.blocks.length);
      const deadline = now() + limits.timeMs;
      let order = null;
      let nodes = 0;
      let cap = 0;
      let aborted = false;

      function rec(depth) {
        if (depth === order.length) return true;
        nodes++;
        if (nodes > cap || ((nodes & 127) === 0 && now() > deadline)) {
          aborted = true;
          return false;
        }
        const bi = order[depth];
        const agg = m.blocks[bi].agg;
        // Random group order, least-filled first: deals like a shuffled
        // round-robin, which keeps late placements from boxing themselves in.
        const gs = shuffle(range(G)).sort((x, y) => st.size[x] - st.size[y]);
        const triedEmpty = {};
        for (let t = 0; t < G; t++) {
          const g = gs[t];
          if (st.size[g] === 0) {
            if (triedEmpty[m.sig[g]]) continue;
            triedEmpty[m.sig[g]] = true;
          }
          if (!canPlace(agg, g)) continue;
          addAgg(m, st, agg, g, 1);
          remove(bi, 1);
          if (prune(agg, g) && rec(depth + 1)) {
            blockGroup[bi] = g;
            return true;
          }
          addAgg(m, st, agg, g, -1);
          remove(bi, -1);
          if (aborted) return false;
        }
        return false;
      }

      // Restarts with a growing node budget: a fresh random order escapes an
      // unlucky early choice; a run that finishes without hitting its budget
      // has searched everything, which proves infeasibility.
      let budget = Math.max(1000, 2 * m.blocks.length);
      let used = 0;
      for (;;) {
        order = blockOrder(m);
        nodes = 0;
        aborted = false;
        cap = Math.min(budget, limits.nodeLimit - used);
        if (rec(0) && totalCost(m, st) === 0) {
          const personGroup = new Array(m.n);
          m.blocks.forEach((b, bi) => b.members.forEach((i) => { personGroup[i] = blockGroup[bi]; }));
          return { status: 'ok', personGroup };
        }
        if (!aborted) return { status: 'infeasible' };
        used += nodes;
        if (used >= limits.nodeLimit || now() > deadline) return { status: 'timeout' };
        budget *= 2;
      }
    }

    function solveModel(m, opts) {
      const o = opts || {};
      if (m.n === 0) return { status: 'ok', personGroup: [], groups: range(m.G).map(() => []), method: 'empty' };
      const fast = fastPath(m, o.fastTries === undefined ? FAST_TRIES : o.fastTries);
      if (fast) return { status: 'ok', personGroup: fast, groups: groupsFromAssign(m, fast), method: 'sampling' };
      const res = backtrack(m, {
        nodeLimit: o.nodeLimit || NODE_LIMIT,
        timeMs: o.timeMs || TIME_MS,
      });
      if (res.status === 'ok') return { status: 'ok', personGroup: res.personGroup, groups: groupsFromAssign(m, res.personGroup), method: 'search' };
      if (res.status === 'timeout' && !o.noRepair) {
        // Big, loose setups can outgrow the search budget; a local-search repair
        // run often still finds a fully valid split.
        const be = bestEffortModel(m, { timeMs: o.timeMs || TIME_MS });
        if (be.cost === 0) return { status: 'ok', personGroup: be.personGroup, groups: be.groups, method: 'repair' };
      }
      return { status: res.status };
    }

    function solve(setup, opts) {
      return solveModel(normalizeRules(setup), opts);
    }

    // ---- Best effort: random-restart hill climbing ------------------------

    function bestEffortModel(m, opts) {
      const o = opts || {};
      const deadline = now() + (o.timeMs || TIME_MS);
      const B = m.blocks.length;
      const G = m.G;
      let best = null;
      let bestCost = Infinity;
      let ties = 0;

      do {
        const st = newStats(m);
        const where = new Array(B);
        const lists = range(G).map(() => []);
        const pos = new Array(B);
        const target = randomSizes(m) || range(G).map((g) => Math.floor(m.n / G) + (g < m.n % G ? 1 : 0));
        shuffle(range(B)).forEach((bi) => {
          let pick = [];
          let room = -Infinity;
          for (let g = 0; g < G; g++) {
            const r = target[g] - st.size[g];
            if (r > room) { room = r; pick = [g]; } else if (r === room) pick.push(g);
          }
          const g = pick[randomIndex(pick.length)];
          where[bi] = g; pos[bi] = lists[g].length; lists[g].push(bi);
          addAgg(m, st, m.blocks[bi].agg, g, 1);
        });
        const costs = range(G).map((g) => groupCost(m, st, g));
        let cost = costs.reduce((s, x) => s + x, 0);

        const detach = (bi) => {
          const l = lists[where[bi]];
          const last = l.pop();
          if (last !== bi) { l[pos[bi]] = last; pos[last] = pos[bi]; }
        };
        const attach = (bi, g) => { where[bi] = g; pos[bi] = lists[g].length; lists[g].push(bi); };
        const move = (bi, g) => {
          addAgg(m, st, m.blocks[bi].agg, where[bi], -1);
          addAgg(m, st, m.blocks[bi].agg, g, 1);
          detach(bi); attach(bi, g);
        };

        let stale = 0;
        const staleLimit = Math.max(2000, 30 * B);
        let iter = 0;
        while (cost > 0 && G > 1 && stale < staleLimit) {
          if ((++iter & 63) === 0 && now() > deadline) break;
          const bi = randomIndex(B);
          const g = where[bi];
          let h = randomIndex(G - 1);
          if (h >= g) h++;
          const other = lists[h].length && randomIndex(2) ? lists[h][randomIndex(lists[h].length)] : -1;
          const before = costs[g] + costs[h];
          move(bi, h);
          if (other >= 0) move(other, g);
          const cg = groupCost(m, st, g);
          const ch = groupCost(m, st, h);
          if (cg + ch <= before) {
            stale = cg + ch < before ? 0 : stale + 1;
            costs[g] = cg; costs[h] = ch;
            cost = costs.reduce((s, x) => s + x, 0); // exact: sum costs are fractional
          } else {
            if (other >= 0) move(other, h);
            move(bi, g);
            stale++;
          }
        }

        if (cost < bestCost) {
          bestCost = cost; ties = 1; best = { st, where: where.slice() };
        } else if (cost === bestCost && randomIndex(++ties) === 0) {
          best = { st, where: where.slice() };
        }
      } while (bestCost > 0 && now() < deadline);

      const personGroup = new Array(m.n);
      m.blocks.forEach((b, bi) => b.members.forEach((i) => { personGroup[i] = best.where[bi]; }));
      return {
        cost: bestCost,
        personGroup,
        groups: groupsFromAssign(m, personGroup),
        violations: violationList(m, best.st),
      };
    }

    function bestEffort(setup, opts) {
      return bestEffortModel(normalizeRules(setup), opts);
    }

    // ---- Nice-to-have polish: lexicographic local search -------------------

    // How often each pair of people has already shared a group (earlier rounds
    // or earlier draws). avoid = [ [ [personId…] per group ] per draw ].
    function buildMet(m, avoid, force) {
      const list = Array.isArray(avoid) ? avoid : [];
      if (!list.length && !force) return null;
      const met = new Uint8Array(m.n * m.n);
      list.forEach((groups) => addMet(m, met, groups));
      return met;
    }

    function addMet(m, met, groups) {
      const index = {};
      m.people.forEach((p, i) => { index[p.id] = i; });
      (groups || []).forEach((ids) => {
        const idx = (ids || []).map((id) => index[id]).filter((i) => i !== undefined);
        for (let a = 0; a < idx.length; a++) {
          for (let b = a + 1; b < idx.length; b++) {
            const i = idx[a]; const j = idx[b];
            if (met[i * m.n + j] < 255) { met[i * m.n + j]++; met[j * m.n + i]++; }
          }
        }
      });
    }

    // Pairs in this split that have met before.
    function countRepeats(m, met, personGroup) {
      if (!met) return 0;
      let r = 0;
      for (let i = 0; i < m.n; i++) {
        for (let j = i + 1; j < m.n; j++) {
          if (personGroup[i] === personGroup[j] && met[i * m.n + j]) r++;
        }
      }
      return r;
    }

    // Improve a split without ever making a higher tier worse:
    // 1. must rules (mh), 2. nice-to-have rules (mf), 3. repeated pairings (met).
    // Random moves/swaps of blocks, accepted when the tiers do not get worse.
    function polish(mh, mf, personGroup, met, timeMs) {
      const B = mh.blocks.length;
      const G = mh.G;
      const n = mh.n;
      if (G < 2 || B < 2) return personGroup;
      const dual = mf !== mh;
      const stH = newStats(mh);
      const stF = dual ? newStats(mf) : stH;
      const where = new Array(B);
      const pos = new Array(B);
      const lists = range(G).map(() => []);
      mh.blocks.forEach((b, bi) => {
        const g = personGroup[b.members[0]];
        where[bi] = g; pos[bi] = lists[g].length; lists[g].push(bi);
        addAgg(mh, stH, b.agg, g, 1);
        if (dual) addAgg(mf, stF, mf.blocks[bi].agg, g, 1);
      });
      const cH = range(G).map((g) => groupCost(mh, stH, g));
      const cF = dual ? range(G).map((g) => groupCost(mf, stF, g)) : cH;
      const total = (arr) => arr.reduce((s, x) => s + x, 0);
      const rep = (bi, g) => {
        if (!met) return 0;
        let s = 0;
        const mine = mh.blocks[bi].members;
        const l = lists[g];
        for (let x = 0; x < l.length; x++) {
          if (l[x] === bi) continue;
          const theirs = mh.blocks[l[x]].members;
          for (let a = 0; a < mine.length; a++) {
            const row = mine[a] * n;
            for (let b = 0; b < theirs.length; b++) s += met[row + theirs[b]];
          }
        }
        return s;
      };
      let totR = 0;
      if (met) { for (let bi = 0; bi < B; bi++) totR += rep(bi, where[bi]); totR /= 2; }
      const move = (bi, g) => {
        const from = where[bi];
        addAgg(mh, stH, mh.blocks[bi].agg, from, -1);
        addAgg(mh, stH, mh.blocks[bi].agg, g, 1);
        if (dual) {
          addAgg(mf, stF, mf.blocks[bi].agg, from, -1);
          addAgg(mf, stF, mf.blocks[bi].agg, g, 1);
        }
        const l = lists[from];
        const last = l.pop();
        if (last !== bi) { l[pos[bi]] = last; pos[last] = pos[bi]; }
        where[bi] = g; pos[bi] = lists[g].length; lists[g].push(bi);
      };

      const deadline = now() + timeMs;
      const staleLimit = Math.max(2000, 30 * B);
      let stale = 0;
      let iter = 0;
      while ((total(cF) > EPS || totR > 0) && stale < staleLimit) {
        if ((++iter & 63) === 0 && now() > deadline) break;
        const bi = randomIndex(B);
        const g = where[bi];
        let h = randomIndex(G - 1);
        if (h >= g) h++;
        const other = lists[h].length && randomIndex(2) ? lists[h][randomIndex(lists[h].length)] : -1;
        const hB = cH[g] + cH[h];
        const fB = cF[g] + cF[h];
        const rB = met ? rep(bi, g) + (other >= 0 ? rep(other, h) : 0) : 0;
        move(bi, h);
        if (other >= 0) move(other, g);
        const hg = groupCost(mh, stH, g);
        const hh = groupCost(mh, stH, h);
        const fg = dual ? groupCost(mf, stF, g) : hg;
        const fh = dual ? groupCost(mf, stF, h) : hh;
        const rA = met ? rep(bi, h) + (other >= 0 ? rep(other, g) : 0) : 0;
        const hA = hg + hh;
        const fA = fg + fh;
        let cmp;
        if (hA < hB - EPS) cmp = -1; else if (hA > hB + EPS) cmp = 1;
        else if (fA < fB - EPS) cmp = -1; else if (fA > fB + EPS) cmp = 1;
        else cmp = rA < rB ? -1 : (rA > rB ? 1 : 0);
        if (cmp <= 0) {
          stale = cmp < 0 ? 0 : stale + 1;
          cH[g] = hg; cH[h] = hh;
          if (dual) { cF[g] = fg; cF[h] = fh; }
          totR += rA - rB;
        } else {
          if (other >= 0) move(other, h);
          move(bi, g);
          stale++;
        }
      }
      const out = new Array(n);
      mh.blocks.forEach((b, bi) => b.members.forEach((i) => { out[i] = where[bi]; }));
      return out;
    }

    // ---- Live hints: cheap necessary conditions ---------------------------

    function hintsFor(m, setup) {
      const attrs = attrMap(setup);
      const out = [];
      const err = (message, ruleIds) => out.push({ level: 'error', message, ruleIds: (ruleIds || []).filter(Boolean) });
      const warn = (message, ruleIds) => out.push({ level: 'warning', message, ruleIds: (ruleIds || []).filter(Boolean) });
      const sum = (arr) => arr.reduce((s, x) => s + x, 0);
      const ids = (con) => con.minSrc.concat(con.maxSrc).filter((x, i, a) => x && x !== 'balance' && a.indexOf(x) === i);
      const G = m.G;

      m.rules.forEach((r) => {
        const lo = bound(r.min); const hi = bound(r.max);
        if (lo !== null && hi !== null && lo > hi) err(`“${describeRule(r, setup)}”: min is larger than max.`, [r.id]);
      });

      if (m.n > 0 && G > m.n) warn(`${G} groups but only ${m.n} people — some groups will be empty.`);

      const sMin = sum(m.size.min); const sMax = sum(m.size.max);
      if (sMin > m.n) err(`Group-size minimums add up to ${sMin}, but there are only ${m.n} people.`, ids(m.size));
      if (sMax < m.n) err(`Group-size maximums only fit ${sMax} people, but there are ${m.n}.`, ids(m.size));

      m.counts.forEach((con) => {
        if (con.pin) {
          if (sum(con.min) > 1) err(`${con.label} is pinned to more than one group.`, ids(con));
          return;
        }
        const label = `“${con.label}”`;
        const have = m.people.filter((p) => m.hit(p, con)).length;
        const need = sum(con.min);
        const room = sum(con.max);
        const uniformMin = con.min.every((x) => x === con.min[0]);
        if (need > have) {
          err(uniformMin
            ? `${G} groups × min ${con.min[0]} ${label} = ${need}, but only ${have} ${have === 1 ? 'person has' : 'people have'} it.`
            : `Group minimums for ${label} add up to ${need}, but only ${have} ${have === 1 ? 'person has' : 'people have'} it.`, ids(con));
        } else if (room < have) {
          err(`Group maximums for ${label} only fit ${room}, but ${have} people have it.`, ids(con));
        } else if (have === 0) {
          warn(`Nobody has ${label} yet — the rule has no effect.`, ids(con));
        }
        for (let g = 0; g < G; g++) {
          if (con.min[g] > m.size.max[g]) {
            err(`${groupName(setup, g)} needs at least ${con.min[g]} ${label} but holds at most ${m.size.max[g]} people.`, ids(con));
            break;
          }
        }
      });

      m.sums.forEach((con) => {
        const a = attrs[con.attrId];
        const total = sum(m.people.map((p) => bound(p.values && p.values[con.attrId]) || 0));
        const lo = sum(con.min); const hi = sum(con.max);
        if (lo > total) err(`Sum-of-${a.name} minimums add up to ${lo}, but the total of everyone's ${a.name} is ${total}.`, ids(con));
        if (hi < total) err(`Sum-of-${a.name} maximums add up to ${hi}, but the total of everyone's ${a.name} is ${total}.`, ids(con));
      });

      m.aparts.forEach((a) => {
        if (a.pair) {
          const count = Object.keys(a.members).length;
          if (count > G) err(`${a.values[0]} should all be apart, but there are only ${G} groups.`, [a.src]);
          return;
        }
        const an = attrs[a.attrId].name;
        const tally = new Array(a.V).fill(0);
        m.people.forEach((p) => {
          const k = keyOf(p.values && p.values[a.attrId]);
          if (k !== null) tally[a.index[k]]++;
        });
        const worst = tally.reduce((w, c, v) => (c > G * a.k && (w < 0 || c > tally[w]) ? v : w), -1);
        if (worst >= 0) {
          err(`${tally[worst]} people have ${an} = ${a.values[worst]}, but ${G} groups × at most ${a.k} = ${G * a.k} — keep apart can't separate them.`, [a.src]);
        }
      });

      const biggest = Math.max.apply(null, m.size.max);
      const togetherIds = m.rules.filter((r) => r.type === 'together' || (r.type === 'pair' && r.mode === 'together')).map((r) => r.id);
      let flagged = false;
      m.blocks.forEach((b) => {
        if (flagged || b.members.length < 2) return;
        if (b.members.length > biggest) {
          err(`A keep-together set has ${b.members.length} people, but no group can hold more than ${biggest}.`, togetherIds);
          flagged = true;
          return;
        }
        b.agg.a.forEach(([ai, v, x]) => {
          const a = m.aparts[ai];
          if (!flagged && x > a.k) {
            err(a.pair
              ? `${a.values[0]} are asked to be both together and apart.`
              : `Keep together puts ${x} people with ${attrs[a.attrId].name} = ${a.values[v]} in one group, but keep apart allows ${a.k}.`, togetherIds.concat([a.src]));
            flagged = true;
          }
        });
      });
      return out;
    }

    // Problems with must rules are errors (they block a strict draw); the same
    // problems caused only by nice-to-have rules are warnings.
    function validateHints(setup) {
      const mh = normalizeRules(setup, { hardOnly: true });
      const hard = hintsFor(mh, setup);
      if (!Object.keys(mh.softIds).length) return hard;
      const seen = {};
      hard.forEach((h) => { seen[h.message] = true; });
      hintsFor(normalizeRules(setup), setup).forEach((h) => {
        if (seen[h.message]) return;
        hard.push({
          level: 'warning', soft: true, ruleIds: h.ruleIds,
          message: h.level === 'error' ? `${h.message} Nice-to-have rules are met as closely as possible.` : h.message,
        });
      });
      return hard;
    }

    // ---- Explaining infeasibility -----------------------------------------

    function blame(setup) {
      const soft = normalizeRules(setup, { hardOnly: true }).softIds;
      const rules = (setup.rules || []).filter((r) => !soft[r.id]).slice(0, BLAME_RULES);
      const out = [];
      const tryWithout = (variant, label, ruleId) => {
        const mv = normalizeRules(variant, { hardOnly: true });
        if (hintsFor(mv, variant).some((h) => h.level === 'error')) return;
        const res = solveModel(mv, { timeMs: BLAME_MS, nodeLimit: 20000, fastTries: 50, noRepair: true });
        if (res.status === 'ok') out.push({ ruleId, rule: label, message: `Dropping “${label}” makes this feasible.` });
      };
      rules.forEach((r) => {
        tryWithout(Object.assign({}, setup, { rules: setup.rules.filter((x) => x !== r) }), describeRule(r, setup), r.id);
      });
      const m = normalizeRules(setup, { hardOnly: true });
      if (m.balance) {
        tryWithout(Object.assign({}, setup, { options: Object.assign({}, setup.options, { balance: false }) }), 'Balanced group sizes', 'balance');
      }
      return out;
    }

    // One split: must rules strictly (or best effort), then nice-to-have rules
    // and repeat pairings polished without breaking a must rule.
    function drawOnce(mh, mf, met, errors, wantBest, o) {
      let pg = null;
      let method = '';
      let failed = 'infeasible';
      if (!errors.length) {
        if (mf !== mh) {
          const all = solveModel(mf, { timeMs: FULL_MS, nodeLimit: 10000, fastTries: o.fastTries, noRepair: true });
          if (all.status === 'ok') { pg = all.personGroup; method = all.method; }
        }
        if (!pg) {
          const res = solveModel(mh, o);
          if (res.status === 'ok') { pg = res.personGroup; method = res.method; } else failed = res.status;
        }
      }
      if (!pg) {
        if (!wantBest) return { status: failed };
        pg = bestEffortModel(mh, o).personGroup;
        method = 'best-effort';
      }
      if (mf !== mh || met) pg = polish(mh, mf, pg, met, o.polishMs || POLISH_MS);
      const st = newStats(mf);
      pg.forEach((g, i) => addAgg(mf, st, mf.aggs[i], g, 1));
      const all = violationList(mf, st);
      const violations = all.filter((v) => !v.soft);
      return {
        status: violations.length ? 'best-effort' : 'ok',
        groups: groupsFromAssign(mf, pg), personGroup: pg,
        violations, notes: all.filter((v) => v.soft),
        repeats: countRepeats(mf, met, pg), method,
      };
    }

    // Full pipeline used by the UI (and its Worker). opts.rounds draws several
    // splits in a row, each avoiding the pairings of the ones before;
    // opts.avoid lists earlier splits whose pairings should not repeat.
    function run(setup, opts) {
      const o = opts || {};
      const mh = normalizeRules(setup, { hardOnly: true });
      if (mh.n === 0) return { status: 'empty', message: 'Add at least one person to draw groups.' };
      const mf = Object.keys(mh.softIds).length ? normalizeRules(setup) : mh;
      const errors = hintsFor(mh, setup).filter((h) => h.level === 'error');
      const wantBest = !!(setup.options && setup.options.bestEffort);
      const want = Math.min(MAX_ROUNDS, Math.max(1, parseInt(o.rounds, 10) || 1));
      const met = buildMet(mh, o.avoid, want > 1);
      const rounds = [];
      for (let r = 0; r < want; r++) {
        const res = drawOnce(mh, mf, met, errors, wantBest, o);
        if (res.status !== 'ok' && res.status !== 'best-effort') {
          if (r > 0) break; // later rounds ran out of time: return the ones drawn
          if (errors.length || res.status === 'infeasible') {
            return { status: 'infeasible', reasons: errors.map((e) => e.message), blame: blame(setup) };
          }
          return { status: 'timeout', reasons: [], blame: [] };
        }
        if (met) addMet(mh, met, res.groups);
        delete res.personGroup;
        rounds.push(res);
      }
      const first = rounds[0];
      if (want === 1) return first;
      return {
        status: rounds.some((x) => x.status === 'best-effort') ? 'best-effort' : 'ok',
        groups: first.groups, violations: first.violations, notes: first.notes, repeats: first.repeats, method: first.method,
        rounds,
      };
    }

    return {
      normalizeRules, validateHints, scopeHas, solve, bestEffort, evaluate, run, blame, describeRule, isSoft,
    };
  }

  root.GroupDrawSolver = createSolver(root.randomIndex);
  root.GroupDrawSolver.createSolver = createSolver;
})(typeof window !== 'undefined' ? window : globalThis);
