// =============================================================
// Buscador Global — busca simultáneamente en películas, series,
// libros y amigos. Se abre con Ctrl+K (Cmd+K en Mac) o "/".
// =============================================================

import { openItem } from "./modal-handlers.js";
import * as ui from "./ui.js";

// ---- Estado interno ----

let isOpen = false;
let highlightedIndex = -1;
let flatResults = [];
let cachedProfiles = null;
let profilePromise = null;
let searchCtx = null;

// ---- Referencias DOM (se asignan en setup) ----

let el, input, resultsEl, backdrop, closeBtn;

// ---- Utilidades ----

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function renderResults(results, query) {
  const { movies = [], tv = [], books = [], friends = [] } = results;

  const hasAny = movies.length || tv.length || books.length || friends.length;

  if (!query.trim() || query.trim().length < 2) {
    resultsEl.innerHTML = `<p class="global-search__hint">Escribe al menos 2 caracteres para buscar en tus películas, series, libros y amigos.</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }

  if (!hasAny) {
    resultsEl.innerHTML = `<p class="global-search__empty">No se encontraron resultados para "${escapeHtml(query.trim())}".</p>`;
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
  let html = "";
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
        html += `<div class="global-search__friend" data-global-idx="${globalIdx}" tabindex="-1">
          <img class="global-search__friend-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" />
          <div class="global-search__friend-info">
            <div class="global-search__friend-name">${escapeHtml(name)}</div>
            <div class="global-search__friend-email">${escapeHtml(email)}</div>
          </div>
        </div>`;
        newFlat.push({ type: "friend", item: entry, group: key });
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

        html += `<div class="global-search__item" data-global-idx="${globalIdx}" tabindex="-1">
          <img class="global-search__item-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
          <div class="global-search__item-info">
            <div class="global-search__item-title">${escapeHtml(title)}</div>
            <div class="global-search__item-meta">${escapeHtml(meta)}</div>
          </div>
          <span class="global-search__item-status chip ${statusClass(status)}">${ui.statusLabel(status, entry.type)}</span>
        </div>`;
        newFlat.push({ type: entry.type || key, item: entry, group: key });
      }
      globalIdx++;
    }
  }

  resultsEl.innerHTML = html;
  flatResults = newFlat;
  highlightedIndex = -1;

  // Conectar eventos de click en cada resultado
  resultsEl.querySelectorAll("[data-global-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.globalIdx, 10);
      if (flatResults[idx]) {
        navigateTo(flatResults[idx]);
      }
    });

    // Mouseenter para seguimiento visual (sin cambiar highlightedIndex)
    el.addEventListener("mouseenter", () => {
      // Quitar highlight previo
      resultsEl.querySelector(".global-search__item--highlighted")?.classList.remove("global-search__item--highlighted");
      resultsEl.querySelector(".global-search__friend--highlighted")?.classList.remove("global-search__friend--highlighted");
      // No lo marcamos para no interferir con teclado
    });
  });
}

// ---- Navegación ----

function navigateTo(result) {
  if (result.type === "friend") {
    ui.showToast(`Próximamente podrás ver el perfil de ${result.item.displayName || result.item.name || "tu amigo"}.`);
    closeGlobalSearch();
    return;
  }

  // Es un item (movie/tv/book)
  const item = result.item;
  if (!searchCtx) {
    ui.showToast("Error: contexto no disponible.");
    return;
  }
  closeGlobalSearch();
  // Pequeño delay para que el cierre del modal no interfiera
  setTimeout(() => {
    openItem(item, searchCtx);
  }, 150);
}

// ---- Abrir / Cerrar ----

function openGlobalSearch() {
  if (isOpen) return;
  isOpen = true;
  el.classList.remove("hidden");
  input.value = "";
  resultsEl.innerHTML = `<p class="global-search__hint">Escribe para buscar en tus películas, series, libros y amigos.</p>`;
  flatResults = [];
  highlightedIndex = -1;
  setTimeout(() => input.focus(), 50);

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

function closeGlobalSearch() {
  if (!isOpen) return;
  isOpen = false;
  el.classList.add("hidden");
  input.value = "";
  resultsEl.innerHTML = "";
  flatResults = [];
  highlightedIndex = -1;
  input.blur();
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

  if (flatResults[idx].type === "friend") {
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
 * Inicializa el buscador global.
 * @param {Object} ctx - Contexto de la aplicación (con getAllItems, etc.)
 */
export function setupGlobalSearch(ctx) {
  el = document.getElementById("global-search");
  input = document.getElementById("global-search-input");
  resultsEl = document.getElementById("global-search-results");
  backdrop = document.getElementById("global-search-backdrop");
  closeBtn = document.getElementById("global-search-close");

  if (!el || !input || !resultsEl) {
    console.warn("global-search: elementos DOM no encontrados");
    return;
  }

  // Guardamos ctx para usarlo en navigateTo
  searchCtx = ctx;

  // ---- Eventos ----

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
      e.stopPropagation();
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

  // Cerrar con backdrop
  backdrop.addEventListener("click", closeGlobalSearch);

  // Cerrar con botón
  closeBtn.addEventListener("click", closeGlobalSearch);

  // Botón de lupa en el header
  const searchBtn = document.getElementById("btn-global-search");
  if (searchBtn) {
    searchBtn.addEventListener("click", openGlobalSearch);
  }

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
    resultsEl.innerHTML = `<p class="global-search__hint">Escribe al menos 2 caracteres para buscar en tus películas, series, libros y amigos.</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }

  // Items desde el contexto
  const allItems = ctx.getAllItems();
  const movies = filterItems(allItems.movies || [], trimmed);
  const tv = filterItems(allItems.tv || [], trimmed);
  const books = filterItems(allItems.books || [], trimmed);

  // Amigos desde la caché
  let friends = [];
  if (cachedProfiles) {
    friends = filterFriends(cachedProfiles, trimmed);
  } else if (profilePromise) {
    try {
      cachedProfiles = await profilePromise;
      friends = filterFriends(cachedProfiles, trimmed);
    } catch {
      cachedProfiles = [];
    }
  } else {
    // Iniciar carga
    try {
      cachedProfiles = await ctx.getAllUserProfiles();
      friends = filterFriends(cachedProfiles, trimmed);
    } catch {
      cachedProfiles = [];
    }
  }

  renderResults(
    {
      movies: movies.slice(0, 5),
      tv: tv.slice(0, 5),
      books: books.slice(0, 5),
      friends: friends.slice(0, 3),
    },
    trimmed
  );
}
