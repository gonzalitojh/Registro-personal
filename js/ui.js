// =============================================================
// Renderizado del DOM. Este módulo no habla con Firebase ni con
// las APIs externas: recibe datos ya listos y devuelve HTML,
// o dispara callbacks que app.js conecta con db.js / TMDB.
// =============================================================

import { todayISO, formatDateEs } from "./dates.js";
import { STATUS_LABELS } from "./constants.js";
import { getNextEpisodeAirInfo, isItemUnreleased } from "./sorting.js";
import { normalizeEntry, computeEpisodeAverageRating } from "./tv-progress.js";
import { trapFocus } from "./focus-utils.js";
import { isUnreleasedDate, episodeUnreleasedMessage } from "./release.js";
import { openEpisodeActionsModal } from "./episode-actions-modal.js";
import { openCastModal, safePhotoUrl } from "./cast-modal.js";
import { needsDetailFetch, loadItemDetails } from "./item-details.js";
import { getItemAwards } from "./api-movies.js";

function scopeFor(type) {
  return type === "book" ? "book" : type === "game" ? "game" : "media";
}

export function statusLabel(status, type) {
  const scope = scopeFor(type);
  return STATUS_LABELS[scope][status] || status;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// HTML para un distintivo de puntuación de la comunidad (TMDB, IGDB
// para videojuegos). Variante compacta (--sm) para filas de episodio
// (issue #45).
function communityRatingValueHtml(value, label = "TMDB") {
  const val = Number(value).toFixed(1);
  return `<span class="community-rating community-rating--sm">
    <span class="community-rating__label">${label}</span>
    <span class="community-rating__value">${val}</span>
  </span>`;
}

// HTML para la puntuación de la comunidad (TMDB) en tarjetas compactas.
// Devuelve cadena vacía si no hay datos (no ocupa espacio en la cuadrícula).
function communityRatingHtml(item) {
  if (item.communityRating == null) return "";
  const label = item.type === "game" ? "IGDB" : "TMDB";
  return communityRatingValueHtml(item.communityRating, label).replace(
    "community-rating community-rating--sm",
    "community-rating"
  );
}

// Para modales: siempre muestra una línea, ya sea la nota real o
// un indicador de "Sin puntuaciones" cuando no hay datos de TMDB/IGDB.
// Exportado (issue #290): la preview de la página de ítem lo reutiliza
// para mostrar la misma información del título que la ficha.
export function communityRatingDisplay(item) {
  const label = item.type === "game" ? "IGDB" : "TMDB";
  if (item.communityRating != null) {
    const val = Number(item.communityRating).toFixed(1);
    return `<div class="modal-detail__ratings">
      <span class="community-rating">
        <span class="community-rating__label">${label}</span>
        <span class="community-rating__value">${val}</span>
      </span>
    </div>`;
  }
  return `<div class="modal-detail__ratings">
    <span class="community-rating community-rating--empty">Sin puntuaciones</span>
  </div>`;
}

// HTML para el botón de tráiler de YouTube.
// Devuelve cadena vacía si no hay URL de tráiler disponible.
// Exportado (issue #290): lo reutiliza la preview de la página de ítem.
export function trailerButtonHtml(item) {
  if (!item.trailerUrl) return "";
  return `<a href="${escapeHtml(item.trailerUrl)}" target="_blank" rel="noopener noreferrer" class="trailer-btn" aria-label="Ver tráiler en YouTube">
    <span class="trailer-btn__icon" aria-hidden="true">▶</span>
    <span class="trailer-btn__label">Tráiler</span>
  </a>`;
}

function typeLabel(type) {
  if (type === "movie") return "Película";
  if (type === "tv") return "Serie";
  if (type === "game") return "Videojuego";
  return "Libro";
}

export const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='300'><rect width='100%' height='100%' fill='#e3dac4'/><text x='50%' y='50%' font-family='sans-serif' font-size='16' fill='#948a76' text-anchor='middle'>Sin imagen</text></svg>`
  );

// Placeholder de la barra de búsqueda global (issue #46): al entrar
// se muestra "Mi Registro" y a los 3.5 s pasa al placeholder por
// defecto. El timer se limpia al cerrar sesión. El placeholder por
// defecto ya no menciona a los amigos: la búsqueda se acota a la
// sección (issue #206) y solo se restaura en la pantalla de acceso.
export const DEFAULT_SEARCH_PLACEHOLDER = "Buscar películas, series, libros y videojuegos...";
const SEARCH_BRAND_PLACEHOLDER = "Mi Registro";
const SEARCH_PLACEHOLDER_SWITCH_MS = 3500;
let searchPlaceholderTimer = null;

// Placeholder y aria-label según la sección activa (issue #206): la
// búsqueda superior se acota a la sección (Ocio / Perfil / Recetas).
const SEARCH_PLACEHOLDER_BY_SECTION = {
  ocio: "Buscar películas, series, libros y videojuegos...",
  perfil: "Buscar amigos...",
  recetas: "Buscar recetas...",
  gimnasio: "Buscar en tu gimnasio...",
};
const SEARCH_ARIA_BY_SECTION = {
  ocio: "Buscar en tu registro de ocio",
  perfil: "Buscar en tus amigos",
  recetas: "Buscar en tus recetas",
  gimnasio: "Buscar en tu registro de gimnasio",
};
let currentSearchSection = "ocio";

// Cambia el placeholder de la barra al navegar de sección (lo llama
// el onRoute de app.js). Corta el placeholder animado de bienvenida:
// si el usuario cambia de sección durante los 3.5 s, el de la sección
// se muestra al momento.
export function setSearchSection(section) {
  currentSearchSection = SEARCH_PLACEHOLDER_BY_SECTION[section] ? section : "ocio";
  const searchInput = getGlobalSearchInput();
  if (!searchInput) return;
  clearTimeout(searchPlaceholderTimer);
  searchPlaceholderTimer = null;
  searchInput.placeholder = SEARCH_PLACEHOLDER_BY_SECTION[currentSearchSection];
  searchInput.setAttribute("aria-label", SEARCH_ARIA_BY_SECTION[currentSearchSection]);
}

function getGlobalSearchInput() {
  return document.getElementById("global-search-input");
}

export function showAuthScreen() {
  // Al salir: parar la secuencia de placeholder y restaurar el normal
  clearTimeout(searchPlaceholderTimer);
  searchPlaceholderTimer = null;
  const searchInput = getGlobalSearchInput();
  if (searchInput) searchInput.placeholder = DEFAULT_SEARCH_PLACEHOLDER;

  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
  // Cabecera global (issue #206): solo es visible con sesión iniciada
  document.getElementById("app-header")?.classList.add("hidden");
}

export function showApp(user) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  // Cabecera global visible en todas las secciones (issue #206)
  document.getElementById("app-header")?.classList.remove("hidden");
  document.getElementById("user-avatar").src = user.photoURL || PLACEHOLDER_COVER;

  // Placeholder animado: "Mi Registro" → placeholder de la sección
  const searchInput = getGlobalSearchInput();
  if (searchInput) {
    clearTimeout(searchPlaceholderTimer);
    searchInput.placeholder = SEARCH_BRAND_PLACEHOLDER;
    searchInput.setAttribute("aria-label", SEARCH_ARIA_BY_SECTION[currentSearchSection]);
    searchPlaceholderTimer = setTimeout(() => {
      searchInput.placeholder = SEARCH_PLACEHOLDER_BY_SECTION[currentSearchSection];
      searchPlaceholderTimer = null;
    }, SEARCH_PLACEHOLDER_SWITCH_MS);
  }
}

export function setAuthError(message) {
  const el = document.getElementById("auth-error");
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

/* ---------- Vista previa de resultados de búsqueda (issue #22) ---------- */

// Muestra la información de un resultado de búsqueda en el modal de
// detalle, como si ya estuviese añadido a la colección. El botón
// "Añadir" delega en onAdd (que devuelve true si el alta fue exitosa,
// para que el llamador cierre el modal). Si se pasa onEnrich, se
// cargan los detalles ampliados (duración, reparto, sinopsis, rating,
// tráiler) sin re-renderizar la estructura del modal. Si se pasa
// onClose, se invoca en lugar de cerrar el modal desde el botón
// "Cerrar", la ✕, el backdrop y la tecla Escape (lo usa la vista
// previa de películas de la saga, issue #280, para restaurar la ficha
// que se estaba viendo).
export function openSearchPreviewModal(item, { added = false, onAdd = null, onEnrich = null, onClose = null } = {}) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine =
    item.type === "book"
      ? [item.author, item.year, item.pages ? `${item.pages} págs.` : null].filter(Boolean).join(" · ")
      : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
  const editionsNote =
    item.type === "book" && item.editionsCount > 1
      ? `<p class="book-confirm__editions">${item.editionsCount} ediciones — al añadir podrás elegir portada</p>`
      : "";
  const isBook = item.type === "book";

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editionsNote}
    <div id="preview-details">
      ${gamePlatformsHtml(item)}
      ${extraInfoHtml(item)}
      ${previewPagesHtml(item)}
      ${previewSeasonsHtml(item)}
      ${onEnrich ? `<p class="extra-info__line" id="preview-loading">Cargando detalles…</p>` : ""}
    </div>
    ${isBook ? "" : `${communityRatingDisplay(item)}${trailerButtonHtml(item)}`}
    <div class="modal-actions">
      <button class="btn btn--outline" id="btn-preview-close">Cerrar</button>
      <button class="btn ${isBook ? "btn--accent-books" : "btn--accent-media"}"
              id="btn-preview-add" ${added ? "disabled" : ""}>
        ${added ? "Ya añadido" : "Añadir"}
      </button>
    </div>
  `;

  content.querySelector("#btn-preview-close").addEventListener("click", () => {
    if (onClose) onClose();
    else closeModal();
  });

  const addBtn = content.querySelector("#btn-preview-add");
  if (onAdd && !added) {
    addBtn.addEventListener("click", () => onAdd(item, addBtn));
  }

  // Patrón estándar de apertura del proyecto. El cierre personalizado
  // (onClose) se guarda en el modal para que backdrop, ✕ y Escape lo
  // respeten igual que el botón "Cerrar" (issue #280, QA D3).
  modal._onClose = onClose || null;
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));

  // Carruseles de elenco (issue #294): si el resultado de búsqueda ya
  // trae cast/crew (p. ej. reapertura con caché), cablear los botones.
  wireCastCrewClicks(content, item);

  if (onEnrich) {
    const previewDetailsEl = content.querySelector("#preview-details");
    const loadingHint = content.querySelector("#preview-loading");

    (async () => {
      let details;
      try {
        details = await onEnrich(item);
      } catch (err) {
        // Fallo de red/API: no bloqueamos la vista previa
      }
      // El hint de carga se elimina siempre (éxito o fallo)
      if (loadingHint) loadingHint.remove();

      // Guardas: el modal pudo cerrarse o re-renderizarse mientras tanto
      if (!previewDetailsEl.isConnected || modal.classList.contains("hidden")) return;
      if (!details) return;

      const prevRating = item.communityRating;
      const hadTrailer = Boolean(item.trailerUrl);
      Object.assign(item, details);

      // Solo se re-renderiza el bloque de detalles, no la estructura
      previewDetailsEl.innerHTML = gamePlatformsHtml(item) + extraInfoHtml(item) + previewPagesHtml(item) + previewSeasonsHtml(item);
      // Los carruseles de elenco recién llegados (issue #294) se
      // cablean tras el re-render (los botones del render inicial no
      // existen ya: #preview-details se sustituyó entero).
      wireCastCrewClicks(content, item);

      // Si llegaron rating de comunidad o tráiler nuevos, refrescar
      // esos bloques (pueden no existir: p. ej. libros)
      if (details.communityRating !== undefined && details.communityRating !== prevRating) {
        const ratingsEl = content.querySelector(".modal-detail__ratings");
        if (ratingsEl) ratingsEl.outerHTML = communityRatingDisplay(item);
      }
      if (details.trailerUrl && !hadTrailer) {
        const trailerEl = content.querySelector(".trailer-btn");
        if (trailerEl) {
          trailerEl.outerHTML = trailerButtonHtml(item);
        } else {
          // Los resultados de búsqueda nunca traen trailerUrl, así que
          // el botón no existe en el render inicial: insertarlo antes
          // de las acciones del modal
          const actions = content.querySelector(".modal-actions");
          if (actions) actions.insertAdjacentHTML("beforebegin", trailerButtonHtml(item));
        }
      }
    })();
  }
}

/* ---------- Biblioteca personal: grid y lista ---------- */

function progressLine(item) {
  if (item.type === "movie") {
    const log = item.watchLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    return `Vista el ${formatDateEs(last)}${log.length > 1 ? ` · ×${log.length}` : ""}`;
  }
  if (item.type === "tv") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonada";
    if (item.status === "completado") {
      const times = (item.timesCompleted || 0) + 1;
      return `Completa${times > 1 ? ` · ×${times}` : ""} · ${formatDateEs(item.lastWatchedAt)}`;
    }
    if (item.nextEpisode) {
      return `Siguiente: T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
    }
    return "";
  }
  if (item.type === "book") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonado";
    const log = item.readLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    if (!last.finishedAt) return `Leyendo desde ${formatDateEs(last.startedAt)}`;
    const times = log.filter((e) => e.finishedAt).length;
    return `Leído el ${formatDateEs(last.finishedAt)}${times > 1 ? ` · ×${times}` : ""}`;
  }
  if (item.type === "game") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonado";
    const log = item.playLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    if (!last.finishedAt) return `Jugando desde ${formatDateEs(last.startedAt)}`;
    const times = log.filter((e) => e.finishedAt).length;
    return `Jugado el ${formatDateEs(last.finishedAt)}${times > 1 ? ` · ×${times}` : ""}`;
  }
  return "";
}

function metaLineFor(item) {
  return item.type === "book"
    ? [item.author, item.year].filter(Boolean).join(" · ")
    : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
}

// Etiqueta corta del botón/acción rápida (modo lista y swipe).
function quickActionLabel(item) {
  if (item.type === "movie") return "Vista ✓";
  if (item.type === "tv") {
    if (!item.nextEpisode) return "Completa ✓";
    return `Ver T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
  }
  if (item.type === "game") {
    const log = item.playLog || [];
    const isPlaying = log.length && !log[log.length - 1].finishedAt;
    if (isPlaying) return "Terminar ✓";
    if (log.length) return "Rejugar ↺";
    return "Empezar ✓";
  }
  const log = item.readLog || [];
  const isReading = log.length && !log[log.length - 1].finishedAt;
  if (isReading) return "Terminar ✓";
  if (log.length) return "Releer ↺";
  return "Empezar ✓";
}

// Exportado (issue #290): la preview de la página de ítem lo reutiliza
// para mostrar el distintivo de "sin estrenar" igual que la ficha.
export function upcomingBadge(item) {
  if (!isItemUnreleased(item)) return "";
  const cls = "item-card__upcoming item-card__upcoming--unreleased";
  if (item.type === "movie") {
    return `<div class="${cls}">Aún no estrenada${item.releaseDate ? ` · ${formatDateEs(item.releaseDate)}` : ""}</div>`;
  }
  if (item.awaitingRelease && item.nextEpisode) { // serie sin estrenar (premiere)
    return `<div class="${cls}">Aún no estrenada${item.firstAirDate ? ` · ${formatDateEs(item.firstAirDate)}` : ""}</div>`;
  }
  // Serie en curso con el próximo episodio sin estrenar. isItemUnreleased
  // garantiza que hay info, pero por seguridad si no la hay no se pinta.
  const info = getNextEpisodeAirInfo(item);
  if (!info) return "";
  return `<div class="${cls}">Aún no estrenado · T${info.season}E${info.episode}${info.airDate ? ` · ${formatDateEs(info.airDate)}` : ""}</div>`;
}

function renderGrid(gridEl, items, onOpen) {
  gridEl.className = "library-grid";
  gridEl.innerHTML = items
    .map((item, index) => {
      const stars = ratingStarsHtml(item.rating);
      const communityBadge = communityRatingHtml(item);
      const hasRatings = stars || communityBadge;
      const progress = progressLine(item);
      const blockedClass = isItemUnreleased(item) ? " item-card--unreleased" : "";
      return `
      <article class="item-card item-card--${item.status}${blockedClass}">
        <div class="item-card__cover-wrap">
          <img class="item-card__cover" loading="lazy"
               src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
          <span class="item-card__stamp item-card__stamp--${item.status}">
            ${statusLabel(item.status, item.type)}
          </span>
        </div>
        <div class="item-card__perforation"></div>
        <div class="item-card__body">
          ${upcomingBadge(item)}
          <div class="item-card__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="item-card__meta" title="${escapeHtml(metaLineFor(item))}">${escapeHtml(metaLineFor(item))}</div>
          ${progress ? `<div class="item-card__progress">${escapeHtml(progress)}</div>` : ""}
          ${hasRatings ? `<div class="item-card__ratings">
            ${stars ? `<span class="item-card__rating">${stars}</span>` : ""}
            ${communityBadge}
          </div>` : ""}
        </div>
        <button class="item-card__btn" data-index="${index}"
                title="${escapeHtml(item.title)} — ${escapeHtml(metaLineFor(item))}"
                aria-label="Ver detalles de ${escapeHtml(item.title)}"></button>
      </article>`;
    })
    .join("");

  gridEl.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => onOpen(items[Number(btn.dataset.index)]));
  });
}

function attachSwipe(row, content, onTrigger) {
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let dragging = false;
  let lock = null; // null | 'vertical' | 'horizontal'
  let startTouchId = null;
  const lockThreshold = 10; // slop de decisión de dirección
  const threshold = 70;

  row.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTouchId = touch.identifier;
      dragging = true;
      row.classList.add("is-dragging");
    },
    { passive: true }
  );

  row.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      // Seguir al dedo original por identifier (fallback al primero)
      const touch =
        Array.from(e.touches).find((t) => t.identifier === startTouchId) ||
        e.touches[0];
      deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      // Axis lock: al cruzar el slop se decide el eje y no se vuelve atrás.
      // El empate gana 'vertical' (el scroll siempre manda).
      if (
        lock === null &&
        (Math.abs(deltaX) >= lockThreshold || Math.abs(deltaY) >= lockThreshold)
      ) {
        lock = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      }
      if (lock === "vertical") return; // gesto de scroll: sin transform ni toggle
      if (lock === "horizontal") {
        const clamped = Math.max(-120, Math.min(120, deltaX));
        content.style.transform = `translateX(${clamped}px)`;
        row.classList.toggle("swipe-reveal", Math.abs(clamped) > 24);
      }
    },
    { passive: true }
  );

  const resetGesture = () => {
    dragging = false;
    row.classList.remove("is-dragging", "swipe-reveal");
    content.style.transform = "";
    lock = null;
    startTouchId = null;
    deltaX = 0;
  };

  row.addEventListener("touchend", () => {
    // Evaluar antes de resetGesture(): resetea lock y deltaX
    const shouldTrigger = lock !== "vertical" && Math.abs(deltaX) > threshold;
    resetGesture();
    if (shouldTrigger) onTrigger();
  });

  row.addEventListener("touchcancel", () => {
    resetGesture();
  });
}

function renderList(gridEl, items, { onOpen, onQuickAction }) {
  gridEl.className = "library-list";
  gridEl.innerHTML = items
    .map((item, index) => {
      const progress = progressLine(item);
      const blockedClass = isItemUnreleased(item) ? " list-row--unreleased" : "";
      return `
      <div class="list-row list-row--${item.status}${blockedClass}" data-index="${index}">
        <div class="list-row__swipe-bg">✓ ${escapeHtml(quickActionLabel(item))}</div>
        <div class="list-row__content">
          <button class="list-row__open" data-index="${index}"
                  aria-label="Ver detalles de ${escapeHtml(item.title)}">
            <img class="list-row__cover" loading="lazy"
                 src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
            <div class="list-row__info">
              <div class="list-row__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
              <div class="list-row__meta" title="${escapeHtml(metaLineFor(item))}">${escapeHtml(metaLineFor(item))}</div>
              ${progress ? `<div class="list-row__progress">${escapeHtml(progress)}</div>` : ""}
              ${upcomingBadge(item)}
            </div>
            <span class="item-card__stamp item-card__stamp--${item.status} list-row__stamp">
              ${statusLabel(item.status, item.type)}
            </span>
          </button>
          <button class="list-row__action" data-index="${index}">
            ${escapeHtml(quickActionLabel(item))}
          </button>
        </div>
      </div>`;
    })
    .join("");

  gridEl.querySelectorAll(".list-row__open").forEach((btn) => {
    btn.addEventListener("click", () => onOpen(items[Number(btn.dataset.index)]));
  });
  gridEl.querySelectorAll(".list-row__action").forEach((btn) => {
    btn.addEventListener("click", () => onQuickAction(items[Number(btn.dataset.index)], btn));
  });
  gridEl.querySelectorAll(".list-row").forEach((row) => {
    const content = row.querySelector(".list-row__content");
    const item = items[Number(row.dataset.index)];
    attachSwipe(row, content, () => onQuickAction(item, null));
  });
}

export function renderLibrary(gridEl, emptyEl, items, viewMode, { onOpen, onQuickAction }) {
  if (!items.length) {
    gridEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  if (viewMode === "list") {
    renderList(gridEl, items, { onOpen, onQuickAction });
  } else {
    renderGrid(gridEl, items, onOpen);
  }
}

/* ---------- Campos comunes ---------- */

// Normaliza una valoración a pasos de 0.5 (0, 0.5, 1, ... 5). Los
// pickers admiten medias estrellas (issue #276), así que todo punto
// de entrada pasa por aquí para sanear valores externos.
function normalizeRating(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const half = Math.round(v * 2) / 2;
  if (half < 0) return 0;
  if (half > 5) return 5;
  return half;
}

// Etiqueta accesible de un botón del picker para el valor N (1-5).
function ratingButtonAriaLabel(n) {
  return n === 1 ? "1 estrella" : `${n} estrellas`;
}

// HTML informativo de las estrellas de un ítem (tarjetas y ficha de
// solo lectura). Las medias estrellas se muestran como «½» tras las
// completas (p. ej. 2.5 → «★★½») — issue #276.
export function ratingStarsHtml(rating) {
  const v = normalizeRating(rating);
  if (!v) return "";
  const full = "★".repeat(Math.floor(v));
  return v % 1 === 0 ? full : full + "½";
}

// HTML del picker de estrellas (1-5, con medias desde la issue #276).
// idPrefix evita ids duplicados cuando hay varios pickers en pantalla
// a la vez (p. ej. el de la ventana de valoración emergente, que usa
// "rm-rating"). Un valor como 2.5 pinta «is-active» en 1-2 y la media
// estrella («½») en el botón 3 (clase is-half).
export function ratingPickerHtml(rating, idPrefix = "field-rating", extraHtml = "") {
  const value = normalizeRating(rating);
  return `
    <div class="field-group">
      <label>Valoración</label>
      <div class="rating-picker" id="${idPrefix}">
        ${[1, 2, 3, 4, 5]
          .map((n) => {
            const full = value >= n;
            const half = value === n - 0.5;
            return `<button type="button" data-value="${n}" class="${
              full ? "is-active" : ""
            }${half ? " is-half" : ""}" aria-label="${
              half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
            }">${half ? "½" : n}</button>`;
          })
          .join("")}
      </div>
      ${extraHtml}
    </div>`;
}

// Media de valoración de los episodios valorados de la serie (issue #80).
// Sin media: span oculto (placeholder que updateEpisodeAverage actualiza).
function episodeAverageHtml(watched, idPrefix) {
  const avg = computeEpisodeAverageRating(watched);
  if (!avg) {
    return `<span class="episode-average" id="${idPrefix}-episode-average" hidden></span>`;
  }
  const ratedLabel = avg.count === 1 ? "1 episodio valorado" : `${avg.count} episodios valorados`;
  return `<span class="episode-average" id="${idPrefix}-episode-average" title="Media de ${ratedLabel}">Media episodios: <strong>${avg.average.toFixed(1)}</strong></span>`;
}

function notesFieldHtml(notes) {
  return `
    <div class="field-group">
      <label for="field-notes">Notas</label>
      <textarea id="field-notes" placeholder="Impresiones...">${escapeHtml(notes || "")}</textarea>
    </div>`;
}

// Wiring del picker con medias estrellas (issue #276). Ciclo de
// pulsación sobre el mismo botón N: 1er pulso → N; 2º pulso → N−0.5;
// 3er pulso → 0 (quitar valoración, como antes). Devuelve un getter
// con el valor seleccionado (0 o múltiplo de 0.5 entre 0.5 y 5).
export function wireRatingAndGetValue(content, initialRating, idPrefix = "field-rating") {
  let selectedRating = normalizeRating(initialRating);
  const buttons = content.querySelectorAll(`#${idPrefix} button`);
  const repaint = () => {
    buttons.forEach((b) => {
      const n = Number(b.dataset.value);
      const full = selectedRating >= n;
      const half = selectedRating === n - 0.5;
      b.classList.toggle("is-active", full && !half);
      b.classList.toggle("is-half", half);
      b.textContent = half ? "½" : n;
      b.setAttribute(
        "aria-label",
        half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
      );
    });
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.value);
      if (selectedRating === value) selectedRating = value - 0.5;
      else if (selectedRating === value - 0.5) selectedRating = 0;
      else selectedRating = value;
      repaint();
    });
  });
  repaint();
  return () => selectedRating;
}

// Botones de pausar / abandonar / retomar, comunes a series y libros.
function renderStatusActions(status) {
  if (status === "completado") return "";
  const buttons = [];
  if (status !== "standby") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--outline" id="btn-status-standby">En pausa</button>`
    );
  }
  if (status !== "abandonado") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--danger" id="btn-status-abandon">Abandonar</button>`
    );
  }
  if (status === "standby" || status === "abandonado") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--primary" id="btn-status-resume">Retomar</button>`
    );
  }
  return `<div class="status-actions">${buttons.join("")}</div>`;
}

function renderStandbyBanner(status, extraText, abandonLabel = "Abandonado/a") {
  if (status !== "standby" && status !== "abandonado") return "";
  const label = status === "standby" ? "En pausa" : abandonLabel;
  return `<div class="standby-banner"><span>${label}${
    extraText ? " · " + escapeHtml(extraText) : ""
  } — tu progreso se conserva.</span></div>`;
}

function wireStatusActions(content, handleStatusChange) {
  const standbyBtn = content.querySelector("#btn-status-standby");
  if (standbyBtn) {
    standbyBtn.addEventListener("click", () => handleStatusChange("standby"));
  }
  const abandonBtn = content.querySelector("#btn-status-abandon");
  if (abandonBtn) {
    abandonBtn.addEventListener("click", () => {
      if (!window.confirm("¿Marcar como abandonado? No se perderá tu progreso.")) return;
      handleStatusChange("abandonado");
    });
  }
  const resumeBtn = content.querySelector("#btn-status-resume");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => handleStatusChange(null));
  }
}

// Información ampliada de TMDB (duración, género, sinopsis) o de la
// fuente de libros (sinopsis). No todos los campos están siempre
// disponibles, así que cada línea es opcional.
// Exportado (issue #290): lo reutiliza la preview de la página de ítem.
// Opciones (issue #292): con skipMetaBits/skipOverview la página de
// ítem (ficha y preview) mueve duración+géneros y sinopsis al bloque
// hero (itemHeroHtml); con skipStatusFallback (solo junto a los
// anteriores) no se duplica la línea de carga/error que ya pinta el
// hero. Los llamadores clásicos (modales) no pasan opciones: sin
// cambios.
// Issue #294: en películas/series las líneas de director/creadores/
// reparto se SUSTITUYEN por los carruseles de elenco (castCrewHtml);
// si hay carruseles se devuelven junto al resto de líneas, y el
// fallback de carga/error solo aplica cuando no hay ni líneas ni
// carruseles.
export function extraInfoHtml(item, { skipMetaBits = false, skipOverview = false, skipStatusFallback = false, skipCarousels = false } = {}) {
  const lines = [];
  const metaBits = [];
  if (!skipMetaBits) {
    if (item.runtime) metaBits.push(`${item.runtime} min`);
    if (item.episodeRuntime) metaBits.push(`~${item.episodeRuntime} min/episodio`);
    if (item.genres && item.genres.length) metaBits.push(item.genres.join(", "));
    if (metaBits.length) lines.push(`<p class="extra-info__line">${escapeHtml(metaBits.join(" · "))}</p>`);
  }
  // Elenco (issue #294): películas y series muestran los carruseles de
  // producción y reparto en lugar de las líneas de texto de
  // director/creadores/reparto (ver castCrewHtml).
  const carousels = castCrewHtml(item);
  if (item.type === "game") {
    if (item.developers && item.developers.length) {
      lines.push(
        `<p class="extra-info__line"><strong>Desarrollador${item.developers.length > 1 ? "es" : ""}:</strong> ${escapeHtml(
          item.developers.join(", ")
        )}</p>`
      );
    }
    if (item.metacritic != null) {
      lines.push(`<p class="extra-info__line"><strong>Metacritic:</strong> ${escapeHtml(item.metacritic)}</p>`);
    }
    if (item.playtime) {
      lines.push(`<p class="extra-info__line"><strong>Duración media:</strong> ~${escapeHtml(item.playtime)} horas</p>`);
    }
    if (item.esrbName) {
      lines.push(`<p class="extra-info__line"><strong>Clasificación:</strong> ${escapeHtml(item.esrbName)}</p>`);
    }
  }
  const overview = item.overview || item.description;
  if (overview && !skipOverview) lines.push(`<p class="extra-info__overview">${escapeHtml(overview)}</p>`);
  if (!lines.length) {
    // skipCarousels (issue #302, iteración): los carruseles de
    // producción/reparto se renderizan APARTE (tras las plataformas y
    // los premios), así que aquí no se devuelven.
    if (!skipCarousels && carousels) return carousels;
    return skipStatusFallback ? "" : detailStatusHtml(item);
  }
  const info = `<div class="extra-info">${lines.join("")}</div>`;
  return skipCarousels ? info : `${info}${carousels}`;
}

// Normaliza el reparto por si llega en la forma vieja (array de
// strings, datos en memoria previos a la issue #294): sin foto ni
// personaje. El crew siempre es nuevo (array de objetos).
function normalizeCastPeople(cast) {
  if (!Array.isArray(cast)) return [];
  return cast
    .map((c) => (typeof c === "string" ? { name: c } : c))
    .filter((c) => c && c.name);
}

// Devuelve el HTML de los DOS CARRUSELES de elenco (issue #294):
// «Producción» (crew: director, guionista, compositor…) y «Reparto»
// (actores/actrices), cada tarjeta con foto, nombre y personaje/puesto,
// y cada carrusel con su botón «Ver en más detalle» (data-cast-role)
// que abre la ventana con TODAS las personas (js/cast-modal.js).
// Solo aplica a películas/series; libros, videojuegos e ítems sin
// elenco devuelven cadena vacía. Los botones se cablean con
// wireCastCrewClicks tras el render.
export function castCrewHtml(item) {
  if (item.type !== "movie" && item.type !== "tv") return "";
  const crew = Array.isArray(item.crew) ? item.crew.filter((c) => c && c.name) : [];
  const cast = normalizeCastPeople(item.cast);
  const sections = [];

  if (crew.length) {
    // La producción se ordena por área (mismo criterio que la ventana
    // de detalle) y por order dentro de cada área.
    const DEPT_PRIORITY = [
      "Creadores", "Dirección", "Guion", "Producción", "Sonido",
      "Cámara", "Montaje", "Arte", "Vestuario y maquillaje",
      "Iluminación", "Efectos visuales", "Efectos especiales",
      "Equipo técnico", "Interpretación",
    ];
    const deptRank = (d) => {
      const idx = DEPT_PRIORITY.indexOf(d);
      return idx === -1 ? DEPT_PRIORITY.length : idx;
    };
    const sortedCrew = [...crew].sort((a, b) => {
      const ka = deptRank(a.department);
      const kb = deptRank(b.department);
      if (ka !== kb) return ka - kb;
      return (a.order ?? 999) - (b.order ?? 999);
    });
    sections.push(castCrewSectionHtml("Producción", sortedCrew, "crew", (p) => p.job || p.department || ""));
  }

  if (cast.length) {
    const sortedCast = [...cast].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    sections.push(castCrewSectionHtml("Reparto", sortedCast, "cast", (p) => p.character || ""));
  }

  return sections.join("");
}

function castCrewSectionHtml(label, people, role, roleTextOf) {
  const cards = people
    .map(
      (p) => `
      <div class="cast-card">
        <img class="cast-card__photo" src="${escapeHtml(safePhotoUrl(p.profileUrl))}" alt="" loading="lazy" />
        <span class="cast-card__name">${escapeHtml(p.name)}</span>
        ${roleTextOf(p) ? `<span class="cast-card__role">${escapeHtml(roleTextOf(p))}</span>` : ""}
      </div>`
    )
    .join("");
  return `
    <section class="cast-crew" aria-labelledby="cast-crew-title-${role}">
      <div class="cast-crew__head">
        <h4 class="cast-crew__title" id="cast-crew-title-${role}">${escapeHtml(label)} <span class="cast-crew__count">(${people.length})</span></h4>
        <button type="button" class="btn btn--small btn--outline cast-crew__more" data-cast-role="${role}"
                aria-label="${escapeHtml(label)} en más detalle (${people.length})">
          Ver en más detalle
        </button>
      </div>
      <div class="cast-crew__scroll">
        ${cards}
      </div>
    </section>`;
}

// Desplazamiento de los carruseles de elenco. Sin snap CSS (issue #294,
// iteración 2): en táctil el impulso nativo del navegador desliza y frena
// solo. Para la rueda del ratón y el trackpad hay DOS regímenes (issue
// #305): la amplificación fija ×1.7 + el bucle de inercia hacían que en
// PC una muesca de rueda desplazara «media lista» de un golpe.
//  - MUESCA de ratón (delta grande o en líneas/páginas): avance
//    proporcionado SIN amplificar y SIN inercia: cada toque de rueda
//    mueve ~1 tarjeta y se detiene; en modo página, una pasada completa.
//  - TRACKPAD (deltas pequeños y continuos): amplificación ×1.7 e
//    inercia propia: el bucle rAF continúa el deslizamiento con fricción
//    al soltar, frenando poco a poco.
// Si el carrusel ya está en un borde y no puede avanzar en esa
// dirección, el gesto NO se consume y el scroll pasa a la página
// (comportamiento natural).
export function wireCastCrewInertialScroll(scrollEl) {
  const GAIN = 1.7; // amplificación del delta SOLO en el régimen trackpad
  const NOTCH_MIN = 40; // px: delta igual o mayor = muesca discreta de ratón
  const NOTCH_MAX = 120; // px por muesca (~1 tarjeta de 96px + gap 0.6rem)
  const FRICTION = 0.93; // deceleración por frame (~60 fps)
  const MIN_STOP = 0.05; // px/frame bajo el que la inercia se detiene
  const MIX = 0.45; // peso del impulso anterior al mezclar velocidades

  let velocity = 0;
  let rafId = null;

  const stop = () => {
    velocity = 0;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const step = () => {
    rafId = null;
    velocity *= FRICTION;
    if (Math.abs(velocity) < MIN_STOP) {
      stop();
      return;
    }
    const prev = scrollEl.scrollLeft;
    scrollEl.scrollLeft += velocity;
    if (scrollEl.scrollLeft === prev) {
      // Borde alcanzado: la inercia se corta en seco (sin rebote)
      stop();
      return;
    }
    rafId = requestAnimationFrame(step);
  };

  scrollEl.addEventListener(
    "wheel",
    (e) => {
      // Dirección efectiva del gesto y normalización a píxeles
      // (deltaMode: 0 = px, 1 = líneas, 2 = páginas)
      const toPx = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scrollEl.clientWidth : 1;
      const raw = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * toPx;
      if (Math.abs(raw) < 0.5) return;
      const max = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (max <= 0) return;
      // ¿Queda recorrido en la dirección del gesto? Si no, se deja
      // pasar el evento para que la página haga su scroll natural.
      const canScroll = raw > 0 ? scrollEl.scrollLeft < max : scrollEl.scrollLeft > 0;
      if (!canScroll) return;
      e.preventDefault();

      const magnitude = Math.abs(raw);
      const notch = e.deltaMode !== 0 || magnitude >= NOTCH_MIN;
      if (notch) {
        // MUESCA de ratón (issue #305): avance proporcionado, sin
        // amplificar y sin inercia. Un toque de rueda mueve ~1 tarjeta y
        // se detiene; en modo página (deltaMode 2), una pasada completa
        // del carrusel. stop() primero: si venía una inercia de trackpad,
        // la corta y la muesca aterriza en una posición limpia y estable.
        stop();
        const delta =
          e.deltaMode === 2
            ? Math.sign(raw) * scrollEl.clientWidth
            : Math.sign(raw) * Math.min(magnitude, NOTCH_MAX);
        scrollEl.scrollLeft = Math.max(0, Math.min(max, scrollEl.scrollLeft + delta));
        return;
      }

      // TRACKPAD (deltas pequeños y continuos): impulso inmediato
      // amplificado (avance rápido) + velocidad para la inercia
      // posterior, mezclada con la previa para suavizar las ráfagas
      // rápidas del trackpad.
      const delta = raw * GAIN;
      scrollEl.scrollLeft = Math.max(0, Math.min(max, scrollEl.scrollLeft + delta));
      velocity = velocity * MIX + delta * (1 - MIX);
      if (rafId === null) rafId = requestAnimationFrame(step);
    },
    { passive: false }
  );
}

// Cablea los botones «Ver en más detalle» de los carruseles de elenco
// (issue #294) con los datos del ítem en mano, y el desplazamiento
// inercial de los propios carruseles (iteración issue #294). Invocar
// tras cada render que incluya castCrewHtml (modal clásico, página de
// ítem, previews y ficha de amigo). Un botón sin cablear no hace nada
// (degradación silenciosa si un futuro llamador olvida el wiring). Cada
// render crea nodos nuevos, así que los listeners nunca se duplican.
export function wireCastCrewClicks(root, item) {
  if (!root) return;
  root.querySelectorAll(".cast-crew__scroll").forEach(wireCastCrewInertialScroll);
  root.querySelectorAll("[data-cast-role]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isCrew = btn.dataset.castRole === "crew";
      openCastModal({
        title: item.title || "",
        subtitle: isCrew ? "Producción" : "Reparto",
        // Normalizados como en castCrewHtml: el cast puede venir en el
        // formato viejo (array de strings, docs pre-issue #294) y el
        // crew debe filtrar entradas sin nombre (QA issue #294).
        people: isCrew
          ? (item.crew || []).filter((c) => c && c.name)
          : normalizeCastPeople(item.cast),
      });
    });
  });
}

// Estado de los detalles de ficha bajo demanda (issue #200): si el
// documento guarda solo la tarjeta (almacenamiento mínimo) y la ficha
// aún está cargando —o la red falló— se muestra una línea informativa
// en lugar de un bloque vacío (degradación elegante a «solo tarjeta»).
// Los libros conservan la sinopsis en el documento y los ítems
// manuales no tienen API que consultar: nunca aplican.
// Exportado (issue #292): el bloque hero de la página de ítem lo
// reutiliza para el hueco de sinopsis mientras cargan los detalles.
export function detailStatusHtml(item) {
  if (item._detailsFailed) {
    return `<p class="extra-info__loading">No se pudieron cargar los detalles (revisa tu conexión).</p>`;
  }
  if (!item.manual && item.externalId) {
    if ((item.type === "movie" || item.type === "tv") && !item.overview) {
      return `<p class="extra-info__loading">Cargando detalles…</p>`;
    }
    if (item.type === "game" && !item.description) {
      return `<p class="extra-info__loading">Cargando detalles…</p>`;
    }
  }
  return "";
}

// Bloque «hero» de la página de ítem (issue #292): portada grande a
// la izquierda y a la derecha el título en grande; debajo, una línea
// de meta en TEXTO NORMAL con la fecha de estreno y la duración (en
// las series, el nº de temporadas y episodios en lugar de la
// duración; iteración issue #292); debajo, pequeñas etiquetas solo
// con los géneros; debajo, la valoración de la comunidad y la propia
// del usuario (solo en la ficha: showUserRating) y el botón de
// tráiler; bajo todo ello, la sinopsis. Cada sub-bloque es opcional:
// si faltan datos (p. ej. render optimista de búsqueda sin detalles)
// la línea de meta o las etiquetas se omiten enteras y el hero queda
// con lo que haya. Exportado (issue #292): lo usan la ficha
// (openMovieModal/openTvModal en modo página) y la preview
// (paintPreview) para mostrar la misma cabecera.
export function itemHeroHtml(item, { showUserRating = true, seasonsMeta = null } = {}) {
  // Línea de meta como texto normal (iteración issue #292): la fecha
  // de estreno (o el año) y la duración ya NO son etiquetas. En las
  // series se muestra el nº de temporadas y episodios en lugar de la
  // duración; seasonsMeta llega como parámetro en la ficha (issue
  // #290: se consulta aparte) o en item.seasonsMeta en la preview.
  const metaBits = [];
  const releaseDate =
    item.type === "tv" ? item.firstAirDate || null : item.releaseDate || null;
  if (releaseDate) {
    metaBits.push(formatDateEs(releaseDate));
  } else if (item.year) {
    metaBits.push(String(item.year));
  }
  if (item.type === "tv") {
    const seasons = seasonsMeta || item.seasonsMeta || [];
    if (seasons.length) {
      const totalEpisodes = seasons.reduce((sum, s) => sum + (s.episodeCount || 0), 0);
      metaBits.push(
        `${seasons.length} temporada${seasons.length === 1 ? "" : "s"}${
          totalEpisodes ? ` · ${totalEpisodes} episodio${totalEpisodes === 1 ? "" : "s"}` : ""
        }`
      );
    } else if (item.episodeRuntime) {
      // Degradación elegante: sin temporadas (render optimista sin
      // detalles) se conserva la duración por episodio, como texto.
      metaBits.push(`~${String(item.episodeRuntime)} min/episodio`);
    }
  } else if (item.runtime) {
    metaBits.push(`${String(item.runtime)} min`);
  }
  const metaHtml = metaBits.length
    ? `<p class="item-hero__meta">${escapeHtml(metaBits.join(" · "))}</p>`
    : "";

  // Etiquetas: solo los géneros (fecha y duración son texto normal).
  const tags = [];
  if (item.genres && item.genres.length) {
    item.genres.forEach((g) => {
      tags.push(`<li class="item-hero__tag">${escapeHtml(g)}</li>`);
    });
  }
  const tagsHtml = tags.length
    ? `<ul class="item-hero__tags">${tags.join("")}</ul>`
    : "";

  let ownRatingHtml = "";
  if (showUserRating && item.rating) {
    const rated = normalizeRating(item.rating);
    if (rated) {
      const v = rated.toFixed(1).replace(".", ",");
      ownRatingHtml = `<span class="item-hero__own-rating" role="img" aria-label="Tu valoración: ${v} de 5" title="Tu valoración: ${v} de 5">${ratingStarsHtml(rated)}</span>`;
    }
  }

  const overview = item.overview || item.description;
  let synopsis = "";
  if (overview) {
    synopsis = `<p class="item-hero__synopsis">${escapeHtml(overview)}</p>`;
  } else {
    // Sin sinopsis aún (almacenamiento mínimo, issue #200): el mismo
    // aviso de carga/error que la ficha, con la tipografía del bloque.
    // detailStatusHtml devuelve un <p> propio; se extrae el texto para
    // no anidar párrafos.
    const statusLine = detailStatusHtml(item);
    if (statusLine) {
      const text = statusLine.replace(/<[^>]+>/g, "");
      synopsis = `<p class="item-hero__synopsis">${text}</p>`;
    }
  }

  return `
    <section class="item-hero" aria-label="Información del título">
      <img class="item-hero__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div class="item-hero__body">
        <h3 class="item-hero__title">${escapeHtml(item.title)}</h3>
        ${metaHtml}
        ${tagsHtml}
        <div class="item-hero__ratings">
          ${communityRatingDisplay(item)}
          ${ownRatingHtml}
          ${trailerButtonHtml(item)}
        </div>
      </div>
    </section>
    ${synopsis}
  `;
}

// Bloque de temporadas para la vista previa de una serie: lista de
// solo lectura (nº de episodios y fecha de emisión por temporada)
// más el total. Vacío si no hay datos (sin seasonsMeta o vacío).
// Exportado (issue #290): la preview de la página de ítem lo reutiliza
// para mostrar la misma información de temporadas que la ficha.
export function previewSeasonsHtml(item) {
  const seasons = item.seasonsMeta;
  if (!seasons || !seasons.length) return "";
  const rows = seasons.map((s) => {
    const name = s.name || `Temporada ${s.seasonNumber}`;
    const count = s.episodeCount || 0;
    const episodes = `${count} episodio${count === 1 ? "" : "s"}`;
    const airDate = s.airDate ? ` · ${formatDateEs(s.airDate)}` : "";
    return `<li class="preview-seasons__row">${escapeHtml(name)} · ${episodes}${airDate}</li>`;
  });
  const totalEpisodes = seasons.reduce((sum, s) => sum + (s.episodeCount || 0), 0);
  return `
    <div class="preview-seasons">
      <h4 class="preview-seasons__title">Temporadas</h4>
      <ul class="preview-seasons__list">
        ${rows.join("")}
      </ul>
      <p class="preview-seasons__total">${seasons.length} temporada${seasons.length === 1 ? "" : "s"} · ${totalEpisodes} episodio${totalEpisodes === 1 ? "" : "s"}</p>
    </div>
  `;
}

// Línea de páginas de un libro para la vista previa. item.pages llega
// como número desde la API (pageCount || null); vacío si no existe.
function previewPagesHtml(item) {
  if (!item.pages) return "";
  return `<p class="extra-info__line"><strong>Páginas:</strong> ${item.pages}</p>`;
}

function editButtonHtml() {
  return `<button type="button" class="btn btn--small btn--outline edit-info-btn" id="btn-edit-item">✎ Editar información</button>`;
}

/* ---------- Alta / edición de información básica ---------- */

function itemFormFields(type, values) {
  const isBook = type === "book";
  return `
    <div class="field-group">
      <label for="form-title">Título *</label>
      <input type="text" id="form-title" required value="${escapeHtml(values.title || "")}" />
    </div>
    ${
      isBook
        ? `<div class="field-group">
            <label for="form-author">Autor</label>
            <input type="text" id="form-author" value="${escapeHtml(values.author || "")}" />
          </div>`
        : ""
    }
    <div class="field-group">
      <label for="form-year">Año</label>
      <input type="number" id="form-year" min="0" max="2100" value="${escapeHtml(values.year || "")}" />
    </div>
    ${
      isBook
        ? `<div class="field-group">
            <label for="form-pages">Páginas</label>
            <input type="number" id="form-pages" min="0" value="${values.pages || ""}" />
          </div>`
        : ""
    }
    <div class="field-group">
      <label for="form-cover">URL de portada (opcional)</label>
      <input type="url" id="form-cover" placeholder="https://..." value="${escapeHtml(values.coverUrl || "")}" />
    </div>
  `;
}

export function openEditModal(item, { onSave, onCancel }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:1rem">Editar información</h3>
    <form id="edit-form" class="manual-form">
      ${itemFormFields(item.type, item)}
      <div class="modal-actions">
        <button type="button" class="btn btn--outline" id="btn-edit-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar cambios</button>
      </div>
    </form>
  `;

  content.querySelector("#edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = content.querySelector("#form-title").value.trim();
    if (!title) return;
    const changes = {
      title,
      year: content.querySelector("#form-year").value || "",
      coverUrl: content.querySelector("#form-cover").value.trim() || null,
    };
    if (item.type === "book") {
      changes.author = content.querySelector("#form-author").value.trim();
      const pagesRaw = content.querySelector("#form-pages").value;
      changes.pages = pagesRaw ? Number(pagesRaw) : null;
    }
    onSave(changes);
  });

  content.querySelector("#btn-edit-cancel").addEventListener("click", onCancel);

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

export function openManualAddModal(type, onSubmit) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const titleText =
    type === "book"
      ? "Añadir libro manualmente"
      : type === "tv"
      ? "Añadir serie manualmente"
      : type === "game"
      ? "Añadir videojuego manualmente"
      : "Añadir película manualmente";

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:1rem">${titleText}</h3>
    <form id="manual-form" class="manual-form">
      ${itemFormFields(type, {})}
      ${
        type === "tv"
          ? `<div class="field-group">
              <label for="manual-episodes">Número de episodios</label>
              <input type="number" id="manual-episodes" min="1" value="10" />
            </div>
            <p class="log-empty">
              Se asume una sola temporada con ese número de episodios.
            </p>`
          : ""
      }
      <div class="modal-actions">
        <button type="button" class="btn btn--outline" id="btn-manual-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Añadir</button>
      </div>
    </form>
  `;

  content.querySelector("#manual-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = content.querySelector("#form-title").value.trim();
    if (!title) return;

    const draft = {
      title,
      year: content.querySelector("#form-year").value || "",
      coverUrl: content.querySelector("#form-cover").value.trim() || null,
    };
    if (type === "book") {
      draft.author = content.querySelector("#form-author").value.trim();
      const pagesRaw = content.querySelector("#form-pages").value;
      draft.pages = pagesRaw ? Number(pagesRaw) : null;
    }
    if (type === "tv") {
      draft.episodeCount = Number(content.querySelector("#manual-episodes").value) || 1;
    }
    onSubmit(draft);
  });

  content.querySelector("#btn-manual-cancel").addEventListener("click", closeModal);

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Plataformas de streaming (watch providers) ---------- */

function providersGroupHtml(providers, label) {
  if (!providers || !providers.length) return "";
  return `
    <div class="watch-providers__group">
      <span class="watch-providers__type-label">${label}</span>
      <div class="watch-providers__logos">
        ${providers
          .map(
            (p) => `
          <span class="watch-provider" title="${escapeHtml(p.providerName)}">
            ${p.logoUrl
              ? `<img class="watch-provider__logo" src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.providerName)}" loading="lazy" />`
              : ""
            }
            <span class="watch-provider__name">${escapeHtml(p.providerName)}</span>
          </span>`
          )
          .join("")}
      </div>
    </div>`;
}

// Plataformas de streaming (dónde ver el título). Devuelve cadena
// vacía si no hay datos. Exportado (issue #290): la preview de la
// página de ítem lo reutiliza para mostrar la misma información que
// la ficha.
export function watchProvidersHtml(item) {
  const wp = item.watchProviders;
  if (!wp) return "";
  const hasAny = (wp.flatrate && wp.flatrate.length) ||
                 (wp.rent && wp.rent.length) ||
                 (wp.buy && wp.buy.length);
  if (!hasAny) {
    return `<div class="watch-providers watch-providers--empty">
      <span class="watch-providers__title">Sin info. de streaming para este país</span>
    </div>`;
  }
  return `
    <div class="watch-providers">
      <span class="watch-providers__title">Disponible en:</span>
      ${providersGroupHtml(wp.flatrate, "Streaming")}
      ${providersGroupHtml(wp.rent, "Alquiler")}
      ${providersGroupHtml(wp.buy, "Compra")}
      ${wp.link ? `<a class="watch-providers__link" href="${escapeHtml(wp.link)}" target="_blank" rel="noopener">Ver opciones en TMDB</a>` : ""}
    </div>`;
}

/* ---------- Premios de películas/series (issue #302) ---------- */

// Sección «Premios» de la ficha de películas y series (issue #302,
// iteración): lista de SOLO LECTURA con los premios y nominaciones
// del título, extraídos automáticamente de Wikidata (getItemAwards,
// api-movies.js — TMDB no expone premios en su API pública). Cada
// grupo ({ group, entries }) es una familia de premios (Óscar,
// Globos de Oro, Emmy…) y sus entradas son { kind, name, year?,
// detail?, people }:
//   - kind: "award" (premio ganado, P166) o "nom" (nominación,
//     P1411), diferenciados con una etiqueta.
//   - name: nombre del premio (p. ej. «Óscar al mejor actor de
//     reparto»), year: año de la ceremonia, detail: en su caso el
//     trabajo por el que se concedió (p. ej. el episodio premiado
//     de una serie) y people: los implicados (ganador P1346 o
//     nominados P2453, p. ej. el actor de un premio de reparto).
// Cada familia se pinta como un <details> minimizable que arranca
// CERRADO (sin atributo open), y la sección entera es también un
// <details> cuya cabecera «Premios (N)» permite minimizarla toda de
// una vez (issue #302, iteración 3: «Por defecto, cada premio debe
// estar minimizado y la sección entera de Premios también»). Mismo
// patrón nativo sin JS que .watch-log-details/.rewatch-history.
//
// La sección solo se pinta cuando el ítem tiene premios (la ausencia
// de datos no ocupa espacio en la ficha, mismo criterio que el bloque
// «Dónde verla»). No hay formulario ni botones: es información de la
// API, no un dato del usuario. Devuelve cadena vacía para los otros
// tipos (libros/videojuegos).
export function awardsHtml(item) {
  if (item.type !== "movie" && item.type !== "tv") return "";
  const groups = Array.isArray(item.awards) ? item.awards : [];
  if (!groups.length) return "";

  const allEntries = groups.flatMap((g) => g.entries);

  const groupsHtml = groups
    .map(
      (g) => `
      <details class="awards__group">
        <summary class="awards__group-head">
          <span class="awards__group-name">${escapeHtml(g.group || "")}</span>
          <span class="awards__group-count">${awardsCountText(g.entries)}</span>
        </summary>
        <ul class="awards__list">
          ${g.entries.map(awardRowHtml).join("")}
        </ul>
      </details>`
    )
    .join("");

  return `
    <details class="awards">
      <summary class="awards__head">
        <span class="awards__title">Premios</span>
        <span class="awards__count">${awardsCountText(allEntries)}</span>
      </summary>
      <div class="awards__groups">${groupsHtml}</div>
    </details>`;
}

// Contador de una lista de entradas separando premios (P166) de
// nominaciones (P1411), en lugar del total único combinado (issue
// #302, iteración 4: «Debería separar premios de nominaciones»).
// Se omite el cero inútil («0 nominaciones») y se usa el singular o
// plural correcto: «1 premio», «2 premios», «1 nominación», «3
// nominaciones». Devuelve "" solo si la lista no trae entradas (no
// llegaría a pintarse: la sección no se muestra sin premios).
function awardsCountText(entries) {
  const awards = entries.filter((e) => e.kind === "award").length;
  const noms = entries.length - awards;
  const parts = [];
  if (awards) parts.push(`${awards} ${awards === 1 ? "premio" : "premios"}`);
  if (noms) parts.push(`${noms} ${noms === 1 ? "nominación" : "nominaciones"}`);
  return parts.length ? `(${parts.join(", ")})` : "";
}

// Fila de un premio o nominación: etiqueta distintiva («Premio» /
// «Nominación»), nombre, año, trabajo (detalle) e implicados. La
// etiqueta ya distingue premios de nominaciones, por eso los
// implicados se muestran SOLO con sus nombres, sin el prefijo
// «Ganador:»/«Nominado(s):» (issue #302, iteración 4: «eliminar
// ganador/es y nominado/s y dejar simplemente el nombre de las
// personas»). Todo el contenido se escapa con escapeHtml.
function awardRowHtml(e) {
  const badge =
    e.kind === "award"
      ? `<span class="awards__badge awards__badge--award">Premio</span>`
      : `<span class="awards__badge awards__badge--nom">Nominación</span>`;
  const people =
    e.people && e.people.length
      ? `<span class="awards__people">${e.people.map(escapeHtml).join(", ")}</span>`
      : "";
  return `
      <li class="awards__row">
        ${badge}
        <span class="awards__name">${escapeHtml(e.name || "")}</span>
        ${e.year ? `<span class="awards__year">${escapeHtml(e.year)}</span>` : ""}
        ${e.detail ? `<span class="awards__detail">Por: ${escapeHtml(e.detail)}</span>` : ""}
        ${people}
      </li>`;
}

// Chips con las plataformas jugables de un videojuego (IGDB), para
// que se vean como etiquetas y no como texto plano. Devuelve cadena
// vacía si no hay plataformas (no ocupa espacio en el modal).
function gamePlatformsHtml(item) {
  if (!item.platforms || !item.platforms.length) return "";
  return `
    <div class="game-platforms">
      <span class="game-platforms__title">Plataformas:</span>
      <ul class="game-platforms__list">
        ${item.platforms
          .map((p) => `<li class="game-platform">${escapeHtml(p)}</li>`)
          .join("")}
      </ul>
    </div>`;
}

/* ---------- Recomendaciones (contenido similar) ---------- */

/**
 * Genera el HTML de la sección de recomendaciones.
 * @param {Array}  items       - Items recomendados [{externalId, type, title, year, coverUrl}]
 * @param {Set}    existingIds - Set de externalId ya añadidos para deshabilitar botones
 * @param {string} group       - "movie" o "tv" (para clases de botón)
 * @param {boolean} interactive - true si se deben mostrar botones "Añadir"
 * @param {Function} [onOpen]  - si es función, cada tarjeta pasa a ser
 *                               un botón pulsable que llama onOpen(rec)
 *                               para abrir la vista previa ampliada de
 *                               esa recomendación antes de añadirla
 *                               (issue #280, iteración)
 * @returns {string} HTML del bloque de recomendaciones, o cadena vacía
 */
export function renderRecommendations(items, existingIds, group, interactive, onOpen) {
  if (!items || !items.length) return "";
  const accentClass = "btn--accent-media";
  const cardsHtml = items
    .map((rec, index) => {
      const added = existingIds.has(rec.externalId);
      const btnHtml = interactive
        ? `<button class="btn btn--small ${accentClass} rec-card__add" data-rec-index="${index}" ${added ? "disabled" : ""}>
             ${added ? "Añadido" : "Añadir"}
           </button>`
        : "";
      if (typeof onOpen === "function") {
        // Tarjeta pulsable (issue #280, iteración): misma mecánica que
        // las tarjetas de saga — el botón .rec-card__open envuelve
        // portada y texto (phrasing content, por eso .rec-card__body es
        // span), y el botón "Añadir" queda como hermano, anclado abajo
        // por el flex: 1 del botón open.
        return `
        <div class="rec-card rec-card--openable" data-rec-index="${index}">
          <button type="button" class="rec-card__open" data-rec-index="${index}"
                  aria-label="Ver información de ${escapeHtml(rec.title)}">
            <img class="rec-card__cover" src="${rec.coverUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
            <span class="rec-card__body">
              <span class="rec-card__title">${escapeHtml(rec.title)}</span>
              <span class="rec-card__year">${escapeHtml(rec.year || "")}</span>
              <span class="rec-card__hint">Ver información</span>
            </span>
          </button>
          ${btnHtml}
        </div>`;
      }
      return `
        <div class="rec-card" data-rec-index="${index}">
          <img class="rec-card__cover" src="${rec.coverUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
          <div class="rec-card__body">
            <div class="rec-card__title">${escapeHtml(rec.title)}</div>
            <div class="rec-card__year">${escapeHtml(rec.year || "")}</div>
            ${btnHtml}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="recommendations">
      <h4 class="recommendations__title">Si te gustó esto, quizá te guste...</h4>
      <div class="recommendations__scroll">
        ${cardsHtml}
      </div>
    </div>`;
}

/**
 * Genera el HTML de la sección «Otras películas de la saga» (issue
 * #280): las películas de la colección/saga a la que pertenece el
 * ítem abierto, en tarjetas con el mismo aspecto que las
 * recomendaciones. Reutiliza las clases de tarjeta de
 * renderRecommendations (.rec-card, .recommendations__scroll); el
 * botón usa .saga-card__add (clase propia, distinta de
 * .rec-card__add, para no interferir con el wiring de
 * recomendaciones).
 * @param {Array}  sagaParts   - [{externalId, title, year, posterUrl}]
 * @param {Set}    existingIds - Set de externalId ya añadidos
 * @param {boolean} interactive - true si se muestran botones "Añadir"
 * @param {Function} [onOpen]  - si es función, cada tarjeta pasa a ser
 *                               un botón pulsable que llama onOpen(movie)
 *                               para abrir la página de detalle de esa
 *                               película (issue #285)
 * @returns {string} HTML de la sección, o cadena vacía
 */
export function renderSagaMovies(sagaParts, existingIds, interactive, onOpen) {
  if (!sagaParts || !sagaParts.length) return "";
  const cardsHtml = sagaParts
    .map((m, index) => {
      const added = existingIds.has(String(m.externalId));
      const btnHtml = interactive
        ? `<button class="btn btn--small btn--accent-media saga-card__add" data-saga-index="${index}" ${added ? "disabled" : ""}>
             ${added ? "Añadida" : "Añadir"}
           </button>`
        : "";
      if (typeof onOpen === "function") {
        // Tarjeta pulsable: el botón .saga-card__open envuelve portada
        // y texto (phrasing content, por eso .rec-card__body es span),
        // y el botón "Añadir" queda como hermano, anclado abajo por
        // el flex: 1 del botón open (issue #280, iteración).
        return `
        <div class="rec-card saga-card" data-saga-index="${index}">
          <button type="button" class="saga-card__open" data-saga-index="${index}"
                  aria-label="Ver información de ${escapeHtml(m.title)}">
            <img class="rec-card__cover" src="${m.posterUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
            <span class="rec-card__body">
              <span class="rec-card__title">${escapeHtml(m.title)}</span>
              <span class="rec-card__year">${escapeHtml(m.year || "")}</span>
              <span class="saga-card__hint">Ver información</span>
            </span>
          </button>
          ${btnHtml}
        </div>`;
      }
      return `
        <div class="rec-card saga-card" data-saga-index="${index}">
          <img class="rec-card__cover" src="${m.posterUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
          <div class="rec-card__body">
            <div class="rec-card__title">${escapeHtml(m.title)}</div>
            <div class="rec-card__year">${escapeHtml(m.year || "")}</div>
            ${btnHtml}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="saga-movies">
      <h4 class="saga-movies__title">Otras películas de la saga</h4>
      <div class="recommendations__scroll">
        ${cardsHtml}
      </div>
    </div>`;
}

/* ---------- Modal de detalle: películas ---------- */

function renderWatchLogRows(watchLog) {
  if (!watchLog || !watchLog.length) {
    return `<p class="log-empty">Aún no la has visto.</p>`;
  }
  return `<div class="log-list">
    ${watchLog
      .map(
        (date, index) => `
        <div class="log-row">
          <input type="date" class="watch-date" data-index="${index}" value="${date}" />
          <button type="button" class="btn btn--small btn--danger watch-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openMovieModal(item, callbacks, recommendations = [], existingIds = new Set(), sagaParts = null, { target = null } = {}) {
  const { onUpdateWatch, onRemoveWatch, onAddRecommendation, onAddSagaMovie, onOpenSagaMovie, onOpenRecommendation } = callbacks;
  const modal = document.getElementById("item-modal");
  // Modo página (issue #285): con target (contenedor de #item-view) la
  // ficha se renderiza en la página y no se abre el modal ni su focus
  // trap; sin target, comportamiento clásico sobre #modal-content.
  const content = target || document.getElementById("modal-content");
  const metaLine = [typeLabel(item.type), item.year].filter(Boolean).join(" · ");

  // Cabecera (issue #292): en modo página la ficha usa el bloque hero
  // (portada grande + título, etiquetas, valoraciones, tráiler y
  // sinopsis) directamente sobre el fondo; en el modal clásico se
  // conserva la cabecera de siempre.
  const headerHtml = target
    ? itemHeroHtml(item)
    : `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>`;
  // En modo página la valoración de la comunidad y el tráiler ya viven
  // en el hero; en el modal clásico se muestran como bloques propios.
  const ratingsHtml = target ? "" : `${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}`;
  // En modo página la duración, géneros y sinopsis ya viven en el hero
  // (y su línea de carga/error, que no debe duplicarse aquí).
  const infoHtml = target
    ? extraInfoHtml(item, { skipMetaBits: true, skipOverview: true, skipStatusFallback: true, skipCarousels: true })
    : extraInfoHtml(item, { skipCarousels: true });

  // Orden de secciones (issue #302, iteración): las plataformas
  // vuelven a estar bajo la sinopsis y encima de la producción (su
  // posición original), y la sección de premios queda justo debajo de
  // las plataformas. Los carruseles de producción/reparto (issue
  // #294) van después, como cierre del bloque de información.
  content.innerHTML = `
    ${headerHtml}

    ${upcomingBadge(item)}
    ${ratingsHtml}
    ${infoHtml}
    ${watchProvidersHtml(item)}
    ${awardsHtml(item)}
    ${castCrewHtml(item)}

    ${item.collectionId ? renderSagaMovies(sagaParts, existingIds, !!onAddSagaMovie, onOpenSagaMovie) : ""}

    ${renderRecommendations(recommendations, existingIds, "movie", !!onAddRecommendation, onOpenRecommendation)}

    ${
      // Visionados (issue #300): ocultos por defecto y sin botón de
      // añadir — «Marcar como vista»/«Añadir otro visionado» viven en
      // el botón flotante (issue #298). Solo se muestran cuando hay
      // historial (con un ítem sin ver el FAB ya comunica el estado).
      item.watchLog && item.watchLog.length
        ? `<details class="watch-log-details">
            <summary>Visionados (${item.watchLog.length})</summary>
            ${renderWatchLogRows(item.watchLog)}
          </details>`
        : ""
    }
  `;

  // Propaga todos los argumentos en el re-render (issue #280): tras
  // marcar como vista, la sección de saga (y las recomendaciones)
  // permanece, y el botón "Añadida" se mantiene gracias al Set
  // existingIds compartido. El target se propaga para que la ficha
  // vuelva a pintarse en la página en modo página (issue #285).
  const rerender = () => openMovieModal(item, callbacks, recommendations, existingIds, sagaParts, { target });

  // Carruseles de elenco (issue #294): cablear los botones «Ver en más
  // detalle» de producción/reparto con los datos de este ítem.
  wireCastCrewClicks(content, item);

  // Wire recommendation "Añadir" buttons
  if (onAddRecommendation) {
    content.querySelectorAll(".rec-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onAddRecommendation(recItem, btn);
      });
    });
  }

  // Wire saga "Añadir" buttons (issue #280). Clase propia
  // .saga-card__add para no interferir con las recomendaciones.
  if (onAddSagaMovie) {
    content.querySelectorAll(".saga-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.sagaIndex);
        const movie = sagaParts[index];
        if (movie) onAddSagaMovie(movie, btn);
      });
    });
  }

  // Wire saga card open preview (issue #280, iteración): pulsar la
  // tarjeta muestra la información de la película antes de añadirla.
  if (onOpenSagaMovie) {
    content.querySelectorAll(".saga-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.sagaIndex);
        const movie = sagaParts[index];
        if (movie) onOpenSagaMovie(movie);
      });
    });
  }

  // Wire recommendation card open preview (issue #280, iteración):
  // pulsar la tarjeta de recomendación también muestra la información
  // ampliada antes de añadirla, igual que las tarjetas de saga.
  if (onOpenRecommendation) {
    content.querySelectorAll(".rec-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onOpenRecommendation(recItem);
      });
    });
  }

  content.querySelectorAll(".watch-date").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateWatch(Number(input.dataset.index), input.value);
      rerender();
    });
  });

  content.querySelectorAll(".watch-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar este visionado del historial?")) return;
      await onRemoveWatch(Number(btn.dataset.index));
      rerender();
    });
  });

  // En modo página no se abre el modal ni se atrapa el foco: el
  // contenido ya vive en el documento (#item-view-content). Se enfoca
  // el título de la ficha (patrón de foco de las rutas de Ocio); el
  // re-render posterior a una acción recupera el foco al título.
  if (target) {
    const title = target.querySelector(".item-hero__title");
    if (title) {
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
    return;
  }

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Modal de detalle: libros ---------- */

function renderReadLogRows(readLog) {
  if (!readLog || !readLog.length) {
    return `<p class="log-empty">Aún no has empezado a leerlo.</p>`;
  }
  return `<div class="log-list">
    ${readLog
      .map(
        (entry, index) => `
        <div class="log-row">
          <input type="date" class="read-start" data-index="${index}" value="${entry.startedAt}" />
          <span class="log-row__arrow">→</span>
          ${
            entry.finishedAt
              ? `<input type="date" class="read-finish" data-index="${index}" value="${entry.finishedAt}" />`
              : `<span class="log-row__reading">leyendo</span>`
          }
          <button type="button" class="btn btn--small btn--danger read-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

// Historial de sesiones de juego de un videojuego (espejo del de
// lecturas, con su propia semántica; issue #47).
function renderPlayLogRows(playLog) {
  if (!playLog || !playLog.length) {
    return `<p class="log-empty">Aún no has empezado a jugarlo.</p>`;
  }
  return `<div class="log-list">
    ${playLog
      .map(
        (entry, index) => `
        <div class="log-row">
          <input type="date" class="play-start" data-index="${index}" value="${entry.startedAt}" />
          <span class="log-row__arrow">→</span>
          ${
            entry.finishedAt
              ? `<input type="date" class="play-finish" data-index="${index}" value="${entry.finishedAt}" />`
              : `<span class="log-row__playing">jugando</span>`
          }
          <input type="number" class="play-hours" data-index="${index}" value="${entry.hours ?? ""}" min="0" step="0.5" placeholder="h" aria-label="Horas" />
          <button type="button" class="btn btn--small btn--danger play-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openBookModal(item, callbacks) {
  const {
    onStartReading,
    onFinishReading,
    onUpdateEntry,
    onRemoveEntry,
    onSetStatus,
    onSaveMeta,
    onDelete,
    onEdit,
  } = callbacks;
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [item.author, item.year].filter(Boolean).join(" · ");
  const isReading =
    item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editButtonHtml()}

    ${extraInfoHtml(item)}

    ${renderStandbyBanner(item.status, item.progress ? `página ${item.progress}` : "")}
    ${renderStatusActions(item.status)}

    <div class="field-group">
      <label>Lecturas</label>
      ${renderReadLogRows(item.readLog)}
      <div class="log-add-row">
        <input type="date" id="field-log-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-books" id="btn-log-action">
          ${isReading ? "Terminar de leer" : "Empezar a leer"}
        </button>
      </div>
    </div>

    <div class="field-group">
      <label for="field-progress">Página actual</label>
      <input type="number" min="0" id="field-progress" value="${item.progress ?? ""}" />
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  const rerender = () => openBookModal(item, callbacks);

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  content.querySelector("#btn-log-action").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-log-date").value;
    if (!dateVal) return;
    if (isReading) await onFinishReading(dateVal);
    else await onStartReading(dateVal);
    rerender();
  });

  content.querySelectorAll(".read-start").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { startedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-finish").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { finishedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar esta lectura del historial?")) return;
      await onRemoveEntry(Number(btn.dataset.index));
      rerender();
    });
  });

  wireStatusActions(content, async (newStatusOrNull) => {
    await onSetStatus(newStatusOrNull);
    rerender();
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    const raw = content.querySelector("#field-progress").value;
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
      progress: raw === "" ? null : Number(raw),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Modal de detalle: videojuegos (sesiones de juego) ---------- */

export function openGameModal(item, callbacks) {
  const {
    onStartPlay,
    onFinishPlay,
    onUpdateEntry,
    onRemoveEntry,
    onSetStatus,
    onSaveMeta,
    onDelete,
    onEdit,
  } = callbacks;
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
  const isPlaying =
    item.playLog && item.playLog.length && !item.playLog[item.playLog.length - 1].finishedAt;

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editButtonHtml()}

    ${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}
    ${gamePlatformsHtml(item)}
    ${extraInfoHtml(item)}

    ${renderStandbyBanner(item.status, "", "Abandonado")}
    ${renderStatusActions(item.status)}

    <div class="field-group">
      <label>Sesiones de juego</label>
      ${renderPlayLogRows(item.playLog)}
      <div class="log-add-row">
        <input type="date" id="field-log-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-games" id="btn-log-action">
          ${isPlaying ? "Terminar partida" : "Empezar partida"}
        </button>
      </div>
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  const rerender = () => openGameModal(item, callbacks);

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  content.querySelector("#btn-log-action").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-log-date").value;
    if (!dateVal) return;
    if (isPlaying) await onFinishPlay(dateVal);
    else await onStartPlay(dateVal);
    rerender();
  });

  content.querySelectorAll(".play-start").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { startedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".play-finish").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { finishedAt: input.value });
      rerender();
    });
  });

  // Horas de una sesión: vacío se persiste como null (nunca undefined,
  // Firestore lanza con updateDoc), valores inválidos se ignoran y el
  // resto se redondea a 1 decimal (issue #174).
  content.querySelectorAll(".play-hours").forEach((input) => {
    input.addEventListener("change", async () => {
      const value = input.value;
      if (value === "") {
        await onUpdateEntry(Number(input.dataset.index), { hours: null });
        rerender();
        return;
      }
      const h = Number(value);
      if (!Number.isFinite(h) || h < 0) return;
      const rounded = Math.round(h * 10) / 10;
      await onUpdateEntry(Number(input.dataset.index), { hours: rounded });
      rerender();
    });
  });

  content.querySelectorAll(".play-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar esta sesión del historial?")) return;
      await onRemoveEntry(Number(btn.dataset.index));
      rerender();
    });
  });

  wireStatusActions(content, async (newStatusOrNull) => {
    await onSetStatus(newStatusOrNull);
    rerender();
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Modal de detalle: series (temporadas y episodios) ---------- */

// Sincroniza el estado VISUAL de una fila de episodio con su entrada
// real (normalizada o null) en item.watched: checkbox, clase is-watched,
// fecha, fila 2 (meta), contador y estrellas (issue #133/#136).
function applyEpisodeRowState(row, entry) {
  const checked = Boolean(entry && entry.date);
  const times = checked ? Math.max(1, Number(entry.times) || 1) : 0;
  const checkbox = row.querySelector(".episode-checkbox");
  const visual = row.querySelector(".episode-checkbox-visual");
  const dateInput = row.querySelector(".episode-date");
  const meta = row.querySelector(".episode-row__meta");
  const ratingWrap = row.querySelector(".episode-rating");
  checkbox.checked = checked;
  row.classList.toggle("is-watched", checked);
  dateInput.disabled = !checked;
  dateInput.value = checked ? entry.date : "";
  meta.classList.toggle("hidden", !checked);
  if (times > 1) visual.setAttribute("data-count", String(times));
  else visual.removeAttribute("data-count");
  ratingWrap.querySelectorAll(".episode-rating__star").forEach((s) => {
    const n = Number(s.dataset.value);
    const value = normalizeRating(checked ? entry.rating : 0);
    const full = value >= n;
    const half = value === n - 0.5;
    s.classList.toggle("is-active", full && !half);
    s.classList.toggle("is-half", half);
    s.textContent = half ? "½" : "★";
    s.setAttribute(
      "aria-label",
      half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
    );
  });
}

function renderSeasonBlock(s, watched) {
  const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
  const watchedCount = Object.keys(seasonWatched).length;
  const allWatched = watchedCount >= s.episodeCount && s.episodeCount > 0;
  return `
    <div class="season-block" data-season="${s.seasonNumber}" data-episode-count="${s.episodeCount}">
      <div class="season-header">
        <button class="season-toggle" data-season="${s.seasonNumber}">
          <span class="season-chevron">▸</span>
          <span class="season-name">${escapeHtml(s.name)}</span>
          <span class="season-count">${watchedCount}/${s.episodeCount}</span>
        </button>
        <button class="btn btn--small season-mark-all" data-season="${s.seasonNumber}"
                data-all-watched="${allWatched ? "0" : "1"}">
          ${allWatched ? "Desmarcar todo" : "Marcar todo"}
        </button>
      </div>
      <div class="season-episodes hidden" data-season-episodes="${s.seasonNumber}"></div>
    </div>`;
}

// manual=true (series manuales): no se marcan episodios como "sin
// estrenar" porque no tienen fechas reales de TMDB.
function renderEpisodeRows(episodes, seasonWatched, { manual = false } = {}) {
  return episodes
    .map((e) => {
      const entry = normalizeEntry(seasonWatched[String(e.episodeNumber)]);
      const date = entry ? entry.date : "";
      const rating = entry ? entry.rating : null;
      const checked = Boolean(date);
      const times = checked ? Math.max(1, Number(entry.times) || 1) : 0;
      const future = !manual && isUnreleasedDate(e.airDate);
      // Badge de nota TMDB: solo en series automáticas y cuando el episodio
      // tiene votos (episodeRating != null). Las series manuales no lo traen.
      const communityBadge =
        !manual && e.episodeRating != null
          ? communityRatingValueHtml(e.episodeRating)
          : "";
      return `
      <div class="episode-row ${checked ? "is-watched" : ""}" data-episode="${e.episodeNumber}"
           data-air-date="${e.airDate || ""}" data-episode-name="${escapeHtml(e.name)}">
        <div class="episode-row__main">
          <label class="episode-checkbox-wrap">
            <input type="checkbox" class="episode-checkbox" ${checked ? "checked" : ""}
                   aria-label="${
                     checked
                       ? `E${e.episodeNumber} — ${escapeHtml(e.name)}: visto ${times} ${times === 1 ? "vez" : "veces"}. Pulsa para verlo de nuevo o desmarcarlo`
                       : `Marcar E${e.episodeNumber} — ${escapeHtml(e.name)} como visto`
                   }" />
            <span class="episode-checkbox-visual" aria-hidden="true"
                  ${times > 1 ? `data-count="${times}"` : ""}></span>
          </label>
          <span class="episode-row__num" aria-hidden="true">E${e.episodeNumber}</span>
          <span class="episode-row__name">${escapeHtml(e.name)}${
        future
          ? ` <em class="episode-row__future">${
              e.airDate ? `(sin estrenar · ${formatDateEs(e.airDate)})` : "(sin estrenar)"
            }</em>`
          : ""
      }</span>
          ${communityBadge}
        </div>
        <div class="episode-row__meta ${checked ? "" : "hidden"}">
          <div class="episode-rating">
            ${[1, 2, 3, 4, 5]
              .map((n) => {
                const value = normalizeRating(rating);
                const full = value >= n;
                const half = value === n - 0.5;
                return `<button type="button" class="episode-rating__star ${
                  full ? "is-active" : ""
                }${half ? " is-half" : ""}" data-value="${n}" aria-label="${
                  half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
                }">${half ? "½" : "★"}</button>`;
              })
              .join("")}
          </div>
          <input type="date" class="episode-date" value="${date}" ${checked ? "" : "disabled"} />
        </div>
      </div>`;
    })
    .join("");
}

export function openTvModal(item, seasonsMeta, progress, callbacks, recommendations = [], existingIds = new Set(), { target = null } = {}) {
  const {
    onExpandSeason,
    onSetEpisodeDate,
    onSetEpisodeSeenAgain,
    onSetEpisodeRating,
    onToggleSeason,
    onRewatch,
    onSetStatus,
    onAddRecommendation,
    onUpdateNextEpisodeAirDate,
    onOpenRecommendation,
  } = callbacks;

  const modal = document.getElementById("item-modal");
  // Modo página (issue #285): ver openMovieModal.
  const content = target || document.getElementById("modal-content");

  const nextLine = progress.nextEpisode
    ? `Siguiente: T${progress.nextEpisode.season}E${progress.nextEpisode.episode}`
    : "¡Serie completada!";
  const pct = progress.totalEpisodes
    ? Math.round((progress.totalWatched / progress.totalEpisodes) * 100)
    : 0;
  const times = (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0);

  // Cabecera (issue #292): en modo página la ficha usa el bloque hero
  // (portada grande + título, meta y etiquetas, valoraciones, tráiler
  // y sinopsis) directamente sobre el fondo; en el modal clásico se
  // conserva la cabecera de siempre. seasonsMeta (issue #292,
  // iteración): las series muestran el nº de temporadas y episodios
  // en lugar de la duración, y llega consultado aparte (issue #290).
  const headerHtml = target
    ? itemHeroHtml(item, { showUserRating: true, seasonsMeta })
    : `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(item.year || "")}</div>
      </div>
    </div>`;
  // En modo página la valoración de la comunidad y el tráiler ya viven
  // en el hero; en el modal clásico se muestran como bloques propios.
  const ratingsHtml = target ? "" : `${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}`;
  // En modo página la duración, géneros y sinopsis ya viven en el hero
  // (y su línea de carga/error, que no debe duplicarse aquí).
  const infoHtml = target
    ? extraInfoHtml(item, { skipMetaBits: true, skipOverview: true, skipStatusFallback: true, skipCarousels: true })
    : extraInfoHtml(item, { skipCarousels: true });

  // Orden de secciones (issue #302, iteración): mismo criterio que la
  // ficha de película — plataformas bajo la sinopsis y encima de la
  // producción, y la sección de premios justo debajo de las plataformas.
  content.innerHTML = `
    ${headerHtml}

    ${upcomingBadge(item)}
    ${ratingsHtml}
    ${infoHtml}
    ${watchProvidersHtml(item)}
    ${awardsHtml(item)}
    ${castCrewHtml(item)}

    ${renderRecommendations(recommendations, existingIds, "tv", !!onAddRecommendation, onOpenRecommendation)}

    <div class="progress-banner">
      <span class="next-line">${nextLine}</span>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-count">${progress.totalWatched}/${progress.totalEpisodes} episodios</span>
    </div>

    ${renderStandbyBanner(item.status, `${progress.totalWatched}/${progress.totalEpisodes} episodios vistos`)}
    ${renderStatusActions(item.status)}

    ${
      item.status === "completado"
        ? `<div class="completion-banner">
            <p>Has terminado esta serie${times > 1 ? ` (visionado nº ${times})` : ""}.</p>
            <p class="completion-dates">
              Empezada: ${formatDateEs(item.firstWatchedAt)} · Terminada: ${formatDateEs(item.lastWatchedAt)}
            </p>
            <button type="button" class="btn btn--accent-media btn--small" id="btn-rewatch">
              Volver a verla desde el principio
            </button>
          </div>`
        : ""
    }

    ${
      item.history && item.history.length
        ? `<details class="rewatch-history">
            <summary>Visionados anteriores (${item.history.length})</summary>
            <ul>
              ${item.history
                .map(
                  (h) =>
                    `<li>${formatDateEs(h.startedAt)} → ${formatDateEs(h.finishedAt)}</li>`
                )
                .join("")}
            </ul>
          </details>`
        : ""
    }

    <div class="seasons-list">
      ${seasonsMeta.map((s) => renderSeasonBlock(s, item.watched)).join("")}
    </div>

    ${
      // Media de episodios (issue #80) como línea informativa: la
      // valoración general se hace con el botón flotante (issue
      // #298/#300) y el picker ya no vive en la ficha.
      episodeAverageHtml(item.watched, "field-rating")
    }
  `;

  function updateBanner(newProgress) {
    const line = newProgress.nextEpisode
      ? `Siguiente: T${newProgress.nextEpisode.season}E${newProgress.nextEpisode.episode}`
      : "¡Serie completada!";
    content.querySelector(".next-line").textContent = line;
    const newPct = newProgress.totalEpisodes
      ? Math.round((newProgress.totalWatched / newProgress.totalEpisodes) * 100)
      : 0;
    content.querySelector(".progress-bar-fill").style.width = newPct + "%";
    content.querySelector(".progress-count").textContent =
      `${newProgress.totalWatched}/${newProgress.totalEpisodes} episodios`;
  }

  function updateSeasonCount(seasonNumber, watchedCount, episodeCount) {
    const block = content.querySelector(`.season-block[data-season="${seasonNumber}"]`);
    block.querySelector(".season-count").textContent = `${watchedCount}/${episodeCount}`;
    const markBtn = block.querySelector(".season-mark-all");
    const allWatched = watchedCount >= episodeCount && episodeCount > 0;
    markBtn.textContent = allWatched ? "Desmarcar todo" : "Marcar todo";
    markBtn.dataset.allWatched = allWatched ? "0" : "1";
  }

  function updateEpisodeAverage() {
    const avg = computeEpisodeAverageRating(item.watched);
    const el = content.querySelector("#field-rating-episode-average");
    if (!el) return;
    el.hidden = !avg;
    if (avg) {
      const ratedLabel =
        avg.count === 1 ? "1 episodio valorado" : `${avg.count} episodios valorados`;
      el.title = `Media de ${ratedLabel}`;
      el.innerHTML = `Media episodios: <strong>${avg.average.toFixed(1)}</strong>`;
    } else {
      // Sin episodios valorados: ocultar y vaciar (evita texto obsoleto
      // si el CSS por cualquier motivo dejara de respetar el [hidden]).
      el.title = "";
      el.textContent = "";
    }
  }

  function wireEpisodeRows(block, seasonNumber, episodeCount) {
    block.querySelectorAll(".episode-row").forEach((row) => {
      const episodeNumber = Number(row.dataset.episode);
      const checkbox = row.querySelector(".episode-checkbox");
      const dateInput = row.querySelector(".episode-date");
      const ratingWrap = row.querySelector(".episode-rating");
      const airDate = row.dataset.airDate;

      checkbox.addEventListener("change", async () => {
        // Estado REAL antes del clic (el navegador ya conmutó el checkbox)
        const currentEntry = normalizeEntry(
          (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
        );
        const wasWatched = Boolean(currentEntry && currentEntry.date);

        // Episodio ya visto: preguntar qué hacer (verlo de nuevo o
        // desmarcarlo) en lugar de desmarcar a secas (issue #133).
        if (wasWatched) {
          // El diálogo captura document.activeElement al abrir, pero el
          // checkbox se deshabilita antes (el navegador mueve el foco a
          // body): guardamos el elemento activo previo aquí para
          // restaurar el foco a la casilla al cerrar (QA #133).
          const prevActive = document.activeElement;
          checkbox.checked = true; // restaurar al instante (sin parpadeo)
          checkbox.disabled = true;
          try {
            const choice = await openEpisodeActionsModal({
              title: item.title,
              subtitle: `T${seasonNumber}E${episodeNumber} · ${row.dataset.episodeName || ""}`,
              times: currentEntry.times || 1,
            });
            let newProgress = null;
            if (choice === "seen_again") {
              newProgress = await onSetEpisodeSeenAgain(seasonNumber, episodeNumber);
            } else if (choice === "unmarked") {
              newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, null);
            }
            // Repintado SIEMPRE derivado de item.watched (patrón issue #136):
            // en el caso «cancelar» la fila vuelve a su estado real (inofensivo)
            // y no hay progreso nuevo que repintar en el banner.
            const entry2 = normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
            );
            applyEpisodeRowState(row, entry2);
            const watchedSeasonCount = block.querySelectorAll(".episode-row.is-watched").length;
            updateSeasonCount(seasonNumber, watchedSeasonCount, episodeCount);
            if (newProgress) updateBanner(newProgress);
          } catch (err) {
            showToast("No se pudo actualizar: " + String(err && err.message ? err.message : err));
          } finally {
            checkbox.disabled = false;
            if (prevActive && document.contains(prevActive)) prevActive.focus();
          }
          return;
        }

        // Episodio sin marcar: flujo actual (confirmación de sin estrenar
        // y ventana de valoración posterior del lado de modal-handlers).
        if (checkbox.checked && !item.manual && isUnreleasedDate(airDate)) {
          const msg = episodeUnreleasedMessage(item.title, seasonNumber, episodeNumber, airDate);
          if (!window.confirm(msg)) {
            checkbox.checked = false;
            return;
          }
        }
        checkbox.disabled = true;
        const newDate = checkbox.checked ? todayISO() : null;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, newDate);
          // Pintado DERIVADO de item.watched (no del checkbox pulsado):
          // refleja también un posible «Deshacer» desde la ventana de
          // valoración emergente (issue #136).
          const entry2 = normalizeEntry(
            (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
          );
          applyEpisodeRowState(row, entry2);
          const watchedSeasonCount = block.querySelectorAll(".episode-row.is-watched").length;
          updateSeasonCount(seasonNumber, watchedSeasonCount, episodeCount);
          updateBanner(newProgress);
          updateEpisodeAverage();
        } catch (err) {
          checkbox.checked = !checkbox.checked;
        } finally {
          checkbox.disabled = false;
        }
      });

      dateInput.addEventListener("change", async () => {
        if (!dateInput.value) return;
        dateInput.disabled = true;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, dateInput.value);
          updateBanner(newProgress);
        } finally {
          dateInput.disabled = false;
        }
      });

      const starButtons = ratingWrap.querySelectorAll(".episode-rating__star");
      starButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const value = Number(btn.dataset.value);
          // Estado REAL del rating (patrón issue #136: derivar del dato,
          // no del conteo visual de estrellas activas).
          const current = normalizeRating(
            normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
            )?.rating
          );
          // Ciclo de medias estrellas (issue #276): N → N−0.5 → quitar.
          let newValue;
          if (current === value) newValue = value - 0.5;
          else if (current === value - 0.5) newValue = null;
          else newValue = value;
          starButtons.forEach((b) => (b.disabled = true));
          try {
            await onSetEpisodeRating(seasonNumber, episodeNumber, newValue);
            starButtons.forEach((b) => {
              const n = Number(b.dataset.value);
              const v = normalizeRating(newValue || 0);
              const full = v >= n;
              const half = v === n - 0.5;
              b.classList.toggle("is-active", full && !half);
              b.classList.toggle("is-half", half);
              b.textContent = half ? "½" : "★";
              b.setAttribute(
                "aria-label",
                half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
              );
            });
            updateEpisodeAverage();
          } finally {
            starButtons.forEach((b) => (b.disabled = false));
          }
        });
      });
    });
  }

  content.querySelectorAll(".season-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const block = content.querySelector(
        `.season-episodes[data-season-episodes="${seasonNumber}"]`
      );
      const chevron = btn.querySelector(".season-chevron");
      const isHidden = block.classList.contains("hidden");

      if (!isHidden) {
        block.classList.add("hidden");
        chevron.textContent = "▸";
        return;
      }
      block.classList.remove("hidden");
      chevron.textContent = "▾";
      if (block.dataset.loaded) return;

      block.innerHTML = `<p class="episode-loading">Cargando episodios…</p>`;
      try {
        const episodes = await onExpandSeason(seasonNumber);
        // Si el siguiente episodio del usuario está en esta temporada,
        // guardamos su fecha de emisión (o null si TMDB no la tiene)
        // para poder avisar del "no estrenado" sin más llamadas a la
        // API. Fuego-y-olvido: un fallo aquí no rompe el modal.
        if (
          !item.manual &&
          onUpdateNextEpisodeAirDate &&
          item.nextEpisode &&
          item.nextEpisode.season === seasonNumber
        ) {
          const nextEp = episodes.find((e) => e.episodeNumber === item.nextEpisode.episode);
          if (nextEp) {
            Promise.resolve(
              onUpdateNextEpisodeAirDate({
                season: seasonNumber,
                episode: item.nextEpisode.episode,
                airDate: nextEp.airDate || null,
              })
            ).catch(() => {});
          }
        }
        const seasonWatched = (item.watched && item.watched[String(seasonNumber)]) || {};
        block.innerHTML = renderEpisodeRows(episodes, seasonWatched, { manual: item.manual });
        block.dataset.loaded = "1";
        const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
        wireEpisodeRows(block, seasonNumber, episodeCount);
      } catch (err) {
        block.innerHTML = `<p class="episode-loading">No se pudieron cargar los episodios.</p>`;
      }
    });
  });

  content.querySelectorAll(".season-mark-all").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
      const shouldMarkAll = btn.dataset.allWatched === "1";

      // Al marcar toda una temporada, contar los episodios sin estrenar
      // (sin fecha oficial o con fecha futura) y pedir confirmación.
      // Las series manuales quedan excluidas: no tienen fechas reales.
      let unreleasedCount = 0;
      if (shouldMarkAll && !item.manual) {
        const episodesBlock = content.querySelector(
          `.season-episodes[data-season-episodes="${seasonNumber}"]`
        );
        let episodes = null;
        if (episodesBlock && episodesBlock.dataset.loaded) {
          episodes = [...episodesBlock.querySelectorAll(".episode-row")].map((row) => ({
            episodeNumber: Number(row.dataset.episode),
            airDate: row.dataset.airDate || null,
          }));
        } else {
          try {
            episodes = await onExpandSeason(seasonNumber);
          } catch (err) {
            console.error("No se pudo verificar el estreno de la temporada:", err);
            episodes = null;
          }
        }
        if (episodes) {
          unreleasedCount = episodes.filter((e) => isUnreleasedDate(e.airDate)).length;
        }
      }
      if (unreleasedCount > 0) {
        const ok = window.confirm(
          `«${item.title}» · Temporada ${seasonNumber}: ${unreleasedCount} episodio(s) sin estrenar (sin fecha oficial o con fecha futura). ¿Marcarlos todos igualmente como vistos?`
        );
        if (!ok) return;
      }

      btn.disabled = true;
      try {
        const newProgress = await onToggleSeason(seasonNumber, shouldMarkAll);
        updateSeasonCount(seasonNumber, shouldMarkAll ? episodeCount : 0, episodeCount);
        updateBanner(newProgress);

        const episodesBlock = content.querySelector(
          `.season-episodes[data-season-episodes="${seasonNumber}"]`
        );
        if (episodesBlock.dataset.loaded) {
          episodesBlock.querySelectorAll(".episode-row").forEach((row) => {
            const entry = normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(row.dataset.episode)]
            );
            applyEpisodeRowState(row, entry);
          });
        }
        updateEpisodeAverage();
      } finally {
        btn.disabled = false;
      }
    });
  });

  const rewatchBtn = content.querySelector("#btn-rewatch");
  if (rewatchBtn) {
    rewatchBtn.addEventListener("click", async () => {
      if (
        !window.confirm(
          `¿Volver a ver «${item.title}» desde el principio? Se guardará el visionado anterior en el historial.`
        )
      ) {
        return;
      }
      await onRewatch();
    });
  }

  // Carruseles de elenco (issue #294): ver openMovieModal.
  wireCastCrewClicks(content, item);

  wireStatusActions(content, async (newStatusOrNull) => {
    const newProgress = await onSetStatus(newStatusOrNull);
    // El target se propaga en el re-render (issue #285): en modo
    // página la ficha de serie se repinta en #item-view-content.
    openTvModal(item, seasonsMeta, newProgress, callbacks, recommendations, existingIds, { target });
  });

  // Wire recommendation "Añadir" buttons
  if (onAddRecommendation) {
    content.querySelectorAll(".rec-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onAddRecommendation(recItem, btn);
      });
    });
  }

  // Wire recommendation card open preview (issue #280, iteración):
  // pulsar la tarjeta de recomendación muestra la información ampliada
  // antes de añadirla, igual que en la ficha de película.
  if (onOpenRecommendation) {
    content.querySelectorAll(".rec-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onOpenRecommendation(recItem);
      });
    });
  }

  // En modo página no se abre el modal ni se atrapa el foco: el
  // contenido ya vive en el documento (#item-view-content). Se enfoca
  // el título de la ficha (ver openMovieModal).
  if (target) {
    const title = target.querySelector(".item-hero__title");
    if (title) {
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
    return;
  }

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Modal de confirmación al añadir libro ---------- */

// Muestra un modal de selección cuando un libro tiene múltiples
// portadas o sinopsis (resultado de agrupar ediciones de Google Books).
// Si no hay nada que elegir, llama directamente a onConfirm.
export function openBookConfirmModal(item, { onConfirm, onCancel }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const hasMultipleCovers = item.allCovers && item.allCovers.length > 1;
  const hasMultipleDescriptions = item.allDescriptions && item.allDescriptions.length > 1;

  // Si no hay nada que elegir, confirmar directamente
  if (!hasMultipleCovers && !hasMultipleDescriptions) {
    onConfirm({ coverUrl: item.coverUrl, description: item.description || "" });
    return;
  }

  const metaLine = [item.author, item.year].filter(Boolean).join(" · ");
  const editionNote =
    item.editionsCount > 1
      ? `<p class="book-confirm__editions">${item.editionsCount} ediciones encontradas</p>`
      : "";

  // Selector de portadas
  let coverPickerHtml = "";
  if (hasMultipleCovers) {
    coverPickerHtml = `
      <div class="field-group">
        <label>Elige una portada</label>
        <div class="cover-picker" id="cover-picker">
          ${item.allCovers
            .map(
              (url, i) => `
            <button type="button" class="cover-picker__item ${i === 0 ? "is-selected" : ""}" data-index="${i}">
              <img src="${url}" alt="Edición ${i + 1}" loading="lazy" />
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  // Selector de sinopsis
  let descSelectorHtml = "";
  if (hasMultipleDescriptions) {
    descSelectorHtml = `
      <div class="field-group">
        <label>Elige una sinopsis</label>
        <div class="desc-picker" id="desc-picker">
          ${item.allDescriptions
            .map(
              (desc, i) => `
            <button type="button" class="desc-picker__item ${i === 0 ? "is-selected" : ""}" data-index="${i}">
              <p class="desc-picker__text">${escapeHtml(desc.length > 250 ? desc.slice(0, 250) + "…" : desc)}</p>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:0.5rem">Añadir libro</h3>
    <div class="modal-detail__header" style="margin-bottom:0.5rem">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <div style="font-weight:600;font-size:0.95rem">${escapeHtml(item.title)}</div>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editionNote}
    ${coverPickerHtml}
    ${descSelectorHtml}
    <div class="modal-actions">
      <button type="button" class="btn btn--outline" id="btn-confirm-cancel">Cancelar</button>
      <button type="button" class="btn btn--accent-books" id="btn-confirm-add">Añadir</button>
    </div>
  `;

  // Wiring del selector de portadas
  let selectedCoverIndex = 0;
  if (hasMultipleCovers) {
    content.querySelectorAll("#cover-picker .cover-picker__item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedCoverIndex = Number(btn.dataset.index);
        content.querySelectorAll("#cover-picker .cover-picker__item").forEach((b) =>
          b.classList.toggle("is-selected", b === btn)
        );
      });
    });
  }

  // Wiring del selector de sinopsis
  let selectedDescIndex = 0;
  if (hasMultipleDescriptions) {
    content.querySelectorAll("#desc-picker .desc-picker__item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDescIndex = Number(btn.dataset.index);
        content.querySelectorAll("#desc-picker .desc-picker__item").forEach((b) =>
          b.classList.toggle("is-selected", b === btn)
        );
      });
    });
  }

  content.querySelector("#btn-confirm-cancel").addEventListener("click", onCancel);
  content.querySelector("#btn-confirm-add").addEventListener("click", () => {
    onConfirm({
      coverUrl: hasMultipleCovers ? item.allCovers[selectedCoverIndex] : item.coverUrl,
      description: hasMultipleDescriptions
        ? item.allDescriptions[selectedDescIndex]
        : item.description || "",
    });
  });

  // Si venimos de otro modal (p. ej. la preview de búsqueda), limpiar
  // su focus trap antes de registrar el nuevo
  if (modal._focusTrapCleanup) modal._focusTrapCleanup();

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

export function closeModal() {
  const modal = document.getElementById("item-modal");

  // Consume el cierre personalizado registrado (_onClose): evita que
  // una preview cerrada re-dispare su onClose tras restaurar la ficha
  // (issue #280, QA D3).
  modal._onClose = null;

  // Restaurar foco al elemento que lo tenía antes de abrir
  if (modal._previousActiveElement && typeof modal._previousActiveElement.focus === 'function') {
    modal._previousActiveElement.focus();
  }

  // Limpiar focus trap
  if (modal._focusTrapCleanup) {
    modal._focusTrapCleanup();
    modal._focusTrapCleanup = null;
  }
  modal._previousActiveElement = null;

  modal.classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
}

/* ---------- Ficha de solo lectura (para ver lo de un amigo) ---------- */

export function openReadOnlyModal(item, ownerName) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = metaLineFor(item);
  const stars = ratingStarsHtml(item.rating);
  const progress = progressLine(item);

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    <p class="read-only-badge">👀 Viendo la ficha de ${escapeHtml(ownerName)} · solo lectura</p>

    ${upcomingBadge(item)}
    ${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}
    ${gamePlatformsHtml(item)}
    ${extraInfoHtml(item, { skipCarousels: true })}
    ${watchProvidersHtml(item)}
    ${awardsHtml(item)}
    ${castCrewHtml(item)}

    <div class="field-group">
      <span class="item-card__stamp item-card__stamp--${item.status}" style="position:static;transform:none;display:inline-block;">
        ${statusLabel(item.status, item.type)}
      </span>
    </div>

    ${progress ? `<p class="extra-info__line">${escapeHtml(progress)}</p>` : ""}
    ${stars ? `<p class="item-card__rating" style="font-size:1rem;">${stars}</p>` : ""}
  `;

  // Carruseles de elenco (issue #294): los botones «Ver en más detalle»
  // también funcionan en la ficha de solo lectura del amigo.
  wireCastCrewClicks(content, item);

  // Premios (issue #302, iteración): la ficha del amigo también
  // muestra los premios del título extraídos de la API (Wikidata),
  // consultados con la clave del LECTOR (como los detalles; nunca se
  // escribe en Firestore). Mismo patrón que loadItemDetails: se
  // re-renderiza si la ficha sigue abierta cuando llegan.
  if ((item.type === "movie" || item.type === "tv") && item.externalId && !item._awardsFetched) {
    item._awardsFetched = true;
    getItemAwards(item.type, item.externalId).then((awards) => {
      item.awards = awards;
      if (!document.getElementById("item-modal")?.classList.contains("hidden")) {
        openReadOnlyModal(item, ownerName);
      }
    });
  }

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));

  // Ficha de amigo bajo demanda (issue #200): el documento del amigo
  // puede guardar solo la tarjeta (almacenamiento mínimo). Los
  // detalles se piden a la API del LECTOR (con caché de 24 h) y se
  // re-renderiza la ficha; nunca se escribe en Firestore (solo
  // lectura). Si falla la red, degrada a «solo tarjeta» y no se
  // reintenta en esta sesión.
  if (needsDetailFetch(item) && !item._detailsFailed) {
    item._detailsFailed = false;
    loadItemDetails(item).then((details) => {
      if (!document.getElementById("item-modal")?.classList.contains("hidden")) {
        if (!details) item._detailsFailed = true;
        openReadOnlyModal(item, ownerName);
      }
    });
  }
}

/* ---------- Amigos ---------- */

export function renderFriendsList(container, profiles, myUid, onSelect) {
  const others = profiles.filter((p) => p.uid !== myUid);
  if (!others.length) {
    container.innerHTML = `<p class="empty-state">Todavía no hay más gente registrada.</p>`;
    return;
  }
  container.innerHTML = others
    .map(
      (p, index) => `
      <button class="friend-card" data-index="${index}">
        <img class="friend-card__avatar" src="${p.photoURL || PLACEHOLDER_COVER}" alt="Avatar de ${escapeHtml(p.displayName || p.email || 'amigo')}" />
        <span class="friend-card__name">${escapeHtml(p.displayName || p.email || "Sin nombre")}</span>
      </button>`
    )
    .join("");

  container.querySelectorAll(".friend-card").forEach((btn) => {
    btn.addEventListener("click", () => onSelect(others[Number(btn.dataset.index)]));
  });
}

export function renderFriendTab(tabKey, items, onOpen, emptyMessage) {
  const gridEl = document.getElementById("friend-" + tabKey);
  if (!items.length) {
    gridEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage || "Nada por aquí todavía.")}</p>`;
    return;
  }
  renderGrid(gridEl, items, onOpen);
}

/* ---------- Notificaciones ---------- */

export function renderNotifications(listEl, badgeEl, emptyEl, notifications, { onDelete }) {
  const unread = notifications.filter((n) => !n.read).length;
  if (unread > 0) {
    badgeEl.textContent = unread > 9 ? "9+" : String(unread);
    badgeEl.classList.remove("hidden");
  } else {
    badgeEl.classList.add("hidden");
  }

  if (!notifications.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = notifications
    .map(
      (n, index) => `
      <div class="notif-row ${n.read ? "" : "is-unread"}">
        <span class="notif-row__text">${escapeHtml(n.message)}</span>
        <button type="button" class="notif-row__delete" data-index="${index}" aria-label="Borrar">✕</button>
      </div>`
    )
    .join("");

  listEl.querySelectorAll(".notif-row__delete").forEach((btn) => {
    btn.addEventListener("click", () => onDelete(notifications[Number(btn.dataset.index)]));
  });
}

/* ---------- Aviso flotante ---------- */

let toastTimer = null;
let undoState = null; // { hide } del toast de deshacer activo, o null

function clearUndoState() {
  if (undoState) {
    undoState.hide();
    undoState = null;
  }
}

export function showToast(message) {
  // Si hay un toast de deshacer activo, ocultarlo
  clearUndoState();
  clearTimeout(toastTimer);

  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

/**
 * Muestra un toast con mensaje y botón "Deshacer".
 * El toast NO se oculta automáticamente — el llamador controla su
 * ciclo de vida mediante el método `hide()` del objeto devuelto.
 *
 * @param {string}   title   - Título del ítem que se eliminará
 * @param {Function} onUndo  - Callback al hacer clic en "Deshacer"
 * @returns {{ hide: () => void }}
 */
export function showUndoToast(title, onUndo) {
  // Si ya hay otro toast de deshacer visible, ocultarlo
  clearUndoState();
  clearTimeout(toastTimer);

  const toast = document.getElementById("toast");
  toast.innerHTML = `
    <span>«${escapeHtml(title)}» se eliminará…</span>
    <button class="toast__btn">Deshacer</button>
  `;
  toast.classList.add("toast--undo");
  toast.classList.remove("hidden");

  const hide = () => {
    if (undoState !== state) return; // Otro toast ya tomó el control
    toast.classList.remove("toast--undo");
    toast.classList.add("hidden");
    toast.innerHTML = "";
    undoState = null;
  };

  const state = { hide };
  undoState = state;

  toast.querySelector(".toast__btn").addEventListener("click", () => {
    onUndo();
  });

  return { hide };
}

/* ---------- Feed de actividad de amigos ---------- */

const PLACEHOLDER_COVER_SMALL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='60'%3E%3Crect fill='%23333' width='40' height='60'/%3E%3Ctext x='20' y='35' text-anchor='middle' fill='%23777' font-size='10'%3EN/A%3C/text%3E%3C/svg%3E";

/**
 * Renderiza el feed de actividad de amigos en un contenedor.
 * @param {Element} container - Elemento DOM donde renderizar
 * @param {Array<object>} events - Array de eventos de buildGlobalFeed()
 * @param {Function} onItemClick - Callback al hacer clic en un item (recibe el item)
 */
export function renderActivityFeed(container, events, onItemClick) {
  if (!events || events.length === 0) {
    container.innerHTML = `<p class="empty-state">Todavía no hay actividad reciente de tus amigos.</p>`;
    return;
  }

  // Agrupar por fecha
  const groups = {};
  events.forEach((ev) => {
    const dateLabel = formatDateLabel(ev.date);
    if (!groups[dateLabel]) groups[dateLabel] = [];
    groups[dateLabel].push(ev);
  });

  // Ordenar grupos por fecha (las keys son "Hoy", "Ayer", o YYYY-MM-DD)
  const groupKeys = Object.keys(groups).sort((a, b) => {
    // Las fechas reales empiezan con dígito, los labels como "Hoy" van primero
    const aIsDate = /^\d/.test(a);
    const bIsDate = /^\d/.test(b);
    if (!aIsDate && bIsDate) return -1;
    if (aIsDate && !bIsDate) return 1;
    if (!aIsDate && !bIsDate) return 0;
    return b.localeCompare(a); // descendente para fechas
  });

  let html = "";
  groupKeys.forEach((dateLabel) => {
    html += `<div class="activity-group">
      <div class="activity-group__header">${escapeHtml(dateLabel)}</div>
      <div class="activity-group__items">`;

    groups[dateLabel].forEach((ev, idx) => {
      const item = ev.item || {};
      const coverSrc = item.coverUrl || PLACEHOLDER_COVER_SMALL;
      html += `
        <div class="activity-event" data-event-index="${idx}" tabindex="0" role="button">
          <div class="activity-event__cover-wrap">
            <img class="activity-event__cover" src="${coverSrc}" alt="" loading="lazy" />
          </div>
          <div class="activity-event__body">
            <div class="activity-event__text">
              <strong>${escapeHtml(ev.friendName)}</strong>
              ${escapeHtml(ev.label)}
              <em>${escapeHtml(item.title || "sin título")}</em>
              ${ev.detail ? `<span class="activity-event__detail">${escapeHtml(ev.detail)}</span>` : ""}
            </div>
            <div class="activity-event__meta">
              <span class="activity-event__icon">${eventIcon(ev.type)}</span>
            </div>
          </div>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;

  // Asignar click y teclado handlers usando el índice global
  let globalIdx = 0;
  container.querySelectorAll(".activity-event").forEach((el) => {
    const eventData = events[globalIdx];
    if (eventData && eventData.item && onItemClick) {
      el.addEventListener("click", () => onItemClick(eventData.item, eventData.friendName));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onItemClick(eventData.item, eventData.friendName);
        }
      });
    }
    globalIdx++;
  });
}

/**
 * Formatea una fecha YYYY-MM-DD como "Hoy", "Ayer" o "DD de Mes, YYYY".
 */
function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  // Usar la misma lógica que todayISO() para consistencia (fecha UTC)
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  if (dateStr === todayStr) return "Hoy";
  if (dateStr === yesterdayStr) return "Ayer";

  const d = new Date(dateStr + "T12:00:00");
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${d.getDate()} de ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

/**
 * Devuelve un icono para el tipo de evento.
 */
function eventIcon(type) {
  const icons = {
    movie_watched: "🎬",
    series_started: "📺",
    series_completed: "🏁",
    series_episodes: "📺",
    book_started: "📖",
    book_finished: "📚",
    game_started: "🎮",
    game_finished: "🏆",
  };
  return icons[type] || "📌";
}
