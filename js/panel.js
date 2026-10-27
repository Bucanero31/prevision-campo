// Panel lateral (o inferior en móvil) con el detalle de la previsión del lugar elegido.
import { activarGrafico, graficoHorario } from "./grafico.js";
import { ICONOS_TIEMPO, ICONOS_UI, NOMBRE_ICONO, iconoSegunValores } from "./iconos.js";
import { SIMBOLO_ESTADO, TEXTO_ESTADO } from "./escalas.js";
import {
  ahoraRD, escaparHtml, fechaLarga, fmtHora12, fmtHoraIso, fmtHoras, fmtLluvia, fmtLluviaCorta, fmtPct, fmtUTC, haceCuanto, nombreDia, fechaCorta,
} from "./util.js";

const el = (id) => document.getElementById(id);

export class Panel {
  constructor({ alCerrar, alElegirDia, alReintentar }) {
    this.contenido = el("panel-contenido");
    this.raiz = el("panel");
    this.alCerrar = alCerrar;
    this.alElegirDia = alElegirDia;
    this.alReintentar = alReintentar;
    this.diaAbierto = null;
    el("panel-asa").addEventListener("click", () => this.raiz.classList.toggle("expandido"));
    this.contenido.addEventListener("click", (e) => this._clic(e));
  }

  _clic(e) {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === "cerrar") this.alCerrar();
    else if (accion === "reintentar") this.alReintentar();
    else if (accion === "dia") {
      const fecha = b.dataset.fecha;
      this.diaAbierto = this.diaAbierto === fecha ? null : fecha;
      this.alElegirDia(fecha);
      this._redibujar();
    } else if (accion === "tabla") {
      const t = b.closest(".seccion").querySelector("[data-tabla-horas]");
      t.hidden = !t.hidden;
      b.textContent = t.hidden ? "Ver tabla" : "Ocultar tabla";
    }
  }

  expandir(si = true) {
    this.raiz.classList.toggle("expandido", si);
    this.raiz.classList.remove("oculto");
  }

  vacio() {
    this.ultimo = null;
    this.raiz.classList.remove("expandido");
    this.contenido.innerHTML = `
      <div class="panel-vacio">
        <h2>Elija un lugar</h2>
        <p>Toque un municipio en el mapa, busque un municipio, distrito municipal o sección arriba, o active el GPS para ver la previsión donde está.</p>
        <ul>
          <li><b>Hoy</b>: hora por hora, mejor ventana de trabajo, amanecer y atardecer.</li>
          <li><b>Semana</b>: los próximos días con probabilidad y cantidad de lluvia, nubosidad y horas de sol.</li>
          <li>Al acercarse en el mapa aparecen los valores de cada municipio y, más cerca, las secciones.</li>
        </ul>
        <p class="nota-pie">Cada valor es una combinación de varios modelos meteorológicos de distintos servicios nacionales. Los colores del mapa siguen la variable y el día elegidos arriba.</p>
      </div>`;
  }

  cargando(lugar) {
    this.ultimo = null;
    this.contenido.innerHTML = `${this._cabecera(lugar)}<div class="cargando-bloque">Consultando las fuentes meteorológicas…</div>`;
  }

  error(lugar, mensaje) {
    this.ultimo = null;
    this.contenido.innerHTML = `${this._cabecera(lugar)}
      <div class="error-bloque"><b>No se pudo obtener la previsión.</b><br>${escaparHtml(mensaje)}<br>
      <button type="button" class="boton" data-accion="reintentar">Reintentar</button></div>`;
  }

  mostrar(pron, opciones) {
    this.ultimo = { pron, opciones };
    if (opciones.modo === "hoy") this.diaAbierto = null;
    this._redibujar();
  }

  refrescarOpciones(opciones) {
    if (!this.ultimo) return;
    this.ultimo.opciones = opciones;
    this._redibujar();
  }

  _redibujar() {
    if (!this.ultimo) return;
    const { pron, opciones } = this.ultimo;
    const scroll = this.raiz.scrollTop;
    const cuerpo = opciones.modo === "hoy" ? this._hoy(pron, opciones) : this._semana(pron, opciones);
    this.contenido.innerHTML = this._cabecera(pron.lugar, pron) + cuerpo + this._fuentes(pron);
    this.contenido.querySelectorAll("[data-grafico]").forEach((g) => {
      const dia = pron.dias.find((d) => d.fecha === g.closest("[data-dia]")?.dataset.dia);
      if (dia) activarGrafico(g, dia, opciones);
    });
    this.raiz.scrollTop = scroll;
  }

  _cabecera(lugar, pron) {
    const meta = [];
    if (pron) {
      meta.push(`${pron.lat.toFixed(4)}, ${pron.lon.toFixed(4)}`);
      if (pron.elevacion != null) meta.push(`${Math.round(pron.elevacion)} m s. n. m.`);
      const ok = pron.fuentes.filter((f) => f.ok).length;
      meta.push(`${ok} de ${pron.fuentes.length} fuentes`);
      meta.push(`actualizado ${haceCuanto(pron.generado)}`);
      if (pron.desdeCache) meta.push("⚠ copia guardada (sin conexión)");
    }
    return `
      <div class="cabecera-lugar">
        <h2>${escaparHtml(lugar.nombre)}</h2>
        <div class="ruta">${escaparHtml(lugar.ruta || "")}</div>
        ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${escaparHtml(m)}</span>`).join("")}</div>` : ""}
        <button type="button" class="btn-icono cerrar" data-accion="cerrar" title="Cerrar">${ICONOS_UI.cerrar}</button>
      </div>`;
  }

  _aptitud(dia, opciones, prefijo) {
    const a = dia.aptitud;
    if (!a) return "";
    return `
      <div class="aptitud ${a.nivel}">
        <span class="icono-estado" aria-hidden="true">${SIMBOLO_ESTADO[a.nivel]}</span>
        <div><strong>${prefijo}${TEXTO_ESTADO[a.nivel]} para trabajo de campo</strong>
        <p>${dia.jornada?.diaCompleto ? "Día completo" : "En la jornada"}: ${a.motivos.map(escaparHtml).join(" · ")}</p>
        <p class="muy-tenue">Jornada ${fmtHora12(opciones.jornada.inicio)} – ${fmtHora12(opciones.jornada.fin)} · criterios en Ajustes</p></div>
      </div>`;
  }

  _tarjetas(dia, { unidad }) {
    const t = (icono, etq, val, sub = "", barra = null) => `
      <div class="tarjeta"><div class="etq">${icono}${etq}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${
        barra ? `<div class="barra-mini"><i style="width:${Math.max(0, Math.min(100, barra.pct))}%;background:${barra.color}"></i></div>` : ""
      }</div>`;
    const rango =
      dia.lluviaMax != null && dia.lluviaMax > 0
        ? `Rango entre modelos: ${fmtLluviaCorta(dia.lluviaMin, unidad)}–${fmtLluviaCorta(dia.lluviaMax, unidad)} ${unidad === "mm" ? "mm" : "in"}`
        : "Ningún modelo prevé lluvia";
    const luzH = dia.luzSeg != null ? dia.luzSeg / 3600 : null;
    return `<div class="tarjetas">
      ${t(ICONOS_UI.paraguas, "Prob. de lluvia", fmtPct(dia.prob), `${dia.modelosConLluvia} de ${dia.modelosTotal} modelos prevén ≥ ${unidad === "mm" ? "1 mm" : "0.04 in"}`, { pct: dia.prob ?? 0, color: "var(--lluvia)" })}
      ${t(ICONOS_UI.gota, "Lluvia prevista", fmtLluvia(dia.lluviaIn, unidad, false), rango)}
      ${t(ICONOS_UI.nube, "Nubosidad media", fmtPct(dia.nubes), dia.nubesMin != null ? `De ${fmtPct(dia.nubesMin)} a ${fmtPct(dia.nubesMax)} según el modelo` : "", { pct: dia.nubes ?? 0, color: "var(--nubes)" })}
      ${t(ICONOS_UI.sol, "Horas de sol", fmtHoras(dia.solSeg), luzH != null ? `de ${luzH.toFixed(1)} h de luz del día` : "", { pct: luzH && dia.solSeg != null ? (dia.solSeg / dia.luzSeg) * 100 : 0, color: "var(--sol)" })}
      ${t(ICONOS_UI.amanecer, "Sale el sol", fmtHoraIso(dia.amanecer))}
      ${t(ICONOS_UI.atardecer, "Se pone el sol", fmtHoraIso(dia.atardecer))}
      ${t(ICONOS_UI.termometro, "Temperatura", dia.tMax != null ? `${Math.round(dia.tMax)}° <small>/ ${Math.round(dia.tMin)}°C</small>` : "—", "máxima / mínima")}
      ${t(ICONOS_UI.viento, "Ráfagas máx.", dia.rafagas != null ? `${Math.round(dia.rafagas)} <small>km/h</small>` : "—", dia.viento != null ? `viento medio máx. ${Math.round(dia.viento)} km/h` : "")}
    </div>`;
  }

  _ventana(dia) {
    const v = dia.ventana;
    let txt;
    if (v) txt = `<b>Mejor ventana para campo:</b> ${fmtHora12(v.inicio)} – ${fmtHora12(v.fin)} (prob. de lluvia ≤ ${v.umbral}% cada hora, con luz de día)`;
    else txt = "<b>Sin una ventana de 2 h o más</b> con baja probabilidad de lluvia y luz de día.";
    const tormenta = dia.tormenta ? `<br>${ICONOS_UI.rayo.replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} <b>Tormentas eléctricas posibles</b> según ${dia.modelosTormenta} modelo(s).` : "";
    return `<div class="ventana">${txt}${tormenta}</div>`;
  }

  _tablaHoras(dia, unidad) {
    const filas = dia.horas
      .map(
        (h) => `<tr><td>${fmtHora12(Number(h.hora.slice(11, 13)))}</td><td>${fmtPct(h.prob)}</td><td>${fmtLluviaCorta(h.lluviaIn, unidad)}</td><td>${fmtPct(h.nubes)}</td><td>${h.temp != null ? Math.round(h.temp) + "°" : "—"}</td><td>${h.rafagas != null ? Math.round(h.rafagas) : "—"}</td></tr>`,
      )
      .join("");
    return `<div class="tabla-scroll" data-tabla-horas hidden><table class="datos"><thead><tr><th>Hora</th><th>Prob.</th><th>Lluvia ${unidad === "mm" ? "mm" : "in"}</th><th>Nubes</th><th>Temp.</th><th>Ráfagas</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }

  _tablaModelos(dia, unidad) {
    const filas = dia.porModelo
      .map(
        (m) => `<tr><td class="modelo-nombre">${escaparHtml(m.nombre)}<small>${escaparHtml(m.organismo)}</small></td>
        <td>${m.prob == null ? '<span class="sin-dato">n/d</span>' : fmtPct(m.prob)}</td>
        <td>${fmtLluviaCorta(m.lluviaIn, unidad)}</td>
        <td>${m.nubes == null ? '<span class="sin-dato">n/d</span>' : fmtPct(m.nubes)}</td>
        <td>${m.solSeg == null ? '<span class="sin-dato">n/d</span>' : (m.solSeg / 3600).toFixed(1)}</td></tr>`,
      )
      .join("");
    return `<div class="tabla-scroll"><table class="datos">
      <thead><tr><th>Modelo</th><th>Prob.</th><th>Lluvia ${unidad === "mm" ? "mm" : "in"}</th><th>Nubes</th><th>Sol h</th></tr></thead>
      <tbody>${filas}
      <tr class="consenso"><td>Estimado combinado</td><td>${fmtPct(dia.prob)}</td><td>${fmtLluviaCorta(dia.lluviaIn, unidad)}</td><td>${fmtPct(dia.nubes)}</td><td>${dia.solSeg == null ? "—" : (dia.solSeg / 3600).toFixed(1)}</td></tr>
      </tbody></table></div>
      <p class="nota-pie">n/d: ese modelo no publica esa variable para este lugar o día. El estimado usa la mediana para la lluvia y el promedio para las demás variables.</p>`;
  }

  _detalleDia(dia, opciones, esHoy) {
    const ahora = ahoraRD();
    return `
      <div data-dia="${escaparHtml(dia.fecha)}">
        ${graficoHorario(dia, { unidad: opciones.unidad, jornada: opciones.jornada, ahoraHora: ahora.hora, esHoy })}
        <div style="margin-top:6px"><button type="button" class="enlace" data-accion="tabla">Ver tabla</button></div>
        ${this._tablaHoras(dia, opciones.unidad)}
      </div>`;
  }

  _hoy(pron, opciones) {
    const dia = pron.dias[0];
    if (!dia) return '<div class="error-bloque">Las fuentes no devolvieron datos para hoy.</div>';
    const icono = iconoSegunValores(dia);
    return `
      <div class="seccion">
        <h3><span>Hoy, ${escaparHtml(fechaLarga(dia.fecha))}</span><small>${NOMBRE_ICONO[icono]}</small></h3>
        ${this._aptitud(dia, opciones, "")}
        ${this._tarjetas(dia, opciones)}
        ${this._ventana(dia)}
      </div>
      <div class="seccion">
        <h3><span>Hora por hora</span><small>${dia.horas.length ? `${dia.horas[0].nModelos} modelos` : ""}</small></h3>
        ${this._detalleDia(dia, opciones, true)}
      </div>
      <div class="seccion">
        <h3><span>Comparación de modelos · hoy</span></h3>
        ${this._tablaModelos(dia, opciones.unidad)}
      </div>`;
  }

  _semana(pron, opciones) {
    const hoy = pron.dias[0]?.fecha;
    const filas = pron.dias
      .map((d) => {
        const abierto = this.diaAbierto === d.fecha;
        const icono = iconoSegunValores(d);
        const a = d.aptitud;
        return `
        <button type="button" class="dia-fila" data-accion="dia" data-fecha="${escaparHtml(d.fecha)}" aria-expanded="${abierto}">
          <span class="fecha"><strong>${nombreDia(d.fecha, hoy)}</strong><small>${escaparHtml(fechaCorta(d.fecha))}</small></span>
          <span class="icono" title="${NOMBRE_ICONO[icono]}">${ICONOS_TIEMPO[icono]}</span>
          <span class="datos-dia">
            ${a ? `<span class="chip ${a.nivel}"><i></i>${TEXTO_ESTADO[a.nivel]}</span> ` : ""}${d.tormenta ? "<span>⚡</span> " : ""}
            <span>☂ <b>${fmtPct(d.prob)}</b></span> · <span><b>${fmtLluvia(d.lluviaIn, opciones.unidad, false)}</b>${d.lluviaMax > 0 ? ` <span class="muy-tenue">(${fmtLluviaCorta(d.lluviaMin, opciones.unidad)}–${fmtLluviaCorta(d.lluviaMax, opciones.unidad)})</span>` : ""}</span><br>
            <span>Nubes ${fmtPct(d.nubes)}</span> · <span>Sol ${fmtHoras(d.solSeg)}</span> · <span>${d.tMax != null ? `${Math.round(d.tMax)}°/${Math.round(d.tMin)}°` : ""}</span><br>
            <span class="muy-tenue">Sale ${fmtHoraIso(d.amanecer)} · se pone ${fmtHoraIso(d.atardecer)} · ${d.modelosTotal} modelos</span>
          </span>
          <span class="muy-tenue" aria-hidden="true">${abierto ? "▴" : "▾"}</span>
        </button>
        ${
          abierto
            ? `<div class="dia-detalle">
                ${this._aptitud(d, opciones, "")}
                ${this._tarjetas(d, opciones)}
                ${this._ventana(d)}
                <h3 style="margin:14px 0 4px;font-size:13px">Hora por hora</h3>
                ${this._detalleDia(d, opciones, d.fecha === hoy)}
                <h3 style="margin:14px 0 6px;font-size:13px">Comparación de modelos</h3>
                ${this._tablaModelos(d, opciones.unidad)}
              </div>`
            : ""
        }`;
      })
      .join("");
    return `<div class="seccion"><h3><span>Próximos ${pron.dias.length} días</span><small>toque un día para ver el detalle</small></h3><div class="dias-lista">${filas}</div></div>`;
  }

  _fuentes(pron) {
    const filas = pron.fuentes
      .map(
        (f) => `<div><span><span class="${f.ok ? "ok" : "falla"}">${f.ok ? "●" : "○"}</span> ${escaparHtml(f.nombre)} <span class="muy-tenue">· ${escaparHtml(f.organismo)}</span></span>
        <span class="muy-tenue num">${f.ok ? (f.corrida ? `corrida ${escaparHtml(fmtUTC(f.corrida))}` : "") : escaparHtml(f.error || "sin datos")}</span></div>`,
      )
      .join("");
    return `<div class="seccion">
      <h3><span>Fuentes consultadas</span><small>${pron.fuentes.filter((f) => f.ok).length} activas</small></h3>
      <div class="fuentes-lista">${filas}</div>
      <p class="nota-pie" style="margin-top:10px">${escaparHtml(pron.notaMetodo || "")}</p>
    </div>`;
  }
}

