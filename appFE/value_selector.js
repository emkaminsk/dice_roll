const resultForm = document.querySelector('form[name="Inputs"]');
const inputForm = document.querySelector('form[name="inputButtons"]');
const addFieldButton = inputForm.querySelector('#add-field');
const addDrawButton = inputForm.querySelector('#btnDraw');

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

addDrawButton.addEventListener('click', function(event) {
  event.preventDefault();
  // rest of the code for selecting a random input value
});

addDrawButton.onclick = async () => {
  console.log("Calling the API function...");

  addDrawButton.classList.remove('btn-primary');
  addDrawButton.classList.add('btn-secondary');

  await queryBackendAPI();
};

async function queryBackendAPI() {
    // Get the values of the input fields
    console.log("Starting preparing API POST options...");
    var bodyText = {};
    for (var i = 1; i < inputNumber; i++) {
        var input = 'input' + i;
        let inputName = input;
        input = document.getElementById(input).value ;
        bodyText[inputName] = input;
      }
  
    // Set the options for the HTTP request
    console.dir("The bodyText is: " + bodyText);
    var options = {
      method: 'POST',
      body: JSON.stringify(bodyText),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  
    // Send the request and get the response
    console.log("The options are " + JSON.stringify(options));
    try {
      console.log("Sending API POST request...");
      var optResponse = await fetch(`http://localhost:8081/draw`, options);
    
      // If the request is successful, parse the response and get the value
      console.log("Processing API POST response...");
      if (optResponse.ok) {
        var optResult = await optResponse.json();
        var value = optResult.optResult;

        // Do something with the value, such as displaying it on the page
        var resultElement = document.getElementById('optResult');
        if (value !== '') {
          resultElement.innerHTML = 'The result is: <span class="highlight">' + value + '</span>';
        } else {
          resultElement.innerHTML = 'There has been no drawing yet';
        }
      } else {
        // If the request is not successful, display an error message
        document.getElementById('optResult').innerHTML = 'An error occurred: ' + optResponse.status;
      }
    } catch (error) {
      // If an error occurs, display an error message
      console.error(error);
    }
    addDrawButton.classList.remove('btn-secondary');
    addDrawButton.classList.add('btn-primary');
  }