// =============================================================
// Barra lateral de navegación (issue #46) — drawer fijo a la
// izquierda estilo Gmail. Se abre con el botón hamburguesa de la
// cabecera (#btn-sidebar-toggle), se cierra con Escape (listener
// temporal, patrón de notifications-setup.js), clic en el backdrop,
// botón ✕ o al pulsar una entrada.
// Las entradas viven en el array SECTIONS (exportado): para añadir
// una sección futura solo hay que añadir una entrada, sin tocar el
// resto del módulo. Las entradas con `pinned: true` se renderizan
// en el footer inferior (#app-sidebar-footer), separadas del resto
// (issue #75: «Ajustes» bajo «Ocio»).
// =============================================================

import { trapFocus } from "./focus-utils.js";
import { closeGlobalSearch, isGlobalSearchOpen } from "./global-search.js";
import { navigate, getLastRecipesTab, getLastGymTab } from "./router.js";

// Entradas de la barra lateral: { id, label, icon, onClick, pinned }.
// "Ocio" es la web actual (pestañas Series / Películas / Libros);
// al pulsarla se cierra el drawer, se hace scroll suave al top y se
// vuelve a la primera pestaña sincronizando la URL (issue #59).
// "Recetas" (issue #64) abre la nueva sección de recetas
// (#/recetas, pestaña que quedó activa la última vez).
// "Ajustes" (pinned) abre el perfil en la sección Ajustes: el
// callback lo inyecta app.js vía setupSidebar({ onOpenSettings }).
export const SECTIONS = [
  {
    id: "ocio",
    label: "Ocio",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>`,
    onClick: () => {
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        window.scrollTo(0, 0);
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      // Volver a la primera pestaña (Series) sincronizando la URL:
      // el callback lo inyecta app.js vía setupSidebar({ onGoOcio }).
      if (onGoOcio) onGoOcio();
    },
  },
  {
    id: "recetas",
    label: "Recetas",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 11h16a1.6 1.6 0 0 1 1.6 1.6V14A5.6 5.6 0 0 1 16 19.6H8A5.6 5.6 0 0 1 2.4 14v-1.4A1.6 1.6 0 0 1 4 11z" />
      <path d="M2.5 12.3h19" />
      <path d="M8.5 8.5h7" />
      <path d="M7.5 5.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0" />
    </svg>`,
    onClick: () => {
      // Abrir la sección Recetas sincronizando la URL: vuelve a la
      // pestaña que quedó activa la última vez (issue #64).
      navigate({ section: "recetas", tab: getLastRecipesTab() });
    },
  },
  {
    id: "gimnasio",
    label: "Gimnasio",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6.5 6.5 17.5 17.5" />
      <path d="M21 17 17 21" />
      <path d="M3 7 7 3" />
      <path d="m2.5 12.5 9-9" />
      <path d="m12.5 2.5 9 9" />
      <path d="M6 21h.01" />
      <path d="M18 3h.01" />
    </svg>`,
    onClick: () => {
      // Abrir la sección Gimnasio sincronizando la URL: vuelve a la
      // pestaña que quedó activa la última vez (issue #62).
      navigate({ section: "gimnasio", tab: getLastGymTab() });
    },
  },
  {
    id: "settings",
    label: "Ajustes",
    pinned: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>`,
    onClick: () => {
      if (openSettings) openSettings();
    },
  },
];

// Callbacks de módulo inyectados por app.js en setupSidebar:
// openSettings para «Ajustes» y onGoOcio para «Ocio» (router de hash).
let openSettings = null;
let onGoOcio = null;

// Sección activa para el marcado de la barra lateral (issue #206,
// iteración 2026-08-11): antes el marcado estaba fijo en «Ocio» y no
// cambiaba al navegar. La actualiza app.js vía setActiveSection en
// cada cambio de ruta; renderSidebar la respeta al re-renderizar.
let activeSection = "ocio";

// Predicado de visibilidad de secciones, inyectado por app.js vía
// setupSidebar({ isSectionVisible }) (issue #97): con solo una
// sección visible la barra lateral no tiene sentido y se sustituye
// por el botón de Ajustes #btn-header-settings de la cabecera.
let isSectionVisible = () => true;

// Elementos DOM resueltos en setupSidebar; los reutilizan
// renderSidebar y updateHeaderNavButtons (issue #97), que se llaman
// también desde app.js cuando cambian las secciones visibles.
let sidebar = null;
let backdrop = null;
let toggle = null;
let closeBtn = null;
let nav = null;
let footer = null;
let headerSettings = null;

let focusTrapCleanup = null;

export function setupSidebar(opts) {
  openSettings = opts?.onOpenSettings || null;
  onGoOcio = opts?.onGoOcio || null;
  isSectionVisible = opts?.isSectionVisible || (() => true);

  sidebar = document.getElementById("app-sidebar");
  backdrop = document.getElementById("app-sidebar-backdrop");
  toggle = document.getElementById("btn-sidebar-toggle");
  closeBtn = document.getElementById("btn-sidebar-close");
  nav = document.getElementById("app-sidebar-nav");
  footer = document.getElementById("app-sidebar-footer");
  headerSettings = document.getElementById("btn-header-settings");

  if (!sidebar || !backdrop || !toggle || !closeBtn || !nav) {
    console.warn("sidebar: elementos DOM no encontrados");
    return;
  }

  // El botón engranaje de la cabecera (issue #97) abre Ajustes,
  // igual que la entrada pinned de la barra lateral.
  headerSettings?.addEventListener("click", () => {
    if (openSettings) openSettings();
  });

  toggle.addEventListener("click", () => {
    // Orden deliberado (issue #253): PRIMERO el drawer, LUEGO la
    // búsqueda. openGlobalSearch marca isOpen=true antes de disparar
    // toggle.click() para auto-cerrar el drawer; si este check de la
    // búsqueda fuera el primero, ese click interno no cerraría la
    // barra lateral y su backdrop taparía el dropdown.
    if (sidebar.classList.contains("is-open")) {
      closeSidebar();
    } else if (isGlobalSearchOpen()) {
      // Modo ✕: con la búsqueda abierta, la hamburguesa se convierte
      // en una ✕ (animación CSS, clase is-search-open) y pulsarla
      // cierra la búsqueda en lugar de abrir el menú lateral.
      closeGlobalSearch();
    } else {
      openSidebar();
    }
  });

  closeBtn.addEventListener("click", closeSidebar);
  backdrop.addEventListener("click", closeSidebar);

  // Escape cierra el drawer solo si está abierto (listener único,
  // registrado una vez: sin leaks al abrir/cerrar repetidamente).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
      e.preventDefault();
      closeSidebar();
    }
  });

  // Pulsar una entrada (nav o footer): cerrar el drawer y ejecutar
  // su acción. El botón ✕ usa #btn-sidebar-close con clase
  // app-sidebar__close, no interfiere con este delegado.
  sidebar.addEventListener("click", (e) => {
    const btn = e.target.closest(".app-sidebar__link");
    if (!btn) return;
    const section = SECTIONS.find((s) => s.id === btn.dataset.section);
    closeSidebar();
    if (section && section.onClick) section.onClick();
  });

  // Estado inicial: entre ☰ y ⚙ según el número de secciones visibles.
  renderSidebar();
}

function openSidebar() {
  sidebar.classList.add("is-open");
  backdrop.classList.remove("hidden");
  sidebar.setAttribute("aria-hidden", "false");
  toggle.setAttribute("aria-expanded", "true");

  // Si el dropdown de búsqueda está abierto, cerrarlo: el backdrop
  // del drawer (z-index 55) lo taparía (z-index 40).
  closeGlobalSearch();

  // Atrapar foco dentro del drawer mientras esté abierto
  focusTrapCleanup = trapFocus(sidebar);
}

function closeSidebar() {
  sidebar.classList.remove("is-open");
  backdrop.classList.add("hidden");
  sidebar.setAttribute("aria-hidden", "true");
  toggle.setAttribute("aria-expanded", "false");

  if (focusTrapCleanup) {
    focusTrapCleanup();
    focusTrapCleanup = null;
  }

  // Restaurar foco al botón hamburguesa. Cuando solo queda una sección
  // visible el toggle queda oculto (clase hidden) pero sigue en el DOM;
  // el guard es por robustez si faltara el elemento.
  if (toggle) toggle.focus();
}

// Número de secciones (no pinned) visibles según el predicado
// inyectado. Con <= 1, la barra lateral se sustituye por el engranaje.
function visibleSectionCount() {
  return SECTIONS.filter((s) => !s.pinned && isSectionVisible(s.id)).length;
}

// Decide entre el toggle ☰ y el botón de Ajustes ⚙ de la cabecera.
function updateHeaderNavButtons() {
  const count = visibleSectionCount();
  if (toggle) toggle.classList.toggle("hidden", count <= 1);
  if (headerSettings) headerSettings.classList.toggle("hidden", count > 1);
}

// Re-render de la barra lateral tras cambios de visibilidad de
// secciones (issue #97). Lo llama app.js vía refreshNavigation.
export function renderSidebar() {
  if (!nav || !footer) return;

  // Si el drawer está abierto y va a quedar sin secciones que listar,
  // cerrarlo primero (evita un drawer abierto y vacío).
  if (sidebar && sidebar.classList.contains("is-open") && visibleSectionCount() <= 1) {
    closeSidebar();
  }

  // Render de las entradas a partir del array SECTIONS. Los ids son
  // literales controlados por este módulo (sin datos de usuario).
  // Solo se listan las secciones visibles; las pinned (p. ej.
  // «Ajustes») van siempre al footer. La sección activa (marcada con
  // .is-active) la decide setActiveSection desde app.js.
  nav.innerHTML = SECTIONS.filter((s) => !s.pinned && isSectionVisible(s.id))
    .map(
      (s) => `<button type="button" class="app-sidebar__link${s.id === activeSection ? " is-active" : ""}"
               data-section="${s.id}">
        <span aria-hidden="true">${s.icon}</span>
        <span>${s.label}</span>
      </button>`
    )
    .join("");

  // Footer inferior: entradas pinned (p. ej. «Ajustes»), separadas
  // visualmente del resto por una línea. Si el contenedor no existe
  // (HTML antiguo), no hacemos nada: defensivo.
  // (Sin filtro de visibilidad: son secciones de utilidad, no
  // contenido ocultable.)
  footer.innerHTML = SECTIONS.filter((s) => s.pinned)
    .map(
      (s) => `<button type="button" class="app-sidebar__link${s.id === activeSection ? " is-active" : ""}"
               data-section="${s.id}">
        <span aria-hidden="true">${s.icon}</span>
        <span>${s.label}</span>
      </button>`
    )
    .join("");

  updateHeaderNavButtons();
}

// Marca la entrada de la sección activa en la barra lateral (issue
// #206, iteración 2026-08-11): al cambiar de sección (Ocio, Recetas
// o Ajustes vía el perfil), el marcado .is-active debe moverse y no
// quedar anclado a «Ocio». Lo llama app.js en el onRoute del router.
// Recibe el id de sección del array SECTIONS (ocio, recetas,
// settings) o null para no marcar ninguna (p. ej. en el perfil fuera
// de Ajustes, que no tiene entrada propia en la barra).
export function setActiveSection(sectionId) {
  activeSection = sectionId || null;
  // Aplicar el marcado sin re-renderizar: las entradas ya existentes
  // conservan su estado; renderSidebar lo respeta al reconstruir.
  [nav, footer].forEach((container) => {
    container?.querySelectorAll(".app-sidebar__link").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.section === activeSection);
    });
  });
}
