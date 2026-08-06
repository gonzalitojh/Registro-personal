// =============================================================
// Barra lateral de navegación (issue #46) — drawer fijo a la
// izquierda estilo Gmail. Se abre con el botón hamburguesa de la
// cabecera (#btn-sidebar-toggle), se cierra con Escape (listener
// temporal, patrón de notifications-setup.js), clic en el backdrop,
// botón ✕ o al pulsar una entrada.
// Las entradas viven en el array SECTIONS (exportado): para añadir
// una sección futura solo hay que añadir una entrada, sin tocar el
// resto del módulo.
// =============================================================

import { trapFocus } from "./focus-utils.js";
import { closeGlobalSearch } from "./global-search.js";

// Entradas de la barra lateral: { id, label, icon, onClick }.
// "Ocio" es la web actual (pestañas Series / Películas / Libros);
// al pulsarla se cierra el drawer y se hace scroll suave al top.
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
];

export function setupSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("app-sidebar-backdrop");
  const toggle = document.getElementById("btn-sidebar-toggle");
  const closeBtn = document.getElementById("btn-sidebar-close");
  const nav = document.getElementById("app-sidebar-nav");

  if (!sidebar || !backdrop || !toggle || !closeBtn || !nav) {
    console.warn("sidebar: elementos DOM no encontrados");
    return;
  }

  let focusTrapCleanup = null;

  // Render de las entradas a partir del array SECTIONS. Los ids son
  // literales controlados por este módulo (sin datos de usuario).
  nav.innerHTML = SECTIONS.map(
    (s) => `<button type="button" class="app-sidebar__link${s.id === "ocio" ? " is-active" : ""}"
             data-section="${s.id}">
      <span aria-hidden="true">${s.icon}</span>
      <span>${s.label}</span>
    </button>`
  ).join("");

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

  // Pulsar una entrada: cerrar el drawer y ejecutar su acción
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".app-sidebar__link");
    if (!btn) return;
    const section = SECTIONS.find((s) => s.id === btn.dataset.section);
    closeSidebar();
    if (section && section.onClick) section.onClick();
  });
}
