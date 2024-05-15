FROM python:3.8

RUN mkdir -p /home/app

# set default dir so that next commands executes in /home/app dir
WORKDIR /home/app

# dependencies
COPY . .

# no need for /home/app/ because of WORKDIR
CMD ["python", "-m", "http.server", "8000", "-d", "."]
