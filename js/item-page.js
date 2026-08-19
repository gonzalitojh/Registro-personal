// =============================================================
// Página de detalle de un ítem de Ocio (issue #285).
//
// Al pulsar una película o serie — en la colección o en la barra de
// búsqueda — la app abre una PÁGINA NUEVA (#/ocio/series/<id> o
// #/ocio/peliculas/<id>) en lugar de la ventana (modal) clásica. La
// cabecera superior se respeta, pero el ☰ (y el ⚙) se sustituyen por
// el botón atrás (swap por CSS con body.is-item-page; ver index.html
// y css/styles.css).
//
// Esta vista es hermana de primer nivel de profile-view (fuera de
// #app). Dos modos de contenido:
//   - El ítem YA está en el registro → ficha completa en página
//     (openMovieItem/openTvItem en modo target, con todas sus
//     acciones: visionados, temporadas, valoración, borrar).
//   - El ítem NO está en el registro (resultado del catálogo o URL
//     compartida) → vista previa con los detalles de TMDB y botón
//     «Añadir»; al añadirlo, la página pasa a la ficha completa.
// Libros y videojuegos NO usan esta página (siguen con su modal).
// =============================================================

import * as ui from "./ui.js";
import {
  openMovieItem,
  openTvItem,
  addSagaMovie,
  addFromRecommendation,
} from "./modal-handlers.js";
import {
  getMovieDetails,
  getTvExtraDetails,
  getTvSeasonsMeta,
  getWatchProviders,
  getSimilarMovies,
  getSimilarTv,
  getCollectionDetails,
  getUserCountry,
} from "./api-movies.js";
import {
  upcomingBadge,
  watchProvidersHtml,
  extraInfoHtml,
  itemHeroHtml,
  previewSeasonsHtml,
  renderSagaMovies,
  renderRecommendations,
  wireCastCrewClicks,
} from "./ui.js";
import { handleAdd, handleAddSeen } from "./search.js";
import { getLastOcioKey, navigate, parseHash } from "./router.js";
import { normalizeTabKey } from "./settings.js";
import { isUnreleasedDate } from "./release.js";
import { quickMarkMovie, quickMarkTvComplete, promptItemRating, quickUnwatchMovie, quickUnwatchTv } from "./quick-actions.js";
import { scheduleDeletion } from "./undo-delete.js";

let pageCtx = null;
let ensureGroup = null;

// Ruta activa de la página: { kind: "tv"|"movie", externalId }.
// Se usa como token anti-race: tras cada await se comprueba que la
// ruta no haya cambiado (atrás/adelante o nueva navegación) antes de
// pintar (patrón del dropdown de búsqueda global).
let currentToken = null;
let currentMode = null; // "ficha" | "preview" | "mensaje"
let visible = false;

const CONTENT_ID = "item-view-content";

function viewEl() {
  return document.getElementById("item-view");
}
function contentEl() {
  return document.getElementById(CONTENT_ID);
}

// Escapado HTML mínimo local (ui.js no exporta su escapeHtml).
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

// ¿La ruta activa sigue siendo la del token capturado?
function isCurrent(token) {
  return (
    visible &&
    currentToken &&
    currentToken.kind === token.kind &&
    currentToken.externalId === token.externalId
  );
}

function groupFor(kind) {
  return kind === "tv" ? "tv" : "movies";
}

/* ---------- Estados de la página ---------- */

function renderLoading() {
  currentMode = "mensaje";
  removeFab();
  contentEl().innerHTML = `
    <div class="item-view__card" aria-live="polite">
      <div class="panel-loading" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>Cargando…</span>
      </div>
    </div>`;
}

// Estado informativo (sin sesión, error de carga, ítem ya no en el
// registro) con botón atrás propio además del de la cabecera.
function renderMessage(title, text) {
  currentMode = "mensaje";
  removeFab();
  contentEl().innerHTML = `
    <div class="item-view__card" role="alert">
      <h3 class="modal-detail__title" tabindex="-1">${escapeHtml(title)}</h3>
      <p class="extra-info__line">${escapeHtml(text)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn--primary" id="btn-item-msg-back">Volver</button>
      </div>
    </div>`;
  const backBtn = contentEl().querySelector("#btn-item-msg-back");
  if (backBtn) backBtn.addEventListener("click", goBack);
  document.getElementById("btn-item-back")?.focus();
}

// Crea el contenedor de la ficha/preview (issue #292): el contenido de
// la página va DIRECTO sobre el fondo, sin la «tarjeta» de superficie
// (el recuadro se elimina). El contenedor .item-view__card se conserva
// solo para los estados transitorios (renderLoading/renderMessage).
function renderItemContent() {
  contentEl().innerHTML = "";
  return contentEl();
}

/* ---------- Botón flotante de acciones (issue #298) ---------- */

// Botón flotante abajo a la derecha, visible SOLO en la ficha y en la
// vista previa de películas/series. Al pulsarlo despliega las acciones
// alrededor del botón en forma de abanico circular (no lista vertical,
// iteración de la issue #298), con una animación escalonada que las
// hace salir «desde el botón». Acciones según el contexto:
//   - ficha (ítem en el registro): «Marcar como vista» (oculto en
//     series ya completadas / en pausa / abandonadas) y «Valorar».
//   - preview (ítem aún no añadido): «Añadir», «Marcar como vista»
//     (añade y marca como vista) y «Valorar» (añade y abre la
//     valoración).
//   - ficha (ítem en el registro): opción inversa («Quitar de
//     añadidos» si no está visto; «Quitar última visualización» si
//     sí lo está — en series, el último episodio marcado; en
//     películas, la última entrada del historial), «Marcar como
//     vista» (u «Añadir otro visionado» en películas ya vistas) y
//     «Valorar».
// El botón se ve DISTINTO según el estado (iteraciones 3 y 4 de la
// issue #298), con TRES estados diferenciados:
//   - no añadido (preview): icono + gris del tema (se puede añadir).
//   - añadido y no visto (ficha): icono + verde.
//   - visto (ficha): ✓ ocre; en una película vista MÁS DE UNA VEZ el
//     ✓ se sustituye por el NÚMERO de visionados.
// En series solo se distinguen estos tres estados (completada =
// vista), igual que en películas.
const FAB_ID = "item-fab";

const FAB_ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  // Iteración 4 (issue #298): opción inversa según el estado de la
  // ficha — papelera para «Quitar de añadidos» (no visto) y flecha
  // circular para «Quitar última visualización» (visto).
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  rotateCcw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
};

// Ángulos (grados) de las opciones alrededor del botón, medidos desde
// el centro del FAB: 0° = arriba, -90° = izquierda (los ángulos
// negativos giran hacia la izquierda). El abanico vive en el cuadrante
// superior-izquierdo: es el espacio libre para un botón anclado abajo
// a la derecha (la parte derecha del círculo no cabe en pantallas
// estrechas). Los ángulos están espaciados para que las pastillas
// NO se solapen (iteración 5 de la issue #298): con la fuente real
// (IBM Plex Sans) las etiquetas largas envuelven a 2 líneas y las
// pastillas miden ~59 px de alto (184 × 59 px a max-width 11.5rem),
// así que la separación vertical entre puntos consecutivos del arco
// (R·(cos aᵢ − cos aᵢ₊₁)) debe ser >= ~4.2rem (67 px): con R = 9.5 y
// los ángulos de 3 opciones [-22, -62, -90] quedan 69.6 px y 71.4 px
// (holgura >= 10 px sobre pastillas de 59 px). El ángulo inferior se
// queda en -90° (nunca baja del centro del botón: en -90° la pastilla
// queda a la altura del FAB, sin salirse por el borde inferior).
const FAB_ARC_ANGLES = {
  1: [-70], // una sola opción (p. ej. serie completada: solo «Valorar»)
  2: [-30, -85], // ficha: «Marcar como vista» + «Valorar»
  3: [-22, -62, -90], // preview: «Añadir» + «Marcar como vista» + «Valorar»
};
const FAB_ARC_RADIUS = 9.5; // rem, distancia del centro del FAB a las opciones

// Punto (fx, fy en rem) de una opción del abanico, relativo al centro
// del botón flotante (fx positivo = derecha, fy positivo = abajo).
function fabArcPoint(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    fx: FAB_ARC_RADIUS * Math.sin(rad),
    fy: -FAB_ARC_RADIUS * Math.cos(rad),
  };
}

function fabEl() {
  return document.getElementById(FAB_ID);
}

// ¿El ítem está visto? Película: al menos un visionado. Serie:
// completada (todos los episodios de todas las temporadas).
function isItemSeen(item) {
  if (item.type === "tv") return item.status === "completado";
  return Boolean(item.watchLog && item.watchLog.length);
}

function removeFab() {
  fabEl()?.remove();
}

function closeFabMenu() {
  const fab = fabEl();
  if (!fab) return;
  const toggle = fab.querySelector(".item-fab__toggle");
  fab.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function openFabMenu() {
  const fab = fabEl();
  if (!fab) return;
  const menu = fab.querySelector(".item-fab__menu");
  const toggle = fab.querySelector(".item-fab__toggle");
  if (!menu || !toggle) return;
  fab.classList.add("is-open");
  toggle.setAttribute("aria-expanded", "true");
  const firstAction = menu.querySelector(".item-fab__action");
  firstAction?.focus();
}

// Opciones del menú según el contexto (ver cabecera de la sección).
// Devuelve [{ action, icon, label }]: la posición circular la calcula
// renderFab (ángulos de FAB_ARC_ANGLES según el número de opciones).
// Iteración 4 (issue #298): en la ficha la opción inversa a «Añadir»
// es la primera del abanico — «Quitar de añadidos» si el ítem NO está
// visto, «Quitar última visualización» si SÍ lo está (en series, la
// última visualización es el último episodio marcado; en películas,
// la última entrada del watchLog).
function fabOptions(item, mode) {
  if (mode === "preview") {
    const label = item.type === "tv" ? "Añadir serie" : "Añadir película";
    return [
      { action: "add", icon: FAB_ICONS.plus, label },
      { action: "mark", icon: FAB_ICONS.check, label: "Marcar como vista" },
      { action: "rate", icon: FAB_ICONS.star, label: "Valorar" },
    ];
  }
  const isTv = item.type === "tv";
  const seen = isItemSeen(item);
  // «Marcar como vista» se oculta cuando no hay nada que marcar:
  // series completadas / en pausa / abandonadas, o series completas
  // con estado manual (p. ej. «en_curso» con todos los episodios
  // vistos, que no tiene nextEpisode pendiente).
  const markable =
    !isTv || (!["completado", "standby", "abandonado"].includes(item.status) && item.nextEpisode);
  const actions = [];
  // Opción inversa a «Añadir» (ficha): quitar de añadidos, o quitar
  // la última visualización si ya está visto (issue #298, iteración 4).
  if (seen) {
    actions.push({
      action: "unwatch",
      icon: FAB_ICONS.rotateCcw,
      label: "Quitar última visualización",
    });
  } else {
    actions.push({
      action: "remove",
      icon: FAB_ICONS.trash,
      label: "Quitar de añadidos",
    });
  }
  if (markable) {
    // Película ya vista: «Marcar como vista» añade otro visionado
    // (mismo comportamiento que el botón Vista de la lista).
    const label = !isTv && seen ? "Añadir otro visionado" : "Marcar como vista";
    actions.push({ action: "mark", icon: FAB_ICONS.check, label });
  }
  actions.push({ action: "rate", icon: FAB_ICONS.star, label: "Valorar" });
  return actions;
}

// Pinta (o repinta) el botón flotante dentro de #item-view. mode:
// "ficha" (ítem en el registro) o "preview" (aún no añadido).
// Tres estados visuales (iteraciones 3 y 4 de la issue #298), ver
// cabecera de la sección: preview → + gris del tema; ficha sin ver →
// + verde (clase .item-fab--added); ficha visto → ✓ ocre (clase
// .item-fab--seen), con el NÚMERO de visionados en lugar del ✓ cuando
// una película se ha visto más de una vez. El aria-label del toggle
// refleja el estado («no añadido», «pendiente», «visto» o «visto N
// veces»).
function renderFab(item, mode) {
  removeFab();
  const isPreview = mode === "preview";
  const seen = !isPreview && isItemSeen(item);
  // Nº de visionados: solo aplica a películas en ficha (para series
  // solo cuentan los tres estados: añadido / no vista / vista).
  const watchCount =
    !isPreview && item.type === "movie"
      ? item.watchLog
        ? item.watchLog.length
        : 0
      : 0;
  const showCount = seen && watchCount > 1;
  const fab = document.createElement("div");
  fab.id = FAB_ID;
  fab.className =
    "item-fab" +
    (isPreview ? "" : seen ? " item-fab--seen" : " item-fab--added");
  const options = fabOptions(item, mode);
  const angles = FAB_ARC_ANGLES[options.length] || FAB_ARC_ANGLES[2];
  const actionsHtml = options
    .map((opt, i) => {
      const { fx, fy } = fabArcPoint(angles[i]);
      return `<button type="button" class="item-fab__action" role="menuitem" data-fab-action="${opt.action}" style="--fx:${fx.toFixed(2)}rem; --fy:${fy.toFixed(2)}rem; --i:${i}">${opt.icon}<span>${opt.label}</span></button>`;
    })
    .join("");
  const stateLabel = isPreview
    ? "no añadido"
    : seen
      ? showCount
        ? `visto ${watchCount} veces`
        : "visto"
      : "pendiente";
  const toggleIcon = showCount
    ? `<span class="item-fab__count" aria-hidden="true">${watchCount > 99 ? "99+" : watchCount}</span>`
    : seen
      ? FAB_ICONS.check
      : FAB_ICONS.plus;
  fab.innerHTML = `
    <div class="item-fab__menu" role="menu" aria-label="Acciones rápidas">
      ${actionsHtml}
    </div>
    <button type="button" class="item-fab__toggle" aria-label="Acciones rápidas (${stateLabel})" aria-haspopup="true" aria-expanded="false">
      ${toggleIcon}
    </button>`;
  viewEl().appendChild(fab);

  const toggle = fab.querySelector(".item-fab__toggle");
  toggle.addEventListener("click", () => {
    fab.classList.contains("is-open") ? closeFabMenu() : openFabMenu();
  });

  fab.querySelectorAll(".item-fab__action").forEach((btn) => {
    btn.addEventListener("click", () => runFabAction(item, btn.dataset.fabAction));
  });
}

// Ejecuta la acción del botón flotante. Tras marcar o valorar se
// repinta la ficha (isRerender=true, mismo patrón que el reopen del
// modal: sin re-pedir detalles) para reflejar el nuevo estado.
// En la vista previa (ítem aún no añadido) «Marcar como vista» y
// «Valorar» primero dan de ALTA el ítem y luego actúan sobre él
// (issue #298: el usuario no distingue añadir+accionar).
async function runFabAction(item, action) {
  closeFabMenu();
  try {
    if (action === "add") {
      await addFromPreview(item);
      return;
    }
    if (action === "remove") {
      // Iteración 4 (issue #298): «Quitar de añadidos» programa el
      // borrado con deshacer (mismo flujo que el antiguo botón
      // «Eliminar» del final de la ficha, scheduleDeletion de
      // undo-delete.js) y vuelve a la pantalla previa.
      scheduleDeletion(item, pageCtx.getCurrentUser().uid, item.type, pageCtx);
      goBack();
      return;
    }
    if (currentMode === "preview") {
      if (action === "mark") await addSeenFromPreview(item);
      else if (action === "rate") await addAndRateFromPreview(item);
      return;
    }
    if (action === "mark") {
      if (item.type === "tv") await quickMarkTvComplete(item, pageCtx);
      else await quickMarkMovie(item, pageCtx);
    } else if (action === "rate") {
      await promptItemRating(item, pageCtx);
    } else if (action === "unwatch") {
      // Iteración 4 (issue #298): «Quitar última visualización».
      // Película: elimina la última entrada del watchLog; serie:
      // desmarca el último episodio visto (ver quick-actions.js).
      if (item.type === "tv") await quickUnwatchTv(item, pageCtx);
      else await quickUnwatchMovie(item, pageCtx);
    }
    if (isCurrent(currentToken)) {
      renderFicha(item, true);
      // El repintado elimina la pastilla que tenía el foco (y el modal
      // de valoración lo deja en body al cerrarse): restaurar el foco
      // en el toggle del FAB nuevo para no perder el anclaje de teclado.
      fabEl()?.querySelector(".item-fab__toggle")?.focus();
    }
  } catch (err) {
    ui.showToast("No se pudo actualizar: " + (err && err.message ? err.message : err));
  }
}

// Alta en curso desde la preview (issue #298): candado compartido
// entre el botón real «Añadir» y el botón flotante. Previene dobles
// altas concurrentes (el botón real solo se deshabilita durante el
// handleAdd del propio alta; el FAB puede reabrir su menú mientras
// tanto y volver a ofrecer «Añadir»).
let previewAddInFlight = false;

// Alta desde la vista previa (botón «Añadir» o botón flotante):
// handleAdd da de alta en el registro y refreshAfterAdd pasa a la
// ficha completa leyendo el ítem recién creado. Si existe el botón
// real de la preview se usa (handleAdd lo deshabilita y restaura su
// estado); el objeto local es un fallback para el botón flotante.
async function addFromPreview(item, btn) {
  if (previewAddInFlight) return;
  previewAddInFlight = true;
  const realBtn = document.getElementById("btn-preview-add");
  const target = realBtn || btn || { disabled: false, textContent: "" };
  target.disabled = true;
  target.textContent = "Añadiendo…";
  try {
    const ok = await handleAdd(item, target, pageCtx);
    if (ok) {
      // await: el candado permanece hasta que la ficha está en
      // pantalla y la preview ya no puede reabrir «Añadir».
      await refreshAfterAdd();
    } else {
      target.disabled = false;
      target.textContent = "Añadir";
    }
  } catch (err) {
    target.disabled = false;
    target.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + (err && err.message ? err.message : err));
  } finally {
    previewAddInFlight = false;
  }
}

// Alta como vista desde la preview (issue #298): el flotante de la
// preview «Marcar como vista» da de alta DIRECTAMENTE como visto
// (handleAddSeen: en series marca TODOS los episodios de TODAS las
// temporadas — mismo GATE de temporadas y confirmaciones que el
// catálogo) y pasa a la ficha. Comparte el candado previewAddInFlight
// con el alta normal: no puede haber dos altas concurrentes (botón
// real + flotante).
async function addSeenFromPreview(item) {
  if (previewAddInFlight) return;
  previewAddInFlight = true;
  // Sin botón real: el flotante ya cerró su menú. handleAddSeen
  // espera un btn para deshabilitarlo/restaurarlo durante el flujo.
  const target = { disabled: false, textContent: "" };
  try {
    const ok = await handleAddSeen(item, target, pageCtx);
    if (ok && isCurrent(currentToken)) {
      await refreshAfterAdd();
    }
    // ok=false: abortado o deshecho (el ítem no queda en el
    // registro); la vista previa sigue igual.
  } catch (err) {
    ui.showToast("No se pudo actualizar: " + (err && err.message ? err.message : err));
  } finally {
    previewAddInFlight = false;
  }
}

// Preview · «Valorar» (issue #298): añade el ítem al registro (con
// el flujo normal, sin marcar nada) y, nada más pasar a la ficha,
// abre la valoración del ítem recién creado. El candado anti doble
// alta cubre todo el flujo (alta + modal de valoración).
async function addAndRateFromPreview(item) {
  if (previewAddInFlight) return;
  previewAddInFlight = true;
  // handleAdd espera un btn para deshabilitarlo/restaurarlo; si
  // existe el botón real de la preview se usa (como en addFromPreview).
  const realBtn = document.getElementById("btn-preview-add");
  const target = realBtn || { disabled: false, textContent: "" };
  target.disabled = true;
  target.textContent = "Añadiendo…";
  try {
    const ok = await handleAdd(item, target, pageCtx);
    if (!ok) {
      target.disabled = false;
      target.textContent = "Añadir";
      return;
    }
    const registered = await refreshAfterAdd();
    // La valoración se abre sobre el ítem recién creado (tiene id de
    // registro; promptItemRating lo necesita para persistir).
    if (registered && isCurrent(currentToken)) {
      await promptItemRating(registered, pageCtx);
      renderFicha(registered, true);
      // Mismo patrón que runFabAction: devolver el foco al toggle del
      // FAB nuevo (el repintado y el modal lo dejan en body).
      fabEl()?.querySelector(".item-fab__toggle")?.focus();
    }
  } catch (err) {
    target.disabled = false;
    target.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + (err && err.message ? err.message : err));
  } finally {
    previewAddInFlight = false;
  }
}

/* ---------- Ficha completa (ítem en el registro) ---------- */

function renderFicha(item, isRerender = false) {
  currentMode = "ficha";
  const target = renderItemContent();
  const kind = item.type === "tv" ? "tv" : "movie";
  // Modo página: target = contenedor del contenido; los re-renders
  // (reopen) propagan el target y repintan en la página. El foco al
  // título lo gestiona ui.js en el modo página. isRerender=true evita
  // re-pedir los detalles de ficha (issue #298: repintado tras una
  // acción del botón flotante, mismo patrón que el reopen del modal).
  if (kind === "tv") {
    openTvItem(item, pageCtx, isRerender, target);
  } else {
    openMovieItem(item, pageCtx, isRerender, target);
  }
  renderFab(item, "ficha");
}

/* ---------- Vista previa (ítem del catálogo, aún no añadido) ---------- */

// Construye el ítem de preview consultando TMDB (URL compartida sin
// objeto de búsqueda). Devuelve el ítem o null si la API no trae
// datos (p. ej. id no existe o fallo de red: getXDetails devuelve {}).
// Copia TODOS los campos de la ficha (issue #290) para que la preview
// muestre la misma información del título que la ficha: director/
// creadores, duración por episodio, fecha de estreno, saga, etc.
async function buildPreviewItem(kind, externalId) {
  const id = String(externalId);
  if (kind === "tv") {
    const details = await getTvExtraDetails(id);
    if (!details.title) return null;
    let seasonsMeta = [];
    try {
      seasonsMeta = await getTvSeasonsMeta(id);
    } catch (err) {
      // no bloqueamos la preview si fallan las temporadas
    }
    return {
      type: "tv",
      externalId: id,
      title: details.title,
      year: (details.firstAirDate || "").slice(0, 4),
      coverUrl: details.coverUrl || null,
      overview: details.overview || "",
      genres: details.genres || [],
      cast: details.cast || [],
      crew: details.crew || [],
      communityRating: details.communityRating ?? null,
      trailerUrl: details.trailerUrl || null,
      seasonsMeta,
      // Más campos de la ficha (issue #290): la preview muestra la
      // misma información que la ficha.
      episodeRuntime: details.episodeRuntime || null,
      creators: details.creators || [],
      firstAirDate: details.firstAirDate || null,
      seasonAirDates: details.seasonAirDates || {},
      tmdbStatus: details.tmdbStatus || null,
      // Modelado "recién añadida" (issue #290): el distintivo de
      // "sin estrenar" de la ficha depende de nextEpisode y
      // awaitingRelease; handleAdd (search.js) fija estos valores al
      // dar de alta un ítem, así que replicamos ese estado inicial
      // para que el badge salga de forma idéntica en la preview.
      manual: false,
      nextEpisode: { season: 1, episode: 1 },
      awaitingRelease:
        details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate),
    };
  }
  const details = await getMovieDetails(id);
  if (!details.title) return null;
  return {
    type: "movie",
    externalId: id,
    title: details.title,
    year: (details.releaseDate || "").slice(0, 4),
    coverUrl: details.coverUrl || null,
    overview: details.overview || "",
    genres: details.genres || [],
    cast: details.cast || [],
    crew: details.crew || [],
    runtime: details.runtime || null,
    communityRating: details.communityRating ?? null,
    trailerUrl: details.trailerUrl || null,
    // Más campos de la ficha (issue #290): ídem y datos de saga.
    director: details.director || null,
    releaseDate: details.releaseDate || null,
    manual: false,
    collectionId: details.collectionId || null,
    collectionName: details.collectionName || null,
    collectionPoster: details.collectionPoster || null,
  };
}

// Carga en paralelo los bloques NO críticos de la ficha (issue #290):
// dónde verla (watch providers), recomendaciones, ids ya añadidos y
// películas de la saga. Promise.allSettled: un fallo de red degrada el
// bloque correspondiente sin romper la preview (misma política de
// degradación elegante que la ficha). Nunca lanza.
async function loadPreviewExtras(token, item) {
  const group = groupFor(token.kind);
  const similar = token.kind === "tv" ? getSimilarTv : getSimilarMovies;
  const results = await Promise.allSettled([
    getWatchProviders(token.externalId, token.kind, getUserCountry()),
    similar(token.externalId),
    pageCtx.getGroupItemsResolved(group),
    item.collectionId ? getCollectionDetails(item.collectionId) : Promise.resolve(null),
  ]);
  const [providers, recs, ids, saga] = results;
  return {
    watchProviders: providers.status === "fulfilled" ? providers.value : null,
    recommendations: (recs.status === "fulfilled" ? recs.value : []).slice(0, 10),
    existingIds: new Set(
      (ids.status === "fulfilled" ? ids.value : []).map((i) => i.externalId)
    ),
    sagaParts:
      item.collectionId && saga.status === "fulfilled" && saga.value && saga.value.parts.length
        ? saga.value.parts
        : null,
  };
}

// Pinta la tarjeta de preview con la MISMA información del título que
// la ficha (issue #290): distintivo de no estrenado, puntuación de la
// comunidad, tráiler, dónde verla, información ampliada (duración,
// géneros, director/creadores, reparto, sinopsis), temporadas
// detalladas (series), saga (si movie con collectionId) y
// recomendaciones. Las acciones del REGISTRO (visionados, valoración
// personal, notas, eliminar) no aplican sin ítem en el
// registro: se conservan el aviso «aún no añadido» y el botón Añadir.
function paintPreview(
  target,
  item,
  { loading = false, recommendations = [], existingIds = new Set(), sagaParts = null } = {}
) {
  const kind = item.type === "tv" ? "tv" : "movie";

  const onOpenSagaMovie = (movie) =>
    navigate({ section: "item", kind: "movie", externalId: movie.externalId });
  const onOpenRecommendation = (recItem) =>
    navigate({ section: "item", kind: recItem.type === "tv" ? "tv" : "movie", externalId: recItem.externalId });

  // Badge de "sin estrenar" solo cuando hay fecha conocida de estreno
  // (el render optimista de búsqueda no la trae; llegarían falsos
  // "Aún no estrenada" sin fecha).
  const unreleasedBadge =
    item.releaseDate || item.firstAirDate ? upcomingBadge(item) : "";

  const sagaHtml = item.collectionId
    ? renderSagaMovies(sagaParts, existingIds, true, onOpenSagaMovie)
    : "";

  target.innerHTML = `
    ${itemHeroHtml(item, { showUserRating: false })}
    <p class="item-preview__hint">Este título aún no está en tu registro.</p>
    ${unreleasedBadge}
    ${watchProvidersHtml(item)}
    <div class="field-group" id="preview-details">
      ${extraInfoHtml(item, { skipMetaBits: true, skipOverview: true, skipStatusFallback: true })}
      ${previewSeasonsHtml(item)}
      ${loading ? `<p class="extra-info__line" id="preview-loading">Cargando detalles…</p>` : ""}
    </div>
    ${sagaHtml}
    ${renderRecommendations(recommendations, existingIds, kind, true, onOpenRecommendation)}
    <div class="modal-actions">
      <button type="button" class="btn btn--outline" id="btn-preview-back">Volver</button>
      <button type="button" class="btn btn--accent-media" id="btn-preview-add">Añadir</button>
    </div>
  `;

  target.querySelector("#btn-preview-back").addEventListener("click", goBack);

  // Carruseles de elenco (issue #294): los botones «Ver en más
  // detalle» de la preview (producción/reparto) con los datos del ítem.
  wireCastCrewClicks(target, item);

  // Saga: añadir una película de la saga (mismo patrón que el callback
  // onAddSagaMovie de la ficha, modal-handlers.js).
  if (sagaParts) {
    target.querySelectorAll(".saga-card__add").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const movie = sagaParts[Number(btn.dataset.sagaIndex)];
        if (!movie) return;
        btn.disabled = true;
        btn.textContent = "Añadiendo…";
        try {
          await addSagaMovie(movie, pageCtx);
          existingIds.add(String(movie.externalId));
          btn.textContent = "Añadida";
          ui.showToast(`«${movie.title}» añadida a tu registro.`);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Añadir";
          ui.showToast("No se pudo añadir: " + err.message);
        }
      });
    });
    target.querySelectorAll(".saga-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const movie = sagaParts[Number(btn.dataset.sagaIndex)];
        if (movie) onOpenSagaMovie(movie);
      });
    });
  }

  // Recomendaciones: añadir y abrir la página del ítem (mismo patrón
  // que los callbacks onAddRecommendation/onOpenRecommendation de la
  // ficha, modal-handlers.js).
  if (recommendations.length) {
    target.querySelectorAll(".rec-card__add").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const rec = recommendations[Number(btn.dataset.recIndex)];
        if (!rec) return;
        if (await addFromRecommendation(rec, btn, pageCtx)) {
          existingIds.add(String(rec.externalId));
        }
      });
    });
    target.querySelectorAll(".rec-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rec = recommendations[Number(btn.dataset.recIndex)];
        if (rec) onOpenRecommendation(rec);
      });
    });
  }

  const addBtn = target.querySelector("#btn-preview-add");
  addBtn.addEventListener("click", () => addFromPreview(item, addBtn));

  requestAnimationFrame(() => {
    const title = target.querySelector(".item-hero__title");
    if (title && document.activeElement !== title) {
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
  });

  // Botón flotante de la vista previa: solo con la acción «Añadir»
  // (el ítem aún no está en el registro; issue #298).
  renderFab(item, "preview");
}

// Vista previa: pinta al momento con el resultado de búsqueda si lo
// hay y enriquece desde TMDB en segundo plano; por URL directa se
// consulta TMDB y se pinta cuando llega (patrón de la preview de
// búsqueda, issue #22). Issue #290: la preview final muestra la MISMA
// información del título que la ficha (badge, nota TMDB, tráiler,
// dónde verla, info ampliada, temporadas, saga y recomendaciones).
async function renderPreview(optimisticItem = null) {
  currentMode = "preview";
  removeFab(); // el FAB se pinta cuando llega la preview final (paintPreview)
  const token = currentToken;
  if (!token) return;

  const immediate = optimisticItem && optimisticItem.title
    ? {
        type: token.kind,
        externalId: token.externalId,
        title: optimisticItem.title,
        year: optimisticItem.year || "",
        coverUrl: optimisticItem.coverUrl || null,
        overview: optimisticItem.overview || "",
      }
    : null;

  // Pintado inmediato: con dato optimista se pinta la tarjeta con los
  // datos de búsqueda y el aviso de carga; sin optimista (URL directa
  // o ítem borrado desde otro dispositivo) se muestra un spinner en la
  // tarjeta hasta que lleguen los datos (antes quedaba vacía).
  let target = renderItemContent();
  if (immediate) {
    paintPreview(target, immediate, { loading: true });
  } else {
    target.innerHTML = `
      <div class="panel-loading" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>Cargando…</span>
      </div>`;
  }

  let details = null;
  try {
    details = await buildPreviewItem(token.kind, token.externalId);
  } catch (err) {
    details = null;
  }
  if (!isCurrent(token)) return;

  if (!details || !details.title) {
    // Sin datos de TMDB: si ya había render optimista se conserva (se
    // quita el aviso de carga); si no, estado de error con atrás.
    if (immediate) {
      paintPreview(target, immediate, { loading: false });
    } else {
      renderMessage(
        "No se pudo cargar la información",
        "Comprueba tu conexión y vuelve a intentarlo."
      );
    }
    return;
  }

  // Bloques no críticos (dónde verla, recomendaciones, saga) en
  // paralelo; los fallos degradan su bloque sin romper la preview.
  const extras = await loadPreviewExtras(token, details);
  if (!isCurrent(token)) return;

  // ¿Se añadió mientras cargaba? → ficha directamente.
  const found = await findInCollection(token);
  if (!isCurrent(token)) return;
  if (found) {
    renderFicha(found);
    return;
  }

  // Repintado completo único con detalles + extras (los extras están
  // cacheados 24 h; repintar dos veces añade parpadeo sin beneficio).
  if (immediate) Object.assign(immediate, details);
  const finalItem = immediate || details;
  Object.assign(finalItem, extras);
  target = renderItemContent();
  paintPreview(target, finalItem, { loading: false, ...extras });
}

/* ---------- Resolución del ítem ---------- */

// Busca el ítem de la ruta activa en la colección (memoria o
// Firestore si el grupo aún no tiene snapshot; issue #178).
async function findInCollection(token) {
  try {
    const items = await pageCtx.getGroupItemsResolved(groupFor(token.kind));
    return (items || []).find((i) => String(i.externalId) === token.externalId) || null;
  } catch (err) {
    return null;
  }
}

async function resolve(optimisticItem = null) {
  const token = currentToken;
  if (!token) return;
  const found = await findInCollection(token);
  if (!isCurrent(token)) return;
  if (found) {
    renderFicha(found);
    return;
  }
  // No está en el registro. Los ids manuales ("manual-…") no existen
  // en TMDB: el ítem se ha borrado desde otro dispositivo.
  if (token.externalId.startsWith("manual-")) {
    renderMessage(
      "Este ítem ya no está en tu registro",
      "Puede que lo hayas eliminado desde otro dispositivo. Usa la búsqueda para volver a encontrarlo."
    );
    return;
  }
  await renderPreview(optimisticItem);
}

// Tras añadir desde la preview: lectura directa de Firestore (el
// snapshot puede no haber llegado) y paso a la ficha completa.
// Devuelve el ítem ya en el registro (o null si no se encontró),
// para poder seguir encadenando acciones (p. ej. valorar).
async function refreshAfterAdd() {
  const token = currentToken;
  if (!token || !pageCtx.getCurrentUser()) return null;
  try {
    const items = await pageCtx.getItemsOnce(pageCtx.getCurrentUser().uid, token.kind);
    const found = (items || []).find((i) => String(i.externalId) === token.externalId);
    if (isCurrent(token) && found) {
      renderFicha(found);
      return found;
    }
  } catch (err) {
    // fallback: re-resolver desde el estado en memoria
  }
  if (isCurrent(token)) await resolve();
  return null;
}

/* ---------- API pública ---------- */

// Abre la página de detalle del ítem. optimisticItem: resultado de
// búsqueda del catálogo (opcional) para pintar al momento.
async function openPage(kind, externalId, optimisticItem = null) {
  currentToken = { kind: kind === "tv" ? "tv" : "movie", externalId: String(externalId) };
  visible = true;

  // Defensivo: cerrar modales que pudieran quedar abiertos (p. ej. la
  // ventana de valoración si se navegó con atrás) y el drawer lateral.
  ui.closeModal();
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar) {
    sidebar.classList.remove("is-open");
    document.getElementById("app-sidebar-backdrop")?.classList.add("hidden");
  }

  const view = viewEl();
  if (!view) return;
  view.classList.remove("hidden");
  document.body.classList.add("is-item-page");
  window.scrollTo(0, 0);
  renderLoading();

  // Sin sesión (recarga directa de una URL compartida): estado de
  // espera; al entrar, app.js re-aplica la ruta con router.applyRoute().
  if (!pageCtx.getCurrentUser()) {
    renderMessage(
      "Inicia sesión para ver la ficha",
      "Entra con tu cuenta de Google para ver la información de este título."
    );
    return;
  }
  if (ensureGroup) ensureGroup(groupFor(currentToken.kind));
  await resolve(optimisticItem);
}

// Cierra la página y restaura la cabecera clásica (☰/⚙).
function closePage() {
  visible = false;
  currentToken = null;
  currentMode = null;
  removeFab();
  document.body.classList.remove("is-item-page");
  const view = viewEl();
  if (view) view.classList.add("hidden");
  if (contentEl()) contentEl().innerHTML = "";
}

// Snapshot de Firestore del grupo: solo se re-renderiza en cambios
// ESTRUCTURALES (alta desde preview, borrado desde otro dispositivo).
// Las actualizaciones de datos de un ítem visible NO re-renderizan la
// ficha: interrumpiría al usuario (p. ej. mientras escribe una nota).
function notifyGroupChanged(group, items) {
  if (!visible || !currentToken) return;
  if (group !== groupFor(currentToken.kind)) return;
  const found = (items || []).find((i) => String(i.externalId) === currentToken.externalId);
  if (found) {
    // El ítem entró en el registro (alta desde preview): pasar a la
    // ficha. Si ya estaba en ficha, nada (los cambios los aplica el
    // propio render tras cada acción del usuario).
    if (currentMode === "preview") renderFicha(found);
  } else if (currentMode === "ficha") {
    // Ítem eliminado desde otro dispositivo → estado informativo o
    // vista previa (re-añadir) según el tipo de id.
    currentToken.externalId.startsWith("manual-")
      ? renderMessage(
          "Este ítem ya no está en tu registro",
          "Puede que lo hayas eliminado desde otro dispositivo. Usa la búsqueda para volver a encontrarlo."
        )
      : renderPreview(null);
  }
}

/* ---------- Navegación atrás ---------- */

// Botón atrás de la cabecera (y de los estados internos): vuelve a la
// pantalla previa con el historial del navegador; si no hay historial
// dentro de la app (acceso directo por URL), cae a la última pestaña
// de Ocio visible (issue #97). El fallback con timeout cubre el caso
// de back() que no cambia la ruta.
function goBack() {
  const fallback = () => {
    if (visible && parseHash().section === "item") {
      navigate(normalizeTabKey("ocio", getLastOcioKey()));
    }
  };
  if (window.history.length > 1) {
    window.history.back();
    setTimeout(fallback, 350);
  } else {
    navigate(normalizeTabKey("ocio", getLastOcioKey()));
  }
}

// Escape = volver, solo cuando la página está visible y no hay nada
// más abierto (modal, dropdown, drawer…). En fase de captura para
// decidir antes que los handlers de burbuja (modal-handlers cierra el
// modal en Escape; aquí no debe navegarse además).
function handleEscape(e) {
  if (e.key !== "Escape" || !visible) return;
  // Guardas: algo más abierto encima (modal, drawer, dropdowns de
  // búsqueda/notificaciones/perfil) o el foco en la cabecera (el
  // usuario está escribiendo en la búsqueda). Mismo patrón de
  // selectores que auto-hide-nav.js.
  if (
    document.querySelector(".modal:not(.hidden)") ||
    document.querySelector(".app-sidebar.is-open") ||
    document.querySelector(".global-search__results:not(.hidden)") ||
    document.querySelector("#notif-dropdown:not(.hidden)") ||
    document.querySelector("#profile-dropdown:not(.hidden)") ||
    document.activeElement?.closest(".search-bar-wrap, .app-header")
  ) {
    return;
  }
  // Menú del botón flotante abierto (issue #298): Escape lo cierra
  // sin navegar atrás; el foco vuelve al botón flotante.
  const fab = fabEl();
  if (fab?.classList.contains("is-open")) {
    e.preventDefault();
    closeFabMenu();
    fab.querySelector(".item-fab__toggle")?.focus();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  goBack();
}

/**
 * Inicializa la página de detalle de ítem (issue #285).
 * @param {Object} ctx - Contexto de datos del usuario (modelo app.js)
 * @param {Object} opts
 * @param {Function} [opts.ensureGroup] - Suscribe el grupo de datos si
 *   no está activo (app.js pasa ensureGroupSubscribed).
 * @returns {Object} API { openPage, closePage, notifyGroupChanged, isActive }
 */
export function setupItemPage(ctx, opts = {}) {
  pageCtx = ctx;
  ensureGroup = opts.ensureGroup || null;

  document.getElementById("btn-item-back")?.addEventListener("click", goBack);
  document.addEventListener("keydown", handleEscape, true);
  // Clic fuera del botón flotante (issue #298): cierra su menú.
  document.addEventListener("click", (e) => {
    const fab = fabEl();
    if (!fab || e.target.closest?.("#" + FAB_ID)) return;
    closeFabMenu();
  });

  return {
    openPage,
    closePage,
    notifyGroupChanged,
    isActive: () => visible,
  };
}