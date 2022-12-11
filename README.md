## Dice Roll API

This is a simple dice roll API that allows you to roll a dice using a JavaScript front-end and a Python back-end.

# How to run it

First clone this repository:

```git clone https://github.com/emkaminsk/dice_roll.git```

Navigate to the folder. Make sure you have Docker installed and working.
This application is available as Docker images on Docker Hub. To pull the images and run it, just use the following commands:

```docker-compose up```

Now in your browser go to this page:
```http://localhost:8000/```
and roll the dice!

# Front-end

The front-end of the application is a simple HTML page that uses JavaScript to make a request to the back-end API. The JavaScript code is in the index.html file, and it uses the fetch API to make a GET request to the back-end API.

# Back-end

The back-end of the application is a Python script that uses the http.server library to serve the API. The Python code is in the dice.py file, and it defines a DiceRollRequestHandler class that extends the BaseHTTPRequestHandler class from the http.server library. The DiceRollRequestHandler class implements a do_GET method that handles incoming GET requests and returns a JSON response with the dice roll result.

# Docker

Once the container is running, you can access the front-end by visiting http://localhost:8000/ in your web browser. If you wish you can access the back-end API separately by making a GET request to http://localhost:8081/dice-roll/?max=6, where 6 is the maximum value of the dice roll.

Both images are built using slim base - ca 124MB.

# License

This project is licensed under the MIT License. 