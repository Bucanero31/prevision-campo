"""Servidor local de la app de Previsión del Tiempo para trabajo de campo (Lexgeo).

Sirve los archivos estáticos de la app y ofrece un proxy con caché para las
fuentes meteorológicas. El proxy:
  - comparte la caché entre todos los usuarios de la oficina (menos llamadas a las APIs),
  - envía a MET Norway la identificación (User-Agent) que exigen sus condiciones de uso,
  - si una fuente falla o limita las llamadas, entrega la última respuesta guardada.

Solo usa la biblioteca estándar de Python 3. Uso:
    python servidor.py              (puerto 8765, abre el navegador)
    python servidor.py --puerto 9000 --sin-navegador
"""

import argparse
import gzip
import hashlib
import http.client
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zlib
from collections import OrderedDict
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
DIR_CACHE = os.path.join(RAIZ, "cache")
VERSION = "1.0.0"

CONFIG_PREDETERMINADA = {
    # MET Norway exige identificar la aplicación con un User-Agent que incluya un contacto.
    "metno_user_agent": "LexgeoPrevisionCampo/1.0 lexgeo.com",
    "puerto": 8765,
}

# Hosts permitidos por el proxy y tiempo de vida (segundos) de su caché.
HOSTS_PERMITIDOS = {
    "api.open-meteo.com": 15 * 60,
    "ensemble-api.open-meteo.com": 30 * 60,
    "api.met.no": 30 * 60,  # se usa el encabezado Expires de MET Norway cuando viene
}
# Los metadatos de corridas de modelos cambian poco: caché corta para detectar corridas nuevas.
TTL_METADATOS = 5 * 60
# Si la fuente falla, se entrega una copia vieja de hasta este tiempo.
MAX_ANTIGUEDAD_RESPALDO = 48 * 3600
TIMEOUT_FUENTE = 25
MAX_ENTRADAS_MEMORIA = 300
MAX_DIAS_DISCO = 3

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".geojson": "application/geo+json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".md": "text/plain; charset=utf-8",
}
COMPRIMIBLES = {".html", ".js", ".mjs", ".css", ".json", ".geojson", ".webmanifest", ".svg"}

# Solo se sirven estos archivos y carpetas de la app (nunca servidor.py, la caché ni la configuración).
ARCHIVOS_RAIZ = {"/", "/index.html", "/sw.js", "/manifest.webmanifest"}
CARPETAS_PUBLICAS = ("/css/", "/js/", "/vendor/", "/img/", "/data/")
EXTENSIONES_PUBLICAS = {".html", ".js", ".css", ".json", ".geojson", ".webmanifest", ".svg", ".png", ".ico"}
ERRORES_RED = (urllib.error.URLError, TimeoutError, socket.timeout, OSError, http.client.HTTPException, zlib.error, EOFError)


def ruta_publica(ruta_url):
    """True si la ruta pedida es parte pública de la app."""
    ruta = urllib.parse.unquote(ruta_url).replace("\\", "/").lower()
    if ".." in ruta or "//" in ruta or ":" in ruta:
        return False
    if ruta in ARCHIVOS_RAIZ:
        return True
    return ruta.startswith(CARPETAS_PUBLICAS) and os.path.splitext(ruta)[1] in EXTENSIONES_PUBLICAS


def cargar_config():
    config = dict(CONFIG_PREDETERMINADA)
    ruta = os.path.join(RAIZ, "config_servidor.json")
    if os.path.exists(ruta):
        try:
            with open(ruta, encoding="utf-8") as f:
                config.update(json.load(f))
        except (OSError, ValueError) as e:
            print(f"Aviso: no se pudo leer config_servidor.json ({e}); se usan valores predeterminados.")
    return config


CONFIG = cargar_config()


class CacheProxy:
    """Caché en memoria y en disco, con una sola descarga a la vez por URL."""

    def __init__(self):
        self._mem = OrderedDict()
        self._candados = {}
        self._candado_global = threading.Lock()
        os.makedirs(DIR_CACHE, exist_ok=True)
        self._limpiar_disco()

    @staticmethod
    def _limpiar_disco():
        limite = time.time() - MAX_DIAS_DISCO * 86400
        for nombre in os.listdir(DIR_CACHE):
            ruta = os.path.join(DIR_CACHE, nombre)
            try:
                if os.path.getmtime(ruta) < limite:
                    os.remove(ruta)
            except OSError:
                pass

    def _recordar(self, clave, entrada):
        with self._candado_global:
            self._mem[clave] = entrada
            self._mem.move_to_end(clave)
            while len(self._mem) > MAX_ENTRADAS_MEMORIA:
                self._mem.popitem(last=False)

    def _candado(self, clave):
        with self._candado_global:
            if len(self._candados) > 500:
                self._candados = {k: c for k, c in self._candados.items() if c.locked()}
            return self._candados.setdefault(clave, threading.Lock())

    @staticmethod
    def _ruta(clave):
        return os.path.join(DIR_CACHE, hashlib.sha256(clave.encode()).hexdigest() + ".json")

    def _leer(self, clave):
        entrada = self._mem.get(clave)
        if entrada:
            return entrada
        try:
            with open(self._ruta(clave), encoding="utf-8") as f:
                entrada = json.load(f)
            entrada["cuerpo"] = entrada["cuerpo"].encode("utf-8")
            self._recordar(clave, entrada)
            return entrada
        except (OSError, ValueError, KeyError):
            return None

    def _guardar(self, clave, entrada):
        self._recordar(clave, entrada)
        try:
            copia = dict(entrada, cuerpo=entrada["cuerpo"].decode("utf-8"))
            tmp = f"{self._ruta(clave)}.{threading.get_ident()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(copia, f)
            os.replace(tmp, self._ruta(clave))
        except (OSError, UnicodeDecodeError):
            pass

    def obtener(self, url, ttl, cabeceras, clave=None, solo_cache=False):
        """Devuelve (estado, cuerpo_bytes, tipo, estado_cache, guardado_epoch).
        `clave` identifica la entrada de caché; con `solo_cache` no se consulta la fuente."""
        clave = clave or url
        entrada = self._leer(clave)
        if entrada and entrada["expira"] > time.time():
            return 200, entrada["cuerpo"], entrada["tipo"], "HIT", entrada.get("guardado", 0)
        if solo_cache:
            return 204, b"", "application/json", "NO", 0
        with self._candado(clave):
            entrada = self._leer(clave)
            if entrada and entrada["expira"] > time.time():
                return 200, entrada["cuerpo"], entrada["tipo"], "HIT", entrada.get("guardado", 0)
            # Si no hay copia para esta clave, sirve de respaldo la última de la misma URL.
            respaldo = entrada or self._leer(url)
            peticion = urllib.request.Request(url, headers=dict(cabeceras, **{"Accept-Encoding": "gzip"}))
            try:
                with urllib.request.urlopen(peticion, timeout=TIMEOUT_FUENTE) as r:
                    cuerpo = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        cuerpo = gzip.decompress(cuerpo)
                    tipo = r.headers.get("Content-Type", "application/json")
                    expira = time.time() + ttl
                    if "api.met.no" in url and r.headers.get("Expires"):
                        try:
                            expira = max(time.time() + 60, parsedate_to_datetime(r.headers["Expires"]).timestamp())
                        except (TypeError, ValueError):
                            pass
                    nueva = {"cuerpo": cuerpo, "tipo": tipo, "expira": expira, "guardado": time.time()}
                    self._guardar(clave, nueva)
                    if clave != url:
                        self._guardar(url, nueva)
                    return 200, cuerpo, tipo, "MISS", nueva["guardado"]
            except urllib.error.HTTPError as e:
                detalle = e.read()
                transitorio = e.code == 429 or e.code >= 500
                if transitorio and respaldo and time.time() - respaldo.get("guardado", 0) < MAX_ANTIGUEDAD_RESPALDO:
                    return 200, respaldo["cuerpo"], respaldo["tipo"], f"STALE-{e.code}", respaldo.get("guardado", 0)
                return e.code, detalle or json.dumps({"error": True, "reason": str(e)}).encode(), "application/json", "ERROR", 0
            except ERRORES_RED as e:
                if respaldo and time.time() - respaldo.get("guardado", 0) < MAX_ANTIGUEDAD_RESPALDO:
                    return 200, respaldo["cuerpo"], respaldo["tipo"], "STALE-RED", respaldo.get("guardado", 0)
                cuerpo = json.dumps({"error": True, "reason": f"Sin conexión con la fuente: {e}"}).encode()
                return 502, cuerpo, "application/json", "ERROR", 0


CACHE = CacheProxy()
_gzip_estaticos = {}


class Manejador(SimpleHTTPRequestHandler):
    server_version = "LexgeoPrevision/" + VERSION

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    def log_message(self, formato, *args):
        if "--detalle" in sys.argv:
            super().log_message(formato, *args)

    def guess_type(self, path):
        return TIPOS.get(os.path.splitext(path)[1].lower()) or super().guess_type(path)

    def acepta_gzip(self):
        return "gzip" in self.headers.get("Accept-Encoding", "")

    def enviar(self, estado, cuerpo, tipo, extra=None):
        comprimir = self.acepta_gzip() and len(cuerpo) > 1024
        if comprimir:
            cuerpo = gzip.compress(cuerpo, compresslevel=6)
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        if comprimir:
            self.send_header("Content-Encoding", "gzip")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(cuerpo)

    def enviar_json(self, estado, datos):
        self.enviar(estado, json.dumps(datos, ensure_ascii=False).encode("utf-8"), TIPOS[".json"])

    def do_GET(self):
        ruta = urllib.parse.urlsplit(self.path)
        if ruta.path == "/api/salud":
            return self.enviar_json(200, {"ok": True, "proxy": True, "version": VERSION})
        if ruta.path == "/api/proxy":
            # Parámetros propios del proxy: "_v" (sello de corridas, parte de la clave de caché),
            # "_ttl" (duración en segundos) y "_cache=solo" (responder solo si ya está guardado).
            q = urllib.parse.parse_qs(ruta.query)
            extras = {k: v[0] for k, v in q.items() if k.startswith("_")}
            return self.proxy(q.get("u", [""])[0], extras)
        if not ruta_publica(ruta.path):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return self.estatico()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def proxy(self, url, extras_externos):
        try:
            partes = urllib.parse.urlsplit(url)
        except ValueError:
            return self.enviar_json(400, {"error": True, "reason": "URL no válida"})
        if partes.scheme != "https" or partes.hostname not in HOSTS_PERMITIDOS:
            return self.enviar_json(403, {"error": True, "reason": "Fuente no permitida"})
        # Los parámetros que empiezan con "_" nunca se reenvían a la fuente.
        pares = urllib.parse.parse_qsl(partes.query, keep_blank_values=True)
        consulta = [(k, v) for k, v in pares if not k.startswith("_")]
        extras = dict((k, v) for k, v in pares if k.startswith("_"))
        extras.update(extras_externos)
        url = urllib.parse.urlunsplit((partes.scheme, partes.netloc, partes.path, urllib.parse.urlencode(consulta, safe=",:/"), ""))
        ttl = TTL_METADATOS if partes.path.endswith("meta.json") else HOSTS_PERMITIDOS[partes.hostname]
        try:
            ttl = min(6 * 3600, max(60, int(extras.get("_ttl", ttl))))
        except ValueError:
            pass
        clave = url + ("#v=" + extras["_v"] if extras.get("_v") else "")
        cabeceras = {"User-Agent": CONFIG["metno_user_agent"] if partes.hostname == "api.met.no" else f"LexgeoPrevisionCampo/{VERSION}"}
        estado, cuerpo, tipo, estado_cache, guardado = CACHE.obtener(url, ttl, cabeceras, clave, extras.get("_cache") == "solo")
        self.enviar(estado, cuerpo, tipo, {"X-Cache": estado_cache, "X-Cache-Guardado": str(int(guardado))})

    def estatico(self):
        ruta = self.translate_path(self.path)
        ext = os.path.splitext(ruta)[1].lower()
        if os.path.isdir(ruta):
            ruta = os.path.join(ruta, "index.html")
            ext = ".html"
        if not os.path.isfile(ruta) or not self.acepta_gzip() or ext not in COMPRIMIBLES:
            return super().do_GET()
        try:
            mtime = os.path.getmtime(ruta)
            clave = (ruta, mtime)
            cuerpo = _gzip_estaticos.get(clave)
            if cuerpo is None:
                with open(ruta, "rb") as f:
                    cuerpo = gzip.compress(f.read(), compresslevel=6)
                for viejo in [k for k in _gzip_estaticos if k[0] == ruta]:
                    del _gzip_estaticos[viejo]
                _gzip_estaticos[clave] = cuerpo
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)
        etiqueta = f'"{int(mtime)}-{len(cuerpo)}"'
        if self.headers.get("If-None-Match") == etiqueta:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etiqueta)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(ruta))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("ETag", etiqueta)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(cuerpo)


class ServidorExclusivo(ThreadingHTTPServer):
    # En Windows, reutilizar la dirección permitiría abrir dos copias en el mismo puerto sin aviso.
    allow_reuse_address = False


def ips_locales():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


def main():
    p = argparse.ArgumentParser(description="Servidor de la app de previsión del tiempo")
    p.add_argument("--puerto", type=int, default=CONFIG["puerto"])
    p.add_argument("--sin-navegador", action="store_true")
    p.add_argument("--detalle", action="store_true", help="mostrar cada petición en consola")
    args = p.parse_args()
    try:
        servidor = ServidorExclusivo(("0.0.0.0", args.puerto), Manejador)
    except OSError as e:
        print(f"No se pudo abrir el puerto {args.puerto}: {e}")
        print("¿Ya hay otra copia del servidor abierta? Pruebe con --puerto 8766")
        sys.exit(1)
    servidor.daemon_threads = True
    url = f"http://localhost:{args.puerto}/"
    print("Previsión del tiempo para trabajo de campo - Lexgeo")
    print(f"  En este equipo:  {url}")
    for ip in ips_locales():
        print(f"  En la red local: http://{ip}:{args.puerto}/")
    print("Cierre esta ventana o pulse Ctrl+C para detener el servidor.")
    if not args.sin_navegador:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
