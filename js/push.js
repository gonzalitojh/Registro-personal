// =============================================================
// Notificaciones en el dispositivo (Push): puente entre las
// notificaciones internas de la campana y las notificaciones del
// sistema operativo / navegador (Service Worker).
// Cuando la app está abierta pero NO en primer plano (pestaña
// oculta, otra app en el móvil con la PWA instalada), las
// notificaciones nuevas que llegan por Firestore se reenvían al
// Service Worker para mostrarlas como notificación del sistema.
// =============================================================

import { loadSettings, saveSettings } from "./settings.js";

// Límite de ids recordados para no volver a notificar lo ya visto.
// Evita que seenIds crezca sin fin: al superarlo se descartan los
// más antiguos (el Set mantiene el orden de inserción).
const MAX_SEEN = 500;

let seenIds = new Set();
let initialized = false;

// ---- Soporte y permiso del navegador ----

/** ¿El navegador soporta la API de notificaciones? */
export function isNotificationSupported() {
  return "Notification" in window;
}

/** Estado del permiso de notificaciones ('granted' | 'denied' | 'default'). */
export function getPermission() {
  return Notification.permission;
}

// ---- Preferencia de usuario (persistida en ajustes) ----

/** ¿El usuario tiene activadas las notificaciones en el dispositivo? */
export function isDevicePushEnabled() {
  return loadSettings().notifications.device_push === true;
}

/** Activa o desactiva la preferencia en los ajustes guardados. */
export function setDevicePushEnabled(enabled) {
  const s = loadSettings();
  s.notifications.device_push = enabled;
  saveSettings(s);
}

/** Pide al usuario el permiso de notificaciones del navegador. */
export async function requestDevicePushPermission() {
  return Notification.requestPermission();
}

/**
 * ¿La app está en primer plano? Decisión de producto: solo se mira
 * document.visibilityState (NO document.hasFocus()) para evitar
 * falsos negativos en iOS standalone. Notificamos cuando la app NO
 * está en primer plano.
 */
export function isAppInForeground() {
  return document.visibilityState === "visible";
}

// ---- Detección de notificaciones nuevas y envío al SW ----

/** Descarta los ids más antiguos si seenIds supera MAX_SEEN. */
function trimSeenIds() {
  while (seenIds.size > MAX_SEEN) {
    seenIds.delete(seenIds.values().next().value);
  }
}

/**
 * Procesa cada snapshot de la campana: detecta notificaciones NUEVAS
 * por id y, si la app está en segundo plano y el usuario tiene
 * activado el push, las reenvía al Service Worker (fire-and-forget)
 * para que las muestre como notificación del sistema.
 */
export function handleNotificationsSnapshot(items) {
  if (!initialized) {
    // Baseline: al abrir la app NO se notifica lo ya existente.
    for (const n of items || []) {
      if (n && n.id) seenIds.add(n.id);
    }
    initialized = true;
    return;
  }

  const nuevas = (items || []).filter((n) => n && n.id && !seenIds.has(n.id));

  for (const n of items || []) {
    if (n && n.id) seenIds.add(n.id);
  }
  trimSeenIds();

  if (!isDevicePushEnabled() || isAppInForeground()) return;

  for (const n of nuevas) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.active &&
        reg.active.postMessage({
          type: "SHOW_NOTIFICATION",
          id: n.id,
          message: String(n.message || "").slice(0, 140),
        })
      )
      .catch(() => {});
  }
}

/**
 * Resetea el estado de detección (p. ej. al cerrar sesión) para que
 * el siguiente inicio de sesión vuelva a tomar baseline y no se
 * notifiquen notificaciones antiguas de la sesión anterior.
 */
export function resetDevicePush() {
  seenIds.clear();
  initialized = false;
}
