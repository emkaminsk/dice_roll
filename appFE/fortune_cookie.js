// Fortune Cookie — crack open an animated cookie to reveal a fortune plus six
// "lucky numbers". Both outcomes are decided up front with the fair RNG: the
// fortune via randomIndex(FORTUNES.length), the numbers via a partial
// Fisher–Yates over 1..69 driven by randomInt. The crack animation is pure
// decoration steered to nothing. For entertainment only.
(function () {
  const button = document.querySelector('#cookie-crack');
  const cookie = document.querySelector('#cookie');
  const slip = document.querySelector('#cookie-slip');
  const result = document.querySelector('#cookie-result');
  const numbersEl = document.querySelector('#cookie-numbers');
  if (!button || !cookie || !slip || !result || !numbersEl) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CRACK_MS = 1000;   // matches the .cookie-half transition duration

  let cracking = false;

  // Six unique numbers from 1..69: a partial Fisher–Yates over the pool driven
  // by the fair RNG, then sorted ascending for display (no biased loops).
  function luckyNumbers() {
    const n = 69;
    const k = 6;
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

  function renderNumbers(numbers) {
    numbersEl.innerHTML = '';
    numbers.forEach((num) => {
      const chip = document.createElement('span');
      chip.className = 'cookie-num';
      chip.textContent = String(num);
      numbersEl.appendChild(chip);
    });
  }

  function reveal(fortune, numbers) {
    result.textContent = fortune;
    renderNumbers(numbers);
    slip.hidden = false;
    // Next frame so the slip's fade/slide transition actually plays.
    requestAnimationFrame(() => slip.classList.add('is-shown'));
    cracking = false;
    button.disabled = false;
    button.textContent = 'Crack another';
  }

  function crack() {
    if (cracking) return;

    // Fair outcomes first, then the (purely cosmetic) crack.
    const fortune = FORTUNES[randomIndex(FORTUNES.length)];
    const numbers = luckyNumbers();

    // Reset any previous reveal so this reads as a fresh crack.
    slip.classList.remove('is-shown');
    slip.hidden = true;
    cookie.classList.remove('is-cracked');
    // Force reflow so re-adding is-cracked restarts the split animation.
    void cookie.offsetWidth;

    if (reduceMotion) {
      cookie.classList.add('is-cracked');
      reveal(fortune, numbers);
      return;
    }

    cracking = true;
    button.disabled = true;
    cookie.classList.add('is-cracked');
    setTimeout(() => reveal(fortune, numbers), CRACK_MS);
  }

  button.addEventListener('click', crack);
})();
