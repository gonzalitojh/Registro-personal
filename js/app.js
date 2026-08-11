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
import { subscribeWithRetry } from "./retry.js";
import { createRenderGuard } from "./render-guard.js";
import { applySort } from "./sorting.js";
import { ALLOWED_EMAILS } from "./allowed-emails.js";
import * as ui from "./ui.js";

// Módulos extraídos
import { setupModalCloseListeners, openItem } from "./modal-handlers.js";
import { quickAction } from "./quick-actions.js";
import { checkForUpdates } from "./daily-check.js";
import { setupNotifications } from "./notifications-setup.js";
import { setupProfile } from "./profile.js";
import { setupSettings, syncThemeToSettings, cleanupSettings, SECTION_REGISTRY, isSectionVisible, isTabVisible, getFirstVisibleTabKey, getFirstVisibleTabPanel, normalizeTabKey } from "./settings.js";
import { setupGlobalSearch, refreshExternalResults } from "./global-search.js";
import { setupSidebar, renderSidebar } from "./sidebar.js";
import { initAutoHideNav } from "./auto-hide-nav.js";
import { handleNotificationsSnapshot, resetDevicePush } from "./push.js";
import { initRouter, keyForPanel, getLastOcioKey, hashForKey } from "./router.js";

// ---------- Estado ----------

let currentUser = null;
let unsubscribeItems = { movies: null, tv: null, books: null, games: null };
let unsubscribeNotifications = null;
const allItems = { movies: [], tv: [], books: [], games: [] };
let notifications = [];

const activeFilters = { movies: "todos", tv: "en_curso", books: "todos", games: "todos" };
const activeSort = { movies: "añadido", tv: "añadido", books: "añadido", games: "añadido" };
const viewMode = { movies: "grid", tv: "list", books: "grid", games: "grid" };

let moviesReady = false;
let tvReady = false;
let booksReady = false;
let gamesReady = false;
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
  games: ["library-games", "empty-games"],
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

// ---------- Guarda de re-render por snapshot (issue #191) ----------
//
// Firestore dispara un snapshot con CUALQUIER escritura en la colección
// (valoraciones, pasada diaria de metadatos, updatedAt...). Sin guarda,
// cada snapshot volcaba el innerHTML del grid/lista completo: los <img
// loading="lazy"> en vuelo se cancelaban una y otra vez y las portadas
// nunca llegaban a cargar (parpadeo incluido) hasta reiniciar la web.
// La guarda (js/render-guard.js) solo re-renderiza un grupo cuando los
// campos que se PINTAN cambiaron de verdad.
const groupChanged = createRenderGuard();

// Actualiza el grupo tras un snapshot y re-renderiza SOLO si los datos
// visibles cambiaron (issue #191). La búsqueda global también se
// refresca solo entonces: su estado «Añadir/Añadido» depende de los ids
// de la colección, que forman parte de la firma.
function syncGroup(group, items) {
  allItems[group] = items;
  if (groupChanged.changed(group, items)) {
    renderLibraryFor(group);
    refreshExternalResults(createCtx());
  }
}

function maybeTriggerDailyCheck() {
  if (moviesReady && tvReady && booksReady && gamesReady && !checksTriggered) {
    checksTriggered = true;
    checkForUpdates(createCtx());
  }
}

function stopAllSubscriptions() {
  Object.values(unsubscribeItems).forEach((fn) => fn && fn());
  unsubscribeItems = { movies: null, tv: null, books: null, games: null };
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

// ---------- Tema (modos claro / oscuro / negro puro / blanco puro) ----------

const STORAGE_KEY_THEME = "mi-registro-theme";

// Color de fondo real de cada modo para el <meta name="theme-color">:
// oscuro #171512, negro puro #000000, claro #f5f0e8, blanco puro #ffffff.
const THEME_META_COLORS = {
  dark: "#171512",
  black: "#000000",
  light: "#f5f0e8",
  white: "#ffffff",
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY_THEME, theme);
  // Update theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META_COLORS[theme] || THEME_META_COLORS.dark;
}

function getSavedTheme() {
  const saved = localStorage.getItem(STORAGE_KEY_THEME);
  // Defensivo: valores antiguos o inválidos caen al modo oscuro.
  return Object.prototype.hasOwnProperty.call(THEME_META_COLORS, saved) ? saved : "dark";
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
    "panel-games": document.getElementById("panel-games"),
  };

  function activatePanel(panelId, { moveFocus = false } = {}) {
    // Pestañas ocultas por el usuario (issue #97): si la pestaña
    // pedida no está visible (URL directa, recarga, atrás/adelante o
    // un tab oculto), cae a la primera visible de la sección y
    // normaliza la URL in-place. replaceState no dispara hashchange,
    // así que no hay bucle. (No se usa router aquí: en la carga
    // inicial el guard se ejecuta dentro de initRouter, antes de que
    // la const router esté asignada — TDZ.)
    const panelKey = keyForPanel(panelId);
    if (panelKey && !isTabVisible(panelKey)) {
      panelId = getFirstVisibleTabPanel("ocio");
      const fallbackKey = getFirstVisibleTabKey("ocio");
      if (fallbackKey) history.replaceState(null, "", hashForKey(fallbackKey));
    }

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

  // Pestañas ocultas por el usuario (issue #97): retirar de la barra
  // y de la vista. Las suscripciones y cargas de datos siguen activas
  // (las pestañas se ocultan y muestran con la clase hidden, sin
  // desmontar nada). Si la pestaña oculta era la activa, activatePanel
  // ya cae a la primera visible por su guard.
  function applyTabVisibility() {
    Object.entries(SECTION_REGISTRY.ocio.tabs).forEach(([tabKey, tab]) => {
      const tabEl = document.querySelector(`.tab[data-panel="${tab.panelId}"]`);
      if (tabEl) tabEl.classList.toggle("hidden", !isTabVisible(tabKey));
      const panelEl = panels[tab.panelId];
      if (panelEl) panelEl.classList.toggle("hidden", !isTabVisible(tabKey));
    });
  }

  // Refresco completo de la navegación tras un cambio de visibilidad
  // (issue #97): pestañas de Ocio + barra lateral/☰↔⚙ de la cabecera.
  function refreshNavigation() {
    applyTabVisibility();
    renderSidebar();
  }

  // Router (issue #59): en carga directa o recarga activa la vista
  // indicada por la URL (pestaña de Ocio o sección del perfil) sin
  // robar el foco (solo el clic manual lo mueve).
  const profileView = document.getElementById("profile-view");
  // Declarado antes de crear el router: el onRoute se ejecuta durante
  // initRouter() con la ruta de la carga inicial, y profileApi todavía
  // no existe (la sesión tampoco). El guard permite ignorarla: tras el
  // login, watchAuthState llama a router.applyRoute() para retomarla.
  let profileApi = null;
  const router = initRouter({
    onRoute: (route) => {
      if (route.section === "perfil") {
        // Ruta de perfil: abre la sección pedida (profile.js decide
        // el render y, si viene con uid, el detalle del amigo).
        if (profileApi) {
          profileApi.openProfileSection(route.profileSection, ctx, {
            fromRouter: true,
            friendUid: route.uid || null,
          });
        }
      } else if (route.section === "ocio") {
        // Ruta de Ocio: cerrar el perfil si estaba abierto y activar
        // la pestaña (lastOcioKey lo actualiza el router internamente).
        if (profileView) profileView.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        activatePanel(route.panelId);
      }
    },
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

  // Módulos especializados. profileApi (declarado antes del router
  // para su uso en onRoute) se asigna aquí.
  setupModalCloseListeners();
  // Fallback de portadas (issue #191): ante un error de carga (403/404
  // de hotlinking, red caída o carga abortada por un re-render) la
  // portada cae al placeholder «Sin imagen» en la biblioteca y los
  // modales. Listener de captura global registrado una sola vez.
  ui.setupCoverErrorFallback();
  setupNotifications(ctx);
  profileApi = setupProfile(ctx);
  // Los cambios de visibilidad de Ajustes refrescan pestañas y
  // barra lateral al momento (issue #97).
  setupSettings(ctx, { onVisibilityChange: refreshNavigation });
  setupSidebar({
    // Entrada «Ajustes»: navega a la ruta del perfil para que la URL
    // se sincronice (el router abre la sección).
    onOpenSettings: () => router.navigate({ section: "perfil", profileSection: "settings" }),
    // Entrada «Ocio»: además del scroll al top, vuelve a la última
    // pestaña de Ocio activa y sincroniza la URL con el router.
    // Si esa pestaña quedó oculta, la clave se normaliza a la
    // primera visible (issue #97).
    onGoOcio: () => router.navigate(normalizeTabKey("ocio", getLastOcioKey())),
    // Visibilidad de secciones (issue #97): con una sola sección
    // visible, la barra lateral se sustituye por el ⚙ de la cabecera.
    isSectionVisible: (id) => isSectionVisible(id),
  });
  setupGlobalSearch(ctx);
  // Reflejar las pestañas ocultas guardadas en el estado inicial
  // (el sidebar ya se re-renderizó dentro de setupSidebar).
  applyTabVisibility();
  // Ocultar cabecera y pestañas al desplazar en las listas de ocio,
  // con botón flotante "Volver arriba" (issue #137).
  initAutoHideNav();

  // Suscripciones en tiempo real
  watchAuthState(async (user) => {
    stopAllSubscriptions();
    moviesReady = false;
    tvReady = false;
    booksReady = false;
    gamesReady = false;
    checksTriggered = false;

    if (!user) {
      currentUser = null;
      allItems.movies = [];
      allItems.tv = [];
      allItems.books = [];
      allItems.games = [];
      // Limpiar las firmas de render (issue #191): el siguiente login
      // debe re-renderizar su biblioteca sin comparar contra otro usuario.
      groupChanged.reset();
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

    // Si la carga inicial pedía una ruta de perfil (#/perfil/...) sin
    // sesión, el onRoute la ignoró (profileApi no existía aún). Al
    // entrar, la retomamos para abrir la sección que se solicitó.
    if (router.getCurrentSection() === "perfil") {
      router.applyRoute();
    }

    try {
      await upsertUserProfile(user.uid, {
        email: user.email,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
      });
    } catch (err) {
      console.error("No se pudo guardar el perfil de usuario:", err);
    }

    // Suscripciones en tiempo real. Se envuelven con subscribeWithRetry
    // (issue #147): si al entrar falla una suscripción por un error
    // transitorio, se reintenta sola con backoff en lugar de dejar la
    // biblioteca vacía hasta cerrar y volver a abrir la web.
    unsubscribeItems.movies = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToItems(user.uid, "movie", onChange, onError),
      onChange: (items) => {
        syncGroup("movies", items);
        moviesReady = true;
        maybeTriggerDailyCheck();
      },
      onError: () => ui.showToast("No se pudieron cargar tus películas."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });

    unsubscribeItems.tv = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToItems(user.uid, "tv", onChange, onError),
      onChange: (items) => {
        syncGroup("tv", items);
        tvReady = true;
        maybeTriggerDailyCheck();
      },
      onError: () => ui.showToast("No se pudieron cargar tus series."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });

    unsubscribeItems.books = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToItems(user.uid, "book", onChange, onError),
      onChange: (items) => {
        syncGroup("books", items);
        booksReady = true;
        maybeTriggerDailyCheck();
      },
      onError: () => ui.showToast("No se pudieron cargar tus libros."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });

    unsubscribeItems.games = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToItems(user.uid, "game", onChange, onError),
      onChange: (items) => {
        syncGroup("games", items);
        gamesReady = true;
        maybeTriggerDailyCheck();
      },
      onError: () => ui.showToast("No se pudieron cargar tus videojuegos."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });

    // Notificaciones: mismo reintento, pero en silencio (como su onError
    // actual, que no molestaba). El badge se rellena cuando el reintento
    // tenga éxito.
    unsubscribeNotifications = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToNotifications(user.uid, onChange, onError),
      onChange: (items) => {
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
      onError: () => {},
    });
  });
}

init().catch((err) => {
  console.error("No se pudo iniciar la aplicación:", err);
});
