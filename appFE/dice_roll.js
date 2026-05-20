// Dice Roller — uniform roll in [1, N] computed in the browser (no back-end).
(function () {
  const form = document.querySelector('form[name="Dice"]');
  const maxInput = document.querySelector('#max');
  const diceGraphics = document.querySelector('#dice-graphics');
  const result = document.querySelector('#result');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

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
    die.textContent = roll;
    diceGraphics.appendChild(die);

    result.innerHTML = `You rolled <span class="highlight">${roll}</span> on a ${sides}-sided die.`;
  });
})();
