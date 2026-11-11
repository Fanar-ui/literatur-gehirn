"""Lokaler Entwicklungsserver fuer das Literatur-Gehirn.

Liefert die statischen Dateien aus und ersetzt lokal den EcoXPO-Weg (_xpo):
  POST /_local/tree   {payload, node_response_fields} -> EcoGovernance /api/route
  POST /_local/fetch  {url}                           -> nur api.openalex.org
  GET  /_local/pdf?id=W123                            -> Volltext-PDF von OpenAlex
       (kostet 1 Cent beim ersten Abruf, danach aus dem lokalen Ordner .pdf_cache)
  GET  /_local/fulltext?id=W123                       -> Volltext als TEI-XML (Grobid) von OpenAlex
       (ebenfalls 1 Cent beim ersten Abruf, danach aus .fulltext_cache)

Der API-Key steht NUR in .env.local (nie im Browser-Code).
Start:  python dev_server.py   ->  http://localhost:8080
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    path = os.path.join(HERE, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()
API_BASE = os.environ.get("ECOGOVERNANCE_API_URL", "https://api.ecogovernance.io").rstrip("/")
API_KEY = os.environ.get("ECOGOVERNANCE_API_KEY", "")
TREE_ID = int(os.environ.get("ECOGOVERNANCE_TREE_ID", "45"))
OPENALEX_KEY = os.environ.get("OPENALEX_API_KEY", "")
ALLOWED_HOSTS = {"api.openalex.org"}
PDF_CACHE = os.path.join(HERE, ".pdf_cache")
XML_CACHE = os.path.join(HERE, ".fulltext_cache")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    # Keine versteckten Dateien (.env.local) und keinen Python-Code ausliefern
    def end_headers(self):
        # Kein Zwischenspeichern im Browser: Änderungen an JS/CSS greifen sofort
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/_local/pdf":
            return self._pdf(parse_qs(parsed.query).get("id", [""])[0])
        if parsed.path == "/_local/fulltext":
            return self._fulltext(parse_qs(parsed.query).get("id", [""])[0])
        parts = parsed.path.split("/")
        if any(p.startswith(".") for p in parts if p) or self.path.endswith(".py"):
            return self._json(404, {"error": "Nicht gefunden"})
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "Ungültiges JSON"})
        if self.path == "/_local/tree":
            return self._tree(body)
        if self.path == "/_local/fetch":
            return self._fetch(body)
        return self._json(404, {"error": "Unbekannter Pfad"})

    def _tree(self, body):
        if not API_KEY:
            return self._json(500, {"error": "ECOGOVERNANCE_API_KEY fehlt in .env.local"})
        payload = {
            "tree_id": TREE_ID,
            "payload": body.get("payload") or {},
            "node_response_fields": body.get("node_response_fields") or [],
        }
        # Webhook-/Data-Ergebnisse und Antwort auf eine Freigabe-Rueckfrage
        if body.get("data_response_fields"):
            payload["data_response_fields"] = body["data_response_fields"]
        if body.get("permission"):
            payload["permission"] = body["permission"]
        if body.get("include_tool_results"):
            payload["include_tool_results"] = True
        req = urllib.request.Request(
            API_BASE + "/api/route",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
            method="POST",
        )
        return self._forward(req, timeout=180)

    def _fetch(self, body):
        url = str(body.get("url") or "")
        u = urlparse(url)
        if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
            return self._json(403, {"error": "Lokal ist nur api.openalex.org erlaubt"})
        if OPENALEX_KEY:
            url += ("&" if "?" in url else "?") + "api_key=" + OPENALEX_KEY
        req = urllib.request.Request(url, headers={"User-Agent": "Literatur-Gehirn (lokal)"})
        return self._forward(req, timeout=30)

    def _pdf(self, work_id):
        wid = work_id.rsplit("/", 1)[-1]
        if not re.fullmatch(r"W\d+", wid):
            return self._json(400, {"error": "Ungültige OpenAlex-ID"})
        path = os.path.join(PDF_CACHE, wid + ".pdf")
        if not os.path.exists(path):
            if not OPENALEX_KEY:
                return self._json(500, {"error": "OPENALEX_API_KEY fehlt in .env.local"})
            url = f"https://content.openalex.org/works/{wid}.pdf?api_key={OPENALEX_KEY}"
            req = urllib.request.Request(url, headers={"User-Agent": "Literatur-Gehirn (lokal)"})
            try:
                with urllib.request.urlopen(req, timeout=90) as r:   # folgt der Weiterleitung zur Datei
                    data = r.read()
            except urllib.error.HTTPError as e:
                msg = "Für dieses Paper hat OpenAlex keine PDF." if e.code == 404 else f"OpenAlex antwortet mit {e.code}"
                return self._json(e.code, {"error": msg})
            except Exception as e:
                return self._json(502, {"error": f"Nicht erreichbar: {e}"})
            if not data.startswith(b"%PDF"):
                return self._json(502, {"error": "OpenAlex hat keine PDF geliefert."})
            os.makedirs(PDF_CACHE, exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", f'inline; filename="{wid}.pdf"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _fulltext(self, work_id):
        wid = work_id.rsplit("/", 1)[-1]
        if not re.fullmatch(r"W\d+", wid):
            return self._json(400, {"error": "Ungültige OpenAlex-ID"})
        path = os.path.join(XML_CACHE, wid + ".xml")
        if not os.path.exists(path):
            if not OPENALEX_KEY:
                return self._json(500, {"error": "OPENALEX_API_KEY fehlt in .env.local"})
            url = f"https://content.openalex.org/works/{wid}.grobid-xml?api_key={OPENALEX_KEY}"
            req = urllib.request.Request(url, headers={"User-Agent": "Literatur-Gehirn (lokal)"})
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = r.read()
            except urllib.error.HTTPError as e:
                msg = "Für dieses Paper hat OpenAlex keinen Volltext." if e.code == 404 else f"OpenAlex antwortet mit {e.code}"
                return self._json(e.code, {"error": msg})
            except Exception as e:
                return self._json(502, {"error": f"Nicht erreichbar: {e}"})
            if data[:2] == b"\x1f\x8b":   # gzip
                import gzip
                data = gzip.decompress(data)
            if b"<TEI" not in data[:4000]:
                return self._json(502, {"error": "OpenAlex hat kein lesbares XML geliefert."})
            os.makedirs(XML_CACHE, exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/xml; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _forward(self, req, timeout):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read()
        except Exception as e:  # Netzwerkfehler, Timeout
            return self._json(502, {"error": f"Nicht erreichbar: {e}"})
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"Literatur-Gehirn läuft auf http://localhost:{port}  (Baum {TREE_ID})")
    if not API_KEY:
        print("Hinweis: ECOGOVERNANCE_API_KEY fehlt in .env.local")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
