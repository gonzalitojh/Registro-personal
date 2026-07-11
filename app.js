// =============================================================
// Punto de entrada: conecta autenticación, base de datos,
// búsquedas externas e interfaz. No contiene lógica de Firebase
// ni de renderizado directamente; delega en los otros módulos.
// =============================================================

import { watchAuthState, login, logout } from "./firebase.js";
import { subscribeToItems, addItem, updateItem, deleteItem } from "./db.js";
import { searchMoviesAndShows } from "./api-movies.js";
import { searchBooks } from "./api-books.js";
import * as ui from "./ui.js";
import { AUTHORIZED_EMAIL } from "./config.js";

let currentUser = null;
let unsubscribeItems = null;
let allItems = [];
let lastMediaResults = [];
let lastBookResults = [];
const activeFilters = { media: "todos", books: "todos" };

/* ---------- Pestañas ---------- */

const tabs = document.querySelectorAll(".tab");
const panels = {
  "panel-media": document.getElementById("panel-media"),
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
      if (scope === "media") renderMediaLibrary();
      else renderBooksLibrary();
    });
  });
});

/* ---------- Render de las estanterías ---------- */

function itemsByGroup(group) {
  return allItems.filter((i) =>
    group === "media" ? i.type === "movie" || i.type === "tv" : i.type === "book"
  );
}

function applyFilter(items, status) {
  if (status === "todos") return items;
  return items.filter((i) => i.status === status);
}

function renderMediaLibrary() {
  const items = applyFilter(itemsByGroup("media"), activeFilters.media);
  ui.renderLibrary(
    document.getElementById("library-media"),
    document.getElementById("empty-media"),
    items,
    openItem
  );
}

function renderBooksLibrary() {
  const items = applyFilter(itemsByGroup("books"), activeFilters.books);
  ui.renderLibrary(
    document.getElementById("library-books"),
    document.getElementById("empty-books"),
    items,
    openItem
  );
}

function renderAllPanels() {
  renderMediaLibrary();
  renderBooksLibrary();
  refreshSearchAddButtons();
}

/* ---------- Búsqueda: pelis y series ---------- */

const resultsMedia = document.getElementById("search-media-results");
document.getElementById("form-search-media").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-media-input").value.trim();
  if (!query) return;
  try {
    lastMediaResults = await searchMoviesAndShows(query);
    ui.renderSearchResults(resultsMedia, lastMediaResults, existingIdsFor("media"), handleAdd);
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
  if (lastMediaResults.length) {
    ui.renderSearchResults(resultsMedia, lastMediaResults, existingIdsFor("media"), handleAdd);
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
    await addItem(currentUser.uid, {
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
      progress: null,
    });
    ui.showToast(`«${item.title}» añadido a tu registro.`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
  }
}

/* ---------- Modal de detalle ---------- */

function openItem(item) {
  ui.openModal(item, {
    onSave: async (changes) => {
      try {
        await updateItem(currentUser.uid, item.id, changes);
        ui.showToast("Guardado.");
        ui.closeModal();
      } catch (err) {
        ui.showToast("No se pudo guardar: " + err.message);
      }
    },
    onDelete: async () => {
      if (!window.confirm(`¿Eliminar «${item.title}» de tu registro?`)) return;
      try {
        await deleteItem(currentUser.uid, item.id);
        ui.showToast("Eliminado.");
        ui.closeModal();
      } catch (err) {
        ui.showToast("No se pudo eliminar: " + err.message);
      }
    },
  });
}

document.getElementById("modal-close").addEventListener("click", ui.closeModal);
document.getElementById("modal-backdrop").addEventListener("click", ui.closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ui.closeModal();
});
