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
    input.className = 'form-control input-field-init';

    // Create a new `br` (line break) element
    const br = document.createElement('br');

    // Append the new `input` element to the form
    resultForm.append(label);
    resultForm.append(input);
    resultForm.append(br);

    // Increment the inputNumber variable
    inputNumber++;
});

async function queryBackendAPI() {
    // Get the values of the input fields

    var bodyText = '';
    for (var i = 1; i < inputNumber; i++) {
        var input = 'input' + i;
        let inputName = input;
        input = document.getElementById(input).value;
        bodyText += inputName + '=' + encodeURIComponent(input) + '&';
      }
  
    // Set the options for the HTTP request
    var options = {
      method: 'POST',
      body: bodyText,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };
  
    // Send the request and get the response
    var optResponse = await fetch(`http://localhost:8081/option`, options);
  
    // If the request is successful, parse the response and get the value
    if (optResponse.ok) {
      var optResult = await optResponse.json();
      var value = optResult.value;
      // Do something with the value, such as displaying it on the page
      document.getElementById('optResult').innerHTML = value;
    } else {
      // If the request is not successful, display an error message
      document.getElementById('optResult').innerHTML = 'An error occurred: ' + optResponse.status;
    }
  }