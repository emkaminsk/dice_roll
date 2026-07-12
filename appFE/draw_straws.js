// Draw Straws — a colourful bundle of straws in a cup. The short straw is chosen
// uniformly up front with randomIndex(n); pulling a straw only uncovers a decision
// already made, never derives it. Players pull straws one at a time until the short
// one turns up; "New round" reshuffles which straw is short (fair RNG again).
(function () {
  const bundle = document.querySelector('#straws-bundle');
  const countInput = document.querySelector('#straws-count');
  const newRoundBtn = document.querySelector('#straws-new');
  const result = document.querySelector('#straws-result');
  if (!bundle || !countInput) return;

  const MIN = 2;
  const MAX = 12;
  const DEFAULT = 4;
  const FULL_H = 150;   // px — a full-length straw (see .straws-* in style.css)
  const SHORT_H = 92;   // px — the unlucky short straw

  // Cosmetic straw colours, assigned by position — never the outcome.
  const COLORS = [
    '#ef4444', '#f59e0b', '#10b981', '#0ea5e9',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
    '#6366f1', '#84cc16', '#06b6d4', '#e11d48',
  ];

  let count = DEFAULT;
  let shortIndex = 0;
  let pulled = [];        // indices already pulled this round
  let roundOver = false;

  // Read and clamp the requested straw count; reflect the clamped value back.
  function clampCount() {
    let n = parseInt(countInput.value, 10);
    if (!Number.isFinite(n) || n < MIN) n = MIN;
    if (n > MAX) n = MAX;
    countInput.value = String(n);
    return n;
  }

  function newRound() {
    count = clampCount();
    shortIndex = randomIndex(count); // fair, decided before any reveal
    pulled = [];
    roundOver = false;
    render();
    result.textContent = 'Tap a straw to pull it.';
  }

  function render() {
    bundle.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const straw = document.createElement('button');
      straw.type = 'button';
      straw.className = 'straw';
      straw.dataset.index = String(i);
      straw.setAttribute('aria-label', `Pull straw ${i + 1} of ${count}`);

      const tag = document.createElement('span');
      tag.className = 'straw-tag';

      const body = document.createElement('span');
      body.className = 'straw-body';
      body.style.background = COLORS[i % COLORS.length];
      // The short straw really is shorter — pulling it just uncovers that.
      body.style.height = (i === shortIndex ? SHORT_H : FULL_H) + 'px';

      straw.appendChild(tag);
      straw.appendChild(body);
      straw.addEventListener('click', () => pull(i));
      bundle.appendChild(straw);
    }
  }

  function strawEl(i) {
    return bundle.querySelector('.straw[data-index="' + i + '"]');
  }

  function reveal(i, kind) {
    const el = strawEl(i);
    if (!el) return;
    el.classList.add('is-pulled', kind === 'short' ? 'is-short' : 'is-safe');
    el.disabled = true;
    el.querySelector('.straw-tag').textContent = kind === 'short' ? 'short!' : 'safe';
    if (pulled.indexOf(i) === -1) pulled.push(i);
  }

  function pull(i) {
    if (roundOver || pulled.indexOf(i) !== -1) return;

    if (i === shortIndex) {
      reveal(i, 'short');
      roundOver = true;
      result.innerHTML = 'You drew the <span class="highlight">short straw</span>!';
      // Reveal the rest so everyone can see the whole bundle.
      for (let j = 0; j < count; j++) {
        if (j !== shortIndex) reveal(j, 'safe');
      }
    } else {
      reveal(i, 'safe');
      const left = count - pulled.length;
      result.textContent = left > 1
        ? 'Safe! ' + left + ' straws still in the cup.'
        : 'Safe! The last straw is the unlucky one…';
    }
  }

  // Live re-render while the number is valid; clamp stray values on blur/change.
  countInput.addEventListener('input', function () {
    const raw = parseInt(countInput.value, 10);
    if (Number.isFinite(raw) && raw >= MIN && raw <= MAX) newRound();
  });
  countInput.addEventListener('change', newRound);
  newRoundBtn.addEventListener('click', newRound);

  newRound();
})();
