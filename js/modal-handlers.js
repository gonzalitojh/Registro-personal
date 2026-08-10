// =============================================================
// Apertura de modales de detalle / edición para cada tipo de ítem
// (película, serie, libro). Extraído de app.js para desacoplar la
// lógica de presentación de la lógica de estado general.
// =============================================================

import { addWatch, removeWatch, updateWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, removeReadEntry, updateReadEntry, statusFromReadLog } from "./reading-log.js";
import { computeProgress, setEpisodeDate, setEpisodeRating, setSeasonWatched, startRewatch, normalizeEntry, markEpisodeSeenAgain } from "./tv-progress.js";
import { getSeasonsMetaFor } from "./quick-actions.js";
import { todayISO, formatDateEs } from "./dates.js";
import { isUnreleasedDate } from "./release.js";
import * as ui from "./ui.js";
import { scheduleDeletion } from "./undo-delete.js";
import { getCollectionDetails, getMovieDetails, getSimilarMovies, getSimilarTv, getTvExtraDetails, getWatchProviders } from "./api-movies.js";
import { openRatingModal, closeRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";
import { closeEpisodeActionsModal } from "./episode-actions-modal.js";
import { addItem } from "./db.js";

// Abre la ventana de valoración tras marcar como vista/leída una
// película o un libro (issue #21). Nunca lanza: si algo falla, se
// registra en consola y el marcado ya persistido sigue intacto.
// Devuelve true si el usuario deshizo el marcado (issue #136).
async function maybeOpenItemRatingWindow(item, ctx, type, opts = {}) {
  try {
    const result = await openRatingModal({
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
      onUndo: opts.onUndo,
      undoLabel: opts.undoLabel,
    });
    return result === RATING_MODAL_UNDONE;
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
  }
  return false;
}

function confirmDelete(item, kind, ctx) {
  return () => {
    scheduleDeletion(item, ctx.getCurrentUser().uid, kind, ctx);
    ui.closeModal();
  };
}

function saveMeta(item, kind, ctx) {
  return async (changes) => {
    try {
      await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
      ui.showToast("Guardado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo guardar: " + err.message);
    }
  };
}

function editHandlerFor(item, kind, reopen, ctx) {
  return () => {
    ui.openEditModal(item, {
      onSave: async (changes) => {
        try {
          await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
          Object.assign(item, changes);
          ui.showToast("Información actualizada.");
          reopen();
        } catch (err) {
          ui.showToast("No se pudo guardar: " + err.message);
        }
      },
      onCancel: reopen,
    });
  };
}

function progressWithStatus(seasonsMeta, item) {
  const base = computeProgress(seasonsMeta, item.watched);
  if (item.status === "standby" || item.status === "abandonado") {
    return { ...base, status: item.status };
  }
  return base;
}

function getUserCountry() {
  return localStorage.getItem("watch-provider-country")
    || (navigator.language && navigator.language.split("-")[1]?.toUpperCase())
    || "ES";
}

async function openMovieItem(item, ctx) {
  const reopen = () => openMovieItem(item, ctx);
  async function persist(newLog) {
    const status = statusFromWatchLog(newLog);
    // awaitingRelease se limpia siempre al marcar como vista: un ítem
    // ya visto no puede seguir "sin estrenar" (idempotente).
    await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status, awaitingRelease: false });
    item.watchLog = newLog;
    item.status = status;
    item.awaitingRelease = false;
  }

  // Obtener watch providers (no crítico, si falla se muestra sin providers)
  if (item.externalId) {
    try {
      item.watchProviders = await getWatchProviders(item.externalId, "movie", getUserCountry());
    } catch {
      item.watchProviders = null;
    }
  }

  // --- Cargar recomendaciones (similares) ---
  let recommendations = [];
  let existingIds = new Set();
  if (item.externalId) {
    try {
      recommendations = await getSimilarMovies(item.externalId);
      recommendations = recommendations.slice(0, 10);
    } catch {
      recommendations = [];
    }
    existingIds = new Set(ctx.getItemsByGroup("movies").map((m) => m.externalId));
  }

  ui.openMovieModal(item, {
    onAddWatch: async (date) => {
      const prevLog = item.watchLog;
      const prevAwaitingRelease = item.awaitingRelease;
      const prevStatus = item.status;
      await persist(addWatch(item.watchLog, date));
      // Deshacer (issue #136): restaura el watchLog y el status previos
      // sin pasar por persist(), que fuerza awaitingRelease:false. El
      // status se restaura LITERAL al capturado (no al recomputado del
      // log) por si el usuario lo tenía en un estado manual.
      await maybeOpenItemRatingWindow(item, ctx, "movie", {
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
    },
    onUpdateWatch: (index, date) => persist(updateWatch(item.watchLog, index, date)),
    onRemoveWatch: (index) => persist(removeWatch(item.watchLog, index)),
    onSaveMeta: saveMeta(item, "movie", ctx),
    onDelete: confirmDelete(item, "movie", ctx),
    onEdit: editHandlerFor(item, "movie", reopen, ctx),
    onAddSaga: item.collectionId ? () => openSagaSelector(item, ctx) : undefined,
    onAddRecommendation: (recItem, btn) => addFromRecommendation(recItem, btn, ctx),
  }, recommendations, existingIds);
}

/* ---------- Lógica de colecciones/sagas ---------- */

async function addSagaMovie(movie, ctx) {
  const details = await getMovieDetails(movie.externalId);
  const draft = {
    externalId: movie.externalId,
    type: "movie",
    title: movie.title,
    year: movie.year || "",
    coverUrl: movie.posterUrl || null,
    status: "pendiente",
    rating: null,
    notes: "",
    watchLog: [],
    ...details,
  };
  if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) {
    draft.awaitingRelease = true;
  }
  await addItem(ctx.getCurrentUser().uid, "movie", draft);
}

/**
 * Añade un ítem recomendado (película o serie) al registro del usuario.
 * Reutiliza el mismo flujo que handleAdd en search.js para movies/TV.
 */
async function addFromRecommendation(item, btn, ctx) {
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const draft = {
      externalId: item.externalId,
      type: item.type,
      title: item.title,
      year: item.year || "",
      coverUrl: item.coverUrl || null,
      status: "pendiente",
      rating: null,
      notes: "",
    };

    if (item.type === "movie") {
      draft.watchLog = [];
      try {
        const details = await getMovieDetails(item.externalId);
        Object.assign(draft, details);
        if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) {
          draft.awaitingRelease = true;
        }
      } catch (err) {
        // no bloqueamos el alta si falla la obtención de detalles extra
      }
    } else {
      // TV
      draft.watched = {};
      draft.nextEpisode = { season: 1, episode: 1 };
      draft.firstWatchedAt = null;
      draft.lastWatchedAt = null;
      draft.timesCompleted = 0;
      draft.history = [];
      try {
        const details = await getTvExtraDetails(item.externalId);
        Object.assign(draft, details);
        if (details.seasonAirDates && Object.keys(details.seasonAirDates).length) {
          draft.seasonAirDates = details.seasonAirDates;
        }
        if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) {
          draft.awaitingRelease = true;
        }
      } catch (err) {
        // ídem
      }
    }

    await addItem(ctx.getCurrentUser().uid, item.type, draft);
    btn.textContent = "Añadido";
    ui.showToast(`«${item.title}» añadido a tu registro.`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

async function openSagaSelector(item, ctx) {
  if (!item.collectionId) return;
  try {
    const collection = await getCollectionDetails(item.collectionId);
    if (!collection || !collection.parts.length) {
      ui.showToast("No se pudo obtener la información de la saga.");
      return;
    }

    const existingIds = new Set(
      ctx.getItemsByGroup("movies").map((m) => m.externalId)
    );

    const missingMovies = collection.parts.filter(
      (p) => !existingIds.has(p.externalId)
    );

    if (!missingMovies.length) {
      ui.showToast("Ya tienes todas las películas de esta saga.");
      return;
    }

    ui.closeModal();

    ui.openSagaSelectionModal(collection.name, missingMovies, {
      onConfirm: async (selectedMovies) => {
        ui.closeModal();
        let added = 0;
        let failed = 0;

        for (const movie of selectedMovies) {
          try {
            await addSagaMovie(movie, ctx);
            added++;
          } catch (err) {
            console.error("Error al añadir", movie.title, err);
            failed++;
          }
        }

        if (added > 0) {
          ui.showToast(`${added} película${added !== 1 ? "s" : ""} añadida${added !== 1 ? "s" : ""} de ${collection.name}.`);
        }
        if (failed > 0) {
          ui.showToast(`${failed} película${failed !== 1 ? "s" : ""} no pudieron añadirse.`);
        }
      },
      onCancel: () => ui.closeModal(),
    });
  } catch (err) {
    ui.showToast("Error al consultar la saga: " + err.message);
  }
}

function openBookItem(item, ctx) {
  const reopen = () => openBookItem(item, ctx);
  async function persist(newLog) {
    const status = statusFromReadLog(newLog);
    await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
    item.readLog = newLog;
    item.status = status;
  }

  ui.openBookModal(item, {
    onStartReading: (date) => persist(startReading(item.readLog, date)),
    onFinishReading: async (date) => {
      const prevLog = item.readLog;
      const prevStatus = item.status;
      await persist(finishReading(item.readLog, date));
      // Deshacer (issue #136): restaura el readLog y el status previos.
      // El status se restaura LITERAL al capturado (no al recomputado
      // del log) por si el usuario lo tenía en un estado manual.
      await maybeOpenItemRatingWindow(item, ctx, "book", {
        onUndo: async () => {
          await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, {
            readLog: prevLog,
            status: prevStatus,
          });
          item.readLog = prevLog;
          item.status = prevStatus;
        },
      });
    },
    onUpdateEntry: (index, changes) => persist(updateReadEntry(item.readLog, index, changes)),
    onRemoveEntry: (index) => persist(removeReadEntry(item.readLog, index)),
    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || statusFromReadLog(item.readLog);
      await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { status });
      item.status = status;
    },
    onSaveMeta: saveMeta(item, "book", ctx),
    onDelete: confirmDelete(item, "book", ctx),
    onEdit: editHandlerFor(item, "book", reopen, ctx),
  });
}

async function openTvItem(item, ctx) {
  let seasonsMeta;
  try {
    seasonsMeta = await getSeasonsMetaFor(item, ctx);
  } catch (err) {
    ui.showToast(err.message);
    return;
  }
  if (!seasonsMeta.length) {
    ui.showToast("TMDB no devuelve temporadas para esta serie todavía.");
  }

  // Enriquecimiento en vivo de las fechas de temporada (issue #27): si
  // la meta recién consultada difiere de la persistida, se asigna en
  // memoria (el badge del modal vía upcomingBadge se pinta al momento)
  // y se guarda fuego-y-olvido; un fallo aquí no rompe el modal. Las
  // series manuales no tienen fechas reales de TMDB: se excluyen.
  if (!item.manual && seasonsMeta.length) {
    const seasonAirDates = Object.fromEntries(
      seasonsMeta.filter((s) => !s.manual).map((s) => [String(s.seasonNumber), s.airDate])
    );
    if (JSON.stringify(seasonAirDates) !== JSON.stringify(item.seasonAirDates)) {
      item.seasonAirDates = seasonAirDates;
      ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { seasonAirDates })
        .catch((err) => console.error("No se pudieron guardar las fechas de temporada:", err));
    }
  }

  const progress = progressWithStatus(seasonsMeta, item);
  const reopen = () => openTvItem(item, ctx);

  // Obtener watch providers
  if (item.externalId) {
    try {
      item.watchProviders = await getWatchProviders(item.externalId, "tv", getUserCountry());
    } catch {
      item.watchProviders = null;
    }
  }

  async function persistWatched(newWatched) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    // awaitingRelease se limpia siempre al marcar un episodio: una
    // serie con episodios vistos no puede seguir "sin estrenar"
    // (idempotente).
    await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, {
      watched: newWatched,
      status: newProgress.status,
      nextEpisode: newProgress.nextEpisode,
      firstWatchedAt: newProgress.firstWatchedAt,
      lastWatchedAt: newProgress.lastWatchedAt,
      awaitingRelease: false,
    });
    item.watched = newWatched;
    item.status = newProgress.status;
    item.nextEpisode = newProgress.nextEpisode;
    item.firstWatchedAt = newProgress.firstWatchedAt;
    item.lastWatchedAt = newProgress.lastWatchedAt;
    item.awaitingRelease = false;
    return newProgress;
  }

  // Abre la ventana de valoración de un episodio recién marcado
  // (issue #21). Muestra la nota de comunidad DEL EPISODIO (TMDB),
  // no la de la serie. Nunca lanza: el marcado ya persistido queda
  // intacto aunque falle la consulta de metadatos o el guardado.
  // Devuelve true si el usuario deshizo el marcado (issue #136).
  async function maybeOpenEpisodeRatingWindow(item, ctx, seasonNumber, episodeNumber, opts = {}) {
    try {
      let meta = null;
      if (!item.manual && item.externalId) {
        const episodes = await ctx.getSeasonEpisodes(item.externalId, seasonNumber);
        meta = episodes.find((e) => e.episodeNumber === episodeNumber) || null;
      }
      const entry = normalizeEntry(
        (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
      ) || {};
      const result = await openRatingModal({
        type: "tv",
        title: item.title,
        coverUrl: item.coverUrl,
        episodeLabel: meta ? `T${seasonNumber}E${episodeNumber} · ${meta.name}` : `T${seasonNumber}E${episodeNumber}`,
        communityRating: meta ? meta.episodeRating : null,
        communityLabel: "TMDB · episodio",
        initialRating: entry.rating || null,
        onSave: async (rating) => {
          await persistWatched(setEpisodeRating(item.watched, seasonNumber, episodeNumber, rating));
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

  // --- Cargar recomendaciones (similares) ---
  let recommendations = [];
  let existingIds = new Set();
  if (item.externalId) {
    try {
      recommendations = await getSimilarTv(item.externalId);
      recommendations = recommendations.slice(0, 10);
    } catch {
      recommendations = [];
    }
    existingIds = new Set(ctx.getItemsByGroup("tv").map((t) => t.externalId));
  }

  ui.openTvModal(item, seasonsMeta, progress, {
    onExpandSeason: (seasonNumber) =>
      item.manual
        ? Promise.resolve(
            Array.from({ length: seasonsMeta[0].episodeCount }, (_, i) => ({
              episodeNumber: i + 1,
              name: `Episodio ${i + 1}`,
              airDate: null,
            }))
          )
        : ctx.getSeasonEpisodes(item.externalId, seasonNumber),

    onSetEpisodeDate: async (seasonNumber, episodeNumber, dateOrNull) => {
      const prevEntry = normalizeEntry(
        (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
      );
      const wasWatched = Boolean(prevEntry && prevEntry.date);
      const prevAwaitingRelease = item.awaitingRelease;
      const prevStatus = item.status;
      const newProgress = await persistWatched(
        setEpisodeDate(item.watched, seasonNumber, episodeNumber, dateOrNull)
      );
      if (!wasWatched && dateOrNull) {
        // Deshacer (issue #136): si se deshace el marcado recién hecho,
        // se vuelve al progreso previo para que la UI de debajo pinte
        // la casilla/estrellas/fecha correctamente (item ya mutado).
        const undone = await maybeOpenEpisodeRatingWindow(item, ctx, seasonNumber, episodeNumber, {
          onUndo: async () => {
            await persistWatched(setEpisodeDate(item.watched, seasonNumber, episodeNumber, null));
            // persistWatched fuerza awaitingRelease:false y el status
            // recomputado; el segundo update restaura el flag/estado
            // previo. Ventana transitoria en DB auto-reparable
            // (idempotente, issue #136).
            if (prevAwaitingRelease) {
              await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { awaitingRelease: true });
              item.awaitingRelease = true;
            }
            await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { status: prevStatus });
            item.status = prevStatus;
          },
        });
        if (undone) return computeProgress(seasonsMeta, item.watched); // progreso REVERTIDO
      }
      return newProgress;
    },

    onSetEpisodeRating: (seasonNumber, episodeNumber, rating) =>
      persistWatched(setEpisodeRating(item.watched, seasonNumber, episodeNumber, rating)),

    // Episodio YA visto visto de nuevo (issue #133): suma 1 al contador
    // de visualizaciones y pone la fecha en hoy, conservando la valoración.
    onSetEpisodeSeenAgain: (seasonNumber, episodeNumber) =>
      persistWatched(markEpisodeSeenAgain(item.watched, seasonNumber, episodeNumber, todayISO())),

    onToggleSeason: (seasonNumber, allWatched) => {
      const seasonMeta = seasonsMeta.find((s) => s.seasonNumber === seasonNumber);
      return persistWatched(
        setSeasonWatched(item.watched, seasonNumber, seasonMeta.episodeCount, allWatched, todayISO())
      );
    },

    // Fuego-y-olvido: guarda la fecha de emisión del siguiente
    // episodio ({ season, episode, airDate } o null) para poder avisar
    // del "no estrenado" aunque TMDB deje de devolver
    // next_episode_to_air (issue #27). Un fallo no rompe el modal.
    onUpdateNextEpisodeAirDate: (info) => {
      item.nextEpisodeAirDate = info;
      return ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { nextEpisodeAirDate: info })
        .catch((err) => console.error("No se pudo guardar la fecha del próximo episodio:", err));
    },

    onRewatch: async () => {
      const changes = startRewatch(item);
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, changes);
      Object.assign(item, changes);
      ui.closeModal();
      ui.showToast("Nuevo visionado empezado. ¡A por ello!");
    },

    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || computeProgress(seasonsMeta, item.watched).status;
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { status });
      item.status = status;
      return progressWithStatus(seasonsMeta, item);
    },

    onSaveMeta: saveMeta(item, "tv", ctx),
    onDelete: confirmDelete(item, "tv", ctx),
    onEdit: editHandlerFor(item, "tv", reopen, ctx),
    onAddRecommendation: (recItem, btn) => addFromRecommendation(recItem, btn, ctx),
  }, recommendations, existingIds);
}

export function openItem(item, ctx) {
  if (item.type === "tv") openTvItem(item, ctx);
  else if (item.type === "movie") openMovieItem(item, ctx);
  else openBookItem(item, ctx);
}

export function setupModalCloseListeners() {
  document.getElementById("modal-close").addEventListener("click", () => {
    ui.closeModal();
  });
  document.getElementById("modal-backdrop").addEventListener("click", () => {
    ui.closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const episodeActionsModal = document.getElementById("episode-actions-modal");
      const ratingModal = document.getElementById("rating-modal");
      const modal = document.getElementById("item-modal");
      const notifDropdown = document.getElementById("notif-dropdown");

      // Prioridad: episodio-ya-visto > ventana de valoración > modal
      // activo > notificaciones. (La búsqueda global ya no es un modal
      // desde la issue #46: su dropdown de resultados gestiona su propio
      // Escape con stopPropagation, así que nunca llega hasta aquí.)
      if (episodeActionsModal && !episodeActionsModal.classList.contains("hidden")) {
        e.preventDefault();
        closeEpisodeActionsModal();
        return;
      }
      if (ratingModal && !ratingModal.classList.contains("hidden")) {
        e.preventDefault();
        closeRatingModal();
        return;
      }
      if (!modal.classList.contains("hidden")) {
        e.preventDefault();
        ui.closeModal();
      } else if (notifDropdown && !notifDropdown.classList.contains("hidden")) {
        e.preventDefault();
        notifDropdown.classList.add("hidden");
        // Restaurar foco al botón de notificaciones
        const notifBtn = document.getElementById("btn-notifications");
        if (notifBtn) notifBtn.focus();
      }
    }
  });
}
