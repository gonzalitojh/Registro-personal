// =============================================================
// Migración de almacenamiento mínimo (issue #200, A2): poda de
// campos de ficha que ya no se persisten (ON_DEMAND_DETAIL_FIELDS).
//
// Los ítems añadidos tras el despliegue de esta feature ya solo
// guardan los campos mínimos (tarjeta + avisos); los documentos
// antiguos conservan los datos históricos de la curación diaria
// (sinopsis, reparto, tráiler, plataformas...). Esta migración los
// elimina una sola vez por usuario: reduce el tamaño de los
// documentos (Firestore factura por byte) sin perder nada visible,
// porque la ficha vuelve a pedir esos campos a la API bajo demanda
// (js/item-details.js + caché de 24 h).
//
// Best-effort y fail-open: un error de red/permisos aborta la
// migración sin bloquear el arranque de la app y se reintenta en la
// próxima sesión (no se estampa el marcador). Los libros conservan
// `description` (excepción documentada en constants.js: la tarjeta y
// la ficha de libro la pintan al instante).
// =============================================================

import { ON_DEMAND_DETAIL_FIELDS } from "./constants.js";
import { deleteField } from "./firebase.js";

// Versión de la migración: al cambiarla (o al añadir campos a la
// lista), los usuarios se vuelven a podar una vez.
const MIGRATION_VERSION = "200-a2";

// Concurrencia de las escrituras de poda.
const PODA_CONCURRENCY = 4;

// Pool simple de promesas (mismo patrón que mapConcurrent de
// daily-check.js, sin depender de él).
async function mapConcurrent(items, limit, fn) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/**
 * Poda los campos de ficha bajo demanda de todos los grupos del
 * usuario. Idempotente: deleteField sobre un campo inexistente es
 * un no-op, así que una interrupción a medias no rompe nada.
 *
 * @param {string} uid - UID del usuario de Firebase Auth
 * @param {object} ctx - Contexto de app (getItemsOnce, updateItem,
 *   getUserProfile, upsertUserProfile)
 * @returns {Promise<boolean>} - true si la migración terminó y se
 *   estampó el marcador; false si falló (reintento en la próxima
 *   sesión).
 */
export async function runStorageMigration(uid, ctx) {
  let profile = null;
  try {
    profile = await ctx.getUserProfile(uid);
  } catch (err) {
    return false;
  }
  if (profile && profile.storageMigration === MIGRATION_VERSION) {
    return true;
  }

  const types = ["movie", "tv", "book", "game"];
  for (const type of types) {
    let items;
    try {
      items = await ctx.getItemsOnce(uid, type);
    } catch (err) {
      console.error("Migración de almacenamiento: no se pudo leer", type, err);
      return false;
    }
    try {
      await mapConcurrent(items, PODA_CONCURRENCY, async (item) => {
        const update = {};
        for (const field of ON_DEMAND_DETAIL_FIELDS) {
          // Excepción de libros: description se conserva (constants.js).
          if (type === "book" && field === "description") continue;
          if (field in item) update[field] = deleteField();
        }
        if (Object.keys(update).length) {
          await ctx.updateItem(uid, type, item.id, update);
        }
      });
    } catch (err) {
      console.error("Migración de almacenamiento: no se pudo podar", type, err);
      return false;
    }
  }

  try {
    await ctx.upsertUserProfile(uid, { storageMigration: MIGRATION_VERSION });
  } catch (err) {
    console.error("Migración de almacenamiento: no se pudo estampar el marcador:", err);
    return false;
  }
  return true;
}