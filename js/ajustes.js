// Ajustes del usuario (se guardan en este navegador).
import { leerLocal, guardarLocal, escaparHtml } from "./util.js";
import { MODELOS } from "./config.js";

const CLAVE = "prevision.ajustes.v1";

export const AJUSTES_PREDETERMINADOS = {
  unidad: "in", // "in" pulgadas o "mm"
  jornadaInicio: 7,
  jornadaFin: 17,
  // Umbrales de aptitud (se evalúan dentro de la jornada)
  probAviso: 30, // % a partir del cual se recomienda precaución
  probMalo: 60, // % a partir del cual no se recomienda
  lluviaAvisoIn: 0.04, // ~1 mm
  lluviaMaloIn: 0.2, // ~5 mm
  rafagasAviso: 40, // km/h
  rafagasMalo: 60, // km/h
  ventanaProb: 30, // % máximo por hora para la "mejor ventana"
  intervaloMin: 15, // minutos entre revisiones de datos nuevos
  modelos: Object.fromEntries(MODELOS.map((m) => [m.id, m.activo !== false])),
  usarMetNo: true,
  tema: "auto",
};

export function cargarAjustes() {
  const guardados = leerLocal(CLAVE, {});
  const a = { ...AJUSTES_PREDETERMINADOS, ...guardados };
  a.modelos = { ...AJUSTES_PREDETERMINADOS.modelos, ...(guardados.modelos || {}) };
  return a;
}
export function guardarAjustes(a) {
  guardarLocal(CLAVE, a);
}

const campoNum = (id, etiqueta, valor, { min, max, ayuda = "" } = {}) => `
  <label>${etiqueta}<input type="number" id="aj-${id}" value="${escaparHtml(valor)}" min="${min}" max="${max}" step="any" required></label>
  ${ayuda ? `<p class="ayuda">${ayuda}</p>` : ""}`;

export function dibujarAjustes(a) {
  const enUnidad = (pulg) => (a.unidad === "mm" ? Math.round(pulg * 25.4 * 10) / 10 : Math.round(pulg * 1000) / 1000);
  const u = a.unidad === "mm" ? "mm" : "in";
  const modelos = MODELOS.map(
    (m) => `<label class="casilla"><input type="checkbox" id="aj-mod-${m.id}" ${a.modelos[m.id] ? "checked" : ""}> ${escaparHtml(m.nombre)} <span class="muy-tenue">· ${escaparHtml(m.organismo)}</span></label>`,
  ).join("");
  // La unidad con que se dibujó el formulario: los umbrales de lluvia se leen en esa unidad.
  return `
    <input type="hidden" id="aj-unidad-formulario" value="${a.unidad === "mm" ? "mm" : "in"}">
    <fieldset><legend>Unidades</legend>
      <label>Lluvia en<select id="aj-unidad"><option value="in" ${a.unidad === "in" ? "selected" : ""}>pulgadas (in)</option><option value="mm" ${a.unidad === "mm" ? "selected" : ""}>milímetros (mm)</option></select></label>
      <label>Tema<select id="aj-tema"><option value="auto" ${a.tema === "auto" ? "selected" : ""}>Según el sistema</option><option value="light" ${a.tema === "light" ? "selected" : ""}>Claro</option><option value="dark" ${a.tema === "dark" ? "selected" : ""}>Oscuro</option></select></label>
    </fieldset>
    <fieldset><legend>Jornada de campo</legend>
      ${campoNum("jornadaInicio", "Inicio (hora, 0–23)", a.jornadaInicio, { min: 0, max: 22 })}
      ${campoNum("jornadaFin", "Fin (hora, 1–24)", a.jornadaFin, { min: 1, max: 24, ayuda: "La aptitud y la mejor ventana se calculan solo dentro de este horario." })}
    </fieldset>
    <fieldset><legend>Criterios de aptitud</legend>
      <p class="ayuda">Son criterios de planificación configurables, no un dato de las fuentes. Se aplican al valor combinado de la jornada.</p>
      ${campoNum("probAviso", "Precaución desde prob. de lluvia (%)", a.probAviso, { min: 0, max: 100 })}
      ${campoNum("probMalo", "No recomendado desde prob. (%)", a.probMalo, { min: 0, max: 100 })}
      ${campoNum("lluviaAviso", `Precaución desde lluvia en jornada (${u})`, enUnidad(a.lluviaAvisoIn), { min: 0, max: 500 })}
      ${campoNum("lluviaMalo", `No recomendado desde lluvia (${u})`, enUnidad(a.lluviaMaloIn), { min: 0, max: 500 })}
      ${campoNum("rafagasAviso", "Precaución desde ráfagas (km/h)", a.rafagasAviso, { min: 0, max: 300 })}
      ${campoNum("rafagasMalo", "No recomendado desde ráfagas (km/h)", a.rafagasMalo, { min: 0, max: 300 })}
      ${campoNum("ventanaProb", "Mejor ventana: prob. máxima por hora (%)", a.ventanaProb, { min: 0, max: 100 })}
    </fieldset>
    <fieldset><legend>Actualización</legend>
      <label>Revisar datos nuevos cada<select id="aj-intervalo">${[5, 10, 15, 30, 60]
        .map((m) => `<option value="${m}" ${a.intervaloMin === m ? "selected" : ""}>${m} min</option>`)
        .join("")}</select></label>
      <p class="ayuda">Los modelos publican corridas nuevas varias veces al día; la app revisa si hay corridas nuevas y solo entonces vuelve a descargar.</p>
    </fieldset>
    <fieldset><legend>Modelos a combinar</legend>
      <div class="modelos-grid">${modelos}</div>
      <label class="casilla"><input type="checkbox" id="aj-metno" ${a.usarMetNo ? "checked" : ""}> MET Norway (Instituto Meteorológico de Noruega)</label>
    </fieldset>`;
}

export function leerFormulario(anterior) {
  const v = (id) => document.getElementById(`aj-${id}`);
  const num = (id, porDefecto) => {
    const n = parseFloat(v(id).value);
    return Number.isFinite(n) ? n : porDefecto;
  };
  const unidadNueva = v("unidad").value;
  // Los umbrales de lluvia están escritos en la unidad con que se dibujó el formulario.
  const aPulg = (x) => (v("unidad-formulario").value === "mm" ? x / 25.4 : x);
  const a = {
    ...anterior,
    unidad: unidadNueva,
    tema: v("tema").value,
    jornadaInicio: Math.round(num("jornadaInicio", anterior.jornadaInicio)),
    jornadaFin: Math.round(num("jornadaFin", anterior.jornadaFin)),
    probAviso: num("probAviso", anterior.probAviso),
    probMalo: num("probMalo", anterior.probMalo),
    lluviaAvisoIn: aPulg(num("lluviaAviso", anterior.lluviaAvisoIn)),
    lluviaMaloIn: aPulg(num("lluviaMalo", anterior.lluviaMaloIn)),
    rafagasAviso: num("rafagasAviso", anterior.rafagasAviso),
    rafagasMalo: num("rafagasMalo", anterior.rafagasMalo),
    ventanaProb: num("ventanaProb", anterior.ventanaProb),
    intervaloMin: Number(v("intervalo").value),
    usarMetNo: v("metno").checked,
    modelos: Object.fromEntries(MODELOS.map((m) => [m.id, v(`mod-${m.id}`).checked])),
  };
  if (a.jornadaFin <= a.jornadaInicio) a.jornadaFin = Math.min(24, a.jornadaInicio + 1);
  if (a.probMalo < a.probAviso) a.probMalo = a.probAviso;
  if (a.lluviaMaloIn < a.lluviaAvisoIn) a.lluviaMaloIn = a.lluviaAvisoIn;
  if (a.rafagasMalo < a.rafagasAviso) a.rafagasMalo = a.rafagasAviso;
  if (!Object.values(a.modelos).some(Boolean)) a.modelos = { ...AJUSTES_PREDETERMINADOS.modelos };
  return a;
}
