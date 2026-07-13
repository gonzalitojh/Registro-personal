// =============================================================
// Cálculo del progreso de una serie a partir de:
// - seasonsMeta: temporadas y nº de episodios, obtenidos en vivo de TMDB
// - watched: episodios marcados como vistos, guardados en Firestore
//   con forma { "1": [1,2,3], "2": [1] } (temporada -> episodios vistos)
// No depende del DOM ni de Firebase: es pura lógica, fácil de reutilizar
// tanto desde ui.js (para actualizar la vista al vuelo) como desde
// app.js (para decidir qué guardar).
// =============================================================

export function computeProgress(seasonsMeta, watched) {
  const totalEpisodes = seasonsMeta.reduce((sum, s) => sum + s.episodeCount, 0);
  const totalWatched = Object.values(watched || {}).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  );

  let nextEpisode = null;
  seasonsLoop: for (const s of seasonsMeta) {
    const watchedSet = new Set((watched && watched[String(s.seasonNumber)]) || []);
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      if (!watchedSet.has(ep)) {
        nextEpisode = { season: s.seasonNumber, episode: ep };
        break seasonsLoop;
      }
    }
  }

  let status = "pendiente";
  if (totalEpisodes > 0 && totalWatched >= totalEpisodes) {
    status = "completado";
  } else if (totalWatched > 0) {
    status = "en_curso";
  }

  return { totalEpisodes, totalWatched, nextEpisode, status };
}

export function toggleEpisode(watched, seasonNumber, episodeNumber) {
  const key = String(seasonNumber);
  const current = new Set((watched && watched[key]) || []);
  if (current.has(episodeNumber)) {
    current.delete(episodeNumber);
  } else {
    current.add(episodeNumber);
  }
  return { ...(watched || {}), [key]: Array.from(current).sort((a, b) => a - b) };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched) {
  const key = String(seasonNumber);
  const episodes = allWatched ? Array.from({ length: episodeCount }, (_, i) => i + 1) : [];
  return { ...(watched || {}), [key]: episodes };
}
