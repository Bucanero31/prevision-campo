// Copia local de las últimas previsiones (IndexedDB), para abrir al instante y consultar sin conexión.
// Si el navegador no permite IndexedDB, todo sigue funcionando sin copia local.

const BD = "prevision-campo";
const TABLA = "datos";
const MAX_DETALLES = 40;
let promesaBD = null;

function abrir() {
  if (promesaBD) return promesaBD;
  promesaBD = new Promise((resolver) => {
    try {
      const pet = indexedDB.open(BD, 1);
      pet.onupgradeneeded = () => pet.result.createObjectStore(TABLA);
      pet.onsuccess = () => resolver(pet.result);
      pet.onerror = () => resolver(null);
      pet.onblocked = () => resolver(null);
    } catch {
      resolver(null);
    }
  });
  return promesaBD;
}

function operar(modo, fn) {
  return abrir().then(
    (bd) =>
      new Promise((resolver) => {
        if (!bd) return resolver(null);
        try {
          const tx = bd.transaction(TABLA, modo);
          const pet = fn(tx.objectStore(TABLA));
          tx.oncomplete = () => resolver(pet?.result ?? null);
          tx.onerror = tx.onabort = () => resolver(null);
        } catch {
          resolver(null);
        }
      }),
  );
}

export const leer = (clave) => operar("readonly", (t) => t.get(clave));
export const guardar = (clave, valor) => operar("readwrite", (t) => t.put(valor, clave));

// Las previsiones de lugares se guardan con fecha; se conservan solo las más recientes.
export async function guardarDetalle(clave, valor) {
  await guardar(`detalle:${clave}`, valor);
  const indice = (await leer("indice-detalles")) || [];
  const nuevo = [clave, ...indice.filter((c) => c !== clave)];
  for (const viejo of nuevo.splice(MAX_DETALLES)) await operar("readwrite", (t) => t.delete(`detalle:${viejo}`));
  await guardar("indice-detalles", nuevo);
}
export const leerDetalle = (clave) => leer(`detalle:${clave}`);
