// =============================================================
// Acciones rápidas (modo lista y swipe): marcar vista, siguiente
// episodio o avanzar lectura sin abrir el modal. Extraído de app.js.
// =============================================================

import { addWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, statusFromReadLog } from "./reading-log.js";
import { startPlay, finishPlay, statusFromPlayLog } from "./game-log.js";
import { setEpisodeDate, setEpisodeRating, computeProgress, normalizeEntry, markAllSeasonsWatched } from "./tv-progress.js";
import { todayISO } from "./dates.js";
import { unreleasedConfirmMessage, episodeUnreleasedMessage, isUnreleasedDate } from "./release.js";
import { getNextEpisodeAirInfo } from "./sorting.js";
import { openRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";

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
// Devuelve true si el usuario deshizo el marcado (issue #136).
async function maybeQuickItemRating(item, ctx, type, opts = {}) {
  try {
    const result = await openRatingModal({
      type,
      title: item.title,
      coverUrl: item.coverUrl,
      communityRating: item.communityRating ?? null,
      communityLabel: opts.communityLabel || "TMDB",
      initialRating: item.rating ?? null,
      onSave: async (rating) => {
        await ctx.updateItem(ctx.getCurrentUser().uid, type, item.id, { rating });
        item.rating = rating;
      },
      onUndo: opts.onUndo,
      undoLabel: opts.undoLabel,
    });
    return result === RATING_MODAL_UNDONE;
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
  }
  return false;
}

// Exportado (issue #298): el botón flotante de la ficha en página lo
// usa para «Marcar como vista» (mismo flujo que la acción rápida).
export async function quickMarkMovie(item, ctx) {
  const confirmMsg = unreleasedConfirmMessage(item);
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const prevLog = item.watchLog;
  const prevAwaitingRelease = item.awaitingRelease;
  const prevStatus = item.status;
  const newLog = addWatch(item.watchLog, todayISO());
  const status = statusFromWatchLog(newLog);
  // awaitingRelease se limpia al marcar como vista (idempotente, igual
  // que en el modal de detalle): un ítem ya visto no puede seguir
  // "sin estrenar".
  await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status, awaitingRelease: false });
  // Mutación en memoria (issue #298): el botón flotante de la ficha
  // repinta con el MISMO objeto tras la acción; sin esto, la ficha y
  // el propio botón quedarían con el estado visual anterior al
  // marcado (mismo patrón de mutación que persist() en el modal).
  item.watchLog = newLog;
  item.status = status;
  item.awaitingRelease = false;
  // Deshacer (issue #136): restaura el watchLog/status/awaitingRelease
  // previos sin forzar awaitingRelease:false. El status se restaura
  // LITERAL al capturado (no al recomputado del log).
  const undone = await maybeQuickItemRating(item, ctx, "movie", {
    onUndo: async () => {
      await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, {
        watchLog: prevLog,
        status: prevStatus,
        awaitingRelease: prevAwaitingRelease,
      });
      item.watchLog = prevLog;
      item.status = prevStatus;
      item.awaitingRelease = prevAwaitingRelease;
    },
  });
  ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» marcada como vista.`);
}

async function quickMarkBook(item, ctx) {
  const isReading = item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;
  const newLog = isReading ? finishReading(item.readLog, todayISO()) : startReading(item.readLog, todayISO());
  const status = statusFromReadLog(newLog);
  const prevReadLog = isReading ? item.readLog : null;
  const prevStatus = isReading ? item.status : null;
  await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
  // La ventana de valoración solo se ofrece al terminar de leer
  if (isReading) {
    // Deshacer (issue #136): restaura el readLog y el status previos.
    // El status se restaura LITERAL al capturado (no al recomputado
    // del log) por si el usuario lo tenía en un estado manual.
    const undone = await maybeQuickItemRating(item, ctx, "book", {
      onUndo: async () => {
        await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, {
          readLog: prevReadLog,
          status: prevStatus,
        });
        item.readLog = prevReadLog;
        item.status = prevStatus;
      },
    });
    ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» terminado.`);
  } else {
    ctx.showToast(`Has empezado «${item.title}».`);
  }
}

async function quickMarkGame(item, ctx) {
  const isPlaying = item.playLog && item.playLog.length && !item.playLog[item.playLog.length - 1].finishedAt;
  const newLog = isPlaying ? finishPlay(item.playLog, todayISO()) : startPlay(item.playLog, todayISO());
  const status = statusFromPlayLog(newLog);
  const prevPlayLog = isPlaying ? item.playLog : null;
  const prevStatus = isPlaying ? item.status : null;
  await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { playLog: newLog, status });
  // La ventana de valoración solo se ofrece al terminar de jugar
  if (isPlaying) {
    // Deshacer (issue #136): restaura el playLog y el status previos.
    // El status se restaura LITERAL al capturado (no al recomputado
    // del log) por si el usuario lo tenía en un estado manual.
    const undone = await maybeQuickItemRating(item, ctx, "game", {
      communityLabel: "IGDB",
      onUndo: async () => {
        await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, {
          playLog: prevPlayLog,
          status: prevStatus,
        });
        item.playLog = prevPlayLog;
        item.status = prevStatus;
      },
    });
    ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» terminado.`);
  } else {
    ctx.showToast(`Has empezado «${item.title}».`);
  }
}

// Persiste el progreso de una serie (marcado o valoración de un
// episodio) y muta el ítem en memoria, igual que hace quickMarkTv.
// nextEpisodeAirDate (opcional): fecha de emisión del próximo
// episodio sin estrenar ({ season, episode, airDate } o null); si se
// pasa, se guarda junto al progreso para avisar de "no estrenado"
// sin repetir llamadas a la API.
function saveTvProgress(item, ctx, seasonsMeta, newWatched, nextEpisodeAirDate) {
  const newProgress = computeProgress(seasonsMeta, newWatched);
  const payload = {
    watched: newWatched,
    status: newProgress.status,
    nextEpisode: newProgress.nextEpisode,
    firstWatchedAt: newProgress.firstWatchedAt,
    lastWatchedAt: newProgress.lastWatchedAt,
    // Una serie con episodios vistos no puede seguir "sin estrenar"
    // (idempotente, igual que en el modal de detalle).
    awaitingRelease: false,
  };
  if (nextEpisodeAirDate !== null && nextEpisodeAirDate !== undefined) {
    payload.nextEpisodeAirDate = nextEpisodeAirDate;
  }
  return ctx
    .updateItem(ctx.getCurrentUser().uid, "tv", item.id, payload)
    .then(() => {
      item.watched = newWatched;
      item.status = newProgress.status;
      item.nextEpisode = newProgress.nextEpisode;
      item.firstWatchedAt = newProgress.firstWatchedAt;
      item.lastWatchedAt = newProgress.lastWatchedAt;
      item.awaitingRelease = false;
      if (nextEpisodeAirDate !== null && nextEpisodeAirDate !== undefined) {
        item.nextEpisodeAirDate = nextEpisodeAirDate;
      }
    });
}

// Abre la ventana de valoración del episodio recién marcado desde
// una acción rápida (issue #21). meta puede ser null (serie manual
// o episodio sin datos): entonces no se muestra nota de comunidad.
// Devuelve true si el usuario deshizo el marcado (issue #136).
async function maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta, opts = {}) {
  try {
    const result = await openRatingModal({
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
      onUndo: opts.onUndo,
      undoLabel: opts.undoLabel,
    });
    return result === RATING_MODAL_UNDONE;
  } catch (err) {
    console.error("No se pudo abrir la valoración del episodio:", err);
  }
  return false;
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
  // Confirmación base (cualquier fuente: nextEpisodeToAir en vivo,
  // seasonAirDates refrescado a diario o backfill persistido). Si no
  // aplica y la serie no es manual, se consulta la temporada para
  // verificar el estreno del episodio concreto: TMDB puede no devolver
  // next_episode_to_air (p. ej. serie entre temporadas sin fecha
  // anunciada) aunque el episodio no esté estrenado. Fail-open: si la
  // API falla, se marca sin confirmación.
  let confirmMsg = unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item));
  let episodes = null;
  if (!confirmMsg && !item.manual && item.externalId) {
    try {
      episodes = await ctx.getSeasonEpisodes(item.externalId, season);
      const ep = episodes.find((e) => e.episodeNumber === episode);
      if (ep) confirmMsg = episodeUnreleasedMessage(item.title, season, episode, ep.airDate);
    } catch (err) {
      console.error("No se pudo verificar el estreno del episodio:", err);
    }
  }
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const seasonsMeta = await getSeasonsMetaFor(item, ctx);
  // Refresco de las fechas de temporada (issue #27): si la meta recién
  // consultada difiere de la persistida, se actualiza en memoria y se
  // guarda fuego-y-olvido (mismo patrón que onUpdateNextEpisodeAirDate).
  // Un fallo aquí no rompe la acción. Las series manuales no tienen
  // fechas reales de TMDB: se excluyen.
  if (!item.manual && seasonsMeta.length) {
    const seasonAirDates = Object.fromEntries(
      seasonsMeta.filter((s) => !s.manual).map((s) => [String(s.seasonNumber), s.airDate])
    );
    if (JSON.stringify(seasonAirDates) !== JSON.stringify(item.seasonAirDates)) {
      item.seasonAirDates = seasonAirDates;
      ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { seasonAirDates })
        .catch((err) => console.error("No se pudo guardar las fechas de temporada:", err));
    }
  }
  const newWatched = setEpisodeDate(item.watched, season, episode, todayISO());

  // Si el siguiente episodio (tras marcar este) sigue en la misma
  // temporada y ya tenemos sus datos, guardamos su fecha de emisión
  // (o null si TMDB no la tiene) para poder avisar del "no estrenado"
  // sin más llamadas.
  let nextEpisodeAirDate = null;
  if (episodes) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    if (newProgress.nextEpisode && newProgress.nextEpisode.season === season) {
      const nextEp = episodes.find((e) => e.episodeNumber === newProgress.nextEpisode.episode);
      nextEpisodeAirDate = {
        season,
        episode: newProgress.nextEpisode.episode,
        airDate: nextEp ? nextEp.airDate : null,
      };
    }
  }
  const prevWatched = item.watched;
  const prevAwaitingRelease = item.awaitingRelease;
  const prevStatus = item.status;
  const prevNextEpisodeAirDate = item.nextEpisodeAirDate;
  await saveTvProgress(item, ctx, seasonsMeta, newWatched, nextEpisodeAirDate);
  // Valoración del episodio: con datos TMDB se muestra la nota de
  // comunidad del episodio; en series manuales meta es null, así que
  // la ventana aparece igualmente con "Sin puntuaciones" (igual que
  // en el modal de detalle, issue #21). Si el episodio ya se consultó
  // para verificar el estreno, se reutiliza sin repetir la llamada.
  let meta = null;
  if (episodes) {
    meta = episodes.find((e) => e.episodeNumber === episode) || null;
  } else if (!item.manual && item.externalId) {
    try {
      const eps = await ctx.getSeasonEpisodes(item.externalId, season);
      meta = eps.find((e) => e.episodeNumber === episode) || null;
    } catch (err) {
      console.error("No se pudo obtener el episodio para valorarlo:", err);
    }
  }
  // Deshacer (issue #136): restaura el progreso previo de la serie
  // (watched, status literal del capturado, nextEpisode, fechas y
  // awaitingRelease; saveTvProgress recalcula el status y este payload
  // lo sobreescribe con el previo por si era un estado manual).
  const undone = await maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta, {
    onUndo: async () => {
      const prevProgress = computeProgress(seasonsMeta, prevWatched);
      const payload = {
        watched: prevWatched,
        status: prevStatus,
        nextEpisode: prevProgress.nextEpisode,
        firstWatchedAt: prevProgress.firstWatchedAt,
        lastWatchedAt: prevProgress.lastWatchedAt,
        awaitingRelease: prevAwaitingRelease,
        nextEpisodeAirDate: prevNextEpisodeAirDate === undefined ? null : prevNextEpisodeAirDate,
      };
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, payload);
      item.watched = prevWatched;
      item.status = payload.status;
      item.nextEpisode = payload.nextEpisode;
      item.firstWatchedAt = payload.firstWatchedAt;
      item.lastWatchedAt = payload.lastWatchedAt;
      item.awaitingRelease = prevAwaitingRelease;
      item.nextEpisodeAirDate = payload.nextEpisodeAirDate;
    },
  });
  ctx.showToast(undone ? "Desmarcado." : `T${season}E${episode} marcado como visto.`);
}

// Marca TODA una serie como vista: todos los episodios de todas las
// temporadas quedan marcados con la fecha de hoy (issue #298, botón
// flotante de la ficha en página). Mismo patrón que quickMarkTv:
// confirmación cuando hay temporadas aún no estrenadas, persistencia
// del progreso recomputado y ventana de valoración con deshacer
// (issue #136) — la valoración es de la serie en su conjunto (sin
// episodeLabel, igual que el alta como vista del catálogo).
export async function quickMarkTvComplete(item, ctx) {
  if (item.status === "standby" || item.status === "abandonado") {
    ctx.showToast("Está en pausa/abandonada. Ábrela para retomarla.");
    return;
  }
  if (!item.nextEpisode) {
    ctx.showToast("Esta serie ya está completa.");
    return;
  }
  const seasonsMeta = await getSeasonsMetaFor(item, ctx);
  if (!seasonsMeta.length) {
    ctx.showToast("No se pudieron obtener las temporadas de esta serie.");
    return;
  }
  // Confirmación si hay temporadas aún no estrenadas (mismo criterio
  // que la alta directa como vista del catálogo, search.js). Las
  // series manuales no tienen fechas reales de TMDB: se excluyen.
  if (!item.manual) {
    const unreleasedSeasons = seasonsMeta.filter((s) => isUnreleasedDate(s.airDate));
    if (unreleasedSeasons.length) {
      const msg = `«${item.title}» · ${unreleasedSeasons.length} de ${seasonsMeta.length} temporadas aún no están estrenadas. ¿Marcarlas todas igualmente como vistas?`;
      if (!window.confirm(msg)) return;
    }
  }
  const prevWatched = item.watched;
  const prevStatus = item.status;
  const prevAwaitingRelease = item.awaitingRelease;
  const prevNextEpisode = item.nextEpisode;
  const prevFirstWatchedAt = item.firstWatchedAt;
  const prevLastWatchedAt = item.lastWatchedAt;
  const prevNextEpisodeAirDate = item.nextEpisodeAirDate;
  // Todos los episodios de todas las temporadas, marcados hoy.
  const newWatched = markAllSeasonsWatched(item.watched, seasonsMeta, todayISO());
  const newProgress = computeProgress(seasonsMeta, newWatched);
  const payload = {
    watched: newWatched,
    status: newProgress.status,
    nextEpisode: newProgress.nextEpisode,
    firstWatchedAt: newProgress.firstWatchedAt,
    lastWatchedAt: newProgress.lastWatchedAt,
    // Una serie con episodios vistos no puede seguir "sin estrenar".
    awaitingRelease: false,
  };
  await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, payload);
  item.watched = newWatched;
  item.status = payload.status;
  item.nextEpisode = payload.nextEpisode;
  item.firstWatchedAt = payload.firstWatchedAt;
  item.lastWatchedAt = payload.lastWatchedAt;
  item.awaitingRelease = false;
  // Valoración de la serie en su conjunto. Deshacer (issue #136):
  // restaura el progreso previo (watched, status literal del
  // capturado, nextEpisode, fechas y awaitingRelease) para que la UI
  // repinte el estado anterior.
  const undone = await maybeQuickItemRating(item, ctx, "tv", {
    onUndo: async () => {
      const prevProgress = computeProgress(seasonsMeta, prevWatched || {});
      const undoPayload = {
        watched: prevWatched || {},
        status: prevStatus,
        nextEpisode: prevNextEpisode ?? prevProgress.nextEpisode,
        firstWatchedAt: prevFirstWatchedAt ?? prevProgress.firstWatchedAt,
        lastWatchedAt: prevLastWatchedAt ?? prevProgress.lastWatchedAt,
        awaitingRelease: prevAwaitingRelease,
        nextEpisodeAirDate: prevNextEpisodeAirDate === undefined ? null : prevNextEpisodeAirDate,
      };
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, undoPayload);
      item.watched = undoPayload.watched;
      item.status = undoPayload.status;
      item.nextEpisode = undoPayload.nextEpisode;
      item.firstWatchedAt = undoPayload.firstWatchedAt;
      item.lastWatchedAt = undoPayload.lastWatchedAt;
      item.awaitingRelease = undoPayload.awaitingRelease;
      item.nextEpisodeAirDate = undoPayload.nextEpisodeAirDate;
    },
  });
  ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» marcada como vista.`);
}

// Abre la ventana de valoración del ítem (película o serie) SIN marcar
// nada (issue #298, botón flotante de la ficha en página). Reutiliza
// el flujo de maybeQuickItemRating: nunca lanza; si el usuario guarda,
// onSave persiste la valoración del ítem.
export async function promptItemRating(item, ctx) {
  await maybeQuickItemRating(item, ctx, item.type === "tv" ? "tv" : "movie");
}

export async function quickAction(item, btn, ctx) {
  if (btn) btn.disabled = true;
  try {
    if (item.type === "movie") await quickMarkMovie(item, ctx);
    else if (item.type === "tv") await quickMarkTv(item, ctx);
    else if (item.type === "game") await quickMarkGame(item, ctx);
    else await quickMarkBook(item, ctx);
  } catch (err) {
    ctx.showToast("No se pudo actualizar: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
