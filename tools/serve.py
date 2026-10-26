#!/usr/bin/env python3
"""Run Caddie Voice on this computer AND let the course mapper save into GolfCourseMaps/.

    python3 tools/serve.py          (then open http://localhost:8000)
    python3 tools/serve.py 8080     (a different port)

It's the same as `python3 -m http.server`, plus one extra: when you press Save in
"Map a course", the app sends the course map here and it is written to
GolfCourseMaps/<course>.json, and GolfCourseMaps/index.json is brought up to date.
Only this computer can reach it (127.0.0.1), and it only ever writes .json files
inside GolfCourseMaps/.
"""
import json, os, re, sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'GolfCourseMaps')
NAME = re.compile(r'^/GolfCourseMaps/([a-z0-9][a-z0-9-]{0,79})\.json$')
MAX_BYTES = 2 * 1024 * 1024


def write_index():
    """index.json lists every course map, so the app can find the one for the course you open."""
    courses = []
    for f in sorted(os.listdir(MAPS)):
        if not f.endswith('.json') or f == 'index.json':
            continue
        try:
            with open(os.path.join(MAPS, f), encoding='utf-8') as fh:
                m = json.load(fh)
            courses.append({'id': f[:-5], 'name': m.get('name'), 'center': m.get('center'),
                            'holes': len(m.get('holes') or {}), 'updated': m.get('updated')})
        except (OSError, ValueError):
            pass
    with open(os.path.join(MAPS, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump({'courses': courses}, fh, indent=1)
        fh.write('\n')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        if self.path.startswith('/GolfCourseMaps/'):
            self.send_header('Cache-Control', 'no-store')    # always the newest map
        super().end_headers()

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self):
        m = NAME.match(self.path.split('?')[0])
        if not m:
            return self.reply(404, {'error': 'only GolfCourseMaps/<name>.json can be saved'})
        n = int(self.headers.get('Content-Length') or 0)
        if not 0 < n <= MAX_BYTES:
            return self.reply(413, {'error': 'map file is empty or too big'})
        try:
            course = json.loads(self.rfile.read(n))
            assert isinstance(course, dict) and isinstance(course.get('holes'), dict)
        except (ValueError, AssertionError):
            return self.reply(400, {'error': 'not a course map'})
        os.makedirs(MAPS, exist_ok=True)
        path = os.path.join(MAPS, m.group(1) + '.json')
        with open(path + '.tmp', 'w', encoding='utf-8') as fh:
            json.dump(course, fh, indent=1)
            fh.write('\n')
        os.replace(path + '.tmp', path)                      # never leaves a half-written file
        write_index()
        stamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        print(f'{stamp}  saved GolfCourseMaps/{m.group(1)}.json ({len(course["holes"])} holes)', flush=True)
        return self.reply(200, {'saved': True, 'file': f'GolfCourseMaps/{m.group(1)}.json'})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.makedirs(MAPS, exist_ok=True)
    write_index()
    print(f'Caddie Voice: http://localhost:{port}   (course maps save into GolfCourseMaps/)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
