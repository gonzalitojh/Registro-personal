// =============================================================
// Gestión de eliminaciones con opción de deshacer.
// En lugar de borrar inmediatamente de Firestore, programa la
// eliminación con un temporizador de 6 segundos. Si el usuario
// hace clic en "Deshacer", se cancela. Si el temporizador expira,
// se ejecuta deleteDoc.
// Solo un toast de deshacer visible a la vez. Si se programa otra
// eliminación mientras hay una pendiente, la anterior se ejecuta
// inmediatamente.
// =============================================================

import * as ui from "./ui.js";

const DELAY_MS = 6000;

// Almacena la única eliminación pendiente (como mucho una a la vez).
// Cada entrada: { timerId, uid, kind, itemId, hideToast }
const pending = new Map();

/**
 * Programa la eliminación de un ítem con posibilidad de deshacer.
 * @param {Object} item  - El ítem a eliminar (debe tener .id y .title)
 * @param {string} uid   - UID del usuario autenticado
 * @param {string} kind  - "movie" | "tv" | "book"
 * @param {Object} ctx   - Contexto con deleteItem(uid, kind, id)
 */
export function scheduleDeletion(item, uid, kind, ctx) {
  const itemId = item.id;

  // Si ya hay una eliminación pendiente
  if (pending.size > 0) {
    for (const [key, data] of pending) {
      if (key === itemId) {
        // Mismo ítem — solo reiniciar el temporizador, no eliminar aún
        clearTimeout(data.timerId);
        data.hideToast();
        pending.delete(key);
        break;
      } else {
        // Ítem diferente — ejecutar la pendiente inmediatamente
        clearTimeout(data.timerId);
        pending.delete(key);
        _executeDeletion(data, ctx);
        break;
      }
    }
  }

  // Callback cuando el usuario hace clic en "Deshacer"
  const onUndo = () => {
    const data = pending.get(itemId);
    if (!data) return;
    clearTimeout(data.timerId);
    data.hideToast();
    pending.delete(itemId);
    ui.showToast("Cancelado.");
  };

  // Mostrar el toast con botón de deshacer
  const { hide } = ui.showUndoToast(item.title, onUndo);

  // Temporizador que ejecuta la eliminación definitiva
  const timerId = setTimeout(() => {
    const data = pending.get(itemId);
    if (!data) return;
    // Eliminar del mapa ANTES de la operación asíncrona para
    // que el botón "Deshacer" ya no tenga efecto
    pending.delete(itemId);
    _executeDeletion(data, ctx);
  }, DELAY_MS);

  pending.set(itemId, { timerId, uid, kind, itemId, hideToast: hide });
}

/**
 * Ejecuta la eliminación definitiva en Firestore.
 */
async function _executeDeletion(data, ctx) {
  const { uid, kind, itemId, hideToast } = data;
  try {
    await ctx.deleteItem(uid, kind, itemId);
    hideToast();
    ui.showToast("Eliminado.");
  } catch (err) {
    hideToast();
    ui.showToast("No se pudo eliminar: " + err.message);
  }
}

/**
 * Cancela todas las eliminaciones pendientes (útil en beforeunload).
 * Los ítems permanecen en Firestore — no hay pérdida de datos.
 */
export function cancelAllDeletions() {
  for (const [, data] of pending) {
    clearTimeout(data.timerId);
    data.hideToast();
  }
  pending.clear();
}

// Al recargar la página se cancelan las eliminaciones pendientes
window.addEventListener("beforeunload", cancelAllDeletions);