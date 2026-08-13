// =============================================================
// Comprobación diaria: estrenos y refresco de metadatos. Extraída
// de app.js para aislar la lógica de revisión periódica.
// Una vez al día se piden datos frescos a TMDB / Open Library para
// TODOS los ítems no manuales (películas, series y libros, incluidos
// los abandonados) y se sobrescriben los metadatos con política
// "truthy-only": un campo se actualiza solo si el valor fresco es
// no vacío (overview/arrays no vacíos, communityRating != null, ...);
// si la API devuelve vacío/null se conserva lo guardado. Excepción:
// nextEpisodeToAir se sobrescribe siempre (comportamiento histórico).
// En videojuegos no hay refresco de metadatos (la pasada no consulta
// IGDB): solo se avisa del lanzamiento con los datos guardados.
// También soporta sincronización manual forzada (syncNow) con
// cooldown de 30 minutos persistido en profile.lastManualSyncAt.
// =============================================================

import { isNextEpisodeUnreleased, getNextEpisodeAirInfo } from "./sorting.js";
import { getNotificationPrefs } from "./settings.js";
import { isUnreleasedDate } from "./release.js";
import { normalizeEntry } from "./tv-progress.js";
import { subtractDays } from "./dates.js";

// Cooldown entre sincronizaciones manuales (30 minutos).
const MANUAL_SYNC_COOLDOWN_MS = 30 * 60 * 1000;
// Límite de peticiones simultáneas a la API durante una pasada.
const REFRESH_CONCURRENCY = 4;
// Si se encadenan más de este número de fallos consecutivos por ítem,
// se aborta la pasada (la API debe estar caída o el plan de datos raro).
const MAX_CONSECUTIVE_FAILURES = 5;

// Flag anti-concurrencia: lo gestiona checkForUpdates para cubrir tanto
// la pasada diaria automática como la manual (syncNow). Evita que dos
// pasadas corran a la vez (coste de API duplicado y notificaciones
// duplicadas de estreno/episodio nuevo).
let isRefreshing = false;

// ¿La serie tiene algún episodio marcado como visto (cualquier temporada)?
// Recorre watched (temporada -> episodio -> { date, rating }) y también
// tolera el formato antiguo de fecha como texto plano vía normalizeEntry.
function hasAnyWatchedEpisode(show) {
  if (!show.watched) return false;
  for (const seasonMap of Object.values(show.watched)) {
    if (!seasonMap) continue;
    for (const entry of Object.values(seasonMap)) {
      const n = normalizeEntry(entry);
      if (n && n.date) return true;
    }
  }
  return false;
}

// Días sin actividad (visualización o estreno) tras los cuales una serie
// en curso pasa automáticamente a standby (issue #48).
const AUTO_STANDBY_DAYS = 365;

// ¿Debe la serie pasar automáticamente a standby?
// - Solo status "en_curso".
// - Regla 1: si el próximo episodio está sin estrenar (fecha futura o sin
//   fecha), la serie está "esperando nuevos episodios": NO se mueve.
// - Regla 2: si la fecha más actual entre el último estreno (airDate del
//   próximo episodio ya emitido) y la última visualización (lastWatchedAt)
//   está dentro del último año, hay actividad: NO se mueve.
// - Si no hay ninguna fecha conocida, no se mueve (conservador).
// - Comparaciones de strings "YYYY-MM-DD" (formato canónico del proyecto).
export function shouldAutoStandby(show, today) {
  if (!show || show.status !== "en_curso") return false;
  if (isNextEpisodeUnreleased(show)) return false;
  const info = getNextEpisodeAirInfo(show);
  const lastAirDate = info && info.airDate ? info.airDate : null;
  const lastWatched = show.lastWatchedAt || null;
  if (!lastAirDate && !lastWatched) return false;
  let activity = lastAirDate;
  if (!activity || (lastWatched && lastWatched > activity)) activity = lastWatched;
  const threshold = subtractDays(today, AUTO_STANDBY_DAYS);
  return activity <= threshold;
}

// Ejecuta fn sobre cada ítem con un pool de `limit` promesas
// simultáneas. Devuelve los resultados en orden.
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Política truthy-only para películas: cada campo se sobrescribe solo
// si el valor fresco es no vacío; si la API devuelve vacío/null se
// conserva lo guardado. No toca title, year, externalId, manual,
// status, watchLog, notas, addedAt/updatedAt ni flags de notificación.
function buildMovieUpdates(movie, fresh) {
  const updates = {};
  if (fresh.runtime) updates.runtime = fresh.runtime;
  if (fresh.overview) updates.overview = fresh.overview;
  if (fresh.genres && fresh.genres.length) updates.genres = fresh.genres;
  if (fresh.cast && fresh.cast.length) updates.cast = fresh.cast;
  if (fresh.director) updates.director = fresh.director;
  if (fresh.releaseDate && fresh.releaseDate !== movie.releaseDate) {
    updates.releaseDate = fresh.releaseDate;
  }
  if (fresh.communityRating != null) updates.communityRating = fresh.communityRating;
  if (fresh.trailerUrl) updates.trailerUrl = fresh.trailerUrl;
  if (fresh.collectionId) updates.collectionId = fresh.collectionId;
  if (fresh.collectionName) updates.collectionName = fresh.collectionName;
  if (fresh.collectionPoster) updates.collectionPoster = fresh.collectionPoster;
  if (fresh.coverUrl) updates.coverUrl = fresh.coverUrl;
  return updates;
}

// Política truthy-only para series (misma semántica que películas).
// nextEpisodeToAir se sobrescribe siempre que la API lo devuelva.
function buildTvUpdates(show, fresh) {
  const updates = {};
  if (fresh.episodeRuntime) updates.episodeRuntime = fresh.episodeRuntime;
  if (fresh.overview) updates.overview = fresh.overview;
  if (fresh.genres && fresh.genres.length) updates.genres = fresh.genres;
  if (fresh.cast && fresh.cast.length) updates.cast = fresh.cast;
  if (fresh.creators && fresh.creators.length) updates.creators = fresh.creators;
  if (fresh.firstAirDate && fresh.firstAirDate !== show.firstAirDate) {
    updates.firstAirDate = fresh.firstAirDate;
  }
  if (fresh.nextEpisodeToAir) {
    updates.nextEpisodeToAir = fresh.nextEpisodeToAir;
    // Copia local de la fecha del próximo episodio: sobrevive aunque
    // TMDB deje de devolver next_episode_to_air (serie entre
    // temporadas sin fecha anunciada) y permite seguir avisando del
    // "no estrenado" sin consultar la temporada.
    updates.nextEpisodeAirDate = {
      season: fresh.nextEpisodeToAir.season,
      episode: fresh.nextEpisodeToAir.episode,
      airDate: fresh.nextEpisodeToAir.airDate || null,
    };
  }
  if (fresh.communityRating != null) updates.communityRating = fresh.communityRating;
  if (fresh.trailerUrl) updates.trailerUrl = fresh.trailerUrl;
  if (fresh.tmdbStatus) updates.tmdbStatus = fresh.tmdbStatus;
  if (fresh.coverUrl) updates.coverUrl = fresh.coverUrl;
  // Excepción documentada a la política truthy-only: seasonAirDates se
  // sobrescribe siempre que la llamada tenga éxito (el array de
  // temporadas es completo entonces), porque un null dentro del mapa es
  // información real (temporada sin fecha de estreno oficial), no un
  // dato ausente que haya que conservar.
  if (fresh.seasonAirDates && Object.keys(fresh.seasonAirDates).length) {
    updates.seasonAirDates = fresh.seasonAirDates;
  }
  return updates;
}

// Política truthy-only para libros: la sinopsis se sobrescribe solo si
// la nueva es no vacía (la API de Open Library a veces no la devuelve).
function buildBookUpdates(book, description) {
  if (!description) return {};
  return { description };
}

// Rellena nextEpisodeAirDate cuando ni nextEpisodeToAir ni el dato
// guardado coinciden con el siguiente episodio del usuario (p. ej.
// serie entre temporadas sin fecha anunciada). Fail-open: si la
// consulta de la temporada falla, no se aborta la pasada.
async function ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes) {
  if (show.manual || !show.nextEpisode) return null;
  if (
    getNextEpisodeAirInfo({
      ...show,
      nextEpisodeToAir: fresh.nextEpisodeToAir,
      seasonAirDates: fresh.seasonAirDates,
    })
  ) {
    return null;
  }
  try {
    const episodes = await getSeasonEpisodes(show.externalId, show.nextEpisode.season);
    const ep = episodes.find((e) => e.episodeNumber === show.nextEpisode.episode);
    return {
      season: show.nextEpisode.season,
      episode: show.nextEpisode.episode,
      airDate: ep ? ep.airDate : null,
    };
  } catch (err) {
    console.error("No se pudo verificar el estreno del siguiente episodio:", show.title, err);
    return null;
  }
}

/**
 * Revisa todos los ítems no manuales y refresca sus metadatos desde
 * TMDB / Open Library, además de la lógica histórica de avisos
 * (estrenos, episodios nuevos, liberación de episodios bloqueados).
 *
 * Gestión de concurrencia: el flag isRefreshing se setea al entrar en
 * la pasada real (de forma síncrona, sin awaits entre el chequeo y el
 * seteo) y se limpia en finally. Si ya hay una pasada en curso (diaria
 * o manual), esta llamada sale con { aborted: true } sin marcar
 * lastReleaseCheckAt.
 *
 * Guard diario: si ya se hizo hoy (profile.lastReleaseCheckAt === today)
 * y no es un refresco forzado (force), se sale sin hacer nada.
 *
 * @param {object} ctx              - Contexto con dependencias inyectadas
 * @param {object} [options]
 * @param {boolean} [options.force] - true para ignorar el guard diario
 *                                     (sincronización manual)
 * @returns {Promise<{aborted: boolean}>} - Estado de la pasada; aborted
 *   true si se abortó por fallos consecutivos o por reentrancia.
 */
export async function checkForUpdates(ctx, { force = false } = {}) {
  const {
    getCurrentUser,
    getItemsOnce,
    updateItem,
    addNotification,
    upsertUserProfile,
    getUserProfile,
    getMovieDetails,
    getTvExtraDetails,
    getSeasonEpisodes,
    getOpenLibraryDescription,
    todayISO,
    formatDateEs,
  } = ctx;

  const user = getCurrentUser();
  if (!user) return { aborted: true };

  // Anti-concurrencia: el chequeo y el seteo son síncronos y contiguos,
  // así que dos llamadas nunca atraviesan el guard a la vez.
  if (isRefreshing) return { aborted: true };
  isRefreshing = true;
  try {
    let profile;
    try {
      profile = await getUserProfile(user.uid);
    } catch (err) {
      profile = null;
    }
    const today = todayISO();
    if (!force && profile && profile.lastReleaseCheckAt === today) {
      return { aborted: false };
    }

    // Lectura puntual de cada grupo (issue #178): las pestañas ya no
    // se suscriben todas al entrar (lazy loading), así que el estado
    // en memoria puede no estar completo. Se lee de Firestore bajo
    // demanda. Los videojuegos no refrescan metadatos en la pasada
    // (IGDB no se consulta), pero participan en el aviso de lanzamiento
    // (issue #175), así que también se leen de Firestore.
    const [allMovies, allTv, allBooks, allGames] = await Promise.all([
      getItemsOnce(user.uid, "movie"),
      getItemsOnce(user.uid, "tv"),
      getItemsOnce(user.uid, "book"),
      getItemsOnce(user.uid, "game"),
    ]);
    const prefs = getNotificationPrefs();

    // Fallos consecutivos: si se encadenan demasiados (p.ej. API caída),
    // se aborta la pasada para no seguir haciendo peticiones inútiles.
    let consecutiveFailures = 0;
    let aborted = false;

    // Películas: aviso de estreno + refresco de metadatos (todos los ítems
    // no manuales, aunque estén completos).
    const movies = allMovies.filter((m) => !m.manual && m.externalId);
    await mapConcurrent(movies, REFRESH_CONCURRENCY, async (movie) => {
      if (aborted) return;
      try {
        const fresh = await getMovieDetails(movie.externalId);
        const updates = buildMovieUpdates(movie, fresh);

        if (!movie.awaitingRelease && fresh.releaseDate !== undefined && !(movie.watchLog && movie.watchLog.length) && isUnreleasedDate(fresh.releaseDate)) {
          updates.awaitingRelease = true;
        }

        if (prefs.movie_release !== false && movie.awaitingRelease && fresh.releaseDate && fresh.releaseDate <= today) {
          await addNotification(user.uid, {
            message: `«${movie.title}» ya se ha estrenado (${formatDateEs(fresh.releaseDate)}).`,
          });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "movie", movie.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo comprobar/actualizar", movie.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // Series: aviso de estreno / episodio nuevo + refresco de metadatos.
    // Se revisan TODAS las no manuales, incluidas las abandonadas.
    const shows = allTv.filter((s) => !s.manual && s.externalId);
    await mapConcurrent(shows, REFRESH_CONCURRENCY, async (show) => {
      if (aborted) return;
      try {
        const wasEpisodeBlocked = isNextEpisodeUnreleased(show);
        const fresh = await getTvExtraDetails(show.externalId);
        const updates = buildTvUpdates(show, fresh);

        // Backfill de nextEpisodeAirDate: si ni next_episode_to_air ni
        // el dato guardado coinciden con el siguiente episodio (serie
        // entre temporadas), se consulta la temporada para conocer su
        // fecha (o su ausencia) y poder seguir avisando de "no
        // estrenado". Fail-open: nunca aborta la pasada ni incrementa
        // consecutiveFailures.
        const airInfo = await ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes);
        if (airInfo) updates.nextEpisodeAirDate = airInfo;

        let justPremiered = false;

        if (prefs.series_premiere !== false && show.awaitingRelease && fresh.firstAirDate && fresh.firstAirDate <= today) {
          await addNotification(user.uid, { message: `«${show.title}» ya se ha estrenado.` });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
          justPremiered = true;
        }

        if (
          prefs.new_episode !== false &&
          !justPremiered &&
          fresh.nextEpisodeToAir &&
          fresh.nextEpisodeToAir.airDate &&
          fresh.nextEpisodeToAir.airDate <= today
        ) {
          const key = `${fresh.nextEpisodeToAir.season}x${fresh.nextEpisodeToAir.episode}`;
          if (show.lastNotifiedEpisode !== key) {
            await addNotification(user.uid, {
              message: `Nuevo episodio disponible de «${show.title}»: T${fresh.nextEpisodeToAir.season}E${fresh.nextEpisodeToAir.episode}.`,
            });
            updates.lastNotifiedEpisode = key;
          }
        }

        if (
          !justPremiered &&
          wasEpisodeBlocked &&
          !isNextEpisodeUnreleased({
            ...show,
            nextEpisodeToAir: fresh.nextEpisodeToAir,
            seasonAirDates: fresh.seasonAirDates,
          })
        ) {
          updates.releasedNoticedAt = today;
        }

        if (!show.awaitingRelease && fresh.firstAirDate !== undefined && !hasAnyWatchedEpisode(show) && isUnreleasedDate(fresh.firstAirDate)) {
          updates.awaitingRelease = true;
        }

        // Auto-standby por inactividad (issue #48): evaluado con los datos
        // frescos de esta pasada (incluido el backfill recién calculado).
        const evaluatedShow = {
          ...show,
          nextEpisodeToAir: fresh.nextEpisodeToAir,
          seasonAirDates: fresh.seasonAirDates,
          ...(airInfo ? { nextEpisodeAirDate: airInfo } : {}),
        };
        if (shouldAutoStandby(evaluatedShow, today)) {
          updates.status = "standby";
          updates.autoStandbyAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "tv", show.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo comprobar/actualizar", show.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // Series manuales en curso: mismo auto-standby, evaluado solo con datos
    // guardados (no hay datos TMDB). Sin red. Fail-open: un error de
    // escritura no aborta la pasada ni cuenta como fallo de API.
    const manualShows = allTv.filter((s) => s.manual && s.status === "en_curso");
    for (const show of manualShows) {
      if (aborted) break;
      try {
        if (shouldAutoStandby(show, today)) {
          await updateItem(user.uid, "tv", show.id, { status: "standby", autoStandbyAt: today });
        }
      } catch (err) {
        console.error("No se pudo pausar automáticamente", show.title, err);
      }
    }

    // Libros: refresco de sinopsis (solo si la nueva es no vacía).
    const books = allBooks.filter((b) => !b.manual && b.externalId && b.externalId.startsWith("/works/"));
    await mapConcurrent(books, REFRESH_CONCURRENCY, async (book) => {
      if (aborted) return;
      try {
        const description = await getOpenLibraryDescription(book.externalId);
        const updates = buildBookUpdates(book, description);
        if (Object.keys(updates).length) {
          await updateItem(user.uid, "book", book.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo completar la sinopsis de", book.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // Videojuegos: aviso de lanzamiento con los datos guardados (sin
    // red, IGDB no se consulta en la pasada). Se revisan todos los no
    // manuales. Fail-open: un error de escritura no aborta la pasada ni
    // cuenta como fallo de API (mismo patrón que el bloque de series
    // manuales).
    const games = allGames.filter((g) => !g.manual);
    for (const g of games) {
      if (aborted) break;
      try {
        const updates = {};

        // Backfill del flag para juegos guardados antes de la issue
        // #175 (sin awaitingRelease). La guarda releaseDate truthy es
        // OBLIGATORIA: sin fecha no hay lanzamiento que esperar.
        if (!g.awaitingRelease && g.releaseDate && isUnreleasedDate(g.releaseDate) && !(g.playLog && g.playLog.length)) {
          updates.awaitingRelease = true;
        }

        // Aviso de lanzamiento. La guarda del playLog es necesaria:
        // quick-actions.js y modal-handlers.js no limpian awaitingRelease
        // al marcar como jugado.
        if (prefs.game_release !== false && g.awaitingRelease && g.releaseDate && g.releaseDate <= today && !(g.playLog && g.playLog.length)) {
          await addNotification(user.uid, {
            message: `«${g.title}» ya está a la venta (${formatDateEs(g.releaseDate)}).`,
          });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "game", g.id, updates);
        }
      } catch (err) {
        console.error("No se pudo comprobar el lanzamiento de", g.title, err);
      }
    }

    try {
      await upsertUserProfile(user.uid, { lastReleaseCheckAt: today });
    } catch (err) {
      console.error(err);
    }
    return { aborted: false };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Sincronización manual forzada ("Sincronizar ahora" en Ajustes).
 * Aplica el cooldown de MANUAL_SYNC_COOLDOWN_MS persistido en
 * profile.lastManualSyncAt. El flag anti-concurrencia isRefreshing
 * lo gestiona checkForUpdates (cubre también la pasada diaria), así
 * que aquí solo se comprueba y se confía en su retorno de estado.
 *
 * Si la pasada se aborta (fallos consecutivos o reentrancia) NO se
 * estampa lastManualSyncAt: el cooldown no se quema y el usuario
 * puede reintentar.
 *
 * @param {object} ctx - Contexto con dependencias inyectadas
 * @returns {Promise<{ok: boolean, reason?: string, message?: string}>}
 */
export async function syncNow(ctx) {
  if (isRefreshing) return { ok: false, reason: "running" };

  const user = ctx.getCurrentUser();
  if (!user) return { ok: false, reason: "error", message: "Sesión no iniciada." };

  // El perfil se lee ANTES de forzar la pasada para respetar el cooldown.
  let profile = null;
  try {
    profile = await ctx.getUserProfile(user.uid);
  } catch (err) {
    profile = null;
  }
  if (profile && profile.lastManualSyncAt) {
    const elapsed = Date.now() - new Date(profile.lastManualSyncAt).getTime();
    if (elapsed < MANUAL_SYNC_COOLDOWN_MS) {
      return { ok: false, reason: "cooldown" };
    }
  }

  // Segundo chequeo: la pasada diaria pudo arrancar mientras se leía
  // el perfil. Entre este chequeo y el seteo interno de checkForUpdates
  // no hay awaits, así que no hay ventana de carrera.
  if (isRefreshing) return { ok: false, reason: "running" };

  try {
    const result = await checkForUpdates(ctx, { force: true });
    if (!result || result.aborted) {
      return {
        ok: false,
        reason: "error",
        message: "La sincronización se abortó. Revisa tu conexión e inténtalo de nuevo.",
      };
    }
    await ctx.upsertUserProfile(user.uid, { lastManualSyncAt: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    console.error("No se pudo sincronizar los datos:", err);
    return { ok: false, reason: "error", message: err.message || String(err) };
  }
}

/**
 * Indica si hay una sincronización en curso (diaria o manual). La usa
 * settings.js para deshabilitar el botón "Sincronizar ahora".
 */
export function isSyncRunning() {
  return isRefreshing;
}
