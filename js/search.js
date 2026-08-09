// =============================================================
// Búsqueda de películas, series y libros + alta desde resultados
// + alta manual. Extraído de app.js para desacoplar toda la lógica
// de búsqueda de la orquestación general.
//
// Desde la issue #82 este módulo es stateless: no toca el DOM ni
// guarda resultados. La UI del dropdown (incluida la búsqueda en el
// catálogo) vive en global-search.js, que importa de aquí las
// funciones de alta, preview y llamadas a la API.
// =============================================================

import { addItem, updateItem, deleteItem } from "./db.js";
import { getMovieDetails, getTvExtraDetails, getTvSeasonsMeta, searchMovies as apiSearchMovies, searchTv as apiSearchTv } from "./api-movies.js";
import { searchBooks as apiSearchBooks, getOpenLibraryDescription } from "./api-books.js";
import { isUnreleasedDate, unreleasedConfirmMessage } from "./release.js";
import { todayISO } from "./dates.js";
import { computeProgress, markAllSeasonsWatched } from "./tv-progress.js";
import { openRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";
import * as ui from "./ui.js";

// Búsqueda en el catálogo de un grupo (stateless: solo devuelve
// datos, sin tocar el DOM). group: "movies" | "tv" | "books".
// Devuelve { items, hasMore, source } (source solo para libros:
// "googlebooks" | "openlibrary").
export async function searchExternal(group, query, page = 1) {
  if (group === "movies") return apiSearchMovies(query, page);
  if (group === "tv") return apiSearchTv(query, page);
  // Libros: siempre en español (la casilla "Solo en español" se
  // eliminó en la issue #82).
  return apiSearchBooks(query, page, null, true);
}

export function existingIdsFor(group, ctx) {
  return new Set(ctx.getItemsByGroup(group).map((i) => i.externalId));
}

// Para libros: detecta si ya están añadidos por externalId O por
// título+autor (cruce entre fuentes: un libro añadido vía Open
// Library con ID "/works/..." se detecta también en resultados de
// Google Books y viceversa).
export function existingBookKeys(ctx) {
  const books = ctx.getItemsByGroup("books");
  const keys = new Set();
  for (const b of books) {
    const key = `${(b.title || "").trim().toLowerCase()}|${(b.author || "").trim().toLowerCase()}`;
    keys.add(key);
  }
  return keys;
}

export function isBookAlreadyAdded(item, idsSet, keysSet) {
  if (idsSet.has(item.externalId)) return true;
  const key = `${(item.title || "").trim().toLowerCase()}|${(item.author || "").trim().toLowerCase()}`;
  return keysSet.has(key);
}

/* ---------- Alta desde resultados ---------- */

async function doAddBook(item, btn, ctx, choices) {
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const draft = {
      externalId: item.externalId,
      type: "book",
      title: item.title,
      year: item.year || "",
      coverUrl: choices.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "pendiente",
      rating: null,
      notes: "",
      description: choices.description || "",
      progress: null,
      readLog: [],
    };

    // Para libros de Open Library (ID "/works/..."), buscar sinopsis
    // si no se proporcionó ninguna.
    if (!draft.description && item.externalId && item.externalId.startsWith("/works/")) {
      try {
        draft.description = await getOpenLibraryDescription(item.externalId);
      } catch (err) {
        // no bloqueamos el alta
      }
    }

    await addItem(ctx.getCurrentUser().uid, "book", draft);
    ui.closeModal();
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

export async function handleAdd(item, btn, ctx) {
  if (!ctx.getCurrentUser()) return;

  // Para libros con múltiples portadas o sinopsis, abrir modal de
  // selección antes de añadir.
  if (
    item.type === "book" &&
    ((item.allCovers && item.allCovers.length > 1) ||
      (item.allDescriptions && item.allDescriptions.length > 1))
  ) {
    ui.openBookConfirmModal(item, {
      onConfirm: (choices) => doAddBook(item, btn, ctx, choices),
      onCancel: () => ui.closeModal(),
    });
    return;
  }

  // Ruta rápida: sin opciones que elegir (o fuente Open Library con una portada).
  if (item.type === "book") {
    return await doAddBook(item, btn, ctx, {
      coverUrl: item.coverUrl,
      description: item.description || "",
    });
  }

  // --- Películas / series (sin cambios) ---
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const draft = {
      externalId: item.externalId,
      type: item.type,
      title: item.title,
      year: item.year || "",
      coverUrl: item.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "pendiente",
      rating: null,
      notes: "",
    };

    if (item.type === "movie") {
      draft.watchLog = [];
      try {
        const details = await getMovieDetails(item.externalId);
        Object.assign(draft, details);
        if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) draft.awaitingRelease = true;
      } catch (err) {
        // no bloqueamos el alta si este paso extra falla
      }
    } else if (item.type === "tv") {
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
        if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) draft.awaitingRelease = true;
      } catch (err) {
        // ídem
      }
    }

    await addItem(ctx.getCurrentUser().uid, item.type, draft);
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

/* ---------- Alta directa como visto desde el catálogo (issue #115) ---------- */

// Restaura el botón «Marcar visto» a su estado inicial (tras abortar,
// fallar o deshacer el flujo de alta como visto).
function restoreSeenBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "Marcar visto";
}

// Da de alta el ítem como visto y abre la ventana de valoración al
// momento (patrón maybeQuickItemRating de quick-actions.js). Nunca
// lanza: si la ventana no puede abrirse, el alta ya persistida queda
// intacta. Devuelve true solo si el flujo terminó sin deshacer; false
// si el usuario deshizo el marcado (el toast ya informó de ello).
async function openSeenRating(uid, type, ref, opts) {
  try {
    const result = await openRatingModal({
      type,
      title: opts.title,
      coverUrl: opts.coverUrl,
      communityRating: opts.communityRating ?? null,
      communityLabel: "TMDB",
      initialRating: null,
      onSave: async (rating) => {
        await updateItem(uid, type, ref.id, { rating });
      },
      onUndo: async () => {
        await deleteItem(uid, type, ref.id);
      },
    });
    const undone = result === RATING_MODAL_UNDONE;
    if (undone) {
      ui.showToast("Marcado deshecho.");
      // false = el botón debe restaurarse: tras el undo, el snapshot de
      // Firestore re-renderiza la fila con ambos botones activos y en el
      // interín no debe quedar el botón en «Visto» (issue #115).
      return false;
    }
    ui.showToast(opts.doneToast);
    return true;
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
    return false;
  }
}

// Alta de libro ya leído (issue #115): mismo esqueleto que doAddBook,
// pero con status "completado" y el readLog con inicio y fin hoy.
async function doAddBookSeen(item, btn, ctx, choices) {
  btn.disabled = true;
  btn.textContent = "Marcando…";
  try {
    const draft = {
      externalId: item.externalId,
      type: "book",
      title: item.title,
      year: item.year || "",
      coverUrl: choices.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "completado",
      rating: null,
      notes: "",
      description: choices.description || "",
      progress: null,
      readLog: [{ startedAt: todayISO(), finishedAt: todayISO() }],
    };

    // Para libros de Open Library (ID "/works/..."), buscar sinopsis
    // si no se proporcionó ninguna (mismo backfill que doAddBook).
    if (!draft.description && item.externalId && item.externalId.startsWith("/works/")) {
      try {
        draft.description = await getOpenLibraryDescription(item.externalId);
      } catch (err) {
        // no bloqueamos el alta
      }
    }

    const ref = await addItem(ctx.getCurrentUser().uid, "book", draft);
    ui.closeModal();
    const ok = await openSeenRating(ctx.getCurrentUser().uid, "book", ref, {
      title: item.title,
      coverUrl: choices.coverUrl,
      communityRating: null,
      doneToast: `«${item.title}» añadido y marcado como leído.`,
    });
    // La ruta multi-portada no tiene listener que consuma la promesa
    // (el flujo continuó en el modal de confirmación): el estado final
    // del botón se fija aquí mismo, como hace el listener del dropdown.
    if (ok) {
      btn.disabled = true;
      btn.textContent = "Visto";
    } else {
      restoreSeenBtn(btn);
    }
    return ok;
  } catch (err) {
    restoreSeenBtn(btn);
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

// Marca un resultado del catálogo como visto directamente y abre la
// valoración al momento, evitando el paso intermedio añadir→marcar
// (issue #115). En series marca TODOS los episodios de TODAS las
// temporadas y valora la serie en su conjunto.
// Devuelve Promise<boolean>: true = añadido y flujo completado,
// false = abortado, error o deshecho.
export async function handleAddSeen(item, btn, ctx) {
  if (!ctx.getCurrentUser()) return false;

  // Para libros con múltiples portadas o sinopsis, abrir modal de
  // selección antes de añadir (mismo predicado que handleAdd). No se
  // espera: el resultado llega vía doAddBookSeen.
  if (
    item.type === "book" &&
    ((item.allCovers && item.allCovers.length > 1) ||
      (item.allDescriptions && item.allDescriptions.length > 1))
  ) {
    ui.openBookConfirmModal(item, {
      onConfirm: (choices) => doAddBookSeen(item, btn, ctx, choices),
      onCancel: () => ui.closeModal(),
    });
    return;
  }

  // Ruta rápida: sin opciones que elegir (o fuente Open Library con una portada).
  if (item.type === "book") {
    return await doAddBookSeen(item, btn, ctx, {
      coverUrl: item.coverUrl,
      description: item.description || "",
    });
  }

  // --- Películas / series ---
  btn.disabled = true;
  btn.textContent = "Marcando…";
  try {
    if (item.type === "movie") {
      let details = {};
      try {
        details = await getMovieDetails(item.externalId);
      } catch (err) {
        // no bloqueamos el alta si este paso extra falla
      }

      // Confirmación de no estrenado: los resultados de búsqueda no
      // traen releaseDate, así que se usa el de los detalles (con
      // fallback null, que el mensaje trata como "sin fecha oficial").
      const msg = unreleasedConfirmMessage({
        type: "movie",
        manual: false,
        releaseDate: details.releaseDate || null,
        title: item.title,
      });
      if (msg && !window.confirm(msg)) {
        restoreSeenBtn(btn);
        return false;
      }

      const draft = {
        externalId: item.externalId,
        type: "movie",
        title: item.title,
        year: item.year || "",
        coverUrl: item.coverUrl || null,
        author: item.author || null,
        pages: item.pages || null,
        status: "completado",
        rating: null,
        notes: "",
        watchLog: [todayISO()],
        awaitingRelease: false,
      };
      Object.assign(draft, details);

      // TMDB puede devolver poster_path null: no pisar la portada del
      // resultado de búsqueda (patrón del review de QA, issue #115).
      draft.coverUrl = draft.coverUrl || item.coverUrl;

      const ref = await addItem(ctx.getCurrentUser().uid, "movie", draft);
      return await openSeenRating(ctx.getCurrentUser().uid, "movie", ref, {
        title: item.title,
        coverUrl: item.coverUrl,
        communityRating: details.communityRating ?? null,
        doneToast: `«${item.title}» añadida y marcada como vista.`,
      });
    }

    // Serie: GATE obligatorio — sin temporadas no hay alta a medias.
    let seasonsMeta = [];
    try {
      seasonsMeta = await getTvSeasonsMeta(item.externalId);
    } catch (err) {
      seasonsMeta = [];
    }
    if (!seasonsMeta.length) {
      ui.showToast(`No se pudo marcar «${item.title}»: no se pudieron obtener sus temporadas.`);
      restoreSeenBtn(btn);
      return false;
    }

    // Confirmación si hay temporadas aún no estrenadas.
    const unreleasedSeasons = seasonsMeta.filter((s) => isUnreleasedDate(s.airDate));
    if (unreleasedSeasons.length) {
      const msg = `«${item.title}» · ${unreleasedSeasons.length} de ${seasonsMeta.length} temporadas aún no están estrenadas. ¿Marcarlas todas igualmente como vistas?`;
      if (!window.confirm(msg)) {
        restoreSeenBtn(btn);
        return false;
      }
    }

    let tvDetails = {};
    try {
      tvDetails = await getTvExtraDetails(item.externalId);
    } catch (err) {
      // no bloqueamos el alta si este paso extra falla
    }

    const draft = {
      externalId: item.externalId,
      type: "tv",
      title: item.title,
      year: item.year || "",
      coverUrl: item.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "completado",
      rating: null,
      notes: "",
    };
    Object.assign(draft, tvDetails);
    if (tvDetails.seasonAirDates && Object.keys(tvDetails.seasonAirDates).length) {
      draft.seasonAirDates = tvDetails.seasonAirDates;
    }
    // Todos los episodios de todas las temporadas, marcados hoy.
    const watched = markAllSeasonsWatched({}, seasonsMeta, todayISO());
    const progress = computeProgress(seasonsMeta, watched);
    draft.watched = watched;
    draft.nextEpisode = null;
    draft.firstWatchedAt = progress.firstWatchedAt;
    draft.lastWatchedAt = progress.lastWatchedAt;
    draft.timesCompleted = 0;
    draft.history = [];
    draft.awaitingRelease = false;
    draft.coverUrl = draft.coverUrl || item.coverUrl;

    const ref = await addItem(ctx.getCurrentUser().uid, "tv", draft);
    return await openSeenRating(ctx.getCurrentUser().uid, "tv", ref, {
      title: item.title,
      coverUrl: item.coverUrl,
      communityRating: tvDetails.communityRating ?? null,
      // Sin episodeLabel: la valoración es de la serie en su conjunto.
      doneToast: `«${item.title}» añadida y marcada como vista.`,
    });
  } catch (err) {
    restoreSeenBtn(btn);
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

/* ---------- Vista previa de resultados de búsqueda (issue #22) ---------- */

// Carga los detalles ampliados de un resultado de búsqueda para la
// vista previa. Devuelve {} si no hay nada que enriquecer o si falla
// la llamada a la API (nunca lanza).
export async function enrichSearchItem(item) {
  if (item.type === "movie") {
    try {
      return await getMovieDetails(item.externalId);
    } catch (err) {
      return {};
    }
  }
  if (item.type === "tv") {
    try {
      const details = await getTvExtraDetails(item.externalId);
      // Las temporadas se piden aparte: si fallan, se devuelven los
      // detalles sin seasonsMeta (la vista previa no se bloquea).
      try {
        details.seasonsMeta = await getTvSeasonsMeta(item.externalId);
      } catch (err) {
        // no bloqueamos la preview
      }
      return details;
    } catch (err) {
      return {};
    }
  }
  // Libro: solo sinopsis, y únicamente para fuentes Open Library
  // ("/works/...") que aún no la traigan en el resultado de búsqueda.
  if (item.externalId && item.externalId.startsWith("/works/") && !item.description) {
    try {
      return { description: await getOpenLibraryDescription(item.externalId) };
    } catch (err) {
      return {};
    }
  }
  return {};
}

// Abre la vista previa de un resultado de búsqueda. Recalcula `added`
// con el estado actual del ctx como defensa frente a cambios entre el
// render y el click (el grupo se mapea a plural porque ctx usa las
// claves "movies"/"tv"/"books").
export function openSearchPreviewFromResults(item, added, ctx) {
  const currentAdded =
    item.type === "book"
      ? isBookAlreadyAdded(item, existingIdsFor("books", ctx), existingBookKeys(ctx))
      : existingIdsFor(item.type === "movie" ? "movies" : "tv", ctx).has(item.externalId);

  ui.openSearchPreviewModal(item, {
    added: currentAdded,
    onAdd: async (item, btn) => {
      const ok = await handleAdd(item, btn, ctx);
      // closeModal es idempotente: los libros ya cerraron en doAddBook
      if (ok) ui.closeModal();
      return ok;
    },
    onEnrich: enrichSearchItem,
  });
}

/* ---------- Alta manual ---------- */

function manualExternalId() {
  return "manual-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function handleManualAdd(type, data, ctx) {
  if (!ctx.getCurrentUser()) return;
  const draft = {
    externalId: manualExternalId(),
    type,
    manual: true,
    title: data.title,
    year: data.year || "",
    coverUrl: data.coverUrl || null,
    author: data.author || null,
    pages: data.pages || null,
    status: "pendiente",
    rating: null,
    notes: "",
  };
  if (type === "movie") {
    draft.watchLog = [];
  } else if (type === "tv") {
    draft.watched = {};
    draft.nextEpisode = { season: 1, episode: 1 };
    draft.firstWatchedAt = null;
    draft.lastWatchedAt = null;
    draft.timesCompleted = 0;
    draft.history = [];
    draft.manualEpisodeCount = data.episodeCount || 10;
  } else {
    draft.progress = null;
    draft.readLog = [];
  }
  try {
    await addItem(ctx.getCurrentUser().uid, type, draft);
    ui.showToast(`«${data.title}» añadido manualmente.`);
    ui.closeModal();
  } catch (err) {
    ui.showToast("No se pudo añadir: " + err.message);
  }
}
