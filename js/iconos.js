// Iconos SVG en línea (no dependen de fuentes ni de emojis del sistema).

const SOL = '<circle cx="16" cy="16" r="6" fill="#f5a300"/><g stroke="#f5a300" stroke-width="2.2" stroke-linecap="round"><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/></g>';
const SOL_CHICO = '<circle cx="11" cy="11" r="5" fill="#f5a300"/><g stroke="#f5a300" stroke-width="2" stroke-linecap="round"><path d="M11 2.5v2M11 17.5v2M2.5 11h2M17.5 11h2M5 5l1.4 1.4M15.6 15.6 17 17M5 17l1.4-1.4M15.6 6.4 17 5"/></g>';
const NUBE = (relleno) => `<path d="M9.5 27h14.2a5.8 5.8 0 0 0 .6-11.6A8 8 0 0 0 9 17.2 4.9 4.9 0 0 0 9.5 27z" fill="${relleno}" stroke="#8d8b85" stroke-width="1"/>`;
const GOTAS = (n) =>
  `<g stroke="#2a78d6" stroke-width="2.2" stroke-linecap="round">${[11, 16.5, 22]
    .slice(0, n)
    .map((x) => `<path d="M${x} 29.5l-1 2.5"/>`)
    .join("")}</g>`;
const RAYO = '<path d="M17 25.5l-3.5 5h3l-1.5 4.5 5-6h-3l2-3.5z" fill="#f5a300" stroke="#b37400" stroke-width=".6"/>';

const ENVOLVER = (contenido) => `<svg viewBox="0 0 32 36" aria-hidden="true">${contenido}</svg>`;

export const ICONOS_TIEMPO = {
  sol: ENVOLVER(`<g transform="translate(0 2)">${SOL}</g>`),
  parcial: ENVOLVER(`<g transform="translate(-2 -2)">${SOL_CHICO}</g><g transform="translate(2 0) scale(0.95)">${NUBE("#ffffff")}</g>`),
  nublado: ENVOLVER(`<g transform="translate(-3 -6) scale(0.8)">${NUBE("#d9d8d3")}</g><g transform="translate(1 -1)">${NUBE("#c6c5bf")}</g>`),
  llovizna: ENVOLVER(`<g transform="translate(0 -4)">${NUBE("#d9d8d3")}</g><g transform="translate(0 -3)">${GOTAS(2)}</g>`),
  lluvia: ENVOLVER(`<g transform="translate(0 -4)">${NUBE("#b9b8b2")}</g><g transform="translate(0 -3)">${GOTAS(3)}</g>`),
  tormenta: ENVOLVER(`<g transform="translate(0 -5)">${NUBE("#9c9b95")}</g><g transform="translate(-4 -3)">${GOTAS(1)}</g><g transform="translate(0 -4)">${RAYO}</g>`),
  sinDatos: ENVOLVER('<circle cx="16" cy="17" r="10" fill="none" stroke="#a3a198" stroke-width="2" stroke-dasharray="3 3"/>'),
};

const LINEA = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONOS_UI = {
  paraguas: LINEA('<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 0 4 0"/><path d="M12 3v0"/>'),
  gota: LINEA('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  nube: LINEA('<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18z"/>'),
  sol: LINEA('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>'),
  amanecer: LINEA('<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 4v5M9 7l3-3 3 3"/>'),
  atardecer: LINEA('<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 4v5M9 6l3 3 3-3"/>'),
  termometro: LINEA('<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>'),
  viento: LINEA('<path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h8"/>'),
  rayo: LINEA('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  reloj: LINEA('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  cerrar: LINEA('<path d="M6 6l12 12M18 6 6 18"/>'),
};

// Elige el icono a partir de los valores combinados (no de un solo modelo).
export function iconoSegunValores({ prob, lluviaIn, nubes, tormenta }) {
  if (prob == null && lluviaIn == null && nubes == null) return "sinDatos";
  if (tormenta && (prob ?? 0) >= 40) return "tormenta";
  if ((prob ?? 0) >= 55 && (lluviaIn ?? 0) >= 0.1) return "lluvia";
  if ((prob ?? 0) >= 35 && (lluviaIn ?? 0) >= 0.02) return "llovizna";
  if ((nubes ?? 0) >= 70) return "nublado";
  if ((nubes ?? 0) >= 30) return "parcial";
  return "sol";
}
export const NOMBRE_ICONO = {
  sol: "Mayormente soleado",
  parcial: "Parcialmente nublado",
  nublado: "Nublado",
  llovizna: "Lluvia ligera posible",
  lluvia: "Lluvia",
  tormenta: "Tormentas posibles",
  sinDatos: "Sin datos",
};
