// Acceso a las fuentes meteorológicas y conversión a series normalizadas (ver combinar.js).
// Usa el proxy del servidor local cuando está disponible (caché compartida, identificación ante
// MET Norway); si la app se abre sin ese servidor, consulta Open-Meteo directamente.
import {
  MODELOS, METNO, ZONA, DIAS, URL_OPEN_METEO, URL_META, URL_METNO,
  DIARIAS_DETALLE, HORARIAS_DETALLE, DIARIAS_MAPA, HORARIAS_MAPA,
} from "./config.js";
import { MM_POR_PULGADA, esperar } from "./util.js";

let usarProxy = false;
export const hayProxy = () => usarProxy;

export class ErrorFuente extends Error {
  constructor(mensaje, { estado = 0, limite = false } = {}) {
    super(mensaje);
    this.estado = estado;
    this.limite = limite;
    this.porMinuto = false;
  }
  conMinuto(si) {
    this.porMinuto = si;
    return this;
  }
}

export async function detectarProxy() {
  try {
    const r = await fetch("api/salud", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    usarProxy = r.ok && (await r.json()).proxy === true;
  } catch {
    usarProxy = false;
  }
  return usarProxy;
}

function construirUrl(base, params, extras = {}) {
  const q = new URLSearchParams(params).toString().replace(/%2C/g, ",");
  const url = `${base}?${q}`;
  if (!usarProxy) return url;
  const ext = Object.entries(extras)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `&_${k}=${encodeURIComponent(v)}`)
    .join("");
  return `api/proxy?u=${encodeURIComponent(url)}${ext}`;
}

// Petición JSON con tiempo límite y reintentos ante fallos de red o del servidor.
// Devuelve { cuerpo, desdeCache } (desdeCache: el servidor local la tenía guardada).
async function pedir(url, { tiempo = 45000, reintentos = 2 } = {}) {
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento) await esperar(1500 * 2 ** (intento - 1));
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(tiempo) });
    } catch (e) {
      ultimo = new ErrorFuente(e.name === "TimeoutError" ? "La fuente tardó demasiado en responder." : "Sin conexión con la fuente.");
      continue;
    }
    let cuerpo = null;
    try {
      cuerpo = await r.json();
    } catch {
      /* respuesta no JSON */
    }
    if (r.ok && cuerpo && !cuerpo.error) {
      // Con el servidor local: HIT = copia vigente; STALE = la fuente falló y se entrega la última copia.
      const estadoCache = r.headers.get("X-Cache") || "";
      const guardado = Number(r.headers.get("X-Cache-Guardado")) * 1000 || Date.now();
      return { cuerpo, desdeCache: estadoCache.startsWith("HIT"), obsoleto: estadoCache.startsWith("STALE"), guardado };
    }
    const motivo = cuerpo?.reason || `HTTP ${r.status}`;
    if (r.status === 429) {
      // Open-Meteo limita por minuto, hora y día; el motivo de la respuesta dice cuál.
      const fuente = url.includes("met.no") ? "MET Norway" : "Open-Meteo";
      const porMinuto = !/hour|day|daily|hourly/i.test(motivo);
      throw new ErrorFuente(
        porMinuto
          ? `${fuente} pidió esperar un minuto (límite de consultas por minuto).`
          : `${fuente} alcanzó su límite gratuito (${motivo}).`,
        { estado: 429, limite: true },
      ).conMinuto(porMinuto);
    }
    ultimo = new ErrorFuente(`La fuente respondió: ${motivo}`, { estado: r.status });
    if (r.status < 500 && r.status !== 0) break; // error de la petición: reintentar no sirve
  }
  throw ultimo;
}
const pedirJSON = async (url, opciones) => (await pedir(url, opciones)).cuerpo;

// ---------- corridas de los modelos ----------
export async function consultarCorridas(modelos) {
  const conMeta = modelos.filter((m) => m.meta);
  const resultados = await Promise.allSettled(
    conMeta.map((m) => pedirJSON(construirUrl(URL_META(m.meta), {}), { tiempo: 10000, reintentos: 0 })),
  );
  const corridas = {};
  const ahora = Date.now() / 1000;
  resultados.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const { last_run_initialisation_time: inicio, last_run_availability_time: disponible } = r.value;
    // Un metadato de hace más de 3 días no corresponde a lo que sirve la API: se ignora.
    if (typeof inicio === "number" && ahora - inicio < 3 * 86400) corridas[conMeta[i].id] = { inicio, disponible };
  });
  return corridas;
}
export function selloCorridas(corridas, modelos) {
  return modelos.map((m) => corridas[m.id]?.disponible ?? "").join("-");
}

// ---------- Open-Meteo ----------
function paramsOpenMeteo(lats, lons, modelos, diarias, horarias) {
  return {
    latitude: lats.join(","),
    longitude: lons.join(","),
    models: modelos.map((m) => m.id).join(","),
    daily: diarias.join(","),
    hourly: horarias.join(","),
    timezone: ZONA,
    forecast_days: String(DIAS),
    precipitation_unit: "inch",
    wind_speed_unit: "kmh",
  };
}

// Convierte la respuesta de un lugar en una serie normalizada por modelo.
export function seriesDeOpenMeteo(r, modelos, multi = modelos.length > 1) {
  const clave = (v, id) => (multi ? `${v}_${id}` : v);
  return modelos.map((m) => {
    const d = r.daily || {};
    const h = r.hourly || {};
    const diario = new Map();
    (d.time || []).forEach((fecha, i) => {
      const g = (v) => d[clave(v, m.id)]?.[i] ?? null;
      const reg = {
        lluviaIn: g("precipitation_sum"),
        prob: g("precipitation_probability_max"),
        nubes: g("cloud_cover_mean"),
        solSeg: g("sunshine_duration"),
        luzSeg: g("daylight_duration"),
        amanecer: g("sunrise"),
        atardecer: g("sunset"),
        tMax: g("temperature_2m_max"),
        tMin: g("temperature_2m_min"),
        viento: g("wind_speed_10m_max"),
        rafagas: g("wind_gusts_10m_max"),
        codigo: g("weather_code"),
      };
      if (reg.lluviaIn != null || reg.nubes != null || reg.tMax != null) diario.set(fecha, reg);
    });
    let horario = null;
    if (h.time) {
      horario = new Map();
      h.time.forEach((hora, i) => {
        const g = (v) => h[clave(v, m.id)]?.[i] ?? null;
        // La app usa cada hora como el tramo [HH:00, HH+1:00). En Open-Meteo la lluvia, su probabilidad
        // y las ráfagas se publican al final de su hora ("preceding hour"), así que se toman del dato siguiente.
        const gTramo = (v) => h[clave(v, m.id)]?.[i + 1] ?? null;
        const reg = {
          lluviaIn: gTramo("precipitation"),
          prob: gTramo("precipitation_probability"),
          nubes: g("cloud_cover"),
          temp: g("temperature_2m"),
          viento: g("wind_speed_10m"),
          rafagas: gTramo("wind_gusts_10m"),
          codigo: g("weather_code"),
        };
        if (reg.lluviaIn != null || reg.prob != null || reg.nubes != null || reg.temp != null) horario.set(hora, reg);
      });
    }
    return { id: m.id, nombre: m.nombre, organismo: m.organismo, diario, horario };
  });
}

// Previsión de un punto con todos los modelos activos: { cuerpo (respuesta original), obsoleto, guardado }.
export async function pedirPunto(lat, lon, modelos, sello) {
  const url = construirUrl(
    URL_OPEN_METEO,
    paramsOpenMeteo([lat.toFixed(4)], [lon.toFixed(4)], modelos, DIARIAS_DETALLE, HORARIAS_DETALLE),
    { v: sello, ttl: 1800 },
  );
  return pedir(url);
}

// Con un solo modelo Open-Meteo no añade el sufijo del modelo a las variables; se añade aquí
// para poder fusionar respuestas de varias tandas.
function sufijar(r, modelos) {
  if (modelos.length > 1) return r;
  const id = modelos[0].id;
  const copia = { ...r };
  for (const seccion of ["daily", "hourly"]) {
    if (!r[seccion]) continue;
    copia[seccion] = {};
    for (const [k, v] of Object.entries(r[seccion])) copia[seccion][k === "time" ? k : `${k}_${id}`] = v;
  }
  return copia;
}
function fusionar(a, b) {
  if (!a) return b;
  return { ...a, daily: { ...a.daily, ...b.daily }, hourly: { ...a.hourly, ...b.hourly } };
}

// Tandas de modelos: cada punto × modelo consume cupo de Open-Meteo, y el cupo gratuito es de
// 600 llamadas por minuto. 155 municipios × 3 modelos queda por debajo; la siguiente tanda
// espera un minuto (salvo que el servidor local ya la tuviera guardada).
const MODELOS_POR_TANDA = 3;
function tandas(modelos) {
  if (modelos.length <= MODELOS_POR_TANDA) return [modelos];
  const n = Math.ceil(modelos.length / MODELOS_POR_TANDA);
  const tam = Math.ceil(modelos.length / n);
  return Array.from({ length: n }, (_, i) => modelos.slice(i * tam, (i + 1) * tam));
}

// Previsión de todos los municipios (una entrada por punto, variables siempre con sufijo de modelo).
// `alAvanzar({ lista, recibidos, obsoleto, guardado })` permite pintar el mapa con las tandas que ya llegaron.
export async function pedirMapa(puntos, modelos, sello, alAvanzar) {
  const lats = puntos.map((p) => p.lat.toFixed(3));
  const lons = puntos.map((p) => p.lon.toFixed(3));
  let lista = null;
  const recibidos = [];
  let anteriorDesdeRed = false;
  let obsoleto = false;
  let guardado = Date.now();
  for (const grupo of tandas(modelos)) {
    const params = paramsOpenMeteo(lats, lons, grupo, DIARIAS_MAPA, HORARIAS_MAPA);
    const url = construirUrl(URL_OPEN_METEO, params, { v: sello, ttl: 3 * 3600 });
    let respuesta = null;
    if (anteriorDesdeRed && usarProxy) {
      // Si otro usuario de la oficina ya descargó esta tanda, no hace falta esperar el minuto.
      try {
        respuesta = await pedir(construirUrl(URL_OPEN_METEO, params, { v: sello, cache: "solo" }), { reintentos: 0 });
      } catch {
        respuesta = null;
      }
    }
    if (!respuesta) {
      try {
        if (anteriorDesdeRed) await esperar(65000);
        respuesta = await pedir(url, { tiempo: 90000 });
      } catch (e) {
        if (!e.porMinuto) throw e;
        await esperar(65000);
        respuesta = await pedir(url, { tiempo: 90000 });
      }
    }
    anteriorDesdeRed = !respuesta.desdeCache;
    obsoleto ||= respuesta.obsoleto;
    guardado = Math.min(guardado, respuesta.guardado);
    const parte = Array.isArray(respuesta.cuerpo) ? respuesta.cuerpo : [respuesta.cuerpo];
    if (parte.length !== puntos.length) throw new ErrorFuente(`La fuente devolvió ${parte.length} lugares de ${puntos.length}.`);
    lista = parte.map((r, i) => fusionar(lista?.[i], sufijar(r, grupo)));
    recibidos.push(...grupo);
    alAvanzar?.({ lista, recibidos: [...recibidos], obsoleto, guardado });
  }
  return lista;
}

// ---------- MET Norway (solo a través del servidor local, como exigen sus condiciones) ----------
// Sus horas vienen en UTC; RD es UTC-4 todo el año.
function horaLocal(isoUtc) {
  const d = new Date(Date.parse(isoUtc) - 4 * 3600 * 1000);
  return `${d.toISOString().slice(0, 13)}:00`;
}

export async function pedirMetNo(lat, lon) {
  if (!usarProxy) return null;
  const trunc = (v) => (Math.trunc(v * 1e4) / 1e4).toFixed(4); // máx. 4 decimales (condición de MET)
  return pedirJSON(construirUrl(URL_METNO, { lat: trunc(lat), lon: trunc(lon) }), { reintentos: 1, tiempo: 30000 });
}
// MET Norway publica `next_1_hours` para el tramo que empieza en la hora indicada: coincide con la
// convención de la app y no se desplaza.

// Solo se usan los pasos horarios reales (unas 60 h); los días se arman únicamente si las 24 horas
// están cubiertas, para no repartir ni inventar acumulados de bloques de 6 h.
export function serieDeMetNo(r) {
  const pasos = r?.properties?.timeseries || [];
  const horario = new Map();
  for (const p of pasos) {
    const una = p.data?.next_1_hours;
    if (!una?.details || una.details.precipitation_amount == null) continue;
    const ins = p.data.instant?.details || {};
    horario.set(horaLocal(p.time), {
      lluviaIn: una.details.precipitation_amount / MM_POR_PULGADA,
      prob: una.details.probability_of_precipitation ?? null,
      nubes: ins.cloud_area_fraction ?? null,
      temp: ins.air_temperature ?? null,
      viento: ins.wind_speed != null ? ins.wind_speed * 3.6 : null,
      rafagas: ins.wind_speed_of_gust != null ? ins.wind_speed_of_gust * 3.6 : null,
      codigo: /thunder/.test(una.summary?.symbol_code || "") ? 95 : null,
    });
  }
  const porDia = new Map();
  for (const [hora, v] of horario) {
    const f = hora.slice(0, 10);
    if (!porDia.has(f)) porDia.set(f, []);
    porDia.get(f).push(v);
  }
  const diario = new Map();
  for (const [f, horas] of porDia) {
    if (horas.length < 24) continue;
    const prom = (k) => {
      const v = horas.map((x) => x[k]).filter((x) => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const temps = horas.map((x) => x.temp).filter((x) => x != null);
    const rafagas = horas.map((x) => x.rafagas).filter((x) => x != null);
    diario.set(f, {
      lluviaIn: horas.reduce((a, x) => a + x.lluviaIn, 0),
      prob: null,
      nubes: prom("nubes"),
      solSeg: null,
      luzSeg: null,
      amanecer: null,
      atardecer: null,
      tMax: temps.length ? Math.max(...temps) : null,
      tMin: temps.length ? Math.min(...temps) : null,
      viento: null,
      rafagas: rafagas.length ? Math.max(...rafagas) : null,
      codigo: horas.some((x) => x.codigo === 95) ? 95 : null,
    });
  }
  return {
    id: METNO.id,
    nombre: METNO.nombre,
    organismo: METNO.organismo,
    corrida: r?.properties?.meta?.updated_at ?? null,
    diario,
    horario,
  };
}

export function modelosActivos(ajustes) {
  return MODELOS.filter((m) => ajustes.modelos[m.id]);
}
