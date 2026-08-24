// =============================================================
// Página de detalle de una persona (issue #321 + ajustes #324).
//
// Al pulsar una persona de los carruseles de producción/reparto de la
// ficha de una película/serie (issue #294), o una fila de la ventana
// «Ver en más detalle», la app abre una PÁGINA NUEVA
// (#/ocio/personas/<personId>) en lugar de quedarse en la ficha. La
// cabecera superior se respeta (búsqueda y perfil siguen activos),
// pero el ☰ (y el ⚙) se sustituyen por el botón atrás (swap por CSS
// con body.is-person-page; ver index.html y css/styles.css), igual
// que en la página de ítem (ADR-100).
//
// Esta vista es hermana de primer nivel de #item-view (fuera de
// #app) y reutiliza su layout (.item-view). Contenido — todo de
// TMDB/Wikidata, sin datos del usuario:
//   - Hero: foto, nombre, área conocida y datos de vida
//     (nacimiento/fallecimiento/lugar + edad calculada, issue #324).
//   - Biografía truncada a pocas líneas con botón Leer más → ventana
//     modal con la biografía completa (issue #324).
//   - Películas y series en las que ha trabajado o trabajará
//     (combined_credits), separadas en «Actuación» (con el personaje)
//     y «Equipo» (con el puesto) EN MODO CARRUSEL con botón expandir
//     y búsqueda dentro de la ventana expandida (issue #324).
//   - Premios y nominaciones (Wikidata P166/P1411), con la misma
//     presentación que las fichas de títulos (awardsSectionHtml).
//
// Issue #324: la ficha YA NO va enmarcada en .item-view__card; va
// directa sobre el fondo de .item-view (igual que la ficha de título
// tras ADR-103/ADR-104), para eliminar el recuadro.
// =============================================================

import * as ui from "./ui.js";
import { getPersonDetails, getPersonAwards } from "./api-movies.js";
import { navigate, parseHash, getLastOcioKey } from "./router.js";
import { normalizeTabKey } from "./settings.js";
import { formatDateEs } from "./dates.js";
import { safePhotoUrl, translateDepartment } from "./cast-modal.js";
import { trapFocus } from "./focus-utils.js";

let personCtx = null;

// Ruta activa de la página: { personId }. Token anti-race: tras cada
// await se comprueba que la ruta no haya cambiado (atrás/adelante o
// nueva navegación) antes de pintar (patrón de item-page.js y del
// dropdown de búsqueda global).
let currentToken = null;
let visible = false;
// Última persona renderizada (para las ventanas de biografía y de
// filmografía expandida).
let lastPerson = null;
let lastAwards = null;

const CONTENT_ID = "person-view-content";

function viewEl() {
  return document.getElementById("person-view");
}
function contentEl() {
  return document.getElementById(CONTENT_ID);
}

// Escapado HTML mínimo local (ui.js no exporta su escapeHtml; mismo
// patrón que item-page.js).
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
  return visible && currentToken && currentToken.personId === token.personId;
}

/* ---------- Estados de la página ---------- */

function renderLoading() {
  contentEl().innerHTML = `
    <div class="item-view__card" aria-live="polite">
      <div class="panel-loading" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>Cargando…</span>
      </div>
    </div>`;
}

// Estado informativo (sin sesión, error de carga) con botón atrás
// propio además del de la cabecera.
function renderMessage(title, text) {
  contentEl().innerHTML = `
    <div class="item-view__card" role="alert">
      <h3 class="modal-detail__title" tabindex="-1">${escapeHtml(title)}</h3>
      <p class="extra-info__line">${escapeHtml(text)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn--primary" id="btn-person-msg-back">Volver</button>
      </div>
    </div>`;
  const backBtn = contentEl().querySelector("#btn-person-msg-back");
  if (backBtn) backBtn.addEventListener("click", goBack);
  document.getElementById("btn-person-back")?.focus();
}

/* ---------- Helpers de edad (issue #324) ---------- */

// Calcula la edad en años entre birthday (YYYY-MM-DD) y la fecha de
// referencia (deathday o hoy). Protegido ante fechas inválidas: si no
// se puede parsear, devuelve null. Cálculo por calendario (mes/día).
function calcAge(birthIso, refIso) {
  if (!birthIso || typeof birthIso !== "string") return null;
  const partsB = birthIso.split("-");
  if (partsB.length !== 3) return null;
  const yB = Number(partsB[0]);
  const mB = Number(partsB[1]);
  const dB = Number(partsB[2]);
  if (!yB || !mB || !dB) return null;
  let refDate;
  if (refIso && typeof refIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(refIso)) {
    refDate = new Date(refIso + "T00:00:00");
  } else {
    refDate = new Date();
  }
  if (Number.isNaN(refDate.getTime())) return null;
  const bDate = new Date(birthIso + "T00:00:00");
  if (Number.isNaN(bDate.getTime())) return null;
  let age = refDate.getFullYear() - bDate.getFullYear();
  const m = refDate.getMonth() - bDate.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < bDate.getDate())) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

// Línea(s) de datos de vida del hero: «Nació el 09/06/1963 (62 años)
// en New York, USA» y «Falleció el 11/05/2004». Si hay cumpleaños se
// calcula la edad (actual si vive, al fallecer si hay deathday).
function lifeInfoHtml(person) {
  const parts = [];
  if (person.birthday) {
    const refIso = person.deathday || null;
    const age = calcAge(person.birthday, refIso);
    let birth = `Nació el ${escapeHtml(formatDateEs(person.birthday))}`;
    if (age !== null) birth += ` (${age} años)`;
    if (person.placeOfBirth) birth += ` en ${escapeHtml(person.placeOfBirth)}`;
    parts.push(birth);
  }
  if (person.deathday) {
    parts.push(`Falleció el ${escapeHtml(formatDateEs(person.deathday))}`);
  }
  return parts.length ? `<p class="person-hero__life">${parts.join(" · ")}</p>` : "";
}

function personHeroHtml(person) {
  const knownFor = person.knownForDepartment
    ? translateDepartment(person.knownForDepartment)
    : "";
  return `
    <header class="person-hero">
      <img class="person-hero__photo" src="${escapeHtml(safePhotoUrl(person.profileUrl))}"
           alt="" loading="lazy" />
      <div class="person-hero__info">
        <h1 class="person-hero__name" tabindex="-1">${escapeHtml(person.name)}</h1>
        ${knownFor ? `<p class="person-hero__known">${escapeHtml(knownFor)}</p>` : ""}
        ${lifeInfoHtml(person)}
      </div>
    </header>`;
}

/* ---------- Biografía truncada + ventana Leer más (issue #324) ---------- */

function biographyHtml(person) {
  if (!person.biography) {
    return `<p class="person-bio person-bio--empty">No hay biografía disponible en español para esta persona.</p>`;
  }
  // La biografía se muestra truncada a 4 líneas por CSS (--clamp); el
  // botón Leer más se muestra solo cuando el texto supera el clamp o
  // es largo (>220 caracteres). La ventana completa va en
  // #person-bio-modal.
  return `
    <div class="person-bio-wrap">
      <p class="person-bio person-bio--clamp" id="person-bio-clamped">${escapeHtml(person.biography)}</p>
      <button type="button" class="btn btn--outline btn--small person-bio__more hidden" id="btn-person-bio-more"
              aria-haspopup="dialog" aria-controls="person-bio-modal">Leer más</button>
    </div>`;
}

/* ---------- Filmografía en carrusel + expandida con búsqueda (issue #324) ---------- */

// Tarjeta horizontal de crédito en carrusel (similar a .cast-card pero
// con poster + título + meta; reutiliza safePhotoUrl y navegación).
function creditCardHtml(credit) {
  return `
    <button type="button" class="person-credit-card" data-credit-id="${escapeHtml(credit.externalId)}" data-credit-kind="${escapeHtml(credit.kind)}"
            aria-label="Ver la ficha de ${escapeHtml(credit.title)}">
      <img class="person-credit-card__poster" src="${escapeHtml(safePhotoUrl(credit.posterUrl))}" alt="" loading="lazy" />
      <span class="person-credit-card__body">
        <span class="person-credit-card__title">${escapeHtml(credit.title)}</span>
        <span class="person-credit-card__meta">
          ${credit.year ? `<span class="person-credit-card__year">${escapeHtml(credit.year)}</span>` : ""}
          ${credit.role ? `<span class="person-credit-card__role">${escapeHtml(credit.role)}</span>` : ""}
        </span>
      </span>
    </button>`;
}

// Fila de crédito para la ventana expandida (lista vertical con buscador,
// igual que la lista legacy pero ahora dentro del modal expandido).
function creditRowHtml(credit) {
  return `
    <li class="person-credit">
      <button type="button" class="person-credit__btn" data-credit-id="${escapeHtml(credit.externalId)}" data-credit-kind="${escapeHtml(credit.kind)}"
              aria-label="Ver la ficha de ${escapeHtml(credit.title)}">
        <img class="person-credit__poster" src="${escapeHtml(safePhotoUrl(credit.posterUrl))}" alt="" loading="lazy" />
        <span class="person-credit__info">
          <span class="person-credit__title">${escapeHtml(credit.title)}</span>
          <span class="person-credit__meta">
            ${credit.year ? `<span class="person-credit__year">${escapeHtml(credit.year)}</span>` : ""}
            ${credit.role ? `<span class="person-credit__role">${escapeHtml(credit.role)}</span>` : ""}
          </span>
        </span>
      </button>
    </li>`;
}

// Subsección «Actuación» o «Equipo» EN MODO CARRUSEL. Sin créditos de
// ese tipo se devuelve "" (no se pinta nada). Cada carrusel lleva botón
// Expandir que abre la ventana modal con buscador.
function creditsSectionHtml(title, credits, kind) {
  if (!credits || !credits.length) return "";
  const key = kind === "cast" ? "cast" : "crew";
  return `
    <section class="person-credits__section" data-section="${escapeHtml(key)}">
      <div class="person-credits__head">
        <h3 class="person-credits__title">${escapeHtml(title)} <span class="person-credits__count">(${credits.length})</span></h3>
        <button type="button" class="btn btn--pill person-credits__expand" data-expand="${escapeHtml(key)}"
                aria-haspopup="dialog" aria-controls="person-credits-modal" aria-label="Ver todos los títulos de ${escapeHtml(title)}">
          Ver todo
        </button>
      </div>
      <div class="person-credits__scroll" role="list">
        ${credits.map(creditCardHtml).join("")}
      </div>
    </section>`;
}

function creditsHtml(person) {
  const acting = creditsSectionHtml("Actuación", person.castCredits, "cast");
  const crew = creditsSectionHtml("Equipo", person.crewCredits, "crew");
  if (!acting && !crew) {
    return `<p class="person-empty">No hay películas ni series registradas para esta persona.</p>`;
  }
  return `
    <section class="person-credits" aria-labelledby="person-credits-heading">
      <h2 class="person-section-title" id="person-credits-heading">Películas y series</h2>
      ${acting}${crew}
    </section>`;
}

/* ---------- Ventana de biografía completa ---------- */

let bioModalCleanup = null;
let bioModalPrevFocus = null;

function getBioModal() {
  return document.getElementById("person-bio-modal");
}
function getBioModalContent() {
  return document.getElementById("person-bio-modal-content");
}

function closeBioModal() {
  const modal = getBioModal();
  if (!modal || modal.classList.contains("hidden")) return;
  if (bioModalCleanup) {
    bioModalCleanup();
    bioModalCleanup = null;
  }
  modal.classList.add("hidden");
  getBioModalContent().innerHTML = "";
  if (bioModalPrevFocus && document.contains(bioModalPrevFocus)) {
    bioModalPrevFocus.focus();
  }
  bioModalPrevFocus = null;
}

function openBioModal(fullText) {
  const modal = getBioModal();
  const content = getBioModalContent();
  if (!modal || !content) return;
  bioModalPrevFocus = document.activeElement;
  content.innerHTML = `
    <h3 class="modal-detail__title">Biografía</h3>
    <p class="person-bio person-bio--full">${escapeHtml(fullText)}</p>
  `;
  modal.classList.remove("hidden");
  const card = modal.querySelector(".modal__card");
  if (card) bioModalCleanup = trapFocus(card);
  modal.querySelector("#person-bio-modal-close")?.focus();
}

/* ---------- Ventana expandida de filmografía con búsqueda ---------- */

let creditsModalCleanup = null;
let creditsModalPrevFocus = null;
let creditsModalState = { title: "", credits: [] };

function getCreditsModal() {
  return document.getElementById("person-credits-modal");
}
function getCreditsModalContent() {
  return document.getElementById("person-credits-modal-content");
}

function filterCreditsByQuery(credits, query) {
  const q = (query || "").trim().toLocaleLowerCase("es");
  if (!q) return credits;
  return credits.filter((c) => {
    const title = (c.title || "").toLocaleLowerCase("es");
    const role = (c.role || "").toLocaleLowerCase("es");
    const year = (c.year || "").toLocaleLowerCase("es");
    return title.includes(q) || role.includes(q) || year.includes(q);
  });
}

function creditsExpandedListHtml(credits, query) {
  const filtered = filterCreditsByQuery(credits, query);
  if (!filtered.length) {
    const msg = (query || "").trim()
      ? `No hay resultados para «${escapeHtml((query || "").trim())}».`
      : "No hay títulos en esta sección.";
    return `<p class="cast-modal__empty">${msg}</p>`;
  }
  return `<ul class="person-credits__list">${filtered.map(creditRowHtml).join("")}</ul>`;
}

const CREDITS_SEARCH_ICON = `
  <svg class="cast-modal__search-icon" viewBox="0 0 24 24" width="16" height="16"
       fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
       aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="15.8" y2="15.8" />
  </svg>`;

function closeCreditsModal() {
  const modal = getCreditsModal();
  if (!modal || modal.classList.contains("hidden")) return;
  if (creditsModalCleanup) {
    creditsModalCleanup();
    creditsModalCleanup = null;
  }
  modal.classList.add("hidden");
  getCreditsModalContent().innerHTML = "";
  if (creditsModalPrevFocus && document.contains(creditsModalPrevFocus)) {
    creditsModalPrevFocus.focus();
  }
  creditsModalPrevFocus = null;
}

function openCreditsModal({ title, credits }) {
  const modal = getCreditsModal();
  const content = getCreditsModalContent();
  if (!modal || !content) return;
  creditsModalState = { title, credits: Array.isArray(credits) ? credits : [] };
  creditsModalPrevFocus = document.activeElement;
  const count = creditsModalState.credits.length;
  const placeholder = "Buscar por título, personaje o puesto…";
  content.innerHTML = `
    <div class="cast-modal__header">
      <h3 class="cast-modal__title">${escapeHtml(title)}</h3>
      <p class="cast-modal__subtitle">${count} títulos</p>
    </div>
    <div class="cast-modal__search">
      ${CREDITS_SEARCH_ICON}
      <input type="text" class="cast-modal__search-input" id="person-credits-search"
             placeholder="${placeholder}"
             aria-label="Buscar en ${escapeHtml(title)}"
             autocomplete="off" spellcheck="false">
    </div>
    <div class="person-credits__expanded-body" id="person-credits-expanded-body">
      ${creditsExpandedListHtml(creditsModalState.credits, "")}
    </div>
  `;
  modal.classList.remove("hidden");
  const card = modal.querySelector(".modal__card");
  if (card) creditsModalCleanup = trapFocus(card);

  const input = content.querySelector("#person-credits-search");
  const body = content.querySelector("#person-credits-expanded-body");
  if (input && body) {
    input.addEventListener("input", () => {
      body.innerHTML = creditsExpandedListHtml(creditsModalState.credits, input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && input.value) {
        e.stopPropagation();
        input.value = "";
        body.innerHTML = creditsExpandedListHtml(creditsModalState.credits, "");
      }
    });
    // Delegación para clicks en el listado expandido → ficha
    body.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-credit-id]");
      if (!btn) return;
      e.preventDefault();
      closeCreditsModal();
      navigate({
        section: "item",
        kind: btn.dataset.creditKind === "tv" ? "tv" : "movie",
        externalId: btn.dataset.creditId,
      });
    });
    // Foco inicial al buscador si hay muchos títulos, si no al cierre
    if (count > 8) input.focus();
    else modal.querySelector("#person-credits-modal-close")?.focus();
  }
}

/* ---------- Render completo de la página (sin recuadro, issue #324) ---------- */

function renderPerson(person, awards) {
  lastPerson = person;
  lastAwards = awards;
  const awardsBlock = Array.isArray(awards) && awards.length
    ? `<section class="person-awards">${ui.awardsSectionHtml(awards)}</section>`
    : "";
  // Issue #324: la ficha ya NO va enmarcada en .item-view__card; va
  // directa sobre el fondo de .item-view (como la ficha de título tras
  // ADR-103). La clase .person-page es el contenedor sin recuadro.
  contentEl().innerHTML = `
    <div class="person-page">
      ${personHeroHtml(person)}
      ${biographyHtml(person)}
      <hr class="person-separator" />
      ${creditsHtml(person)}
      ${awardsBlock}
    </div>`;
  wireBioModal();
  wireCreditInteractions();
  // Foco al nombre (patrón de las rutas de Ocio y de la página de ítem).
  const name = contentEl().querySelector(".person-hero__name");
  if (name) name.focus({ preventScroll: true });
}

// Decide si mostrar el botón Leer más: si la biografía es larga
// (>220 caracteres) o si el clamp corta (scrollHeight > clientHeight).
function wireBioModal() {
  const bio = document.getElementById("person-bio-clamped");
  const btn = document.getElementById("btn-person-bio-more");
  if (!bio || !btn || !lastPerson || !lastPerson.biography) return;
  const full = String(lastPerson.biography);
  const needsButton = full.length > 220;
  // Evaluación de clamp: tras pintar, si el texto se recorta el
  // scrollHeight supera al clientHeight.
  requestAnimationFrame(() => {
    const isClamped = bio.scrollHeight > bio.clientHeight + 2;
    if (needsButton || isClamped) {
      btn.classList.remove("hidden");
      btn.addEventListener("click", () => openBioModal(full));
    } else {
      // Biografía corta: quitar el clamp para que no deje hueco extra
      bio.classList.remove("person-bio--clamp");
      btn.classList.add("hidden");
    }
  });
}

// Cablea los carruseles pulsables y los botones expandir → ventana con búsqueda.
function wireCreditInteractions() {
  if (!lastPerson) return;
  // Clicks en tarjetas del carrusel → ficha del título
  contentEl().querySelectorAll(".person-credit-card[data-credit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({
        section: "item",
        kind: btn.dataset.creditKind === "tv" ? "tv" : "movie",
        externalId: btn.dataset.creditId,
      });
    });
  });
  // Botones Ver todo → modal expandido
  contentEl().querySelectorAll("[data-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.expand;
      if (key === "cast") {
        openCreditsModal({ title: "Actuación", credits: lastPerson.castCredits || [] });
      } else {
        openCreditsModal({ title: "Equipo", credits: lastPerson.crewCredits || [] });
      }
    });
  });
}

/* ---------- Resolución de datos ---------- */

// Carga los datos (detalles + premios en paralelo; los premios nunca
// rompen la página: Promise.allSettled). Tras cada await se
// comprueba el token anti-race antes de pintar.
async function resolve(personId) {
  const token = { personId: String(personId) };
  const [detailsResult, awardsResult] = await Promise.allSettled([
    getPersonDetails(token.personId),
    getPersonAwards(token.personId),
  ]);
  if (!isCurrent(token)) return;

  const person = detailsResult.status === "fulfilled" ? detailsResult.value : null;
  if (!person || !person.name) {
    renderMessage(
      "No se pudo cargar la información de esta persona",
      "Comprueba tu conexión e inténtalo de nuevo."
    );
    return;
  }
  renderPerson(
    person,
    awardsResult.status === "fulfilled" ? awardsResult.value : null
  );
}

/* ---------- API pública ---------- */

// Abre la página de detalle de la persona.
async function openPage(personId) {
  currentToken = { personId: String(personId) };
  visible = true;

  // Defensivo: cerrar modales que pudieran quedar abiertos y el
  // drawer lateral (mismo patrón que la página de ítem).
  ui.closeModal();
  closeBioModal();
  closeCreditsModal();
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar) {
    sidebar.classList.remove("is-open");
    document.getElementById("app-sidebar-backdrop")?.classList.add("hidden");
  }

  const view = viewEl();
  if (!view) return;
  view.classList.remove("hidden");
  document.body.classList.add("is-person-page");
  window.scrollTo(0, 0);
  renderLoading();

  // Sin sesión (recarga directa de una URL compartida): estado de
  // espera; al entrar, app.js re-aplica la ruta con router.applyRoute().
  if (!personCtx.getCurrentUser()) {
    renderMessage(
      "Inicia sesión para ver la información de esta persona",
      "Entra con tu cuenta de Google para ver su biografía, películas y premios."
    );
    return;
  }
  await resolve(currentToken.personId);
}

// Cierra la página y restaura la cabecera clásica (☰/⚙).
function closePage() {
  visible = false;
  currentToken = null;
  lastPerson = null;
  lastAwards = null;
  closeBioModal();
  closeCreditsModal();
  document.body.classList.remove("is-person-page");
  const view = viewEl();
  if (view) view.classList.add("hidden");
  if (contentEl()) contentEl().innerHTML = "";
}

/* ---------- Navegación atrás ---------- */

// Botón atrás de la cabecera (y de los estados internos): vuelve a la
// pantalla previa con el historial del navegador; si no hay historial
// dentro de la app (acceso directo por URL), cae a la última pestaña
// de Ocio visible (issue #97). El fallback con timeout cubre el caso
// de back() que no cambia la ruta. Mismo contrato que item-page.js.
function goBack() {
  // Si hay una ventana de persona abierta, cerrarla primero (como los
  // modales) antes de navegar atrás.
  if (!getBioModal()?.classList.contains("hidden")) {
    closeBioModal();
    return;
  }
  if (!getCreditsModal()?.classList.contains("hidden")) {
    closeCreditsModal();
    return;
  }
  const fallback = () => {
    if (visible && parseHash().section === "person") {
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
// decidir antes que los handlers de burbuja. Mismas guardas que la
// página de ítem, más las dos ventanas nuevas de persona.
function handleEscape(e) {
  if (e.key !== "Escape") return;
  // Prioridad: cerrar las ventanas de persona si están abiertas
  if (!getBioModal()?.classList.contains("hidden")) {
    e.preventDefault();
    e.stopPropagation();
    closeBioModal();
    return;
  }
  if (!getCreditsModal()?.classList.contains("hidden")) {
    e.preventDefault();
    e.stopPropagation();
    closeCreditsModal();
    return;
  }
  if (!visible) return;
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
 * Inicializa la página de detalle de persona (issue #321 + #324).
 * @param {Object} ctx - Contexto de datos del usuario (modelo app.js).
 * @returns {Object} API { openPage, closePage, isActive }
 */
export function setupPersonPage(ctx) {
  personCtx = ctx;

  document.getElementById("btn-person-back")?.addEventListener("click", goBack);
  document.addEventListener("keydown", handleEscape, true);

  // Cierres de las dos ventanas nuevas (backdrop + ✕), patrón de
  // cast-modal.js: listeners únicos al cargar el módulo.
  document.getElementById("person-bio-modal-close")?.addEventListener("click", closeBioModal);
  document.getElementById("person-bio-modal-backdrop")?.addEventListener("click", closeBioModal);
  document.getElementById("person-credits-modal-close")?.addEventListener("click", closeCreditsModal);
  document.getElementById("person-credits-modal-backdrop")?.addEventListener("click", closeCreditsModal);

  return {
    openPage,
    closePage,
    isActive: () => visible,
  };
}
