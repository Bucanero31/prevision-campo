// Utilidades generales: estadística, formato de fechas/horas/unidades y almacenamiento local.

export const MM_POR_PULGADA = 25.4;
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ---------- estadística (ignora null/undefined/NaN) ----------
export function validos(lista) {
  return lista.filter((v) => typeof v === "number" && Number.isFinite(v));
}
export function media(lista) {
  const v = validos(lista);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function mediana(lista) {
  const v = validos(lista).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function minimo(lista) {
  const v = validos(lista);
  return v.length ? Math.min(...v) : null;
}
export function maximo(lista) {
  const v = validos(lista);
  return v.length ? Math.max(...v) : null;
}
export function suma(lista) {
  const v = validos(lista);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}
export const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- fechas y horas ----------
// Las horas llegan de las fuentes como texto local de RD ("2026-10-27T06:58"); se tratan como texto
// para no depender de la zona horaria del equipo.
export function partesFecha(iso) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return { a, m, d, diaSemana };
}
export function fechaCorta(iso) {
  const p = partesFecha(iso);
  return `${DIAS_CORTOS[p.diaSemana]} ${p.d}`;
}
export function fechaLarga(iso) {
  const p = partesFecha(iso);
  return `${DIAS_LARGOS[p.diaSemana]} ${p.d} de ${MESES[p.m - 1]}`;
}
export function nombreDia(iso, hoyIso) {
  if (iso === hoyIso) return "Hoy";
  if (iso === sumarDias(hoyIso, 1)) return "Mañana";
  const p = partesFecha(iso);
  return DIAS_CORTOS[p.diaSemana].replace(/^./, (c) => c.toUpperCase());
}
export function sumarDias(iso, n) {
  const p = partesFecha(iso);
  return new Date(Date.UTC(p.a, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}
export function horaDe(isoHora) {
  const [h, mi] = isoHora.slice(11, 16).split(":").map(Number);
  return h + mi / 60;
}
export function fmtHora12(h, min = 0) {
  h %= 24; // 24:00 es medianoche
  const sufijo = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${sufijo}`;
}
export function fmtHoraIso(isoHora) {
  if (!isoHora) return "—";
  const [h, mi] = isoHora.slice(11, 16).split(":").map(Number);
  return fmtHora12(h, mi);
}
export function fmtHoraCorta(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? "a" : "p"}`;
}
// Fecha y hora actuales en RD (UTC-4 todo el año, sin horario de verano).
export function ahoraRD() {
  const d = new Date(Date.now() - 4 * 3600 * 1000);
  return { fecha: d.toISOString().slice(0, 10), hora: d.getUTCHours() + d.getUTCMinutes() / 60 };
}
export function fmtUTC(isoOEpoch) {
  const d = typeof isoOEpoch === "number" ? new Date(isoOEpoch * 1000) : new Date(isoOEpoch);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
export function haceCuanto(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h ${m % 60 ? (m % 60) + " min" : ""}`.trim();
  return `hace ${Math.round(h / 24)} días`;
}

// ---------- unidades ----------
export function fmtLluvia(pulgadas, unidad, conSecundaria = true) {
  if (pulgadas == null) return "—";
  const mm = pulgadas * MM_POR_PULGADA;
  const txtIn = `${pulgadas < 0.005 ? "0" : pulgadas.toFixed(2)} in`;
  const txtMm = `${mm < 0.05 ? "0" : mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
  if (unidad === "mm") return conSecundaria ? `${txtMm} (${txtIn})` : txtMm;
  return conSecundaria ? `${txtIn} (${txtMm})` : txtIn;
}
export function fmtLluviaCorta(pulgadas, unidad) {
  if (pulgadas == null) return "—";
  if (unidad === "mm") {
    const mm = pulgadas * MM_POR_PULGADA;
    return mm < 0.05 ? "0" : mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
  }
  return pulgadas < 0.005 ? "0" : pulgadas.toFixed(2);
}
export const fmtPct = (v) => (v == null ? "—" : `${Math.round(v)}%`);
export const fmtNum = (v, dec = 0) => (v == null ? "—" : v.toFixed(dec));
export function fmtHoras(segundos) {
  if (segundos == null) return "—";
  const h = segundos / 3600;
  return `${h.toFixed(1)} h`;
}

// ---------- texto ----------
export function normalizar(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function escaparHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- almacenamiento local (puede no estar disponible) ----------
export function leerLocal(clave, porDefecto = null) {
  try {
    const v = localStorage.getItem(clave);
    return v == null ? porDefecto : JSON.parse(v);
  } catch {
    return porDefecto;
  }
}
export function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}
export function borrarLocal(clave) {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* sin almacenamiento */
  }
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
