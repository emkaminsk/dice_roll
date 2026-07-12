// Coin Flip — fair heads/tails chosen up front (randomIndex(2)), then a CSS 3D
// flip is steered to land on the pre-chosen face. Tracks a session-only streak.
(function () {
  const button = document.querySelector('#coin-flip');
  const coin = document.querySelector('#coin');
  const tossWrap = document.querySelector('.coin-toss');
  const result = document.querySelector('#coin-result');
  const streakEl = document.querySelector('#coin-streak');

  const FACES = ['Heads', 'Tails']; // index 0 = heads, 1 = tails
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let flipping = false;
  let last = null;      // last outcome index, or null before the first flip
  let streak = 0;       // current run length of the same face
  let total = 0;        // total flips this session
  let turns = 0;        // accumulated half-turns applied to the coin

  // Point the coin at a face without animating (used for reduced motion / setup).
  function showFace(index) {
    // An even number of half-turns shows heads; odd shows tails.
    turns = index; // 0 -> heads, 1 -> tails, no spins
    coin.style.transition = 'none';
    coin.style.transform = `rotateY(${turns * 180}deg)`;
  }

  function updateStreak(index) {
    total += 1;
    if (index === last) {
      streak += 1;
    } else {
      streak = 1;
      last = index;
    }
    const face = FACES[index];
    streakEl.textContent = `${streak} ${face} in a row · ${total} flip${total === 1 ? '' : 's'} this session`;
  }

  function finish(index) {
    result.innerHTML = `<span class="highlight">${FACES[index]}!</span>`;
    updateStreak(index);
    if (tossWrap) tossWrap.classList.remove('is-tossing');
    flipping = false;
    button.disabled = false;
  }

  button.addEventListener('click', () => {
    if (flipping) return;

    // Fair outcome first, then steer the animation to it (never the reverse).
    const outcome = randomIndex(2);

    if (reduceMotion) {
      showFace(outcome);
      finish(outcome);
      return;
    }

    flipping = true;
    button.disabled = true;
    result.textContent = '';
    if (tossWrap) {
      // Restart the toss arc even if a previous one somehow left a class behind.
      tossWrap.classList.remove('is-tossing');
      void tossWrap.offsetWidth;
      tossWrap.classList.add('is-tossing');
    }

    // Land on a half-turn count of the right parity: several full spins
    // (even multiples of 180deg) plus 0/1 half-turn for heads/tails.
    const spins = 5 + randomIndex(3); // 5-7 full rotations
    turns = turns + spins * 2; // full rotations keep current parity...
    // ...then adjust the final parity to match the chosen face.
    if (turns % 2 !== outcome) turns += 1;

    coin.style.transition = 'transform 1.4s cubic-bezier(0.33, 0.0, 0.15, 1)';
    // Reflow so the transition picks up the new transform.
    void coin.offsetWidth;
    coin.style.transform = `rotateY(${turns * 180}deg)`;

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      coin.removeEventListener('transitionend', done);
      finish(outcome);
    };
    coin.addEventListener('transitionend', done);
    // Fallback in case transitionend doesn't fire (keeps the button usable).
    setTimeout(done, 1700);
  });

  // Start showing heads.
  showFace(0);
})();
