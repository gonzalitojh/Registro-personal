// =============================================================
// Registro y ciclo de vida del Service Worker.
// Se importa desde index.html como módulo ES.
// =============================================================

const SW_PATH = '/Registro-personal/service-worker.js';
const SW_SCOPE = '/Registro-personal/';

let swRegistration = null;

/**
 * Registra el service worker y maneja actualizaciones.
 * Las actualizaciones se auto-aplican (SKIP_WAITING) sin pedir
 * confirmación al usuario.
 */
export function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker no soportado por este navegador.');
    return;
  }

  navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE, updateViaCache: 'none' })
    .then((registration) => {
      swRegistration = registration;
      console.log('[SW] Registrado correctamente. Ámbito:', registration.scope);

      // Si ya hay un worker esperando (actualización pendiente de un
      // registro anterior), auto-aplicarla directamente.
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Detectar nuevos workers en cuanto aparezcan
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nueva versión instalada y lista para activarse:
            // auto-aplicar sin preguntar al usuario (sin toast).
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch((err) => {
      console.error('[SW] Error al registrar:', err);
    });

  // Recargar la página cuando el SW toma el control.
  // El guard "refreshing" evita recargas dobles si el SW se
  // reactiva más de una vez.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

/**
 * Notifica al usuario que hay una nueva versión disponible.
 * Dispara un evento personalizado que recoge index.html.
 * Se mantiene como export por compatibilidad con código existente;
 * el registro ya no la usa (auto-update sin toast).
 */
export function notifyUpdateReady(registration) {
  const event = new CustomEvent('sw-update-ready', {
    detail: { registration },
  });
  document.dispatchEvent(event);
}

/**
 * Activa el service worker en espera (skipWaiting).
 * Se mantiene como export por compatibilidad con código existente.
 */
export function applySWUpdate(registration) {
  if (!registration || !registration.waiting) return;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Devuelve la referencia al registro actual (útil para depuración).
 */
export function getRegistration() {
  return swRegistration;
}
