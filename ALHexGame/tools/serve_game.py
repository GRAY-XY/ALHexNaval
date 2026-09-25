"""Serve the built map locally; no Node, npm, extraction directories, or internet needed."""
import argparse
import json
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT / 'dist'


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR can allow two servers to bind to the same port.
    allow_reuse_address = False
    request_queue_size = 128


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.path == '/health':
            body = json.dumps({'app': 'al-hex-map', 'root': str(ROOT)}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/api/verification':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 5_000_000:
                raise ValueError('Invalid report length')
            report = json.loads(self.rfile.read(length))
            roster = json.loads((ROOT / 'data/roster.json').read_text(encoding='utf-8'))
            if {u['id'] for u in report['units']} != {u['id'] for u in roster['units']}:
                raise ValueError('Report roster mismatch')
            path = PROJECT / 'output/browser-verification.json'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            body = b'{"saved":"output/browser-verification.json"}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, KeyError, TypeError) as error:
            self.send_error(400, str(error))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18768)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    if not (ROOT / 'index.html').is_file():
        raise RuntimeError('Built map not found. Run npm run build in the project folder first.')
    url = f'http://127.0.0.1:{args.port}/'
    try:
        server = Server(('127.0.0.1', args.port), Handler)
    except OSError:
        try:
            health = json.load(urlopen(url + 'health', timeout=3))
        except Exception:
            health = {}
        if health.get('app') != 'al-hex-map' or health.get('root') != str(ROOT):
            raise RuntimeError(f'Port {args.port} is occupied. Choose another port using --port.')
        if args.open:
            webbrowser.open(url)
        return
    print(f'AL Hex map: {url}', flush=True)
    print('Keep this window open. Ctrl+C stops the server.', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
