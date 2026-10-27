// Gráficos horarios de un día: (1) probabilidad de lluvia y nubosidad, ambas en %, mismo eje;
// (2) lluvia prevista por hora. Se comparte el eje de horas y el cursor.
import { fmtHora12, fmtHoraCorta, fmtLluvia, fmtLluviaCorta, fmtPct, horaDe, MM_POR_PULGADA } from "./util.js";

const ANCHO = 400;
const IZQ = 30;
const DER = 6;
const ALTO_1 = 118;
const ALTO_2 = 74;

const horaNum = (h) => Number(h.hora.slice(11, 13));

function x(i, n) {
  return IZQ + ((ANCHO - IZQ - DER) * (i + 0.5)) / n;
}

export function graficoHorario(dia, { unidad, jornada, ahoraHora, esHoy }) {
  const horas = dia.horas;
  if (!horas.length) return '<p class="nota-pie">No hay datos horarios para este día.</p>';
  // Cada barra va en su hora del día (0–23), aunque falten horas en los datos.
  const n = 24;
  const paso = (ANCHO - IZQ - DER) / n;
  const anchoBarra = Math.max(2, paso - 2);
  const amanecer = dia.amanecer ? horaDe(dia.amanecer) : null;
  const atardecer = dia.atardecer ? horaDe(dia.atardecer) : null;
  const xHora = (h) => IZQ + ((ANCHO - IZQ - DER) * h) / 24;

  // ---- gráfico 1: prob. de lluvia (barras) + nubosidad (línea) ----
  const y1 = (v) => 8 + (ALTO_1 - 26) * (1 - v / 100);
  let g1 = "";
  if (amanecer != null) g1 += `<rect class="noche" x="${IZQ}" y="8" width="${xHora(amanecer) - IZQ}" height="${ALTO_1 - 26}"/>`;
  if (atardecer != null) g1 += `<rect class="noche" x="${xHora(atardecer)}" y="8" width="${ANCHO - DER - xHora(atardecer)}" height="${ALTO_1 - 26}"/>`;
  for (const v of [0, 25, 50, 75, 100]) {
    g1 += `<line class="${v ? "rejilla" : "base"}" x1="${IZQ}" x2="${ANCHO - DER}" y1="${y1(v)}" y2="${y1(v)}"/>`;
    g1 += `<text class="eje-texto" x="${IZQ - 4}" y="${y1(v) + 3}" text-anchor="end">${v}%</text>`;
  }
  g1 += `<rect class="jornada" x="${xHora(jornada.inicio)}" y="6" width="${xHora(jornada.fin) - xHora(jornada.inicio)}" height="${ALTO_1 - 22}" rx="3"/>`;
  horas.forEach((h) => {
    if (h.prob == null) return;
    const alto = Math.max(0, y1(0) - y1(h.prob));
    if (alto < 0.5) return;
    const top = y1(h.prob);
    const r = Math.min(3, anchoBarra / 2, alto);
    g1 += `<path fill="var(--lluvia)" d="M${x(horaNum(h), n) - anchoBarra / 2},${y1(0)}V${top + r}q0,-${r} ${r},-${r}h${anchoBarra - 2 * r}q${r},0 ${r},${r}V${y1(0)}z"/>`;
  });
  const porHora = Array(24).fill(null);
  for (const h of horas) porHora[horaNum(h)] = h;
  const puntosNubes = porHora.map((h, i) => (h?.nubes == null ? null : `${x(i, n).toFixed(1)},${y1(h.nubes).toFixed(1)}`));
  let tramo = [];
  const tramos = [];
  for (const p of puntosNubes) {
    if (p) tramo.push(p);
    else if (tramo.length) tramos.push(tramo), (tramo = []);
  }
  if (tramo.length) tramos.push(tramo);
  for (const t of tramos) g1 += `<polyline points="${t.join(" ")}" fill="none" stroke="var(--nubes)" stroke-width="2" stroke-linejoin="round"/>`;
  for (let hh = 0; hh <= 24; hh += 3) {
    g1 += `<text class="eje-texto" x="${xHora(hh)}" y="${ALTO_1 - 6}" text-anchor="middle">${hh === 24 ? "" : fmtHoraCorta(hh)}</text>`;
  }
  if (esHoy && ahoraHora != null) g1 += `<line class="ahora" x1="${xHora(ahoraHora)}" x2="${xHora(ahoraHora)}" y1="6" y2="${ALTO_1 - 18}"/>`;

  // ---- gráfico 2: lluvia por hora ----
  const factor = unidad === "mm" ? MM_POR_PULGADA : 1;
  // La escala sigue al estimado (mediana); los extremos de algún modelo se recortan arriba.
  const maxDato = Math.max(...horas.map((h) => (h.lluviaIn ?? 0) * factor), 0) * 1.25;
  const tope = unidad === "mm" ? Math.max(1, Math.ceil(maxDato)) : Math.max(0.04, Math.ceil(maxDato * 50) / 50);
  const y2 = (v) => 6 + (ALTO_2 - 22) * (1 - Math.min(v, tope) / tope);
  let g2 = "";
  if (amanecer != null) g2 += `<rect class="noche" x="${IZQ}" y="6" width="${xHora(amanecer) - IZQ}" height="${ALTO_2 - 22}"/>`;
  if (atardecer != null) g2 += `<rect class="noche" x="${xHora(atardecer)}" y="6" width="${ANCHO - DER - xHora(atardecer)}" height="${ALTO_2 - 22}"/>`;
  for (const v of [0, tope / 2, tope]) {
    g2 += `<line class="${v ? "rejilla" : "base"}" x1="${IZQ}" x2="${ANCHO - DER}" y1="${y2(v)}" y2="${y2(v)}"/>`;
    const txt = unidad === "mm" ? String(Math.round(v * 10) / 10) : v.toFixed(2);
    g2 += `<text class="eje-texto" x="${IZQ - 4}" y="${y2(v) + 3}" text-anchor="end">${v ? txt : "0"}</text>`;
  }
  horas.forEach((h) => {
    if (h.lluviaMax != null && h.lluviaMax > (h.lluviaIn ?? 0)) {
      const xi = x(horaNum(h), n);
      g2 += `<line x1="${xi}" x2="${xi}" y1="${y2((h.lluviaMin ?? 0) * factor)}" y2="${y2(h.lluviaMax * factor)}" stroke="var(--tinta-3)" stroke-width="1"/>`;
    }
    if (h.lluviaIn == null || h.lluviaIn * factor <= 0) return;
    const top = y2(h.lluviaIn * factor);
    const alto = y2(0) - top;
    if (alto < 0.5) return;
    const r = Math.min(3, anchoBarra / 2, alto);
    g2 += `<path fill="var(--acento-tinta)" d="M${x(horaNum(h), n) - anchoBarra / 2},${y2(0)}V${top + r}q0,-${r} ${r},-${r}h${anchoBarra - 2 * r}q${r},0 ${r},${r}V${y2(0)}z"/>`;
  });
  for (let hh = 0; hh <= 24; hh += 3) {
    g2 += `<text class="eje-texto" x="${xHora(hh)}" y="${ALTO_2 - 6}" text-anchor="middle">${hh === 24 ? "" : fmtHoraCorta(hh)}</text>`;
  }
  if (esHoy && ahoraHora != null) g2 += `<line class="ahora" x1="${xHora(ahoraHora)}" x2="${xHora(ahoraHora)}" y1="4" y2="${ALTO_2 - 18}"/>`;

  const unidadTxt = unidad === "mm" ? "mm" : "pulgadas";
  return `
  <div class="grafico" data-grafico>
    <div class="titulo-g"><span class="clave"><i class="bloque" style="background:var(--lluvia)"></i>Prob. de lluvia</span><span class="clave"><i style="background:var(--nubes)"></i>Nubosidad</span><span class="clave"><i class="bloque" style="background:var(--superficie-2);outline:1px solid var(--rejilla)"></i>Noche</span><span class="clave"><i style="border-top:1px dashed var(--acento);height:0"></i>Jornada</span></div>
    <svg viewBox="0 0 ${ANCHO} ${ALTO_1}" role="img" aria-label="Probabilidad de lluvia y nubosidad por hora">${g1}<line class="cursor" x1="0" x2="0" y1="6" y2="${ALTO_1 - 18}" visibility="hidden"/></svg>
    <div class="titulo-g"><span class="clave"><i class="bloque" style="background:var(--acento-tinta)"></i>Lluvia por hora (${unidadTxt}, estimado)</span><span class="clave"><i style="width:1px;height:10px;background:var(--tinta-3)"></i>Rango entre modelos</span></div>
    <svg viewBox="0 0 ${ANCHO} ${ALTO_2}" role="img" aria-label="Lluvia prevista por hora">${g2}<line class="cursor" x1="0" x2="0" y1="4" y2="${ALTO_2 - 18}" visibility="hidden"/></svg>
    <div class="tooltip-g" hidden></div>
  </div>`;
}

// Activa el cursor y la ventana de datos al pasar el ratón o el dedo.
export function activarGrafico(contenedor, dia, { unidad }) {
  const tip = contenedor.querySelector(".tooltip-g");
  const svgs = [...contenedor.querySelectorAll("svg")];
  const cursores = [...contenedor.querySelectorAll(".cursor")];
  const n = 24;
  const mostrar = (evento) => {
    const caja = svgs[0].getBoundingClientRect();
    const px = ((evento.touches ? evento.touches[0].clientX : evento.clientX) - caja.left) * (ANCHO / caja.width);
    const i = Math.floor(((px - IZQ) / (ANCHO - IZQ - DER)) * n);
    if (i < 0 || i >= n) return ocultar();
    const h = dia.horas.find((hr) => horaNum(hr) === i);
    if (!h) return ocultar();
    const xi = x(i, n);
    cursores.forEach((c) => {
      c.setAttribute("x1", xi);
      c.setAttribute("x2", xi);
      c.setAttribute("visibility", "visible");
    });
    const hora = Number(h.hora.slice(11, 13));
    tip.innerHTML =
      `<b>${fmtHora12(hora)}</b>` +
      `Prob. lluvia: ${fmtPct(h.prob)}<br>` +
      `Lluvia: ${fmtLluvia(h.lluviaIn, unidad, false)}${h.lluviaMax != null && h.lluviaMax > 0 ? ` <span class="muy-tenue">(${fmtLluviaCorta(h.lluviaMin ?? 0, unidad)}–${fmtLluviaCorta(h.lluviaMax, unidad)})</span>` : ""}<br>` +
      `Nubosidad: ${fmtPct(h.nubes)}<br>` +
      (h.temp != null ? `Temperatura: ${Math.round(h.temp)} °C<br>` : "") +
      (h.rafagas != null ? `Ráfagas: ${Math.round(h.rafagas)} km/h<br>` : "") +
      (h.tormenta ? "⚡ Tormenta posible<br>" : "") +
      `<span class="muy-tenue">${h.nModelos} modelos</span>`;
    tip.hidden = false;
    const cajaC = contenedor.getBoundingClientRect();
    const xPx = (xi / ANCHO) * caja.width + (caja.left - cajaC.left);
    const anchoTip = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, xPx + 12 + anchoTip > cajaC.width ? xPx - anchoTip - 12 : xPx + 12), cajaC.width - anchoTip)}px`;
    tip.style.top = "24px";
  };
  const ocultar = () => {
    tip.hidden = true;
    cursores.forEach((c) => c.setAttribute("visibility", "hidden"));
  };
  for (const s of svgs) {
    s.addEventListener("mousemove", mostrar);
    s.addEventListener("mouseleave", ocultar);
    s.addEventListener("touchstart", mostrar, { passive: true });
    s.addEventListener("touchmove", mostrar, { passive: true });
  }
}
