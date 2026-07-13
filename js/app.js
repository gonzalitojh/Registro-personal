// =============================================================
// Punto de entrada: conecta autenticación, base de datos,
// búsquedas externas e interfaz. No contiene lógica de Firebase
// ni de renderizado directamente; delega en los otros módulos.
// =============================================================

import { watchAuthState, login, logout } from "./firebase.js";
import { subscribeToItems, addItem, updateItem, deleteItem } from "./db.js";
import { searchMovies, searchTv, getTvSeasonsMeta, getSeasonEpisodes } from "./api-movies.js";
import { searchBooks } from "./api-books.js";
import { todayISO } from "./dates.js";
import {
  computeProgress,
  setEpisodeDate,
  setSeasonWatched,
  startRewatch,
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
import { AUTHORIZED_EMAIL } from "./config.js";

let currentUser = null;
let unsubscribeItems = null;
let allItems = [];
let lastMoviesResults = [];
let lastTvResults = [];
let lastBookResults = [];
const activeFilters = { movies: "todos", tv: "todos", books: "todos" };
const activeSort = { movies: "añadido", tv: "añadido", books: "añadido" };

/* ---------- Pestañas ---------- */

const tabs = document.querySelectorAll(".tab");
const panels = {
  "panel-movies": document.getElementById("panel-movies"),
  "panel-tv": document.getElementById("panel-tv"),
  "panel-books": document.getElementById("panel-books"),
};

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

watchAuthState((user) => {
  if (unsubscribeItems) {
    unsubscribeItems();
    unsubscribeItems = null;
  }

  if (!user) {
    currentUser = null;
    allItems = [];
    ui.showAuthScreen();
    return;
  }

  // Comprobación adicional en el cliente: la protección real de tus
  // datos la dan las reglas de Firestore, esto es solo para dar un
  // mensaje claro si alguien más intenta entrar.
  if (user.email !== AUTHORIZED_EMAIL) {
    ui.setAuthError("Esta aplicación es de uso personal. Entra con la cuenta autorizada.");
    logout();
    return;
  }

  currentUser = user;
  ui.showApp(user);
  unsubscribeItems = subscribeToItems(
    user.uid,
    (items) => {
      allItems = items;
      renderAllPanels();
    },
    () => ui.showToast("No se pudieron cargar tus datos.")
  );
});

/* ---------- Filtros por estado ---------- */

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

/* ---------- Orden ---------- */

document.querySelectorAll(".sort-select").forEach((select) => {
  select.addEventListener("change", () => {
    activeSort[select.dataset.scope] = select.value;
    renderLibraryFor(select.dataset.scope);
  });
});

function compareAlphabetical(a, b) {
  return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
}

function compareByYearDesc(a, b) {
  const ya = Number(a.year) || 0;
  const yb = Number(b.year) || 0;
  return yb - ya;
}

function getSortDate(item) {
  if (item.type === "movie") {
    return item.watchLog && item.watchLog.length
      ? item.watchLog[item.watchLog.length - 1]
      : null;
  }
  if (item.type === "tv") {
    return item.lastWatchedAt || null;
  }
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
  return items; // "añadido": ya viene ordenado por updatedAt desc desde Firestore
}

/* ---------- Render de las estanterías ---------- */

function itemsByGroup(group) {
  if (group === "movies") return allItems.filter((i) => i.type === "movie");
  if (group === "tv") return allItems.filter((i) => i.type === "tv");
  return allItems.filter((i) => i.type === "book");
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
  const filtered = applyFilter(itemsByGroup(group), activeFilters[group]);
  const items = applySort(filtered, activeSort[group]);
  ui.renderLibrary(document.getElementById(gridId), document.getElementById(emptyId), items, openItem);
}

function renderAllPanels() {
  renderLibraryFor("movies");
  renderLibraryFor("tv");
  renderLibraryFor("books");
  refreshSearchAddButtons();
}

/* ---------- Búsqueda: películas ---------- */

const resultsMovies = document.getElementById("search-movies-results");
document.getElementById("form-search-movies").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-movies-input").value.trim();
  if (!query) return;
  try {
    lastMoviesResults = await searchMovies(query);
    ui.renderSearchResults(resultsMovies, lastMoviesResults, existingIdsFor("movies"), handleAdd);
  } catch (err) {
    ui.showToast(err.message);
  }
});

/* ---------- Búsqueda: series ---------- */

const resultsTv = document.getElementById("search-tv-results");
document.getElementById("form-search-tv").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-tv-input").value.trim();
  if (!query) return;
  try {
    lastTvResults = await searchTv(query);
    ui.renderSearchResults(resultsTv, lastTvResults, existingIdsFor("tv"), handleAdd);
  } catch (err) {
    ui.showToast(err.message);
  }
});

/* ---------- Búsqueda: libros ---------- */

const resultsBooks = document.getElementById("search-books-results");
document.getElementById("form-search-books").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-books-input").value.trim();
  if (!query) return;
  try {
    lastBookResults = await searchBooks(query);
    ui.renderSearchResults(resultsBooks, lastBookResults, existingIdsFor("books"), handleAdd);
  } catch (err) {
    ui.showToast(err.message);
  }
});

function existingIdsFor(group) {
  return new Set(itemsByGroup(group).map((i) => i.externalId));
}

// Tras añadir o al recibir cambios en tiempo real, refrescamos los
// botones "Añadir"/"Añadido" de los resultados ya mostrados.
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
    } else if (item.type === "tv") {
      draft.watched = {};
      draft.nextEpisode = { season: 1, episode: 1 };
      draft.firstWatchedAt = null;
      draft.lastWatchedAt = null;
      draft.timesCompleted = 0;
      draft.history = [];
    } else if (item.type === "book") {
      draft.progress = null;
      draft.readLog = [];
    }
    await addItem(currentUser.uid, draft);
    ui.showToast(`«${item.title}» añadido a tu registro.`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

/* ---------- Modal de detalle ---------- */

function openItem(item) {
  if (item.type === "tv") openTvItem(item);
  else if (item.type === "movie") openMovieItem(item);
  else openBookItem(item);
}

function confirmDelete(item) {
  return async () => {
    if (!window.confirm(`¿Eliminar «${item.title}» de tu registro?`)) return;
    try {
      await deleteItem(currentUser.uid, item.id);
      ui.showToast("Eliminado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo eliminar: " + err.message);
    }
  };
}

function saveMeta(item) {
  return async (changes) => {
    try {
      await updateItem(currentUser.uid, item.id, changes);
      ui.showToast("Guardado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo guardar: " + err.message);
    }
  };
}

/* ---------- Películas ---------- */

function openMovieItem(item) {
  async function persist(newLog) {
    const status = statusFromWatchLog(newLog);
    await updateItem(currentUser.uid, item.id, { watchLog: newLog, status });
    item.watchLog = newLog;
    item.status = status;
  }

  ui.openMovieModal(item, {
    onAddWatch: (date) => persist(addWatch(item.watchLog, date)),
    onUpdateWatch: (index, date) => persist(updateWatch(item.watchLog, index, date)),
    onRemoveWatch: (index) => persist(removeWatch(item.watchLog, index)),
    onSaveMeta: saveMeta(item),
    onDelete: confirmDelete(item),
  });
}

/* ---------- Libros ---------- */

function openBookItem(item) {
  async function persist(newLog) {
    const status = statusFromReadLog(newLog);
    await updateItem(currentUser.uid, item.id, { readLog: newLog, status });
    item.readLog = newLog;
    item.status = status;
  }

  ui.openBookModal(item, {
    onStartReading: (date) => persist(startReading(item.readLog, date)),
    onFinishReading: (date) => persist(finishReading(item.readLog, date)),
    onUpdateEntry: (index, changes) => persist(updateReadEntry(item.readLog, index, changes)),
    onRemoveEntry: (index) => persist(removeReadEntry(item.readLog, index)),
    onSaveMeta: saveMeta(item),
    onDelete: confirmDelete(item),
  });
}

/* ---------- Series ---------- */

async function openTvItem(item) {
  let seasonsMeta;
  try {
    seasonsMeta = await getTvSeasonsMeta(item.externalId);
  } catch (err) {
    ui.showToast(err.message);
    return;
  }
  if (!seasonsMeta.length) {
    ui.showToast("TMDB no devuelve temporadas para esta serie todavía.");
  }

  const progress = computeProgress(seasonsMeta, item.watched);

  async function persistWatched(newWatched) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    await updateItem(currentUser.uid, item.id, {
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
    onExpandSeason: (seasonNumber) => getSeasonEpisodes(item.externalId, seasonNumber),

    onSetEpisodeDate: (seasonNumber, episodeNumber, dateOrNull) =>
      persistWatched(setEpisodeDate(item.watched, seasonNumber, episodeNumber, dateOrNull)),

    onToggleSeason: (seasonNumber, allWatched) => {
      const seasonMeta = seasonsMeta.find((s) => s.seasonNumber === seasonNumber);
      return persistWatched(
        setSeasonWatched(item.watched, seasonNumber, seasonMeta.episodeCount, allWatched, todayISO())
      );
    },

    onRewatch: async () => {
      const changes = startRewatch(item);
      await updateItem(currentUser.uid, item.id, changes);
      Object.assign(item, changes);
      ui.closeModal();
      ui.showToast("Nuevo visionado empezado. ¡A por ello!");
    },

    onSaveMeta: saveMeta(item),
    onDelete: confirmDelete(item),
  });
}

document.getElementById("modal-close").addEventListener("click", ui.closeModal);
document.getElementById("modal-backdrop").addEventListener("click", ui.closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ui.closeModal();
});
