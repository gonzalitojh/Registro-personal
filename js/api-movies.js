// =============================================================
// Búsqueda de películas y series en TMDB.
// Gratis para uso no comercial, con atribución (ver footer de index.html).
// Documentación: https://developer.themoviedb.org/docs
// =============================================================

import { TMDB_API_KEY } from "./config.js";

const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w342";

export async function searchMoviesAndShows(searchTerm) {
  const url = `${BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&query=${encodeURIComponent(
    searchTerm
  )}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  }
  const data = await res.json();

  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map(mapTmdbResult);
}

function mapTmdbResult(r) {
  const isMovie = r.media_type === "movie";
  const rawDate = isMovie ? r.release_date : r.first_air_date;
  return {
    externalId: String(r.id),
    type: isMovie ? "movie" : "tv",
    title: isMovie ? r.title : r.name,
    year: rawDate ? rawDate.slice(0, 4) : "",
    coverUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    overview: r.overview || "",
  };
}
