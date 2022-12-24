from http.server import BaseHTTPRequestHandler, HTTPServer
from random import randint
from urllib.parse import parse_qs, urlparse
import json

# class DiceRollRequestHandler(BaseHTTPRequestHandler):
  


class OptionsRequestHandler(BaseHTTPRequestHandler):
  def do_GET(self):
    # parse the query string from the URL
    query_string = parse_qs(urlparse(self.path).query)
    varMax = int(query_string.get('max', [6])[0])

    # generate a random integer in the range 1 to max
    roll = randint(1, varMax)

    # create the response data
    response_data = {
        'max': varMax,
        'rolls': [roll],
        'total': roll,
        'add_info': "Docker"
    }

    self = headers(self)

    self.send_header('Content-type', 'application/json')
    self.end_headers()
    self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))

  def do_OPTIONS(self):
    print(f"Received request in do_OPTIONS")
    
    self = headers(self)
    
    self.end_headers()
    self.wfile.write(b'')
    print("Quitting OPTIONS request")

  def do_POST(self):
    print("Received POST request")
    # read the data from the request body
    length = int(self.headers.get('Content-Length'))
    body = self.rfile.read(length)

    # parse the options data from the request body
    options = json.loads(body.decode())
    print(f"The options are {options}")
    # process the options data as needed
    roll = randint(1, len(options.values()))
    print(options, '\n', options.values(), '\n', list(options.values()), '\n', len(options.values()), '\n', roll)
    optResult = list(options.values())[roll-1]

    # create the response data
    response_data = {
        'success': True,
        'optResult': optResult
    }

    print(response_data)
    self = headers(self)

    self.send_header('Content-type', 'application/json')
    self.end_headers()
    self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))

def headers(self):
    
  # send a JSON response with the options data
  self.send_response(200)

  # add the appropriate CORS headers
  self.send_header('Access-Control-Allow-Origin', '*')
  self.send_header('Access-Control-Allow-Methods', 'POST')
  self.send_header('Access-Control-Allow-Headers', 'Content-Type')
  return self

# httpd = HTTPServer(('0.0.0.0', 8081), DiceRollRequestHandler)
httpd = HTTPServer(('0.0.0.0', 8081), OptionsRequestHandler)
# httpd.server_address('/options', OptionsRequestHandler)

# start the server
print("Listening on port", httpd.server_port)
httpd.serve_forever()
