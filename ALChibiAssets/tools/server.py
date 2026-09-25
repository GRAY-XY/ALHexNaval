import argparse,json,sys,webbrowser
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def end_headers(self):self.send_header('Cache-Control','no-cache');super().end_headers()
    def do_GET(self):
        if self.path=='/health':
            body=json.dumps({'app':'al-chibi-library','root':str(ROOT)}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--open',action='store_true');parser.add_argument('--port',type=int,default=18766);args=parser.parse_args();url=f'http://127.0.0.1:{args.port}/'
    ThreadingHTTPServer.request_queue_size=128
    try:server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError:
        try:health=json.load(urlopen(url+'health',timeout=3))
        except Exception:health={}
        if health.get('app')!='al-chibi-library' or health.get('root')!=str(ROOT):raise RuntimeError(f'Port {args.port} is occupied; use --port to select another port')
        if args.open:webbrowser.open(url)
        sys.exit(0)
    print(f'AL Chibi Library: {url}',flush=True)
    print('Keep this window open while browsing. Ctrl+C stops the library.',flush=True)
    if args.open:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
