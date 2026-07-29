// =============================================================
// Ajustes (Settings). Maneja la UI de configuración y la
// persistencia de preferencias en localStorage + Firestore.
// =============================================================

const STORAGE_KEY = "mi-registro-settings";
const DEBOUNCE_MS = 2000;

const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications: {
    movie_release: true,
    new_episode: true,
    series_premiere: true,
    friend_activity: true,
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

  const checkboxMap = {
    "notif-movie-release": "movie_release",
    "notif-new-episode": "new_episode",
    "notif-series-premiere": "series_premiere",
    "notif-friend-activity": "friend_activity",
  };

  Object.entries(checkboxMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings.notifications[key] !== false;
  });
}

// ---- Event Wiring ----

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
}

// ---- Public API ----

export function setupSettings(ctx) {
  wireThemeSelect(ctx);
  wireNotificationToggles(ctx);
}

/**
 * Sincroniza el select de tema de ajustes cuando se cambia
 * el tema desde el toggle del header.
 */
export function syncThemeSelect(theme) {
  const select = document.getElementById("settings-theme-select");
  if (select) select.value = theme;
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
