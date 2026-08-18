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
// Fotos de personas del elenco (issue #294): w185 equilibra nitidez y
// peso para las tarjetas de los carruseles y las filas de la ventana
// (mismo patrón de tamaño alternativo que las colecciones).
const IMG_PERSON = "https://image.tmdb.org/t/p/w185";

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

// Persona del reparto (issue #294): nombre, personaje y foto. Se
// conserva el orden de facturación de TMDB (order) para respetarlo en
// carruseles y ventanas. Sin profile_path → profileUrl null (la UI
// pone un placeholder).
function mapCastPerson(c) {
  return {
    id: c.id,
    name: c.name || "",
    character: c.character || "",
    profileUrl: c.profile_path ? `${IMG_PERSON}${c.profile_path}` : null,
    order: c.order ?? 999,
  };
}

// Persona del equipo técnico (issue #294): puesto (job) y área
// (department) de TMDB, para agrupar la producción por áreas en la
// ventana de detalle. Sin profile_path → profileUrl null.
function mapCrewPerson(c) {
  return {
    id: c.id,
    name: c.name || "",
    job: c.job || "",
    department: c.department || "Otros",
    profileUrl: c.profile_path ? `${IMG_PERSON}${c.profile_path}` : null,
    order: c.order ?? 999,
  };
}

// Fusiona los creadores de una serie (data.created_by) en la lista de
// crew, cuando no estén ya presentes por id: los creadores se muestran
// en el carrusel de producción junto al resto del equipo (issue #294).
function mergeCreatorsIntoCrew(crew, createdBy) {
  const ids = new Set(crew.map((c) => c.id));
  const creators = (createdBy || [])
    .filter((c) => c.id && !ids.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name || "",
      job: "Creador",
      department: "Creadores",
      profileUrl: c.profile_path ? `${IMG_PERSON}${c.profile_path}` : null,
      order: -1, // los creadores encabezan la producción
    }));
  return [...creators, ...crew];
}

// Normaliza la lista de temporadas que devuelve TMDB: se ignoran los
// "specials" (season_number 0) y la fecha de emisión se normaliza a
// null cuando TMDB no la anuncia (una temporada sin air_date NO está
// estrenada; un null es información real, no un fallo de la API).
function normalizeSeasons(seasons) {
  return (seasons || [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date || null,
    }));
}

// Mapa temporada -> fecha de emisión (o null si aún no tiene fecha
// oficial): { "1": "2020-01-01", "2": null, ... }. Object.fromEntries
// conserva los null, que son información real de "temporada sin
// estrenar". Se persiste en el ítem y se refresca a diario.
export function seasonAirDateMap(seasons) {
  return Object.fromEntries(
    normalizeSeasons(seasons).map((s) => [String(s.seasonNumber), s.airDate])
  );
}

// Lista de temporadas de una serie (nombre y nº de episodios de cada una),
// más datos "en vivo" sobre el estado de emisión y el próximo episodio
// (útiles para el aviso de "aún no estrenada").
export async function getTvSeasonsMeta(tvId) {
  const url = `${BASE_URL}/tv/${tvId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la serie desde TMDB.");
  });
  return normalizeSeasons(data.seasons);
}

// Episodios (número, nombre, fecha de emisión y valoración de la
// comunidad) de una temporada concreta. Se piden solo cuando el
// usuario despliega esa temporada o marca un episodio, y se cachean
// en memoria 24 h (misma caché compartida que los watch providers).
export async function getSeasonEpisodes(tvId, seasonNumber) {
  const cacheKey = `season_${tvId}_${seasonNumber}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la temporada desde TMDB.");
  });
  const episodes = (data.episodes || []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name || `Episodio ${e.episode_number}`,
    airDate: e.air_date || null,
    episodeRating: e.vote_count > 0 ? e.vote_average : null,
  }));
  setCache(cacheKey, episodes);
  return episodes;
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
// ELENCO COMPLETO (issue #294): reparto (cast) con personaje y foto, y
// equipo técnico (crew) con puesto y área para los carruseles de la
// ficha, colección/saga y tráiler. Con el almacenamiento mínimo
// (issue #200) se piden bajo demanda al abrir la ficha (y de paso al
// alta para conocer la fecha de estreno), con caché en memoria de 24 h
// (la misma compartida que los watch providers): una ficha recién
// añadida o ya visitada no vuelve a llamar a la API.
export async function getMovieDetails(id) {
  const cacheKey = `details_movie_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  const director = ((data.credits && data.credits.crew) || []).find(
    (c) => c.job === "Director"
  );
  const result = {
    // Título: lo consume la preview de página directa del ítem (issue
    // #285) y es aditivo para el resto de llamadores (lo ignoran).
    title: data.title || "",
    runtime: data.runtime || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    // Elenco completo (issue #294), para los carruseles de producción
    // y reparto de la ficha. Antes solo se guardaban 5 nombres.
    cast: ((data.credits && data.credits.cast) || []).map(mapCastPerson),
    crew: ((data.credits && data.credits.crew) || []).map(mapCrewPerson),
    director: director ? director.name : null,
    releaseDate: data.release_date || null,
    communityRating: data.vote_count > 0 ? data.vote_average : null,
    trailerUrl: _extractTrailerUrl(data.videos),
    collectionId: data.belongs_to_collection ? String(data.belongs_to_collection.id) : null,
    collectionName: data.belongs_to_collection ? data.belongs_to_collection.name : null,
    collectionPoster: data.belongs_to_collection?.poster_path
      ? `${IMG_BASE.replace("w342", "w92")}${data.belongs_to_collection.poster_path}`
      : null,
    coverUrl: data.poster_path ? `${IMG_BASE}${data.poster_path}` : null,
  };
  setCache(cacheKey, result);
  return result;
}

// Datos de una colección/saga de TMDB: nombre, póster y lista de
// películas que la componen. Se usa al pulsar "Añadir resto de la
// saga" desde la ficha de una película, y también para mostrar
// "Otras películas de la saga" en el modal (issue #280). Con caché
// en memoria de 24 h (la compartida con getMovieDetails y watch
// providers): una colección ya consultada no repite llamada. Solo
// se cachean las respuestas correctas; un fallo transitorio de red
// no oculta la sección durante 24 h.
export async function getCollectionDetails(collectionId) {
  const cacheKey = `collection_${collectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/collection/${collectionId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return null;
  const result = {
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
  setCache(cacheKey, result);
  return result;
}

// Datos ampliados de una serie: duración de episodio, sinopsis,
// género, creadores, ELENCO COMPLETO (issue #294): reparto (cast) con
// personaje y foto, y equipo técnico (crew) con puesto y área (con los
// creadores fusionados al principio), estado de emisión, próximo
// episodio a emitir (si lo hay) y tráiler. Con el almacenamiento
// mínimo (issue #200) se piden bajo demanda al abrir la ficha (y de
// paso al alta para conocer estrenos/fechas de temporada), con caché
// en memoria de 24 h (misma caché compartida que los watch providers).
export async function getTvExtraDetails(id) {
  const cacheKey = `details_tv_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  const result = {
    // Título: lo consume la preview de página directa del ítem (issue
    // #285) y es aditivo para el resto de llamadores (lo ignoran). En
    // TMDB las series usan "name" (ver getMovieDetails para movies).
    title: data.name || "",
    episodeRuntime: (data.episode_run_time && data.episode_run_time[0]) || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    // Elenco completo (issue #294): antes solo 5 nombres. Los
    // creadores se añaden al crew como área "Creadores" (sin duplicar
    // por id), además de conservarse en el campo creators (compat).
    cast: ((data.credits && data.credits.cast) || []).map(mapCastPerson),
    crew: mergeCreatorsIntoCrew(
      ((data.credits && data.credits.crew) || []).map(mapCrewPerson),
      data.created_by
    ),
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
    coverUrl: data.poster_path ? `${IMG_BASE}${data.poster_path}` : null,
    // Fechas de emisión por temporada (null = temporada aún sin estrenar).
    // Se persiste junto al ítem para poder avisar del "no estrenado"
    // aunque TMDB deje de devolver next_episode_to_air.
    seasonAirDates: seasonAirDateMap(data.seasons),
  };
  setCache(cacheKey, result);
  return result;
}

// =============================================================
// Plataformas de streaming (watch providers) desde TMDB.
// Devuelve los proveedores de streaming, alquiler y compra para
// un título (película o serie) en un país concreto.
// Los resultados se cachean en memoria para evitar llamadas
// redundantes durante la misma sesión.
// =============================================================

// País del usuario para los watch providers: ajuste guardado en
// localStorage, o el idioma del navegador (segunda parte del locale,
// ej. "es-ES" → "ES"), o "ES" por defecto. Movido aquí desde
// modal-handlers.js (issue #290) para que la página de ítem y la ficha
// compartan la misma fuente de verdad.
export function getUserCountry() {
  return localStorage.getItem("watch-provider-country")
    || (navigator.language && navigator.language.split("-")[1]?.toUpperCase())
    || "ES";
}

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
