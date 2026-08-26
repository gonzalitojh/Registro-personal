// =============================================================
// Backfill de reparto para búsqueda por actores (issue #328,
// iteración 3). Los documentos antiguos perdieron `cast`/`director`/
// `creators` con la poda de almacenamiento mínimo #200 (ON_DEMAND)
// y solo recuperaban esos campos al ABRIR la ficha (needsDetailFetch
// + loadDetailsForModal). Si el usuario nunca abre una película/serie,
// la búsqueda por actor sigue sin encontrarla aunque el lazy global
// ya resuelva las 4 colecciones (fix iteración 2).
//
// Este módulo hace el backfill en SEGUNDO PLANO tras el login, sin
// bloquear la UI: recorre movies/tv cuyo `cast` no es array (campo
// nunca guardado) y les pide los detalles a TMDB (caché 24h de
// api-movies) para persistir `cast` (10) + `director`/`creators`.
// Best-effort: un fallo de red/permisos no rompe nada y se reintenta
// en la próxima sesión. Concurrencia limitada (3) para no saturar
// TMDB ni Firestore al abrir la web con colecciones grandes.
// =============================================================

import { getMovieDetails, getTvExtraDetails } from "./api-movies.js";

const CONCURRENCY = 3;
// Límite por grupo y sesión para no disparar N peticiones en
// colecciones enormes (p.ej. 200 películas sin reparto): 40 por
// sesión cubre el caso habitual y se completa en las siguientes.
const MAX_PER_GROUP = 40;

async function mapConcurrent(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w += 1) workers.push(worker());
  await Promise.all(workers);
}

function needsBackfill(item) {
  if (!item || item.manual || !item.externalId) return false;
  if (item.type === "movie") {
    if (!Array.isArray(item.cast)) return true;
    if (typeof item.director === "undefined") return true;
    return false;
  }
  if (item.type === "tv") {
    if (!Array.isArray(item.cast)) return true;
    if (!Array.isArray(item.creators)) return true;
    return false;
  }
  return false;
}

/**
 * Backfill en segundo plano del reparto buscable. No lanza nunca:
 * cualquier fallo es best-effort y se reintentará en la próxima sesión.
 * @param {object} ctx - contexto de app (getItemsOnce, updateItem, getCurrentUser)
 */
export async function runActorBackfill(ctx) {
  let uid = null;
  try {
    uid = ctx.getCurrentUser()?.uid || null;
  } catch { uid = null; }
  if (!uid) return;
  const types = ["movie", "tv"];
  for (const type of types) {
    let items = [];
    try {
      items = await ctx.getItemsOnce(uid, type);
    } catch {
      continue;
    }
    const pending = items.filter(needsBackfill).slice(0, MAX_PER_GROUP);
    if (!pending.length) continue;
    // No bloquear el login: cada grupo se procesa con concurrencia limitada
    // y cada ítem con catch independiente (un 404 de TMDB no frena el resto).
    await mapConcurrent(pending, CONCURRENCY, async (item) => {
      try {
        const details = type === "movie"
          ? await getMovieDetails(item.externalId)
          : await getTvExtraDetails(item.externalId);
        const changes = {};
        if (details.cast && Array.isArray(details.cast) && details.cast.length) {
          // Persistir 10 nombres (mismo límite que minimalStoredFields, iteración 3)
          const nextCast = details.cast.slice(0, 10);
          if (JSON.stringify(nextCast) !== JSON.stringify(item.cast)) changes.cast = nextCast;
        } else if (Array.isArray(details.cast) && details.cast.length === 0) {
          // API responde sin reparto (vacío): persistir [] para no reintentar
          // en cada sesión (needsDetailFetch/Backfill lo tratan como presente).
          if (!Array.isArray(item.cast)) changes.cast = [];
        }
        if (type === "movie" && typeof item.director === "undefined") {
          // director puede ser null (sin dato) o string; null también evita reintentos
          if (typeof details.director !== "undefined") changes.director = details.director;
          else if (!("director" in item)) changes.director = null;
        }
        if (type === "tv" && !Array.isArray(item.creators)) {
          if (Array.isArray(details.creators)) changes.creators = details.creators.slice(0, 3);
          else changes.creators = [];
        }
        if (Object.keys(changes).length) {
          await ctx.updateItem(uid, type, item.id, changes);
          Object.assign(item, changes);
        }
      } catch {
        // best-effort: ignorar (TMDB 404, red, etc.)
      }
    });
  }
}
