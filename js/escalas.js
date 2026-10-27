// Escalas de color del mapa. Secuenciales de un solo tono (claro = poco, oscuro = mucho);
// la aptitud usa los colores de estado y siempre va acompañada de icono y texto.
import { MM_POR_PULGADA } from "./util.js";

const AZUL = ["#eef5fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const GRIS = ["#f7f7f5", "#e7e6e1", "#d3d2cb", "#bdbcb4", "#a3a198", "#86847b", "#6a6861", "#4d4c47"];
const NARANJA = ["#fff4e0", "#ffe2b0", "#ffcd7a", "#ffb547", "#f59b1a", "#d97f00", "#b06500", "#874c00"];

export const COLOR_ESTADO = { bueno: "#0ca30c", aviso: "#fab219", malo: "#d03b3b" };
export const TEXTO_ESTADO = { bueno: "Apto", aviso: "Precaución", malo: "No recomendado" };
export const SIMBOLO_ESTADO = { bueno: "✓", aviso: "!", malo: "✕" };

function escalonada(cortes, colores) {
  return (v) => {
    if (v == null) return null;
    let i = 0;
    while (i < cortes.length && v >= cortes[i]) i++;
    return colores[i];
  };
}

// Cada variable: cómo obtener el valor de un día combinado, color, leyenda y texto de etiqueta.
export function variablesMapa(unidad) {
  const cortesLluviaIn = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2];
  const etiquetasLluvia =
    unidad === "mm"
      ? cortesLluviaIn.map((c) => String(Math.round(c * MM_POR_PULGADA * 10) / 10))
      : cortesLluviaIn.map((c) => String(c));
  return {
    aptitud: {
      titulo: "Aptitud para campo",
      valor: (d) => d?.aptitud?.nivel ?? null,
      color: (v) => (v ? COLOR_ESTADO[v] : null),
      categorias: ["bueno", "aviso", "malo"],
      etiqueta: (d) => (d?.aptitud ? TEXTO_ESTADO[d.aptitud.nivel] : "—"),
    },
    prob: {
      titulo: "Probabilidad de lluvia (máx. del día)",
      valor: (d) => d?.prob ?? null,
      color: escalonada([10, 20, 30, 45, 60, 75, 90], AZUL),
      escala: AZUL,
      marcas: ["0", "30", "60", "90 %"],
      etiqueta: (d) => (d?.prob == null ? "—" : `${Math.round(d.prob)}%`),
    },
    lluvia: {
      titulo: `Lluvia prevista (${unidad === "mm" ? "mm" : "pulgadas"})`,
      valor: (d) => d?.lluviaIn ?? null,
      color: escalonada(cortesLluviaIn, AZUL),
      escala: AZUL,
      marcas: ["0", etiquetasLluvia[2], etiquetasLluvia[4], `${etiquetasLluvia[6]}+`],
      etiqueta: (d) => {
        if (d?.lluviaIn == null) return "—";
        return unidad === "mm" ? `${(d.lluviaIn * MM_POR_PULGADA).toFixed(1)} mm` : `${d.lluviaIn.toFixed(2)} in`;
      },
    },
    nubes: {
      titulo: "Nubosidad media del día",
      valor: (d) => d?.nubes ?? null,
      color: escalonada([15, 30, 45, 60, 70, 80, 90], GRIS),
      escala: GRIS,
      marcas: ["0", "45", "70", "90 %"],
      etiqueta: (d) => (d?.nubes == null ? "—" : `${Math.round(d.nubes)}%`),
    },
    sol: {
      titulo: "Horas de sol",
      valor: (d) => (d?.solSeg == null ? null : d.solSeg / 3600),
      color: escalonada([1, 2, 4, 6, 8, 9, 10], NARANJA),
      escala: NARANJA,
      marcas: ["0", "4", "8", "10+ h"],
      etiqueta: (d) => (d?.solSeg == null ? "—" : `${(d.solSeg / 3600).toFixed(1)} h`),
    },
  };
}
