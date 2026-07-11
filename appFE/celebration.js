// Winner celebration — full-screen overlay + confetti burst, dependency-free.
// Exposes window.Celebration.show(name) / .hide(). The winner is chosen by the
// caller's fair RNG (see wheel.js); everything here is cosmetic, so Math.random()
// is fine for the confetti jitter. Respects prefers-reduced-motion.
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CONFETTI_COLORS = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  ];
  const AUTO_DISMISS_MS = 4200;

  let overlay = null;
  let nameEl = null;
  let canvas = null;
  let ctx = null;
  let particles = [];
  let rafId = null;
  let autoTimer = null;
  let lastFrame = 0;

  // Build the overlay once and reuse it across spins.
  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'celebration-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.hidden = true;

    canvas = document.createElement('canvas');
    canvas.className = 'celebration-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');

    const card = document.createElement('div');
    card.className = 'celebration-card';

    const label = document.createElement('div');
    label.className = 'celebration-label';
    label.textContent = 'Winner';

    nameEl = document.createElement('div');
    nameEl.className = 'celebration-name';

    const hint = document.createElement('div');
    hint.className = 'celebration-hint';
    hint.textContent = 'Tap anywhere to dismiss';

    card.appendChild(label);
    card.appendChild(nameEl);
    card.appendChild(hint);
    overlay.appendChild(canvas);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', hide);
  }

  function sizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawnParticles() {
    particles = [];
    const count = Math.min(180, Math.floor(window.innerWidth / 4) + 60);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: window.innerWidth / 2 + (Math.random() - 0.5) * 240,
        y: window.innerHeight / 2 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 12,
        vy: Math.random() * -12 - 4,
        size: Math.random() * 8 + 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  function step(now) {
    const dt = lastFrame ? Math.min((now - lastFrame) / 16.67, 3) : 1;
    lastFrame = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = 0;
    for (const p of particles) {
      p.vy += 0.35 * dt;          // gravity
      p.vx *= Math.pow(0.99, dt); // drag
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y < canvas.height + 20) alive++;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }

    if (alive > 0 && overlay && !overlay.hidden) {
      rafId = requestAnimationFrame(step);
    } else {
      stopConfetti();
    }
  }

  function stopConfetti() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastFrame = 0;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function show(name) {
    ensureOverlay();
    hide(); // clear any previous celebration so repeat spins stay clean

    nameEl.textContent = name;
    overlay.hidden = false;
    // Force reflow so the enter animation replays on repeat spins.
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');

    if (!reduceMotion) {
      sizeCanvas();
      spawnParticles();
      lastFrame = 0;
      rafId = requestAnimationFrame(step);
    }

    autoTimer = window.setTimeout(hide, AUTO_DISMISS_MS);
  }

  function hide() {
    if (autoTimer) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
    stopConfetti();
    if (overlay) {
      overlay.classList.remove('is-visible');
      overlay.hidden = true;
    }
  }

  window.Celebration = { show, hide };
})();
