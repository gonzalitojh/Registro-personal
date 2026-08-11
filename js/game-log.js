// =============================================================
// Historial de sesiones de juego de un videojuego: un array de
// tramos { startedAt, finishedAt }. finishedAt es null mientras
// la partida está en curso. Permite rejugar sin perder el
// registro de partidas anteriores.
// =============================================================

export function startPlay(playLog, date) {
  return [...(playLog || []), { startedAt: date, finishedAt: null }];
}

export function finishPlay(playLog, date) {
  const log = [...(playLog || [])];
  if (log.length && !log[log.length - 1].finishedAt) {
    log[log.length - 1] = { ...log[log.length - 1], finishedAt: date };
  } else {
    log.push({ startedAt: date, finishedAt: date });
  }
  return log;
}

export function removePlayEntry(playLog, index) {
  const log = [...(playLog || [])];
  log.splice(index, 1);
  return log;
}

export function updatePlayEntry(playLog, index, changes) {
  const log = [...(playLog || [])];
  log[index] = { ...log[index], ...changes };
  return log;
}

export function statusFromPlayLog(playLog) {
  if (!playLog || !playLog.length) return "pendiente";
  const last = playLog[playLog.length - 1];
  return last.finishedAt ? "completado" : "en_curso";
}
