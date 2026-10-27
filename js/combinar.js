// Combina las series normalizadas de varios modelos en un único estimado por día y por hora,
// y evalúa la aptitud para trabajo de campo según los criterios del usuario.
//
// Serie normalizada de un modelo:
//   { id, nombre, organismo, corrida,
//     diario:  Map(fecha "AAAA-MM-DD" -> { lluviaIn, prob, nubes, solSeg, luzSeg, amanecer, atardecer, tMax, tMin, viento, rafagas, codigo }),
//     horario: Map(hora "AAAA-MM-DDTHH:00" -> { lluviaIn, prob, nubes, temp, viento, rafagas, codigo }) | null }
import { media, mediana, minimo, maximo, suma, validos, ahoraRD, fmtLluvia } from "./util.js";

export const UMBRAL_LLUVIA_IN = 0.04; // ≈ 1 mm: un modelo "prevé lluvia" ese día
const UMBRAL_LLUVIA_HORA_IN = 0.01; // ≈ 0.25 mm en una hora
const CODIGOS_TORMENTA = new Set([95, 96, 99]); // código WMO de tormenta

const esTormenta = (c) => typeof c === "number" && CODIGOS_TORMENTA.has(c);
// Se considera "posible" cuando al menos una cuarta parte de los modelos la prevén.
const hayTormenta = (k, n) => k >= 1 && n > 0 && k / n >= 0.25;

function horasDelDia(fecha) {
  return Array.from({ length: 24 }, (_, h) => `${fecha}T${String(h).padStart(2, "0")}:00`);
}

function combinarHora(series, hora) {
  const v = series.map((s) => s.horario?.get(hora)).filter(Boolean);
  const lluvias = v.map((x) => x.lluviaIn);
  const nLluvia = validos(lluvias).length;
  let prob = media(v.map((x) => x.prob));
  let probBase = "ensamble";
  if (prob == null && nLluvia) {
    prob = (validos(lluvias).filter((x) => x >= UMBRAL_LLUVIA_HORA_IN).length / nLluvia) * 100;
    probBase = "acuerdo";
  }
  const conCodigo = v.filter((x) => x.codigo != null);
  const kTormenta = conCodigo.filter((x) => esTormenta(x.codigo)).length;
  return {
    hora,
    prob,
    probBase,
    lluviaIn: mediana(lluvias),
    lluviaMin: minimo(lluvias),
    lluviaMax: maximo(lluvias),
    nubes: media(v.map((x) => x.nubes)),
    temp: media(v.map((x) => x.temp)),
    viento: media(v.map((x) => x.viento)),
    rafagas: media(v.map((x) => x.rafagas)),
    tormenta: conCodigo.length ? hayTormenta(kTormenta, conCodigo.length) : null,
    nModelos: nLluvia,
  };
}

function enJornada(hora, ajustes) {
  const h = Number(hora.slice(11, 13));
  return h >= ajustes.jornadaInicio && h < ajustes.jornadaFin;
}

// Valores de la jornada calculados por modelo (la lluvia se suma por modelo y luego se toma la mediana).
function jornadaDe(series, fecha, horas, ajustes) {
  const enHorario = horas.filter((h) => enJornada(h.hora, ajustes));
  if (!enHorario.length || !enHorario.some((h) => h.nModelos > 0)) return null;
  // Solo entran los modelos que cubren toda la jornada (una suma parcial subestimaría la lluvia).
  const sumasPorModelo = series
    .filter((s) => s.horario)
    .map((s) => {
      const vals = enHorario.map((h) => s.horario.get(h.hora)?.lluviaIn);
      return validos(vals).length === enHorario.length ? suma(vals) : null;
    });
  const conCodigo = enHorario.filter((h) => h.tormenta != null);
  return {
    prob: maximo(enHorario.map((h) => h.prob)),
    lluviaIn: mediana(sumasPorModelo),
    rafagas: maximo(enHorario.map((h) => h.rafagas)),
    tormenta: conCodigo.length ? conCodigo.some((h) => h.tormenta) : null,
    nubes: media(enHorario.map((h) => h.nubes)),
  };
}

export function evaluarAptitud(j, ajustes, unidad) {
  if (!j || (j.prob == null && j.lluviaIn == null)) return null;
  const orden = { bueno: 0, aviso: 1, malo: 2 };
  let nivel = "bueno";
  const subir = (n) => {
    if (orden[n] > orden[nivel]) nivel = n;
  };
  const motivos = [];
  if (j.prob != null) {
    if (j.prob >= ajustes.probMalo) subir("malo");
    else if (j.prob >= ajustes.probAviso) subir("aviso");
    motivos.push(`prob. de lluvia hasta ${Math.round(j.prob)}%`);
  }
  if (j.lluviaIn != null) {
    if (j.lluviaIn >= ajustes.lluviaMaloIn) subir("malo");
    else if (j.lluviaIn >= ajustes.lluviaAvisoIn) subir("aviso");
    motivos.push(`lluvia ${fmtLluvia(j.lluviaIn, unidad, false)}`);
  }
  if (j.rafagas != null) {
    if (j.rafagas >= ajustes.rafagasMalo) subir("malo");
    else if (j.rafagas >= ajustes.rafagasAviso) subir("aviso");
    if (j.rafagas >= ajustes.rafagasAviso) motivos.push(`ráfagas hasta ${Math.round(j.rafagas)} km/h`);
  }
  if (j.tormenta) {
    subir("aviso");
    motivos.push("tormentas posibles");
  }
  return { nivel, motivos };
}

// Mayor tramo seguido de horas con luz, dentro de la jornada y con baja probabilidad de lluvia.
function mejorVentana(horas, dia, ajustes, desdeHora) {
  const sale = dia.amanecer ? Number(dia.amanecer.slice(11, 13)) + Number(dia.amanecer.slice(14, 16)) / 60 : 6;
  const pone = dia.atardecer ? Number(dia.atardecer.slice(11, 13)) + Number(dia.atardecer.slice(14, 16)) / 60 : 18;
  let mejor = null;
  let inicio = null;
  const cerrar = (fin) => {
    if (inicio != null && fin - inicio >= 2 && (!mejor || fin - inicio > mejor.fin - mejor.inicio)) mejor = { inicio, fin };
    inicio = null;
  };
  for (let h = 0; h < 24; h++) {
    const x = horas[h];
    const apta =
      x &&
      h >= ajustes.jornadaInicio &&
      h < ajustes.jornadaFin &&
      h >= sale &&
      h + 1 <= pone &&
      h >= desdeHora &&
      x.prob != null &&
      x.prob <= ajustes.ventanaProb &&
      !x.tormenta;
    if (apta && inicio == null) inicio = h;
    if (!apta) cerrar(h);
  }
  cerrar(24);
  return mejor ? { ...mejor, umbral: ajustes.ventanaProb } : null;
}

export function combinarDia(series, fecha, ajustes, { conHoras = true } = {}) {
  const diarios = series.map((s) => ({ s, d: s.diario?.get(fecha) })).filter((x) => x.d);
  if (!diarios.length) return null;
  const val = (k) => diarios.map((x) => x.d[k]);
  const lluvias = val("lluviaIn");
  const nLluvia = validos(lluvias).length;
  let prob = media(val("prob"));
  let probBase = "ensamble";
  const conLluvia = validos(lluvias).filter((x) => x >= UMBRAL_LLUVIA_IN).length;
  if (prob == null && nLluvia) {
    prob = (conLluvia / nLluvia) * 100;
    probBase = "acuerdo";
  }
  const kTormenta = diarios.filter((x) => esTormenta(x.d.codigo)).length;
  const primero = (k) => diarios.map((x) => x.d[k]).find((v) => v != null) ?? null;

  const dia = {
    fecha,
    prob,
    probBase,
    lluviaIn: mediana(lluvias),
    lluviaMin: minimo(lluvias),
    lluviaMax: maximo(lluvias),
    modelosConLluvia: conLluvia,
    modelosTotal: nLluvia,
    nubes: media(val("nubes")),
    nubesMin: minimo(val("nubes")),
    nubesMax: maximo(val("nubes")),
    solSeg: media(val("solSeg")),
    luzSeg: primero("luzSeg"),
    amanecer: primero("amanecer"),
    atardecer: primero("atardecer"),
    tMax: media(val("tMax")),
    tMin: media(val("tMin")),
    viento: media(val("viento")),
    rafagas: media(val("rafagas")),
    modelosTormenta: kTormenta,
    tormenta: hayTormenta(kTormenta, diarios.length),
    porModelo: diarios.map(({ s, d }) => ({
      id: s.id,
      nombre: s.nombre,
      organismo: s.organismo,
      prob: d.prob ?? null,
      lluviaIn: d.lluviaIn ?? null,
      nubes: d.nubes ?? null,
      solSeg: d.solSeg ?? null,
    })),
    horas: [],
  };

  let jornada = null;
  if (conHoras && series.some((s) => s.horario)) {
    dia.horas = horasDelDia(fecha).map((h) => combinarHora(series, h)).filter((h) => h.nModelos > 0 || h.prob != null);
    const porHora = Array(24).fill(null);
    for (const h of dia.horas) porHora[Number(h.hora.slice(11, 13))] = h;
    jornada = jornadaDe(series, fecha, dia.horas, ajustes);
    const ahora = ahoraRD();
    const desde = fecha === ahora.fecha ? Math.ceil(ahora.hora) : 0;
    dia.ventana = mejorVentana(porHora, dia, ajustes, desde);
  }
  // Sin datos horarios se usa el día completo (24 h) como aproximación de la jornada; lo mismo para
  // cada dato que falte en las horas (p. ej. ráfagas o tormentas si ningún modelo los da por hora).
  if (jornada) {
    jornada.prob ??= dia.prob;
    jornada.lluviaIn ??= dia.lluviaIn;
    jornada.rafagas ??= dia.rafagas;
    jornada.tormenta ??= dia.tormenta;
  }
  dia.jornada = jornada || { prob: dia.prob, lluviaIn: dia.lluviaIn, rafagas: dia.rafagas, tormenta: dia.tormenta, nubes: dia.nubes, diaCompleto: true };
  dia.aptitud = evaluarAptitud(dia.jornada, ajustes, ajustes.unidad);
  return dia;
}

export function combinar(series, fechas, ajustes, opciones) {
  return fechas.map((f) => combinarDia(series, f, ajustes, opciones)).filter(Boolean);
}
