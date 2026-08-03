// =============================================================
// Acciones rápidas (modo lista y swipe): marcar vista, siguiente
// episodio o avanzar lectura sin abrir el modal. Extraído de app.js.
// =============================================================

import { addWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, statusFromReadLog } from "./reading-log.js";
import { setEpisodeDate, computeProgress } from "./tv-progress.js";
import { todayISO } from "./dates.js";
import { unreleasedConfirmMessage } from "./release.js";

// Meta de temporadas: para series manuales devuelve una sola
// temporada con el nº de episodios indicado; para el resto, pide
// los datos a TMDB.
export async function getSeasonsMetaFor(item, ctx) {
  if (item.manual) {
    return [{ seasonNumber: 1, name: "Temporada 1", episodeCount: item.manualEpisodeCount || 10 }];
  }
  return ctx.getTvSeasonsMeta(item.externalId);
}

async function quickMarkMovie(item, ctx) {
  const confirmMsg = unreleasedConfirmMessage(item);
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const newLog = addWatch(item.watchLog, todayISO());
  const status = statusFromWatchLog(newLog);
  await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status });
  ctx.showToast(`«${item.title}» marcada como vista.`);
}

async function quickMarkBook(item, ctx) {
  const isReading = item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;
  const newLog = isReading ? finishReading(item.readLog, todayISO()) : startReading(item.readLog, todayISO());
  const status = statusFromReadLog(newLog);
  await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
  ctx.showToast(isReading ? `«${item.title}» terminado.` : `Has empezado «${item.title}».`);
}

async function quickMarkTv(item, ctx) {
  if (item.status === "standby" || item.status === "abandonado") {
    ctx.showToast("Está en pausa/abandonada. Ábrela para retomarla.");
    return;
  }
  if (!item.nextEpisode) {
    ctx.showToast("Esta serie ya está completa.");
    return;
  }
  const { season, episode } = item.nextEpisode;
  const confirmMsg = unreleasedConfirmMessage(item);
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const seasonsMeta = await getSeasonsMetaFor(item, ctx);
  const newWatched = setEpisodeDate(item.watched, season, episode, todayISO());
  const newProgress = computeProgress(seasonsMeta, newWatched);
  await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, {
    watched: newWatched,
    status: newProgress.status,
    nextEpisode: newProgress.nextEpisode,
    firstWatchedAt: newProgress.firstWatchedAt,
    lastWatchedAt: newProgress.lastWatchedAt,
  });
  ctx.showToast(`T${season}E${episode} marcado como visto.`);
}

export async function quickAction(item, btn, ctx) {
  if (btn) btn.disabled = true;
  try {
    if (item.type === "movie") await quickMarkMovie(item, ctx);
    else if (item.type === "tv") await quickMarkTv(item, ctx);
    else await quickMarkBook(item, ctx);
  } catch (err) {
    ctx.showToast("No se pudo actualizar: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
