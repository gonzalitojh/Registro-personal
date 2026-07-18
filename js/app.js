// =============================================================
// Punto de entrada: conecta autenticación, base de datos,
// búsquedas externas e interfaz. No contiene lógica de Firebase
// ni de renderizado directamente; delega en los otros módulos.
// =============================================================

import { watchAuthState, login, logout } from "./firebase.js";
import {
  subscribeToItems,
  addItem,
  updateItem,
  deleteItem,
  upsertUserProfile,
  getUserProfile,
  getAllUserProfiles,
  getItemsOnce,
  subscribeToNotifications,
  addNotification,
  markNotificationRead,
  deleteNotification,
} from "./db.js";
import {
  searchMovies,
  searchTv,
  getTvSeasonsMeta,
  getSeasonEpisodes,
  getMovieDetails,
  getTvExtraDetails,
} from "./api-movies.js";
import { searchBooks, getOpenLibraryDescription } from "./api-books.js";
import { todayISO, formatDateEs } from "./dates.js";
import {
  computeProgress,
  setEpisodeDate,
  setEpisodeRating,
  setSeasonWatched,
  startRewatch,
  normalizeEntry,
} from "./tv-progress.js";
import { addWatch, removeWatch, updateWatch, statusFromWatchLog } from "./watch-log.js";
import {
  startReading,
  finishReading,
  removeReadEntry,
  updateReadEntry,
  statusFromReadLog,
} from "./reading-log.js";
import * as ui from "./ui.js";
import { ALLOWED_EMAILS } from "./allowed-emails.js";

let currentUser = null;
let unsubscribeItems = { movies: null, tv: null, books: null };
let unsubscribeNotifications = null;
const allItems = { movies: [], tv: [], books: [] };
let notifications = [];

let lastMoviesResults = [];
let lastTvResults = [];
let lastBookResults = [];
const searchState = {
  movies: { query: "", page: 1, hasMore: false },
  tv: { query: "", page: 1, hasMore: false },
  books: { query: "", page: 1, hasMore: false, source: null },
};

const activeFilters = { movies: "todos", tv: "en_curso", books: "todos" };
const activeSort = { movies: "añadido", tv: "añadido", books: "añadido" };
const viewMode = { movies: "grid", tv: "list", books: "grid" };
const librarySearchText = { movies: "", tv: "", books: "" };

const TYPE_BY_GROUP = { movies: "movie", tv: "tv", books: "book" };

/* ---------- Pestañas ---------- */

const tabs = document.querySelectorAll(".tab");
const panels = {
  "panel-movies": document.getElementById("panel-movies"),
  "panel-tv": document.getElementById("panel-tv"),
  "panel-books": document.getElementById("panel-books"),
};

function clearAllSearches() {
  ["movies", "tv", "books"].forEach((group) => hideResults(group));
  document.getElementById("search-movies-input").value = "";
  document.getElementById("search-tv-input").value = "";
  document.getElementById("search-books-input").value = "";
  document.querySelectorAll(".search-clear-btn").forEach((b) => b.classList.add("hidden"));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    Object.values(panels).forEach((p) => p.classList.add("hidden"));
    panels[tab.dataset.panel].classList.remove("hidden");
    clearAllSearches();
  });
});

/* ---------- Autenticación ---------- */

document.getElementById("btn-login").addEventListener("click", () => {
  ui.setAuthError(null);
  login().catch((err) => {
    if (err.code !== "auth/popup-closed-by-user") {
      ui.setAuthError("No se pudo iniciar sesión: " + err.message);
    }
  });
});

document.getElementById("btn-logout").addEventListener("click", () => logout());

let moviesReady = false;
let tvReady = false;
let booksReady = false;
let checksTriggered = false;

function maybeTriggerDailyCheck() {
  if (moviesReady && tvReady && booksReady && !checksTriggered) {
    checksTriggered = true;
    checkForUpdates();
  }
}

function stopAllSubscriptions() {
  Object.values(unsubscribeItems).forEach((fn) => fn && fn());
  unsubscribeItems = { movies: null, tv: null, books: null };
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
}

watchAuthState(async (user) => {
  stopAllSubscriptions();
  moviesReady = false;
  tvReady = false;
  booksReady = false;
  checksTriggered = false;

  if (!user) {
    currentUser = null;
    allItems.movies = [];
    allItems.tv = [];
    allItems.books = [];
    notifications = [];
    ui.showAuthScreen();
    return;
  }

  if (!ALLOWED_EMAILS.includes(user.email)) {
    ui.setAuthError("Tu correo no está en la lista de invitados. Pide que te añadan.");
    logout();
    return;
  }

  currentUser = user;
  ui.showApp(user);

  try {
    await upsertUserProfile(user.uid, {
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
    });
  } catch (err) {
    console.error("No se pudo guardar el perfil de usuario:", err);
  }

  unsubscribeItems.movies = subscribeToItems(
    user.uid,
    "movie",
    (items) => {
      allItems.movies = items;
      moviesReady = true;
      renderLibraryFor("movies");
      refreshSearchAddButtons();
      maybeTriggerDailyCheck();
    },
    () => ui.showToast("No se pudieron cargar tus películas.")
  );

  unsubscribeItems.tv = subscribeToItems(
    user.uid,
    "tv",
    (items) => {
      allItems.tv = items;
      tvReady = true;
      renderLibraryFor("tv");
      refreshSearchAddButtons();
      maybeTriggerDailyCheck();
    },
    () => ui.showToast("No se pudieron cargar tus series.")
  );

  unsubscribeItems.books = subscribeToItems(
    user.uid,
    "book",
    (items) => {
      allItems.books = items;
      booksReady = true;
      renderLibraryFor("books");
      refreshSearchAddButtons();
      maybeTriggerDailyCheck();
    },
    () => ui.showToast("No se pudieron cargar tus libros.")
  );

  unsubscribeNotifications = subscribeToNotifications(
    user.uid,
    (items) => {
      notifications = items;
      ui.renderNotifications(
        document.getElementById("notif-list"),
        document.getElementById("notif-badge"),
        document.getElementById("notif-empty"),
        notifications,
        { onDelete: (n) => deleteNotification(currentUser.uid, n.id) }
      );
    },
    () => {}
  );
});

/* ---------- Filtros, orden, búsqueda en mi lista y vista ---------- */

document.querySelectorAll(".filter-chips").forEach((group) => {
  const scope = group.dataset.scope;
  group.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      group.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      activeFilters[scope] = chip.dataset.status;
      renderLibraryFor(scope);
    });
  });
});

document.querySelectorAll(".sort-select").forEach((select) => {
  select.addEventListener("change", () => {
    activeSort[select.dataset.scope] = select.value;
    renderLibraryFor(select.dataset.scope);
  });
});

document.querySelectorAll(".library-search-input").forEach((input) => {
  const scope = input.dataset.scope;
  input.addEventListener("input", () => {
    librarySearchText[scope] = input.value.trim().toLowerCase();
    renderLibraryFor(scope);
  });
});

document.querySelectorAll(".view-toggle").forEach((toggle) => {
  const scope = toggle.dataset.scope;
  toggle.querySelectorAll(".view-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".view-toggle__btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      viewMode[scope] = btn.dataset.view;
      renderLibraryFor(scope);
    });
  });
});

function compareAlphabetical(a, b) {
  return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
}

function compareByYearDesc(a, b) {
  return (Number(b.year) || 0) - (Number(a.year) || 0);
}

function getSortDate(item) {
  if (item.type === "movie") {
    return item.watchLog && item.watchLog.length ? item.watchLog[item.watchLog.length - 1] : null;
  }
  if (item.type === "tv") return item.lastWatchedAt || null;
  if (item.type === "book") {
    const log = item.readLog || [];
    if (!log.length) return null;
    const last = log[log.length - 1];
    return last.finishedAt || last.startedAt || null;
  }
  return null;
}

function compareByDateDesc(a, b) {
  const da = getSortDate(a);
  const db = getSortDate(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}

function applySort(items, sortKey) {
  if (sortKey === "alfabetico") return [...items].sort(compareAlphabetical);
  if (sortKey === "anio") return [...items].sort(compareByYearDesc);
  if (sortKey === "fecha") return [...items].sort(compareByDateDesc);
  return items;
}

function itemsByGroup(group) {
  return allItems[group] || [];
}

function applyFilter(items, status) {
  if (status === "todos") return items;
  return items.filter((i) => i.status === status);
}

const GRID_IDS = {
  movies: ["library-movies", "empty-movies"],
  tv: ["library-tv", "empty-tv"],
  books: ["library-books", "empty-books"],
};

function renderLibraryFor(group) {
  const [gridId, emptyId] = GRID_IDS[group];
  let items = applyFilter(itemsByGroup(group), activeFilters[group]);
  if (librarySearchText[group]) {
    items = items.filter((i) => (i.title || "").toLowerCase().includes(librarySearchText[group]));
  }
  items = applySort(items, activeSort[group]);
  ui.renderLibrary(document.getElementById(gridId), document.getElementById(emptyId), items, viewMode[group], {
    onOpen: openItem,
    onQuickAction: quickAction,
  });
}

/* ---------- Búsqueda: películas ---------- */

const resultsMovies = document.getElementById("search-movies-results");

async function runMovieSearch(query, page) {
  try {
    const result = await searchMovies(query, page);
    lastMoviesResults = page === 1 ? result.items : [...lastMoviesResults, ...result.items];
    searchState.movies = { query, page, hasMore: result.hasMore };
    ui.renderSearchResults(resultsMovies, lastMoviesResults, existingIdsFor("movies"), handleAdd);
    toggleResultsToolbar("movies", result.hasMore, lastMoviesResults.length > 0);
  } catch (err) {
    ui.showToast(err.message);
  }
}

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

const resultsTv = document.getElementById("search-tv-results");

async function runTvSearch(query, page) {
  try {
    const result = await searchTv(query, page);
    lastTvResults = page === 1 ? result.items : [...lastTvResults, ...result.items];
    searchState.tv = { query, page, hasMore: result.hasMore };
    ui.renderSearchResults(resultsTv, lastTvResults, existingIdsFor("tv"), handleAdd);
    toggleResultsToolbar("tv", result.hasMore, lastTvResults.length > 0);
  } catch (err) {
    ui.showToast(err.message);
  }
}

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

const resultsBooks = document.getElementById("search-books-results");

async function runBookSearch(query, page, forceSource) {
  try {
    const result = await searchBooks(query, page, forceSource || null);
    lastBookResults = page === 1 ? result.items : [...lastBookResults, ...result.items];
    searchState.books = { query, page, hasMore: result.hasMore, source: result.source };
    ui.renderSearchResults(resultsBooks, lastBookResults, existingIdsFor("books"), handleAdd);
    toggleResultsToolbar("books", result.hasMore, lastBookResults.length > 0);
  } catch (err) {
    ui.showToast(err.message);
  }
}

document.getElementById("form-search-books").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = document.getElementById("search-books-input").value.trim();
  if (!query) return;
  runBookSearch(query, 1, null);
});

document.getElementById("btn-load-more-books").addEventListener("click", () => {
  runBookSearch(searchState.books.query, searchState.books.page + 1, searchState.books.source);
});

/* ---------- Utilidades comunes de búsqueda ---------- */

function existingIdsFor(group) {
  return new Set(itemsByGroup(group).map((i) => i.externalId));
}

function refreshSearchAddButtons() {
  if (lastMoviesResults.length) {
    ui.renderSearchResults(resultsMovies, lastMoviesResults, existingIdsFor("movies"), handleAdd);
  }
  if (lastTvResults.length) {
    ui.renderSearchResults(resultsTv, lastTvResults, existingIdsFor("tv"), handleAdd);
  }
  if (lastBookResults.length) {
    ui.renderSearchResults(resultsBooks, lastBookResults, existingIdsFor("books"), handleAdd);
  }
}

function toggleResultsToolbar(group, hasMore, hasResults) {
  document.getElementById(`results-toolbar-${group}`).classList.toggle("hidden", !hasResults);
  document.getElementById(`btn-load-more-${group}`).classList.toggle("hidden", !hasMore);
}

function hideResults(group) {
  document.getElementById(`search-${group}-results`).innerHTML = "";
  document.getElementById(`results-toolbar-${group}`).classList.add("hidden");
  if (group === "movies") lastMoviesResults = [];
  if (group === "tv") lastTvResults = [];
  if (group === "books") lastBookResults = [];
}

["movies", "tv", "books"].forEach((group) => {
  document.getElementById(`btn-hide-results-${group}`).addEventListener("click", () => hideResults(group));
});

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

/* ---------- Alta desde búsqueda ---------- */

async function handleAdd(item, btn) {
  if (!currentUser) return;
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
        if (details.releaseDate && details.releaseDate > todayISO()) draft.awaitingRelease = true;
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
        if (details.firstAirDate && details.firstAirDate > todayISO()) draft.awaitingRelease = true;
      } catch (err) {
        // ídem
      }
    } else if (item.type === "book") {
      draft.progress = null;
      draft.readLog = [];
      if (item.description) {
        draft.description = item.description;
      } else if (item.externalId && item.externalId.startsWith("/works/")) {
        try {
          draft.description = await getOpenLibraryDescription(item.externalId);
        } catch (err) {
          // ídem
        }
      }
    }

    await addItem(currentUser.uid, item.type, draft);
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

async function handleManualAdd(type, data) {
  if (!currentUser) return;
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
    await addItem(currentUser.uid, type, draft);
    ui.showToast(`«${data.title}» añadido manualmente.`);
    ui.closeModal();
  } catch (err) {
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

document.getElementById("btn-manual-movie").addEventListener("click", () => {
  ui.openManualAddModal("movie", (data) => handleManualAdd("movie", data));
});
document.getElementById("btn-manual-tv").addEventListener("click", () => {
  ui.openManualAddModal("tv", (data) => handleManualAdd("tv", data));
});
document.getElementById("btn-manual-book").addEventListener("click", () => {
  ui.openManualAddModal("book", (data) => handleManualAdd("book", data));
});

/* ---------- Acciones rápidas (modo lista y swipe) ---------- */

async function getSeasonsMetaFor(item) {
  if (item.manual) {
    return [{ seasonNumber: 1, name: "Temporada 1", episodeCount: item.manualEpisodeCount || 10 }];
  }
  return getTvSeasonsMeta(item.externalId);
}

async function quickMarkMovie(item) {
  if (item.releaseDate && item.releaseDate > todayISO()) {
    if (
      !window.confirm(
        `Según TMDB esta película se estrena el ${formatDateEs(
          item.releaseDate
        )}, todavía no ha pasado. ¿Marcarla igualmente como vista?`
      )
    ) {
      return;
    }
  }
  const newLog = addWatch(item.watchLog, todayISO());
  const status = statusFromWatchLog(newLog);
  await updateItem(currentUser.uid, "movie", item.id, { watchLog: newLog, status });
  ui.showToast(`«${item.title}» marcada como vista.`);
}

async function quickMarkBook(item) {
  const isReading = item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;
  const newLog = isReading ? finishReading(item.readLog, todayISO()) : startReading(item.readLog, todayISO());
  const status = statusFromReadLog(newLog);
  await updateItem(currentUser.uid, "book", item.id, { readLog: newLog, status });
  ui.showToast(isReading ? `«${item.title}» terminado.` : `Has empezado «${item.title}».`);
}

async function quickMarkTv(item) {
  if (item.status === "standby" || item.status === "abandonado") {
    ui.showToast("Está en pausa/abandonada. Ábrela para retomarla.");
    return;
  }
  if (!item.nextEpisode) {
    ui.showToast("Esta serie ya está completa.");
    return;
  }
  const { season, episode } = item.nextEpisode;
  if (
    item.nextEpisodeToAir &&
    item.nextEpisodeToAir.season === season &&
    item.nextEpisodeToAir.episode === episode &&
    item.nextEpisodeToAir.airDate &&
    item.nextEpisodeToAir.airDate > todayISO()
  ) {
    if (
      !window.confirm(
        `Según TMDB este episodio se estrena el ${formatDateEs(
          item.nextEpisodeToAir.airDate
        )}. ¿Marcarlo igualmente como visto?`
      )
    ) {
      return;
    }
  }
  const seasonsMeta = await getSeasonsMetaFor(item);
  const newWatched = setEpisodeDate(item.watched, season, episode, todayISO());
  const newProgress = computeProgress(seasonsMeta, newWatched);
  await updateItem(currentUser.uid, "tv", item.id, {
    watched: newWatched,
    status: newProgress.status,
    nextEpisode: newProgress.nextEpisode,
    firstWatchedAt: newProgress.firstWatchedAt,
    lastWatchedAt: newProgress.lastWatchedAt,
  });
  ui.showToast(`T${season}E${episode} marcado como visto.`);
}

async function quickAction(item, btn) {
  if (btn) btn.disabled = true;
  try {
    if (item.type === "movie") await quickMarkMovie(item);
    else if (item.type === "tv") await quickMarkTv(item);
    else await quickMarkBook(item);
  } catch (err) {
    ui.showToast("No se pudo actualizar: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- Modal de detalle ---------- */

function openItem(item) {
  if (item.type === "tv") openTvItem(item);
  else if (item.type === "movie") openMovieItem(item);
  else openBookItem(item);
}

function confirmDelete(item, kind) {
  return async () => {
    if (!window.confirm(`¿Eliminar «${item.title}» de tu registro?`)) return;
    try {
      await deleteItem(currentUser.uid, kind, item.id);
      ui.showToast("Eliminado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo eliminar: " + err.message);
    }
  };
}

function saveMeta(item, kind) {
  return async (changes) => {
    try {
      await updateItem(currentUser.uid, kind, item.id, changes);
      ui.showToast("Guardado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo guardar: " + err.message);
    }
  };
}

function editHandlerFor(item, kind, reopen) {
  return () => {
    ui.openEditModal(item, {
      onSave: async (changes) => {
        try {
          await updateItem(currentUser.uid, kind, item.id, changes);
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

function openMovieItem(item) {
  const reopen = () => openMovieItem(item);
  async function persist(newLog) {
    const status = statusFromWatchLog(newLog);
    await updateItem(currentUser.uid, "movie", item.id, { watchLog: newLog, status });
    item.watchLog = newLog;
    item.status = status;
  }

  ui.openMovieModal(item, {
    onAddWatch: (date) => persist(addWatch(item.watchLog, date)),
    onUpdateWatch: (index, date) => persist(updateWatch(item.watchLog, index, date)),
    onRemoveWatch: (index) => persist(removeWatch(item.watchLog, index)),
    onSaveMeta: saveMeta(item, "movie"),
    onDelete: confirmDelete(item, "movie"),
    onEdit: editHandlerFor(item, "movie", reopen),
  });
}

function openBookItem(item) {
  const reopen = () => openBookItem(item);
  async function persist(newLog) {
    const status = statusFromReadLog(newLog);
    await updateItem(currentUser.uid, "book", item.id, { readLog: newLog, status });
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
      await updateItem(currentUser.uid, "book", item.id, { status });
      item.status = status;
    },
    onSaveMeta: saveMeta(item, "book"),
    onDelete: confirmDelete(item, "book"),
    onEdit: editHandlerFor(item, "book", reopen),
  });
}

function progressWithStatus(seasonsMeta, item) {
  const base = computeProgress(seasonsMeta, item.watched);
  if (item.status === "standby" || item.status === "abandonado") {
    return { ...base, status: item.status };
  }
  return base;
}

async function openTvItem(item) {
  let seasonsMeta;
  try {
    seasonsMeta = await getSeasonsMetaFor(item);
  } catch (err) {
    ui.showToast(err.message);
    return;
  }
  if (!seasonsMeta.length) {
    ui.showToast("TMDB no devuelve temporadas para esta serie todavía.");
  }

  const progress = progressWithStatus(seasonsMeta, item);
  const reopen = () => openTvItem(item);

  async function persistWatched(newWatched) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    await updateItem(currentUser.uid, "tv", item.id, {
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
        : getSeasonEpisodes(item.externalId, seasonNumber),

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
      await updateItem(currentUser.uid, "tv", item.id, changes);
      Object.assign(item, changes);
      ui.closeModal();
      ui.showToast("Nuevo visionado empezado. ¡A por ello!");
    },

    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || computeProgress(seasonsMeta, item.watched).status;
      await updateItem(currentUser.uid, "tv", item.id, { status });
      item.status = status;
      return progressWithStatus(seasonsMeta, item);
    },

    onSaveMeta: saveMeta(item, "tv"),
    onDelete: confirmDelete(item, "tv"),
    onEdit: editHandlerFor(item, "tv", reopen),
  });
}

document.getElementById("modal-close").addEventListener("click", ui.closeModal);
document.getElementById("modal-backdrop").addEventListener("click", ui.closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ui.closeModal();
});

/* ---------- Comprobación diaria: estrenos y metadatos que faltan ---------- */

async function checkForUpdates() {
  if (!currentUser) return;
  let profile;
  try {
    profile = await getUserProfile(currentUser.uid);
  } catch (err) {
    profile = null;
  }
  const today = todayISO();
  if (profile && profile.lastReleaseCheckAt === today) return;

  // Películas: aviso de estreno + rellenar ficha si le faltaba algo
  // (sinopsis, género, reparto, director, duración o fecha de estreno).
  for (const movie of allItems.movies) {
    if (movie.manual) continue;
    const needsCheck = !movie.overview || movie.awaitingRelease;
    if (!needsCheck) continue;
    try {
      const fresh = await getMovieDetails(movie.externalId);
      const updates = {};
      if (!movie.overview && fresh.overview) updates.overview = fresh.overview;
      if ((!movie.genres || !movie.genres.length) && fresh.genres && fresh.genres.length) {
        updates.genres = fresh.genres;
      }
      if ((!movie.cast || !movie.cast.length) && fresh.cast && fresh.cast.length) {
        updates.cast = fresh.cast;
      }
      if (!movie.director && fresh.director) updates.director = fresh.director;
      if (!movie.runtime && fresh.runtime) updates.runtime = fresh.runtime;
      if (fresh.releaseDate && fresh.releaseDate !== movie.releaseDate) {
        updates.releaseDate = fresh.releaseDate;
      }

      if (movie.awaitingRelease && fresh.releaseDate && fresh.releaseDate <= today) {
        await addNotification(currentUser.uid, {
          message: `«${movie.title}» ya se ha estrenado (${formatDateEs(fresh.releaseDate)}).`,
        });
        updates.awaitingRelease = false;
      }

      if (Object.keys(updates).length) {
        await updateItem(currentUser.uid, "movie", movie.id, updates);
      }
    } catch (err) {
      console.error("No se pudo comprobar/actualizar", movie.title, err);
    }
  }

  // Series: aviso de estreno / episodio nuevo + rellenar ficha si faltaba algo.
  const activeShows = allItems.tv.filter((s) => !s.manual && s.status !== "abandonado");
  for (const show of activeShows) {
    try {
      const needsBackfill = !show.overview || show.awaitingRelease;
      const fresh = await getTvExtraDetails(show.externalId);
      const updates = {};
      let justPremiered = false;

      if (show.awaitingRelease && fresh.firstAirDate && fresh.firstAirDate <= today) {
        await addNotification(currentUser.uid, { message: `«${show.title}» ya se ha estrenado.` });
        updates.awaitingRelease = false;
        justPremiered = true;
      }

      if (
        !justPremiered &&
        fresh.nextEpisodeToAir &&
        fresh.nextEpisodeToAir.airDate &&
        fresh.nextEpisodeToAir.airDate <= today
      ) {
        const key = `${fresh.nextEpisodeToAir.season}x${fresh.nextEpisodeToAir.episode}`;
        if (show.lastNotifiedEpisode !== key) {
          await addNotification(currentUser.uid, {
            message: `Nuevo episodio disponible de «${show.title}»: T${fresh.nextEpisodeToAir.season}E${fresh.nextEpisodeToAir.episode}.`,
          });
          updates.lastNotifiedEpisode = key;
        }
      }
      if (fresh.nextEpisodeToAir) updates.nextEpisodeToAir = fresh.nextEpisodeToAir;

      if (needsBackfill) {
        if (fresh.overview) updates.overview = fresh.overview;
        if ((!show.genres || !show.genres.length) && fresh.genres && fresh.genres.length) {
          updates.genres = fresh.genres;
        }
        if ((!show.cast || !show.cast.length) && fresh.cast && fresh.cast.length) {
          updates.cast = fresh.cast;
        }
        if ((!show.creators || !show.creators.length) && fresh.creators && fresh.creators.length) {
          updates.creators = fresh.creators;
        }
        if (!show.episodeRuntime && fresh.episodeRuntime) updates.episodeRuntime = fresh.episodeRuntime;
      }

      if (Object.keys(updates).length) {
        await updateItem(currentUser.uid, "tv", show.id, updates);
      }
    } catch (err) {
      console.error("No se pudo comprobar/actualizar", show.title, err);
    }
  }

  // Libros: si a alguno le faltaba la sinopsis (por ejemplo, porque se
  // añadió antes de que la app la recogiera), se intenta rellenar.
  for (const book of allItems.books) {
    if (book.manual || book.description) continue;
    if (!book.externalId || !book.externalId.startsWith("/works/")) continue;
    try {
      const description = await getOpenLibraryDescription(book.externalId);
      if (description) {
        await updateItem(currentUser.uid, "book", book.id, { description });
      }
    } catch (err) {
      console.error("No se pudo completar la sinopsis de", book.title, err);
    }
  }

  try {
    await upsertUserProfile(currentUser.uid, { lastReleaseCheckAt: today });
  } catch (err) {
    console.error(err);
  }
}

const notifWrap = document.querySelector(".notif-wrap");
const notifDropdown = document.getElementById("notif-dropdown");

document.getElementById("btn-notifications").addEventListener("click", () => {
  notifDropdown.classList.toggle("hidden");
  if (!notifDropdown.classList.contains("hidden")) {
    notifications.filter((n) => !n.read).forEach((n) => markNotificationRead(currentUser.uid, n.id));
  }
});

document.addEventListener("click", (e) => {
  if (notifWrap && !notifWrap.contains(e.target)) {
    notifDropdown.classList.add("hidden");
  }
});

document.getElementById("btn-clear-notifs").addEventListener("click", async () => {
  for (const n of notifications) {
    await deleteNotification(currentUser.uid, n.id);
  }
});

/* ---------- Perfil, estadísticas y amigos ---------- */

const profileSubtabs = document.querySelectorAll(".profile-subtab");
const statsSection = document.getElementById("profile-section-stats");
const friendsSection = document.getElementById("profile-section-friends");
const friendsListEl = document.getElementById("friends-list");
const friendDetailEl = document.getElementById("friend-detail");
const friendDetailNameEl = document.getElementById("friend-detail-name");
const statsPeriodWrap = document.querySelector(".stats-period");
const statsPeriodSelect = document.getElementById("stats-period-select");
const statsRangeFields = document.getElementById("stats-range-fields");
const statsRangeStart = document.getElementById("stats-range-start");
const statsRangeEnd = document.getElementById("stats-range-end");

function getCurrentStatsFilter() {
  if (statsPeriodSelect.value === "custom") {
    return {
      type: "custom",
      start: statsRangeStart.value || null,
      end: statsRangeEnd.value || null,
    };
  }
  return { type: statsPeriodSelect.value };
}

document.getElementById("btn-open-profile").addEventListener("click", () => {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.remove("hidden");
  profileSubtabs.forEach((b) => b.classList.remove("is-active"));
  document.querySelector('.profile-subtab[data-section="stats"]').classList.add("is-active");
  statsSection.classList.remove("hidden");
  friendsSection.classList.add("hidden");
  statsPeriodWrap.classList.remove("hidden");
  // Esperamos a que el navegador termine de mostrar el contenedor antes de
  // crear los gráficos: si Chart.js dibuja mientras el <canvas> aún está
  // oculto (display:none), calcula un tamaño de 0 y queda en blanco hasta
  // que algo lo vuelve a dibujar. Con dos vueltas de rAF nos aseguramos de
  // que ya hay un layout real cuando llamamos a renderStats.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderStats(getCurrentStatsFilter());
    });
  });
});

document.getElementById("btn-close-profile").addEventListener("click", () => {
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
});

statsPeriodSelect.addEventListener("change", () => {
  const isCustom = statsPeriodSelect.value === "custom";
  statsRangeFields.classList.toggle("hidden", !isCustom);
  if (!isCustom) renderStats(getCurrentStatsFilter());
  else if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter());
});

statsRangeStart.addEventListener("change", () => {
  if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter());
});
statsRangeEnd.addEventListener("change", () => {
  if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter());
});

profileSubtabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    profileSubtabs.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const section = btn.dataset.section;
    statsSection.classList.toggle("hidden", section !== "stats");
    friendsSection.classList.toggle("hidden", section !== "friends");
    statsPeriodWrap.classList.toggle("hidden", section !== "stats");
    if (section === "friends") {
      friendDetailEl.classList.add("hidden");
      friendsListEl.classList.remove("hidden");
      loadFriendsList();
    }
  });
});

async function loadFriendsList() {
  friendsListEl.innerHTML = `<p class="empty-state">Cargando…</p>`;
  try {
    const profiles = await getAllUserProfiles();
    ui.renderFriendsList(friendsListEl, profiles, currentUser.uid, openFriend);
  } catch (err) {
    friendsListEl.innerHTML = `<p class="empty-state">No se pudo cargar la lista de amigos.</p>`;
  }
}

async function openFriend(profile) {
  friendsListEl.classList.add("hidden");
  friendDetailEl.classList.remove("hidden");
  friendDetailNameEl.textContent = profile.displayName || profile.email || "Amigo";
  const friendName = profile.displayName || profile.email || "tu amigo";
  document.getElementById("friend-movies").innerHTML = `<p class="empty-state">Cargando…</p>`;
  document.getElementById("friend-series").innerHTML = "";
  document.getElementById("friend-books").innerHTML = "";
  try {
    const [movies, series, books] = await Promise.all([
      getItemsOnce(profile.uid, "movie"),
      getItemsOnce(profile.uid, "tv"),
      getItemsOnce(profile.uid, "book"),
    ]);
    ui.renderFriendDetail(movies, series, books, (item) => ui.openReadOnlyModal(item, friendName));
  } catch (err) {
    document.getElementById("friend-movies").innerHTML = `<p class="empty-state">No se pudo cargar.</p>`;
  }
}

document.getElementById("btn-back-to-friends").addEventListener("click", () => {
  friendDetailEl.classList.add("hidden");
  friendsListEl.classList.remove("hidden");
});

function withinPeriod(dateStr, filter) {
  if (!dateStr) return false;
  if (filter.type === "all") return true;
  if (filter.type === "custom") {
    if (filter.start && dateStr < filter.start) return false;
    if (filter.end && dateStr > filter.end) return false;
    return true;
  }
  const now = new Date();
  const d = new Date(dateStr);
  if (filter.type === "year") return d.getFullYear() === now.getFullYear();
  if (filter.type === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

const STATUS_LABELS_NEUTRAL = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
  standby: "En pausa",
  abandonado: "Abandonado",
};

function computeStats(filter) {
  const monthly = {};
  let moviesWatched = 0;
  allItems.movies.forEach((m) => {
    (m.watchLog || []).forEach((date) => {
      if (withinPeriod(date, filter)) {
        moviesWatched++;
        const key = date.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  let episodesWatched = 0;
  let seriesCompleted = 0;
  allItems.tv.forEach((s) => {
    Object.values(s.watched || {}).forEach((seasonMap) => {
      // Cada episodio es { date, rating } (o, en datos antiguos, solo
      // una fecha en texto plano) — normalizeEntry cubre ambos casos.
      Object.values(seasonMap).forEach((raw) => {
        const entry = normalizeEntry(raw);
        if (!entry || !entry.date) return;
        if (withinPeriod(entry.date, filter)) {
          episodesWatched++;
          const key = entry.date.slice(0, 7);
          monthly[key] = (monthly[key] || 0) + 1;
        }
      });
    });
    if (s.status === "completado" && withinPeriod(s.lastWatchedAt, filter)) seriesCompleted++;
  });

  let booksRead = 0;
  allItems.books.forEach((b) => {
    (b.readLog || []).forEach((entry) => {
      if (entry.finishedAt && withinPeriod(entry.finishedAt, filter)) {
        booksRead++;
        const key = entry.finishedAt.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  const statusCounts = {};
  [...allItems.movies, ...allItems.tv, ...allItems.books].forEach((i) => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  return { moviesWatched, episodesWatched, seriesCompleted, booksRead, monthly, statusCounts };
}

let activityChart = null;
let statusChart = null;

function renderStats(filter) {
  const stats = computeStats(filter);
  const summaryEl = document.getElementById("stats-summary");
  summaryEl.innerHTML = `
    <div class="stat-tile"><span class="stat-tile__value">${stats.moviesWatched}</span><span class="stat-tile__label">Películas vistas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.episodesWatched}</span><span class="stat-tile__label">Episodios vistos</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.seriesCompleted}</span><span class="stat-tile__label">Series completadas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.booksRead}</span><span class="stat-tile__label">Libros leídos</span></div>
  `;

  if (typeof Chart === "undefined") return;

  const months = Object.keys(stats.monthly).sort();
  const activityCtx = document.getElementById("chart-activity");
  if (activityChart) activityChart.destroy();
  activityChart = new Chart(activityCtx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [{ label: "Actividad", data: months.map((m) => stats.monthly[m]), backgroundColor: "#2b6459" }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const statusLabelsPresent = Object.keys(stats.statusCounts).filter((k) => stats.statusCounts[k] > 0);
  const statusCtx = document.getElementById("chart-status");
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: statusLabelsPresent.map((k) => STATUS_LABELS_NEUTRAL[k] || k),
      datasets: [
        {
          data: statusLabelsPresent.map((k) => stats.statusCounts[k]),
          backgroundColor: ["#948a76", "#2b6459", "#b9822e", "#8f6522", "#a63b2e"],
        },
      ],
    },
    options: { responsive: true },
  });
}
