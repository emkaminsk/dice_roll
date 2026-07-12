// Lucky Numbers — draw k unique numbers from 1..N, ball-machine style.
// The k numbers are chosen uniformly over all k-combinations via a partial
// Fisher–Yates shuffle of the 1..N pool driven by randomInt (fair RNG), then
// sorted ascending for the usual lottery display. The reveal only uncovers a
// draw already decided; it never derives the outcome from the animation.
(function () {
  const kInput = document.querySelector('#lotto-k');
  const nInput = document.querySelector('#lotto-n');
  const preset = document.querySelector('#lotto-preset');
  const drawBtn = document.querySelector('#lotto-draw');
  const balls = document.querySelector('#lotto-balls');
  const result = document.querySelector('#lotto-result');
  if (!kInput || !nInput || !drawBtn || !balls || !result) return;

  const STAGGER = 200;   // ms between balls dropping (ball-machine feel)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let drawing = false;
  let timers = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // Uniform k-combination from {1..n}: partial Fisher–Yates over the pool,
  // taking the first k after k fair swaps. Sorted ascending for display.
  function drawNumbers(k, n) {
    const pool = [];
    for (let i = 1; i <= n; i++) pool.push(i);
    for (let i = 0; i < k; i++) {
      const j = randomInt(i, n - 1);     // fair pick from the unshuffled tail
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, k).sort((a, b) => a - b);
  }

  function makeBall(value) {
    const ball = document.createElement('span');
    ball.className = 'lotto-ball';
    ball.textContent = String(value);
    return ball;
  }

  // Validate k and N; return {k, n} or an error message to guide the user.
  function validate() {
    const kRaw = kInput.value.trim();
    const nRaw = nInput.value.trim();
    if (kRaw === '' || nRaw === '') {
      return { error: 'Enter how many numbers to draw and the range to draw from.' };
    }
    const k = parseInt(kRaw, 10);
    const n = parseInt(nRaw, 10);
    if (!Number.isFinite(k) || !Number.isFinite(n)) {
      return { error: 'Please enter whole numbers.' };
    }
    if (n < 1) return { error: 'The range must go up to at least 1.' };
    if (k < 1) return { error: 'Draw at least one number.' };
    if (k > n) {
      return { error: `Can't draw ${k} unique numbers from just ${n} — lower "How many" or raise the range.` };
    }
    return { k, n };
  }

  function draw() {
    if (drawing) return;
    clearTimers();

    const v = validate();
    if (v.error) {
      balls.innerHTML = '';
      result.textContent = v.error;
      return;
    }

    const numbers = drawNumbers(v.k, v.n);
    balls.innerHTML = '';

    if (reduceMotion) {
      numbers.forEach((num) => {
        const ball = makeBall(num);
        ball.classList.add('is-shown');
        balls.appendChild(ball);
      });
      result.textContent = 'Your lucky numbers: ' + numbers.join(' · ');
      return;
    }

    drawing = true;
    drawBtn.disabled = true;
    result.textContent = 'Drawing…';

    numbers.forEach((num, i) => {
      const t = setTimeout(() => {
        const ball = makeBall(num);
        balls.appendChild(ball);
        // Next frame so the pop-in transition actually plays.
        requestAnimationFrame(() => ball.classList.add('is-shown'));
        if (i === numbers.length - 1) {
          result.textContent = 'Your lucky numbers: ' + numbers.join(' · ');
          drawing = false;
          drawBtn.disabled = false;
        }
      }, i * STAGGER);
      timers.push(t);
    });
  }

  // Selecting a preset fills the k and N inputs; "Custom" leaves them as-is.
  preset.addEventListener('change', function () {
    const val = preset.value;
    if (val === 'custom') return;
    const parts = val.split(':');
    kInput.value = parts[0];
    nInput.value = parts[1];
  });

  // Editing the inputs directly means the numbers no longer match a preset.
  function markCustom() {
    if (preset.value !== 'custom') preset.value = 'custom';
  }
  kInput.addEventListener('input', markCustom);
  nInput.addEventListener('input', markCustom);

  drawBtn.addEventListener('click', draw);
})();
