// =============================================================
// Búsqueda de películas y series, temporadas/episodios, y datos
// ampliados (duración, reparto, sinopsis...) en TMDB. Gratis para
// uso no comercial, con atribución (ver footer de index.html).
// Documentación: https://developer.themoviedb.org/docs
// =============================================================

import { TMDB_API_KEY } from "./config.js";
import { fetchJson } from "./http.js";

const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w342";

export async function searchMovies(searchTerm, page = 1) {
  const url = `${BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&page=${page}&query=${encodeURIComponent(
    searchTerm
  )}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  });
  return {
    items: (data.results || []).map(mapMovieResult),
    hasMore: (data.page || 1) < (data.total_pages || 1),
  };
}

export async function searchTv(searchTerm, page = 1) {
  const url = `${BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&page=${page}&query=${encodeURIComponent(
    searchTerm
  )}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  });
  return {
    items: (data.results || []).map(mapTvResult),
    hasMore: (data.page || 1) < (data.total_pages || 1),
  };
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

// Lista de temporadas de una serie (nombre y nº de episodios de cada una),
// más datos "en vivo" sobre el estado de emisión y el próximo episodio
// (útiles para el aviso de "aún no estrenada"). Se ignoran los
// "specials" (season_number 0) en la lista de temporadas a marcar.
export async function getTvSeasonsMeta(tvId) {
  const url = `${BASE_URL}/tv/${tvId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la serie desde TMDB.");
  });
  return (data.seasons || [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date || null,
    }));
}

// Episodios (número, nombre y fecha de emisión) de una temporada
// concreta. Se piden solo cuando el usuario despliega esa temporada.
export async function getSeasonEpisodes(tvId, seasonNumber) {
  const url = `${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la temporada desde TMDB.");
  });
  return (data.episodes || []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name || `Episodio ${e.episode_number}`,
    airDate: e.air_date || null,
  }));
}

// Datos ampliados de una película: duración, sinopsis, género,
// director y reparto principal. Se piden una sola vez, al añadirla.
export async function getMovieDetails(id) {
  const url = `${BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  const director = ((data.credits && data.credits.crew) || []).find(
    (c) => c.job === "Director"
  );
  return {
    runtime: data.runtime || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    cast: ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name),
    director: director ? director.name : null,
    releaseDate: data.release_date || null,
  };
}

// Datos ampliados de una serie: duración de episodio, sinopsis,
// género, creadores, reparto principal, estado de emisión y próximo
// episodio a emitir (si lo hay). También se piden una sola vez.
export async function getTvExtraDetails(id) {
  const url = `${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  return {
    episodeRuntime: (data.episode_run_time && data.episode_run_time[0]) || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    cast: ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name),
    creators: (data.created_by || []).map((c) => c.name),
    tmdbStatus: data.status || null,
    firstAirDate: data.first_air_date || null,
    nextEpisodeToAir: data.next_episode_to_air
      ? {
          season: data.next_episode_to_air.season_number,
          episode: data.next_episode_to_air.episode_number,
          airDate: data.next_episode_to_air.air_date || null,
        }
      : null,
  };
}
