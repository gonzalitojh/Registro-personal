// =============================================================
// Feed de actividad de amigos.
// Genera eventos de actividad reciente a partir de los datos
// de películas, series y libros de cada amigo, ordenados por
// fecha (más reciente primero).
// =============================================================

import { normalizeEntry } from "./tv-progress.js";

/* ------------------------------------------------------------------ */
/*  Constantes de tipos de evento                                     */
/* ------------------------------------------------------------------ */

const EVENT_TYPES = {
  MOVIE_WATCHED: "movie_watched",
  SERIES_STARTED: "series_started",
  SERIES_COMPLETED: "series_completed",
  SERIES_EPISODES: "series_episodes",
  BOOK_STARTED: "book_started",
  BOOK_FINISHED: "book_finished",
  GAME_STARTED: "game_started",
  GAME_FINISHED: "game_finished",
};

/* ------------------------------------------------------------------ */
/*  Función principal: generar el feed de actividad de un amigo       */
/* ------------------------------------------------------------------ */

/**
 * Procesa los items de un amigo y devuelve un array de eventos
 * de actividad ordenados por fecha (más reciente primero).
 *
 * @param {string} friendName  - Nombre para mostrar del amigo
 * @param {Array}  movies      - Películas del amigo
 * @param {Array}  series      - Series del amigo
 * @param {Array}  books       - Libros del amigo
 * @param {Array}  games       - Videojuegos del amigo
 * @returns {Array<object>}    - Eventos { date, type, label, friendName, item, detail }
 */
export function buildFriendFeed(friendName, movies, series, books, games = []) {
  const events = [];

  // ---- Películas ----
  movies.forEach((m) => {
    const watchLog = m.watchLog || [];
    watchLog.forEach((date) => {
      maybePushDateEvent(events, date, EVENT_TYPES.MOVIE_WATCHED, "Vio la película", friendName, m, "");
    });

    // Si no hay watchLog pero está completada, usamos updatedAt
    if (m.status === "completado" && watchLog.length === 0) {
      maybePushDateEvent(events, m.updatedAt, EVENT_TYPES.MOVIE_WATCHED, "Vio la película", friendName, m, "");
    }
  });

  // ---- Series ----
  series.forEach((s) => {
    const watched = s.watched || {};
    const allEntries = [];
    Object.entries(watched).forEach(([seasonStr, epMap]) => {
      Object.entries(epMap).forEach(([epStr, raw]) => {
        const entry = normalizeEntry(raw);
        if (entry && entry.date) {
          allEntries.push({ season: Number(seasonStr), episode: Number(epStr), date: entry.date });
        }
      });
    });

    // Evento de episodios vistos agrupados
    if (allEntries.length > 0) {
      // Ordenar por fecha
      allEntries.sort((a, b) => a.date.localeCompare(b.date));
      const firstDate = allEntries[0].date;
      const lastDate = allEntries[allEntries.length - 1].date;

      // Si la serie está completada y la última fecha de episodio es la más relevante
      if (s.status === "completado") {
        // Preferir lastWatchedAt si existe
        const compDate = s.lastWatchedAt || lastDate;
        events.push({
          date: compDate,
          type: EVENT_TYPES.SERIES_COMPLETED,
          label: `Completó la serie`,
          friendName,
          item: s,
          detail: allEntries.length > 1
            ? `${allEntries.length} episodios vistos`
            : "1 episodio visto",
        });
      } else {
        // Si solo tiene un episodio visto -> "Empezó la serie"
        if (allEntries.length === 1) {
          events.push({
            date: firstDate,
            type: EVENT_TYPES.SERIES_STARTED,
            label: `Empezó la serie`,
            friendName,
            item: s,
            detail: `Episodio ${allEntries[0].season}x${allEntries[0].episode}`,
          });
        }
        // Último episodio visto (para series en curso)
        if (allEntries.length > 1) {
          events.push({
            date: lastDate,
            type: EVENT_TYPES.SERIES_EPISODES,
            label: `Vio episodios de`,
            friendName,
            item: s,
            detail: `Último: ${allEntries[allEntries.length - 1].season}x${allEntries[allEntries.length - 1].episode}`,
          });
        }
      }
    }

    // Historial de recompletados
    (s.history || []).forEach((h) => {
      if (h.finishedAt) {
        events.push({
          date: h.finishedAt,
          type: EVENT_TYPES.SERIES_COMPLETED,
          label: `Completó la serie`,
          friendName,
          item: s,
          detail: "",
        });
      }
      if (h.startedAt && !h.finishedAt) {
        events.push({
          date: h.startedAt,
          type: EVENT_TYPES.SERIES_STARTED,
          label: `Empezó (de nuevo) la serie`,
          friendName,
          item: s,
          detail: "",
        });
      }
    });

    // Si está completada pero no generamos evento aún por falta de watched
    if (s.status === "completado" && allEntries.length === 0) {
      const compDate = s.lastWatchedAt || s.updatedAt;
      if (compDate) {
        events.push({
          date: compDate,
          type: EVENT_TYPES.SERIES_COMPLETED,
          label: `Completó la serie`,
          friendName,
          item: s,
          detail: "",
        });
      }
    }
  });

  // ---- Libros ----
  books.forEach((b) => {
    (b.readLog || []).forEach((entry) => {
      if (entry.startedAt && !entry.finishedAt) {
        // Actualmente leyendo
        maybePushDateEvent(events, entry.startedAt, EVENT_TYPES.BOOK_STARTED, "Está leyendo", friendName, b,
          b.pages && b.progress ? `Pág. ${b.progress} de ${b.pages}` : "");
      }
      if (entry.finishedAt) {
        maybePushDateEvent(events, entry.finishedAt, EVENT_TYPES.BOOK_FINISHED, "Terminó de leer", friendName, b, "");
      }
    });

    // Si no tiene readLog pero está completado
    if (b.status === "completado" && (!b.readLog || b.readLog.length === 0)) {
      maybePushDateEvent(events, b.updatedAt, EVENT_TYPES.BOOK_FINISHED, "Terminó de leer", friendName, b, "");
    }
  });

  // ---- Videojuegos ----
  games.forEach((g) => {
    (g.playLog || []).forEach((entry) => {
      if (entry.startedAt && !entry.finishedAt) {
        maybePushDateEvent(events, entry.startedAt, EVENT_TYPES.GAME_STARTED, "Está jugando", friendName, g, "");
      }
      if (entry.finishedAt) {
        maybePushDateEvent(events, entry.finishedAt, EVENT_TYPES.GAME_FINISHED, "Terminó de jugar", friendName, g, "");
      }
    });

    // Fallback: completado sin playLog (usa updatedAt)
    if (g.status === "completado" && (!g.playLog || g.playLog.length === 0)) {
      maybePushDateEvent(events, g.updatedAt, EVENT_TYPES.GAME_FINISHED, "Terminó de jugar", friendName, g, "");
    }
  });

  // ---- Ordenar por fecha descendente (más reciente primero) ----
  events.sort((a, b) => {
    // Si una tiene date y la otra no, la que tiene date va primero
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return events;
}

/**
 * Genera el feed combinado de todos los amigos.
 *
 * @param {Array<object>} friendsData - Array de { profile, movies, series, books, games }
 * @returns {Array<object>} Eventos combinados y ordenados
 */
export function buildGlobalFeed(friendsData) {
  const allEvents = [];

  friendsData.forEach(({ profile, movies, series, books, games }) => {
    const name = profile.displayName || profile.email || "Alguien";
    const events = buildFriendFeed(name, movies, series, books, games);
    allEvents.push(...events);
  });

  // Orden global descendente
  allEvents.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return allEvents;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Añade un evento al array solo si la fecha es válida.
 */
function maybePushDateEvent(events, date, type, label, friendName, item, detail) {
  if (!date) return;
  // Si es Timestamp de Firestore, convertir a string YYYY-MM-DD
  let dateStr = date;
  if (typeof date === "object" && date.toDate) {
    dateStr = date.toDate().toISOString().slice(0, 10);
  } else if (typeof date === "object" && date.seconds) {
    dateStr = new Date(date.seconds * 1000).toISOString().slice(0, 10);
  }
  if (!dateStr || typeof dateStr !== "string") return;
  // Validar formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;

  events.push({ date: dateStr, type, label, friendName, item, detail });
}


