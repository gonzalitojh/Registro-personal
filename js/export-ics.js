// =============================================================
// Exportación de calendario de estrenos a formato .ics (iCalendar).
// Genera un archivo compatible con RFC 5545 que incluye los
// próximos episodios de series en emisión y/o las fechas de
// estreno de películas pendientes, para importar en Google
// Calendar, Apple Calendar y otros.
// =============================================================

import { todayISO } from "./dates.js";
import * as ui from "./ui.js";

// ---------- Ayudantes ICS ----------

/**
  * Escapa caracteres especiales para valores TEXT en iCalendar.
  * Según RFC 5545, hay que escapar: \, ; , y saltos de línea.
  */
function escapeIcsText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/**
  * Convierte una fecha ISO "YYYY-MM-DD" al formato DATE de iCalendar: YYYYMMDD.
  */
function formatIcsDate(isoString) {
  if (!isoString) return null;
  const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}`;
}

/**
  * Aplica el plegado de línea RFC 5545: máximo 75 octetos por línea.
  * Las líneas que exceden se continúan con un espacio al inicio de la
  * siguiente línea (continuation line).
  */
function foldLine(line) {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const parts = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (parts.length === 0) {
      parts.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    } else {
      // Las líneas de continuación empiezan con un espacio (1 octeto)
      const avail = maxLen - 1;
      parts.push(" " + remaining.slice(0, avail));
      remaining = remaining.slice(avail);
    }
  }
  return parts.join("\r\n");
}

/**
  * Genera un UID único y estable para cada evento.
  */
function generateUid(type, itemId) {
  return `mi-registro-${type}-${itemId}@registro-personal`;
}

// ---------- Generación ICS ----------

/**
  * Construye el contenido completo de un archivo .ics a partir de
  * una lista de eventos.
  *
  * @param {Array<{uid:string, dtstart:string, summary:string, description?:string}>} events
  * @returns {string} Contenido del archivo ICS (con CRLF)
  */
function generateIcsString(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mi Registro//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTART;VALUE=DATE:${ev.dtstart}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // Unir con CRLF (estándar iCalendar) y plegar líneas largas
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---------- Recopilación de datos ----------

/**
  * Recopila los próximos eventos (episodios de series y estrenos de
  * películas) a partir de los datos del usuario.
  *
  * Los grupos se leen de Firestore bajo demanda (getItemsOnce) y no
  * del estado en memoria (issue #178): con el lazy loading por
  * pestaña, un grupo que el usuario no ha visitado aún no está
  * suscrito y la exportación se quedaría sin esos eventos.
  *
  * @param {Object} ctx - Contexto de la aplicación
  * @param {boolean} includeMovies - Incluir estrenos de películas
  * @param {boolean} includeTv - Incluir próximos episodios de series
  * @returns {Promise<Array<{uid:string, dtstart:string, summary:string, description?:string}>>}
  */
async function collectUpcomingEvents(ctx, includeMovies, includeTv) {
  const events = [];
  const today = todayISO();
  const user = ctx.getCurrentUser();

  if (includeTv) {
    const tvSeries = (user && (await ctx.getItemsOnce(user.uid, "tv"))) || [];
    for (const item of tvSeries) {
      const episode = item.nextEpisodeToAir;
      if (!episode || !episode.airDate) continue;
      if (episode.airDate < today) continue;

      const epLabel = episode.episode != null ? `E${episode.episode}` : "";
      const seasonLabel = episode.season != null ? `T${episode.season}` : "";
      const epSuffix = seasonLabel || epLabel ? ` (${seasonLabel}${epLabel})` : "";

      events.push({
        uid: generateUid("tv", item.id),
        dtstart: formatIcsDate(episode.airDate),
        summary: `Nuevo episodio: ${item.title}${epSuffix}`,
        description: episode.airDate
          ? `Próximo episodio de la serie ${item.title} que se estrena el ${episode.airDate}.`
          : undefined,
      });
    }
  }

  if (includeMovies) {
    const movies = (user && (await ctx.getItemsOnce(user.uid, "movie"))) || [];
    for (const item of movies) {
      // Incluir películas pendientes o con awaitingRelease, que tengan fecha futura
      const isPending = item.status === "pendiente" || item.awaitingRelease === true;
      if (!isPending) continue;
      if (!item.releaseDate) continue;
      if (item.releaseDate < today) continue;

      events.push({
        uid: generateUid("movie", item.id),
        dtstart: formatIcsDate(item.releaseDate),
        summary: `Estreno: ${item.title}`,
        description: item.overview
          ? item.overview.slice(0, 250)
          : `Próximo estreno de ${item.title} el ${item.releaseDate}.`,
      });
    }
  }

  // Ordenar por fecha
  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));

  return events;
}

// ---------- Descarga ----------

/**
  * Genera y descarga el archivo .ics.
  *
  * @param {Object} ctx - Contexto de la aplicación
  * @param {{includeMovies?:boolean, includeTv?:boolean}} options
  */
export async function downloadIcs(ctx, options = {}) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  const includeMovies = options.includeMovies !== false;
  const includeTv = options.includeTv !== false;

  ui.showToast("Preparando calendario…");

  try {
    const events = await collectUpcomingEvents(ctx, includeMovies, includeTv);

    if (events.length === 0) {
      ui.showToast("No hay estrenos próximos que exportar.");
      return;
    }

    const icsContent = generateIcsString(events);
    const blob = new Blob([icsContent], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `calendario-estrenos-${todayISO()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    ui.showToast(`Calendario descargado (${events.length} evento${events.length !== 1 ? "s" : ""}).`);
  } catch (err) {
    console.error("Error al exportar calendario:", err);
    ui.showToast("No se pudo exportar el calendario: " + err.message);
  }
}

// ---------- Configuración de botones ----------

/**
  * Configura los botones de exportación de calendario en la vista de perfil.
  *
  * @param {Object} ctx - Contexto de la aplicación
  */
export function setupExportIcs(ctx) {
  const btn = document.getElementById("btn-export-ics");
  if (!btn) return;

  btn.addEventListener("click", () => {
    downloadIcs(ctx, { includeMovies: true, includeTv: true });
  });
}
