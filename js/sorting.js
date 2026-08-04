// =============================================================
// Funciones de ordenación y comparación. Extraídas de app.js
// para reutilizarlas tanto en app.js (ordenación de la lista)
// como en ui.js (badges de episodios sin estrenar).
// =============================================================

import { isUnreleasedDate } from "./release.js";

// Información de emisión del siguiente episodio que le toca ver al
// usuario: { season, episode, airDate } o null si se desconoce.
// Prioriza nextEpisodeToAir (TMDB en vivo) cuando coincide con el
// siguiente episodio; si no, usa el dato guardado localmente
// (nextEpisodeAirDate, que puede persistir la fecha aunque TMDB deje
// de devolver next_episode_to_air, p. ej. serie entre temporadas).
export function getNextEpisodeAirInfo(item) {
  const ne = item.nextEpisode;
  if (item.type !== "tv" || item.manual || !ne) return null;
  const toAir = item.nextEpisodeToAir;
  if (toAir && toAir.season === ne.season && toAir.episode === ne.episode) return toAir;
  const stored = item.nextEpisodeAirDate;
  if (stored && stored.season === ne.season && stored.episode === ne.episode) return stored;
  return null;
}

// Comprueba si el siguiente episodio que le toca ver al usuario
// coincide con el próximo episodio que TMDB dice que aún no se ha
// emitido (o cuyo episodio guardado localmente no tiene fecha o la
// tiene futura).
export function isNextEpisodeUnreleased(item) {
  const info = getNextEpisodeAirInfo(item);
  return !!info && isUnreleasedDate(info.airDate);
}

// Un ítem está "sin estrenar" si su siguiente contenido (estreno de la
// película, siguiente episodio o premiere de la serie) no tiene fecha
// oficial o la tiene futura. Las series manuales quedan excluidas.
export function isItemUnreleased(item) {
  if (item.manual) return false;
  if (item.type === "movie") {
    return !(item.watchLog && item.watchLog.length) && isUnreleasedDate(item.releaseDate);
  }
  if (item.type === "tv") {
    if (!item.nextEpisode) return false; // completada: nunca "sin estrenar"
    return item.awaitingRelease === true || isNextEpisodeUnreleased(item);
  }
  return false;
}

// Normaliza a un texto comparable tanto las fechas "YYYY-MM-DD" que
// guardamos nosotros como los Timestamp de Firestore (addedAt), para
// poder compararlos entre sí en el mismo orden.
export function toComparableTime(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  return null;
}

// Última actividad real (último episodio visto, última vez vista/leída);
// si todavía no hay ninguna, se usa la fecha en la que se añadió.
function getActivityOrAddedTime(item) {
  return toComparableTime(getSortDate(item)) || toComparableTime(item.addedAt);
}

// Última actividad según el tipo de ítem (para ordenar por fecha
// de actividad reciente).
export function getSortDate(item) {
  let activity = null;
  if (item.type === "movie") {
    activity = item.watchLog && item.watchLog.length ? item.watchLog[item.watchLog.length - 1] : null;
  } else if (item.type === "tv") {
    activity = item.lastWatchedAt || null;
  } else if (item.type === "book") {
    const log = item.readLog || [];
    if (log.length) {
      const last = log[log.length - 1];
      activity = last.finishedAt || last.startedAt || null;
    }
  }
  // Si se acaba de detectar que se ha estrenado (pelis y series que
  // estaban pendientes de estreno), eso también cuenta como actividad,
  // para que suba en el orden aunque todavía no se haya visto.
  if (item.releasedNoticedAt && (!activity || item.releasedNoticedAt > activity)) {
    activity = item.releasedNoticedAt;
  }
  return activity;
}

export function compareAlphabetical(a, b) {
  return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
}

export function compareByYearDesc(a, b) {
  return (Number(b.year) || 0) - (Number(a.year) || 0);
}

export function compareByDateDesc(a, b) {
  const da = getSortDate(a);
  const db = getSortDate(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}

export function compareByActivityDesc(a, b) {
  const aBlocked = isItemUnreleased(a);
  const bBlocked = isItemUnreleased(b);
  if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
  const da = getActivityOrAddedTime(a);
  const db = getActivityOrAddedTime(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}

export function applySort(items, sortKey) {
  if (sortKey === "alfabetico") return [...items].sort(compareAlphabetical);
  if (sortKey === "anio") return [...items].sort(compareByYearDesc);
  if (sortKey === "fecha") return [...items].sort(compareByDateDesc);
  // "añadido" (por defecto): lo visto/leído más recientemente sube arriba;
  // lo que aún no se ha empezado se ordena por cuándo se añadió.
  return [...items].sort(compareByActivityDesc);
}
