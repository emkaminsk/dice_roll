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

  // Render one cube face: pips for 1-6, otherwise a centered number.
  function renderPips(face, value) {
    face.innerHTML = '';
    if (value >= 1 && value <= 6) {
      face.classList.remove('die-number');
      for (let i = 0; i < 9; i++) {
        const cell = document.createElement('span');
        cell.className = 'die-cell';
        if (PIPS[value].includes(i)) {
          const pip = document.createElement('span');
          pip.className = 'pip';
          cell.appendChild(pip);
        }
        face.appendChild(cell);
      }
    } else {
      face.classList.add('die-number');
      face.textContent = value;
    }
  }

  // Build a full 6-face cube (front/back/left/right/top/bottom) so the die
  // always has real volume facing the camera and never goes edge-on/invisible
  // mid-tumble, unlike a single flat face. Only the front (and, for a 1-6
  // pip face, its complementary back) ever change — the other four sides are
  // filled once with fixed decorative pips purely so the cube reads as a
  // real die from any angle; they never affect the announced result.
  function buildDie() {
    const wrap = document.createElement('div');
    wrap.className = 'die';
    const cube = document.createElement('div');
    cube.className = 'die-cube';
    ['front', 'back', 'right', 'left', 'top', 'bottom'].forEach((pos) => {
      const face = document.createElement('div');
      face.className = 'die-face die-' + pos;
      cube.appendChild(face);
    });
    wrap.appendChild(cube);
    renderPips(cube.querySelector('.die-top'), 2);
    renderPips(cube.querySelector('.die-bottom'), 5);
    renderPips(cube.querySelector('.die-right'), 3);
    renderPips(cube.querySelector('.die-left'), 4);
    return wrap;
  }

  // Show `value` on a die's front face (the one the result text refers to),
  // keeping the back face as its real-die complement (opposite faces sum to
  // 7) when the value is a normal 1-6 pip face.
  function renderFace(dieWrap, value) {
    const front = dieWrap.querySelector('.die-front');
    const back = dieWrap.querySelector('.die-back');
    renderPips(front, value);
    if (value >= 1 && value <= 6) {
      renderPips(back, 7 - value);
    } else {
      back.innerHTML = '';
      back.classList.remove('die-number');
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
      const die = buildDie();
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
