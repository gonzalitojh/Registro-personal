// =============================================================
// Lógica de "no estrenado". TMDB devuelve la fecha vacía como null
// (normalizada en api-movies.js); para nosotros un ítem sin fecha
// de estreno oficial se trata igual que uno con fecha futura: NO
// está estrenado. Aquí vive ese criterio único y los mensajes de
// confirmación al marcar como visto un ítem no estrenado.
// =============================================================

import { todayISO, formatDateEs } from "./dates.js";

// Un ítem está sin estrenar si no tiene fecha oficial o si la
// fecha es futura (comparación de strings "YYYY-MM-DD").
export function isUnreleasedDate(dateStr) {
  return !dateStr || dateStr > todayISO();
}

// Mensaje de confirmación al marcar como visto un ítem sin estrenar.
// Devuelve null cuando no aplica (manual, estrenado, sin coincidencia
// de episodio siguiente, tipo no soportado).
export function unreleasedConfirmMessage(item) {
  if (item.type === "movie") {
    if (item.manual) return null;
    if (!isUnreleasedDate(item.releaseDate)) return null;
    if (item.releaseDate) {
      return `Según TMDB esta película se estrena el ${formatDateEs(
        item.releaseDate
      )}, todavía no ha pasado. ¿Marcarla igualmente como vista?`;
    }
    return `«${item.title}» no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenada. ¿Marcarla igualmente como vista?`;
  }

  if (item.type === "tv") {
    const { nextEpisode, nextEpisodeToAir } = item;
    if (!nextEpisode || !nextEpisodeToAir) return null;
    if (
      nextEpisodeToAir.season !== nextEpisode.season ||
      nextEpisodeToAir.episode !== nextEpisode.episode
    ) {
      return null;
    }
    if (!isUnreleasedDate(nextEpisodeToAir.airDate)) return null;
    if (nextEpisodeToAir.airDate) {
      return `Según TMDB este episodio se estrena el ${formatDateEs(
        nextEpisodeToAir.airDate
      )}. ¿Marcarlo igualmente como visto?`;
    }
    return `«${item.title}» no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenado. ¿Marcarlo igualmente como visto?`;
  }

  return null;
}
