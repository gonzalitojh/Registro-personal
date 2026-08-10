// =============================================================
// Búsqueda de videojuegos y datos ampliados (géneros, plataformas,
// desarrolladores, editores, clasificación ESRB, nota de la
// comunidad...) en IGDB (Twitch), a través de un Cloudflare Worker
// que actúa de proxy (IGDB no tiene CORS y su Client Secret no
// puede exponerse en una SPA). Ver cloudflare/igdb-proxy/README.md.
// Documentación de IGDB: https://api-docs.igdb.com/
// =============================================================

import { IGDB_PROXY_URL } from "./config.js";

const PROXY_BASE = (IGDB_PROXY_URL || "").replace(/\/+$/, "");

// El proxy no es un secreto (es la URL pública del Worker), pero si
// está vacío la búsqueda no puede funcionar: se avisa con un error
// claro indicando dónde configurarlo.
function requireProxy() {
  if (!PROXY_BASE) {
    throw new Error(
      "Falta IGDB_PROXY_URL en js/config.js (ver cloudflare/igdb-proxy/README.md)."
    );
  }
}

// Petición POST al proxy, que la reenvía a api.igdb.com/v4 con las
// cabeceras Client-ID y Authorization ya puestas. Normaliza los
// errores de transporte (red caída, proxy inalcanzable, CORS
// bloqueado) y de parseo a un mensaje en español claro, igual que
// hacen el resto de clientes de API (fetchJson), y reintenta una vez
// los fallos de transporte (los fallos del proxy suelen ser
// transitorios; el límite de IGDB es 4 req/s, un reintento es seguro).
async function igdbPost(endpoint, body) {
  requireProxy();
  const doFetch = () =>
    fetch(`${PROXY_BASE}/v4/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
  let res;
  try {
    res = await doFetch();
  } catch {
    try {
      res = await doFetch(); // un solo reintento ante fallos transitorios
    } catch {
      // Red caída, proxy inalcanzable o CORS bloqueado: no hay
      // respuesta HTTP que inspeccionar.
      throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
    }
  }
  if (!res.ok) {
    // HTTP 401/403 = credenciales de Twitch inválidas o token
    // caducado; 403 puede ser también "origen no permitido" del
    // proxy. Cualquier otro fallo (5xx...) es temporal y conviene
    // distinguirlo del error de credenciales.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "IGDB rechazó la petición. Revisa las credenciales del proxy (cloudflare/igdb-proxy/README.md)."
      );
    }
    throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
  }
  try {
    return await res.json();
  } catch {
    // Cuerpo no JSON (p. ej. página de error HTML del host).
    throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
  }
}

const SEARCH_FIELDS = [
  "name",
  "first_release_date",
  "cover.image_id",
  "summary",
  "total_rating",
  "aggregated_rating",
  "genres.name",
  "platforms.name",
].join(", ");

const DETAIL_FIELDS = [
  "name",
  "first_release_date",
  "cover.image_id",
  "summary",
  "total_rating",
  "aggregated_rating",
  "genres.name",
  "platforms.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "age_ratings.rating",
  "age_ratings.category",
].join(", ");

// Campos del endpoint game_videos de IGDB (tráiler de YouTube).
const GAME_VIDEO_FIELDS = ["video_id", "name"].join(", ");

// Clasificaciones por edades de IGDB: category 1 = ESRB.
const ESRB_RATINGS = {
  1: "RP", 2: "EC", 3: "E", 4: "E10+", 5: "T", 6: "M", 7: "AO",
};

// IGDB puntúa 0–100; la app muestra la nota de la comunidad en la
// misma escala 0–10 que TMDB (ver manual de usuario §10).
function toCommunityRating(r) {
  const value = r.total_rating ?? r.aggregated_rating;
  if (value == null || value <= 0) return null;
  return Math.round((value / 10) * 10) / 10;
}

function yearFromTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

function coverUrl(imageId) {
  return imageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
    : null;
}

function esrbName(r) {
  const esrb = (r.age_ratings || []).find((a) => a.category === 1);
  return esrb && ESRB_RATINGS[esrb.rating] ? ESRB_RATINGS[esrb.rating] : null;
}

function mapGameResult(r) {
  return {
    externalId: String(r.id),
    type: "game",
    title: r.name,
    year: yearFromTimestamp(r.first_release_date),
    coverUrl: coverUrl(r.cover && r.cover.image_id),
    overview: r.summary || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || []).map((p) => p.name),
    metacritic: null, // IGDB no tiene Metacritic
    communityRating: toCommunityRating(r),
    esrbName: esrbName(r),
  };
}

// Búsqueda paginada en el catálogo de IGDB (vía proxy).
export async function searchGames(searchTerm, page = 1) {
  const offset = (page - 1) * 20;
  const body = `search "${searchTerm.replace(/"/g, '\\"')}"; fields ${SEARCH_FIELDS}; limit 20; offset ${offset};`;
  const data = await igdbPost("games", body);
  const items = Array.isArray(data) ? data.map(mapGameResult) : [];
  // IGDB no devuelve "hay más" explícitamente: si vienen 20
  // resultados (el máximo pedido), muy probablemente hay más.
  return { items, hasMore: items.length === 20 };
}

// Extrae la URL del tráiler de YouTube a partir de la respuesta del
// endpoint game_videos de IGDB. Prioriza el vídeo con "trailer" en el
// nombre; si no, el primero con video_id no vacío. null si no hay
// ninguno (mismo patrón que _extractTrailerUrl de api-movies.js).
function extractTrailerUrl(videos) {
  if (!Array.isArray(videos) || !videos.length) return null;
  const withId = videos.filter((v) => v && v.video_id);
  if (!withId.length) return null;
  const best =
    withId.find((v) => (v.name || "").toLowerCase().includes("trailer")) ||
    withId[0];
  return `https://www.youtube.com/watch?v=${best.video_id}`;
}

// URL del tráiler del juego (o null). El tráiler es un extra no
// crítico: nunca lanza, cualquier fallo devuelve null.
async function getGameTrailerUrl(id) {
  try {
    const body = `fields ${GAME_VIDEO_FIELDS}; where game = ${Number(id)}; limit 5;`;
    const data = await igdbPost("game_videos", body);
    return extractTrailerUrl(Array.isArray(data) ? data : []);
  } catch {
    return null;
  }
}

// Datos ampliados de un juego: sinopsis completa, géneros,
// plataformas, desarrolladores, editores, clasificación ESRB,
// nota de la comunidad y tráiler. Se piden una sola vez, al
// añadirlo (y para enriquecer la vista previa del catálogo).
export async function getGameDetails(id) {
  const body = `fields ${DETAIL_FIELDS}; where id = ${Number(id)};`;
  const data = await igdbPost("games", body);
  const r = Array.isArray(data) && data.length ? data[0] : null;
  if (!r) return {};

  const companies = r.involved_companies || [];
  return {
    description: r.summary || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || []).map((p) => p.name),
    developers: companies
      .filter((c) => c.developer && c.company)
      .map((c) => c.company.name),
    publishers: companies
      .filter((c) => c.publisher && c.company)
      .map((c) => c.company.name),
    metacritic: null,
    playtime: null, // IGDB no tiene duración media jugada
    esrbName: esrbName(r),
    communityRating: toCommunityRating(r),
    coverUrl: coverUrl(r.cover && r.cover.image_id),
    year: yearFromTimestamp(r.first_release_date),
    trailerUrl: await getGameTrailerUrl(id),
  };
}
