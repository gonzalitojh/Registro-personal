// =============================================================
// Buscador Global — busca SOLO dentro de la sección activa
// (issue #206): en Ocio busca en películas, series, libros y
// videojuegos (colección + catálogo API); en Perfil, en los amigos;
// en Recetas, en las recetas. La barra de búsqueda vive en la
// cabecera global (#global-search-input dentro de .search-bar-wrap)
// y los resultados se muestran en un dropdown anclado bajo ella
// (#global-search-results). Se abre al hacer focus/click en el
// input, o con Ctrl+K / "/".
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
// con la fila «Añadir manualmente» al final. Solo visible en Ocio.
// =============================================================

import { openItem } from "./modal-handlers.js";
import * as ui from "./ui.js";
import { navigate, parseHash } from "./router.js";
import { searchRecipes, openRecipeModal } from "./recipes.js";
import {
  searchExternal,
  handleAdd,
  handleAddSeen,
  handleManualAdd,
  openSearchPreviewFromResults,
  existingIdsFor,
  existingBookKeys,
  isBookAlreadyAdded,
} from "./search.js";
import { MEDIA_ICONS, seenActionLabels } from "./constants.js";
// ---- Estado interno ----

let isOpen = false;
let highlightedIndex = -1;
let flatResults = [];
let cachedProfiles = null;
let profilePromise = null;
let searchCtx = null;

// Flag de reapertura suprimida (issue #206): al abrir el modal de una
// receta desde el dropdown se reenfoca el input de búsqueda; el foco
// vuelve a él al cerrar el modal y no debe reabrirse el dropdown. El
// flag se limpia al consumirse en el propio focus event.
let suppressReopenOnFocus = false;

// Estado de la búsqueda externa (catálogo API), por grupo.
// externalCache[group] = { query, items, source } | null (solo si la
// última búsqueda de ese grupo terminó con éxito).
// inFlight[group] = hay una búsqueda en curso.
// externalError[group] = { query, message } | null (último fallo).
// externalQuery[group] = query de la búsqueda en curso.
// searchSeq: contador monotónico para descartar respuestas obsoletas
// (cambia con cada búsqueda y al cerrar el dropdown).
const externalCache = { movies: null, tv: null, books: null, games: null };
const inFlight = { movies: false, tv: false, books: false, games: false };
const externalError = { movies: null, tv: null, books: null, games: null };
const externalQuery = { movies: "", tv: "", books: "", games: "" };
let searchSeq = 0;

// Grupo de tipo pulsado en los botones superiores (null = ninguno).
let activeGroup = null;

// Información de cada grupo para las secciones del catálogo.
// Los iconos son los SVGs de MEDIA_ICONS (los mismos de las pestañas,
// con su color vía CSS --type-accent / --group-accent, issue #134).
const GROUPS = [
  { key: "tv", label: "Serie", icon: MEDIA_ICONS.tv, itemLabel: "serie", manualText: "¿No la encuentras? Añadir manualmente una serie", type: "tv", accent: "" },
  { key: "movies", label: "Película", icon: MEDIA_ICONS.movies, itemLabel: "película", manualText: "¿No la encuentras? Añadir manualmente una película", type: "movie", accent: "" },
  { key: "books", label: "Libro", icon: MEDIA_ICONS.books, itemLabel: "libro", manualText: "¿No lo encuentras? Añadir manualmente un libro", type: "book", accent: " global-search__item-add--books" },
  { key: "games", label: "Videojuego", icon: MEDIA_ICONS.games, itemLabel: "videojuego", manualText: "¿No lo encuentras? Añadir manualmente un videojuego", type: "game", accent: " global-search__item-add--games" },
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

// Sección activa (issue #206): ocio | perfil | recetas. La búsqueda
// superior se acota a ella; por defecto (o ante errores) ocio.
function currentSection() {
  try {
    return parseHash().section || "ocio";
  } catch {
    return "ocio";
  }
}

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

// Resultados de la sección activa (issue #206):
// - ocio    → colección (películas/series/libros/videojuegos del
//             usuario), sin amigos: el buscador ya no es global.
// - perfil  → solo amigos.
// - recetas → solo recetas (filtro local, searchRecipes de recipes.js).
// Síncrono: lo usan performSearch, runExternalSearch y
// refreshExternalResults.
function collectionResults(trimmed) {
  if (!searchCtx) {
    return { movies: [], tv: [], books: [], games: [], friends: [], recipes: [] };
  }
  const section = currentSection();
  if (section === "perfil") {
    return { friends: (cachedProfiles ? filterFriends(cachedProfiles, trimmed) : []).slice(0, 6) };
  }
  if (section === "recetas") {
    return { recipes: searchRecipes(trimmed).slice(0, 6) };
  }
  const allItems = searchCtx.getAllItems();
  return {
    movies: filterItems(allItems.movies || [], trimmed).slice(0, 5),
    tv: filterItems(allItems.tv || [], trimmed).slice(0, 5),
    books: filterItems(allItems.books || [], trimmed).slice(0, 5),
    games: filterItems(allItems.games || [], trimmed).slice(0, 5),
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

// Fila superior del dropdown con los botones de tipo (SIEMPRE visible
// en Ocio; en Perfil y Recetas la búsqueda no usa catálogo externo y
// no se renderizan, issue #206).
// Cada botón lleva el icono SVG de su tipo (mismos SVGs que las pestañas)
// y una clase modificadora --<key> que el CSS usa para colorear con el
// acento de cada tipo (issue #134).
function renderTypeButtons() {
  if (currentSection() !== "ocio") return "";
  return `<div class="global-search__type-buttons">
    ${GROUPS.map(
      (g) => `<button type="button" class="global-search__type-btn global-search__type-btn--${g.key}${g.key === activeGroup ? " is-active" : ""}" data-group="${g.key}"><span class="global-search__type-icon" aria-hidden="true">${g.icon}</span>${g.label}</button>`
    ).join("")}
  </div>`;
}

// Texto del hint según la sección activa (issue #206).
function sectionHintText() {
  if (currentSection() === "perfil") {
    return "Escribe al menos 2 caracteres para buscar en tus amigos.";
  }
  if (currentSection() === "recetas") {
    return "Escribe al menos 2 caracteres para buscar en tus recetas.";
  }
  return "Escribe al menos 2 caracteres para buscar en tus películas, series, libros y videojuegos.";
}

function hintHtml() {
  return renderTypeButtons() +
    `<p class="global-search__hint">${sectionHintText()}</p>`;
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
  let html = `<div class="global-search__group-title global-search__group-title--${g.key}">
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
      ${added ? "" : `<button type="button" class="global-search__item-seen btn btn--small" data-seen-index="${index}">${seenActionLabels(item.type).action}</button>`}
    </div>`;
    flatResults.push({ kind: "external", type: item.type, item, group });
  }

  html += manualRowHtml(group);
  return html;
}

function renderResults(results, query) {
  const { movies = [], tv = [], books = [], games = [], friends = [], recipes = [] } = results;
  const trimmed = query.trim();

  const hasAny = movies.length || tv.length || books.length || games.length || friends.length || recipes.length;

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
    games: "Videojuegos",
    friends: "Amigos",
    recipes: "Recetas",
  };

  // Iconos de grupo: series/películas/libros/videojuegos usan los
  // mismos SVGs que las pestañas (MEDIA_ICONS, coloreados por CSS con
  // --<key>); amigos conserva su emoji (issue #134) y recetas su
  // plato (issue #206).
  const groupIcons = {
    movies: MEDIA_ICONS.movies,
    tv: MEDIA_ICONS.tv,
    books: MEDIA_ICONS.books,
    games: MEDIA_ICONS.games,
    friends: "👤",
    recipes: "🍽️",
  };

  // Solo los grupos de la sección activa (issue #206)
  const section = currentSection();
  const groupKeys =
    section === "perfil" ? ["friends"] : section === "recetas" ? ["recipes"] : ["movies", "tv", "books", "games"];
  let html = renderTypeButtons();
  const newFlat = [];
  let globalIdx = 0;

  for (const key of groupKeys) {
    const items = results[key];
    if (!items || !items.length) continue;

    // Solo los grupos de medio llevan modificador de color; friends no
    // (su emoji es la "👤" y no necesita acento, issue #134), y recipes
    // tampoco (issue #206).
    html += `<div class="global-search__group-title${key === "friends" || key === "recipes" ? "" : ` global-search__group-title--${key}`}">
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
      } else if (key === "recipes") {
        // Resultado de receta (issue #206): abre el modal de la receta
        // en modo solo lectura.
        const cover = entry.fotoUrl || "";
        const metaParts = [];
        if (Number(entry.porciones)) {
          metaParts.push(`${entry.porciones} ${Number(entry.porciones) === 1 ? "porción" : "porciones"}`);
        }
        if (entry.ingredientes && entry.ingredientes.length) {
          metaParts.push(`${entry.ingredientes.length} ingredientes`);
        }
        const meta = metaParts.join(" · ");
        html += `<div class="global-search__item" data-global-idx="${globalIdx}" tabindex="0">
          <img class="global-search__item-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
          <div class="global-search__item-info">
            <div class="global-search__item-title" title="${escapeHtml(entry.nombre)}">${escapeHtml(entry.nombre)}</div>
            <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
          </div>
        </div>`;
        newFlat.push({ kind: "recipe", type: "recipe", item: entry, group: key });
      } else {
        // Resultado de item (movie/tv/book/game)
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

    // Enter y Space para activar el resultado. Si el foco está en un
    // botón de la fila (Añadir / Marcar visto/leído/jugado), se deja
    // pasar el evento para que sea el botón quien active su propia
    // acción (issue #115).
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
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

  // Botones «Marcar visto»/«Marcar leído»/«Marcar jugado» de los
  // resultados del catálogo (issues #115 y #177): alta directa como
  // completado + valoración al momento. Durante el flujo se
  // deshabilita también el «Añadir» de la fila para evitar dobles
  // altas; si el flujo se aborta o se deshace, ambos se restauran.
  resultsEl.querySelectorAll(".global-search__item-seen").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.seenIndex, 10);
      const entry = flatResults[idx];
      if (!entry || entry.kind !== "external") return;
      const labels = seenActionLabels(entry.item.type);
      const row = btn.closest(".global-search__item");
      const addBtn = row ? row.querySelector(".global-search__item-add") : null;
      if (addBtn) addBtn.disabled = true;
      btn.disabled = true;
      btn.textContent = "Marcando…";
      handleAddSeen(entry.item, btn, searchCtx).then((ok) => {
        if (!btn.isConnected) return;
        if (ok) {
          btn.disabled = true;
          btn.textContent = labels.done;
        } else {
          btn.disabled = false;
          btn.textContent = labels.action;
          if (addBtn && addBtn.isConnected) addBtn.disabled = false;
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
  return `<div class="global-search__group-title global-search__group-title--${g.key}">
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

  // Resultado de amigo (issue #206): el buscador del Perfil navega al
  // detalle del amigo (misma ruta que la lista de amigos usa).
  if (result.type === "friend") {
    closeGlobalSearch();
    navigate({ section: "perfil", profileSection: "friends", uid: result.item.uid });
    return;
  }

  // Resultado de receta (issue #206): abre el modal de la receta en
  // modo solo lectura. El foco vuelve al input al cerrarlo; el flag
  // evita que el dropdown se reabra solo (lo consume el focus event).
  if (result.kind === "recipe") {
    closeGlobalSearch();
    suppressReopenOnFocus = true;
    input.focus();
    openRecipeModal(result.item, { readOnly: true });
    return;
  }

  // Es un item de la colección (movie/tv/book/game)
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
  externalCache.games = null;
  inFlight.movies = false;
  inFlight.tv = false;
  inFlight.books = false;
  inFlight.games = false;
  externalError.movies = null;
  externalError.tv = null;
  externalError.books = null;
  externalError.games = null;
  externalQuery.movies = "";
  externalQuery.tv = "";
  externalQuery.books = "";
  externalQuery.games = "";

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
  // de volver a pulsar una barra ya enfocada). Si suppressReopenOnFocus
  // está activo (issue #206: reenfoque tras cerrar el modal de una
  // receta), el focus event solo consume el flag y no reabre el
  // dropdown.
  input.addEventListener("focus", () => {
    if (suppressReopenOnFocus) {
      suppressReopenOnFocus = false;
      return;
    }
    openGlobalSearch();
  });
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

  // Issue #149: portadas de la colección (p. ej. fbcdn.net) y avatares
  // pueden fallar (403/404 por hotlinking bloqueado). El evento "error"
  // NO burbujea, pero los listeners en fase de CAPTURA del contenedor
  // sí reciben el error de cualquier <img> descendiente, incluidas las
  // que se re-renderizan con innerHTML (el contenedor persiste).
  resultsEl.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (
        !img.classList.contains("global-search__item-cover") &&
        !img.classList.contains("global-search__friend-avatar")
      ) {
        return;
      }
      // Evitar bucle: si ya es el placeholder (data URI), no reasignar.
      if (img.src === ui.PLACEHOLDER_COVER) return;
      img.src = ui.PLACEHOLDER_COVER;
    },
    true // capture: el evento "error" no burbujea
  );

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
    // Issue #149: al borrar el texto se desmarca el catálogo activo para
    // que el usuario vuelva a elegir botón de tipo (renderTypeButtons
    // marca is-active comparando con activeGroup).
    activeGroup = null;
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

  // Issue #149: si hay un catálogo activo y la query actual no tiene
  // estado (vuelo/caché/error) para esta query exacta, relanzar la
  // búsqueda externa automáticamente. runExternalSearch hace su propio
  // renderResults (muestra «Buscando en el catálogo…» y luego el
  // resultado); por eso hacemos return y no renderizamos dos veces.
  const group = activeGroup;
  if (group) {
    const sameQueryInFlight = inFlight[group] && externalQuery[group] === trimmed;
    const cachedForQuery = externalCache[group] && externalCache[group].query === trimmed;
    const erroredForQuery = externalError[group] && externalError[group].query === trimmed;
    if (!sameQueryInFlight && !cachedForQuery && !erroredForQuery) {
      runExternalSearch(group, trimmed);
      return;
    }
  }

  renderResults(collectionResults(trimmed), trimmed);
}
