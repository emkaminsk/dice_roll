#!/bin/bash

docker container prune -f --filter "name=dice"
docker rmi $(docker images --filter "name=dice" -q)

docker rmi emkaminsk/dice_fe
docker rmi emkaminsk/dice_be

docker pull python:3.8-slim
docker build -t emkaminsk/dice_fe ./appFE
docker build -t emkaminsk/dice_be ./appBE

docker push emkaminsk/dice_fe
docker push emkaminsk/dice_be
