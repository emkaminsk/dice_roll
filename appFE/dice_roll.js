// Dice Roller — uniform roll in [1, N] computed in the browser (no back-end),
// with a tumbling-die animation that settles on the result.
(function () {
  const form = document.querySelector('form[name="Dice"]');
  const maxInput = document.querySelector('#max');
  const countInput = document.querySelector('#dice-count');
  const diceGraphics = document.querySelector('#dice-graphics');
  const result = document.querySelector('#result');
  const button = form.querySelector('button[type=submit]');

  // Spelled-out counts for the multi-die phrasing; falls back to the numeral.
  const NUMBER_WORDS = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten',
  ];
  function numberWord(n) {
    return NUMBER_WORDS[n] || String(n);
  }

  // Result phrasing: single die keeps the exact original wording (US-002 tests
  // rely on it); 2+ dice show the per-die breakdown plus the total.
  function resultHtml(rolls, sides) {
    if (rolls.length === 1) {
      return `You rolled <span class="highlight">${rolls[0]}</span> on a ${sides}-sided die.`;
    }
    const total = rolls.reduce((a, b) => a + b, 0);
    return `You rolled ${rolls.join(' + ')} = <span class="highlight">${total}</span>`
      + ` on ${numberWord(rolls.length)} ${sides}-sided dice.`;
  }

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

    // Number of dice; blank/invalid falls back to a single die.
    let count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) {
      count = 1;
      countInput.value = 1;
    }

    // Independent fair draws — one per die.
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(randomInt(1, sides));

    diceGraphics.innerHTML = '';
    const dice = [];
    for (let i = 0; i < count; i++) {
      const die = document.createElement('div');
      die.className = 'die';
      diceGraphics.appendChild(die);
      dice.push(die);
    }

    if (reduceMotion) {
      dice.forEach((die, i) => renderFace(die, rolls[i]));
      result.innerHTML = resultHtml(rolls, sides);
      return;
    }

    rolling = true;
    button.disabled = true;
    result.textContent = '';
    dice.forEach((die) => die.classList.add('rolling'));

    // Flicker through random faces while the dice tumble.
    const flick = setInterval(() => {
      dice.forEach((die) => renderFace(die, randomInt(1, 6)));
    }, 80);

    setTimeout(() => {
      clearInterval(flick);
      dice.forEach((die, i) => {
        die.classList.remove('rolling');
        renderFace(die, rolls[i]);
      });
      result.innerHTML = resultHtml(rolls, sides);
      rolling = false;
      button.disabled = false;
    }, 900);
  });
})();
