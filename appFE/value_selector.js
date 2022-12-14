const resultForm = document.querySelector('form[name="Inputs"]');
const inputForm = document.querySelector('form[name="inputButtons"]');
const addFieldButton = inputForm.querySelector('#add-field');

let inputNumber = 3;

addFieldButton.addEventListener('click', function() {
    // Create a new `label` element
    const label = document.createElement('label');

    // Set the `for` and `innerHTML` attributes for the element
    label.htmlFor = 'input' + inputNumber;
    label.innerHTML = 'Input ' + inputNumber + ':';

    // Create a new `input` element
    const input = document.createElement('input');

    // Set the `type`, `id` and `name` attributes for the element
    input.type = 'text';
    input.id = 'input' + inputNumber;
    input.name = 'input' + inputNumber;
    input.className = 'input-field';

    // Create a new `br` (line break) element
    const br = document.createElement('br');

    // Append the new `input` element to the form
    resultForm.append(label);
    resultForm.append(input);
    resultForm.append(br);

    // Increment the inputNumber variable
    inputNumber++;
});

