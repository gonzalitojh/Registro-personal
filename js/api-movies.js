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

// Extrae la URL del tráiler oficial de YouTube a partir de la
// respuesta del endpoint /videos de TMDB. Prioriza "Trailer" sobre
// "Teaser" y, dentro del mismo tipo, el más reciente (por id).
function _extractTrailerUrl(videos) {
  if (!videos || !videos.results || !videos.results.length) return null;
  const trailers = videos.results.filter(
    (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  );
  if (!trailers.length) return null;
  // Priorizar "Trailer" sobre "Teaser"
  const best = trailers.find((v) => v.type === "Trailer") || trailers[0];
  return `https://www.youtube.com/watch?v=${best.key}`;
}

// Datos ampliados de una película: duración, sinopsis, género,
// director, reparto principal, colección/saga y tráiler. Se piden
// una sola vez, al añadirla.
export async function getMovieDetails(id) {
  const url = `${BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
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
    communityRating: data.vote_count > 0 ? data.vote_average : null,
    trailerUrl: _extractTrailerUrl(data.videos),
    collectionId: data.belongs_to_collection ? String(data.belongs_to_collection.id) : null,
    collectionName: data.belongs_to_collection ? data.belongs_to_collection.name : null,
    collectionPoster: data.belongs_to_collection?.poster_path
      ? `${IMG_BASE.replace("w342", "w92")}${data.belongs_to_collection.poster_path}`
      : null,
  };
}

// Datos de una colección/saga de TMDB: nombre, póster y lista de
// películas que la componen. Se usa al pulsar "Añadir resto de la
// saga" desde la ficha de una película.
export async function getCollectionDetails(collectionId) {
  const url = `${BASE_URL}/collection/${collectionId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    posterPath: data.poster_path || null,
    parts: (data.parts || []).map((p) => ({
      externalId: String(p.id),
      title: p.title,
      year: (p.release_date || "").slice(0, 4),
      posterUrl: p.poster_path
        ? `${IMG_BASE.replace("w342", "w185")}${p.poster_path}`
        : null,
      overview: p.overview || "",
      releaseDate: p.release_date || null,
    })),
  };
}

// Datos ampliados de una serie: duración de episodio, sinopsis,
// género, creadores, reparto principal, estado de emisión, próximo
// episodio a emitir (si lo hay) y tráiler. También se piden una sola vez.
export async function getTvExtraDetails(id) {
  const url = `${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
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
    communityRating: data.vote_count > 0 ? data.vote_average : null,
    trailerUrl: _extractTrailerUrl(data.videos),
  };
}

// =============================================================
// Plataformas de streaming (watch providers) desde TMDB.
// Devuelve los proveedores de streaming, alquiler y compra para
// un título (película o serie) en un país concreto.
// Los resultados se cachean en memoria para evitar llamadas
// redundantes durante la misma sesión.
// =============================================================

const IMG_LOGO = "https://image.tmdb.org/t/p/w92";
const providersCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

function getCached(key) {
  const entry = providersCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    providersCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  providersCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Obtiene los watch providers de una película o serie en TMDB.
 * @param {string|number} id          - ID externo de TMDB
 * @param {'movie'|'tv'}  type        - Tipo de contenido
 * @param {string}        countryCode - Código ISO 3166-1 alpha-2 (ej: "ES", "US")
 * @returns {Promise<{flatrate:Array, rent:Array, buy:Array, link:string|null}|null>}
 */
export async function getWatchProviders(id, type, countryCode = "ES") {
  const cacheKey = `wp_${type}_${id}_${countryCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const endpoint = type === "tv" ? "tv" : "movie";
  const url = `${BASE_URL}/${endpoint}/${id}/watch/providers?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results || !data.results[countryCode]) {
    setCache(cacheKey, null);
    return null;
  }

  const country = data.results[countryCode];
  const result = {
    flatrate: (country.flatrate || []).map(normalizeProvider),
    rent: (country.rent || []).map(normalizeProvider),
    buy: (country.buy || []).map(normalizeProvider),
    link: country.link || null,
  };

  setCache(cacheKey, result);
  return result;
}

// =============================================================
// Recomendaciones (contenido similar) desde TMDB. Devuelve
// listas de películas o series similares usando el endpoint
// /similar de TMDB. Los resultados tienen la misma forma que
// los de búsqueda (externalId, title, year, coverUrl, overview).
// =============================================================

export async function getSimilarMovies(id) {
  const url = `${BASE_URL}/movie/${id}/similar?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results) return [];
  return data.results.map(mapMovieResult);
}

export async function getSimilarTv(id) {
  const url = `${BASE_URL}/tv/${id}/similar?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results) return [];
  return data.results.map(mapTvResult);
}

function normalizeProvider(p) {
  return {
    providerId: p.provider_id,
    providerName: p.provider_name,
    logoUrl: p.logo_path ? `${IMG_LOGO}${p.logo_path}` : null,
    displayPriority: p.display_priority || 99,
  };
}
