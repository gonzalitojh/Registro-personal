// =============================================================
// Búsqueda de películas y series, y datos de temporadas/episodios
// en TMDB. Gratis para uso no comercial, con atribución (ver
// footer de index.html). Documentación:
// https://developer.themoviedb.org/docs
// =============================================================

import { TMDB_API_KEY } from "./config.js";

const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w342";

export async function searchMovies(searchTerm) {
  const url = `${BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&query=${encodeURIComponent(
    searchTerm
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  }
  const data = await res.json();
  return (data.results || []).map(mapMovieResult);
}

export async function searchTv(searchTerm) {
  const url = `${BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&query=${encodeURIComponent(
    searchTerm
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  }
  const data = await res.json();
  return (data.results || []).map(mapTvResult);
}

function mapMovieResult(r) {
  return {
    externalId: String(r.id),
    type: "movie",
    title: r.title,
    year: (r.release_date || "").slice(0, 4),
    coverUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    overview: r.overview || "",
  };
}

function mapTvResult(r) {
  return {
    externalId: String(r.id),
    type: "tv",
    title: r.name,
    year: (r.first_air_date || "").slice(0, 4),
    coverUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    overview: r.overview || "",
  };
}

// Lista de temporadas de una serie (nombre y nº de episodios de cada una).
// Se pide "en vivo" cada vez que se abre el detalle, para reflejar
// siempre el catálogo real (por ejemplo si TMDB añade una temporada nueva).
// Se ignoran los "specials" (season_number 0).
export async function getTvSeasonsMeta(tvId) {
  const url = `${BASE_URL}/tv/${tvId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo obtener la serie desde TMDB.");
  }
  const data = await res.json();
  return (data.seasons || [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
    }));
}

// Episodios (número y nombre) de una temporada concreta. Se piden solo
// cuando el usuario despliega esa temporada, no todas de golpe.
export async function getSeasonEpisodes(tvId, seasonNumber) {
  const url = `${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("No se pudo obtener la temporada desde TMDB.");
  }
  const data = await res.json();
  return (data.episodes || []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name || `Episodio ${e.episode_number}`,
  }));
}
