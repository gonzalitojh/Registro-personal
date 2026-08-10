// =============================================================
// Ajustes (Settings). Maneja la UI de configuración y la
// persistencia de preferencias en localStorage + Firestore.
// =============================================================

import { syncNow, isSyncRunning } from "./daily-check.js";
import { isNotificationSupported, getPermission, requestDevicePushPermission } from "./push.js";

const STORAGE_KEY = "mi-registro-settings";
const DEBOUNCE_MS = 2000;

const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications: {
    movie_release: true,
    new_episode: true,
    series_premiere: true,
    friend_activity: true,
    device_push: false,
  },
  visibleSections: { ocio: true },
  visibleTabs: { series: true, peliculas: true, libros: true },
};

// Registro central de secciones y pestañas de la web (issue #97).
// El orden de las claves es el orden de la barra lateral y el de la
// «primera visible» de cada sección. Añadir una sección futura solo
// requiere añadir una entrada aquí: { id: { label, tabs } }, con
// cada pestaña { label, panelId } (panelId = id del panel en
// index.html). El resto del módulo (helpers, guardas y render de la
// card de Ajustes) se adapta solo.
export const SECTION_REGISTRY = {
  ocio: {
    label: "Ocio",
    tabs: {
      series: { label: "Series", panelId: "panel-tv" },
      peliculas: { label: "Películas", panelId: "panel-movies" },
      libros: { label: "Libros", panelId: "panel-books" },
    },
  },
};

// ---- Load / Save (localStorage) ----

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides || {})) {
    if (overrides[key] !== null && typeof overrides[key] === "object" && !Array.isArray(overrides[key])) {
      result[key] = deepMerge(defaults[key] || {}, overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

// Sanitiza las invariantes de visibilidad de secciones/pestañas
// (issue #97) tras leer localStorage o el fallback sin guardar:
//   (a) si ninguna sección quedó visible, se activan todas;
//   (b) si una sección se quedó sin pestañas visibles, se activan todas
//       sus pestañas;
//   (c) las claves que no estén en el registro se ignoran (tolerante
//       ante ajustes antiguos o de secciones futuras ya retiradas).
function sanitizeVisibility(settings) {
  const validSectionIds = Object.keys(SECTION_REGISTRY);
  const validTabKeys = Object.values(SECTION_REGISTRY).flatMap((s) => Object.keys(s.tabs));

  const sections = {};
  const tabs = {};
  validSectionIds.forEach((id) => {
    sections[id] = settings.visibleSections[id] !== false;
  });
  validTabKeys.forEach((key) => {
    tabs[key] = settings.visibleTabs[key] !== false;
  });
  settings.visibleSections = sections;
  settings.visibleTabs = tabs;

  if (!validSectionIds.some((id) => sections[id])) {
    validSectionIds.forEach((id) => {
      sections[id] = true;
    });
  }

  Object.values(SECTION_REGISTRY).forEach((section) => {
    const keys = Object.keys(section.tabs);
    if (keys.length > 0 && !keys.some((k) => tabs[k])) {
      keys.forEach((k) => {
        tabs[k] = true;
      });
    }
  });

  return settings;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeVisibility(deepMerge(DEFAULT_SETTINGS, parsed));
    }
  } catch (e) {
    console.warn("No se pudieron leer los ajustes:", e);
  }
  return sanitizeVisibility({
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications },
    visibleSections: { ...DEFAULT_SETTINGS.visibleSections },
    visibleTabs: { ...DEFAULT_SETTINGS.visibleTabs },
  });
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("No se pudieron guardar los ajustes:", e);
  }
}

// ---- Sync to Firestore (debounced) ----

let debounceTimer = null;

function scheduleFirestoreSync(ctx) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const user = ctx.getCurrentUser();
      if (user) {
        const settings = loadSettings();
        await ctx.upsertUserProfile(user.uid, {
          preferences: {
            notifications: settings.notifications,
            visibleSections: settings.visibleSections,
            visibleTabs: settings.visibleTabs,
          },
        });
      }
    } catch (e) {
      console.warn("No se pudieron sincronizar ajustes con Firestore:", e);
    }
  }, DEBOUNCE_MS);
}

/** Limpia el temporizador pendiente (útil al cerrar sesión). */
export function cleanupSettings() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

// ---- UI Rendering ----

// Valores válidos para el select de tema (Ajustes → Apariencia).
const VALID_THEMES = ["dark", "black", "light", "white"];

export function renderSettings(ctx) {
  const settings = loadSettings();

  const themeSelect = document.getElementById("settings-theme-select");
  if (themeSelect) {
    // Defensivo: un valor antiguo o inválido cae al modo oscuro.
    themeSelect.value = VALID_THEMES.includes(settings.theme) ? settings.theme : "dark";
  }

  // Mientras haya una sincronización en curso, el botón de sincronizar
  // permanece deshabilitado (también lo cubre el flag durante el clic).
  const syncBtn = document.getElementById("btn-sync-now");
  if (syncBtn) syncBtn.disabled = isSyncRunning();

  const checkboxMap = {
    "notif-movie-release": "movie_release",
    "notif-new-episode": "new_episode",
    "notif-series-premiere": "series_premiere",
    "notif-friend-activity": "friend_activity",
    "notif-device": "device_push",
  };

  Object.entries(checkboxMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings.notifications[key] !== false;
  });

  // El toggle de notificaciones en el dispositivo requiere soporte de
  // la API y un permiso no denegado; si el permiso está denegado se
  // muestra desmarcado y deshabilitado (la preferencia guardada se
  // conserva: si el usuario re-permite en el navegador, el toggle
  // vuelve a aparecer marcado al abrir Ajustes).
  const devEl = document.getElementById("notif-device");
  if (devEl) {
    const permission = isNotificationSupported() ? getPermission() : "denied";
    if (permission === "denied") {
      devEl.checked = false;
    }
    devEl.disabled = permission === "denied";
  }

  // Card «Secciones y pestañas»: render dinámico desde el registro.
  renderSectionsCard(settings);
}

// ---- Card «Secciones y pestañas» (issue #97) ----

// Render de la card desde el registro: una fila por sección (con sus
// pestañas anidadas en un .settings-group). Los ids son literales
// controlados por este módulo (sin datos de usuario).
function renderSectionsCard(settings) {
  const container = document.getElementById("sections-visibility-list");
  if (container) container.innerHTML = buildSectionsHTML(settings);
}

function buildSectionsHTML(settings) {
  const visibleSectionIds = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false);
  // Si solo queda una sección visible, su switch se deshabilita: se
  // mantiene siempre al menos una sección a la vista.
  const onlyOneSection = visibleSectionIds.length <= 1;

  return Object.entries(SECTION_REGISTRY)
    .map(([sectionId, section]) => {
      const sectionVisible = settings.visibleSections[sectionId] !== false;
      const sectionLocked = onlyOneSection && sectionVisible;

      const sectionRow = `
        <div class="settings-row">
          <label class="settings-row__text" for="section-visible-${sectionId}">
            ${section.label}
            ${sectionLocked ? `<p class="settings-row__hint">No puedes ocultar la última sección visible.</p>` : ""}
          </label>
          <label class="switch" aria-hidden="true">
            <input type="checkbox" id="section-visible-${sectionId}" class="switch__input"
                   data-vis-section="${sectionId}" ${sectionVisible ? "checked" : ""}
                   ${sectionLocked ? "disabled" : ""} />
            <span class="switch__slider"></span>
          </label>
        </div>`;

      const visibleTabKeys = Object.keys(section.tabs).filter((k) => settings.visibleTabs[k] !== false);
      const tabsGroup = Object.entries(section.tabs)
        .map(([tabKey, tab]) => {
          const tabVisible = settings.visibleTabs[tabKey] !== false;
          // La última pestaña visible de la sección no se puede
          // ocultar: se mantiene siempre al menos una a la vista.
          const tabLocked = tabVisible && visibleTabKeys.length <= 1;
          const hint = tabLocked ? `No puedes ocultar la última pestaña visible de ${section.label}.` : "";
          return `
          <div class="settings-row">
            <label class="settings-row__text" for="tab-visible-${sectionId}-${tabKey}">
              ${tab.label}
              ${hint ? `<p class="settings-row__hint">${hint}</p>` : ""}
            </label>
            <label class="switch" aria-hidden="true">
              <input type="checkbox" id="tab-visible-${sectionId}-${tabKey}" class="switch__input"
                     data-vis-tab="${tabKey}" ${tabVisible ? "checked" : ""}
                     ${tabLocked ? "disabled" : ""} />
              <span class="switch__slider"></span>
            </label>
          </div>`;
        })
        .join("");

      return `${sectionRow}
        <div class="settings-group">${tabsGroup}
        </div>`;
    })
    .join("\n");
}

// ---- Event Wiring ----

// Botón "Sincronizar ahora": lanza syncNow (daily-check.js) con
// cooldown de 30 minutos y feedback vía toast. Restaura el botón
// en finally para que nunca quede bloqueado si algo falla.
function wireSyncButton(ctx) {
  const btn = document.getElementById("btn-sync-now");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Sincronizando…";
    try {
      const result = await syncNow(ctx);
      if (result.ok) {
        ctx.showToast("Datos sincronizados con las APIs.");
      } else if (result.reason === "cooldown") {
        ctx.showToast("Sincronización reciente, inténtalo en un rato.");
      } else if (result.reason === "running") {
        ctx.showToast("Ya hay una sincronización en curso.");
      } else {
        ctx.showToast("No se pudo sincronizar: " + (result.message || "error desconocido."));
      }
    } catch (err) {
      ctx.showToast("No se pudo sincronizar: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

function wireThemeSelect(ctx) {
  const select = document.getElementById("settings-theme-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const s = loadSettings();
    s.theme = select.value;
    saveSettings(s);

    if (ctx.setTheme) {
      ctx.setTheme(s.theme);
    }

    scheduleFirestoreSync(ctx);
  });
}

function wireNotificationToggles(ctx) {
  const map = {
    "notif-movie-release": "movie_release",
    "notif-new-episode": "new_episode",
    "notif-series-premiere": "series_premiere",
    "notif-friend-activity": "friend_activity",
  };

  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const s = loadSettings();
      s.notifications[key] = el.checked;
      saveSettings(s);
      scheduleFirestoreSync(ctx);
    });
  });

  // Toggle de notificaciones en el dispositivo: wiring propio (fuera
  // del bucle genérico) porque al activarlo hay que pedir primero el
  // permiso al navegador. La primera instrucción del handler es el
  // requestPermission: así el gesto del usuario cuenta como
  // "user gesture" para la API.
  const devEl = document.getElementById("notif-device");
  if (devEl) {
    devEl.addEventListener("change", async () => {
      if (devEl.checked) {
        const result = await requestDevicePushPermission();
        if (result !== "granted") {
          devEl.checked = false;
          ctx.showToast(result === "denied" ? "Permiso denegado. Actívalo en los ajustes del navegador." : "No se pudo activar: permiso no concedido.");
          return;
        }
      }
      const s = loadSettings();
      s.notifications.device_push = devEl.checked;
      saveSettings(s);
      scheduleFirestoreSync(ctx);
    });
  }
}

// ---- Public API ----

// Callback de módulo inyectado por app.js vía
// setupSettings({ onVisibilityChange }): se invoca tras guardar un
// cambio de visibilidad para que la navegación se refresque
// (applyTabVisibility + renderSidebar).
let onVisibilityChange = null;

export function setupSettings(ctx, { onVisibilityChange: onChange = null } = {}) {
  onVisibilityChange = onChange;
  wireThemeSelect(ctx);
  wireNotificationToggles(ctx);
  wireSyncButton(ctx);
  wireVisibilityToggles(ctx);
}

// Toggles de visibilidad de la card «Secciones y pestañas» (issue
// #97). La delegación de `change` vive en el contenedor (los checks
// se re-renderizan tras cada cambio; el listener se registra UNA vez,
// aquí, porque el contenedor nunca se reconstruye).
function wireVisibilityToggles(ctx) {
  const list = document.getElementById("sections-visibility-list");
  if (!list) return;

  list.addEventListener("change", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.dataset.visSection && !input.dataset.visTab) return;

    const settings = loadSettings();
    const componentKey = input.dataset.visSection || input.dataset.visTab;

    if (input.dataset.visSection) {
      settings.visibleSections[componentKey] = input.checked;
      // Defensa en profundidad: nunca puede quedar 0 secciones visibles.
      const visibleCount = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false).length;
      if (visibleCount === 0) {
        input.checked = true;
        return;
      }
    } else {
      settings.visibleTabs[componentKey] = input.checked;
      // Defensa en profundidad: nunca puede quedar 0 pestañas visibles
      // en la sección afectada.
      const sectionId = Object.keys(SECTION_REGISTRY).find((id) => SECTION_REGISTRY[id].tabs[componentKey]);
      if (sectionId) {
        const visibleTabs = Object.keys(SECTION_REGISTRY[sectionId].tabs).filter((k) => settings.visibleTabs[k] !== false);
        if (visibleTabs.length === 0) {
          input.checked = true;
          return;
        }
      }
    }

    saveSettings(settings);
    scheduleFirestoreSync(ctx);
    // Refrescar guardas y avisos: tras el cambio puede quedar otra
    // fila como última visible (y quedar deshabilitada).
    renderSectionsCard(loadSettings());
    if (onVisibilityChange) onVisibilityChange();
  });
}

/**
 * Sincroniza el tema en la clave de localStorage de ajustes
 * cuando se cambia desde el toggle del header, para mantener
 * ambas claves consistentes.
 */
export function syncThemeToSettings(theme) {
  const s = loadSettings();
  s.theme = theme;
  saveSettings(s);
}

/**
 * Devuelve las preferencias de notificación actuales (síncrono,
 * desde localStorage). Lo usa daily-check.js para saber qué
 * notificaciones crear.
 */
export function getNotificationPrefs() {
  const settings = loadSettings();
  return settings.notifications || {};
}

// ---- Visibilidad de secciones y pestañas (issue #97) ----
// Los helpers leen loadSettings() fresco en cada llamada (nunca
// mutan) para que reflejen siempre el estado guardado. Los usa
// sidebar.js (vía inyección), app.js y profile.js.

// ¿Está visible la sección? También devuelve false si el id no
// existe en el registro (sección futura retirada).
export function isSectionVisible(sectionId) {
  if (!SECTION_REGISTRY[sectionId]) return false;
  return loadSettings().visibleSections[sectionId] !== false;
}

// Ids de las secciones visibles, en el orden del registro (el orden
// de la barra lateral y de la «primera visible»).
export function getVisibleSectionIds() {
  return Object.keys(SECTION_REGISTRY).filter((id) => loadSettings().visibleSections[id] !== false);
}

// Número entero de secciones visibles (lo usa sidebar.js para
// decidir entre barra lateral ☰ y botón de Ajustes).
export function countVisibleSections() {
  return getVisibleSectionIds().length;
}

// ¿Está visible la pestaña (clave global, p. ej. "series")?
export function isTabVisible(tabKey) {
  return loadSettings().visibleTabs[tabKey] !== false;
}

// Primera clave visible de las pestañas de una sección, según el
// registro; null si ninguna.
export function getFirstVisibleTabKey(sectionId) {
  const section = SECTION_REGISTRY[sectionId];
  if (!section) return null;
  const settings = loadSettings();
  const key = Object.keys(section.tabs).find((k) => settings.visibleTabs[k] !== false);
  return key || null;
}

// panelId de la primera clave visible de la sección (o null).
export function getFirstVisibleTabPanel(sectionId) {
  const key = getFirstVisibleTabKey(sectionId);
  const section = SECTION_REGISTRY[sectionId];
  return key && section ? section.tabs[key].panelId : null;
}

// Normaliza una clave de pestaña: la devuelve si es conocida y
// visible; si no, la primera visible de la sección. Lo usan los
// flujos que navegan a una pestaña (entrada «Ocio», volver del
// perfil) para que nunca aterricen en una oculta.
export function normalizeTabKey(sectionId, key) {
  const section = SECTION_REGISTRY[sectionId];
  const settings = loadSettings();
  if (section && section.tabs[key] && settings.visibleTabs[key] !== false) return key;
  return getFirstVisibleTabKey(sectionId);
}
