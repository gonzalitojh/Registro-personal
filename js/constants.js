// =============================================================
// Constantes compartidas entre módulos. Centraliza las etiquetas
// de estado, los mapeos de tipo y otros valores que se usan en
// varios sitios (app.js, ui.js, profile.js, etc.) para evitar
// duplicación.
// =============================================================

// Etiquetas de estado con contexto (para mostrar en la UI).
// "media" cubre películas y series; "book" es para libros;
// "game" cubre videojuegos.
export const STATUS_LABELS = {
  media: {
    pendiente: "Pendiente",
    en_curso: "Viendo",
    completado: "Vista",
    standby: "Standby",
    abandonado: "Abandonada",
  },
  book: {
    pendiente: "Pendiente",
    en_curso: "Leyendo",
    completado: "Leído",
    standby: "Standby",
    abandonado: "Abandonado",
  },
  game: {
    pendiente: "Pendiente",
    en_curso: "Jugando",
    completado: "Jugado",
    standby: "Standby",
    abandonado: "Abandonado",
  },
};

// Etiquetas neutrales de estado (sin contexto de tipo).
// Se usan en las gráficas de estadísticas del perfil.
export const STATUS_LABELS_NEUTRAL = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
  standby: "En pausa",
  abandonado: "Abandonado",
};

// Textos de la acción «marcar como completado» según el tipo (issue #177):
// el término varía por tipo — películas/series «visto», libros «leído»,
// videojuegos «jugado». Se usan en el botón del catálogo (issue #115)
// y en sus estados final/restauración.
export const SEEN_ACTION_LABELS = {
  media: { action: "Marcar visto", done: "Visto" },
  book: { action: "Marcar leído", done: "Leído" },
  game: { action: "Marcar jugado", done: "Jugado" },
};

// Textos de «marcar como completado» para el tipo de ítem dado
// (misma familia de alcance que STATUS_LABELS, issue #177).
export function seenActionLabels(type) {
  const scope = type === "book" ? "book" : type === "game" ? "game" : "media";
  return SEEN_ACTION_LABELS[scope];
}

// Mapeo de nombre de grupo ("movies", "tv", "books", "games") a tipo de
// ítem ("movie", "tv", "book", "game") que se guarda en Firestore.
export const TYPE_BY_GROUP = { movies: "movie", tv: "tv", books: "book", games: "game" };

// Campos de ficha servidos BAJO DEMANDA (almacenamiento mínimo A2,
// estudio de la issue #183, sección 8.2): con el almacenamiento
// mínimo no se persisten en Firestore; se piden a la API al abrir la
// ficha (con caché en memoria de 24 h) y la limpieza migratoria
// (js/migration.js) los elimina de los documentos existentes.
// Excepción: los libros conservan `description` (sección 8.1: la
// tarjeta y la ficha de libro lo pintan al instante, y no hay llamada
// de detalle que lo recupere sin coste).
export const ON_DEMAND_DETAIL_FIELDS = [
  "runtime",
  "episodeRuntime",
  "overview",
  "description",
  "genres",
  "cast",
  "director",
  "creators",
  "trailerUrl",
  "collectionId",
  "collectionName",
  "collectionPoster",
  "platforms",
  "developers",
  "publishers",
  "esrbName",
  "metacritic",
  "playtime",
];

// Iconos SVG de los tipos de medio: MISMO markup que las pestañas de
// index.html (tab--tv / tab--movies / tab--books, líneas 155-177) —
// fuente canónica: si cambian las pestañas, actualizar aquí (issue #134).
export const MEDIA_ICONS = {
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
    <polyline points="17 2 12 7 7 2" />
  </svg>`,
  movies: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1-.3 2.1.3 2.4 1.3Z" />
    <path d="m6.2 5.3 3.1 3.9" />
    <path d="m12.4 3.4 3.1 4" />
    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>`,
  books: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </svg>`,
  games: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="6" />
    <path d="M6 11h4M8 9v4" />
    <path d="M15.5 11h.01M17.5 13h.01" />
  </svg>`,
};
