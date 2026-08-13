// =============================================================
// Detalles de ficha BAJO DEMANDA (almacenamiento mínimo A2, issue
// #200). Con el nuevo modelo los documentos guardan solo la tarjeta
// + campos de avisos; la sinopsis, reparto, tráiler, saga,
// plataformas, etc. se piden a la API al abrir la ficha, con la
// caché en memoria de 24 h de api-movies.js (una ficha recién
// añadida o ya visitada no repite llamada) y con degradación
// elegante a «solo tarjeta» si la red falla.
// =============================================================

import { getMovieDetails, getTvExtraDetails } from "./api-movies.js";
import { getGameDetails } from "./api-games.js";

// ¿El ítem necesita cargar sus detalles de ficha? Los libros
// conservan la sinopsis en el documento (excepción del estudio,
// sección 8.1), así que nunca aplican. Los ítems manuales tampoco:
// su externalId es sintético y no existe en las APIs.
export function needsDetailFetch(item) {
  if (!item || item.manual || !item.externalId) return false;
  if (item.type === "movie" || item.type === "tv") return !item.overview;
  if (item.type === "game") return !item.description;
  return false;
}

// Carga los detalles de ficha del ítem (película, serie o
// videojuego) y los fusiona en el propio objeto (en memoria). Nunca
// lanza: cualquier fallo devuelve null y la ficha se queda «solo
// tarjeta». Devuelve el objeto de detalles en caso de éxito (para
// que el llamador pueda comparar con lo guardado antes de la fusión,
// p. ej. en el stale-while-revalidate de la tarjeta).
export async function loadItemDetails(item) {
  if (!needsDetailFetch(item)) return null;
  try {
    let details;
    if (item.type === "movie") {
      details = await getMovieDetails(item.externalId);
      if (!details.overview && !details.genres) return null; // API sin datos
    } else if (item.type === "tv") {
      details = await getTvExtraDetails(item.externalId);
      if (!details.overview && !details.genres) return null;
    } else {
      details = await getGameDetails(item.externalId);
      if (!details.description && !details.genres) return null;
    }
    Object.assign(item, details);
    return details;
  } catch (err) {
    console.error("No se pudieron cargar los detalles de la ficha:", item.title, err);
    return null;
  }
}