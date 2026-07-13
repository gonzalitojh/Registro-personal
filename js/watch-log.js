// =============================================================
// Historial de visionados de una película: un simple array de
// fechas (una por cada vez que la has visto), para poder
// registrar revisionados sin perder los anteriores.
// =============================================================

export function addWatch(watchLog, date) {
  return [...(watchLog || []), date].sort();
}

export function removeWatch(watchLog, index) {
  const log = [...(watchLog || [])];
  log.splice(index, 1);
  return log;
}

export function updateWatch(watchLog, index, date) {
  const log = [...(watchLog || [])];
  log[index] = date;
  return log.sort();
}

export function statusFromWatchLog(watchLog) {
  return watchLog && watchLog.length ? "completado" : "pendiente";
}
