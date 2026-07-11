// Magic 8-Ball — ask a yes/no question, shake the ball, reveal one of the 20
// classic answers. The answer is chosen up front with the fair RNG
// (randomIndex(EIGHTBALL_ANSWERS.length)); the shake is pure decoration steered
// to nothing. For entertainment only.
(function () {
  const form = document.querySelector('#eightball-form');
  const input = document.querySelector('#eightball-question');
  const button = document.querySelector('#eightball-ask');
  const ball = document.querySelector('#eightball');
  const answerEl = document.querySelector('#eightball-answer');
  const result = document.querySelector('#eightball-result');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let asking = false;

  function reveal(index) {
    const answer = EIGHTBALL_ANSWERS[index];
    answerEl.textContent = answer;
    ball.classList.add('has-answer');
    result.innerHTML = `The ball says: <span class="highlight">${answer}</span>`;
    asking = false;
    button.disabled = false;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (asking) return;

    // Gentle nudge for an empty question — still allow the ask (don't crash).
    if (input.value.trim() === '') {
      result.textContent = 'Think of a yes/no question, then ask again.';
    }

    // Fair outcome first, then the (purely cosmetic) shake.
    const outcome = randomIndex(EIGHTBALL_ANSWERS.length);

    // Clear the previous answer so the new one reads as a fresh reveal.
    answerEl.textContent = '';
    ball.classList.remove('has-answer');

    if (reduceMotion) {
      reveal(outcome);
      return;
    }

    asking = true;
    button.disabled = true;
    result.textContent = '';

    ball.classList.add('is-shaking');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      ball.classList.remove('is-shaking');
      ball.removeEventListener('animationend', done);
      reveal(outcome);
    };
    ball.addEventListener('animationend', done);
    // Fallback in case animationend doesn't fire (keeps the button usable).
    setTimeout(done, 1200);
  });
})();
