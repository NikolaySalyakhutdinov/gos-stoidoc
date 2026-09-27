import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "python-ai-placeholder"})
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/process":
            self._json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        # Контейнер-заглушка намеренно принимает multipart-пакет, но не выполняет ИИ.
        self.rfile.read(content_length)
        logging.info("Received a document processing request")
        self._json(202, {"status": "ACCEPTED", "message": "Python AI contract received"})

    def log_message(self, format, *args):
        logging.info("%s - %s", self.address_string(), format % args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    logging.info("Python AI placeholder listening on :8000")
    server.serve_forever()
