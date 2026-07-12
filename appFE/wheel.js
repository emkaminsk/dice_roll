// Wheel of Fortune — canvas + requestAnimationFrame, client-side selection (FR-014..022).
(function () {
  const canvas = document.querySelector('#wheel-canvas');
  const ctx = canvas.getContext('2d');
  const namesInput = document.querySelector('#wheel-names');
  const spinBtn = document.querySelector('#wheel-spin');
  const resultEl = document.querySelector('#wheel-result');
  const pointerEl = document.querySelector('.wheel-pointer');

  // Clean, modern segment palette (cycled).
  const PALETTE = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  ];

  const SIZE = 320;
  const CENTER = SIZE / 2;
  const RADIUS = CENTER - 8;

  // Label sizing. Each label starts at LABEL_BASE_PX and shrinks (per entry,
  // independently) toward LABEL_MIN_PX when it doesn't fit its segment.
  const LABEL_BASE_PX = 28;
  const LABEL_MIN_PX = 12;
  const HUB_RADIUS = 18;
  const LABEL_PAD = 6;        // gap kept between text and hub
  const LABEL_ANCHOR = 14;    // right-align offset from the rim
  const ANGLE_FILL = 0.8;     // fraction of a wedge's height a label may use

  function setLabelFont(size) {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
  }

  // Choose a font size for `text` that fits within `maxWidth` (radial length)
  // and `maxHeight` (the wedge's angular thickness). Returns the chosen size;
  // leaves ctx.font set to it.
  function fitLabelFont(text, maxWidth, maxHeight) {
    let size = Math.min(LABEL_BASE_PX, maxHeight);
    setLabelFont(size);
    const w = ctx.measureText(text).width;
    if (w > maxWidth) {
      size = Math.max(LABEL_MIN_PX, Math.floor(size * (maxWidth / w)));
      size = Math.min(size, maxHeight); // never exceed the angular clamp
      setLabelFont(size);
    }
    return size;
  }

  // Trim with an ellipsis only when the text still overflows at its smallest
  // allowed font — a last resort after shrinking.
  function ellipsize(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
      s = s.slice(0, -1);
    }
    return s + '…';
  }

  const TWO_PI = Math.PI * 2;
  let angle = 0;          // current rotation, radians
  let spinning = false;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Gentle ambient counter-clockwise drift so the wheel is always turning at
  // rest (an "attract" motion). Purely cosmetic; paused while a real spin runs
  // and briefly after one lands so the winner stays under the pointer. Disabled
  // entirely for reduced-motion and while the tab is hidden.
  const IDLE_SPEED = 0.22;   // radians per second, counter-clockwise
  let idlePausedUntil = 0;
  let lastIdle = 0;

  // localStorage persistence — a convenience only. All access is guarded so the
  // wheel works fully when storage is unavailable/disabled (private mode, etc.).
  const STORAGE_KEY = 'wheel-names';

  function loadSavedNames() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      // Only restore a non-empty saved roster; otherwise keep the seed names.
      return saved && saved.trim() !== '' ? saved : null;
    } catch (e) {
      return null;
    }
  }

  function saveNames() {
    try {
      window.localStorage.setItem(STORAGE_KEY, namesInput.value);
    } catch (e) {
      /* storage unavailable — ignore, never block the wheel */
    }
  }

  function names() {
    return namesInput.value
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }

  function draw() {
    const list = names();
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (list.length === 0) {
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Add names to spin', CENTER, CENTER);
    } else {
      const seg = (Math.PI * 2) / list.length;
      list.forEach((name, i) => {
        const start = angle + i * seg;
        ctx.beginPath();
        ctx.moveTo(CENTER, CENTER);
        ctx.arc(CENTER, CENTER, RADIUS, start, start + seg);
        ctx.closePath();
        ctx.fillStyle = PALETTE[i % PALETTE.length];
        ctx.fill();

        // Label — auto-fit this entry's font to its own segment.
        ctx.save();
        ctx.translate(CENTER, CENTER);
        ctx.rotate(start + seg / 2);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const maxWidth = (RADIUS - LABEL_ANCHOR) - HUB_RADIUS - LABEL_PAD;
        // Wedge thickness (chord) at the text band's mid radius, padded.
        const midRadius = (HUB_RADIUS + LABEL_PAD + (RADIUS - LABEL_ANCHOR)) / 2;
        const maxHeight = ANGLE_FILL * 2 * midRadius * Math.sin(seg / 2);

        fitLabelFont(name, maxWidth, maxHeight);
        const label = ellipsize(name, maxWidth);
        ctx.fillText(label, RADIUS - LABEL_ANCHOR, 0);
        ctx.restore();
      });
    }

    // Hub
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, HUB_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    updateSpinState(list);
  }

  function updateSpinState(list) {
    const enough = list.length >= 2;
    spinBtn.disabled = spinning || !enough;
    if (!spinning) {
      spinBtn.textContent = enough ? 'Spin' : 'Add at least 2 names';
    }
  }

  function spin() {
    const list = names();
    if (list.length < 2 || spinning) return; // FR-021

    spinning = true;
    resultEl.textContent = '';
    if (window.Celebration) window.Celebration.hide();
    updateSpinState(list);

    const seg = (Math.PI * 2) / list.length;
    // Pick the winner uniformly first, independent of visual start (FR-022).
    const winner = randomIndex(list.length);

    // The pointer sits at the top (-PI/2). Resting angle (mod 2π) that puts the
    // winner's segment center under the pointer.
    const pointer = -Math.PI / 2;
    const segCenter = winner * seg + seg / 2;
    const restMod = pointer - segCenter;
    // Spin counter-clockwise (decreasing angle) at least three full turns, then
    // land exactly on the fairly-chosen winner. Direction/turns are cosmetic —
    // the winner is already decided above.
    const minTurns = 3 + randomIndex(3); // always >= 3 full rotations
    let target = restMod;
    while (target > angle - minTurns * TWO_PI) target -= TWO_PI;

    if (reduceMotion) {
      // Still land on the same fairly-chosen winner — just skip the tumble.
      angle = target;
      draw();
      spinning = false;
      updateSpinState(names());
      resultEl.innerHTML = `Winner: <span class="highlight">${escapeHtml(list[winner])}</span>`;
      if (window.Celebration) window.Celebration.show(list[winner]);
      return;
    }

    const start = angle;
    const delta = target - start;
    const duration = 4000; // within the 3-6 s target (SM-005)
    const t0 = performance.now();

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    if (pointerEl) pointerEl.classList.add('is-spinning');

    function frame(now) {
      const t = Math.min((now - t0) / duration, 1);
      angle = start + delta * easeOutCubic(t);
      draw();
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        spinning = false;
        if (pointerEl) pointerEl.classList.remove('is-spinning');
        // Hold the winner under the pointer before the idle drift resumes.
        idlePausedUntil = performance.now() + 2500;
        updateSpinState(names());
        resultEl.innerHTML = `Winner: <span class="highlight">${escapeHtml(list[winner])}</span>`;
        if (window.Celebration) window.Celebration.show(list[winner]);
      }
    }
    requestAnimationFrame(frame);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  canvas.width = SIZE;
  canvas.height = SIZE;
  // Restore a previously saved roster if one exists; otherwise seed with defaults.
  namesInput.value = loadSavedNames() || 'Alice\nBob';
  namesInput.addEventListener('input', () => {
    saveNames();
    draw();
  });
  spinBtn.addEventListener('click', spin);
  draw();

  // Ambient counter-clockwise idle drift (attract motion).
  function idleTick(now) {
    requestAnimationFrame(idleTick);
    if (spinning || now < idlePausedUntil || document.hidden) {
      lastIdle = now;
      return;
    }
    if (!lastIdle) { lastIdle = now; return; }
    const dt = (now - lastIdle) / 1000;
    lastIdle = now;
    angle -= IDLE_SPEED * dt;            // counter-clockwise
    if (angle <= -TWO_PI) angle += TWO_PI; // keep bounded
    draw();
  }
  if (!reduceMotion) requestAnimationFrame(idleTick);
})();
