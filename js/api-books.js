// =============================================================
// Búsqueda de libros.
// Fuente principal: Google Books, con agrupación inteligente por
// título + autor para que múltiples ediciones de la misma obra
// aparezcan como un solo resultado. Se muestran todas las portadas
// y sinopsis disponibles al añadir, dejando al usuario elegir.
// Fuente de respaldo: Open Library, cuando Google Books no
// encuentra nada o falla.
// =============================================================

import { GOOGLE_BOOKS_API_KEY } from "./config.js";
import { fetchJson } from "./http.js";

const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const PAGE_SIZE = 20;

// Google Books a veces devuelve 503 "Service temporarily unavailable"
// de forma puntual. Reintentamos un par de veces antes de rendirnos.
async function fetchWithRetry(url, retries = 2, delayMs = 700) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

/* ---------- Utilidades de agrupación (Google Books) ---------- */

// Normaliza un título para agrupación: minúsculas, quita información
// de serie tipo "(Series, #N)" y normaliza espacios. No elimina
// subtítulos porque Google Books ya los separa en volumeInfo.subtitle.
function normalizeTitle(title) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*#\d+\)\s*$/, "")   // "(Harry Potter, #1)"
    .replace(/\s*\([^)]*book \d+\)\s*$/i, "") // "(Book 1)"
    .replace(/\s+/g, " ");
}

// Puntuación de una edición para elegir la mejor representante de un
// grupo. Prioriza portada + sinopsis + más metadatos.
function scoreEdition(item) {
  const info = item.volumeInfo || {};
  let score = 0;
  if (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) score += 3;
  if (info.description) score += 2;
  if (info.pageCount) score += 1;
  if (info.publishedDate) score += 1;
  if (info.language) score += 1;
  return score;
}

// Elige la mejor edición de un grupo para servir como representante
// (título, autor, año, páginas, externalId).
function pickBestEdition(editions) {
  let best = editions[0];
  let bestScore = scoreEdition(best);
  for (let i = 1; i < editions.length; i++) {
    const score = scoreEdition(editions[i]);
    if (score > bestScore) {
      best = editions[i];
      bestScore = score;
    }
  }
  return best;
}

// Normaliza una URL de portada: http → https, quita parámetros innecesarios.
function normalizeCoverUrl(url) {
  if (!url) return null;
  return url.replace(/^http:\/\//, "https://");
}

// Agrupa raw items de Google Books por título+autor normalizados.
// Devuelve un array de resultados enriquecidos con allCovers[],
// allDescriptions[] y editionsCount.
function groupBooksByWork(rawItems) {
  const groups = new Map();

  for (const item of rawItems) {
    const info = item.volumeInfo || {};
    const title = normalizeTitle(info.title);
    const firstAuthor = (info.authors || [])[0] || "";
    const authorKey = firstAuthor.trim().toLowerCase();
    const key = `${title}|${authorKey}`;

    if (!groups.has(key)) {
      groups.set(key, { editions: [], covers: [], descriptions: [], editionIds: [] });
    }
    const group = groups.get(key);
    group.editions.push(item);
    group.editionIds.push(item.id);

    // Recoger portadas únicas (preferir thumbnail)
    const coverRaw =
      (info.imageLinks && info.imageLinks.thumbnail) ||
      (info.imageLinks && info.imageLinks.smallThumbnail);
    const cover = normalizeCoverUrl(coverRaw);
    if (cover && !group.covers.includes(cover)) {
      group.covers.push(cover);
    }

    // Recoger sinopsis únicas (recortar y deduplicar)
    const desc = (info.description || "").trim();
    if (desc && !group.descriptions.includes(desc)) {
      group.descriptions.push(desc);
    }
  }

  // Convertir cada grupo en un único resultado de búsqueda
  return Array.from(groups.values()).map((group) => {
    const best = pickBestEdition(group.editions);
    const info = best.volumeInfo || {};
    return {
      externalId: best.id,
      type: "book",
      title: info.title || "Sin título",
      subtitle: info.subtitle || "",
      author: (info.authors || []).join(", "),
      year: (info.publishedDate || "").slice(0, 4),
      pages: info.pageCount || null,
      coverUrl: group.covers[0] || null,
      description: group.descriptions[0] || "",
      // Campos enriquecidos (solo para resultados de Google Books agrupados)
      allCovers: group.covers,
      allDescriptions: group.descriptions,
      editionsCount: group.editions.length,
    };
  });
}

/* ---------- Google Books (fuente principal) ---------- */

export async function searchGoogleBooksResults(searchTerm, page = 1) {
  const startIndex = (page - 1) * PAGE_SIZE;
  const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${GOOGLE_BOOKS_API_KEY}` : "";
  const url =
    `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(searchTerm)}` +
    `&maxResults=${PAGE_SIZE}&startIndex=${startIndex}&langRestrict=es${keyParam}`;

  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rawItems = data.items || [];
  const items = groupBooksByWork(rawItems);
  const hasMore = (data.totalItems || 0) > startIndex + rawItems.length;
  return { items, hasMore, source: "googlebooks" };
}

/* ---------- Open Library (respaldo) ---------- */

// Dedupe simple para Open Library (ya agrupa por obra, pero por
// si acaso dos ediciones distintas se cuelan).
function dedupeBooks(results) {
  const seen = new Map();
  for (const r of results) {
    const key = `${(r.title || "").trim().toLowerCase()}|${(r.author || "").trim().toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
    } else if (!existing.coverUrl && r.coverUrl) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

function extractEditionLanguage(doc) {
  const edition = doc.editions && doc.editions.docs && doc.editions.docs[0];
  if (!edition || !edition.language) return null;
  const lang = Array.isArray(edition.language) ? edition.language[0] : edition.language;
  if (!lang) return null;
  if (typeof lang === "string") return lang;
  if (lang.key) return String(lang.key).replace("/languages/", "");
  return null;
}

function mapOpenLibraryResult(d) {
  return {
    externalId: d.key, // p.ej. "/works/OL27258W"
    type: "book",
    title: d.title,
    author: (d.author_name || []).join(", "),
    year: d.first_publish_year ? String(d.first_publish_year) : "",
    pages: null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    language: extractEditionLanguage(d),
    // Open Library no tiene allCovers/allDescriptions: un solo resultado por obra.
    allCovers: d.cover_i ? [`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`] : [],
    allDescriptions: [],
    editionsCount: 1,
  };
}

// spanishOnly: si es true, descarta directamente los libros cuya edición
// representativa esté confirmada en otro idioma (se conservan los que no
// tienen ese dato, para no perder resultados por falta de metadatos).
// Si es false, no se descarta nada, pero los que sí están en español
// aparecen primero.
export async function searchOpenLibrary(searchTerm, page = 1, spanishOnly = false) {
  const url =
    `${OPEN_LIBRARY_URL}?q=${encodeURIComponent(searchTerm)}` +
    `&page=${page}&limit=${PAGE_SIZE}&lang=es` +
    `&fields=key,title,author_name,first_publish_year,cover_i,editions,editions.key,editions.language,editions.cover_i`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo buscar en Open Library.");
  });
  let items = dedupeBooks((data.docs || []).map(mapOpenLibraryResult));

  if (spanishOnly) {
    items = items.filter((r) => r.language === "spa" || !r.language);
  } else {
    items = [...items].sort((a, b) => {
      const aEs = a.language === "spa" ? 0 : 1;
      const bEs = b.language === "spa" ? 0 : 1;
      return aEs - bEs;
    });
  }

  const hasMore = (data.numFound || 0) > page * PAGE_SIZE;
  return { items, hasMore, source: "openlibrary" };
}

// Sinopsis de un libro de Open Library. Se pide solo al añadirlo,
// no durante la búsqueda.
export async function getOpenLibraryDescription(workKey) {
  const url = `https://openlibrary.org${workKey}.json`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return "";
  if (typeof data.description === "string") return data.description;
  if (data.description && typeof data.description.value === "string") {
    return data.description.value;
  }
  return "";
}

/* ---------- Punto de entrada ---------- */

// page 1: Google Books como fuente principal (mejores metadatos,
// agrupación inteligente por título+autor).
// Para páginas siguientes, pásale la fuente que devolvió la página 1
// en forceSource, para seguir "cargando más" desde la misma fuente.
// Si Google Books falla o no encuentra nada, se intenta Open Library.
export async function searchBooks(searchTerm, page = 1, forceSource = null, spanishOnly = false) {
  const source = forceSource || "googlebooks";

  if (source === "openlibrary") {
    return searchOpenLibrary(searchTerm, page, spanishOnly);
  }

  try {
    const result = await searchGoogleBooksResults(searchTerm, page);
    if (result.items.length || forceSource === "googlebooks") return result;
  } catch (err) {
    if (forceSource === "googlebooks") throw err;
  }

  // Respaldo: Open Library
  try {
    return await searchOpenLibrary(searchTerm, page, spanishOnly);
  } catch (err) {
    throw new Error(
      "No se pudo buscar el libro ahora mismo (Google Books y Open Library no responden). Prueba de nuevo en unos segundos."
    );
  }
}
