// =============================================================
// Búsqueda de libros.
// Fuente principal: Google Books API (gratuita, con o sin clave).
// Fuente alternativa: Open Library (gratuita y sin clave), útil como
// respaldo si Google Books no encuentra el libro. Goodreads no se usa
// porque su API pública dejó de emitir claves nuevas en 2020.
// =============================================================

import { GOOGLE_BOOKS_API_KEY } from "./config.js";

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";

export async function searchBooks(searchTerm) {
  const keyParam = GOOGLE_BOOKS_API_KEY
    ? `&key=${GOOGLE_BOOKS_API_KEY}`
    : "";
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(
    searchTerm
  )}&maxResults=20&langRestrict=es${keyParam}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en Google Books.");
  }
  const data = await res.json();
  const results = (data.items || []).map(mapGoogleBooksResult);

  // Si Google Books no devuelve nada, probamos con Open Library.
  if (results.length === 0) {
    return searchBooksOpenLibrary(searchTerm);
  }
  return results;
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
  const url = `${OPEN_LIBRARY_URL}?q=${encodeURIComponent(searchTerm)}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en Open Library.");
  }
  const data = await res.json();

  return (data.docs || []).map((d) => ({
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
}
