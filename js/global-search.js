// =============================================================
// Buscador Global — busca simultáneamente en películas, series,
// libros y amigos. La barra de búsqueda vive en la cabecera
// (#global-search-input dentro de .search-bar-wrap) y los resultados
// se muestran en un dropdown anclado bajo ella (#global-search-results).
// Se abre al hacer focus/click en el input, o con Ctrl+K / "/".
//
// NOTA (issue #46): el dropdown NO usa trapFocus. Sigue el patrón del
// dropdown de notificaciones (cierre con Escape, clic fuera del
// contenedor): atrapar el foco en un dropdown no modal rompería la
// navegación normal con Tab dentro del documento, que es la metáfora
// de una barra de búsqueda tipo Gmail.
//
// Issue #82: la búsqueda de nuevos títulos (catálogo de TMDB/Google
// Books) se unifica en este dropdown. La parte alta del dropdown
// tiene tres botones de tipo (Serie / Película / Libro); al pulsar
// uno se busca en el catálogo y se muestra una sección "Catálogo · X"
// con la fila «Añadir manualmente» al final.
// =============================================================

import { openItem } from "./modal-handlers.js";
import * as ui from "./ui.js";
import {
  searchExternal,
  handleAdd,
  handleManualAdd,
  openSearchPreviewFromResults,
  existingIdsFor,
  existingBookKeys,
  isBookAlreadyAdded,
} from "./search.js";
// ---- Estado interno ----

let isOpen = false;
let highlightedIndex = -1;
let flatResults = [];
let cachedProfiles = null;
let profilePromise = null;
let searchCtx = null;

// Estado de la búsqueda externa (catálogo API), por grupo.
// externalCache[group] = { query, items, source } | null (solo si la
// última búsqueda de ese grupo terminó con éxito).
// inFlight[group] = hay una búsqueda en curso.
// externalError[group] = { query, message } | null (último fallo).
// externalQuery[group] = query de la búsqueda en curso.
// searchSeq: contador monotónico para descartar respuestas obsoletas
// (cambia con cada búsqueda y al cerrar el dropdown).
const externalCache = { movies: null, tv: null, books: null };
const inFlight = { movies: false, tv: false, books: false };
const externalError = { movies: null, tv: null, books: null };
const externalQuery = { movies: "", tv: "", books: "" };
let searchSeq = 0;

// Grupo de tipo pulsado en los botones superiores (null = ninguno).
let activeGroup = null;

// Información de cada grupo para las secciones del catálogo.
const GROUPS = [
  { key: "tv", label: "Serie", icon: "📺", itemLabel: "serie", manualText: "¿No la encuentras? Añadir manualmente una serie", type: "tv", accent: "" },
  { key: "movies", label: "Película", icon: "🎬", itemLabel: "película", manualText: "¿No la encuentras? Añadir manualmente una película", type: "movie", accent: "" },
  { key: "books", label: "Libro", icon: "📚", itemLabel: "libro", manualText: "¿No lo encuentras? Añadir manualmente un libro", type: "book", accent: " global-search__item-add--books" },
];

// ---- Referencias DOM (se asignan en setup) ----

let wrap, input, resultsEl, clearBtn;

// ---- Utilidades ----

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Portada segura para el atributo src: solo se aceptan URLs https o
// data:image/ (defensa en profundidad, mismo patrón que rating-modal.js).
// Cualquier otro esquema (javascript:, data:text/html...) o URL inválida
// cae al placeholder de ui.js.
function safeCoverUrl(url) {
  if (!url) return ui.PLACEHOLDER_COVER;
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
  return ui.PLACEHOLDER_COVER;
}

function groupInfo(group) {
  return GROUPS.find((g) => g.key === group) || GROUPS[0];
}

// ---- Búsqueda ----

function getSearchableText(item) {
  // Para libros, también buscar por autor
  const author = item.author || "";
  return `${item.title} ${author}`.toLowerCase();
}

function relevanceScore(item, query) {
  const title = (item.title || "").toLowerCase();
  const author = (item.author || "").toLowerCase();
  const q = query.toLowerCase();

  if (title === q) return 100;
  if (title.startsWith(q)) return 50;
  if (title.includes(q)) return 10;
  if (author.includes(q)) return 5;
  return 0;
}

function filterItems(items, query) {
  const q = query.toLowerCase().trim();
  return items
    .filter((item) => {
      const text = getSearchableText(item);
      return text.includes(q);
    })
    .map((item) => ({ item, score: relevanceScore(item, q) }))
    .sort((a, b) => b.score - a.score || (a.item.title || "").localeCompare(b.item.title || ""))
    .map((r) => r.item);
}

function filterFriends(profiles, query) {
  const q = query.toLowerCase().trim();
  return profiles.filter((p) => {
    const name = (p.displayName || p.name || "").toLowerCase();
    const email = (p.email || "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });
}

// Resultados de la colección (películas/series/libros del usuario +
// amigos cacheados), recortados al límite del dropdown. Síncrono:
// lo usan performSearch, runExternalSearch y refreshExternalResults.
function collectionResults(trimmed) {
  if (!searchCtx) {
    return { movies: [], tv: [], books: [], friends: [] };
  }
  const allItems = searchCtx.getAllItems();
  return {
    movies: filterItems(allItems.movies || [], trimmed).slice(0, 5),
    tv: filterItems(allItems.tv || [], trimmed).slice(0, 5),
    books: filterItems(allItems.books || [], trimmed).slice(0, 5),
    friends: (cachedProfiles ? filterFriends(cachedProfiles, trimmed) : []).slice(0, 3),
  };
}

// ---- Renderizado ----

function statusClass(status) {
  const map = {
    pendiente: "chip--pendiente",
    en_curso: "chip--en_curso",
    completado: "chip--completado",
    standby: "chip--standby",
    abandonado: "chip--abandonado",
  };
  return map[status] || "";
}

// Fila superior del dropdown con los botones de tipo (SIEMPRE visible).
function renderTypeButtons() {
  return `<div class="global-search__type-buttons">
    ${GROUPS.map(
      (g) => `<button type="button" class="global-search__type-btn${g.key === activeGroup ? " is-active" : ""}" data-group="${g.key}">${g.label}</button>`
    ).join("")}
  </div>`;
}

function hintHtml() {
  return renderTypeButtons() +
    `<p class="global-search__hint">Escribe al menos 2 caracteres para buscar en tus películas, series, libros y amigos.</p>`;
}

function renderHint() {
  resultsEl.innerHTML = hintHtml();
  flatResults = [];
  highlightedIndex = -1;
}

// Fila «Añadir manualmente» que cierra cada sección del catálogo.
// Añade la fila a flatResults para que sea navegable con teclado.
function manualRowHtml(group) {
  const g = groupInfo(group);
  const index = flatResults.length;
  flatResults.push({ kind: "manual", type: g.type, group, item: null });
  return `<button type="button" class="global-search__manual-add" data-global-idx="${index}">${g.manualText}</button>`;
}

// Sección del catálogo (fuente externa) para un grupo.
// Estados: caché válida → resultados + fila manual; error → mensaje +
// fila manual; vacía → mensaje + fila manual.
function renderExternalSection(group, query) {
  const g = groupInfo(group);
  const cache = externalCache[group];
  const err = externalError[group];
  let html = `<div class="global-search__group-title">
    <span>${g.icon}</span>
    <span>Catálogo · ${g.label}s</span>
  </div>`;

  if (err && err.query === query) {
    html += `<p class="global-search__status">No se pudo buscar: ${escapeHtml(err.message)}</p>`;
    html += manualRowHtml(group);
    return html;
  }

  if (!cache || cache.query !== query) {
    html += `<p class="global-search__status">Buscando en el catálogo…</p>`;
    html += manualRowHtml(group);
    return html;
  }

  if (!cache.items.length) {
    html += `<p class="global-search__status">No hay resultados de ${g.itemLabel} para "${escapeHtml(query)}".</p>`;
    html += manualRowHtml(group);
    return html;
  }

  const ids = existingIdsFor(group, searchCtx);
  const bookKeys = group === "books" ? existingBookKeys(searchCtx) : null;

  for (const item of cache.items) {
    const added = group === "books" ? isBookAlreadyAdded(item, ids, bookKeys) : ids.has(item.externalId);
    const metaParts = [];
    if (item.year) metaParts.push(item.year);
    if (group === "books" && item.author) metaParts.push(item.author);
    const meta = metaParts.join(" · ");
    const index = flatResults.length;

    html += `<div class="global-search__item" data-global-idx="${index}" tabindex="0">
      <img class="global-search__item-cover" src="${escapeHtml(safeCoverUrl(item.coverUrl))}" alt="" loading="lazy" />
      <div class="global-search__item-info">
        <div class="global-search__item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
      </div>
      <button type="button" class="global-search__item-add btn btn--small${g.accent}" data-add-index="${index}" ${added ? "disabled" : ""}>
        ${added ? "Añadido" : "Añadir"}
      </button>
    </div>`;
    flatResults.push({ kind: "external", type: item.type, item, group });
  }

  html += manualRowHtml(group);
  return html;
}

function renderResults(results, query) {
  const { movies = [], tv = [], books = [], friends = [] } = results;
  const trimmed = query.trim();

  const hasAny = movies.length || tv.length || books.length || friends.length;

  if (!trimmed || trimmed.length < 2) {
    renderHint();
    return;
  }

  // ¿Hay alguna sección externa (carga, error o caché válida) para la
  // query actual y el grupo activo? Decide si se muestra el mensaje de
  // "sin resultados". (Comentario issue #82: selección única — solo el
  // catálogo del grupo pulsado.)
  const active = activeGroup;
  const hasExternalSection = active
    ? (inFlight[active] && externalQuery[active] === trimmed) ||
      (externalError[active] && externalError[active].query === trimmed) ||
      (externalCache[active] && externalCache[active].query === trimmed)
    : false;

  if (!hasAny && !hasExternalSection) {
    resultsEl.innerHTML = renderTypeButtons() +
      `<p class="global-search__empty">No se encontraron resultados para "${escapeHtml(trimmed)}".</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }

  const groupLabels = {
    movies: "Películas",
    tv: "Series",
    books: "Libros",
    friends: "Amigos",
  };

  const groupIcons = {
    movies: "🎬",
    tv: "📺",
    books: "📚",
    friends: "👤",
  };

  const groupKeys = ["movies", "tv", "books", "friends"];
  let html = renderTypeButtons();
  const newFlat = [];
  let globalIdx = 0;

  for (const key of groupKeys) {
    const items = results[key];
    if (!items || !items.length) continue;

    html += `<div class="global-search__group-title">
      <span>${groupIcons[key]}</span>
      <span>${groupLabels[key]}</span>
      <span class="global-search__group-badge">${items.length}</span>
    </div>`;

    for (const entry of items) {
      if (key === "friends") {
        // Resultado de amigo
        const avatar = entry.photoURL || "";
        const name = entry.displayName || entry.name || "Amigo";
        const email = entry.email || "";
        html += `<div class="global-search__friend" data-global-idx="${globalIdx}" tabindex="0">
          <img class="global-search__friend-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" />
          <div class="global-search__friend-info">
            <div class="global-search__friend-name">${escapeHtml(name)}</div>
            <div class="global-search__friend-email">${escapeHtml(email)}</div>
          </div>
        </div>`;
        newFlat.push({ kind: "collection", type: "friend", item: entry, group: key });
      } else {
        // Resultado de item (movie/tv/book)
        const cover = entry.coverUrl || "";
        const title = entry.title || "Sin título";
        const author = entry.author || "";
        const year = entry.year || "";
        const status = entry.status || "";
        const metaParts = [];
        if (year) metaParts.push(year);
        if (key === "books" && author) metaParts.push(author);
        const meta = metaParts.join(" · ");

        html += `<div class="global-search__item" data-global-idx="${globalIdx}" tabindex="0">
          <img class="global-search__item-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
          <div class="global-search__item-info">
            <div class="global-search__item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
          </div>
          <span class="global-search__item-status chip ${statusClass(status)}">${ui.statusLabel(status, entry.type)}</span>
        </div>`;
        newFlat.push({ kind: "collection", type: entry.type || key, item: entry, group: key });
      }
      globalIdx++;
    }
  }

  // Sección externa (catálogo API): SOLO la del grupo activo. Si se
  // pulsa otro botón de tipo, los resultados del catálogo anterior se
  // ocultan (comentario issue #82, opción selección única); la
  // colección no se ve afectada. El estado (carga/error/caché) se
  // conserva por grupo para poder volver sin re-buscar.
  flatResults = newFlat;
  if (activeGroup) {
    const g = groupInfo(activeGroup);
    const group = g.key;
    if (inFlight[group] && externalQuery[group] === trimmed) {
      html += externalSectionLoadingHtml(g);
    } else if (externalError[group] && externalError[group].query === trimmed) {
      html += renderExternalSection(group, trimmed);
    } else if (externalCache[group] && externalCache[group].query === trimmed) {
      html += renderExternalSection(group, trimmed);
    }
  }

  resultsEl.innerHTML = html;
  highlightedIndex = -1;

  // Conectar eventos de click y teclado en cada resultado
  resultsEl.querySelectorAll("[data-global-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.globalIdx, 10);
      if (flatResults[idx]) {
        navigateTo(flatResults[idx]);
      }
    });

    // Enter y Space para activar el resultado
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = parseInt(el.dataset.globalIdx, 10);
        if (flatResults[idx]) {
          navigateTo(flatResults[idx]);
        }
      }
    });
  });

  // Botones «Añadir» de los resultados del catálogo
  resultsEl.querySelectorAll(".global-search__item-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.addIndex, 10);
      const entry = flatResults[idx];
      if (!entry || entry.kind !== "external") return;
      handleAdd(entry.item, btn, searchCtx).then((ok) => {
        if (ok) {
          btn.disabled = true;
          btn.textContent = "Añadido";
        }
      });
    });
  });
}

// Sección del catálogo en estado "cargando": solo el título y el aviso,
// más la fila de alta manual (disponible también durante la carga).
function externalSectionLoadingHtml(g) {
  const index = flatResults.length;
  flatResults.push({ kind: "manual", type: g.type, group: g.key, item: null });
  return `<div class="global-search__group-title">
    <span>${g.icon}</span>
    <span>Catálogo · ${g.label}s</span>
  </div>
  <p class="global-search__status">Buscando en el catálogo…</p>
  <button type="button" class="global-search__manual-add" data-global-idx="${index}">${g.manualText}</button>`;
}

// ---- Botones de tipo (búsqueda en el catálogo) ----

function handleTypeClick(group) {
  activeGroup = group;
  const query = input.value.trim();
  if (query.length < 2) {
    // Hint con los botones de tipo encima (renderTypeButtons ya marca
    // el grupo pulsado como activo).
    resultsEl.innerHTML = renderTypeButtons() +
      `<p class="global-search__hint">Escribe al menos 2 caracteres para buscar en el catálogo.</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }
  // Selección única: si el grupo pulsado ya tiene resultados cacheados
  // para esta query, solo se muestra (sin re-llamar a la API); en caso
  // contrario se busca.
  const cache = externalCache[group];
  if (cache && cache.query === query && !inFlight[group]) {
    renderResults(collectionResults(query), query);
    return;
  }
  runExternalSearch(group, query);
}

// Busca en el catálogo un grupo y re-renderiza su sección. Captura el
// seq actual y descarta el resultado si cambió (nueva búsqueda o cierre
// del dropdown). Sin paginación: solo la primera página, cap de 5.
async function runExternalSearch(group, query) {
  const seq = ++searchSeq;
  inFlight[group] = true;
  externalQuery[group] = query;
  externalError[group] = null;

  renderResults(collectionResults(query), query);

  let result;
  try {
    result = await searchExternal(group, query, 1);
  } catch (err) {
    if (seq !== searchSeq || !isOpen) {
      inFlight[group] = false;
      return;
    }
    inFlight[group] = false;
    externalError[group] = { query, message: err.message };
    renderResults(collectionResults(input.value.trim()), input.value.trim());
    return;
  }

  if (seq !== searchSeq || !isOpen) {
    inFlight[group] = false;
    return;
  }
  inFlight[group] = false;
  externalCache[group] = {
    query,
    items: (result.items || []).slice(0, 5),
    source: result.source || null,
  };
  renderResults(collectionResults(input.value.trim()), input.value.trim());
}

// Re-renderiza las secciones externas desde la caché con el estado
// actual de la colección (lo llama app.js tras cada snapshot de
// Firestore para actualizar los botones «Añadir»/«Añadido»).
export function refreshExternalResults(ctx) {
  if (!isOpen) return;
  const query = input.value.trim();
  if (query.length < 2) return;
  if (ctx) searchCtx = ctx;
  renderResults(collectionResults(query), query);
}

// ---- Navegación ----

function navigateTo(result) {
  // Resultado del catálogo: vista previa sin cerrar el dropdown.
  if (result.kind === "external") {
    openSearchPreviewFromResults(result.item, false, searchCtx);
    return;
  }

  // Fila «Añadir manualmente»: abre el formulario sin cerrar el dropdown.
  if (result.kind === "manual") {
    const type = result.type;
    ui.openManualAddModal(type, (data) => handleManualAdd(type, data, searchCtx));
    return;
  }

  if (result.type === "friend") {
    ui.showToast(`Próximamente podrás ver el perfil de ${result.item.displayName || result.item.name || "tu amigo"}.`);
    closeGlobalSearch();
    return;
  }

  // Es un item de la colección (movie/tv/book)
  const item = result.item;
  if (!searchCtx) {
    ui.showToast("Error: contexto no disponible.");
    return;
  }
  closeGlobalSearch();
  // Pequeño delay para que el cierre del dropdown no interfiera
  setTimeout(() => {
    openItem(item, searchCtx);
  }, 150);
}

// ---- Abrir / Cerrar ----

function openGlobalSearch() {
  if (isOpen) return;
  isOpen = true;

  // Si el drawer lateral está abierto, cerrarlo primero: su backdrop
  // (z-index 55) taparía el dropdown de resultados (z-index 40).
  // El click en el toggle dispara closeSidebar() de js/sidebar.js.
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar && sidebar.classList.contains("is-open")) {
    const toggle = document.getElementById("btn-sidebar-toggle");
    if (toggle) toggle.click();
  }

  resultsEl.classList.remove("hidden");
  clearBtn.hidden = false;

  const query = input.value.trim();
  if (query.length < 2) {
    resultsEl.innerHTML = renderTypeButtons() + `<p class="global-search__hint">Escribe para buscar...</p>`;
    flatResults = [];
    highlightedIndex = -1;
  } else {
    // Ya hay texto: repetir la búsqueda para mostrar resultados
    performSearch(searchCtx);
  }

  // Al abrir con atajo de teclado (Ctrl+K, "/"), llevar el foco al
  // input; si ya estaba enfocado, el focus event no se repite.
  if (document.activeElement !== input) input.focus();

  // Cachear perfiles de amigos al abrir
  if (!cachedProfiles && searchCtx) {
    if (!profilePromise) {
      profilePromise = searchCtx.getAllUserProfiles().then((profiles) => {
        cachedProfiles = profiles;
        return profiles;
      }).catch(() => {
        cachedProfiles = [];
        return [];
      });
    }
  }
}

export function closeGlobalSearch() {
  if (!isOpen) return;
  isOpen = false;

  // Invalidar búsquedas externas en curso y limpiar su estado
  searchSeq++;
  activeGroup = null;
  externalCache.movies = null;
  externalCache.tv = null;
  externalCache.books = null;
  inFlight.movies = false;
  inFlight.tv = false;
  inFlight.books = false;
  externalError.movies = null;
  externalError.tv = null;
  externalError.books = null;
  externalQuery.movies = "";
  externalQuery.tv = "";
  externalQuery.books = "";

  resultsEl.classList.add("hidden");
  resultsEl.innerHTML = "";
  flatResults = [];
  highlightedIndex = -1;
  clearBtn.hidden = true;

  // No se limpia el texto del input ni se mueve el foco: el usuario
  // puede volver a pulsar la barra y retomar donde estaba (Gmail).
}

// ---- Navegación por teclado ----

function highlightNext() {
  if (!flatResults.length) return;
  const newIdx = highlightedIndex < flatResults.length - 1 ? highlightedIndex + 1 : 0;
  setHighlight(newIdx);
}

function highlightPrev() {
  if (!flatResults.length) return;
  const newIdx = highlightedIndex > 0 ? highlightedIndex - 1 : flatResults.length - 1;
  setHighlight(newIdx);
}

function setHighlight(idx) {
  // Quitar highlight anterior
  resultsEl.querySelector(".global-search__item--highlighted")?.classList.remove("global-search__item--highlighted");
  resultsEl.querySelector(".global-search__friend--highlighted")?.classList.remove("global-search__friend--highlighted");

  highlightedIndex = idx;
  const target = resultsEl.querySelector(`[data-global-idx="${idx}"]`);
  if (!target) return;

  if (flatResults[idx] && flatResults[idx].type === "friend") {
    target.classList.add("global-search__friend--highlighted");
  } else {
    target.classList.add("global-search__item--highlighted");
  }
  target.scrollIntoView({ block: "nearest" });
}

function activateHighlight() {
  if (highlightedIndex >= 0 && highlightedIndex < flatResults.length) {
    navigateTo(flatResults[highlightedIndex]);
  } else if (flatResults.length > 0) {
    navigateTo(flatResults[0]);
  }
}

// ---- Inicialización ----

/**
 * Inicializa el buscador global (dropdown anclado a la barra de la
 * cabecera).
 * @param {Object} ctx - Contexto de la aplicación (con getAllItems, etc.)
 */
export function setupGlobalSearch(ctx) {
  wrap = document.querySelector(".search-bar-wrap");
  input = document.getElementById("global-search-input");
  resultsEl = document.getElementById("global-search-results");
  clearBtn = document.getElementById("global-search-clear");

  if (!wrap || !input || !resultsEl || !clearBtn) {
    console.warn("global-search: elementos DOM no encontrados");
    return;
  }

  // Guardamos ctx para usarlo en navigateTo
  searchCtx = ctx;

  // ---- Eventos ----

  // Abrir al hacer focus o click en el input (el click cubre el caso
  // de volver a pulsar una barra ya enfocada)
  input.addEventListener("focus", openGlobalSearch);
  input.addEventListener("click", openGlobalSearch);

  // Input con debounce
  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => performSearch(ctx), 200);
  });

  // Teclas dentro del input
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // Solo atrapamos el Escape si el dropdown está abierto: si está
      // cerrado (p. ej. con un modal de ítem encima), debe propagar
      // al handler global de modal-handlers.js.
      if (isOpen) e.stopPropagation();
      closeGlobalSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightNext();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightPrev();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activateHighlight();
      return;
    }
    // Permitir Ctrl+A, Ctrl+C, etc. sin interferir
  });

  // Botón de limpiar/cerrar de la barra
  clearBtn.addEventListener("click", () => {
    input.value = "";
    closeGlobalSearch();
    input.focus();
  });

  // Clic fuera del wrap → cerrar el dropdown
  document.addEventListener("click", (e) => {
    if (isOpen && !wrap.contains(e.target)) {
      closeGlobalSearch();
    }
  });

  // Botones de tipo (Serie / Película / Libro): delegación en el
  // contenedor del dropdown porque se re-renderiza en cada búsqueda
  // (también en el hint con query corta).
  resultsEl.addEventListener("click", (e) => {
    const typeBtn = e.target.closest(".global-search__type-btn");
    if (typeBtn) {
      e.stopPropagation();
      handleTypeClick(typeBtn.dataset.group);
    }
  });

  // Escape con el foco fuera del input (p. ej. sobre un resultado):
  // el keydown del input ya cierra con stopPropagation, así que esto
  // solo actúa cuando el foco está en otra parte del documento.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen && document.activeElement !== input) {
      e.preventDefault();
      closeGlobalSearch();
    }
  });

  // ---- Atajos globales de teclado ----
  document.addEventListener("keydown", (e) => {
    // Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (isOpen) {
        closeGlobalSearch();
      } else {
        openGlobalSearch();
      }
      return;
    }

    // Tecla "/" para abrir (solo si no hay input enfocado)
    if (e.key === "/" && !isOpen && !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
      e.preventDefault();
      openGlobalSearch();
      return;
    }
  });
}

// ---- Búsqueda (se llama con debounce) ----

async function performSearch(ctx) {
  const query = input.value;
  const trimmed = query.trim();

  if (!trimmed || trimmed.length < 2) {
    renderHint();
    return;
  }

  // Nueva búsqueda: invalidar búsquedas externas en curso
  searchSeq++;

  // Amigos desde la caché
  if (!cachedProfiles) {
    if (!profilePromise) {
      profilePromise = ctx.getAllUserProfiles().then((profiles) => {
        cachedProfiles = profiles;
        return profiles;
      }).catch(() => {
        cachedProfiles = [];
        return [];
      });
    }
    try {
      cachedProfiles = await profilePromise;
    } catch {
      cachedProfiles = [];
    }
  }

  renderResults(collectionResults(trimmed), trimmed);
}
