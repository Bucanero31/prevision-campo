// Orquestación: estado, descarga y actualización en vivo, mapa, panel, búsqueda, GPS y ajustes.
import { Mapa, esCabecera } from "./mapa.js";
import { Panel } from "./panel.js";
import { cargarAjustes, guardarAjustes, dibujarAjustes, leerFormulario, AJUSTES_PREDETERMINADOS } from "./ajustes.js";
import { variablesMapa, COLOR_ESTADO, TEXTO_ESTADO, SIMBOLO_ESTADO } from "./escalas.js";
import * as fuentes from "./fuentes.js";
import * as almacen from "./almacen.js";
import { combinar } from "./combinar.js";
import { MODELOS, METNO, FIRMA_MAPA, MIN_ENTRE_DESCARGAS_MAPA, MAX_EDAD_MAPA, MIN_ENTRE_DESCARGAS_DETALLE, MAX_EDAD_DETALLE } from "./config.js";
import { ahoraRD, debounce, escaparHtml, fechaCorta, fmtHora12, haceCuanto, nombreDia, normalizar } from "./util.js";

const $ = (id) => document.getElementById(id);

const estado = {
  ajustes: cargarAjustes(),
  modo: "hoy",
  variable: "aptitud",
  fecha: null,
  fechas: [],
  corridas: {},
  mapaDatos: null, // respuesta guardada del mapa
  combinadoMapa: new Map(), // id municipio -> días combinados
  lugar: null,
  registroDetalle: null,
  turnoDetalle: 0,
  ultimaRevision: 0,
  errorMapa: null,
  descargandoMapa: false,
  progresoMapa: null,
  fechaPendiente: null, // día pedido en un enlace, se aplica cuando llegan los datos
  revisando: false,
  reintentoDetalle: null,
};

aplicarTema();
const panel = new Panel({
  alCerrar: () => deseleccionar(),
  alElegirDia: (fecha) => elegirDia(fecha),
  alReintentar: () => estado.lugar && cargarDetalle(estado.lugar, { forzar: true }),
});
const mapa = new Mapa("mapa", { alSeleccionar: ({ tipo, feature }) => seleccionar(lugarDeFeature(tipo, feature)) });

// ---------- utilidades de interfaz ----------
function aplicarTema() {
  const t = estado.ajustes.tema;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

let temporizadorAviso;
function aviso(texto, ms = 4500) {
  const el = $("aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), ms);
}

function opcionesPanel() {
  const a = estado.ajustes;
  return { modo: estado.modo, unidad: a.unidad, jornada: { inicio: a.jornadaInicio, fin: a.jornadaFin } };
}

const modelosMapa = () => {
  const activos = fuentes.modelosActivos(estado.ajustes);
  const principales = activos.filter((m) => m.mapa);
  return principales.length ? principales : activos.slice(0, 5);
};

function pintarEstado() {
  const punto = $("estado-punto");
  const texto = $("estado-texto");
  punto.className = "punto";
  if (estado.descargandoMapa) {
    punto.classList.add("cargando");
    const p = estado.progresoMapa;
    texto.textContent = p
      ? `Mapa con ${p.recibidos} de ${p.total} modelos; completando el resto (Open-Meteo admite 600 consultas por minuto)…`
      : `Descargando la previsión de ${mapa.municipios.length} municipios (${modelosMapa().length} modelos)…`;
    return;
  }
  const partes = [];
  if (estado.mapaDatos) {
    partes.push(`Mapa: ${estado.mapaDatos.modelos.split(",").length} modelos · datos ${haceCuanto(estado.mapaDatos.descargado)}`);
  }
  if (estado.errorMapa) {
    punto.classList.add("error");
    partes.push(estado.errorMapa);
  }
  const prox = new Date(estado.ultimaRevision + estado.ajustes.intervaloMin * 60000 - 4 * 3600000);
  if (estado.ultimaRevision) partes.push(`próxima revisión ${fmtHora12(prox.getUTCHours(), prox.getUTCMinutes())}`);
  if (!fuentes.hayProxy()) partes.push("versión web: sin MET Norway (solo con el servidor de la oficina)");
  texto.textContent = partes.join(" · ") || "Listo";
}

// ---------- leyenda, días y variable ----------
function pintarLeyenda() {
  const v = variablesMapa(estado.ajustes.unidad)[estado.variable];
  let html = `<strong>${escaparHtml(v.titulo)}</strong>`;
  if (v.categorias) {
    html += `<div class="categorias">${v.categorias
      .map((c) => `<div><span class="muestra" style="background:${COLOR_ESTADO[c]};${c === "aviso" ? "color:#0b0b0b" : ""}">${SIMBOLO_ESTADO[c]}</span>${TEXTO_ESTADO[c]}</div>`)
      .join("")}</div><div class="nota">Jornada ${fmtHora12(estado.ajustes.jornadaInicio)}–${fmtHora12(estado.ajustes.jornadaFin)} · criterios en Ajustes</div>`;
  } else {
    html += `<div class="escala">${v.escala.map((c) => `<span style="background:${c}"></span>`).join("")}</div><div class="marcas">${v.marcas.map((m) => `<span>${m}</span>`).join("")}</div>`;
  }
  const n = estado.mapaDatos ? estado.mapaDatos.modelos.split(",").length : modelosMapa().length;
  html += `<div class="nota">Estimado de ${n} modelos por municipio</div>`;
  $("leyenda").innerHTML = html;
}

function pintarDias() {
  const cont = $("dias");
  cont.hidden = estado.modo === "hoy";
  if (!estado.fechas.length) return (cont.innerHTML = "");
  const hoy = estado.fechas[0];
  cont.innerHTML = estado.fechas
    .map(
      (f) => `<button type="button" data-fecha="${escaparHtml(f)}" aria-pressed="${f === estado.fecha}">${nombreDia(f, hoy)}<small>${escaparHtml(fechaCorta(f))}</small></button>`,
    )
    .join("");
}

function repintarMapa() {
  const variables = variablesMapa(estado.ajustes.unidad);
  const datos = new Map();
  for (const [id, dias] of estado.combinadoMapa) {
    const d = dias.find((x) => x.fecha === estado.fecha);
    if (d) datos.set(id, d);
  }
  mapa.pintar(datos, variables[estado.variable]);
  pintarLeyenda();
}

function elegirDia(fecha) {
  if (!estado.fechas.includes(fecha)) return;
  estado.fechaPendiente = null;
  estado.fecha = fecha;
  pintarDias();
  repintarMapa();
  guardarHash();
}

function cambiarModo(modo) {
  estado.modo = modo;
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modo)));
  if (modo === "hoy" && estado.fechas.length) estado.fecha = estado.fechas[0];
  pintarDias();
  repintarMapa();
  panel.refrescarOpciones(opcionesPanel());
  guardarHash();
}

// ---------- mapa: descarga y combinación ----------
function procesarMapa(reg) {
  const modelos = reg.modelos.split(",").map((id) => MODELOS.find((m) => m.id === id)).filter(Boolean);
  const hoy = ahoraRD().fecha;
  const combinado = new Map();
  reg.lista.forEach((r, i) => {
    const id = reg.ids[i];
    const series = fuentes.seriesDeOpenMeteo(r, modelos, true);
    const fechas = (r.daily?.time || []).filter((f) => f >= hoy);
    combinado.set(id, combinar(series, fechas, estado.ajustes, { conHoras: true }));
  });
  estado.mapaDatos = reg;
  estado.combinadoMapa = combinado;
  estado.fechas = (reg.lista[0]?.daily?.time || []).filter((f) => f >= hoy);
  if (estado.fechaPendiente && estado.fechas.includes(estado.fechaPendiente)) {
    estado.fecha = estado.fechaPendiente;
    estado.fechaPendiente = null;
  }
  if (!estado.fechas.includes(estado.fecha)) estado.fecha = estado.fechas[0] ?? null;
  if (estado.modo === "hoy") estado.fecha = estado.fechas[0] ?? null;
  pintarDias();
  repintarMapa();
}

async function actualizarMapa({ forzar = false } = {}) {
  if (!mapa.municipios.length || estado.descargandoMapa) return;
  const modelos = modelosMapa();
  const idsModelos = modelos.map((m) => m.id).join(",");
  const ids = mapa.municipios.map((f) => f.properties.id);
  const sello = fuentes.selloCorridas(estado.corridas, modelos);
  const hoy = ahoraRD().fecha;
  const g = estado.mapaDatos || (await almacen.leer("mapa"));
  const vigente = g && g.firma === FIRMA_MAPA && g.modelos === idsModelos && g.fecha0 === hoy && g.ids?.join() === ids.join();
  // También se recalcula al pasar la medianoche, para que "Hoy" sea el día correcto.
  if (g && g.ids?.join() === ids.join() && (g !== estado.mapaDatos || (estado.fechas[0] && estado.fechas[0] < hoy))) procesarMapa(g);
  const edad = g ? Date.now() - g.descargado : Infinity;
  const corridaNueva = sello.replace(/-/g, "") && g && g.sello !== sello;
  const necesita =
    !vigente || edad > MAX_EDAD_MAPA || (corridaNueva && edad > MIN_ENTRE_DESCARGAS_MAPA) || (forzar && (fuentes.hayProxy() || edad > 10 * 60000));
  if (!necesita) {
    estado.errorMapa = null;
    return pintarEstado();
  }
  estado.descargandoMapa = true;
  pintarEstado();
  try {
    const puntos = mapa.municipios.map((f) => ({ lat: f.properties.lat, lon: f.properties.lon }));
    // Cada tanda que llega se pinta y se guarda (si la siguiente falla, queda lo recibido).
    let respaldo = false;
    await fuentes.pedirMapa(puntos, modelos, sello, ({ lista, recibidos, obsoleto, guardado }) => {
      // Una copia de respaldo del servidor conserva su fecha real y no marca la corrida como recibida.
      const reg = { lista, ids, firma: FIRMA_MAPA, modelos: recibidos.map((m) => m.id).join(","), sello: obsoleto ? "" : sello, descargado: guardado, fecha0: lista[0]?.daily?.time?.[0] };
      respaldo = obsoleto;
      procesarMapa(reg);
      almacen.guardar("mapa", reg);
      estado.progresoMapa = recibidos.length < modelos.length ? { recibidos: recibidos.length, total: modelos.length } : null;
      pintarEstado();
    });
    estado.errorMapa = respaldo ? "la fuente no respondió; se muestra la última copia del servidor" : null;
  } catch (e) {
    estado.errorMapa = estado.mapaDatos ? `sin actualizar: ${e.message}` : `No se pudo cargar el mapa: ${e.message}`;
    if (e.limite) aviso(e.message, 8000);
  } finally {
    estado.descargandoMapa = false;
    estado.progresoMapa = null;
  }
  pintarEstado();
}

// ---------- lugar elegido ----------
function rutaDe(p, tipo) {
  if (tipo === "municipio") return `Municipio · Provincia ${p.provincia}`;
  if (tipo === "distrito") return `${esCabecera({ properties: p }) ? "Zona cabecera" : "Distrito municipal"} · ${p.municipio} · ${p.provincia}`;
  if (tipo === "seccion") return `Sección · ${[p.distrito && p.distrito !== p.municipio ? p.distrito : null, p.municipio, p.provincia].filter(Boolean).join(" · ")}`;
  return p.provincia || "";
}

function lugarDeFeature(tipo, f) {
  const p = f.properties;
  return { tipo, id: p.id, nombre: p.nombre, ruta: rutaDe(p, tipo), lat: p.lat, lon: p.lon, feature: f, municipioId: municipioDe(p.lat, p.lon)?.properties.id };
}

function municipioDe(lat, lon) {
  return mapa.municipioEn(lat, lon);
}

function deseleccionar() {
  estado.lugar = null;
  clearTimeout(estado.reintentoDetalle);
  estado.registroDetalle = null;
  mapa.marcarSeleccion(null);
  panel.vacio();
  guardarHash();
}

async function seleccionar(lugar, { enfocar = true } = {}) {
  estado.lugar = lugar;
  estado.registroDetalle = null;
  clearTimeout(estado.reintentoDetalle);
  mapa.marcarSeleccion(lugar);
  if (enfocar && lugar.feature) mapa.enfocar(lugar.feature, { maxZoom: lugar.tipo === "municipio" ? 11 : 13 });
  else if (enfocar) mapa.centrarEn(lugar.lat, lugar.lon, 12);
  panel.cargando(lugar);
  panel.expandir(false);
  guardarHash();
  await cargarDetalle(lugar);
}

function claveDetalle(lugar, modelos, conMet) {
  return `${lugar.lat.toFixed(3)},${lugar.lon.toFixed(3)}|${modelos.map((m) => m.id).join(",")}|${conMet ? "met" : ""}`;
}

async function cargarDetalle(lugar, { forzar = false, silencioso = false, reintento = false } = {}) {
  const turno = ++estado.turnoDetalle;
  const modelos = fuentes.modelosActivos(estado.ajustes);
  const conMet = estado.ajustes.usarMetNo && fuentes.hayProxy();
  const clave = claveDetalle(lugar, modelos, conMet);
  const sello = fuentes.selloCorridas(estado.corridas, modelos);
  const hoy = ahoraRD().fecha;
  clearTimeout(estado.reintentoDetalle);
  // Una copia de otro día sirve de respaldo sin conexión (se muestran solo los días desde hoy).
  const util = await almacen.leerDetalle(clave);
  if (turno !== estado.turnoDetalle) return;
  const edad = util ? Date.now() - util.generado : Infinity;
  const fresco =
    util && util.fecha0 === hoy && !util.obsoleto && (edad < MIN_ENTRE_DESCARGAS_DETALLE || (edad < MAX_EDAD_DETALLE && (!sello.replace(/-/g, "") || util.sello === sello)));
  // Se vuelve a dibujar siempre: la línea de "ahora" y la mejor ventana dependen de la hora.
  if (util) mostrarDetalle(util, { desdeCache: !fresco });
  if (fresco && !forzar) return;
  try {
    const [om, met] = await Promise.allSettled([
      fuentes.pedirPunto(lugar.lat, lugar.lon, modelos, sello),
      conMet ? fuentes.pedirMetNo(lugar.lat, lugar.lon) : Promise.resolve(null),
    ]);
    if (om.status === "rejected") throw om.reason;
    const reg = {
      clave,
      om: om.value.cuerpo,
      obsoleto: om.value.obsoleto,
      metno: met.status === "fulfilled" ? met.value : null,
      errorMetno: met.status === "rejected" ? met.reason?.message : null,
      conMet,
      modelos: modelos.map((m) => m.id),
      corridas: { ...estado.corridas },
      sello: om.value.obsoleto ? "" : sello,
      generado: om.value.guardado,
      fecha0: om.value.cuerpo?.daily?.time?.[0],
    };
    almacen.guardarDetalle(clave, reg);
    if (turno !== estado.turnoDetalle) return;
    mostrarDetalle(reg, { desdeCache: reg.obsoleto });
    if (reg.obsoleto) aviso("La fuente no respondió; se muestra la última copia guardada en el servidor.");
  } catch (e) {
    if (turno !== estado.turnoDetalle) return;
    if (e.porMinuto && !reintento) {
      const texto = `${e.message} Se reintenta solo en 1 minuto.`;
      if (util || estado.registroDetalle) aviso(texto, 8000);
      else panel.error(lugar, texto);
      estado.reintentoDetalle = setTimeout(() => estado.lugar === lugar && cargarDetalle(lugar, { forzar: true, silencioso: true, reintento: true }), 65000);
      return;
    }
    if (util) {
      mostrarDetalle(util, { desdeCache: true });
      aviso(`No se pudo actualizar: ${e.message}`);
    } else if (!silencioso || !estado.registroDetalle) panel.error(lugar, e.message);
  }
}

function mostrarDetalle(reg, { desdeCache }) {
  const lugar = estado.lugar;
  if (!lugar) return;
  estado.registroDetalle = reg;
  const modelos = reg.modelos.map((id) => MODELOS.find((m) => m.id === id)).filter(Boolean);
  const series = fuentes.seriesDeOpenMeteo(reg.om, modelos);
  const listaFuentes = series.map((s) => ({
    nombre: s.nombre,
    organismo: s.organismo,
    ok: s.diario.size > 0,
    corrida: reg.corridas?.[s.id]?.inicio ?? null,
    error: s.diario.size ? null : "sin datos para este lugar",
  }));
  if (reg.metno) {
    const sm = fuentes.serieDeMetNo(reg.metno);
    series.push(sm);
    listaFuentes.push({ nombre: sm.nombre, organismo: sm.organismo, ok: sm.horario.size > 0, corrida: sm.corrida, error: sm.horario.size ? null : "sin datos" });
  } else if (reg.conMet) {
    // Solo se lista como falla si se consultó; en la versión web no se consulta (ver nota de método).
    listaFuentes.push({ ...METNO, ok: false, error: reg.errorMetno || "sin respuesta" });
  }
  const hoy = ahoraRD().fecha;
  const fechas = (reg.om.daily?.time || []).filter((f) => f >= hoy);
  const validas = series.filter((s) => s.diario.size || s.horario?.size);
  const pron = {
    lugar,
    lat: lugar.lat,
    lon: lugar.lon,
    elevacion: reg.om.elevation ?? null,
    generado: reg.generado,
    desdeCache,
    fuentes: listaFuentes,
    dias: combinar(validas, fechas, estado.ajustes, { conHoras: true }),
    notaMetodo:
      "Estimado combinado: lluvia = mediana de los modelos (con su rango); probabilidad de lluvia = promedio de las probabilidades que publican los modelos con sistema de ensamble; nubosidad, horas de sol, temperatura y viento = promedio. " +
      (reg.conMet
        ? "MET Norway aporta datos horarios de los próximos ~2,5 días. Datos: Open-Meteo (CC BY 4.0) y MET Norway (api.met.no)."
        : "Versión web: MET Norway solo se consulta desde el servidor de la oficina, como exigen sus condiciones. Datos: Open-Meteo (CC BY 4.0).") +
      " Corridas en hora UTC.",
  };
  panel.mostrar(pron, opcionesPanel());
}

// ---------- revisión periódica (datos en vivo) ----------
let temporizadorRevision;
async function revisar({ forzar = false } = {}) {
  if (estado.revisando) {
    if (forzar) aviso("Ya se está actualizando…", 2500);
    return;
  }
  clearTimeout(temporizadorRevision);
  if (document.hidden && !forzar) return;
  estado.revisando = true;
  const boton = $("btn-actualizar");
  boton.classList.add("girando");
  try {
    // Pasada la medianoche, los días guardados se recalculan aunque no haya conexión.
    const hoy = ahoraRD().fecha;
    if (estado.mapaDatos && estado.fechas[0] && estado.fechas[0] < hoy) procesarMapa(estado.mapaDatos);
    const corridas = await fuentes.consultarCorridas(MODELOS);
    if (Object.keys(corridas).length) estado.corridas = corridas;
    estado.ultimaRevision = Date.now();
    await Promise.all([
      actualizarMapa({ forzar }),
      estado.lugar ? cargarDetalle(estado.lugar, { forzar, silencioso: true }) : null,
    ]);
  } finally {
    estado.revisando = false;
    boton.classList.remove("girando");
    pintarEstado();
    clearTimeout(temporizadorRevision);
    temporizadorRevision = setTimeout(() => revisar(), estado.ajustes.intervaloMin * 60000);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - estado.ultimaRevision > estado.ajustes.intervaloMin * 60000) revisar();
});
setInterval(pintarEstado, 60000);

// ---------- búsqueda ----------
let indiceBusqueda = [];
let lugaresCargados = false;
function construirIndice() {
  const entradas = [];
  const agregar = (tipo, f, sub, peso) => entradas.push({ tipo, f, nombre: f.properties.nombre, sub, peso, texto: normalizar(`${f.properties.nombre} ${sub}`), nom: normalizar(f.properties.nombre) });
  for (const f of mapa.provincias || []) agregar("provincia", f, "Provincia", 0);
  for (const f of mapa.municipios) agregar("municipio", f, `Municipio · ${f.properties.provincia}`, 1);
  for (const f of mapa.distritos) if (!esCabecera(f)) agregar("distrito", f, `Distrito municipal · ${f.properties.municipio} · ${f.properties.provincia}`, 2);
  for (const f of mapa.secciones || []) agregar("seccion", f, `Sección · ${f.properties.municipio} · ${f.properties.provincia}`, 3);
  for (const l of estado.lugares || []) {
    const sec = l.seccion;
    const sub = sec ? `${l.tipo || "Lugar"} · ${sec.properties.nombre} · ${sec.properties.municipio}` : l.tipo || "Lugar";
    entradas.push({ tipo: "lugar", l, nombre: l.nombre, sub, peso: 4, texto: normalizar(`${l.nombre} ${sub}`), nom: normalizar(l.nombre) });
  }
  indiceBusqueda = entradas;
}

async function cargarLugares() {
  if (lugaresCargados) return;
  lugaresCargados = true;
  try {
    const r = await fetch("data/lugares.json");
    if (!r.ok) return;
    const lista = await r.json();
    const secciones = new Map((mapa.secciones || []).map((f) => [f.properties.id, f]));
    // División territorial de la ONE: en zona urbana las secciones se dividen en barrios y en la rural en parajes.
    const TIPO_LUGAR = { urbana: "Barrio", rural: "Paraje" };
    estado.lugares = lista.map(([nombre, zona, lat, lon, seccionId]) => ({ nombre, tipo: TIPO_LUGAR[zona] || "Lugar", lat, lon, seccion: secciones.get(seccionId) || null }));
    construirIndice();
  } catch {
    /* lugares es opcional */
  }
}

function buscar(texto) {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const palabras = q.split(" ");
  const res = [];
  for (const e of indiceBusqueda) {
    if (!palabras.every((p) => e.texto.includes(p))) continue;
    const puntos = (e.nom === q ? 0 : e.nom.startsWith(q) ? 1 : e.nom.includes(q) ? 2 : 3) * 10 + e.peso;
    res.push([puntos, e]);
  }
  return res.sort((a, b) => a[0] - b[0] || a[1].nombre.localeCompare(b[1].nombre, "es")).slice(0, 12).map((x) => x[1]);
}

let resultados = [];
let activo = -1;
function pintarSugerencias() {
  const ul = $("sugerencias");
  const entrada = $("buscar");
  if (!entrada.value.trim()) {
    ul.hidden = true;
    entrada.setAttribute("aria-expanded", "false");
    return;
  }
  ul.innerHTML = resultados.length
    ? resultados.map((e, i) => `<li role="option" data-i="${i}" aria-selected="${i === activo}">${escaparHtml(e.nombre)}<small>${escaparHtml(e.sub)}</small></li>`).join("")
    : '<li class="vacio">Sin resultados</li>';
  ul.hidden = false;
  entrada.setAttribute("aria-expanded", "true");
}
function elegirResultado(e) {
  $("buscar").value = "";
  $("buscar").blur();
  resultados = [];
  pintarSugerencias();
  if (e.tipo === "provincia") return mapa.enfocar(e.f, { maxZoom: 10 });
  if (e.tipo === "lugar") {
    const sec = e.l.seccion;
    return seleccionar({
      tipo: "punto",
      id: `${e.l.lat},${e.l.lon}`,
      nombre: e.l.nombre,
      ruta: sec ? `${e.l.tipo || "Lugar"} · Sección ${sec.properties.nombre} · ${sec.properties.municipio} · ${sec.properties.provincia}` : e.l.tipo || "",
      lat: e.l.lat,
      lon: e.l.lon,
      feature: sec,
      municipioId: municipioDe(e.l.lat, e.l.lon)?.properties.id,
    });
  }
  seleccionar(lugarDeFeature(e.tipo, e.f));
}
const buscarDiferido = debounce(() => {
  resultados = buscar($("buscar").value);
  activo = resultados.length ? 0 : -1;
  pintarSugerencias();
}, 120);
$("buscar").addEventListener("input", buscarDiferido);
$("buscar").addEventListener("focus", () => {
  cargarSeccionesYDistritos().then(cargarLugares);
});
$("buscar").addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!resultados.length) return;
    activo = (activo + (ev.key === "ArrowDown" ? 1 : -1) + resultados.length) % resultados.length;
    pintarSugerencias();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    resultados = buscar($("buscar").value);
    const e = resultados[Math.max(0, activo)];
    if (e) elegirResultado(e);
  } else if (ev.key === "Escape") {
    $("buscar").value = "";
    resultados = [];
    pintarSugerencias();
  }
});
$("sugerencias").addEventListener("mousedown", (ev) => {
  const li = ev.target.closest("li[data-i]");
  if (li) {
    ev.preventDefault();
    elegirResultado(resultados[Number(li.dataset.i)]);
  }
});
$("buscar").addEventListener("blur", () => setTimeout(() => ($("sugerencias").hidden = true), 150));

// ---------- GPS ----------
let vigilancia = null;
let ultimoGps = null;
function distanciaKm(a, b) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
function lugarDeGps(lat, lon) {
  const sec = mapa.seccionEn?.(lat, lon);
  const dis = mapa.distritoEn(lat, lon);
  const mun = mapa.municipioEn(lat, lon);
  const partes = [sec ? `Sección ${sec.properties.nombre}` : null, dis && !esCabecera(dis) ? `D. M. ${dis.properties.nombre}` : null, mun?.properties.nombre, mun?.properties.provincia].filter(Boolean);
  return {
    tipo: "gps",
    id: sec?.properties.id || dis?.properties.id || mun?.properties.id || "fuera",
    nombre: "Mi ubicación",
    ruta: partes.join(" · ") || "Fuera de los límites de República Dominicana",
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    feature: sec || dis || mun || null,
    municipioId: mun?.properties.id,
    fuera: !mun,
  };
}
function alPosicion(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  mapa.mostrarGPS(lat, lon, accuracy);
  const lugar = lugarDeGps(lat, lon);
  const primero = !ultimoGps;
  if (primero) mapa.centrarEn(lat, lon, 12);
  if (lugar.fuera) {
    if (primero) aviso("Su ubicación está fuera de República Dominicana; se muestra la previsión del punto.");
  }
  // Se vuelve a consultar al cambiar de sección/distrito o al moverse más de 2 km.
  if (primero || lugar.id !== ultimoGps.id || distanciaKm(ultimoGps, lugar) > 2) {
    ultimoGps = lugar;
    seleccionar(lugar, { enfocar: false });
  }
}
function alErrorGps(err) {
  const textos = {
    1: "Permiso de ubicación denegado. Actívelo en el navegador para usar el GPS.",
    2: "No se pudo determinar la ubicación (sin señal GPS).",
    3: "El GPS tardó demasiado en responder; se seguirá intentando.",
  };
  aviso(textos[err.code] || "Error de ubicación.", 6000);
  if (err.code === 1) detenerGps();
}
function detenerGps() {
  if (vigilancia != null) navigator.geolocation.clearWatch(vigilancia);
  vigilancia = null;
  ultimoGps = null;
  mapa.quitarGPS();
  $("btn-gps").setAttribute("aria-pressed", "false");
}
$("btn-gps").addEventListener("click", () => {
  if (vigilancia != null) return detenerGps();
  if (!("geolocation" in navigator)) return aviso("Este navegador no tiene acceso a la ubicación.");
  if (!window.isSecureContext) return aviso("El GPS solo funciona abriendo la app con https:// o en este mismo equipo (localhost).", 7000);
  $("btn-gps").setAttribute("aria-pressed", "true");
  aviso("Buscando su ubicación…", 3000);
  cargarSeccionesYDistritos();
  vigilancia = navigator.geolocation.watchPosition(alPosicion, alErrorGps, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
});

// ---------- ajustes ----------
$("btn-ajustes").addEventListener("click", () => {
  $("ajustes-cuerpo").innerHTML = dibujarAjustes(estado.ajustes);
  $("ajustes").showModal();
});
$("ajustes-cancelar").addEventListener("click", () => $("ajustes").close());
$("ajustes-restablecer").addEventListener("click", () => {
  $("ajustes-cuerpo").innerHTML = dibujarAjustes({ ...AJUSTES_PREDETERMINADOS, modelos: { ...AJUSTES_PREDETERMINADOS.modelos } });
});
$("form-ajustes").addEventListener("submit", () => {
  const anterior = estado.ajustes;
  const nuevos = leerFormulario(anterior);
  estado.ajustes = nuevos;
  guardarAjustes(nuevos);
  if (nuevos.tema !== anterior.tema) {
    aplicarTema();
    location.reload();
    return;
  }
  const cambioModelos = JSON.stringify(nuevos.modelos) !== JSON.stringify(anterior.modelos) || nuevos.usarMetNo !== anterior.usarMetNo;
  if (estado.mapaDatos) procesarMapa(estado.mapaDatos);
  if (estado.registroDetalle) mostrarDetalle(estado.registroDetalle, { desdeCache: false });
  if (cambioModelos) {
    actualizarMapa();
    if (estado.lugar) cargarDetalle(estado.lugar);
  }
  clearTimeout(temporizadorRevision);
  temporizadorRevision = setTimeout(() => revisar(), nuevos.intervaloMin * 60000);
  pintarEstado();
});

// ---------- controles ----------
document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => cambiarModo(b.dataset.modo)));
$("variable").addEventListener("change", (ev) => {
  estado.variable = ev.target.value;
  repintarMapa();
  guardarHash();
});
$("dias").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-fecha]");
  if (b) elegirDia(b.dataset.fecha);
});
$("btn-actualizar").addEventListener("click", () => revisar({ forzar: true }));

// ---------- estado en la dirección (para compartir un enlace) ----------
function guardarHash() {
  const p = new URLSearchParams();
  p.set("m", estado.modo);
  p.set("v", estado.variable);
  const dia = estado.fechaPendiente || estado.fecha;
  if (estado.modo === "semana" && dia) p.set("d", dia);
  if (estado.lugar && estado.lugar.tipo !== "gps") {
    p.set("l", ["municipio", "distrito", "seccion"].includes(estado.lugar.tipo) ? `${estado.lugar.tipo}:${estado.lugar.id}` : `pt:${estado.lugar.lat},${estado.lugar.lon}:${estado.lugar.nombre}`);
  }
  history.replaceState(null, "", `#${p.toString()}`);
}
async function restaurarHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("v") && variablesMapa("in")[p.get("v")]) {
    estado.variable = p.get("v");
    $("variable").value = estado.variable;
    repintarMapa();
  }
  if (p.get("m") === "semana") {
    if (p.get("d")) estado.fechaPendiente = p.get("d");
    cambiarModo("semana");
    if (estado.fechas.includes(estado.fechaPendiente)) elegirDia(estado.fechaPendiente);
  }
  const l = p.get("l");
  if (!l) return;
  const i1 = l.indexOf(":");
  const tipo = l.slice(0, i1);
  const resto = l.slice(i1 + 1);
  if (tipo === "pt") {
    const i2 = resto.indexOf(":");
    const coords = i2 < 0 ? resto : resto.slice(0, i2);
    const nombre = i2 < 0 ? "" : resto.slice(i2 + 1);
    const [lat, lon] = coords.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const mun = municipioDe(lat, lon);
      seleccionar({ tipo: "punto", id: coords, nombre: nombre || "Punto", ruta: mun ? `${mun.properties.nombre} · ${mun.properties.provincia}` : "", lat, lon, feature: null, municipioId: mun?.properties.id });
    }
    return;
  }
  if (tipo !== "municipio") await cargarSeccionesYDistritos();
  const capa = { municipio: mapa.municipios, distrito: mapa.distritos, seccion: mapa.secciones || [] }[tipo] || [];
  const f = capa.find((x) => x.properties.id === resto);
  if (f) seleccionar(lugarDeFeature(tipo, f));
}

// ---------- capas finas ----------
let promesaFinas = null;
function cargarSeccionesYDistritos() {
  if (!promesaFinas) {
    promesaFinas = Promise.allSettled([mapa.cargarDistritos(), mapa.cargarSecciones ? mapa.cargarSecciones() : null]).then(() => construirIndice());
  }
  return promesaFinas;
}

// ---------- arranque ----------
async function iniciar() {
  $("variable").value = estado.variable;
  panel.vacio();
  pintarLeyenda();
  pintarEstado();
  const [proxy] = await Promise.all([
    fuentes.detectarProxy(),
    mapa.cargarLimites().catch((e) => {
      $("estado-texto").textContent = `Error cargando los límites: ${e.message}`;
      throw e;
    }),
  ]);
  void proxy;
  construirIndice();
  const guardado = await almacen.leer("mapa");
  const ids = mapa.municipios.map((f) => f.properties.id).join();
  if (guardado && guardado.ids?.join() === ids) procesarMapa(guardado);
  try {
    await restaurarHash();
  } catch {
    history.replaceState(null, "", "#");
  }
  revisar({ forzar: false });
  const ocioso = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  ocioso(() => cargarSeccionesYDistritos());
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
}
iniciar();
