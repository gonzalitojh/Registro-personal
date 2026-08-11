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
import { applySort } from "./sorting.js";
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

// Flags de snapshot recibido por grupo (lazy loading, issue #178):
// ya no condicionan la comprobación diaria (lee de Firestore con
// getItemsOnce), solo el repintado cuando un partial llega tarde.
const groupReady = { movies: false, tv: false, books: false, games: false };
let checksTriggered = false;

// ---------- Contexto para módulos ----------

function createCtx() {
  return {
    getCurrentUser: () => currentUser,
    getItemsByGroup: (group) => allItems[group] || [],
    // Lectura de un grupo que nunca falla por lazy loading (issue
    // #178): si el estado en memoria está completo (snapshot recibido)
    // se devuelve tal cual; si no (pestaña aún no visitada), se lee
    // puntualmente de Firestore. Lo usan los checks de duplicados
    // (alta desde la búsqueda global, recomendaciones del modal).
    getGroupItemsResolved: async (group) => {
      if (groupReady[group]) return allItems[group] || [];
      if (currentUser && GROUP_CONFIG[group]) {
        try {
          return await getItemsOnce(currentUser.uid, GROUP_CONFIG[group].type);
        } catch {
          // fallback: si la lectura puntual falla, se usa lo que haya
          // en memoria (puede estar vacío: es un chequeo best-effort).
        }
      }
      return allItems[group] || [];
    },
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
  const gridEl = document.getElementById(gridId);
  // El partial del grupo aún no se ha cargado (lazy, issue #178):
  // no hay nada que pintar; al terminar la carga, loadOcioPartial
  // vuelve a llamar aquí si el grupo ya tiene snapshot.
  if (!gridEl) return;
  // Los datos (o el estado vacío) sustituyen al marcador de carga
  // del panel. Se usa querySelector: el panel solo puede tener un
  // .panel-loading (el que antepone loadOcioPartial al inyectar).
  const panelEl = gridEl.closest(".panel");
  panelEl?.querySelector(".panel-loading")?.remove();
  let items = applyFilter(itemsByGroup(group), activeFilters[group]);
  items = applySort(items, activeSort[group]);
  const ctx = createCtx();
  ui.renderLibrary(gridEl, document.getElementById(emptyId), items, viewMode[group], {
    onOpen: (item) => openItem(item, ctx),
    onQuickAction: (item, btn) => quickAction(item, btn, ctx),
  });
}

function maybeTriggerDailyCheck() {
  if (checksTriggered) return;
  checksTriggered = true;
  // Fire-and-forget con catch defensivo: daily-check lee de
  // Firestore (getItemsOnce) y un fallo no debe romper el flujo.
  checkForUpdates(createCtx()).catch((err) => {
    console.error("No se pudo completar la comprobación diaria:", err);
  });
}

function stopAllSubscriptions() {
  Object.values(unsubscribeItems).forEach((fn) => fn && fn());
  unsubscribeItems = { movies: null, tv: null, books: null, games: null };
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
}

// ---------- Suscripciones a Firestore (lazy, issue #178) ----------

// Config por grupo: tipo en Firestore y mensaje de error del toast.
const GROUP_CONFIG = {
  movies: { type: "movie", error: "No se pudieron cargar tus películas." },
  tv: { type: "tv", error: "No se pudieron cargar tus series." },
  books: { type: "book", error: "No se pudieron cargar tus libros." },
  games: { type: "game", error: "No se pudieron cargar tus videojuegos." },
};

// Suscripción genérica de un grupo. Se envuelve con subscribeWithRetry
// (issue #147): si al entrar falla una suscripción por un error
// transitorio, se reintenta sola con backoff en lugar de dejar la
// biblioteca vacía hasta cerrar y volver a abrir la web.
function subscribeGroup(uid, groupKey) {
  const cfg = GROUP_CONFIG[groupKey];
  if (!cfg || unsubscribeItems[groupKey]) return;
  unsubscribeItems[groupKey] = subscribeWithRetry({
    subscribe: ({ onChange, onError }) =>
      subscribeToItems(uid, cfg.type, onChange, onError),
    onChange: (items) => {
      allItems[groupKey] = items;
      groupReady[groupKey] = true;
      renderLibraryFor(groupKey);
      refreshExternalResults(createCtx());
    },
    onError: () => ui.showToast(cfg.error),
    onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
  });
}

// Arranca la suscripción del grupo si no está ya activa (requiere
// sesión). La comprobación diaria ya no depende de esto: daily-check
// lee de Firestore con getItemsOnce.
function ensureGroupSubscribed(groupKey) {
  if (!currentUser || unsubscribeItems[groupKey]) return;
  subscribeGroup(currentUser.uid, groupKey);
}

// ---------- Carga de parciales (lazy, issue #178) ----------

// Grupo de datos asociado a cada panel de Ocio (la suscripción de
// cada grupo solo arranca cuando se activa su pestaña por primera vez).
const PANEL_TO_GROUP = {
  "panel-tv": "tv",
  "panel-movies": "movies",
  "panel-books": "books",
  "panel-games": "games",
};

// Partial ya inyectado por panel: cada pestaña carga su HTML solo la
// primera vez que se activa; las siguientes activaciones no re-fetch.
const loadedPartials = new Set();

// Marcador de carga de un panel (issue #178). Se antepone al
// contenido de cada partial al inyectarlo, de modo que el indicador
// persiste mientras el snapshot del grupo no llega; renderLibraryFor
// lo retira al pintar datos (o el estado vacío).
function panelLoadingHtml() {
  return `
    <div class="panel-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>Cargando…</span>
    </div>`;
}

// Wiring de los controles de un panel (filtros, orden y vista).
// Se ejecuta al inyectar cada partial (el guard de loadedPartials
// garantiza que cada panel se wirea una sola vez). Reemplaza al
// querySelectorAll global del arranque: antes solo cubría los
// partials ya inyectados y no servía para el lazy loading.
function wirePanelControls(panelEl) {
  const filters = panelEl.querySelector(".filter-chips");
  if (filters) {
    const scope = filters.dataset.scope;
    filters.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filters.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilters[scope] = chip.dataset.status;
        renderLibraryFor(scope);
      });
    });
  }

  const sortSelect = panelEl.querySelector(".sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      activeSort[sortSelect.dataset.scope] = sortSelect.value;
      renderLibraryFor(sortSelect.dataset.scope);
    });
  }

  const viewToggle = panelEl.querySelector(".view-toggle");
  if (viewToggle) {
    const scope = viewToggle.dataset.scope;
    viewToggle.querySelectorAll(".view-toggle__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewToggle.querySelectorAll(".view-toggle__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        viewMode[scope] = btn.dataset.view;
        renderLibraryFor(scope);
      });
    });
  }
}

// Carga bajo demanda del partial de un panel (ocio/*.html). No hace
// nada si el panel ya se cargó. Tras inyectar el HTML, wirea sus
// controles y, si el grupo ya tiene snapshot (llegó antes que el
// HTML), pinta la biblioteca de inmediato; si no, renderLibraryFor
// lo hará cuando llegue el snapshot (o el loading queda visible).
async function loadOcioPartial(panelEl) {
  if (!panelEl || loadedPartials.has(panelEl.id)) return;
  loadedPartials.add(panelEl.id);
  const src = panelEl.dataset.ocioSrc;
  try {
    const res = await fetch(src + "?v=" + APP_VERSION);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    panelEl.innerHTML = panelLoadingHtml() + html;
    wirePanelControls(panelEl);
    const group = panelEl.dataset.typeGroup;
    if (group && groupReady[group]) renderLibraryFor(group);
  } catch (err) {
    // Se retira del set de cargados para reintentar en la siguiente
    // activación (p. ej. tras arreglar el origen del fallo).
    loadedPartials.delete(panelEl.id);
    panelEl.innerHTML = `<p class="empty-state">No se pudo cargar esta sección (${src}). Comprueba que estás sirviendo la web desde un servidor (no abriendo el archivo directamente) y recarga la página.</p>`;
    console.error("No se pudo cargar", src, err);
  }
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
  // Panel de Ocio actualmente activo (lo usa watchAuthState tras el
  // login para saber qué pestaña debe cargar partial y suscripción).
  let activePanelId = null;

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
    activePanelId = targetId;

    // Lazy loading (issue #178): el partial del panel solo se carga
    // la primera vez que se activa, y la suscripción de su grupo solo
    // arranca si hay sesión (tras el login, watchAuthState se
    // encarga del grupo de la pestaña activa si esta activación fue
    // previa a la sesión).
    const activeGroup = PANEL_TO_GROUP[targetId];
    if (activeGroup) {
      loadOcioPartial(panels[targetId]);
      if (currentUser) ensureGroupSubscribed(activeGroup);
    }

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
      // El panel visible lo controla en exclusiva activatePanel: aquí
      // solo se AÑADE hidden a las pestañas ocultas, nunca se quita
      // (un toggle con false destapaba todos los paneles visibles a
      // la vez; issue #178).
      const panelEl = panels[tab.panelId];
      if (panelEl && !isTabVisible(tabKey)) panelEl.classList.add("hidden");
    });
    // Si la pestaña activa quedó oculta, caer a la primera visible
    // (el mismo guard de activatePanel, issue #97): sin esto el área
    // de contenido quedaría en blanco al ocultar la pestaña activa.
    if (activePanelId && !isTabVisible(keyForPanel(activePanelId))) {
      activatePanel(getFirstVisibleTabPanel("ocio") || "panel-tv");
    }
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
        activatePanel(route.panelId);
        // Sin sesión, #app permanece oculta (pantalla de acceso): no
        // destapar la interfaz ni sus controles. Al entrar, ui.showApp
        // la muestra (issue #178).
        if (currentUser) document.getElementById("app").classList.remove("hidden");
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

  // Módulos especializados. profileApi (declarado antes del router
  // para su uso en onRoute) se asigna aquí. El wiring de los
  // controles de cada panel (filtros, orden, vista) ya no se hace
  // aquí: lo ejecuta wirePanelControls al inyectar cada partial
  // (lazy loading, issue #178).
  setupModalCloseListeners();
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
    groupReady.movies = false;
    groupReady.tv = false;
    groupReady.books = false;
    groupReady.games = false;
    checksTriggered = false;

    if (!user) {
      currentUser = null;
      allItems.movies = [];
      allItems.tv = [];
      allItems.books = [];
      allItems.games = [];
      notifications = [];
      cleanupSettings();
      resetDevicePush();
      // Restaurar el indicador de carga en los paneles con partial ya
      // inyectado (issue #178): renderLibraryFor lo retiró al pintar
      // los datos; al cerrar sesión y volver a entrar, las
      // suscripciones arrancan de nuevo y el «Cargando…» debe
      // reaparecer hasta el primer snapshot.
      Object.values(panels).forEach((p) => {
        if (p && loadedPartials.has(p.id) && !p.querySelector(".panel-loading")) {
          p.insertAdjacentHTML("afterbegin", panelLoadingHtml());
        }
      });
      ui.showAuthScreen();
      return;
    }

    // Acceso controlado SOLO por las reglas de Firestore (issue #195):
    // la lista de correos autorizados vive únicamente en isAllowedUser()
    // de firestore.rules (js/allowed-emails.js se eliminó: duplicaba la
    // lista y se desincronizaba). Para saber si este usuario puede entrar,
    // preguntamos a Firestore por su propio perfil: si las reglas lo
    // rechazan (permission-denied), se le avisa y se le cierra la sesión.
    // Cualquier otro error (p. ej. sin conexión) no bloquea la entrada:
    // las suscripciones ya reintentan solas (issue #147).
    try {
      await getUserProfile(user.uid);
    } catch (err) {
      if (err?.code === "permission-denied") {
        ui.setAuthError("Tu correo no está en la lista de invitados. Pide que te añadan.");
        logout();
        return;
      }
      console.error("No se pudo comprobar el acceso del usuario:", err);
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

    // Suscripciones en tiempo real, lazy por pestaña (issue #178):
    // solo arranca la del grupo de la pestaña activa de Ocio; las
    // demás se suscriben al activar su pestaña (activatePanel →
    // ensureGroupSubscribed). Cada suscripción se envuelve con
    // subscribeWithRetry (issue #147): si al entrar falla por un
    // error transitorio, se reintenta sola con backoff en lugar de
    // dejar la biblioteca vacía hasta cerrar y volver a abrir la web.
    // El partial de la pestaña activa también se asegura aquí (la
    // activación pudo ocurrir sin sesión o con ruta ajena al router).
    const panelId = activePanelId && panels[activePanelId] ? activePanelId : (getFirstVisibleTabPanel("ocio") || "panel-tv");
    loadOcioPartial(panels[panelId]);
    ensureGroupSubscribed(PANEL_TO_GROUP[panelId] || "tv");

    // Comprobación diaria: una vez por sesión. Ya no espera a que
    // lleguen las suscripciones de los cuatro grupos (daily-check
    // lee de Firestore bajo demanda con getItemsOnce).
    maybeTriggerDailyCheck();

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
