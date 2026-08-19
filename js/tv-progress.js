// =============================================================
// Progreso de una serie a partir de:
// - seasonsMeta: temporadas y nº de episodios, obtenidos en vivo de TMDB
// - watched: datos por episodio del visionado actual, con forma
//   { "1": { "1": { date: "2026-01-05", rating: 4, times: 2, dates: ["2025-11-02","2026-01-05"] }, "2": {...} }, "2": {...} }
//   (temporada -> episodio -> { fecha de la última vez que se vio,
//   valoración 1-5 (pasos de 0.5 desde la issue #276) o null, veces visto
//   con 1 por defecto, y dates: array con TODAS las fechas de visionado
//   en orden cronológico — issue #310; la última de dates es `date` })
// No depende del DOM ni de Firebase: es pura lógica, reutilizable
// tanto desde ui.js (para refrescar la vista al vuelo) como desde
// app.js (para decidir qué guardar).
// =============================================================

// Fechas de visionado de una entrada ya normalizada: si la entrada
// (issue #310) trae el array `dates` se usa tal cual; si no (datos
// guardados antes de la issue #310), se deriva de la última fecha:
// { dates: [date] } — el histórico anterior a #310 es irrecuperable
// (solo se guardaba la última fecha + el contador).
function entryDates(entry) {
  if (entry && Array.isArray(entry.dates) && entry.dates.length) return entry.dates;
  return entry && entry.date ? [entry.date] : [];
}

// Compatibilidad con datos antiguos: antes cada episodio guardaba solo
// la fecha como texto plano ("2026-01-05"), sin objeto ni valoración,
// y el campo times (nº de veces visto) no existía (issue #133).
// Normaliza la entrada al formato { date, rating, times, dates } sin
// mutar el original; `dates` siempre presente (derivado si la entrada
// es de antes de la issue #310).
export function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { date: entry, rating: null, times: 1, dates: [entry] };
  if (entry.date && entry.times == null) return { ...entry, times: 1, dates: entryDates(entry) };
  if (Array.isArray(entry.dates) && entry.dates.length) return entry;
  return { ...entry, dates: entryDates(entry) };
}

// Media de valoración de los episodios valorados de una serie (issue #80).
// No tiene en cuenta los episodios sin valorar: un episodio visto sin
// valorar (rating null) nunca cuenta como 0. Desde la issue #276 la
// valoración mínima válida es media estrella (0.5).
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
      // Las medias estrellas (0.5) son válidas desde la issue #276.
      if (!Number.isFinite(r) || r < 0.5 || r > 5) continue;
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
// Si ya tenía una valoración, un contador de visualizaciones o fechas
// anteriores (issue #310), se conservan.
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
      dates: entryDates(existing).length ? entryDates(existing) : [dateOrNull],
    };
  } else {
    delete seasonMap[epKey];
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Elimina la ÚLTIMA visualización de un episodio (feedback issue #310):
// - si se ha visto más de una vez, el episodio SIGUE marcado: se
//   descuenta el contador y se quita la fecha más reciente de `dates`
//   (conservando valoración y visiones previas);
// - si solo se había visto una vez, la entrada se elimina por completo
//   (desmarcar, comportamiento previo).
// Las entradas legacy (antes de #310 solo tenían `date` + `times`) no
// tienen fechas recuperables más allá de la última: si `dates` tiene
// una sola fecha, se conserva como representativa de la visión restante.
export function removeLastEpisodeViewing(watched, seasonNumber, episodeNumber) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]);
  if (!existing || !existing.date) return { ...(watched || {}), [key]: seasonMap };
  const times = existing.times || 1;
  if (times <= 1) {
    delete seasonMap[epKey];
    return { ...(watched || {}), [key]: seasonMap };
  }
  const dates = entryDates(existing);
  const newDates = dates.length > 1 ? dates.slice(0, -1) : dates;
  seasonMap[epKey] = {
    date: newDates[newDates.length - 1] ?? existing.date,
    rating: existing.rating ?? null,
    times: times - 1,
    dates: newDates,
  };
  return { ...(watched || {}), [key]: seasonMap };
}

// Marca un episodio YA visto como visto de nuevo: conserva la valoración,
// suma 1 al contador de visualizaciones y registra la nueva fecha en el
// histórico de fechas del episodio (issue #133/#310).
export function markEpisodeSeenAgain(watched, seasonNumber, episodeNumber, date) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]) || {};
  seasonMap[epKey] = {
    date,
    rating: existing.rating ?? null,
    times: (existing.times || 1) + 1,
    dates: [...entryDates(existing), date],
  };
  return { ...(watched || {}), [key]: seasonMap };
}

// Solo se puede valorar un episodio que ya esté marcado como visto.
// El contador de visualizaciones y el histórico de fechas se conservan
// al re-valorar (issue #133/#310).
export function setEpisodeRating(watched, seasonNumber, episodeNumber, rating) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]);
  if (!existing || !existing.date) return { ...(watched || {}), [key]: seasonMap };
  seasonMap[epKey] = {
    date: existing.date,
    rating,
    times: existing.times || 1,
    dates: entryDates(existing),
  };
  return { ...(watched || {}), [key]: seasonMap };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const previous = (watched && watched[key]) || {};
  const seasonMap = {};
  if (allWatched) {
    for (let ep = 1; ep <= episodeCount; ep++) {
      const existing = normalizeEntry(previous[String(ep)]);
      // Episodio ya visto: «Marcar todo» equivale a volver a verlo —
      // suma +1 al contador y registra la fecha de hoy (issue #310).
      // Antes solo se movía `date` a hoy sin tocar `times`.
      seasonMap[String(ep)] = existing
        ? {
            date,
            rating: existing.rating ?? null,
            times: (existing.times || 1) + 1,
            dates: [...entryDates(existing), date],
          }
        : { date, rating: null, times: 1, dates: [date] };
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
// serie lista para volver a verse desde el principio SIN desmarcar los
// episodios (issue #310): `watched` se conserva tal cual (fechas,
// valoraciones y nº de veces por episodio), con el flag `rewatching`
// marcando el nuevo ciclo. currentTimes = veces que se ha visto la
// serie hasta ahora (para calcular minTimes en isRewatchComplete).
export function startRewatch(item) {
  const history = [...(item.history || [])];
  if (item.firstWatchedAt || item.lastWatchedAt) {
    history.push({ startedAt: item.firstWatchedAt, finishedAt: item.lastWatchedAt });
  }
  return {
    watched: item.watched || {},
    firstWatchedAt: null,
    lastWatchedAt: null,
    status: "pendiente",
    nextEpisode: { season: 1, episode: 1 },
    timesCompleted: (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0),
    history,
    rewatching: true,
  };
}

// ¿El rewatch en curso está completo? (issue #310): todos los episodios
// de seasonsMeta deben estar marcados con times >= minTimes (la 1ª vez
// que se completa un rewatch, timesCompleted=1 → minTimes=2: todos los
// episodios vueltos a ver al menos una vez).
export function isRewatchComplete(seasonsMeta, watched, minTimes) {
  let anySeason = false;
  for (const s of seasonsMeta || []) {
    if (!s.episodeCount) continue;
    anySeason = true;
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      const entry = normalizeEntry(seasonWatched[String(ep)]);
      if (!entry || !entry.date || (entry.times || 1) < minTimes) return false;
    }
  }
  return anySeason;
}

// Estado a persistir cuando hay un rewatch en curso (issue #310):
// - completo (todos los episodios con times >= minTimes): el rewatch
//   termina → status "completado" y rewatching false.
// - en curso: status "pendiente" y próximo episodio T1E1 aunque el
//   `watched` conservado esté completo (computeProgress no lo sabría).
// Sin rewatch: delega en computeProgress (comportamiento previo).
export function progressWithRewatch(seasonsMeta, item, newWatched = null) {
  const base = computeProgress(seasonsMeta, newWatched ?? item.watched);
  if (!item.rewatching) return base;
  const minTimes = (item.timesCompleted || 0) + 1;
  if (isRewatchComplete(seasonsMeta, newWatched ?? item.watched, minTimes)) {
    return { ...base, status: "completado", rewatching: false };
  }
  return {
    ...base,
    status: "pendiente",
    nextEpisode: { season: 1, episode: 1 },
    rewatching: true,
  };
}
