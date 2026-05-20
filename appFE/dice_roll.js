// Dice Roller — uniform roll in [1, N] computed in the browser (no back-end),
// with a tumbling-die animation that settles on the result.
(function () {
  const form = document.querySelector('form[name="Dice"]');
  const maxInput = document.querySelector('#max');
  const diceGraphics = document.querySelector('#dice-graphics');
  const result = document.querySelector('#result');
  const button = form.querySelector('button[type=submit]');

  // Pip layout per face value, as indices into a 3x3 grid (0..8):
  //   0 1 2
  //   3 4 5
  //   6 7 8
  const PIPS = {
    1: [4],
    2: [2, 6],
    3: [2, 4, 6],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let rolling = false;

  // Render a face into the given die element: pips for 1-6, otherwise the number.
  function renderFace(die, value) {
    die.innerHTML = '';
    if (value >= 1 && value <= 6) {
      die.classList.remove('die-number');
      for (let i = 0; i < 9; i++) {
        const cell = document.createElement('span');
        cell.className = 'die-cell';
        if (PIPS[value].includes(i)) {
          const pip = document.createElement('span');
          pip.className = 'pip';
          cell.appendChild(pip);
        }
        die.appendChild(cell);
      }
    } else {
      die.classList.add('die-number');
      die.textContent = value;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (rolling) return;

    // Clamp to a sane number of sides; fall back to the default of 6 (US-002).
    let sides = parseInt(maxInput.value, 10);
    if (!Number.isFinite(sides) || sides < 1) {
      sides = 6;
      maxInput.value = 6;
    }

    const roll = randomInt(1, sides);

    diceGraphics.innerHTML = '';
    const die = document.createElement('div');
    die.className = 'die';
    diceGraphics.appendChild(die);

    if (reduceMotion) {
      renderFace(die, roll);
      result.innerHTML = `You rolled <span class="highlight">${roll}</span> on a ${sides}-sided die.`;
      return;
    }

    rolling = true;
    button.disabled = true;
    result.textContent = '';
    die.classList.add('rolling');

    // Flicker through random faces while the die tumbles.
    const flick = setInterval(() => renderFace(die, randomInt(1, 6)), 80);

    setTimeout(() => {
      clearInterval(flick);
      die.classList.remove('rolling');
      renderFace(die, roll);
      result.innerHTML = `You rolled <span class="highlight">${roll}</span> on a ${sides}-sided die.`;
      rolling = false;
      button.disabled = false;
    }, 900);
  });
})();
