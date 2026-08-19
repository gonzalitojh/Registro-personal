// =============================================================
// Diálogo de acciones de un episodio ya visto (issue #133): al
// pulsar la casilla de un episodio marcado, pregunta si se ha
// vuelto a ver (suma 1 al contador) o si se quiere desmarcar.
// Reutiliza el armazón #episode-actions-modal de index.html y los
// estilos de modal genéricos. Es PURO: no persiste nada; devuelve
// la elección del usuario y el repintado lo decide el llamador.
//
// La promesa que devuelve openEpisodeActionsModal() se resuelve
// con "seen_again", "unmarked" o null (descartado). Nunca rechaza.
// =============================================================

import { trapFocus } from "./focus-utils.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Estado del modal abierto actualmente (o null). closeEpisodeActionsModal()
// lo usa para cerrar la ventana desde fuera (p. ej. la tecla Escape,
// que prioriza el handler global de modal-handlers.js).
let currentClose = null;

/**
 * Cierra el diálogo de acciones sin elegir (si está abierto).
 * La usa el handler global de Escape en modal-handlers.js.
 */
export function closeEpisodeActionsModal() {
  if (currentClose) currentClose(null);
}

// Los botones de cierre del armazón estático (✕ y backdrop) viven en
// index.html, así que sus listeners se registran UNA sola vez al cargar
// el módulo (no por cada apertura). Delegan en closeEpisodeActionsModal(),
// que resuelve la promesa pendiente con null, y es idempotente: sin modal
// abierto (currentClose null) no hace nada.
document
  .getElementById("episode-actions-modal-close")
  .addEventListener("click", () => closeEpisodeActionsModal());
document
  .getElementById("episode-actions-modal-backdrop")
  .addEventListener("click", () => closeEpisodeActionsModal());

/**
 * Abre el diálogo de acciones de un episodio ya visto.
 * @param {object} opts
 * @param {string} opts.title     - Título de la serie
 * @param {string} [opts.subtitle] - Línea del episodio ("T1E3 · Piloto")
 * @param {number} opts.times     - Veces que se ha visto el episodio
 * @returns {Promise<"seen_again"|"unmarked"|null>} Elección del usuario,
 *          o null si se descartó.
 */
export function openEpisodeActionsModal({ title, subtitle, times }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("episode-actions-modal");
    const content = document.getElementById("episode-actions-modal-content");

    const timesLabel = `${times} ${times === 1 ? "vez" : "veces"}`;
    // Feedback issue #310: con más de una visualización, «desmarcar»
    // elimina solo la ÚLTIMA visión (el episodio sigue marcado); la
    // etiqueta lo anticipa para que la acción no sorprenda.
    const unmarkLabel = times > 1 ? "Quitar última visualización" : "Desmarcar";
    content.innerHTML = `
      <div class="rating-modal__header">
        <div class="rating-modal__info">
          <div class="rating-modal__title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="rating-modal__subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      </div>
      <div class="eam-body">
        Ya has visto este episodio ${timesLabel}. ¿Qué quieres hacer?
      </div>
      <div class="rating-modal__actions">
        <button type="button" class="btn btn--primary" id="eam-seen-again">Lo he visto de nuevo</button>
        <button type="button" class="btn btn--outline" id="eam-unmark">${unmarkLabel}</button>
        <button type="button" class="btn btn--outline" id="eam-cancel">Ahora no</button>
      </div>
    `;

    let settled = false;
    const close = (result) => {
      if (settled) return; // idempotente: cerrar dos veces no resuelve dos veces
      settled = true;
      currentClose = null;

      if (modal._focusTrapCleanup) {
        modal._focusTrapCleanup();
        modal._focusTrapCleanup = null;
      }
      // Restaurar el foco al elemento previo, si sigue en el DOM
      // (p. ej. la casilla del episodio)
      if (modal._previousActiveElement && document.contains(modal._previousActiveElement)) {
        modal._previousActiveElement.focus();
      }
      modal._previousActiveElement = null;

      modal.classList.add("hidden");
      content.innerHTML = "";
      resolve(result);
    };
    currentClose = close;

    content.querySelector("#eam-seen-again").addEventListener("click", () => close("seen_again"));
    content.querySelector("#eam-unmark").addEventListener("click", () => close("unmarked"));
    content.querySelector("#eam-cancel").addEventListener("click", () => close(null));

    // Record previous focus and trap
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
    modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  });
}
