// =============================================================
// Punto de entrada: orquesta autenticación, suscripciones a
// Firestore, filtros/orden y wiring de los módulos especializados.
// La lógica de negocio (búsqueda, modales, acciones rápidas,
// comprobación diaria, perfil/estadísticas, notificaciones) vive
// en módulos propios que se conectan aquí mediante un objeto de
// contexto (ctx) con funciones de acceso.
// =============================================================

import { watchAuthState, login, logout } from "./firebase.js";
import {
  subscribeToItems,
  updateItem,
  deleteItem,
  addItem,
  upsertUserProfile,
  getUserProfile,
  getAllUserProfiles,
  getItemsOnce,
  subscribeToNotifications,
  addNotification,
  deleteNotification,
  markNotificationRead,
} from "./db.js";
import { getTvSeasonsMeta, getSeasonEpisodes, getMovieDetails, getTvExtraDetails } from "./api-movies.js";
import { getOpenLibraryDescription } from "./api-books.js";
import { todayISO, formatDateEs } from "./dates.js";
import { APP_VERSION } from "./config.js";
import { applySort } from "./sorting.js";
import { ALLOWED_EMAILS } from "./allowed-emails.js";
import * as ui from "./ui.js";

// Módulos extraídos
import { setupModalCloseListeners, openItem } from "./modal-handlers.js";
import { quickAction } from "./quick-actions.js";
import { checkForUpdates } from "./daily-check.js";
import { setupNotifications } from "./notifications-setup.js";
import { setupProfile } from "./profile.js";
import { setupSettings, syncThemeToSettings, cleanupSettings } from "./settings.js";
import { setupGlobalSearch, refreshExternalResults } from "./global-search.js";
import { setupSidebar } from "./sidebar.js";
import { handleNotificationsSnapshot, resetDevicePush } from "./push.js";
import { initRouter, keyForPanel, DEFAULT_KEY } from "./router.js";

// ---------- Estado ----------

let currentUser = null;
let unsubscribeItems = { movies: null, tv: null, books: null };
let unsubscribeNotifications = null;
const allItems = { movies: [], tv: [], books: [] };
let notifications = [];

const activeFilters = { movies: "todos", tv: "en_curso", books: "todos" };
const activeSort = { movies: "añadido", tv: "añadido", books: "añadido" };
const viewMode = { movies: "grid", tv: "list", books: "grid" };

let moviesReady = false;
let tvReady = false;
let booksReady = false;
let checksTriggered = false;

// ---------- Contexto para módulos ----------

function createCtx() {
  return {
    getCurrentUser: () => currentUser,
    getItemsByGroup: (group) => allItems[group] || [],
    getAllItems: () => allItems,
    getNotifications: () => notifications,
    updateItem,
    deleteItem,
    addItem,
    addNotification,
    markNotificationRead,
    deleteNotification,
    upsertUserProfile,
    getUserProfile,
    getAllUserProfiles,
    getItemsOnce,
    getMovieDetails,
    getTvExtraDetails,
    getTvSeasonsMeta,
    getSeasonEpisodes,
    getOpenLibraryDescription,
    todayISO,
    formatDateEs,
    setTheme,
    showToast: ui.showToast,
  };
}

// ---------- Helpers ----------

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
  items = applySort(items, activeSort[group]);
  const ctx = createCtx();
  ui.renderLibrary(document.getElementById(gridId), document.getElementById(emptyId), items, viewMode[group], {
    onOpen: (item) => openItem(item, ctx),
    onQuickAction: (item, btn) => quickAction(item, btn, ctx),
  });
}

function maybeTriggerDailyCheck() {
  if (moviesReady && tvReady && booksReady && !checksTriggered) {
    checksTriggered = true;
    checkForUpdates(createCtx());
  }
}

function stopAllSubscriptions() {
  Object.values(unsubscribeItems).forEach((fn) => fn && fn());
  unsubscribeItems = { movies: null, tv: null, books: null };
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
}

// ---------- Carga de parciales ----------

async function loadOcioPartials() {
  const sections = document.querySelectorAll("[data-ocio-src]");
  await Promise.all(
    Array.from(sections).map(async (section) => {
      try {
        const res = await fetch(section.dataset.ocioSrc + "?v=" + APP_VERSION);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        section.innerHTML = await res.text();
      } catch (err) {
        section.innerHTML = `<p class="empty-state">No se pudo cargar esta sección (${section.dataset.ocioSrc}). Comprueba que estás sirviendo la web desde un servidor (no abriendo el archivo directamente) y recarga la página.</p>`;
        console.error("No se pudo cargar", section.dataset.ocioSrc, err);
      }
    })
  );
}

// ---------- Tema (modo claro / oscuro) ----------

const STORAGE_KEY_THEME = "mi-registro-theme";

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY_THEME, theme);
  // Update theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f5f0e8" : "#171512";
}

function getSavedTheme() {
  return localStorage.getItem(STORAGE_KEY_THEME) || "dark";
}

// ---------- Inicialización ----------

async function init() {
  // Restaurar preferencia de tema antes de pintar nada
  setTheme(getSavedTheme());
  syncThemeToSettings(getSavedTheme());

  await loadOcioPartials();

  const ctx = createCtx();

  // Pestañas de Ocio y enrutamiento (issue #59): cada pestaña tiene
  // su propia URL (#/ocio/series, #/ocio/peliculas, #/ocio/libros)
  // gestionada por el router de hash. El clic manual replica el
  // comportamiento clásico (activar pestaña, mover foco al título)
  // y además sincroniza la URL; las activaciones que vienen del
  // router (carga directa, recarga, atrás/adelante) nunca roban
  // el foco.
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    "panel-movies": document.getElementById("panel-movies"),
    "panel-tv": document.getElementById("panel-tv"),
    "panel-books": document.getElementById("panel-books"),
  };

  function activatePanel(panelId, { moveFocus = false } = {}) {
    tabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    Object.values(panels).forEach((p) => p && p.classList.add("hidden"));

    // Defensivo: si el panel no existe (un data-panel desactualizado),
    // se cae al estado por defecto (Series) en lugar de romper.
    const targetId = panels[panelId] ? panelId : "panel-tv";
    const activeTab = Array.from(tabs).find((t) => t.dataset.panel === targetId);
    if (activeTab) {
      activeTab.classList.add("is-active");
      activeTab.setAttribute("aria-selected", "true");
    }
    panels[targetId].classList.remove("hidden");

    if (moveFocus) {
      // Mover foco al título de la sección activa (solo por clic manual).
      const heading = panels[targetId].querySelector("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }
  }

  // Router: en carga directa o recarga activa la pestaña indicada
  // por la URL sin robar el foco (solo el clic manual lo mueve).
  const router = initRouter({
    onRoute: ({ panelId }) => activatePanel(panelId),
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const panelId = tab.dataset.panel;
      activatePanel(panelId, { moveFocus: true });
      router.navigate(keyForPanel(panelId));
    });
  });

  // Autenticación
  document.getElementById("btn-login").addEventListener("click", () => {
    ui.setAuthError(null);
    login().catch((err) => {
      if (err.code !== "auth/popup-closed-by-user") {
        ui.setAuthError("No se pudo iniciar sesión: " + err.message);
      }
    });
  });

  // Filtros, orden, búsqueda en lista, vista
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

  // Módulos especializados
  setupModalCloseListeners();
  setupNotifications(ctx);
  const profileApi = setupProfile(ctx);
  setupSettings(ctx);
  setupSidebar({
    onOpenSettings: () => profileApi.openProfileSection("settings", ctx),
    // Entrada «Ocio»: además del scroll al top, vuelve a la primera
    // pestaña (Series) y sincroniza la URL con el router.
    onGoOcio: () => router.navigate(DEFAULT_KEY),
  });
  setupGlobalSearch(ctx);

  // Suscripciones en tiempo real
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
      cleanupSettings();
      resetDevicePush();
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
        refreshExternalResults(createCtx());
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
        refreshExternalResults(createCtx());
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
        refreshExternalResults(createCtx());
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
        // Reenviar al SO las notificaciones nuevas cuando la app está
        // en segundo plano (campana → notificación del sistema).
        handleNotificationsSnapshot(notifications);
      },
      () => {}
    );
  });
}

init().catch((err) => {
  console.error("No se pudo iniciar la aplicación:", err);
});
