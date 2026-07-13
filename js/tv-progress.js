// =============================================================
// Progreso de una serie a partir de:
// - seasonsMeta: temporadas y nº de episodios, obtenidos en vivo de TMDB
// - watched: fechas por episodio del visionado actual, con forma
//   { "1": { "1": "2026-01-05", "2": "2026-01-06" }, "2": {...} }
//   (temporada -> episodio -> fecha en la que se vio)
// No depende del DOM ni de Firebase: es pura lógica, reutilizable
// tanto desde ui.js (para refrescar la vista al vuelo) como desde
// app.js (para decidir qué guardar).
// =============================================================

export function computeProgress(seasonsMeta, watched) {
  const totalEpisodes = seasonsMeta.reduce((sum, s) => sum + s.episodeCount, 0);
  let totalWatched = 0;
  let firstWatchedAt = null;
  let lastWatchedAt = null;

  for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (const dateStr of Object.values(seasonWatched)) {
      if (!dateStr) continue;
      totalWatched++;
      if (!firstWatchedAt || dateStr < firstWatchedAt) firstWatchedAt = dateStr;
      if (!lastWatchedAt || dateStr > lastWatchedAt) lastWatchedAt = dateStr;
    }
  }

  let nextEpisode = null;
  seasonsLoop: for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      if (!seasonWatched[String(ep)]) {
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

  return { totalEpisodes, totalWatched, nextEpisode, status, firstWatchedAt, lastWatchedAt };
}

// dateOrNull: fecha "YYYY-MM-DD" para marcar visto, o null para desmarcar.
export function setEpisodeDate(watched, seasonNumber, episodeNumber, dateOrNull) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  if (dateOrNull) {
    seasonMap[String(episodeNumber)] = dateOrNull;
  } else {
    delete seasonMap[String(episodeNumber)];
  }
  return { ...(watched || {}), [key]: seasonMap };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const seasonMap = {};
  if (allWatched) {
    for (let ep = 1; ep <= episodeCount; ep++) {
      seasonMap[String(ep)] = date;
    }
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Archiva el visionado actual (si lo hay) en el historial y deja la
// serie lista para volver a verse desde el principio, sin perder el
// nº de veces vista ni las fechas anteriores.
export function startRewatch(item) {
  const history = [...(item.history || [])];
  if (item.firstWatchedAt || item.lastWatchedAt) {
    history.push({ startedAt: item.firstWatchedAt, finishedAt: item.lastWatchedAt });
  }
  return {
    watched: {},
    firstWatchedAt: null,
    lastWatchedAt: null,
    status: "pendiente",
    nextEpisode: { season: 1, episode: 1 },
    timesCompleted: (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0),
    history,
  };
}

// Nº de veces que se ha terminado la serie, contando el visionado
// actual si ya está completo.
export function timesWatched(item) {
  return (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0);
}
