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

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return deepMerge(DEFAULT_SETTINGS, parsed);
    }
  } catch (e) {
    console.warn("No se pudieron leer los ajustes:", e);
  }
  return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
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

export function renderSettings(ctx) {
  const settings = loadSettings();

  const themeSelect = document.getElementById("settings-theme-select");
  if (themeSelect) {
    themeSelect.value = settings.theme || "dark";
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

export function setupSettings(ctx) {
  wireThemeSelect(ctx);
  wireNotificationToggles(ctx);
  wireSyncButton(ctx);
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
