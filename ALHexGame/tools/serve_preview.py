"""Local-only asset preview. Never reads extraction directories at runtime."""
import argparse
import json
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def json_response(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.json_response(200, {'app': 'al-hex-assets', 'root': str(ROOT)})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/api/verification':
            self.json_response(404, {'error': 'Unknown endpoint'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 5_000_000:
                raise ValueError('Invalid report length')
            report = json.loads(self.rfile.read(length))
            roster = json.loads((ROOT / 'data/roster.json').read_text(encoding='utf-8'))
            expected = {u['id'] for u in roster['units']}
            if {u['id'] for u in report['units']} != expected:
                raise ValueError('Report roster mismatch')
            output = ROOT / 'output/browser-verification.json'
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            self.json_response(200, {'saved': 'output/browser-verification.json'})
        except (ValueError, KeyError, TypeError) as error:
            self.json_response(400, {'error': str(error)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18767)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}/'
    ThreadingHTTPServer.request_queue_size = 128
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        try:
            health = json.load(urlopen(url + 'health', timeout=3))
        except Exception:
            health = {}
        if health.get('app') != 'al-hex-assets' or health.get('root') != str(ROOT):
            raise RuntimeError(f'Port {args.port} occupied by another app; choose --port')
        if args.open:
            webbrowser.open(url + 'preview/')
        return
    print(f'AL Hex assets: {url}preview/', flush=True)
    if args.open:
        webbrowser.open(url + 'preview/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
