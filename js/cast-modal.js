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

// Lupa del buscador de la ventana de detalle (iteración issue #294):
// trazo actualColor (hereda el color del wrapper, --ink-soft en CSS).
const SEARCH_ICON = `
  <svg class="cast-modal__search-icon" viewBox="0 0 24 24" width="16" height="16"
       fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
       aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="15.8" y2="15.8" />
  </svg>`;

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
// esquema cae al placeholder de persona. Exportado (issue #294):
// ui.js lo reutiliza para el src de las tarjetas de los carruseles.
export function safePhotoUrl(url) {
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
    // Clave defensiva (QA #294): TMDB siempre envía id, pero si una
    // entrada no lo trae no debe colapsar con otra sin id en la
    // misma fila; se usa el nombre como respaldo.
    const key = person.id ?? person.name;
    if (!peopleOfDept.has(key)) {
      peopleOfDept.set(key, {
        id: person.id,
        name: person.name,
        profileUrl: person.profileUrl || null,
        roles: [],
        order: person.order ?? 999,
      });
    }
    const entry = peopleOfDept.get(key);
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

// Filtra las personas por el texto del buscador (iteración issue
// #294): coincide con el NOMBRE de la persona y con su personaje (en
// el reparto) o su función —job y área/departamento— (en la
// producción). El área se compara TANTO en inglés crudo de TMDB como
// traducida (translateDepartment): la UI muestra «Dirección», «Guion»,
// «Cámara»… y el usuario teclea lo que ve (QA iteración #294). Query
// vacía devuelve la lista completa. El filtrado se hace sobre las
// entradas sin agrupar (el crew se reagrupa después), igual que el
// render sin filtro.
function filterPeopleByQuery(people, query) {
  const q = (query || "").trim().toLocaleLowerCase("es");
  if (!q) return people;
  return people.filter((p) => {
    const name = (p.name || "").toLocaleLowerCase("es");
    const role = (p.character || p.job || "").toLocaleLowerCase("es");
    const department = (p.department || "").toLocaleLowerCase("es");
    const departmentEs = (p.department ? translateDepartment(p.department) : "").toLocaleLowerCase("es");
    return name.includes(q) || role.includes(q) || department.includes(q) || departmentEs.includes(q);
  });
}

// Lista completa de personas: cast (personajes) o crew (roles
// fusionados). El crew se agrupa por áreas (departamentos); el cast
// se ordena por order (facturación) y se muestra en una sola lista.
// query: texto del buscador (si no hay resultados se muestra el
// aviso correspondiente en lugar del mensaje de lista vacía).
function peopleListHtml(people, query) {
  const emptyMessage = (query || "").trim()
    ? `No hay resultados para «${escapeHtml((query || "").trim())}».`
    : null;
  const isCrew = people.some((p) => p.department !== undefined);
  if (isCrew) {
    const sections = groupCrewByDepartment(people);
    if (!sections.length) {
      return `<p class="cast-modal__empty">${emptyMessage || "No hay información de producción."}</p>`;
    }
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
  if (!sorted.length) {
    return `<p class="cast-modal__empty">${emptyMessage || "No hay información de reparto."}</p>`;
  }
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
    const isCrew = peopleList.some((p) => p.department !== undefined);

    modal.setAttribute("aria-label", `${subtitle} de ${title}`);

    // El buscador (lupa, iteración issue #294) vive entre la cabecera y
    // la lista: filtra por nombre y por personaje (reparto) o función
    // (producción) sin recargar la ventana. Esc limpia la búsqueda
    // primero; con el campo vacío, el Escape global cierra la ventana.
    const searchPlaceholder = isCrew
      ? "Buscar por nombre o función…"
      : "Buscar por nombre o personaje…";
    content.innerHTML = `
      <div class="cast-modal__header">
        <h3 class="cast-modal__title">${escapeHtml(subtitle)}</h3>
        <p class="cast-modal__subtitle">${escapeHtml(title)}${count ? ` · ${count} personas` : ""}</p>
      </div>
      <div class="cast-modal__search">
        ${SEARCH_ICON}
        <input type="text" class="cast-modal__search-input"
               placeholder="${searchPlaceholder}"
               aria-label="${searchPlaceholder.replace("…", "")}"
               autocomplete="off" spellcheck="false">
      </div>
      <div class="cast-modal__body">
        ${peopleListHtml(peopleList)}
      </div>
    `;

    const searchInput = content.querySelector(".cast-modal__search-input");
    const body = content.querySelector(".cast-modal__body");
    if (searchInput && body) {
      searchInput.addEventListener("input", () => {
        body.innerHTML = peopleListHtml(filterPeopleByQuery(peopleList, searchInput.value));
      });
      // Esc con texto en el buscador: limpia el filtro y se queda en la
      // ventana (sin propagar al handler global que la cerraría).
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && searchInput.value) {
          e.stopPropagation();
          searchInput.value = "";
          body.innerHTML = peopleListHtml(peopleList);
        }
      });
    }

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