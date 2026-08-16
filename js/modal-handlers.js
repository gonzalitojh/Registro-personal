// =============================================================
// Apertura de modales de detalle / edición para cada tipo de ítem
// (película, serie, libro). Extraído de app.js para desacoplar la
// lógica de presentación de la lógica de estado general.
// =============================================================

import { addWatch, removeWatch, updateWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, removeReadEntry, updateReadEntry, statusFromReadLog } from "./reading-log.js";
import { startPlay, finishPlay, removePlayEntry, updatePlayEntry, statusFromPlayLog } from "./game-log.js";
import { computeProgress, setEpisodeDate, setEpisodeRating, setSeasonWatched, startRewatch, normalizeEntry, markEpisodeSeenAgain } from "./tv-progress.js";
import { getSeasonsMetaFor } from "./quick-actions.js";
import { todayISO, formatDateEs } from "./dates.js";
import { isUnreleasedDate } from "./release.js";
import * as ui from "./ui.js";
import { scheduleDeletion } from "./undo-delete.js";
import { getCollectionDetails, getMovieDetails, getSimilarMovies, getSimilarTv, getTvExtraDetails, getTvSeasonsMeta, getWatchProviders } from "./api-movies.js";
import { getGameDetails } from "./api-games.js";
import { minimalStoredFields } from "./search.js";
import { openRatingModal, closeRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";
import { closeEpisodeActionsModal } from "./episode-actions-modal.js";
import { addItem } from "./db.js";
import { needsDetailFetch, loadItemDetails } from "./item-details.js";
// navigate (issue #285, iteración): las tarjetas de saga y de
// recomendación navegan a la PÁGINA de detalle del ítem. Import seguro
// sin dependencia circular: router.js no importa nada de la app.
import { navigate } from "./router.js";

// Detalles de ficha bajo demanda (issue #200, almacenamiento mínimo):
// si el documento no trae la ficha (solo tarjeta + avisos), el modal
// se abre al momento con un placeholder y los detalles se cargan en
// segundo plano (caché en memoria de 24 h). Al llegar, se re-renderiza
// el modal completo y se revalida la tarjeta guardada (portada y rating
// comunitario, stale-while-revalidate del estudio §9 R3: 1 escritura
// solo si cambian). Si la red falla, la ficha queda «solo tarjeta»
// (degradación elegante) y no se reintenta en esa sesión.
function loadDetailsForModal(item, ctx, rerender) {
  const prevCoverUrl = item.coverUrl;
  const prevCommunityRating = item.communityRating;
  loadItemDetails(item).then((details) => {
    if (!details) {
      item._detailsFailed = true;
      rerender();
      return;
    }
    const changes = {};
    if (item.coverUrl && item.coverUrl !== prevCoverUrl) changes.coverUrl = item.coverUrl;
    if (item.communityRating != null && item.communityRating !== prevCommunityRating) {
      changes.communityRating = item.communityRating;
    }
    if (Object.keys(changes).length) {
      ctx
        .updateItem(ctx.getCurrentUser().uid, item.type, item.id, changes)
        .catch((err) => console.error("No se pudo revalidar la tarjeta:", item.title, err));
    }
    rerender();
  });
}

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

function confirmDelete(item, kind, ctx, onDone) {
  return () => {
    scheduleDeletion(item, ctx.getCurrentUser().uid, kind, ctx);
    ui.closeModal();
    // En modo página (issue #285) «Eliminar» cierra el modal abierto
    // (si lo hubiera) y vuelve a la pantalla previa: el item se borra
    // con deshacer (undo-toast) y la lista de origen se repinta sola
    // vía snapshot al volver.
    if (onDone) onDone();
  };
}

function saveMeta(item, kind, ctx, onDone) {
  return async (changes) => {
    try {
      await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
      ui.showToast("Guardado.");
      // En modo página (issue #285) se re-renderiza la ficha en la
      // página; en el modal clásico se cierra la ventana.
      if (onDone) onDone();
      else ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo guardar: " + err.message);
    }
  };
}

function editHandlerFor(item, kind, reopen, ctx, target = null) {
  return () => {
    ui.openEditModal(item, {
      onSave: async (changes) => {
        try {
          await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
          Object.assign(item, changes);
          ui.showToast("Información actualizada.");
          // En modo página (issue #285) el modal de edición se abre
          // SIEMPRE (es un form con foco atrapado): al guardar o
          // cancelar hay que cerrarlo — el re-render va en la página,
          // no dentro del modal. En el modal clásico el re-render
          // ocurre dentro y no debe cerrarse aquí.
          if (target) ui.closeModal();
          reopen();
        } catch (err) {
          ui.showToast("No se pudo guardar: " + err.message);
        }
      },
      onCancel: () => {
        if (target) ui.closeModal();
        reopen();
      },
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

// Abre la ficha de una película. Con target (contenedor de la página
// de ítem, issue #285) renderiza la ficha en la página en lugar de
// abrir el modal; sin target, comportamiento clásico en #item-modal.
// isRerender evita re-pedir detalles/API en los re-renders.
export async function openMovieItem(item, ctx, isRerender = false, target = null) {
  const reopen = () => openMovieItem(item, ctx, true, target);
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
    existingIds = new Set((await ctx.getGroupItemsResolved("movies")).map((m) => m.externalId));
  }

  // --- Cargar películas de la saga (issue #280) ---
  // Si falla la consulta no bloqueamos la ficha: la sección se oculta
  // (degradación elegante) y el banner de saga sigue visible.
  let sagaParts = null;
  if (item.collectionId) {
    try {
      const collection = await getCollectionDetails(item.collectionId);
      sagaParts = (collection && collection.parts.length) ? collection.parts : null;
    } catch {
      sagaParts = null;
    }
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
    onSaveMeta: saveMeta(item, "movie", ctx, target ? reopen : null),
    onDelete: confirmDelete(item, "movie", ctx, target ? () => goBackFromItemPage() : null),
    onEdit: editHandlerFor(item, "movie", reopen, ctx, target),
    onAddSaga: item.collectionId ? () => openSagaSelector(item, ctx) : undefined,
    // Al añadir una recomendación se actualiza existingIds (Set
    // compartido con el render): tras un re-render la tarjeta sigue
    // mostrando "Añadido" y no se puede crear un duplicado (issue #280).
    onAddRecommendation: async (recItem, btn) => {
      if (await addFromRecommendation(recItem, btn, ctx)) {
        existingIds.add(String(recItem.externalId));
      }
    },
    // Alta directa de una película de la saga desde su tarjeta
    // (issue #280). existingIds es un Set compartido con el render,
    // así los rerenders posteriores del modal la muestran como
    // "Añadida".
    onAddSagaMovie: item.collectionId
      ? async (movie, btn) => {
          btn.disabled = true;
          btn.textContent = "Añadiendo…";
          try {
            await addSagaMovie(movie, ctx);
            existingIds.add(String(movie.externalId));
            btn.textContent = "Añadida";
            ui.showToast(`«${movie.title}» añadida a tu registro.`);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Añadir";
            ui.showToast("No se pudo añadir: " + err.message);
          }
        }
      : undefined,
    // Pulsar la tarjeta de una película de la saga (issue #285,
    // iteración): ya no abre la vista previa en ventana — navega a la
    // PÁGINA de detalle de esa película (#/ocio/peliculas/<id>), igual
    // que cualquier otra película pulsable. Si no está en el registro,
    // la página muestra la vista previa con «Añadir».
    onOpenSagaMovie: item.collectionId
      ? (movie) => navigate({ section: "item", kind: "movie", externalId: movie.externalId })
      : undefined,
    // Pulsar la tarjeta de una recomendación (issue #285, iteración):
    // misma navegación a la página de detalle de la película/serie.
    onOpenRecommendation: (recItem) =>
      navigate({ section: "item", kind: recItem.type === "tv" ? "tv" : "movie", externalId: recItem.externalId }),
  }, recommendations, existingIds, sagaParts, { target });

  // Ficha bajo demanda: cargar detalles ampliados en segundo plano
  // (solo la primera apertura; los re-render no vuelven a pedirlos).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
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
    // Almacenamiento mínimo (issue #200): solo tarjeta + avisos + rating
    // comunitario; el resto de la ficha se pide bajo demanda.
    ...minimalStoredFields(details, "movie"),
  };
  if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) {
    draft.awaitingRelease = true;
  }
  await addItem(ctx.getCurrentUser().uid, "movie", draft);
}

// NOTA (issue #285, iteración): los helpers de vista previa en ventana
// de saga/recomendaciones (openExternalPreview, enrichExternalPreview,
// openSagaMoviePreview, openRecommendationPreview) se han ELIMINADO:
// pulsar la tarjeta de una saga o de una recomendación ahora navega a
// la página de detalle del ítem (callbacks onOpenSagaMovie/
// onOpenRecommendation → navigate()), igual que cualquier otra
// película o serie pulsable. La página muestra la ficha o la vista
// previa con «Añadir» según el ítem esté o no en el registro (ver
// js/item-page.js), por lo que la preview en ventana ya no hace falta
// en esta vía. La preview de búsqueda (issue #22) sigue viva para
// libros y videojuegos en search.js.

/**
 * Añade un ítem recomendado (película o serie) al registro del usuario.
 * Núcleo sin estado de botón: reutiliza el mismo flujo que handleAdd en
 * search.js para movies/TV. No lanza: devuelve true/false.
 * @returns {Promise<boolean>} true si se añadió correctamente.
 */
async function addRecommendationItem(item, ctx) {
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
      // Almacenamiento mínimo: solo tarjeta + avisos + rating comunitario.
      Object.assign(draft, minimalStoredFields(details, "movie"));
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
      // Almacenamiento mínimo: los campos de avisos sí se persisten.
      Object.assign(draft, minimalStoredFields(details, "tv"));
      if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) {
        draft.awaitingRelease = true;
      }
    } catch (err) {
      // ídem
    }
  }

  await addItem(ctx.getCurrentUser().uid, item.type, draft);
  return true;
}

/**
 * Añade un ítem recomendado (película o serie) al registro del usuario,
 * gestionando el estado del botón de la tarjeta. Envuelve
 * addRecommendationItem.
 * @returns {Promise<boolean>} true si se añadió correctamente.
 */
async function addFromRecommendation(item, btn, ctx) {
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const ok = await addRecommendationItem(item, ctx);
    if (!ok) throw new Error("No se pudo añadir el ítem");
    btn.textContent = "Añadido";
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
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
      (await ctx.getGroupItemsResolved("movies")).map((m) => m.externalId)
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

async function openGameItem(item, ctx, isRerender = false) {
  const reopen = () => openGameItem(item, ctx, true);
  async function persist(newLog) {
    const status = statusFromPlayLog(newLog);
    await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { playLog: newLog, status });
    item.playLog = newLog;
    item.status = status;
  }

  ui.openGameModal(item, {
    onStartPlay: (date) => persist(startPlay(item.playLog, date)),
    onFinishPlay: async (date) => {
      const prevLog = item.playLog;
      const prevStatus = item.status;
      await persist(finishPlay(item.playLog, date));
      // Deshacer (issue #136): restaura el playLog y el status previos.
      // El status se restaura LITERAL al capturado (no al recomputado
      // del log) por si el usuario lo tenía en un estado manual.
      await maybeOpenItemRatingWindow(item, ctx, "game", {
        communityLabel: "IGDB",
        onUndo: async () => {
          await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, {
            playLog: prevLog,
            status: prevStatus,
          });
          item.playLog = prevLog;
          item.status = prevStatus;
        },
      });
    },
    onUpdateEntry: (index, changes) => persist(updatePlayEntry(item.playLog, index, changes)),
    onRemoveEntry: (index) => persist(removePlayEntry(item.playLog, index)),
    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || statusFromPlayLog(item.playLog);
      await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { status });
      item.status = status;
    },
    onSaveMeta: saveMeta(item, "game", ctx),
    onDelete: confirmDelete(item, "game", ctx),
    onEdit: editHandlerFor(item, "game", reopen, ctx),
  });

  // Ficha bajo demanda: cargar detalles ampliados en segundo plano
  // (solo la primera apertura; los re-render no vuelven a pedirlos).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
}

// Abre la ficha de una serie. Con target (contenedor de la página de
// ítem, issue #285) renderiza la ficha en la página en lugar de abrir
// el modal; sin target, comportamiento clásico en #item-modal.
export async function openTvItem(item, ctx, isRerender = false, target = null) {
  const reopen = () => openTvItem(item, ctx, true, target);
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
    existingIds = new Set((await ctx.getGroupItemsResolved("tv")).map((t) => t.externalId));
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
      // Modo página (issue #285): se re-renderiza la ficha en la
      // página; en el modal clásico se cierra la ventana.
      if (target) reopen();
      else ui.closeModal();
      ui.showToast("Nuevo visionado empezado. ¡A por ello!");
    },

    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || computeProgress(seasonsMeta, item.watched).status;
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { status });
      item.status = status;
      return progressWithStatus(seasonsMeta, item);
    },

    onSaveMeta: saveMeta(item, "tv", ctx, target ? reopen : null),
    onDelete: confirmDelete(item, "tv", ctx, target ? () => goBackFromItemPage() : null),
    onEdit: editHandlerFor(item, "tv", reopen, ctx, target),
    onAddRecommendation: async (recItem, btn) => {
      if (await addFromRecommendation(recItem, btn, ctx)) {
        existingIds.add(String(recItem.externalId));
      }
    },
    // Pulsar la tarjeta de una recomendación (issue #285, iteración):
    // navega a la PÁGINA de detalle de la serie/película (#/ocio/
    // series/<id> o #/ocio/peliculas/<id>) en lugar de la preview en
    // ventana; si no está en el registro, la página muestra la vista
    // previa con «Añadir».
    onOpenRecommendation: (recItem) =>
      navigate({ section: "item", kind: recItem.type === "tv" ? "tv" : "movie", externalId: recItem.externalId }),
  }, recommendations, existingIds, { target });

  // Ficha bajo demanda: cargar detalles ampliados en segundo plano
  // (solo la primera apertura; los re-render no vuelven a pedirlos).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
}

export function openItem(item, ctx) {
  if (item.type === "tv") openTvItem(item, ctx);
  else if (item.type === "movie") openMovieItem(item, ctx);
  else if (item.type === "game") openGameItem(item, ctx);
  else openBookItem(item, ctx);
}

// Hook de «volver a la pantalla previa» que registra item-page.js
// (issue #285): lo usa confirmDelete en modo página para salir de la
// ficha tras eliminar un ítem. Se inyecta para evitar una dependencia
// circular (item-page.js importa de aquí openMovieItem/openTvItem).
let itemPageBackHandler = null;

export function setItemPageBackHandler(fn) {
  itemPageBackHandler = fn;
}

function goBackFromItemPage() {
  if (itemPageBackHandler) itemPageBackHandler();
}

export function setupModalCloseListeners() {
  // Cierra el modal activo respetando un cierre personalizado registrado
  // (modal._onClose, lo registra ui.openSearchPreviewModal para las
  // vistas previas de búsqueda —issue #22/#280— cuando quieren
  // restaurar algo al cerrar; se consume antes de invocarlo). Si no
  // hay personalizado, cierre normal.
  const closeActiveModal = () => {
    const modal = document.getElementById("item-modal");
    if (modal._onClose) {
      const onClose = modal._onClose;
      modal._onClose = null;
      onClose();
    } else {
      ui.closeModal();
    }
  };

  document.getElementById("modal-close").addEventListener("click", () => {
    closeActiveModal();
  });
  document.getElementById("modal-backdrop").addEventListener("click", () => {
    closeActiveModal();
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
        closeActiveModal();
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
