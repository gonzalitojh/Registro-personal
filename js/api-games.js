// =============================================================
// Búsqueda de videojuegos y datos ampliados (géneros, plataformas,
// desarrolladores, Metacritic, ESRB, duración media...) en RAWG.
// API REST gratuita para uso personal, con atribución (ver footer
// de index.html y el crédito en ocio/videojuegos.html).
// Documentación: https://rawg.io/apidocs — la clave se consigue
// gratis en https://rawg.io/apidocs y se deja en js/config.js.
// =============================================================

import { RAWG_API_KEY } from "./config.js";
import { fetchJson } from "./http.js";

const BASE_URL = "https://api.rawg.io/api";
const PAGE_SIZE = 20;

// La clave no es secreta (igual que TMDB/Google Books), pero si está
// vacía la búsqueda no puede funcionar: se avisa con un error claro.
function requireKey() {
  if (!RAWG_API_KEY) {
    throw new Error("Falta la clave de RAWG en js/config.js (gratis en rawg.io/apidocs).");
  }
}

// Normaliza un resultado de la lista de búsqueda al formato común
// del catálogo ({ externalId, type, title, year, coverUrl, ... }).
function mapGameResult(r) {
  return {
    externalId: String(r.id),
    type: "game",
    title: r.name,
    year: (r.released || "").slice(0, 4),
    coverUrl: r.background_image || null,
    overview: r.description_raw || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || [])
      .map((p) => p.platform && p.platform.name)
      .filter(Boolean),
    metacritic: r.metacritic || null,
    communityRating: r.rating > 0 ? r.rating : null,
    esrbName: (r.esrb_rating && r.esrb_rating.name) || null,
  };
}

// Búsqueda paginada en el catálogo de RAWG.
export async function searchGames(searchTerm, page = 1) {
  requireKey();
  const url = `${BASE_URL}/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(
    searchTerm
  )}&page=${page}&page_size=${PAGE_SIZE}`;
  const data = await fetchJson(url, { retries: 1 }).catch((err) => {
    // HTTP 401/403 = clave inválida o rechazada; cualquier otro fallo
    // (red, 5xx...) es temporal y conviene distinguirlo del error de clave.
    if (/^HTTP (401|403)/.test(err && err.message)) {
      throw new Error("RAWG rechazó la petición. Revisa tu clave de API en js/config.js.");
    }
    throw new Error("No se pudo conectar con RAWG. Inténtalo de nuevo.");
  });
  return {
    items: (data.results || []).map(mapGameResult),
    hasMore: Boolean(data.next),
  };
}

// Datos ampliados de un juego: sinopsis completa, géneros,
// plataformas, desarrolladores, editores, Metacritic, duración
// media, ESRB y nota de la comunidad. Se piden una sola vez, al
// añadirlo (y para enriquecer la vista previa del catálogo).
export async function getGameDetails(id) {
  requireKey();
  const url = `${BASE_URL}/games/${id}?key=${RAWG_API_KEY}`;
  const r = await fetchJson(url, { retries: 1 });
  return {
    description: r.description_raw || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || [])
      .map((p) => p.platform && p.platform.name)
      .filter(Boolean),
    developers: (r.developers || []).map((d) => d.name),
    publishers: (r.publishers || []).map((p) => p.name),
    metacritic: r.metacritic || null,
    playtime: r.playtime || null,
    esrbName: (r.esrb_rating && r.esrb_rating.name) || null,
    communityRating: r.rating > 0 ? r.rating : null,
    coverUrl: r.background_image || null,
    year: (r.released || "").slice(0, 4),
  };
}
