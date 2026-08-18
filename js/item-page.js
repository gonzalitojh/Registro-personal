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
//     acciones: visionados, temporadas, valoración, editar, borrar).
//   - El ítem NO está en el registro (resultado del catálogo o URL
//     compartida) → vista previa con los detalles de TMDB y botón
//     «Añadir»; al añadirlo, la página pasa a la ficha completa.
// Libros y videojuegos NO usan esta página (siguen con su modal).
// =============================================================

import * as ui from "./ui.js";
import {
  openMovieItem,
  openTvItem,
  setItemPageBackHandler,
  addSagaMovie,
  addFromRecommendation,
  openSagaSelector,
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
} from "./ui.js";
import { handleAdd } from "./search.js";
import { getLastOcioKey, navigate, parseHash } from "./router.js";
import { normalizeTabKey } from "./settings.js";
import { isUnreleasedDate } from "./release.js";

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

/* ---------- Ficha completa (ítem en el registro) ---------- */

function renderFicha(item) {
  currentMode = "ficha";
  const target = renderItemContent();
  const kind = item.type === "tv" ? "tv" : "movie";
  // Modo página: target = contenedor del contenido; los re-renders
  // (reopen) propagan el target y repintan en la página. El foco al
  // título lo gestiona ui.js en el modo página.
  if (kind === "tv") {
    openTvItem(item, pageCtx, false, target);
  } else {
    openMovieItem(item, pageCtx, false, target);
  }
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
// personal, notas, editar, eliminar) no aplican sin ítem en el
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
    ? `
    <div class="saga-banner">
      <span class="saga-banner__label"><strong>Saga:</strong> ${escapeHtml(item.collectionName || "")}</span>
      <button type="button" class="btn btn--small btn--accent-media" id="btn-add-saga">Añadir resto de la saga</button>
    </div>
    ${renderSagaMovies(sagaParts, existingIds, true, onOpenSagaMovie)}`
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

  // Saga: añadir una película de la saga (mismo patrón que el callback
  // onAddSagaMovie de la ficha, modal-handlers.js) y abrir el selector.
  const addSagaBtn = target.querySelector("#btn-add-saga");
  if (addSagaBtn) {
    addSagaBtn.addEventListener("click", () => {
      openSagaSelector(item, pageCtx);
    });
  }
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
  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Añadiendo…";
    try {
      const ok = await handleAdd(item, addBtn, pageCtx);
      if (ok) {
        // Alta completada: pasar a la ficha completa leyendo el ítem
        // recién creado (lectura directa de Firestore: el snapshot
        // del grupo puede no haber llegado aún).
        refreshAfterAdd();
      } else {
        addBtn.disabled = false;
        addBtn.textContent = "Añadir";
      }
    } catch (err) {
      addBtn.disabled = false;
      addBtn.textContent = "Añadir";
      ui.showToast("No se pudo añadir: " + (err && err.message ? err.message : err));
    }
  });

  requestAnimationFrame(() => {
    const title = target.querySelector(".item-hero__title");
    if (title && document.activeElement !== title) {
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
  });
}

// Vista previa: pinta al momento con el resultado de búsqueda si lo
// hay y enriquece desde TMDB en segundo plano; por URL directa se
// consulta TMDB y se pinta cuando llega (patrón de la preview de
// búsqueda, issue #22). Issue #290: la preview final muestra la MISMA
// información del título que la ficha (badge, nota TMDB, tráiler,
// dónde verla, info ampliada, temporadas, saga y recomendaciones).
async function renderPreview(optimisticItem = null) {
  currentMode = "preview";
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
async function refreshAfterAdd() {
  const token = currentToken;
  if (!token || !pageCtx.getCurrentUser()) return;
  try {
    const items = await pageCtx.getItemsOnce(pageCtx.getCurrentUser().uid, token.kind);
    const found = (items || []).find((i) => String(i.externalId) === token.externalId);
    if (isCurrent(token) && found) {
      renderFicha(found);
      return;
    }
  } catch (err) {
    // fallback: re-resolver desde el estado en memoria
  }
  if (isCurrent(token)) await resolve();
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

  // Hook de «volver» para modal-handlers (eliminar en modo página).
  setItemPageBackHandler(goBack);

  document.getElementById("btn-item-back")?.addEventListener("click", goBack);
  document.addEventListener("keydown", handleEscape, true);

  return {
    openPage,
    closePage,
    notifyGroupChanged,
    isActive: () => visible,
  };
}