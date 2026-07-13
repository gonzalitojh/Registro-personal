// =============================================================
// Historial de lecturas de un libro: un array de tramos
// { startedAt, finishedAt }. finishedAt es null mientras el
// libro se está leyendo. Permite releer sin perder el registro
// de lecturas anteriores.
// =============================================================

export function startReading(readLog, date) {
  return [...(readLog || []), { startedAt: date, finishedAt: null }];
}

export function finishReading(readLog, date) {
  const log = [...(readLog || [])];
  if (log.length && !log[log.length - 1].finishedAt) {
    log[log.length - 1] = { ...log[log.length - 1], finishedAt: date };
  } else {
    log.push({ startedAt: date, finishedAt: date });
  }
  return log;
}

export function removeReadEntry(readLog, index) {
  const log = [...(readLog || [])];
  log.splice(index, 1);
  return log;
}

export function updateReadEntry(readLog, index, changes) {
  const log = [...(readLog || [])];
  log[index] = { ...log[index], ...changes };
  return log;
}

export function statusFromReadLog(readLog) {
  if (!readLog || !readLog.length) return "pendiente";
  const last = readLog[readLog.length - 1];
  return last.finishedAt ? "completado" : "en_curso";
}
