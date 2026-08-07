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
import { closeGlobalSearch } from "./global-search.js";

// Entradas de la barra lateral: { id, label, icon, onClick, pinned }.
// "Ocio" es la web actual (pestañas Series / Películas / Libros);
// al pulsarla se cierra el drawer y se hace scroll suave al top.
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

// Callback de módulo para «Ajustes»: lo inyecta app.js en setupSidebar.
let openSettings = null;

export function setupSidebar(opts) {
  openSettings = opts?.onOpenSettings || null;

  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("app-sidebar-backdrop");
  const toggle = document.getElementById("btn-sidebar-toggle");
  const closeBtn = document.getElementById("btn-sidebar-close");
  const nav = document.getElementById("app-sidebar-nav");
  const footer = document.getElementById("app-sidebar-footer");

  if (!sidebar || !backdrop || !toggle || !closeBtn || !nav) {
    console.warn("sidebar: elementos DOM no encontrados");
    return;
  }

  let focusTrapCleanup = null;

  // Render de las entradas a partir del array SECTIONS. Los ids son
  // literales controlados por este módulo (sin datos de usuario).
  nav.innerHTML = SECTIONS.filter((s) => !s.pinned)
    .map(
      (s) => `<button type="button" class="app-sidebar__link${s.id === "ocio" ? " is-active" : ""}"
               data-section="${s.id}">
        <span aria-hidden="true">${s.icon}</span>
        <span>${s.label}</span>
      </button>`
    )
    .join("");

  // Footer inferior: entradas pinned (p. ej. «Ajustes»), separadas
  // visualmente del resto por una línea. Si el contenedor no existe
  // (HTML antiguo), no hacemos nada: defensivo.
  if (footer) {
    footer.innerHTML = SECTIONS.filter((s) => s.pinned)
      .map(
        (s) => `<button type="button" class="app-sidebar__link"
                 data-section="${s.id}">
          <span aria-hidden="true">${s.icon}</span>
          <span>${s.label}</span>
        </button>`
      )
      .join("");
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

    // Restaurar foco al botón hamburguesa
    toggle.focus();
  }

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) {
      closeSidebar();
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
}
