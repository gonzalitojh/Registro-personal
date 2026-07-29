// =============================================================
// Comprobación diaria: estrenos y metadatos que faltan. Extraída
// de app.js para aislar la lógica de revisión periódica.
// Una vez al día, por cada película o serie activa que tenga datos
// incompletos o esté pendiente de estreno, se piden datos frescos
// a TMDB / Open Library y se actualiza la ficha en Firestore.
// =============================================================

import { isNextEpisodeUnreleased } from "./sorting.js";
import { getNotificationPrefs } from "./settings.js";

export async function checkForUpdates(ctx) {
  const {
    getCurrentUser,
    getItemsByGroup,
    updateItem,
    addNotification,
    upsertUserProfile,
    getUserProfile,
    getMovieDetails,
    getTvExtraDetails,
    getOpenLibraryDescription,
    todayISO,
    formatDateEs,
  } = ctx;

  const user = getCurrentUser();
  if (!user) return;

  let profile;
  try {
    profile = await getUserProfile(user.uid);
  } catch (err) {
    profile = null;
  }
  const today = todayISO();
  if (profile && profile.lastReleaseCheckAt === today) return;

  const allMovies = getItemsByGroup("movies");
  const allTv = getItemsByGroup("tv");
  const allBooks = getItemsByGroup("books");
  const prefs = getNotificationPrefs();

  // Películas: aviso de estreno + rellenar ficha si le faltaba algo
  for (const movie of allMovies) {
    if (movie.manual) continue;
    const needsCheck = !movie.overview || movie.awaitingRelease || movie.communityRating == null;
    if (!needsCheck) continue;
    try {
      const fresh = await getMovieDetails(movie.externalId);
      const updates = {};
      if (!movie.overview && fresh.overview) updates.overview = fresh.overview;
      if ((!movie.genres || !movie.genres.length) && fresh.genres && fresh.genres.length) {
        updates.genres = fresh.genres;
      }
      if ((!movie.cast || !movie.cast.length) && fresh.cast && fresh.cast.length) {
        updates.cast = fresh.cast;
      }
      if (!movie.director && fresh.director) updates.director = fresh.director;
      if (!movie.runtime && fresh.runtime) updates.runtime = fresh.runtime;
      if (movie.communityRating == null && fresh.communityRating != null) {
        updates.communityRating = fresh.communityRating;
      }
      if (!movie.trailerUrl && fresh.trailerUrl) {
        updates.trailerUrl = fresh.trailerUrl;
      }
      if (fresh.releaseDate && fresh.releaseDate !== movie.releaseDate) {
        updates.releaseDate = fresh.releaseDate;
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
    } catch (err) {
      console.error("No se pudo comprobar/actualizar", movie.title, err);
    }
  }

  // Series: aviso de estreno / episodio nuevo + rellenar ficha si faltaba algo.
  const activeShows = allTv.filter((s) => !s.manual && s.status !== "abandonado");
  for (const show of activeShows) {
    try {
      const needsBackfill = !show.overview || show.awaitingRelease || show.communityRating == null;
      const wasEpisodeBlocked = isNextEpisodeUnreleased(show);
      const fresh = await getTvExtraDetails(show.externalId);
      const updates = {};
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
      if (fresh.nextEpisodeToAir) updates.nextEpisodeToAir = fresh.nextEpisodeToAir;

      if (
        !justPremiered &&
        wasEpisodeBlocked &&
        !isNextEpisodeUnreleased({ ...show, nextEpisodeToAir: fresh.nextEpisodeToAir })
      ) {
        updates.releasedNoticedAt = today;
      }

      if (needsBackfill) {
        if (fresh.overview) updates.overview = fresh.overview;
        if ((!show.genres || !show.genres.length) && fresh.genres && fresh.genres.length) {
          updates.genres = fresh.genres;
        }
        if ((!show.cast || !show.cast.length) && fresh.cast && fresh.cast.length) {
          updates.cast = fresh.cast;
        }
        if ((!show.creators || !show.creators.length) && fresh.creators && fresh.creators.length) {
          updates.creators = fresh.creators;
        }
        if (!show.episodeRuntime && fresh.episodeRuntime) updates.episodeRuntime = fresh.episodeRuntime;
        if (show.communityRating == null && fresh.communityRating != null) {
          updates.communityRating = fresh.communityRating;
        }
        if (!show.trailerUrl && fresh.trailerUrl) {
          updates.trailerUrl = fresh.trailerUrl;
        }
      }

      if (Object.keys(updates).length) {
        await updateItem(user.uid, "tv", show.id, updates);
      }
    } catch (err) {
      console.error("No se pudo comprobar/actualizar", show.title, err);
    }
  }

  // Libros: si a alguno le faltaba la sinopsis, se intenta rellenar.
  for (const book of allBooks) {
    if (book.manual || book.description) continue;
    if (!book.externalId || !book.externalId.startsWith("/works/")) continue;
    try {
      const description = await getOpenLibraryDescription(book.externalId);
      if (description) {
        await updateItem(user.uid, "book", book.id, { description });
      }
    } catch (err) {
      console.error("No se pudo completar la sinopsis de", book.title, err);
    }
  }

  try {
    await upsertUserProfile(user.uid, { lastReleaseCheckAt: today });
  } catch (err) {
    console.error(err);
  }
}
