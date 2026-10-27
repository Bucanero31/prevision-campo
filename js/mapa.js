// Mapa Leaflet: límites, coloreado por municipio, etiquetas según el zoom, selección y GPS.
/* global L */
import { ICONOS_TIEMPO, iconoSegunValores } from "./iconos.js";
import { escaparHtml } from "./util.js";

const CENTRO_RD = [18.8, -70.3];
const LIMITES_RD = [
  [17.2, -72.3],
  [20.2, -68.0],
];
const ZOOM_ETIQUETAS = 9;
const ZOOM_NOMBRES = 10;
const CAPAS_FINAS = {
  distritos: { url: "data/distritos.geojson", zoom: 10, tipo: "distrito" },
  secciones: { url: "data/secciones.geojson", zoom: 12, tipo: "seccion" },
};

// ---------- geometría ----------
function cajaDe(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const anillos = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  for (const anillo of anillos)
    for (const [x, y] of anillo) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}
function enAnillo(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function enPoligono(x, y, coords) {
  if (!enAnillo(x, y, coords[0])) return false;
  for (let k = 1; k < coords.length; k++) if (enAnillo(x, y, coords[k])) return false;
  return true;
}
export function contiene(feature, lat, lon) {
  const g = feature.geometry;
  if (!g) return false;
  const c = feature._caja || (feature._caja = cajaDe(g));
  if (lon < c[0] || lon > c[2] || lat < c[1] || lat > c[3]) return false;
  if (g.type === "Polygon") return enPoligono(lon, lat, g.coordinates);
  return g.coordinates.some((p) => enPoligono(lon, lat, p));
}

// Zona cabecera del municipio: según el campo `tipo` si existe; si no, por el código de la ONE
// (el distrito "01" de cada municipio es su cabecera).
export const esCabecera = (f) => (f.properties.tipo ? f.properties.tipo === "cabecera" : String(f.properties.id).endsWith("01"));

function temaOscuro() {
  const forzado = document.documentElement.dataset.theme;
  if (forzado) return forzado === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export class Mapa {
  constructor(idElemento, { alSeleccionar }) {
    this.alSeleccionar = alSeleccionar;
    this.datos = new Map(); // id municipio -> valores combinados del día elegido
    this.variable = null;
    this.seleccion = null;
    this.municipios = [];
    this.distritos = [];
    this.secciones = [];
    this._capasFinas = {};
    this._promesas = {};

    this.mapa = L.map(idElemento, {
      center: CENTRO_RD,
      zoom: 8,
      minZoom: 7,
      maxZoom: 17,
      maxBounds: LIMITES_RD,
      maxBoundsViscosity: 0.8,
      zoomSnap: 1,
      preferCanvas: true,
      attributionControl: true,
    });
    this.mapa.attributionControl.setPrefix(false);
    for (const [nombre, z] of [["municipios", 410], ["distritos", 420], ["secciones", 425], ["provincias", 430], ["realce", 440], ["nombresBase", 450]]) {
      this.mapa.createPane(nombre).style.zIndex = z;
    }
    for (const p of ["provincias", "realce", "nombresBase"]) this.mapa.getPane(p).style.pointerEvents = "none";

    // Mosaicos sin clave de acceso (comprobados): lienzo gris de Esri con nombres encima, OSM y satélite.
    const oscuro = temaOscuro();
    const esri = (servicio, opciones = {}) =>
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${servicio}/MapServer/tile/{z}/{y}/{x}`, {
        maxZoom: 19,
        maxNativeZoom: 16,
        attribution: "Mapa base &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap",
        ...opciones,
      });
    const nombres = esri(`Canvas/World_${oscuro ? "Dark" : "Light"}_Gray_Reference`, { pane: "nombresBase", attribution: "" });
    const base = {
      "Mapa gris": L.layerGroup([esri(`Canvas/World_${oscuro ? "Dark" : "Light"}_Gray_Base`), nombres]),
      OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
      }),
      "Satélite (Esri)": L.layerGroup([
        esri("World_Imagery", { maxNativeZoom: 18, attribution: "Imágenes &copy; Esri, Maxar, Earthstar Geographics" }),
        esri("Reference/World_Boundaries_and_Places", { pane: "nombresBase", maxNativeZoom: 18, attribution: "" }),
      ]),
    };
    base["Mapa gris"].addTo(this.mapa);
    this.control = L.control.layers(base, {}, { position: "bottomright", collapsed: true }).addTo(this.mapa);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(this.mapa);

    this.capaEtiquetas = L.layerGroup().addTo(this.mapa);
    this.capaRealce = L.layerGroup().addTo(this.mapa);
    this.mapa.on("zoomend moveend", () => this._programarEtiquetas());
    // Tras un flyTo, Leaflet 1.9.4 a veces deja visible el nivel de mosaicos anterior (escalado);
    // en la capa transparente de nombres se ven letras gigantes. Se poda al terminar cada movimiento.
    const podar = () => this.mapa.eachLayer((c) => c instanceof L.GridLayer && typeof c._pruneTiles === "function" && c._pruneTiles());
    this.mapa.on("zoomend moveend", () => setTimeout(podar, 500));
    this.mapa.on("layeradd", (e) => e.layer instanceof L.GridLayer && e.layer.on("load", podar));
    this.mapa.on("zoomend", () => this._alternarFinas());
  }

  // ---------- carga de límites ----------
  async cargarLimites() {
    const leer = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`No se pudo cargar ${url} (${r.status})`);
      return r.json();
    };
    const [prov, muni] = await Promise.all([leer("data/provincias.geojson"), leer("data/municipios.geojson")]);
    this.municipios = muni.features;
    this.provincias = prov.features;

    this.capaProvincias = L.geoJSON(prov, {
      pane: "provincias",
      interactive: false,
      style: { color: "#52514e", weight: 1.4, opacity: 0.75, fill: false },
    }).addTo(this.mapa);

    this.capaMunicipios = L.geoJSON(muni, {
      pane: "municipios",
      renderer: L.canvas({ pane: "municipios", padding: 0.3 }),
      style: (f) => this._estiloMunicipio(f),
      onEachFeature: (f, capa) => {
        f._capa = capa;
        capa.on("mouseover", () => !this._algunaFinaVisible() && capa.setStyle({ weight: 2, color: "#0b0b0b" }));
        capa.on("mouseout", () => capa.setStyle(this._estiloMunicipio(f)));
        capa.bindTooltip(() => this._textoTooltip(f), { sticky: true, className: "tip-mapa", direction: "top", offset: [0, -6] });
        capa.on("click", () => this.alSeleccionar({ tipo: "municipio", feature: f }));
      },
    }).addTo(this.mapa);
    this._programarEtiquetas();
    return { municipios: this.municipios, provincias: this.provincias };
  }

  // Capas finas: se descargan aparte y se muestran al acercarse.
  cargarCapa(nombre) {
    if (this._promesas[nombre]) return this._promesas[nombre];
    const def = CAPAS_FINAS[nombre];
    this._promesas[nombre] = fetch(def.url)
      .then((r) => {
        if (!r.ok) throw new Error(`${nombre} ${r.status}`);
        return r.json();
      })
      .then((datos) => {
        this[nombre] = datos.features;
        this._capasFinas[nombre] = L.geoJSON(datos, {
          pane: nombre,
          renderer: L.canvas({ pane: nombre, padding: 0.3 }),
          style: () => this._estiloFina(nombre, false),
          onEachFeature: (f, capa) => {
            capa.on("mouseover", () => capa.setStyle(this._estiloFina(nombre, true)));
            capa.on("mouseout", () => capa.setStyle(this._estiloFina(nombre, false)));
            capa.bindTooltip(() => this._textoTooltipFina(def.tipo, f), { sticky: true, className: "tip-mapa", direction: "top", offset: [0, -6] });
            capa.on("click", () => this.alSeleccionar({ tipo: def.tipo, feature: f }));
          },
        });
        this._alternarFinas();
        return this[nombre];
      })
      .catch((e) => {
        this._promesas[nombre] = null;
        throw e;
      });
    return this._promesas[nombre];
  }
  cargarDistritos() {
    return this.cargarCapa("distritos");
  }
  cargarSecciones() {
    return this.cargarCapa("secciones");
  }

  _algunaFinaVisible() {
    return Object.values(this._capasFinas).some((c) => this.mapa.hasLayer(c));
  }
  _alternarFinas() {
    const zoom = this.mapa.getZoom();
    for (const [nombre, capa] of Object.entries(this._capasFinas)) {
      const mostrar = zoom >= CAPAS_FINAS[nombre].zoom;
      if (mostrar && !this.mapa.hasLayer(capa)) capa.addTo(this.mapa);
      if (!mostrar && this.mapa.hasLayer(capa)) this.mapa.removeLayer(capa);
      if (nombre === "distritos") capa.setStyle(this._estiloFina(nombre, false));
    }
  }

  // ---------- estilos ----------
  _estiloMunicipio(f) {
    const d = this.datos.get(f.properties.id);
    const color = this.variable && d ? this.variable.color(this.variable.valor(d)) : null;
    return {
      color: "#6f6d68",
      weight: 0.7,
      opacity: 0.8,
      fillColor: color || "#bdbcb4",
      fillOpacity: color ? 0.62 : 0.15,
    };
  }
  _estiloFina(nombre, encima) {
    if (encima) return { color: "#0b0b0b", weight: 2, opacity: 0.9, fillOpacity: 0, fill: true };
    // Con las secciones visibles, los distritos quedan como contorno más grueso.
    if (nombre === "distritos") {
      const conSecciones = this.mapa.getZoom() >= CAPAS_FINAS.secciones.zoom;
      return { color: "#3a3936", weight: conSecciones ? 1.6 : 0.8, opacity: 0.6, fillOpacity: 0, fill: true };
    }
    return { color: "#3a3936", weight: 0.6, opacity: 0.55, dashArray: "3 3", fillOpacity: 0, fill: true };
  }

  _textoTooltip(f) {
    const p = f.properties;
    const d = this.datos.get(p.id);
    const valor = this.variable && d ? this.variable.etiqueta(d) : "Cargando…";
    return `<b>${escaparHtml(p.nombre)}</b>${escaparHtml(p.provincia)}<br>${escaparHtml(this.variable?.titulo || "")}: <b style="display:inline">${escaparHtml(valor)}</b>`;
  }
  _textoTooltipFina(tipo, f) {
    const p = f.properties;
    const ruta =
      tipo === "seccion"
        ? `Sección · ${[p.distrito && p.distrito !== p.municipio ? `D. M. ${p.distrito}` : null, p.municipio, p.provincia].filter(Boolean).join(" · ")}`
        : `${esCabecera(f) ? "Zona cabecera del municipio" : "Distrito municipal"} · ${p.municipio} · ${p.provincia}`;
    return `<b>${escaparHtml(p.nombre)}</b>${escaparHtml(ruta)}<br><span style="opacity:.75">Clic para ver la previsión de esta zona</span>`;
  }

  // ---------- pintar datos ----------
  pintar(datosPorMunicipio, variable) {
    this.datos = datosPorMunicipio;
    this.variable = variable;
    if (this.capaMunicipios) this.capaMunicipios.eachLayer((capa) => capa.setStyle(this._estiloMunicipio(capa.feature)));
    this._programarEtiquetas();
  }

  _programarEtiquetas() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._dibujarEtiquetas());
  }

  // Coloca etiquetas sin solaparse: primero los municipios más grandes y el seleccionado.
  _dibujarEtiquetas() {
    this.capaEtiquetas.clearLayers();
    const zoom = this.mapa.getZoom();
    if (zoom < ZOOM_ETIQUETAS || !this.variable || !this.municipios.length) return;
    const conNombre = zoom >= ZOOM_NOMBRES;
    const limites = this.mapa.getBounds().pad(0.05);
    const tam = this.mapa.getSize();
    const ocupado = [];
    const candidatos = this.municipios
      .filter((f) => limites.contains([f.properties.lat, f.properties.lon]) && this.datos.has(f.properties.id))
      .sort((a, b) => {
        const sa = this.seleccion?.municipioId === a.properties.id ? 1 : 0;
        const sb = this.seleccion?.municipioId === b.properties.id ? 1 : 0;
        return sb - sa || (b.properties.area_km2 || 0) - (a.properties.area_km2 || 0);
      });
    for (const f of candidatos) {
      const p = f.properties;
      const d = this.datos.get(p.id);
      const texto = this.variable.etiqueta(d);
      const nombre = conNombre ? p.nombre : "";
      const ancho = 24 + (texto.length + (nombre ? nombre.length + 2 : 0)) * 6.4;
      const alto = 20;
      const pt = this.mapa.latLngToContainerPoint([p.lat, p.lon]);
      const caja = [pt.x - ancho / 2 - 2, pt.y - alto / 2 - 2, pt.x + ancho / 2 + 2, pt.y + alto / 2 + 2];
      if (caja[0] < 0 || caja[1] < 0 || caja[2] > tam.x || caja[3] > tam.y) continue;
      if (ocupado.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue;
      ocupado.push(caja);
      const icono = ICONOS_TIEMPO[iconoSegunValores(d)];
      const html = `<div>${icono}${nombre ? `<span class="n">${escaparHtml(nombre)}</span>` : ""}<span>${escaparHtml(texto)}</span></div>`;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "etiqueta-mapa", html, iconSize: [0, 0] }),
        interactive: false,
        keyboard: false,
      }).addTo(this.capaEtiquetas);
    }
  }

  // ---------- selección ----------
  marcarSeleccion(lugar) {
    this.seleccion = lugar;
    this.capaRealce.clearLayers();
    if (lugar?.feature?.geometry) {
      L.geoJSON(lugar.feature, {
        pane: "realce",
        interactive: false,
        style: { color: "#0b0b0b", weight: 3, opacity: 1, fill: false },
      }).addTo(this.capaRealce);
      L.geoJSON(lugar.feature, {
        pane: "realce",
        interactive: false,
        style: { color: "#ffffff", weight: 1.2, opacity: 1, fill: false, dashArray: "4 4" },
      }).addTo(this.capaRealce);
    }
    this._programarEtiquetas();
  }

  enfocar(feature, { maxZoom = 12 } = {}) {
    if (!feature?.geometry) return;
    const caja = feature._caja || (feature._caja = cajaDe(feature.geometry));
    const relleno = window.innerWidth <= 860 ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, 160] } : { padding: [40, 40] };
    this.mapa.flyToBounds(
      [
        [caja[1], caja[0]],
        [caja[3], caja[2]],
      ],
      { ...relleno, maxZoom, duration: 0.8 },
    );
  }

  // ---------- búsqueda espacial ----------
  municipioEn(lat, lon) {
    return this.municipios.find((f) => contiene(f, lat, lon)) || null;
  }
  distritoEn(lat, lon) {
    return this.distritos.find((f) => contiene(f, lat, lon)) || null;
  }
  seccionEn(lat, lon) {
    return this.secciones.find((f) => contiene(f, lat, lon)) || null;
  }

  // ---------- GPS ----------
  mostrarGPS(lat, lon, precision) {
    if (!this.marcadorGPS) {
      this.circuloGPS = L.circle([lat, lon], { radius: precision, color: "#2a78d6", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.mapa);
      this.marcadorGPS = L.marker([lat, lon], {
        icon: L.divIcon({ className: "", html: '<div class="marcador-gps"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(this.mapa);
    } else {
      this.marcadorGPS.setLatLng([lat, lon]);
      this.circuloGPS.setLatLng([lat, lon]).setRadius(precision);
    }
  }
  quitarGPS() {
    if (this.marcadorGPS) {
      this.mapa.removeLayer(this.marcadorGPS);
      this.mapa.removeLayer(this.circuloGPS);
      this.marcadorGPS = this.circuloGPS = null;
    }
  }
  centrarEn(lat, lon, zoom) {
    this.mapa.setView([lat, lon], Math.max(this.mapa.getZoom(), zoom), { animate: true });
  }
  invalidar() {
    this.mapa.invalidateSize();
  }
}
