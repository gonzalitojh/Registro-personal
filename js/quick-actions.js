// =============================================================
// Acciones rápidas (modo lista y swipe): marcar vista, siguiente
// episodio o avanzar lectura sin abrir el modal. Extraído de app.js.
// =============================================================

import { addWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, statusFromReadLog } from "./reading-log.js";
import { setEpisodeDate, setEpisodeRating, computeProgress, normalizeEntry } from "./tv-progress.js";
import { todayISO } from "./dates.js";
import { unreleasedConfirmMessage } from "./release.js";
import { openRatingModal } from "./rating-modal.js";

// Meta de temporadas: para series manuales devuelve una sola
// temporada con el nº de episodios indicado; para el resto, pide
// los datos a TMDB.
export async function getSeasonsMetaFor(item, ctx) {
  if (item.manual) {
    return [{ seasonNumber: 1, name: "Temporada 1", episodeCount: item.manualEpisodeCount || 10 }];
  }
  return ctx.getTvSeasonsMeta(item.externalId);
}

// Abre la ventana de valoración tras marcar como vista/leída una
// película o un libro desde una acción rápida (issue #21). Nunca
// lanza: si algo falla, el marcado ya persistido queda intacto.
async function maybeQuickItemRating(item, ctx, type) {
  try {
    await openRatingModal({
      type,
      title: item.title,
      coverUrl: item.coverUrl,
      communityRating: item.communityRating ?? null,
      communityLabel: "TMDB",
      initialRating: item.rating ?? null,
      onSave: async (rating) => {
        await ctx.updateItem(ctx.getCurrentUser().uid, type, item.id, { rating });
        item.rating = rating;
      },
    });
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
  }
}

async function quickMarkMovie(item, ctx) {
  const confirmMsg = unreleasedConfirmMessage(item);
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const newLog = addWatch(item.watchLog, todayISO());
  const status = statusFromWatchLog(newLog);
  await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status });
  await maybeQuickItemRating(item, ctx, "movie");
  ctx.showToast(`«${item.title}» marcada como vista.`);
}

async function quickMarkBook(item, ctx) {
  const isReading = item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;
  const newLog = isReading ? finishReading(item.readLog, todayISO()) : startReading(item.readLog, todayISO());
  const status = statusFromReadLog(newLog);
  await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
  // La ventana de valoración solo se ofrece al terminar de leer
  if (isReading) await maybeQuickItemRating(item, ctx, "book");
  ctx.showToast(isReading ? `«${item.title}» terminado.` : `Has empezado «${item.title}».`);
}

// Persiste el progreso de una serie (marcado o valoración de un
// episodio) y muta el ítem en memoria, igual que hace quickMarkTv.
function saveTvProgress(item, ctx, seasonsMeta, newWatched) {
  const newProgress = computeProgress(seasonsMeta, newWatched);
  return ctx
    .updateItem(ctx.getCurrentUser().uid, "tv", item.id, {
      watched: newWatched,
      status: newProgress.status,
      nextEpisode: newProgress.nextEpisode,
      firstWatchedAt: newProgress.firstWatchedAt,
      lastWatchedAt: newProgress.lastWatchedAt,
    })
    .then(() => {
      item.watched = newWatched;
      item.status = newProgress.status;
      item.nextEpisode = newProgress.nextEpisode;
      item.firstWatchedAt = newProgress.firstWatchedAt;
      item.lastWatchedAt = newProgress.lastWatchedAt;
    });
}

// Abre la ventana de valoración del episodio recién marcado desde
// una acción rápida (issue #21). meta puede ser null (serie manual
// o episodio sin datos): entonces no se muestra nota de comunidad.
async function maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta) {
  try {
    await openRatingModal({
      type: "tv",
      title: item.title,
      coverUrl: item.coverUrl,
      episodeLabel: meta ? `T${season}E${episode} · ${meta.name}` : `T${season}E${episode}`,
      communityRating: meta?.episodeRating ?? null,
      communityLabel: "TMDB · episodio",
      initialRating: normalizeEntry(item.watched?.[String(season)]?.[String(episode)])?.rating ?? null,
      onSave: async (rating) => {
        await saveTvProgress(
          item,
          ctx,
          seasonsMeta,
          setEpisodeRating(item.watched, season, episode, rating)
        );
      },
    });
  } catch (err) {
    console.error("No se pudo abrir la valoración del episodio:", err);
  }
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
  await saveTvProgress(item, ctx, seasonsMeta, newWatched);
  // Valoración del episodio: con datos TMDB se muestra la nota de
  // comunidad del episodio; en series manuales meta es null, así que
  // la ventana aparece igualmente con "Sin puntuaciones" (igual que
  // en el modal de detalle, issue #21).
  let meta = null;
  if (!item.manual && item.externalId) {
    try {
      const episodes = await ctx.getSeasonEpisodes(item.externalId, season);
      meta = episodes.find((e) => e.episodeNumber === episode) || null;
    } catch (err) {
      console.error("No se pudo obtener el episodio para valorarlo:", err);
    }
  }
  await maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta);
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
