// Configuración de fuentes. Solo se incluyen modelos que se comprobaron con peticiones reales
// para República Dominicana (27-oct-2026): devuelven lluvia, nubosidad y temperatura para RD.
// `meta`: dominio del archivo de metadatos de corridas en Open-Meteo (solo los comprobados y al día).
// `prob`: el modelo publica probabilidad de lluvia (derivada de su sistema de ensamble).
// `mapa`: se usa para colorear el mapa completo (se limita para no agotar la cuota gratuita).

export const MODELOS = [
  { id: "ecmwf_ifs", nombre: "ECMWF IFS 9 km", organismo: "Centro Europeo ECMWF", meta: "ecmwf_ifs", prob: true, mapa: true },
  { id: "gfs_seamless", nombre: "GFS", organismo: "NOAA, EE. UU.", meta: "ncep_gfs025", prob: true, mapa: true },
  { id: "icon_seamless", nombre: "ICON", organismo: "DWD, Alemania", meta: "dwd_icon", prob: true, mapa: true },
  { id: "gem_seamless", nombre: "GEM", organismo: "Environment Canada", meta: null, prob: true, mapa: true },
  { id: "ukmo_seamless", nombre: "UKMO 10 km", organismo: "Met Office, Reino Unido", meta: "ukmo_global_deterministic_10km", prob: true, mapa: true },
  { id: "jma_seamless", nombre: "GSM", organismo: "JMA, Japón", meta: "jma_gsm" },
  { id: "meteofrance_seamless", nombre: "ARPEGE", organismo: "Météo-France", meta: "meteofrance_arpege_world025" },
  { id: "cma_grapes_global", nombre: "GRAPES", organismo: "CMA, China", meta: null },
  { id: "ecmwf_aifs025_single", nombre: "AIFS (IA)", organismo: "ECMWF, modelo de inteligencia artificial", meta: null },
  { id: "ncep_aigfs025", nombre: "AIGFS (IA)", organismo: "NOAA, modelo de inteligencia artificial", meta: null },
];

export const METNO = { id: "metno", nombre: "MET Norway", organismo: "Instituto Meteorológico de Noruega" };

export const ZONA = "America/Santo_Domingo";
export const DIAS = 7;

export const URL_OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
export const URL_META = (dominio) => `https://api.open-meteo.com/data/${dominio}/static/meta.json`;
export const URL_METNO = "https://api.met.no/weatherapi/locationforecast/2.0/complete";

// Variables pedidas a Open-Meteo.
export const DIARIAS_DETALLE = [
  "precipitation_sum", "precipitation_probability_max", "cloud_cover_mean", "sunshine_duration", "daylight_duration",
  "sunrise", "sunset", "temperature_2m_max", "temperature_2m_min", "wind_speed_10m_max", "wind_gusts_10m_max", "weather_code",
];
export const HORARIAS_DETALLE = [
  "precipitation", "precipitation_probability", "cloud_cover", "temperature_2m", "wind_speed_10m", "wind_gusts_10m", "weather_code",
];
// Para el mapa se piden 10 variables o menos (Open-Meteo cuenta más de 10 como llamadas adicionales).
// Las horarias permiten evaluar la aptitud en la jornada igual que en el panel de detalle.
export const DIARIAS_MAPA = ["precipitation_sum", "precipitation_probability_max", "cloud_cover_mean", "sunshine_duration", "wind_gusts_10m_max", "weather_code"];
export const HORARIAS_MAPA = ["precipitation", "precipitation_probability", "wind_gusts_10m", "weather_code"];
// Identifica con qué variables se descargó una copia guardada del mapa (si cambian, se descarga de nuevo).
export const FIRMA_MAPA = `${DIARIAS_MAPA.join()}|${HORARIAS_MAPA.join()}|v2`;

// Frecuencia de descarga. Los datos solo cambian cuando un modelo publica una corrida nueva.
export const MIN_ENTRE_DESCARGAS_MAPA = 3 * 3600 * 1000; // el mapa completo, como mucho cada 3 h
export const MAX_EDAD_MAPA = 6 * 3600 * 1000; // sin información de corridas, se renueva a las 6 h
export const MIN_ENTRE_DESCARGAS_DETALLE = 30 * 60 * 1000; // el lugar elegido, como mucho cada 30 min
export const MAX_EDAD_DETALLE = 2 * 3600 * 1000;
