// Service worker: guarda la app y los límites para abrirla sin conexión en campo.
// Las previsiones se guardan aparte (IndexedDB) desde la propia app.
const VERSION = "prevision-v4";
const ARCHIVOS = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/ajustes.js",
  "js/almacen.js",
  "js/combinar.js",
  "js/config.js",
  "js/escalas.js",
  "js/fuentes.js",
  "js/grafico.js",
  "js/iconos.js",
  "js/mapa.js",
  "js/panel.js",
  "js/util.js",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "img/icono.svg",
  "manifest.webmanifest",
  "data/provincias.geojson",
  "data/municipios.geojson",
  "data/distritos.geojson",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  // Red primero, revalidando con el servidor (GitHub Pages deja 10 min en la caché del navegador),
  // para recibir siempre la versión nueva; sin conexión, la copia guardada.
  const peticion = e.request.mode === "navigate" ? e.request.url : e.request;
  e.respondWith(
    fetch(peticion, { cache: "no-cache" })
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put(e.request, copia)));
        }
        return r;
      })
      .catch(() =>
        caches
          .match(e.request, { ignoreSearch: true })
          .then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())),
      ),
  );
});
