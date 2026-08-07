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

import { addItem } from "./db.js";
import { getMovieDetails, getTvExtraDetails, getTvSeasonsMeta, searchMovies as apiSearchMovies, searchTv as apiSearchTv } from "./api-movies.js";
import { searchBooks as apiSearchBooks, getOpenLibraryDescription } from "./api-books.js";
import { isUnreleasedDate } from "./release.js";
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
