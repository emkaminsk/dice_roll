from http.server import BaseHTTPRequestHandler, HTTPServer
from random import randint
from urllib.parse import parse_qs, urlparse
import json

class DiceRollRequestHandler(BaseHTTPRequestHandler):
  def do_GET(self):
    # parse the query string from the URL
    query_string = parse_qs(urlparse(self.path).query)
    max = int(query_string.get('max', [6])[0])

    # generate a random integer in the range 1 to max
    roll = randint(1, max)

    # create the response data
    response_data = {
        'max': max,
        'rolls': [roll],
        'total': roll,
        'add_info': "Docker"
    }

    # send a JSON response with the dice roll result
    self.send_response(200)

    # add the appropriate CORS headers
    self.send_header('Access-Control-Allow-Origin', '*')
    self.send_header('Access-Control-Allow-Methods', 'GET')
    self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    self.send_header('Content-type', 'application/json')
    self.end_headers()
    self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))


class OptionsRequestHandler(BaseHTTPRequestHandler):
  def do_POST(self):
    # read the data from the request body
    length = int(self.headers.get('Content-Length'))
    body = self.rfile.read(length)

    # parse the options data from the request body
    options = json.loads(body.decode())

    # process the options data as needed
    # TODO

    # create the response data
    response_data = {
        'success': True,
        'optResult': optResult
    }

    # send a JSON response with the options data
    self.send_response(200)

    # add the appropriate CORS headers
    self.send_header('Access-Control-Allow-Origin', '*')
    self.send_header('Access-Control-Allow-Methods', 'POST')
    self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    self.send_header('Content-type', 'application/json')
    self.end_headers()
    self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))

httpd = HTTPServer(('0.0.0.0', 8081), DiceRollRequestHandler)
# httpd.server_address('/options', OptionsRequestHandler)

# start the server
print("Listening on port", httpd.server_port)
httpd.serve_forever()
