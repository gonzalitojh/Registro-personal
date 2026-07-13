// =============================================================
// Renderizado del DOM. Este módulo no habla con Firebase ni con
// las APIs externas: recibe datos ya listos y devuelve HTML,
// o dispara callbacks que app.js conecta con db.js / TMDB.
// =============================================================

import { todayISO, formatDateEs } from "./dates.js";

const STATUS_LABELS = {
  media: { pendiente: "Pendiente", en_curso: "Viendo", completado: "Vista" },
  book: { pendiente: "Pendiente", en_curso: "Leyendo", completado: "Leído" },
};

function scopeFor(type) {
  return type === "book" ? "book" : "media";
}

export function statusLabel(status, type) {
  const scope = scopeFor(type);
  return STATUS_LABELS[scope][status] || status;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function typeLabel(type) {
  if (type === "movie") return "Película";
  if (type === "tv") return "Serie";
  return "Libro";
}

const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='300'><rect width='100%' height='100%' fill='#e3dac4'/><text x='50%' y='50%' font-family='sans-serif' font-size='16' fill='#948a76' text-anchor='middle'>Sin imagen</text></svg>`
  );

/* ---------- Pantallas ---------- */

export function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

export function showApp(user) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("user-name").textContent = user.displayName || user.email;
  document.getElementById("user-avatar").src = user.photoURL || PLACEHOLDER_COVER;
}

export function setAuthError(message) {
  const el = document.getElementById("auth-error");
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

/* ---------- Resultados de búsqueda ---------- */

export function renderSearchResults(container, results, existingIds, onAdd) {
  if (!results.length) {
    container.innerHTML = `<p class="empty-state" style="margin:0">Sin resultados.</p>`;
    return;
  }

  container.innerHTML = results
    .map((r, index) => {
      const added = existingIds.has(r.externalId);
      const metaLine =
        r.type === "book" ? [r.author, r.year].filter(Boolean).join(" · ") : r.year;
      return `
      <article class="result-card">
        <img class="result-card__cover" loading="lazy"
             src="${r.coverUrl || PLACEHOLDER_COVER}" alt="" />
        <div class="result-card__body">
          <div class="result-card__title">${escapeHtml(r.title)}</div>
          <div class="result-card__meta">${escapeHtml(metaLine || "")}</div>
          <button class="btn ${
            r.type === "book" ? "btn--accent-books" : "btn--accent-media"
          }" data-index="${index}" ${added ? "disabled" : ""}>
            ${added ? "Añadido" : "Añadir"}
          </button>
        </div>
      </article>`;
    })
    .join("");

  container.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = results[Number(btn.dataset.index)];
      onAdd(item, btn);
    });
  });
}

/* ---------- Biblioteca personal ---------- */

function progressLine(item) {
  if (item.type === "movie") {
    const log = item.watchLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    return `Vista el ${formatDateEs(last)}${log.length > 1 ? ` · ×${log.length}` : ""}`;
  }
  if (item.type === "tv") {
    if (item.status === "completado") {
      const times = (item.timesCompleted || 0) + 1;
      return `Completa${times > 1 ? ` · ×${times}` : ""} · ${formatDateEs(item.lastWatchedAt)}`;
    }
    if (item.nextEpisode) {
      return `Siguiente: T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
    }
    return "";
  }
  if (item.type === "book") {
    const log = item.readLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    if (!last.finishedAt) return `Leyendo desde ${formatDateEs(last.startedAt)}`;
    const times = log.filter((e) => e.finishedAt).length;
    return `Leído el ${formatDateEs(last.finishedAt)}${times > 1 ? ` · ×${times}` : ""}`;
  }
  return "";
}

export function renderLibrary(gridEl, emptyEl, items, onOpen) {
  if (!items.length) {
    gridEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  gridEl.innerHTML = items
    .map((item, index) => {
      const metaLine =
        item.type === "book"
          ? [item.author, item.year].filter(Boolean).join(" · ")
          : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
      const stars = item.rating ? "★".repeat(item.rating) : "";
      const progress = progressLine(item);
      return `
      <article class="item-card">
        <div class="item-card__cover-wrap">
          <img class="item-card__cover" loading="lazy"
               src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
          <span class="item-card__stamp item-card__stamp--${item.status}">
            ${statusLabel(item.status, item.type)}
          </span>
        </div>
        <div class="item-card__perforation"></div>
        <div class="item-card__body">
          <div class="item-card__title">${escapeHtml(item.title)}</div>
          <div class="item-card__meta">${escapeHtml(metaLine)}</div>
          ${progress ? `<div class="item-card__progress">${escapeHtml(progress)}</div>` : ""}
          ${stars ? `<div class="item-card__rating">${stars}</div>` : ""}
        </div>
        <button class="item-card__btn" data-index="${index}"
                aria-label="Ver detalles de ${escapeHtml(item.title)}"></button>
      </article>`;
    })
    .join("");

  gridEl.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      onOpen(items[Number(btn.dataset.index)]);
    });
  });
}

/* ---------- Campos comunes: valoración y notas ---------- */

function ratingPickerHtml(rating) {
  return `
    <div class="field-group">
      <label>Valoración</label>
      <div class="rating-picker" id="field-rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" data-value="${n}" class="${
                rating >= n ? "is-active" : ""
              }">${n}</button>`
          )
          .join("")}
      </div>
    </div>`;
}

function notesFieldHtml(notes) {
  return `
    <div class="field-group">
      <label for="field-notes">Notas</label>
      <textarea id="field-notes" placeholder="Impresiones...">${escapeHtml(notes || "")}</textarea>
    </div>`;
}

function wireRatingAndGetValue(content, initialRating) {
  let selectedRating = initialRating || 0;
  const buttons = content.querySelectorAll("#field-rating button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.value);
      selectedRating = value === selectedRating ? 0 : value;
      buttons.forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.value) <= selectedRating)
      );
    });
  });
  return () => selectedRating;
}

/* ---------- Modal de detalle: películas ---------- */

function renderWatchLogRows(watchLog) {
  if (!watchLog || !watchLog.length) {
    return `<p class="log-empty">Aún no la has visto.</p>`;
  }
  return `<div class="log-list">
    ${watchLog
      .map(
        (date, index) => `
        <div class="log-row">
          <input type="date" class="watch-date" data-index="${index}" value="${date}" />
          <button type="button" class="btn btn--small btn--danger watch-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openMovieModal(item, { onAddWatch, onUpdateWatch, onRemoveWatch, onSaveMeta, onDelete }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [typeLabel(item.type), item.year].filter(Boolean).join(" · ");

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>

    <div class="field-group">
      <label>Visionados</label>
      ${renderWatchLogRows(item.watchLog)}
      <div class="log-add-row">
        <input type="date" id="field-new-watch-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-media" id="btn-add-watch">
          ${item.watchLog && item.watchLog.length ? "Añadir otro visionado" : "Marcar como vista"}
        </button>
      </div>
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);

  content.querySelector("#btn-add-watch").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-new-watch-date").value;
    if (!dateVal) return;
    await onAddWatch(dateVal);
    openMovieModal(item, { onAddWatch, onUpdateWatch, onRemoveWatch, onSaveMeta, onDelete });
  });

  content.querySelectorAll(".watch-date").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateWatch(Number(input.dataset.index), input.value);
      openMovieModal(item, { onAddWatch, onUpdateWatch, onRemoveWatch, onSaveMeta, onDelete });
    });
  });

  content.querySelectorAll(".watch-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar este visionado del historial?")) return;
      await onRemoveWatch(Number(btn.dataset.index));
      openMovieModal(item, { onAddWatch, onUpdateWatch, onRemoveWatch, onSaveMeta, onDelete });
    });
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  modal.classList.remove("hidden");
}

/* ---------- Modal de detalle: libros ---------- */

function renderReadLogRows(readLog) {
  if (!readLog || !readLog.length) {
    return `<p class="log-empty">Aún no has empezado a leerlo.</p>`;
  }
  return `<div class="log-list">
    ${readLog
      .map(
        (entry, index) => `
        <div class="log-row">
          <input type="date" class="read-start" data-index="${index}" value="${entry.startedAt}" />
          <span class="log-row__arrow">→</span>
          ${
            entry.finishedAt
              ? `<input type="date" class="read-finish" data-index="${index}" value="${entry.finishedAt}" />`
              : `<span class="log-row__reading">leyendo</span>`
          }
          <button type="button" class="btn btn--small btn--danger read-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openBookModal(
  item,
  { onStartReading, onFinishReading, onUpdateEntry, onRemoveEntry, onSaveMeta, onDelete }
) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [item.author, item.year].filter(Boolean).join(" · ");
  const isReading =
    item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>

    <div class="field-group">
      <label>Lecturas</label>
      ${renderReadLogRows(item.readLog)}
      <div class="log-add-row">
        <input type="date" id="field-log-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-books" id="btn-log-action">
          ${isReading ? "Terminar de leer" : "Empezar a leer"}
        </button>
      </div>
    </div>

    <div class="field-group">
      <label for="field-progress">Página actual</label>
      <input type="number" min="0" id="field-progress" value="${item.progress ?? ""}" />
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  const rerender = () =>
    openBookModal(item, {
      onStartReading,
      onFinishReading,
      onUpdateEntry,
      onRemoveEntry,
      onSaveMeta,
      onDelete,
    });

  content.querySelector("#btn-log-action").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-log-date").value;
    if (!dateVal) return;
    if (isReading) await onFinishReading(dateVal);
    else await onStartReading(dateVal);
    rerender();
  });

  content.querySelectorAll(".read-start").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { startedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-finish").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { finishedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar esta lectura del historial?")) return;
      await onRemoveEntry(Number(btn.dataset.index));
      rerender();
    });
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    const raw = content.querySelector("#field-progress").value;
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
      progress: raw === "" ? null : Number(raw),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  modal.classList.remove("hidden");
}

/* ---------- Modal de detalle: series (temporadas y episodios) ---------- */

function renderSeasonBlock(s, watched) {
  const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
  const watchedCount = Object.keys(seasonWatched).length;
  const allWatched = watchedCount >= s.episodeCount && s.episodeCount > 0;
  return `
    <div class="season-block" data-season="${s.seasonNumber}" data-episode-count="${s.episodeCount}">
      <div class="season-header">
        <button class="season-toggle" data-season="${s.seasonNumber}">
          <span class="season-chevron">▸</span>
          <span class="season-name">${escapeHtml(s.name)}</span>
          <span class="season-count">${watchedCount}/${s.episodeCount}</span>
        </button>
        <button class="btn btn--small season-mark-all" data-season="${s.seasonNumber}"
                data-all-watched="${allWatched ? "0" : "1"}">
          ${allWatched ? "Desmarcar todo" : "Marcar todo"}
        </button>
      </div>
      <div class="season-episodes hidden" data-season-episodes="${s.seasonNumber}"></div>
    </div>`;
}

function renderEpisodeRows(episodes, seasonWatched) {
  return episodes
    .map((e) => {
      const date = seasonWatched[String(e.episodeNumber)] || "";
      const checked = Boolean(date);
      return `
      <div class="episode-row ${checked ? "is-watched" : ""}" data-episode="${e.episodeNumber}">
        <input type="checkbox" class="episode-checkbox" ${checked ? "checked" : ""} />
        <span class="episode-row__num">E${e.episodeNumber}</span>
        <span class="episode-row__name">${escapeHtml(e.name)}</span>
        <input type="date" class="episode-date" value="${date}" ${checked ? "" : "disabled"} />
      </div>`;
    })
    .join("");
}

export function openTvModal(
  item,
  seasonsMeta,
  progress,
  { onExpandSeason, onSetEpisodeDate, onToggleSeason, onRewatch, onSaveMeta, onDelete }
) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const nextLine = progress.nextEpisode
    ? `Siguiente: T${progress.nextEpisode.season}E${progress.nextEpisode.episode}`
    : "¡Serie completada!";
  const pct = progress.totalEpisodes
    ? Math.round((progress.totalWatched / progress.totalEpisodes) * 100)
    : 0;
  const times = (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0);

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(item.year || "")}</div>
      </div>
    </div>

    <div class="progress-banner">
      <span class="next-line">${nextLine}</span>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-count">${progress.totalWatched}/${progress.totalEpisodes} episodios</span>
    </div>

    ${
      item.status === "completado"
        ? `<div class="completion-banner">
            <p>Has terminado esta serie${times > 1 ? ` (visionado nº ${times})` : ""}.</p>
            <p class="completion-dates">
              Empezada: ${formatDateEs(item.firstWatchedAt)} · Terminada: ${formatDateEs(item.lastWatchedAt)}
            </p>
            <button type="button" class="btn btn--accent-media btn--small" id="btn-rewatch">
              Volver a verla desde el principio
            </button>
          </div>`
        : ""
    }

    ${
      item.history && item.history.length
        ? `<details class="rewatch-history">
            <summary>Visionados anteriores (${item.history.length})</summary>
            <ul>
              ${item.history
                .map(
                  (h) =>
                    `<li>${formatDateEs(h.startedAt)} → ${formatDateEs(h.finishedAt)}</li>`
                )
                .join("")}
            </ul>
          </details>`
        : ""
    }

    <div class="seasons-list">
      ${seasonsMeta.map((s) => renderSeasonBlock(s, item.watched)).join("")}
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  function updateBanner(newProgress) {
    const line = newProgress.nextEpisode
      ? `Siguiente: T${newProgress.nextEpisode.season}E${newProgress.nextEpisode.episode}`
      : "¡Serie completada!";
    content.querySelector(".next-line").textContent = line;
    const newPct = newProgress.totalEpisodes
      ? Math.round((newProgress.totalWatched / newProgress.totalEpisodes) * 100)
      : 0;
    content.querySelector(".progress-bar-fill").style.width = newPct + "%";
    content.querySelector(".progress-count").textContent =
      `${newProgress.totalWatched}/${newProgress.totalEpisodes} episodios`;
  }

  function updateSeasonCount(seasonNumber, watchedCount, episodeCount) {
    const block = content.querySelector(`.season-block[data-season="${seasonNumber}"]`);
    block.querySelector(".season-count").textContent = `${watchedCount}/${episodeCount}`;
    const markBtn = block.querySelector(".season-mark-all");
    const allWatched = watchedCount >= episodeCount && episodeCount > 0;
    markBtn.textContent = allWatched ? "Desmarcar todo" : "Marcar todo";
    markBtn.dataset.allWatched = allWatched ? "0" : "1";
  }

  function wireEpisodeRows(block, seasonNumber, episodeCount) {
    block.querySelectorAll(".episode-row").forEach((row) => {
      const episodeNumber = Number(row.dataset.episode);
      const checkbox = row.querySelector(".episode-checkbox");
      const dateInput = row.querySelector(".episode-date");

      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        const newDate = checkbox.checked ? todayISO() : null;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, newDate);
          row.classList.toggle("is-watched", checkbox.checked);
          dateInput.disabled = !checkbox.checked;
          dateInput.value = newDate || "";
          const watchedCountInSeason = block.querySelectorAll(".episode-row.is-watched").length;
          updateSeasonCount(seasonNumber, watchedCountInSeason, episodeCount);
          updateBanner(newProgress);
        } catch (err) {
          checkbox.checked = !checkbox.checked;
        } finally {
          checkbox.disabled = false;
        }
      });

      dateInput.addEventListener("change", async () => {
        if (!dateInput.value) return;
        dateInput.disabled = true;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, dateInput.value);
          updateBanner(newProgress);
        } finally {
          dateInput.disabled = false;
        }
      });
    });
  }

  content.querySelectorAll(".season-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const block = content.querySelector(
        `.season-episodes[data-season-episodes="${seasonNumber}"]`
      );
      const chevron = btn.querySelector(".season-chevron");
      const isHidden = block.classList.contains("hidden");

      if (!isHidden) {
        block.classList.add("hidden");
        chevron.textContent = "▸";
        return;
      }
      block.classList.remove("hidden");
      chevron.textContent = "▾";
      if (block.dataset.loaded) return;

      block.innerHTML = `<p class="episode-loading">Cargando episodios…</p>`;
      try {
        const episodes = await onExpandSeason(seasonNumber);
        const seasonWatched = (item.watched && item.watched[String(seasonNumber)]) || {};
        block.innerHTML = renderEpisodeRows(episodes, seasonWatched);
        block.dataset.loaded = "1";
        const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
        wireEpisodeRows(block, seasonNumber, episodeCount);
      } catch (err) {
        block.innerHTML = `<p class="episode-loading">No se pudieron cargar los episodios.</p>`;
      }
    });
  });

  content.querySelectorAll(".season-mark-all").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
      const shouldMarkAll = btn.dataset.allWatched === "1";
      btn.disabled = true;
      try {
        const newProgress = await onToggleSeason(seasonNumber, shouldMarkAll);
        updateSeasonCount(seasonNumber, shouldMarkAll ? episodeCount : 0, episodeCount);
        updateBanner(newProgress);

        const episodesBlock = content.querySelector(
          `.season-episodes[data-season-episodes="${seasonNumber}"]`
        );
        if (episodesBlock.dataset.loaded) {
          const today = todayISO();
          episodesBlock.querySelectorAll(".episode-row").forEach((row) => {
            const checkbox = row.querySelector(".episode-checkbox");
            const dateInput = row.querySelector(".episode-date");
            checkbox.checked = shouldMarkAll;
            row.classList.toggle("is-watched", shouldMarkAll);
            dateInput.disabled = !shouldMarkAll;
            dateInput.value = shouldMarkAll ? today : "";
          });
        }
      } finally {
        btn.disabled = false;
      }
    });
  });

  const rewatchBtn = content.querySelector("#btn-rewatch");
  if (rewatchBtn) {
    rewatchBtn.addEventListener("click", async () => {
      if (
        !window.confirm(
          `¿Volver a ver «${item.title}» desde el principio? Se guardará el visionado anterior en el historial.`
        )
      ) {
        return;
      }
      await onRewatch();
    });
  }

  const getRating = wireRatingAndGetValue(content, item.rating);

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  modal.classList.remove("hidden");
}

export function closeModal() {
  document.getElementById("item-modal").classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
}

/* ---------- Aviso flotante ---------- */

let toastTimer = null;
export function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}
