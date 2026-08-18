// =============================================================
// Ventana "ver en más detalle" del elenco (issue #294): ventana
// superpuesta que se abre desde los carruseles de producción y
// reparto de la ficha de una película/serie (modal clásico o página
// de ítem). Muestra TODAS las personas de la lista (no solo las del
// carrusel): el reparto en orden de facturación con su personaje, y
// la producción agrupada por áreas/departamentos con los puestos
// fusionados por persona.
//
// Reutiliza el armazón #cast-modal de index.html (patrón de
// #rating-modal: .modal--top, backdrop, ✕, focus trap y restauración
// de foco). La promesa que devuelve openCastModal() se resuelve con
// null al cerrar y nunca rechaza. No importa de ui.js para evitar la
// dependencia circular (ui.js sí importa de aquí): escapeHtml y el
// placeholder de fotos son locales (mismo patrón que rating-modal).
// =============================================================

import { trapFocus } from "./focus-utils.js";

const PLACEHOLDER_PERSON_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="100%" height="100%" fill="#8f918e"/><circle cx="100" cy="105" r="45" fill="#d9dad7"/><path d="M30 285c8-65 40-95 70-95s62 30 70 95z" fill="#d9dad7"/></svg>'
  );

// Estado del modal abierto actualmente (o null). closeCastModal() lo
// usa para cerrar la ventana desde fuera (p. ej. la tecla Escape del
// handler global de modal-handlers.js).
let currentClose = null;

/**
 * Cierra la ventana del elenco si está abierta (resuelve su promesa
 * con null). La usa el handler global de Escape en modal-handlers.js.
 */
export function closeCastModal() {
  if (currentClose) currentClose(null);
}

// Los botones de cierre del armazón estático (✕ y backdrop) viven en
// index.html: sus listeners se registran UNA sola vez al cargar el
// módulo (no por cada apertura), igual que en rating-modal.js.
document.getElementById("cast-modal-close").addEventListener("click", () => closeCastModal());
document.getElementById("cast-modal-backdrop").addEventListener("click", () => closeCastModal());

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Foto segura para el atributo src: solo URLs https o data:image/
// (mismo patrón de defensa que rating-modal.js). Cualquier otro
// esquema cae al placeholder de persona.
function safePhotoUrl(url) {
  if (!url) return PLACEHOLDER_PERSON_COVER;
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
  return PLACEHOLDER_PERSON_COVER;
}

/* ---------- Agrupación de la producción por áreas ---------- */

// Nombre del área en español (la UI es 100 % en español). Fallback al
// valor original de TMDB si el área no está en el mapa.
const DEPARTMENT_TRANSLATIONS = {
  Directing: "Dirección",
  Writing: "Guion",
  Production: "Producción",
  Sound: "Sonido",
  Camera: "Cámara",
  Editing: "Montaje",
  Art: "Arte",
  "Costume & Make-Up": "Vestuario y maquillaje",
  "Visual Effects": "Efectos visuales",
  "Special Effects": "Efectos especiales",
  Lighting: "Iluminación",
  Crew: "Equipo técnico",
  Acting: "Interpretación",
  Creadores: "Creadores",
};

// Orden estable de los departamentos conocidos; el resto van después,
// alfabéticos. Así la ventana de producción no cambia de orden entre
// títulos con los mismos departamentos.
const DEPARTMENT_ORDER = [
  "Creadores",
  "Dirección",
  "Guion",
  "Producción",
  "Sonido",
  "Cámara",
  "Montaje",
  "Arte",
  "Vestuario y maquillaje",
  "Iluminación",
  "Efectos visuales",
  "Efectos especiales",
  "Equipo técnico",
  "Interpretación",
];

export function translateDepartment(department) {
  return DEPARTMENT_TRANSLATIONS[department] || department;
}

// Agrupa el crew por área (department traducido), con orden estable
// (DEPARTMENT_ORDER primero, después alfabético) y, dentro de cada
// área, los puestos de una misma persona fusionados ("Director,
// Guionista") y el conjunto ordenado por order de TMDB.
// @returns [{ department, people: [{id, name, profileUrl, roles}] }]
export function groupCrewByDepartment(people) {
  const byDepartment = new Map();
  for (const person of people || []) {
    if (!person || !person.name) continue;
    const department = translateDepartment(person.department || "Otros");
    if (!byDepartment.has(department)) byDepartment.set(department, new Map());
    const peopleOfDept = byDepartment.get(department);
    if (!peopleOfDept.has(person.id)) {
      peopleOfDept.set(person.id, {
        id: person.id,
        name: person.name,
        profileUrl: person.profileUrl || null,
        roles: [],
        order: person.order ?? 999,
      });
    }
    const entry = peopleOfDept.get(person.id);
    if (person.job && !entry.roles.includes(person.job)) entry.roles.push(person.job);
  }

  const sections = [];
  for (const [department, peopleOfDept] of byDepartment) {
    const list = [...peopleOfDept.values()]
      .map((p) => ({ ...p, roles: p.roles.join(", ") }))
      .sort((a, b) => a.order - b.order);
    sections.push({ department, people: list });
  }

  const knownIndex = (dep) => {
    const idx = DEPARTMENT_ORDER.indexOf(dep);
    return idx === -1 ? DEPARTMENT_ORDER.length : idx;
  };
  sections.sort((a, b) => {
    const ka = knownIndex(a.department);
    const kb = knownIndex(b.department);
    if (ka !== kb) return ka - kb;
    return a.department.localeCompare(b.department, "es");
  });
  return sections;
}

/* ---------- Render ---------- */

function personRowHtml(person) {
  const detail = person.character || person.roles || "";
  return `
    <li class="cast-modal__row">
      <img class="cast-modal__photo" src="${escapeHtml(safePhotoUrl(person.profileUrl))}" alt="" loading="lazy" />
      <div class="cast-modal__person">
        <span class="cast-modal__name">${escapeHtml(person.name)}</span>
        ${detail ? `<span class="cast-modal__role">${escapeHtml(detail)}</span>` : ""}
      </div>
    </li>`;
}

// Lista completa de personas: cast (personajes) o crew (roles
// fusionados). El crew se agrupa por áreas (departamentos); el cast
// se ordena por order (facturación) y se muestra en una sola lista.
function peopleListHtml(people) {
  const isCrew = people.some((p) => p.department !== undefined);
  if (isCrew) {
    const sections = groupCrewByDepartment(people);
    if (!sections.length) return `<p class="cast-modal__empty">No hay información de producción.</p>`;
    return sections
      .map(
        (section) => `
        <div class="cast-modal__section">
          <h4 class="cast-modal__area">${escapeHtml(section.department)}</h4>
          <ul class="cast-modal__list">
            ${section.people.map(personRowHtml).join("")}
          </ul>
        </div>`
      )
      .join("");
  }
  const sorted = [...people].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  if (!sorted.length) return `<p class="cast-modal__empty">No hay información de reparto.</p>`;
  return `<ul class="cast-modal__list">${sorted.map(personRowHtml).join("")}</ul>`;
}

/**
 * Abre la ventana de detalle del elenco sobre lo que haya en pantalla.
 * @param {object} opts
 * @param {string} opts.title   - Título de la película/serie
 * @param {string} opts.subtitle - "Producción" | "Reparto"
 * @param {Array}  opts.people  - Personas: cast [{id,name,character,profileUrl,order}]
 *                                o crew [{id,name,job,department,profileUrl,order}]
 * @returns {Promise<null>} Se resuelve con null al cerrar. Nunca rechaza.
 */
export function openCastModal({ title, subtitle, people }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("cast-modal");
    const content = document.getElementById("cast-modal-content");
    const peopleList = Array.isArray(people) ? people : [];
    const count = peopleList.length;

    modal.setAttribute("aria-label", `${subtitle} de ${title}`);

    content.innerHTML = `
      <div class="cast-modal__header">
        <h3 class="cast-modal__title">${escapeHtml(subtitle)}</h3>
        <p class="cast-modal__subtitle">${escapeHtml(title)}${count ? ` · ${count} personas` : ""}</p>
      </div>
      <div class="cast-modal__body">
        ${peopleListHtml(peopleList)}
      </div>
    `;

    let settled = false;
    const close = () => {
      if (settled) return; // idempotente: cerrar dos veces no resuelve dos veces
      settled = true;
      currentClose = null;

      if (modal._focusTrapCleanup) {
        modal._focusTrapCleanup();
        modal._focusTrapCleanup = null;
      }
      // Restaurar el foco al elemento previo (el botón del carrusel),
      // si sigue en el DOM
      if (modal._previousActiveElement && document.contains(modal._previousActiveElement)) {
        modal._previousActiveElement.focus();
      }
      modal._previousActiveElement = null;

      modal.classList.add("hidden");
      content.innerHTML = "";
      resolve(null);
    };
    currentClose = close;

    // Record previous focus and trap
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
    modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  });
}