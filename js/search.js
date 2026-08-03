// =============================================================
// Búsqueda de películas, series y libros + alta desde resultados
// + alta manual. Extraído de app.js para desacoplar toda la lógica
// de búsqueda de la orquestación general.
// =============================================================

import { addItem } from "./db.js";
import { getMovieDetails, getTvExtraDetails, searchMovies as apiSearchMovies, searchTv as apiSearchTv } from "./api-movies.js";
import { searchBooks as apiSearchBooks, getOpenLibraryDescription } from "./api-books.js";
import { isUnreleasedDate } from "./release.js";
import * as ui from "./ui.js";

// Estado interno del módulo
let lastMoviesResults = [];
let lastTvResults = [];
let lastBookResults = [];
const searchState = {
  movies: { query: "", page: 1, hasMore: false },
  tv: { query: "", page: 1, hasMore: false },
  books: { query: "", page: 1, hasMore: false, source: null },
};

function existingIdsFor(group, ctx) {
  return new Set(ctx.getItemsByGroup(group).map((i) => i.externalId));
}

// Para libros: detecta si ya están añadidos por externalId O por
// título+autor (cruce entre fuentes: un libro añadido vía Open
// Library con ID "/works/..." se detecta también en resultados de
// Google Books y viceversa).
function existingBookKeys(ctx) {
  const books = ctx.getItemsByGroup("books");
  const keys = new Set();
  for (const b of books) {
    const key = `${(b.title || "").trim().toLowerCase()}|${(b.author || "").trim().toLowerCase()}`;
    keys.add(key);
  }
  return keys;
}

function isBookAlreadyAdded(item, idsSet, keysSet) {
  if (idsSet.has(item.externalId)) return true;
  const key = `${(item.title || "").trim().toLowerCase()}|${(item.author || "").trim().toLowerCase()}`;
  return keysSet.has(key);
}

function toggleResultsToolbar(group, hasMore, hasResults) {
  document.getElementById(`results-toolbar-${group}`).classList.toggle("hidden", !hasResults);
  document.getElementById(`btn-load-more-${group}`).classList.toggle("hidden", !hasMore);
}

export function hideResults(group) {
  document.getElementById(`search-${group}-results`).innerHTML = "";
  document.getElementById(`results-toolbar-${group}`).classList.add("hidden");
  if (group === "movies") lastMoviesResults = [];
  if (group === "tv") lastTvResults = [];
  if (group === "books") lastBookResults = [];
}

export function clearAllSearches() {
  ["movies", "tv", "books"].forEach((group) => hideResults(group));
  document.getElementById("search-movies-input").value = "";
  document.getElementById("search-tv-input").value = "";
  document.getElementById("search-books-input").value = "";
  document.querySelectorAll(".search-clear-btn").forEach((b) => b.classList.add("hidden"));
}

export function refreshSearchAddButtons(ctx) {
  const resultsMovies = document.getElementById("search-movies-results");
  const resultsTv = document.getElementById("search-tv-results");
  const resultsBooks = document.getElementById("search-books-results");
  if (lastMoviesResults.length) {
    ui.renderSearchResults(resultsMovies, lastMoviesResults, existingIdsFor("movies", ctx), (item, btn) => handleAdd(item, btn, ctx));
  }
  if (lastTvResults.length) {
    ui.renderSearchResults(resultsTv, lastTvResults, existingIdsFor("tv", ctx), (item, btn) => handleAdd(item, btn, ctx));
  }
  if (lastBookResults.length) {
    const ids = existingIdsFor("books", ctx);
    const keys = existingBookKeys(ctx);
    const bookCheck = (item) => isBookAlreadyAdded(item, ids, keys);
    ui.renderSearchResults(resultsBooks, lastBookResults, ids, (item, btn) => handleAdd(item, btn, ctx), bookCheck);
  }
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
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

async function handleAdd(item, btn, ctx) {
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
    await doAddBook(item, btn, ctx, {
      coverUrl: item.coverUrl,
      description: item.description || "",
    });
    return;
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
        if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) draft.awaitingRelease = true;
      } catch (err) {
        // ídem
      }
    }

    await addItem(ctx.getCurrentUser().uid, item.type, draft);
    ui.showToast(`«${item.title}» añadido a tu registro.`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

/* ---------- Alta manual ---------- */

function manualExternalId() {
  return "manual-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function handleManualAdd(type, data, ctx) {
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

export function setupSearch(ctx) {
  const resultsMovies = document.getElementById("search-movies-results");
  const resultsTv = document.getElementById("search-tv-results");
  const resultsBooks = document.getElementById("search-books-results");
  const booksSpanishOnly = document.getElementById("books-spanish-only");

  const onAdd = (item, btn) => handleAdd(item, btn, ctx);

  async function runMovieSearch(query, page) {
    try {
      const result = await apiSearchMovies(query, page);
      lastMoviesResults = page === 1 ? result.items : [...lastMoviesResults, ...result.items];
      searchState.movies = { query, page, hasMore: result.hasMore };
      ui.renderSearchResults(resultsMovies, lastMoviesResults, existingIdsFor("movies", ctx), onAdd);
      toggleResultsToolbar("movies", result.hasMore, lastMoviesResults.length > 0);
    } catch (err) {
      ui.showToast(err.message);
    }
  }

  async function runTvSearch(query, page) {
    try {
      const result = await apiSearchTv(query, page);
      lastTvResults = page === 1 ? result.items : [...lastTvResults, ...result.items];
      searchState.tv = { query, page, hasMore: result.hasMore };
      ui.renderSearchResults(resultsTv, lastTvResults, existingIdsFor("tv", ctx), onAdd);
      toggleResultsToolbar("tv", result.hasMore, lastTvResults.length > 0);
    } catch (err) {
      ui.showToast(err.message);
    }
  }

  async function runBookSearch(query, page, forceSource) {
    try {
      const result = await apiSearchBooks(query, page, forceSource || null, booksSpanishOnly.checked);
      lastBookResults = page === 1 ? result.items : [...lastBookResults, ...result.items];
      searchState.books = { query, page, hasMore: result.hasMore, source: result.source };
      const ids = existingIdsFor("books", ctx);
      const keys = existingBookKeys(ctx);
      const bookCheck = (item) => isBookAlreadyAdded(item, ids, keys);
      ui.renderSearchResults(resultsBooks, lastBookResults, ids, onAdd, bookCheck);
      toggleResultsToolbar("books", result.hasMore, lastBookResults.length > 0);
    } catch (err) {
      ui.showToast(err.message);
    }
  }

  /* ---------- Búsqueda: películas ---------- */
  document.getElementById("form-search-movies").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = document.getElementById("search-movies-input").value.trim();
    if (!query) return;
    runMovieSearch(query, 1);
  });

  document.getElementById("btn-load-more-movies").addEventListener("click", () => {
    runMovieSearch(searchState.movies.query, searchState.movies.page + 1);
  });

  /* ---------- Búsqueda: series ---------- */
  document.getElementById("form-search-tv").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = document.getElementById("search-tv-input").value.trim();
    if (!query) return;
    runTvSearch(query, 1);
  });

  document.getElementById("btn-load-more-tv").addEventListener("click", () => {
    runTvSearch(searchState.tv.query, searchState.tv.page + 1);
  });

  /* ---------- Búsqueda: libros ---------- */
  document.getElementById("form-search-books").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = document.getElementById("search-books-input").value.trim();
    if (!query) return;
    runBookSearch(query, 1, null);
  });

  booksSpanishOnly.addEventListener("change", () => {
    if (searchState.books.query) runBookSearch(searchState.books.query, 1, null);
  });

  document.getElementById("btn-load-more-books").addEventListener("click", () => {
    runBookSearch(searchState.books.query, searchState.books.page + 1, searchState.books.source);
  });

  /* ---------- Ocultar resultados ---------- */
  ["movies", "tv", "books"].forEach((group) => {
    document.getElementById(`btn-hide-results-${group}`).addEventListener("click", () => hideResults(group));
  });

  /* ---------- Botón de borrar búsqueda (X) ---------- */
  document.querySelectorAll(".search-clear-btn").forEach((btn) => {
    const scope = btn.dataset.scope;
    const input = document.getElementById(`search-${scope}-input`);
    input.addEventListener("input", () => {
      btn.classList.toggle("hidden", !input.value);
    });
    btn.addEventListener("click", () => {
      input.value = "";
      btn.classList.add("hidden");
      input.focus();
    });
  });

  /* ---------- Alta manual ---------- */
  document.getElementById("btn-manual-movie").addEventListener("click", () => {
    ui.openManualAddModal("movie", (data) => handleManualAdd("movie", data, ctx));
  });
  document.getElementById("btn-manual-tv").addEventListener("click", () => {
    ui.openManualAddModal("tv", (data) => handleManualAdd("tv", data, ctx));
  });
  document.getElementById("btn-manual-book").addEventListener("click", () => {
    ui.openManualAddModal("book", (data) => handleManualAdd("book", data, ctx));
  });
}
