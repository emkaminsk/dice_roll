# Dice Roll app

This is a simple dice roll app that allows you to roll a dice using a JavaScript front-end and a Python back-end.

## How to run it

This application is available as Docker images on Docker Hub. You can run it using Docker Compose. To do so, follow these steps:

1. Make sure you have [Docker installed](https://docs.docker.com/get-docker/) and working.
2. On Windows open Command Prompt or BusyBox. On Linux or Mac open a terminal.
3. Navigate to any folder you choose. 
4. Run the following command to download the docker-compose.yaml file:

```curl -Lo docker-compose.yaml https://github.com/emkaminsk/dice_roll/raw/master/docker-compose.yaml```

5. To pull the images and run them, just use the following command:

```docker-compose up```

Now in your browser go to this page:
```http://localhost:8000/```
and roll the dice!

## How to build it yourself

Instead of pulling the images from Docker Hub, you can build them yourself. To do so, follow these steps:

1. Clone the Git repository into any folder you choose:

```git clone https://github.com/emkaminsk/dice_roll.git```

2. Run the following command to build the images:

```docker build -t my_ver/dice_fe .\appFE```

```docker build -t my_ver/dice_be .\appBE```

3. In the docker-compose.yaml file, replace the image names with your own:

```image: my_ver/dice_fe```

```image: my_ver/dice_be```

4. Run the following command to pull start the containers:

```docker-compose up```

## Front-end

The front-end of the application is a simple HTML page that uses JavaScript to make a request to the back-end API. The JavaScript code is in the index.html file, and it uses the fetch API to make a GET request to the back-end API.

## Back-end

The back-end of the application is a Python script that uses the http.server library to serve the API. The Python code is in the dice.py file, and it defines a DiceRollRequestHandler class that extends the BaseHTTPRequestHandler class from the http.server library. The DiceRollRequestHandler class implements a do_GET method that handles incoming GET requests and returns a JSON response with the dice roll result.

## Docker

Once the container is running, you can access the front-end by visiting http://localhost:8000/ in your web browser. If you wish you can access the back-end API separately by making a GET request to http://localhost:8081/dice-roll/?max=6, where 6 is the maximum value of the dice roll.

Both images are built using slim base - ca 124MB.

## License

This project is licensed under the MIT License. 