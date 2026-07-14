// =============================================================
// Búsqueda de libros.
// Fuente principal: Google Books API (gratuita, con o sin clave).
// Fuente alternativa: Open Library (gratuita y sin clave), usada si
// Google Books no encuentra nada o falla varias veces seguidas.
// Goodreads no se usa porque su API pública dejó de emitir claves
// nuevas en 2020.
// =============================================================

import { GOOGLE_BOOKS_API_KEY } from "./config.js";

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";

// Google Books a veces devuelve 503 "Service temporarily unavailable"
// de forma puntual. Reintentamos un par de veces antes de rendirnos.
async function fetchWithRetry(url, retries = 2, delayMs = 700) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      // Solo merece la pena reintentar errores de servidor (5xx),
      // no errores de la propia petición (4xx, p. ej. clave inválida).
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

// Agrupa resultados que son, en la práctica, el mismo libro (misma
// combinación de título + autor), quedándonos con una sola edición
// -preferiblemente la que tenga portada- en vez de mostrar cada
// idioma/tapa/reimpresión como un resultado aparte.
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

export async function searchBooks(searchTerm) {
  const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${GOOGLE_BOOKS_API_KEY}` : "";
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(
    searchTerm
  )}&maxResults=40&langRestrict=es${keyParam}`;

  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = dedupeBooks((data.items || []).map(mapGoogleBooksResult)).slice(0, 15);

    // Si Google Books no devuelve nada, probamos con Open Library.
    if (results.length === 0) {
      return searchBooksOpenLibrary(searchTerm);
    }
    return results;
  } catch (err) {
    // Si Google Books falla de forma persistente (p. ej. varios 503
    // seguidos), no dejamos al usuario sin resultados: probamos
    // Open Library como respaldo antes de darnos por vencidos.
    try {
      return await searchBooksOpenLibrary(searchTerm);
    } catch (fallbackErr) {
      throw new Error(
        "No se pudo buscar el libro (Google Books no responde ahora mismo). Prueba de nuevo en unos segundos."
      );
    }
  }
}

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
  };
}

export async function searchBooksOpenLibrary(searchTerm) {
  const url = `${OPEN_LIBRARY_URL}?q=${encodeURIComponent(searchTerm)}&limit=40`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en Open Library.");
  }
  const data = await res.json();

  const results = (data.docs || []).map((d) => ({
    externalId: d.key,
    type: "book",
    title: d.title,
    author: (d.author_name || []).join(", "),
    year: d.first_publish_year ? String(d.first_publish_year) : "",
    pages: null,
    coverUrl: d.cover_i
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
      : null,
  }));

  return dedupeBooks(results).slice(0, 15);
}
