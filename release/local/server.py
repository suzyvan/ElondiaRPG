#!/usr/bin/env python3
"""ElondiaRPG local server (macOS / Linux; started by start.sh).

Serves the "game" folder at http://localhost:8473/ and relays AI requests for
services that do not allow browsers to connect directly (no CORS):

    /proxy/<http|https>/<host[:port]>/<path>?<query>  ->  <scheme>://<host>/<path>?<query>

Requests go from this computer straight to the service; nothing passes through
any third party. Only requests from this game page are relayed: they must carry
the X-Elondia-Proxy: 1 header (other websites cannot send it without a CORS
preflight, which this server never approves), the Host has to be this page's
own address (localhost:8473 or 127.0.0.1:8473, against DNS rebinding) and,
when the browser sends an Origin, it has to be this page's own address too.
"""

import functools
import http.server
import json
import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request

PORT = 8473
HOST = '127.0.0.1'
ORIGINS = {f'http://localhost:{PORT}', f'http://127.0.0.1:{PORT}'}
# The page's own address. Checking Host stops DNS rebinding: another site pointing its own name at
# 127.0.0.1 would be "same-origin" with itself, so its GET requests carry no Origin header at all.
HOSTS = {f'localhost:{PORT}', f'127.0.0.1:{PORT}'}
PROXY_RE = re.compile(r'^/proxy/(https?)/([^/?#]+)(.*)$')
# Headers that describe the connection to this server, not the request itself
SKIP_REQUEST = {
    'host', 'origin', 'referer', 'cookie', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'x-elondia-proxy',
}
SKIP_RESPONSE = {'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'trailer', 'upgrade', 'set-cookie'}


def ssl_context():
    """Use certifi's certificates when available (python.org builds on macOS may lack system ones)."""
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


SSL = ssl_context()


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):  # keep the window quiet; errors are printed separately
        pass

    def end_headers(self):
        if not self.path.startswith('/proxy/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # ---- static files or relay ----
    def do_GET(self):
        if self.path.startswith('/proxy/'):
            return self.relay()
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith('/proxy/'):
            return self.relay()
        return super().do_HEAD()

    def do_POST(self):
        return self.relay() if self.path.startswith('/proxy/') else self.send_error(405)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def reply_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def fail(self, status, message):
        self.reply_json(status, {'error': {'message': message, 'type': 'local_proxy_error'}})

    def relay(self):
        if self.headers.get('X-Elondia-Proxy') != '1':
            return self.fail(403, '本機轉送只接受遊戲自己送出的請求')
        if (self.headers.get('Host') or '').lower() not in HOSTS:
            return self.fail(403, '本機轉送只接受遊戲自己送出的請求')
        origin = self.headers.get('Origin')
        if origin and origin not in ORIGINS:
            return self.fail(403, '本機轉送只接受遊戲自己送出的請求')
        if self.path.split('?')[0] == '/proxy/ping':
            return self.reply_json(200, {'elondiaProxy': True})
        m = PROXY_RE.match(self.path)
        if not m:
            return self.fail(400, '轉送的網址格式不對')
        target = f'{m.group(1)}://{m.group(2)}{m.group(3)}'
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length > 0 else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in SKIP_REQUEST and not k.lower().startswith('sec-')}
        headers['Accept-Encoding'] = 'identity'
        req = urllib.request.Request(target, data=body, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=600, context=SSL)
        except urllib.error.HTTPError as e:
            resp = e  # 4xx / 5xx: pass the service's own answer through
        except (urllib.error.URLError, socket.timeout, ssl.SSLError, OSError) as e:
            reason = getattr(e, 'reason', e)
            print(f'[proxy] {target}: {reason}', file=sys.stderr)
            return self.fail(502, f'本機轉送連不上 {m.group(2)}：{reason}')
        try:
            self.send_response(resp.status if hasattr(resp, 'status') else resp.code)
            for k, v in resp.headers.items():
                if k.lower() not in SKIP_RESPONSE:
                    self.send_header(k, v)
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            if self.command == 'HEAD':
                self.wfile.write(b'0\r\n\r\n')
                return
            # stream as it arrives (narration is streamed token by token)
            read = getattr(resp, 'read1', None) or resp.read
            while True:
                chunk = read(8192)
                if not chunk:
                    break
                self.wfile.write(b'%x\r\n%s\r\n' % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b'0\r\n\r\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the game cancelled the request
        finally:
            resp.close()


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game')
    if not os.path.isfile(os.path.join(root, 'index.html')):
        print('Cannot find the game folder next to this script. Please unzip the whole folder first.')
        sys.exit(1)
    handler = functools.partial(Handler, directory=root)
    try:
        server = http.server.ThreadingHTTPServer((HOST, PORT), handler)
    except OSError as e:
        print(f'Port {PORT} is busy ({e}). The game may already be running.')
        sys.exit(2)
    server.daemon_threads = True
    print(f'ElondiaRPG is running at http://localhost:{PORT}/ (AI relay on). Press Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
