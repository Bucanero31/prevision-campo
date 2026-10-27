# Previsión de campo · Lexgeo

Mapa interactivo de República Dominicana con la previsión del tiempo por municipio, distrito
municipal y sección, combinando varios modelos meteorológicos, para planificar días de trabajo de campo.

## Cómo abrirla

1. Doble clic en **`iniciar.bat`** (necesita Python 3, ya instalado en este equipo).
2. Se abre el navegador en `http://localhost:8765/`. La ventana negra es el servidor: déjela abierta.
3. Otros equipos de la oficina pueden entrar con la dirección "En la red local" que muestra esa ventana.

> **GPS en el teléfono:** los navegadores solo dan la ubicación en páginas `https://` (o en `localhost`).
> Desde la red local (`http://192.168…`) la app funciona, pero el botón de GPS no. Para usar el GPS en
> campo hay que publicarla con `https` (por ejemplo en el NAS con certificado, o un hosting estático).

## Qué muestra

| Dato | Cómo se calcula |
|---|---|
| Probabilidad de lluvia | Promedio de las probabilidades que publican los modelos con sistema de ensamble (ECMWF, GFS, ICON, GEM, UKMO). Si ningún modelo la publica para ese día, porcentaje de modelos que prevén ≥ 1 mm (se indica). |
| Lluvia prevista (pulgadas y mm) | Mediana de todos los modelos, con el rango mínimo–máximo entre modelos. |
| Nubosidad, horas de sol, temperatura, viento | Promedio de los modelos. |
| Salida y puesta del sol | Cálculo astronómico que devuelve Open-Meteo para el punto. |
| Tormentas | Se marcan si al menos ¼ de los modelos prevén código de tormenta (95/96/99). |
| Aptitud para campo | Criterio **configurable** (Ajustes) sobre la jornada de trabajo: probabilidad, lluvia, ráfagas y tormentas. No es un dato de las fuentes. |
| Mejor ventana | El tramo más largo (≥ 2 h) dentro de la jornada, con luz de día y probabilidad por hora bajo el umbral. |

- **Hoy:** tarjetas del día, gráfico hora por hora (probabilidad, nubosidad, lluvia por hora con su rango), tabla por modelo.
- **Semana:** 7 días; al tocar un día se abre su detalle y el mapa pasa a ese día.
- **Mapa:** colorea cada municipio por la variable y el día elegidos. Al acercarse aparecen etiquetas con
  el valor, luego los nombres, después los distritos municipales (zoom 10) y las secciones (zoom 12).
- **GPS:** sigue su posición y actualiza la previsión al cambiar de sección o al moverse más de 2 km.
- **Enlace:** la dirección de la página guarda el lugar, el modo y el día, para compartirla.
- **Sin conexión:** la última previsión de cada lugar consultado y del mapa queda guardada en el navegador.

## Fuentes (verificadas con peticiones reales el 27-oct-2026)

Vía **Open-Meteo** (datos CC BY 4.0), con datos para RD:

| Modelo | Organismo | Días con lluvia | Probabilidad |
|---|---|---|---|
| ECMWF IFS 9 km | Centro Europeo (ECMWF) | 14 | sí |
| GFS | NOAA, EE. UU. | 16 | sí |
| ICON | DWD, Alemania | 7 | sí |
| GEM | Environment Canada | 9 | sí |
| UKMO 10 km | Met Office, Reino Unido | 6 | sí |
| GSM | JMA, Japón | 11 | no |
| ARPEGE | Météo-France | 4 | no |
| GRAPES | CMA, China | 5 | no |
| AIFS (IA) | ECMWF | 15 | no |
| AIGFS (IA) | NOAA | 16 | no |

Directo: **MET Norway** (Instituto Meteorológico de Noruega), datos horarios ~60 h. Sus condiciones exigen
pasar por un servidor propio que identifique la aplicación: por eso solo se usa con `servidor.py`.

Descartados por devolver datos vacíos para RD: KMA (Corea), BOM (Australia), `gfs025`, `ecmwf_aifs025`.
Descartados por no permitir su uso desde el navegador o por ser copia de GFS: 7Timer. ONAMET no publica una API.

## Límites de uso (importante)

Open-Meteo gratuito: **600 consultas/min, 5 000/hora, 10 000/día, solo uso no comercial**. Su documentación no
dice cómo cuentan varios puntos y modelos en una petición, pero en la prueba el mapa completo de una vez
(155 municipios × 5 modelos) agotó el cupo por minuto: se trata como si consumiera ~775 consultas. Por eso:

- El mapa se descarga en dos tandas separadas por un minuto, y como mucho cada 3 horas, solo cuando un
  modelo publica una corrida nueva (la app revisa cada 15 min los metadatos de corridas, que son gratuitos).
- El servidor local comparte la caché entre todos los usuarios de la oficina.
- Con la pestaña oculta no se consulta nada.

**Uso comercial:** las condiciones de Open-Meteo consideran comercial el uso por una empresa. Para uso
profesional continuado corresponde una suscripción de Open-Meteo (su URL lleva el prefijo `customer-` y una clave).

## Límites territoriales

Origen: división territorial de la ONE en KMZ (`C:\Users\Tecnico\Documents\DIVISION TERRITORIAL KMZ`,
archivos de 16-oct-2024), convertida a GeoJSON simplificado sin huecos ni solapes entre vecinos.
Los `id` son el código ENLACE de la ONE (región + provincia + municipio + DM + sección).

| Archivo | Unidades | Uso |
|---|---|---|
| `provincias.geojson` | 32 (incl. Distrito Nacional) | contornos |
| `municipios.geojson` | 155 | mapa coloreado (previsión de cada municipio) |
| `distritos.geojson` | 386 (155 zonas cabecera + 231 distritos municipales) | visibles desde zoom 10 |
| `secciones.geojson` | 1 565 (386 urbanas, 1 179 rurales) | visibles desde zoom 12 |
| `lugares.json` | 12 565 barrios (zona urbana) y parajes (zona rural) | búsqueda |

La previsión de un distrito, sección o barrio/paraje se calcula para su punto interior. Ojo: la
resolución de los modelos globales es de varios kilómetros (p. ej. ECMWF IFS 9 km, UKMO 10 km), así que secciones vecinas suelen dar valores parecidos.

## Notas técnicas verificadas

- En Open-Meteo la lluvia, su probabilidad y las ráfagas horarias corresponden a la **hora anterior**
  (documentación oficial); la app las coloca en su tramo real. MET Norway ya publica el tramo siguiente.
- Los mosaicos de CARTO mostraron "API KEY REQUIRED" en las pruebas; se usan los de Esri (gris claro/oscuro), OSM y satélite Esri, comprobados sin clave.

## Archivos

| Archivo | Función |
|---|---|
| `servidor.py` | Servidor local + proxy con caché (solo biblioteca estándar de Python). |
| `iniciar.bat` | Arranca el servidor y abre el navegador. |
| `js/config.js` | Modelos y variables. |
| `js/fuentes.js` | Consultas a Open-Meteo y MET Norway, tandas, reintentos. |
| `js/combinar.js` | Estimado combinado, jornada, aptitud y mejor ventana. |
| `js/mapa.js`, `js/panel.js`, `js/grafico.js` | Mapa, panel de detalle y gráficos. |
| `js/app.js` | Estado, actualización en vivo, búsqueda, GPS, ajustes. |
| `sw.js` | Permite abrir la app sin conexión. |
| `cache/` | Caché del servidor (se limpia sola; se puede borrar). |
