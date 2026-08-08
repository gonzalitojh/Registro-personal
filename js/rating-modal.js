// =============================================================
// Ventana de valoración emergente (issue #21): segundo modal que
// se superpone al modal de detalle (o aparece sobre la biblioteca
// en las acciones rápidas) al marcar como visto/leído una película,
// un libro o un episodio de serie. Reutiliza el armazón #rating-modal
// de index.html, los estilos de puntuación de la comunidad y el
// picker de estrellas de ui.js.
//
// La promesa que devuelve openRatingModal() se resuelve con el
// rating guardado (1-5), con RATING_MODAL_UNDONE si se deshizo el
// marcado, o con null si se descartó. Nunca rechaza: los errores de
// guardado/deshacer se notifican con un toast y la ventana permanece
// abierta.
// =============================================================

import { ratingPickerHtml, wireRatingAndGetValue, showToast, PLACEHOLDER_COVER } from "./ui.js";
import { trapFocus } from "./focus-utils.js";

// Valor especial con el que se resuelve la promesa cuando el usuario
// pulsa «Deshacer»: el marcado recién hecho se anuló y la UI de debajo
// debe volver a su estado previo (issue #136).
export const RATING_MODAL_UNDONE = "undone";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Portada segura para el atributo src: solo se aceptan URLs https o
// data:image/ (patrón del repo para placeholders, p. ej. PLACEHOLDER_COVER).
// Cualquier otro esquema (javascript:, data:text/html...) o URL inválida
// cae al placeholder. Se combina con escapeHtml en el atributo por
// defensa en profundidad.
function safeCoverUrl(url) {
  if (!url) return PLACEHOLDER_COVER;
  try {
    const parsed = new URL(url, window.location.href);
    if (
      parsed.protocol === "https:" ||
      (parsed.protocol === "data:" && parsed.pathname.startsWith("image/"))
    ) {
      return url;
    }
  } catch {
    // URL no parseable → placeholder
  }
  return PLACEHOLDER_COVER;
}

// Estado del modal abierto actualmente (o null). closeRatingModal()
// lo usa para cerrar la ventana desde fuera (p. ej. la tecla Escape,
// que prioriza el handler global de modal-handlers.js).
let currentClose = null;
// Mientras el deshacer está en curso, los cierres externos (✕,
// backdrop, Escape, «Ahora no») se ignoran: no deben resolver la
// promesa con null a mitad de la restauración (issue #136).
let undoInProgress = false;

/**
 * Cierra la ventana de valoración sin guardar (si está abierta).
 * La usa el handler global de Escape en modal-handlers.js.
 */
export function closeRatingModal() {
  if (currentClose) currentClose(null);
}

// Los botones de cierre del armazón estático (✕ y backdrop) viven en
// index.html, así que sus listeners se registran UNA sola vez al cargar
// el módulo (no por cada apertura). Delegan en closeRatingModal(), que
// resuelve la promesa pendiente con null si no se guardó, y es
// idempotente: sin modal abierto (currentClose null) no hace nada.
document.getElementById("rating-modal-close").addEventListener("click", () => closeRatingModal());
document.getElementById("rating-modal-backdrop").addEventListener("click", () => closeRatingModal());

/**
 * Abre la ventana de valoración sobre lo que haya en pantalla.
 * @param {object} opts
 * @param {string} opts.type            - "movie" | "tv" | "book"
 * @param {string} opts.title           - Título del ítem
 * @param {string|null} opts.coverUrl   - Portada (o null para placeholder)
 * @param {string} [opts.episodeLabel]  - Línea opcional del episodio ("T1E3 · Piloto")
 * @param {number|null} opts.communityRating - Nota de la comunidad (o null → "Sin puntuaciones")
 * @param {string} opts.communityLabel  - "TMDB" o "TMDB · episodio"
 * @param {number|null} opts.initialRating - Valoración previa del usuario (1-5)
 * @param {Function} opts.onSave        - async (rating) => {}, persiste la valoración
 * @param {Function} [opts.onUndo]      - async () => {}, anula el marcado recién hecho
 * @param {string} [opts.undoLabel]     - Texto del botón «Deshacer» (por defecto "Deshacer")
 * @returns {Promise<number|string|null>} Rating 1-5 guardado, RATING_MODAL_UNDONE si se
 *          deshizo el marcado, o null si se descartó.
 */
export function openRatingModal({ type, title, coverUrl, episodeLabel, communityRating, communityLabel, initialRating, onSave, onUndo, undoLabel = "Deshacer" }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("rating-modal");
    const content = document.getElementById("rating-modal-content");

    const ratingsHtml = communityRating != null
      ? `<div class="modal-detail__ratings">
          <span class="community-rating">
            <span class="community-rating__label">${escapeHtml(communityLabel)}</span>
            <span class="community-rating__value">${Number(communityRating).toFixed(1)}</span>
          </span>
        </div>`
      : `<div class="modal-detail__ratings">
          <span class="community-rating community-rating--empty">Sin puntuaciones</span>
        </div>`;

    content.innerHTML = `
      <div class="rating-modal__header">
        <img class="rating-modal__cover" src="${escapeHtml(safeCoverUrl(coverUrl))}" alt="" />
        <div class="rating-modal__info">
          <div class="rating-modal__title">${escapeHtml(title)}</div>
          ${episodeLabel ? `<div class="rating-modal__subtitle">${escapeHtml(episodeLabel)}</div>` : ""}
        </div>
      </div>
      ${ratingsHtml}
      <div class="rating-modal__stars">
        ${ratingPickerHtml(initialRating || 0, "rm-rating")}
      </div>
      <div class="rating-modal__actions">
        ${onUndo ? `<button type="button" class="btn btn--outline" id="rm-undo">${escapeHtml(undoLabel)}</button>` : ""}
        <button type="button" class="btn btn--outline" id="rm-save-later">Ahora no</button>
        <button type="button" class="btn btn--primary" id="rm-save">Guardar valoración</button>
      </div>
    `;

    // Picker compacto para la ventana pequeña
    const picker = content.querySelector(".rating-picker");
    if (picker) picker.classList.add("rating-picker--small");

    const getRating = wireRatingAndGetValue(content, initialRating || 0, "rm-rating");

    let settled = false;
    const close = (result) => {
      if (undoInProgress) return; // el deshacer en curso decide el cierre (issue #136)
      if (settled) return; // idempotente: cerrar dos veces no resuelve dos veces
      settled = true;
      currentClose = null;

      if (modal._focusTrapCleanup) {
        modal._focusTrapCleanup();
        modal._focusTrapCleanup = null;
      }
      // Restaurar el foco al elemento previo, si sigue en el DOM
      // (p. ej. la casilla del episodio o el botón de acción rápida)
      if (modal._previousActiveElement && document.contains(modal._previousActiveElement)) {
        modal._previousActiveElement.focus();
      }
      modal._previousActiveElement = null;

      modal.classList.add("hidden");
      content.innerHTML = "";
      resolve(result);
    };
    currentClose = close;

    // "Ahora no" también descarta
    content.querySelector("#rm-save-later").addEventListener("click", () => close(null));

    // Guardar: persiste y cierra con el rating; si falla, toast y se queda abierta
    content.querySelector("#rm-save").addEventListener("click", async () => {
      const rating = getRating();
      if (!rating) {
        showToast("Elige una valoración (de 1 a 5 estrellas).");
        return;
      }
      const saveBtn = content.querySelector("#rm-save");
      saveBtn.disabled = true;
      try {
        await onSave(rating);
        close(rating);
      } catch (err) {
        // Robustez frente a errores que no son instancia de Error
        // (p. ej. throw de strings/valores): el toast nunca muestra
        // "undefined".
        showToast("No se pudo guardar la valoración: " + String(err && err.message ? err.message : err));
        saveBtn.disabled = false;
      }
    });

    // Deshacer: anula el marcado recién hecho y cierra con
    // RATING_MODAL_UNDONE; si falla, toast y la ventana se queda
    // abierta. Ambos botones (deshacer y guardar) se deshabilitan
    // durante la operación para evitar carreras, y los cierres
    // externos se ignoran mientras corre (issue #136).
    if (onUndo) {
      content.querySelector("#rm-undo").addEventListener("click", async () => {
        const undoBtn = content.querySelector("#rm-undo");
        const saveBtn = content.querySelector("#rm-save");
        undoBtn.disabled = true;
        saveBtn.disabled = true;
        undoInProgress = true;
        try {
          await onUndo();
          // Liberar la guarda ANTES de cerrar: el close() con
          // RATING_MODAL_UNDONE debe pasar (la guarda solo bloquea
          // los cierres externos con null mientras el undo corre).
          undoInProgress = false;
          close(RATING_MODAL_UNDONE);
        } catch (err) {
          // Robustez frente a errores que no son instancia de Error
          // (p. ej. throw de strings/valores): el toast nunca muestra
          // "undefined".
          showToast("No se pudo deshacer: " + String(err && err.message ? err.message : err));
          undoBtn.disabled = false;
          saveBtn.disabled = false;
        } finally {
          undoInProgress = false;
        }
      });
    }

    // Record previous focus and trap
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
    modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  });
}
