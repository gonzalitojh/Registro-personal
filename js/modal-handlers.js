// =============================================================
// Apertura de modales de detalle / edición para cada tipo de ítem
// (película, serie, libro). Extraído de app.js para desacoplar la
// lógica de presentación de la lógica de estado general.
// =============================================================

import { addWatch, removeWatch, updateWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, removeReadEntry, updateReadEntry, statusFromReadLog } from "./reading-log.js";
import { computeProgress, setEpisodeDate, setEpisodeRating, setSeasonWatched, startRewatch, normalizeEntry } from "./tv-progress.js";
import { getSeasonsMetaFor } from "./quick-actions.js";
import { todayISO, formatDateEs } from "./dates.js";
import * as ui from "./ui.js";
import { scheduleDeletion } from "./undo-delete.js";
import { getCollectionDetails, getMovieDetails, getWatchProviders } from "./api-movies.js";
import { addItem } from "./db.js";

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
    await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status });
    item.watchLog = newLog;
    item.status = status;
  }

  // Obtener watch providers (no crítico, si falla se muestra sin providers)
  if (item.externalId) {
    try {
      item.watchProviders = await getWatchProviders(item.externalId, "movie", getUserCountry());
    } catch {
      item.watchProviders = null;
    }
  }

  ui.openMovieModal(item, {
    onAddWatch: (date) => persist(addWatch(item.watchLog, date)),
    onUpdateWatch: (index, date) => persist(updateWatch(item.watchLog, index, date)),
    onRemoveWatch: (index) => persist(removeWatch(item.watchLog, index)),
    onSaveMeta: saveMeta(item, "movie", ctx),
    onDelete: confirmDelete(item, "movie", ctx),
    onEdit: editHandlerFor(item, "movie", reopen, ctx),
    onAddSaga: item.collectionId ? () => openSagaSelector(item, ctx) : undefined,
  });
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
  if (details.releaseDate && details.releaseDate > todayISO()) {
    draft.awaitingRelease = true;
  }
  await addItem(ctx.getCurrentUser().uid, "movie", draft);
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
    onFinishReading: (date) => persist(finishReading(item.readLog, date)),
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
    await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, {
      watched: newWatched,
      status: newProgress.status,
      nextEpisode: newProgress.nextEpisode,
      firstWatchedAt: newProgress.firstWatchedAt,
      lastWatchedAt: newProgress.lastWatchedAt,
    });
    item.watched = newWatched;
    item.status = newProgress.status;
    item.nextEpisode = newProgress.nextEpisode;
    item.firstWatchedAt = newProgress.firstWatchedAt;
    item.lastWatchedAt = newProgress.lastWatchedAt;
    return newProgress;
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

    onSetEpisodeDate: (seasonNumber, episodeNumber, dateOrNull) =>
      persistWatched(setEpisodeDate(item.watched, seasonNumber, episodeNumber, dateOrNull)),

    onSetEpisodeRating: (seasonNumber, episodeNumber, rating) =>
      persistWatched(setEpisodeRating(item.watched, seasonNumber, episodeNumber, rating)),

    onToggleSeason: (seasonNumber, allWatched) => {
      const seasonMeta = seasonsMeta.find((s) => s.seasonNumber === seasonNumber);
      return persistWatched(
        setSeasonWatched(item.watched, seasonNumber, seasonMeta.episodeCount, allWatched, todayISO())
      );
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
  });
}

export function openItem(item, ctx) {
  if (item.type === "tv") openTvItem(item, ctx);
  else if (item.type === "movie") openMovieItem(item, ctx);
  else openBookItem(item, ctx);
}

export function setupModalCloseListeners() {
  document.getElementById("modal-close").addEventListener("click", ui.closeModal);
  document.getElementById("modal-backdrop").addEventListener("click", ui.closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") ui.closeModal();
  });
}
