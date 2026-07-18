// =============================================================
// Búsqueda de libros.
// Fuente principal: Open Library. A diferencia de Google Books,
// agrupa resultados por LIBRO (obra), no por edición, así que una
// búsqueda no te llena la lista con la misma novela en tapa dura,
// bolsillo, inglés, francés... Es, con diferencia, la que más se
// parece al estilo "un libro = un resultado" de Goodreads (cuya
// API pública dejó de emitir claves nuevas en 2020).
// Fuente de respaldo: Google Books, solo si Open Library no
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

// Por si dos ediciones distintas se cuelan como resultados aparte
// (pasa poco con Open Library, pero puede pasar con Google Books),
// nos quedamos con una por título + autor, prefiriendo la que tenga
// portada.
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

/* ---------- Open Library (fuente principal) ---------- */

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
    // "spa" = español, según el código ISO 639-2 de la edición que Open
    // Library eligió como representativa de este libro.
    language: extractEditionLanguage(d),
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

/* ---------- Google Books (respaldo) ---------- */

function mapGoogleBooksResult(item) {
  const info = item.volumeInfo || {};
  const cover = info.imageLinks && info.imageLinks.thumbnail;
  return {
    externalId: item.id,
    type: "book",
    title: info.title || "Sin título",
    author: (info.authors || []).join(", "),
    year: (info.publishedDate || "").slice(0, 4),
    pages: info.pageCount || null,
    coverUrl: cover ? cover.replace("http://", "https://") : null,
    description: info.description || "",
  };
}

export async function searchGoogleBooksResults(searchTerm, page = 1) {
  const startIndex = (page - 1) * PAGE_SIZE;
  const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${GOOGLE_BOOKS_API_KEY}` : "";
  const url =
    `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(searchTerm)}` +
    `&maxResults=${PAGE_SIZE}&startIndex=${startIndex}&langRestrict=es${keyParam}`;

  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = dedupeBooks((data.items || []).map(mapGoogleBooksResult));
  const hasMore = (data.totalItems || 0) > startIndex + items.length;
  return { items, hasMore, source: "googlebooks" };
}

/* ---------- Punto de entrada ---------- */

// page 1: decide sola qué fuente usar (Open Library primero).
// Para páginas siguientes, pásale la fuente que devolvió la página 1
// en forceSource, para seguir "cargando más" desde la misma fuente.
export async function searchBooks(searchTerm, page = 1, forceSource = null, spanishOnly = false) {
  const source = forceSource || "openlibrary";

  if (source === "googlebooks") {
    return searchGoogleBooksResults(searchTerm, page);
  }

  try {
    const result = await searchOpenLibrary(searchTerm, page, spanishOnly);
    if (result.items.length || forceSource === "openlibrary") return result;
  } catch (err) {
    if (forceSource === "openlibrary") throw err;
  }

  try {
    return await searchGoogleBooksResults(searchTerm, page);
  } catch (err) {
    throw new Error(
      "No se pudo buscar el libro ahora mismo (Open Library y Google Books no responden). Prueba de nuevo en unos segundos."
    );
  }
}
