const form = document.querySelector('form');
const diceGraphics = document.querySelector('#dice-graphics');
const result = document.querySelector('#result');

// handle form submission
form.addEventListener('submit', (event) => {
  event.preventDefault();

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

        // add styles for the dice graphics
        dice.style.display = 'inline-block';
        dice.style.border = '1px solid black';
        dice.style.borderRadius = '5px';
        dice.style.padding = '10px';
        dice.style.margin = '0 5px';

        diceGraphics.appendChild(dice);
      }

      // show the result message
      result.textContent = `You rolled a total of ${data.total}.`;
    });
});
