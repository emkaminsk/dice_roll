const form = document.querySelector('form[name="Dice"]');
const diceGraphics = document.querySelector('#dice-graphics');
const diceButton = document.querySelector('#rollDice');
const result = document.querySelector('#result');

// handle form submission
form.addEventListener('click', (event) => {
  if (event.target === diceButton) {
    event.preventDefault();
    diceButton.classList.remove('btn-primary');
    diceButton.classList.add('btn-secondary');
    // get the max value from the form input
    const max = document.querySelector('#max').value;

    // send the max value to the backend using a REST API
    // and display the result
    fetch(`http://localhost:8081/dice-roll/?max=${max}`)
      .then((response) => response.json())
      .then((data) => {
        diceGraphics.innerHTML = ''; // clear previous dice graphics

        // show the rolled dice
        for (const roll of data.rolls) {
          const dice = document.createElement('div');
          dice.classList.add('dice');
          dice.textContent = roll;
          diceGraphics.appendChild(dice);
        }

        // show the result message
        result.innerHTML = `You rolled a total of <span class="highlight"> ${data.total} </span>.`;
      })
      diceButton.classList.remove('btn-secondary');
      diceButton.classList.add('btn-primary');
    };
  });
