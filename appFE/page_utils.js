// Shared, view-agnostic helpers (window.PageUtils). Owned by no view: nothing in
// here knows about any view's IDs, classes or state. Additive only — existing
// functions keep their signatures and behaviour; a new need means a new function.
(function () {
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // One CSV cell: quoted when needed, and text that a spreadsheet would run as a
  // formula (=, +, -, @, tab, CR) is prefixed with ' — plain negative numbers stay.
  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Resolves true when the text reached the clipboard, false when the caller
  // should offer a manual fallback (no API, permission denied, …). Never rejects.
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => false);
      }
    } catch (e) { /* clipboard unavailable */ }
    return Promise.resolve(false);
  }

  // Show a status message in `target` (hidden when empty); kind: 'error' | 'warning'.
  function notice(target, message, kind) {
    if (!target) return;
    target.textContent = message || '';
    target.hidden = !message;
    target.classList.toggle('is-error', kind === 'error');
    target.classList.toggle('is-warning', kind === 'warning');
  }

  const CONFETTI_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

  // A short canvas confetti burst over `root` (default: body). Purely cosmetic —
  // Math.random is fine here. Skipped entirely under reduced motion.
  function confetti(root, options) {
    if (reduceMotion()) return null;
    const o = options || {};
    const host = root || document.body;
    const canvas = document.createElement('canvas');
    canvas.className = 'page-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    host.appendChild(canvas);
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return null; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    const colors = o.colors || CONFETTI_COLORS;
    const bits = [];
    const count = o.count || 110;
    for (let i = 0; i < count; i++) {
      bits.push({
        x: w * (0.2 + Math.random() * 0.6), y: h * 0.35 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 9, vy: -6 - Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        s: 6 + Math.random() * 6, c: colors[i % colors.length],
      });
    }
    const start = performance.now();
    const life = o.duration || 3200;
    let raf = 0;
    function frame(t) {
      const age = t - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, Math.min(1, (life - age) / 600));
      bits.forEach((b) => {
        b.vy += 0.22; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (age < life && canvas.isConnected) raf = requestAnimationFrame(frame);
      else canvas.remove();
    }
    raf = requestAnimationFrame(frame);
    return { stop() { cancelAnimationFrame(raf); canvas.remove(); } };
  }

  // Run a pure, self-contained factory (e.g. a solver's createSolver(randomIndex))
  // in an inline Blob Worker, falling back to the main thread when Workers are
  // unavailable or fail. The factory's source must not reference outer variables.
  //   const runner = createWorkerRunner(createSolver, { method: 'run' });
  //   runner.run(a, b).then(...); runner.cancel(valueToResolveWith);
  function createWorkerRunner(factory, options) {
    const o = options || {};
    const method = o.method || 'run';
    let worker = null;
    let workerUrl = null;
    let broken = o.worker === false;
    let local = null;
    let job = null;
    let seq = 0;
    let mode = 'idle';

    function runLocal(j) {
      mode = 'main';
      try {
        if (!local) local = factory(randomIndex);
        j.resolve(local[method].apply(local, j.args));
      } catch (err) { j.reject(err); }
    }
    function kill() {
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      worker = null;
      workerUrl = null;
    }
    function getWorker() {
      if (worker) return worker;
      if (broken || typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) return null;
      try {
        const src = randomIndex.toString() + '\nvar S = (' + factory.toString() + ')(randomIndex);\n' +
          'self.onmessage = function (e) { var out; try { out = { ok: true, value: S[e.data.method].apply(S, e.data.args) }; }' +
          ' catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }' +
          ' self.postMessage({ seq: e.data.seq, out: out }); };';
        workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(workerUrl);
        worker.onmessage = (e) => {
          if (!job || e.data.seq !== job.seq) return;
          const j = job;
          job = null;
          if (e.data.out.ok) j.resolve(e.data.out.value); else j.reject(new Error(e.data.out.error));
        };
        worker.onerror = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          broken = true;
          kill();
          if (job) { const j = job; job = null; runLocal(j); }
        };
        return worker;
      } catch (e) {
        broken = true;
        kill();
        return null;
      }
    }
    function run() {
      const args = Array.prototype.slice.call(arguments);
      if (job) cancel(undefined);
      return new Promise((resolve, reject) => {
        const j = { seq: ++seq, args, resolve, reject };
        job = j;
        const w = getWorker();
        if (w) { mode = 'worker'; w.postMessage({ seq: j.seq, method, args }); return; }
        // Let the page paint its "working" state before blocking the main thread.
        setTimeout(() => { if (job === j) { job = null; runLocal(j); } }, 30);
      });
    }
    // Stop the running job (if any) and resolve its promise with `value`.
    function cancel(value) {
      if (!job) return false;
      const j = job;
      job = null;
      kill();
      j.resolve(value);
      return true;
    }
    return { run, cancel, mode: () => mode, busy: () => !!job };
  }

  window.PageUtils = { reduceMotion, csvCell, download, copyText, notice, confetti, createWorkerRunner };
})();
