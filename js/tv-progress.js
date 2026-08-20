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

import { todayISO } from "./dates.js";

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

// Quita la ÚLTIMA visualización de una entrada de episodio ya
// normalizada (feedback #310): si se ha visto más de una vez devuelve
// la entrada decrementada (times-1, sin la fecha más reciente de
// `dates`, conservando valoración y visiones previas); si solo se
// había visto una vez devuelve null (desmarcar). Las entradas legacy
// (solo `date` + `times`) conservan su fecha representativa.
// Compartido por removeLastEpisodeViewing (episodio suelto) y
// setSeasonWatched («Desmarcar todo»: una quita por episodio).
function lastViewingRemovedEntry(existing) {
  const times = existing.times || 1;
  if (times <= 1) return null;
  const dates = entryDates(existing);
  const newDates = dates.length > 1 ? dates.slice(0, -1) : dates;
  return {
    date: newDates[newDates.length - 1] ?? existing.date,
    rating: existing.rating ?? null,
    times: times - 1,
    dates: newDates,
  };
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
  const next = lastViewingRemovedEntry(existing);
  if (next) seasonMap[epKey] = next;
  else delete seasonMap[epKey];
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

// «Marcar todo» / «Desmarcar todo» de temporada (feedback #310,
// iteración 2): la MISMA semántica que el botón de marcar un episodio
// individual, aplicada a cada episodio de la temporada:
// - «Marcar todo» AÑADE una visualización a cada episodio: los ya
//   vistos suman +1 al contador y registran la fecha (equivale a
//   volver a verlos); los no vistos quedan con times=1.
// - «Desmarcar todo» QUITA la última visualización de cada episodio
//   (los vistos una sola vez se desmarcan; los vistos varias veces
//   siguen marcados con el contador decrementado y la última fecha
//   eliminada — antes se vaciaba la temporada entera, perdiéndolo
//   todo).
export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const previous = (watched && watched[key]) || {};
  const seasonMap = {};
  for (let ep = 1; ep <= episodeCount; ep++) {
    const existing = normalizeEntry(previous[String(ep)]);
    if (allWatched) {
      seasonMap[String(ep)] = existing
        ? {
            date,
            rating: existing.rating ?? null,
            times: (existing.times || 1) + 1,
            dates: [...entryDates(existing), date],
          }
        : { date, rating: null, times: 1, dates: [date] };
    } else if (existing && existing.date) {
      const next = lastViewingRemovedEntry(existing);
      if (next) seasonMap[String(ep)] = next;
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

// «Volver a verla desde el principio» (issue #310): REINICIA el ciclo
// de visionado SIN desmarcar los episodios ni perder los números de
// visualizaciones ni las valoraciones — `watched` se conserva tal cual
// (fechas, valoraciones y nº de veces por episodio), con el flag
// `rewatching` marcando el nuevo ciclo. El próximo episodio vuelve a
// ser T1E1 y la serie pasa a «viendo» (status "en_curso").
// Iteración 2 (feedback #310): se persiste `rewatchStartedAt` (fecha
// de inicio del ciclo): la completitud del rewatch se decide por
// fechas de visionado >= rewatchStartedAt, así los datos legacy
// (serie vista varias veces antes de #310 con times=2 y sin contador)
// no hacen que un ciclo nuevo se complete sin volver a ver nada.
// Iteración 4 (feedback #310, 2026-08-20): el visionado que se termina
// NO se archiva aquí en `history` («visualizaciones anteriores»): se
// archiva cuando la serie se COMPLETA (completedViewingChanges).
export function startRewatch(item) {
  return {
    watched: item.watched || {},
    firstWatchedAt: null,
    lastWatchedAt: null,
    status: "en_curso",
    nextEpisode: { season: 1, episode: 1 },
    timesCompleted: item.timesCompleted || 0,
    rewatching: true,
    rewatchStartedAt: todayISO(),
  };
}

// Registro del visionado al COMPLETAR la serie (feedback #310,
// iteración 4): «cuando se termina una serie, se debe añadir su
// visualización a "visualizaciones anteriores", no cuando se da al
// botón "Volver a verla desde el principio"». Devuelve las
// propiedades a persistir ({ history, timesCompleted }) si el nuevo
// progreso acaba de completar la serie (item.status aún no era
// "completado"); null en cualquier otro caso (sin transición o serie
// ya completada).
// - history: entrada { startedAt, finishedAt } del visionado recién
//   terminado — si era un rewatch, desde rewatchStartedAt; si era la
//   primera vez, desde el primer visionado (firstWatchedAt).
// - timesCompleted: el acumulado + 1, sin bajar del mínimo de veces
//   de los episodios (seriesCompleteTimes) para mantener la coherencia
//   con datos legacy sin contador.
export function completedViewingChanges(item, newWatched, newProgress) {
  if (!newProgress || newProgress.status !== "completado" || item.status === "completado") {
    return null;
  }
  const startedAt = item.rewatching
    ? item.rewatchStartedAt || todayISO()
    : newProgress.firstWatchedAt || item.firstWatchedAt;
  const finishedAt = newProgress.lastWatchedAt || item.lastWatchedAt || todayISO();
  const history = [...(item.history || []), { startedAt, finishedAt }];
  const timesCompleted = Math.max((item.timesCompleted || 0) + 1, seriesCompleteTimes(newWatched));
  return { history, timesCompleted };
}

// ¿El rewatch en curso está completo? (issue #310): todos los
// episodios de seasonsMeta deben estar marcados con times >= minTimes
// (la 1ª vez que se completa un rewatch, timesCompleted=1 → minTimes=2:
// todos los episodios vueltos a ver al menos una vez). Desde la
// iteración 2 (feedback #310) con `startedAt` (rewatchStartedAt) la
// comprobación es por FECHAS: cada episodio debe tener ALGUNA fecha
// de visionado >= al inicio del ciclo («cuando se han visto todos los
// episodios de una serie, se da por terminada esta visualización»),
// lo que es robusto frente a datos legacy con contadores inflados y a
// visionados heterogéneos previos al ciclo. Sin startedAt (ciclos en
// vuelo iniciados por una versión anterior) se cae al criterio por
// contador con minTimes.
export function isRewatchComplete(seasonsMeta, watched, startedAt = null, minTimes = 1) {
  let anySeason = false;
  for (const s of seasonsMeta || []) {
    if (!s.episodeCount) continue;
    anySeason = true;
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      const entry = normalizeEntry(seasonWatched[String(ep)]);
      if (!entry || !entry.date) return false;
      if (startedAt) {
        if (!entryDates(entry).some((d) => d >= startedAt)) return false;
      } else if ((entry.times || 1) < minTimes) {
        return false;
      }
    }
  }
  return anySeason;
}

// ¿La entrada tiene alguna visión en el ciclo actual (>= startedAt)?
// Sin startedAt (sin rewatch) cualquier fecha cuenta. Compartida con la
// UI para los contadores de temporada del ciclo en curso (#310, it. 3).
export function entrySeenSince(entry, startedAt = null) {
  if (!entry || !entry.date) return false;
  if (!startedAt) return true;
  return entryDates(entry).some((d) => d >= startedAt);
}

// Veces que se ha visto COMPLETA una temporada (feedback #310,
// iteración 3): el contador de la temporada es el del episodio con
// MENOS visionados — para completar la temporada todos sus episodios
// deben haberse visto al menos N veces — y 0 si algún episodio no
// está marcado. Es la fuente coherente para el check circular de
// «Marcar todo» (tick si 1, número si > 1) y para que cuadre con los
// contadores de los episodios individuales.
export function seasonCompleteTimes(seasonWatched, episodeCount) {
  let min = Infinity;
  for (let ep = 1; ep <= episodeCount; ep++) {
    const entry = normalizeEntry(seasonWatched && seasonWatched[String(ep)]);
    if (!entry || !entry.date) return 0;
    min = Math.min(min, Number(entry.times) || 1);
  }
  return min === Infinity ? 0 : min;
}

// Veces que se ha visto COMPLETA la serie según los episodios
// (feedback #310, iteración 3): mínimo de `times` de todos los
// episodios marcados (para completar la serie, cada episodio debe
// haberse visto al menos N veces). Coherente con los «Visionados
// anteriores» de los episodios y con el sumario de la serie (evita el
// contador inflado por `timesCompleted` cuando el usuario marcó la
// serie completa varias veces por error). 0 si no hay episodios.
export function seriesCompleteTimes(watched) {
  let min = Infinity;
  for (const seasonMap of Object.values(watched || {})) {
    if (!seasonMap || typeof seasonMap !== "object") continue;
    for (const raw of Object.values(seasonMap)) {
      const entry = normalizeEntry(raw);
      if (!entry || !entry.date) continue;
      min = Math.min(min, Math.max(1, Number(entry.times) || 1));
    }
  }
  return min === Infinity ? 0 : min;
}

// Estado a persistir cuando hay un rewatch en curso (issue #310):
// - completo (todos los episodios vistos en el ciclo, iteración 2): el
//   rewatch termina → status "completado" y rewatching false.
// - en curso (iteración 3, feedback #310): el progreso del BANNER y de
//   los contadores debe reflejar el visionado ACTUAL (fechas >=
//   rewatchStartedAt), no el histórico completo: totalWatched cuenta
//   solo los episodios del ciclo, nextEpisode es el siguiente episodio
//   del ciclo sin ver, y el estado de hecho es "en_curso" («viendo»).
//   Ciclo legacy en vuelo (iniciado antes de la iteración 2, sin
//   rewatchStartedAt): sin fecha de inicio no se puede separar el
//   ciclo actual → comportamiento previo (T1E1 y "pendiente").
// Sin rewatch: delega en computeProgress (comportamiento previo).
export function progressWithRewatch(seasonsMeta, item, newWatched = null) {
  const watched = newWatched ?? item.watched;
  const base = computeProgress(seasonsMeta, watched);
  if (!item.rewatching) return base;
  const startedAt = item.rewatchStartedAt || null;
  const minTimes = (item.timesCompleted || 0) + 1;
  if (isRewatchComplete(seasonsMeta, watched, startedAt, minTimes)) {
    return { ...base, status: "completado", rewatching: false };
  }
  if (!startedAt) {
    return { ...base, status: "pendiente", nextEpisode: { season: 1, episode: 1 }, rewatching: true };
  }
  let totalWatched = 0;
  let nextEpisode = null;
  for (const s of seasonsMeta || []) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      const entry = normalizeEntry(seasonWatched[String(ep)]);
      if (entrySeenSince(entry, startedAt)) {
        totalWatched++;
      } else if (!nextEpisode) {
        nextEpisode = { season: s.seasonNumber, episode: ep };
      }
    }
  }
  return {
    ...base,
    totalWatched,
    nextEpisode: nextEpisode || { season: 1, episode: 1 },
    status: "en_curso",
    rewatching: true,
  };
}
