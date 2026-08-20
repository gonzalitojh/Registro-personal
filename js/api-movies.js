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

// ---------- aggregate_credits de series (issue #308) ----------
// `/tv/{id}/credits` de TMDB solo devuelve el reparto principal de la
// temporada más reciente (versión reducida); el elenco COMPLETO de la
// serie —todas las personas de todos los episodios/temporadas— está en
// `/tv/{id}/aggregate_credits` (consultado con append_to_response desde
// getTvExtraDetails). Su formato difiere del de credits: el cast lleva
// `roles: [{character, …}]` (una persona puede interpretar VARIOS
// personajes a lo largo de la serie) y el crew `jobs: [{job, …}]`
// (varias funciones por persona), sin campos planos `character`/`job`.
// Estas funciones aplanan ese formato al MISMO contrato de salida que
// mapCastPerson/mapCrewPerson ({id, name, character|job, department,
// profileUrl, order}), de modo que ui.js y cast-modal.js consumen el
// elenco completo exactamente igual que el de películas.

// Une los valores de un array con ", " (sin repetidos ni vacíos):
// personajes de roles[] o puestos de jobs[].
function joinUnique(values) {
  return [...new Set((values || []).filter(Boolean))].join(", ");
}

function mapAggregateCastPerson(c) {
  return {
    id: c.id,
    name: c.name || "",
    // Todos los personajes de la persona en la serie, unidos («Ned
    // Stark», «Gregor Clegane, Dongo»…): un actor puede interpretar
    // varios personajes y la UI ya sabe envolver textos largos.
    character: joinUnique((c.roles || []).map((r) => r.character)),
    profileUrl: c.profile_path ? `${IMG_PERSON}${c.profile_path}` : null,
    order: c.order ?? 999,
  };
}

function mapAggregateCrewPerson(c) {
  return {
    id: c.id,
    name: c.name || "",
    // Todos los puestos de la persona, unidos («Director, Guionista»):
    // mismo criterio de fusión que la ventana de detalle (que los une
    // con ", " dentro de cada área, groupCrewByDepartment).
    job: joinUnique((c.jobs || []).map((j) => j.job)),
    department: c.department || "Otros",
    profileUrl: c.profile_path ? `${IMG_PERSON}${c.profile_path}` : null,
    // aggregate_credits no siempre trae order en el crew: mismo
    // fallback ?? 999 que el resto de mapeos y que la propia UI.
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
// género, creadores, ELENCO COMPLETO (issue #294 y #308): reparto
// (cast) con personaje y foto, y equipo técnico (crew) con puesto y
// área (con los creadores fusionados al principio), estado de emisión,
// próximo episodio a emitir (si lo hay) y tráiler. Con el
// almacenamiento mínimo (issue #200) se piden bajo demanda al abrir la
// ficha (y de paso al alta para conocer estrenos/fechas de temporada),
// con caché en memoria de 24 h (misma caché compartida que los watch
// providers).
//
// El elenco se consulta con `append_to_response=aggregate_credits`
// (issue #308), NO con `credits`: `/tv/{id}/credits` solo devuelve el
// reparto principal de la temporada más reciente (versión reducida),
// mientras que aggregate_credits devuelve la lista COMPLETA de todas
// las personas de todos los episodios/temporadas.
export async function getTvExtraDetails(id) {
  const cacheKey = `details_tv_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=aggregate_credits,videos`;
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
    // Elenco COMPLETO (issue #294/#308): el cast de aggregate_credits
    // trae roles[] (varios personajes por persona, unidos en
    // mapAggregateCastPerson) y el crew jobs[] (varias funciones por
    // persona). Los creadores se añaden al crew como área "Creadores"
    // (sin duplicar por id), además de conservarse en el campo
    // creators (compat).
    cast: ((data.aggregate_credits && data.aggregate_credits.cast) || []).map(mapAggregateCastPerson),
    crew: mergeCreatorsIntoCrew(
      ((data.aggregate_credits && data.aggregate_credits.crew) || []).map(mapAggregateCrewPerson),
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
// Premios de películas/series (issue #302, iteración). TMDB NO
// expone premios en su API pública (solo en su web), así que se
// consultan en Wikidata: primero se obtiene el identificador de
// Wikidata del título con /external_ids de TMDB (que también lo
// publica) y después se consultan las declaraciones P166
// («award received») y P1411 («nominated for») del ítem en el
// endpoint SPARQL de Wikidata (público, sin clave y con CORS
// abierto). Cada premio se muestra con su nombre, la familia a
// la que pertenece (Óscar, Globos de Oro…, para agruparlos), el
// año de la ceremonia (cualificador P585), en su caso el trabajo
// por el que se concedió (cualificador P1686, p. ej. el episodio
// de una serie) y los implicados (ganador P1346 o nominados
// P2453, p. ej. el actor de un premio de interpretación).
// Los resultados de ÉXITO se cachean en memoria 24 h (misma
// caché compartida que los watch providers y los detalles); un
// fallo de red se reconsulta en la siguiente apertura (mismo
// comportamiento que los watch providers).
// =============================================================

const WDQS_URL = "https://query.wikidata.org/sparql";

// Consulta SPARQL de los premios y nominaciones de un ítem de
// Wikidata (iteración 2026-08-19, comentario de la issue #302;
// issue #311: ?award y ?isList para filtrar los punteros a
// artículos de lista):
// - PREMIOS: declaraciones P166 («award received»).
// - NOMINACIONES: declaraciones P1411 («nominated for»), marcadas
//   con ?kind ("nom") para diferenciarlas de los premios.
// - IMPLICADOS: cualificador P1346 («winner») en premios y P2453
//   («nominee») en nominaciones (COALESCE a ?person): p. ej. el
//   actor de un «Óscar al mejor actor de reparto».
// - AGRUPACIÓN por tipo (Óscar, Globos de Oro, Emmy…): se resuelve
//   la familia del premio con dos rutas — la ceremonia del año
//   (P805 → P179/P361 del ítem de la ceremonia, p. ej. «Premios
//   Óscar de 2008» → «Premios Óscar») o, en su defecto, el propio
//   ítem del premio (P361/P179); si ninguna existe, el grupo es el
//   nombre del premio (COALESCE a ?group).
// - Fecha de la ceremonia (P585), obra por la que se concedió
//   (P1686, omitida cuando es el propio ítem).
// - PUNTEROS A LISTAS (issue #311): ?isList marca las filas cuyo
//   valor de premio es un ítem de «artículo de lista de Wikimedia»
//   (P31 = Q13406463, p. ej. «List of awards and nominations
//   received by X»): NO es un premio real y la app lo descarta
//   (isListPointerRow/mapAwardsBindings); ?award (el QID) permite
//   desreferenciar el ítem de lista en busca de declaraciones
//   propias P166/P1411 cuando el título no tiene ninguna.
// Las etiquetas se resuelven en español y, si no existe, en inglés.
function wikidataAwardsQuery(wikidataId) {
  return `
SELECT ?kind ?award ?isList ?awardLabel ?groupLabel ?year ?workLabel ?personLabel WHERE {
  {
    wd:${wikidataId} p:P166 ?st.
    ?st ps:P166 ?award.
    BIND("award" AS ?kind)
  } UNION {
    wd:${wikidataId} p:P1411 ?st.
    ?st ps:P1411 ?award.
    BIND("nom" AS ?kind)
  }
  OPTIONAL { ?st pq:P585 ?date. }
  OPTIONAL { ?st pq:P1686 ?work. FILTER(?work != wd:${wikidataId}) }
  OPTIONAL { ?st pq:P1346 ?winner. }
  OPTIONAL { ?st pq:P2453 ?nominee. }
  BIND(COALESCE(?winner, ?nominee) AS ?person)
  OPTIONAL { ?st pq:P805 ?ceremony. ?ceremony wdt:P179|wdt:P361 ?groupOfCeremony. }
  OPTIONAL { ?award wdt:P361|wdt:P179 ?groupOfAward. }
  BIND(COALESCE(?groupOfCeremony, ?groupOfAward, ?award) AS ?group)
  BIND(YEAR(?date) as ?year)
  BIND(EXISTS { ?award wdt:P31 wd:Q13406463 } AS ?isList)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
} ORDER BY DESC(?year)`;
}

// Variante sin identificador de Wikidata conocido: busca el ítem
// por el id de TMDB de una serie (P4983) o por el id de IMDb de
// una película (P345), cuando /external_ids no trae wikidata_id.
// Misma consulta que wikidataAwardsQuery, con ?item en lugar de
// un QID fijo (la obra P1686 se omite cuando es el propio ítem).
function wikidataAwardsByExternalIdQuery(type, externalId) {
  const prop = type === "tv" ? "P4983" : "P345";
  return `
SELECT ?kind ?award ?isList ?awardLabel ?groupLabel ?year ?workLabel ?personLabel WHERE {
  ?item wdt:${prop} "${externalId}".
  {
    ?item p:P166 ?st.
    ?st ps:P166 ?award.
    BIND("award" AS ?kind)
  } UNION {
    ?item p:P1411 ?st.
    ?st ps:P1411 ?award.
    BIND("nom" AS ?kind)
  }
  OPTIONAL { ?st pq:P585 ?date. }
  OPTIONAL { ?st pq:P1686 ?work. FILTER(?work != ?item) }
  OPTIONAL { ?st pq:P1346 ?winner. }
  OPTIONAL { ?st pq:P2453 ?nominee. }
  BIND(COALESCE(?winner, ?nominee) AS ?person)
  OPTIONAL { ?st pq:P805 ?ceremony. ?ceremony wdt:P179|wdt:P361 ?groupOfCeremony. }
  OPTIONAL { ?award wdt:P361|wdt:P179 ?groupOfAward. }
  BIND(COALESCE(?groupOfCeremony, ?groupOfAward, ?award) AS ?group)
  BIND(YEAR(?date) as ?year)
  BIND(EXISTS { ?award wdt:P31 wd:Q13406463 } AS ?isList)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
} ORDER BY DESC(?year)`;
}

// Limpia las etiquetas de Wikidata: muchas páginas de premios
// españolas son anexos y su etiqueta empieza por «Anexo:»
// (p. ej. «Anexo:Oscar al mejor actor de reparto»).
function cleanAwardLabel(label) {
  return (label || "").replace(/^Anexo:\s*/i, "").trim();
}

// True cuando la fila de la consulta SPARQL es un PUNTERO a un
// artículo de lista de Wikipedia (issue #311): el valor del premio
// no es un premio real sino el ítem «List of awards and nominations
// received by X» (P31 = Q13406463 «artículo de lista de Wikimedia»,
// p. ej. el caso de Stranger Things). Esas filas no deben pintarse
// como premio (sería una entrada basura) y, cuando son las ÚNICAS
// del título, marcan la ruta de desreferencia de getItemAwards
// (consultar las declaraciones propias P166/P1411 del ítem de
// lista). Detección por la propiedad ?isList de la consulta y, por
// robustez, por el patrón del nombre (nunca coinciden los anexos
// legítimos tipo «Anexo:Óscar al mejor actor», cuyo nombre limpio
// es «Óscar al mejor actor»).
function isListPointerRow(b) {
  if (b.isList && b.isList.value === "true") return true;
  const name = cleanAwardLabel(b.awardLabel && b.awardLabel.value);
  return /^list of (awards|honors|accolades|prizes)/i.test(name);
}

// Normaliza las filas de la respuesta SPARQL a los grupos de la
// sección «Premios» del render: [{ group, entries: [...] }].
// Entrada por fila: { kind, awardLabel, groupLabel, year,
// workLabel, personLabel }. Pasos:
// 1. Limpieza de etiquetas (prefijo «Anexo:») y salto de filas sin
//    nombre de premio y de los PUNTEROS a artículos de lista
//    (isListPointerRow, issue #311: «List of awards and nominations
//    received by X» no es un premio).
// 2. Deduplicación por premio+año+obra+tipo (un mismo premio puede
//    repetirse con varios cualificadores y varias declaraciones);
//    los implicados (P1346/P2453) de filas del mismo premio se
//    fusionan en la lista people (p. ej. los 4 nominados a efectos
//    visuales en una sola entrada).
// 3. Agrupación por familia (Premios Óscar, Globos de Oro…): los
//    grupos se ordenan por el año más reciente de sus entradas y
//    cada uno ordena sus entradas por año desc., premio antes que
//    nominación y nombre. Devuelve [] si no hay premios.
function mapAwardsBindings(bindings) {
  const byKey = new Map();
  for (const b of bindings || []) {
    const name = cleanAwardLabel(b.awardLabel && b.awardLabel.value);
    if (!name) continue;
    if (isListPointerRow(b)) continue;
    const kind = b.kind && b.kind.value === "award" ? "award" : "nom";
    const year = b.year ? String(b.year.value) : "";
    const detail =
      b.workLabel && b.workLabel.value ? String(b.workLabel.value) : "";
    const person =
      b.personLabel && b.personLabel.value ? String(b.personLabel.value) : "";
    const key = `${kind}|${name}|${year}|${detail}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        kind,
        name,
        year,
        detail,
        group: cleanAwardLabel(b.groupLabel && b.groupLabel.value),
        people: [],
      };
      byKey.set(key, entry);
    }
    if (person && !entry.people.includes(person)) entry.people.push(person);
  }

  const byGroup = new Map();
  for (const entry of byKey.values()) {
    const gname = entry.group || "Otros";
    let group = byGroup.get(gname);
    if (!group) {
      group = { group: gname, entries: [] };
      byGroup.set(gname, group);
    }
    group.entries.push(entry);
  }

  const latestYear = (group) =>
    group.entries.reduce(
      (max, e) => Math.max(max, Number(e.year) || 0),
      0
    );
  const groups = [...byGroup.values()].sort(
    (a, b) =>
      latestYear(b) - latestYear(a) ||
      (a.group < b.group ? -1 : a.group > b.group ? 1 : 0)
  );
  for (const group of groups) {
    group.entries.sort(
      (a, b) =>
        (Number(b.year) || 0) - (Number(a.year) || 0) ||
        (a.kind === b.kind ? 0 : a.kind === "award" ? -1 : 1) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
  }
  return groups;
}

/**
 * Premios y nominaciones de una película o serie desde Wikidata
 * (issue #302, iteración): la API pública de TMDB no expone
 * premios, solo su web; Wikidata los publica como declaraciones
 * P166 («award received») y P1411 («nominated for») del ítem del
 * título. No es crítico: cualquier fallo (red, sin ítem en
 * Wikidata, sin premios) devuelve null y la sección no se pinta.
 * @param {'movie'|'tv'} type - Tipo de contenido
 * @param {string|number} externalId - ID externo de TMDB
 * @returns {Promise<Array<{group: string, entries: Array<{kind: 'award'|'nom', name: string, year?: string, detail?: string, people: string[]}>}>|null>}
 */
export async function getItemAwards(type, externalId) {
  if (type !== "movie" && type !== "tv") return null;
  const id = String(externalId);
  const cacheKey = `awards_${type}_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let awards = null;
  let data = null;
  try {
    const ext = await fetchJson(
      `${BASE_URL}/${type}/${id}/external_ids?api_key=${TMDB_API_KEY}`,
      { retries: 1 }
    ).catch(() => null);
    // Defensa en profundidad (QA seguridad #302): los identificadores
    // se interpolan en la query SPARQL, así que se valida el formato
    // esperado antes de construirla (las fuentes son TMDB, pero un
    // formato inesperado no debe llegar a Wikidata).
    let query = null;
    if (ext && /^Q\d+$/.test(ext.wikidata_id || "")) {
      query = wikidataAwardsQuery(ext.wikidata_id);
    } else if (type === "tv" && /^\d+$/.test(id)) {
      // Sin wikidata_id (raro): la serie se busca por su id de TMDB.
      query = wikidataAwardsByExternalIdQuery("tv", id);
    } else if (ext && /^tt\d+$/.test(ext.imdb_id || "")) {
      // Sin wikidata_id: la película se busca por su id de IMDb.
      query = wikidataAwardsByExternalIdQuery("movie", ext.imdb_id);
    }
    if (query) {
      const url = `${WDQS_URL}?format=json&query=${encodeURIComponent(query)}`;
      // Accept explícito: Wikidata sirve HTML (su web) si no se pide
      // JSON, incluso con format=json en la URL.
      data = await fetchJson(url, { retries: 1, headers: { Accept: "application/json" } }).catch(() => null);
      const rows = data && data.results ? data.results.bindings : null;
      if (rows) {
        const realRows = rows.filter((b) => !isListPointerRow(b));
        if (realRows.length) {
          // Caso normal: el título tiene declaraciones P166/P1411
          // propias (premios reales y/o nominaciones).
          awards = mapAwardsBindings(realRows);
        } else {
          // Punteros a artículos de lista (issue #311): el título NO
          // tiene declaraciones de premios propias — p. ej. Stranger
          // Things solo tiene P166 → «List of awards and nominations
          // received by Stranger Things» (P31 = Q13406463). Algunos
          // ítems de lista guardan las declaraciones P166/P1411 en sí
          // mismos; se desreferencian (un nivel) y se mapean como si
          // fueran del título. Si el ítem de lista tampoco tiene
          // declaraciones (el caso habitual hoy), el resultado es []
          // y la sección no se pinta (degradación elegante; el
          // puntero jamás se muestra como premio).
          const fetched = new Set();
          const listRows = [];
          for (const b of rows) {
            const qid =
              b.award && b.award.value ? b.award.value.split("/").pop() : "";
            if (!/^Q\d+$/.test(qid) || fetched.has(qid)) continue;
            fetched.add(qid);
            const listUrl = `${WDQS_URL}?format=json&query=${encodeURIComponent(wikidataAwardsQuery(qid))}`;
            const listData = await fetchJson(listUrl, { retries: 1, headers: { Accept: "application/json" } }).catch(() => null);
            const subRows = listData && listData.results ? listData.results.bindings : [];
            listRows.push(...subRows);
          }
          awards = mapAwardsBindings(listRows);
        }
      }
    }
  } catch {
    awards = null;
  }
  // Solo se cachea un resultado REAL de la consulta (issue #311):
  // un fallo transitorio de Wikidata (504, red) NO debe dejar la
  // sección «sin premios» durante 24 h — se reintenta en la
  // siguiente apertura. `awards` es [] cuando la consulta respondió
  // sin filas (cobertura real) y eso sí se cachea.
  if (data) setCache(cacheKey, awards);
  return awards;
}

// =============================================================
// Recomendaciones desde TMDB con el endpoint /recommendations
// (issue #319): es el que alimenta la sección de recomendaciones
// de la propia web de TMDB. NO se usa /similar, que según la
// documentación oficial es "similar movies based on keywords and
// genres" y "not the same as the Recommendation system you see on
// the website" (daba recomendaciones poco relevantes). Los
// resultados tienen la misma forma que los de búsqueda
// (externalId, title, year, coverUrl, overview).
// =============================================================

export async function getRecommendedMovies(id) {
  const url = `${BASE_URL}/movie/${id}/recommendations?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results) return [];
  return data.results.map(mapMovieResult);
}

export async function getRecommendedTv(id) {
  const url = `${BASE_URL}/tv/${id}/recommendations?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
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
