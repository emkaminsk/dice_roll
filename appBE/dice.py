from http.server import BaseHTTPRequestHandler, HTTPServer
from random import randint
from urllib.parse import parse_qs, urlparse
import json

class DiceRollRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/dice-roll/':
            query_string = parse_qs(parsed_path.query)
            varMax = int(query_string.get('max', [6])[0])
            roll = randint(1, varMax)
            response_data = {
                'max': varMax,
                'rolls': [roll],
                'total': roll,
                'add_info': "Docker"
            }

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))
        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/draw':
            length = int(self.headers.get('Content-Length'))
            body = self.rfile.read(length)
            options = json.loads(body.decode())
            roll = randint(1, len(options.values()))
            optResult = list(options.values())[roll-1]

            response_data = {
                'success': True,
                'optResult': optResult
            }

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(bytes(json.dumps(response_data), 'utf-8'))
        else:
            self.send_error(404, "Not Found")

def run(server_class=HTTPServer, handler_class=DiceRollRequestHandler, port=8081):
    server_address = ('0.0.0.0', port)
    httpd = server_class(server_address, handler_class)
    print(f"Listening on port {port}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()

