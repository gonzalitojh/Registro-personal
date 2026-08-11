// =============================================================
// Guarda de re-render por snapshot (issue #191): decide si un grupo
// de la biblioteca necesita re-renderizarse tras un snapshot de
// Firestore comparando SOLO los campos del ítem que se pintan.
//
// Firestore dispara un snapshot con CUALQUIER escritura en la
// colección (valoraciones, pasada diaria de metadatos, updatedAt...).
// Sin guarda, cada snapshot volcaba el innerHTML del grid/lista
// completo: los <img loading="lazy"> en vuelo se cancelaban una y
// otra vez y las portadas nunca llegaban a cargar (parpadeo incluido)
// hasta reiniciar la web. Los metadatos no renderizados (updatedAt,
// overview, cast, ...) quedan fuera a propósito.
// =============================================================

// Campos del ítem que afectan a lo que pinta el grid/lista (ui.js:
// renderGrid/renderList, progressLine, upcomingBadge,
// quickActionLabel, isItemUnreleased). Mantener en sincronía con esos
// renderizadores.
export const RENDERED_FIELDS = [
  "id",
  "title",
  "status",
  "rating",
  "coverUrl",
  "year",
  "author",
  "releaseDate",
  "firstAirDate",
  "awaitingRelease",
  "manual",
  "communityRating",
  "timesCompleted",
  "lastWatchedAt",
  "nextEpisode",
  "nextEpisodeAirDate",
  "nextEpisodeToAir",
  "seasonAirDates",
  // releasedNoticedAt y addedAt no se pintan, pero SÍ afectan al orden
  // visible (sorting.js getSortDate/getActivityOrAddedTime: el orden
  // «añadido» por defecto y «fecha»), así que forman parte de la firma.
  "releasedNoticedAt",
  "addedAt",
  "watchLog",
  "readLog",
  "playLog",
];

// Firma estable de un grupo: JSON de los campos renderizados, en el
// orden de la colección (orderBy addedAt desc, estable). Dos grupos
// con la misma firma pintan exactamente lo mismo.
export function renderSignature(items) {
  return JSON.stringify(
    items.map((it) => {
      const row = {};
      for (const field of RENDERED_FIELDS) {
        if (it[field] !== undefined) row[field] = it[field];
      }
      return row;
    })
  );
}

/**
 * Crea la guarda de render con estado por grupo (movies/tv/books/games).
 * Devuelve { changed, reset }:
 *  - changed(group, items) → true si el grupo cambió respecto a la
 *    última llamada (y actualiza la firma), false si pinta lo mismo.
 *  - reset() → limpia todas las firmas (p. ej. al cerrar sesión: el
 *    siguiente login debe re-renderizar su biblioteca sin comparar
 *    contra otro usuario).
 */
export function createRenderGuard() {
  const signatures = { movies: null, tv: null, books: null, games: null };
  return {
    changed(group, items) {
      const sig = renderSignature(items);
      if (signatures[group] === sig) return false;
      signatures[group] = sig;
      return true;
    },
    reset() {
      signatures.movies = null;
      signatures.tv = null;
      signatures.books = null;
      signatures.games = null;
    },
  };
}
