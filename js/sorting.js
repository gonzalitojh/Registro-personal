// =============================================================
// Funciones de ordenación y comparación. Extraídas de app.js
// para reutilizarlas tanto en app.js (ordenación de la lista)
// como en ui.js (badges de episodios sin estrenar).
// =============================================================

import { isUnreleasedDate } from "./release.js";

// Comprueba si el siguiente episodio que le toca ver al usuario
// coincide con el próximo episodio que TMDB dice que aún no se ha
// emitido.
export function isNextEpisodeUnreleased(item) {
  if (item.type !== "tv" || !item.nextEpisode || !item.nextEpisodeToAir) return false;
  return (
    item.nextEpisodeToAir.season === item.nextEpisode.season &&
    item.nextEpisodeToAir.episode === item.nextEpisode.episode &&
    isUnreleasedDate(item.nextEpisodeToAir.airDate)
  );
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
  const aBlocked = isNextEpisodeUnreleased(a);
  const bBlocked = isNextEpisodeUnreleased(b);
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
