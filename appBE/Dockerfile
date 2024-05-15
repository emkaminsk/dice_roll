FROM python:3.8
# FROM python:3.8-bullseye

RUN mkdir -p /home/app

# set default dir so that next commands executes in /home/app dir
WORKDIR /home/app

# dependencies
COPY . .
EXPOSE 8081
# no need for /home/app/ because of WORKDIR
CMD ["python", "dice.py"]
