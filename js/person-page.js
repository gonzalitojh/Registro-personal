// =============================================================
// Página de detalle de una persona (issue #321).
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
//     (nacimiento/fallecimiento/lugar).
//   - Biografía (en español si TMDB la tiene; si no, se avisa).
//   - Películas y series en las que ha trabajado o trabajará
//     (combined_credits), separadas en «Actuación» (con el personaje)
//     y «Equipo» (con el puesto); cada crédito navega a la ficha del
//     título (#/ocio/peliculas|<series>/<id>), el historial vuelve a
//     la persona con atrás.
//   - Premios y nominaciones (Wikidata P166/P1411), con la misma
//     presentación que las fichas de títulos (awardsSectionHtml).
// =============================================================

import * as ui from "./ui.js";
import { getPersonDetails, getPersonAwards } from "./api-movies.js";
import { navigate, parseHash, getLastOcioKey } from "./router.js";
import { normalizeTabKey } from "./settings.js";
import { formatDateEs } from "./dates.js";
import { safePhotoUrl, translateDepartment } from "./cast-modal.js";

let personCtx = null;

// Ruta activa de la página: { personId }. Token anti-race: tras cada
// await se comprueba que la ruta no haya cambiado (atrás/adelante o
// nueva navegación) antes de pintar (patrón de item-page.js y del
// dropdown de búsqueda global).
let currentToken = null;
let visible = false;

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

/* ---------- Render de la persona ---------- */

// Línea(s) de datos de vida del hero: «Nació el 09/06/1963 en New
// York, USA» y «Falleció el 11/05/2004». Solo muestra lo que TMDB
// aporta; sin ninguno de los datos no se pinta la línea.
function lifeInfoHtml(person) {
  const parts = [];
  if (person.birthday) {
    let birth = `Nació el ${escapeHtml(formatDateEs(person.birthday))}`;
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

function biographyHtml(person) {
  if (!person.biography) {
    return `<p class="person-bio person-bio--empty">No hay biografía disponible en español para esta persona.</p>`;
  }
  return `<p class="person-bio">${escapeHtml(person.biography)}</p>`;
}

// Fila de crédito (issue #321): miniatura w92, título, año y, según
// la subsección, el personaje (actuación) o el puesto (equipo).
// Pulsable → ficha del título (botón real: teclado y lector de
// pantalla). La navegación se cablea con delegación en el render
// (los nodos de cada render son nuevos).
function creditRowHtml(credit) {
  return `
    <li class="person-credit">
      <button type="button" class="person-credit__btn" data-credit-id="${escapeHtml(credit.externalId)}" data-credit-kind="${credit.kind}"
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

// Subsección «Actuación» o «Equipo» con su contador. Sin créditos de
// ese tipo no se pinta nada (una persona puede ser solo actor o solo
// equipo; TMDB divida así combined_credits).
function creditsSectionHtml(title, credits, emptyMessage) {
  if (!credits || !credits.length) return "";
  return `
    <section class="person-credits__section">
      <h3 class="person-credits__title">${escapeHtml(title)} <span class="person-credits__count">(${credits.length})</span></h3>
      <ul class="person-credits__list">
        ${credits.map(creditRowHtml).join("")}
      </ul>
    </section>`;
}

function creditsHtml(person) {
  const acting = creditsSectionHtml("Actuación", person.castCredits);
  const crew = creditsSectionHtml("Equipo", person.crewCredits);
  if (!acting && !crew) {
    return `<p class="person-empty">No hay películas ni series registradas para esta persona.</p>`;
  }
  return `
    <section class="person-credits" aria-labelledby="person-credits-heading">
      <h2 class="person-section-title" id="person-credits-heading">Películas y series</h2>
      ${acting}${crew}
    </section>`;
}

// Render completo de la página. awards: resultado de getPersonAwards
// ([] o null → sin sección, igual que en las fichas de títulos).
function renderPerson(person, awards) {
  const awardsBlock = Array.isArray(awards) && awards.length
    ? `<section class="person-awards">${ui.awardsSectionHtml(awards)}</section>`
    : "";
  contentEl().innerHTML = `
    <div class="item-view__card person-card">
      ${personHeroHtml(person)}
      ${biographyHtml(person)}
      <hr class="person-separator" />
      ${creditsHtml(person)}
      ${awardsBlock}
    </div>`;
  wireCreditClicks();
  // Foco al nombre (patrón de las rutas de Ocio y de la página de ítem).
  const name = contentEl().querySelector(".person-hero__name");
  if (name) name.focus({ preventScroll: true });
}

// Cablea los créditos pulsables → ficha del título. Los nodos son de
// ESTE render (innerHTML acaba de sustituirse): los listeners no se
// duplican.
function wireCreditClicks() {
  contentEl().querySelectorAll("[data-credit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({
        section: "item",
        kind: btn.dataset.creditKind === "tv" ? "tv" : "movie",
        externalId: btn.dataset.creditId,
      });
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
// página de ítem.
function handleEscape(e) {
  if (e.key !== "Escape" || !visible) return;
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
 * Inicializa la página de detalle de persona (issue #321).
 * @param {Object} ctx - Contexto de datos del usuario (modelo app.js).
 * @returns {Object} API { openPage, closePage, isActive }
 */
export function setupPersonPage(ctx) {
  personCtx = ctx;

  document.getElementById("btn-person-back")?.addEventListener("click", goBack);
  document.addEventListener("keydown", handleEscape, true);

  return {
    openPage,
    closePage,
    isActive: () => visible,
  };
}