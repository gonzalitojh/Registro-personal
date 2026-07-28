// =============================================================
// Constantes compartidas entre módulos. Centraliza las etiquetas
// de estado, los mapeos de tipo y otros valores que se usan en
// varios sitios (app.js, ui.js, profile.js, etc.) para evitar
// duplicación.
// =============================================================

// Etiquetas de estado con contexto (para mostrar en la UI).
// "media" cubre películas y series; "book" es para libros.
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

// Mapeo de nombre de grupo ("movies", "tv", "books") a tipo de
// ítem ("movie", "tv", "book") que se guarda en Firestore.
export const TYPE_BY_GROUP = { movies: "movie", tv: "tv", books: "book" };
