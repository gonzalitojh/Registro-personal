// =============================================================
// Progreso de una serie a partir de:
// - seasonsMeta: temporadas y nº de episodios, obtenidos en vivo de TMDB
// - watched: datos por episodio del visionado actual, con forma
//   { "1": { "1": { date: "2026-01-05", rating: 4 }, "2": {...} }, "2": {...} }
//   (temporada -> episodio -> { fecha en la que se vio, valoración 1-5 o null })
// No depende del DOM ni de Firebase: es pura lógica, reutilizable
// tanto desde ui.js (para refrescar la vista al vuelo) como desde
// app.js (para decidir qué guardar).
// =============================================================

// Compatibilidad con datos antiguos: antes cada episodio guardaba solo
// la fecha como texto plano ("2026-01-05"), sin objeto ni valoración.
export function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { date: entry, rating: null };
  return entry;
}

export function computeProgress(seasonsMeta, watched) {
  const totalEpisodes = seasonsMeta.reduce((sum, s) => sum + s.episodeCount, 0);
  let totalWatched = 0;
  let firstWatchedAt = null;
  let lastWatchedAt = null;

  for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (const raw of Object.values(seasonWatched)) {
      const entry = normalizeEntry(raw);
      if (!entry || !entry.date) continue;
      totalWatched++;
      if (!firstWatchedAt || entry.date < firstWatchedAt) firstWatchedAt = entry.date;
      if (!lastWatchedAt || entry.date > lastWatchedAt) lastWatchedAt = entry.date;
    }
  }

  let nextEpisode = null;
  seasonsLoop: for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      const entry = normalizeEntry(seasonWatched[String(ep)]);
      if (!entry || !entry.date) {
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
// Si ya tenía una valoración puesta, se conserva.
export function setEpisodeDate(watched, seasonNumber, episodeNumber, dateOrNull) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  if (dateOrNull) {
    const existing = normalizeEntry(seasonMap[epKey]) || {};
    seasonMap[epKey] = { date: dateOrNull, rating: existing.rating ?? null };
  } else {
    delete seasonMap[epKey];
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Solo se puede valorar un episodio que ya esté marcado como visto.
export function setEpisodeRating(watched, seasonNumber, episodeNumber, rating) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]);
  if (!existing || !existing.date) return { ...(watched || {}), [key]: seasonMap };
  seasonMap[epKey] = { date: existing.date, rating };
  return { ...(watched || {}), [key]: seasonMap };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const previous = (watched && watched[key]) || {};
  const seasonMap = {};
  if (allWatched) {
    for (let ep = 1; ep <= episodeCount; ep++) {
      const existing = normalizeEntry(previous[String(ep)]);
      seasonMap[String(ep)] = { date, rating: existing ? existing.rating : null };
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
