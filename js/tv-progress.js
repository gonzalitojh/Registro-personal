// =============================================================
// Progreso de una serie a partir de:
// - seasonsMeta: temporadas y nº de episodios, obtenidos en vivo de TMDB
// - watched: datos por episodio del visionado actual, con forma
//   { "1": { "1": { date: "2026-01-05", rating: 4, times: 2 }, "2": {...} }, "2": {...} }
//   (temporada -> episodio -> { fecha de la última vez que se vio,
//   valoración 1-5 o null, veces visto con 1 por defecto })
// No depende del DOM ni de Firebase: es pura lógica, reutilizable
// tanto desde ui.js (para refrescar la vista al vuelo) como desde
// app.js (para decidir qué guardar).
// =============================================================

// Compatibilidad con datos antiguos: antes cada episodio guardaba solo
// la fecha como texto plano ("2026-01-05"), sin objeto ni valoración,
// y el campo times (nº de veces visto) no existía (issue #133).
// Normaliza la entrada al formato { date, rating, times } sin mutar el
// original: los objetos que ya tienen times se devuelven tal cual.
export function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { date: entry, rating: null, times: 1 };
  if (entry.date && entry.times == null) return { ...entry, times: 1 };
  return entry;
}

// Media de valoración de los episodios valorados de una serie (issue #80).
// No tiene en cuenta los episodios sin valorar: un episodio visto sin
// valorar (rating null) nunca cuenta como 0, la valoración mínima es 1.
// Entrada: item.watched completo ({ temporada: { episodio: {date, rating} } }).
// Salida: null si no hay ningún episodio con valoración válida; si no,
// { count, average } con average sin redondear (total/count).
export function computeEpisodeAverageRating(watched) {
  let count = 0;
  let total = 0;
  for (const seasonMap of Object.values(watched || {})) {
    if (!seasonMap || typeof seasonMap !== "object") continue;
    for (const raw of Object.values(seasonMap)) {
      const entry = normalizeEntry(raw);
      const r = Number(entry?.rating);
      if (!Number.isFinite(r) || r < 1 || r > 5) continue;
      count++;
      total += r;
    }
  }
  if (count === 0) return null;
  return { count, average: total / count };
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
// Si ya tenía una valoración o un contador de visualizaciones, se conservan.
export function setEpisodeDate(watched, seasonNumber, episodeNumber, dateOrNull) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  if (dateOrNull) {
    const existing = normalizeEntry(seasonMap[epKey]) || {};
    seasonMap[epKey] = {
      date: dateOrNull,
      rating: existing.rating ?? null,
      times: existing.times || 1,
    };
  } else {
    delete seasonMap[epKey];
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Marca un episodio YA visto como visto de nuevo: conserva la valoración
// y suma 1 al contador de visualizaciones (issue #133).
export function markEpisodeSeenAgain(watched, seasonNumber, episodeNumber, date) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]) || {};
  seasonMap[epKey] = {
    date,
    rating: existing.rating ?? null,
    times: (existing.times || 1) + 1,
  };
  return { ...(watched || {}), [key]: seasonMap };
}

// Solo se puede valorar un episodio que ya esté marcado como visto.
// El contador de visualizaciones se conserva al re-valorar (issue #133).
export function setEpisodeRating(watched, seasonNumber, episodeNumber, rating) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]);
  if (!existing || !existing.date) return { ...(watched || {}), [key]: seasonMap };
  seasonMap[epKey] = { date: existing.date, rating, times: existing.times || 1 };
  return { ...(watched || {}), [key]: seasonMap };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const previous = (watched && watched[key]) || {};
  const seasonMap = {};
  if (allWatched) {
    for (let ep = 1; ep <= episodeCount; ep++) {
      const existing = normalizeEntry(previous[String(ep)]);
      seasonMap[String(ep)] = {
        date,
        rating: existing ? existing.rating : null,
        times: existing ? existing.times || 1 : 1,
      };
    }
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Marca como vistas TODAS las temporadas de una serie (issue #115):
// aplica setSeasonWatched(allWatched=true) sobre cada temporada.
export function markAllSeasonsWatched(watched, seasonsMeta, date) {
  return seasonsMeta.reduce(
    (acc, s) => setSeasonWatched(acc, s.seasonNumber, s.episodeCount, true, date),
    watched || {}
  );
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
