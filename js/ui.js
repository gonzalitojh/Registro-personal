// =============================================================
// Renderizado del DOM. Este módulo no habla con Firebase ni con
// las APIs externas: recibe datos ya listos y devuelve HTML,
// o dispara callbacks que app.js conecta con db.js / TMDB.
// =============================================================

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
  if (item.type !== "tv") return "";
  if (item.status === "completado") return "Serie completada";
  if (item.nextEpisode) {
    return `Siguiente: T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
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

/* ---------- Modal de detalle: películas y libros ---------- */

export function openModal(item, { onSave, onDelete }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const scope = scopeFor(item.type);
  const labels = STATUS_LABELS[scope];
  const showProgress = item.type === "book";

  const metaLine =
    item.type === "book"
      ? [item.author, item.year].filter(Boolean).join(" · ")
      : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>

    <div class="field-group">
      <label for="field-status">Estado</label>
      <select id="field-status">
        ${Object.entries(labels)
          .map(
            ([value, label]) =>
              `<option value="${value}" ${
                item.status === value ? "selected" : ""
              }>${label}</option>`
          )
          .join("")}
      </select>
    </div>

    <div class="field-group">
      <label>Valoración</label>
      <div class="rating-picker" id="field-rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" data-value="${n}" class="${
                item.rating >= n ? "is-active" : ""
              }">${n}</button>`
          )
          .join("")}
      </div>
    </div>

    ${
      showProgress
        ? `<div class="field-group">
            <label for="field-progress">Página actual</label>
            <input type="number" min="0" id="field-progress" value="${item.progress ?? ""}" />
          </div>`
        : ""
    }

    <div class="field-group">
      <label for="field-notes">Notas</label>
      <textarea id="field-notes" placeholder="Impresiones, dónde lo dejaste...">${escapeHtml(
        item.notes || ""
      )}</textarea>
    </div>

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  let selectedRating = item.rating || 0;
  const ratingButtons = content.querySelectorAll("#field-rating button");
  ratingButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.value);
      selectedRating = value === selectedRating ? 0 : value;
      ratingButtons.forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.value) <= selectedRating)
      );
    });
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    const changes = {
      status: content.querySelector("#field-status").value,
      rating: selectedRating || null,
      notes: content.querySelector("#field-notes").value.trim(),
    };
    if (showProgress) {
      const raw = content.querySelector("#field-progress").value;
      changes.progress = raw === "" ? null : Number(raw);
    }
    onSave(changes);
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  modal.classList.remove("hidden");
}

/* ---------- Modal de detalle: series (temporadas y episodios) ---------- */

function renderSeasonBlock(s, watched) {
  const watchedCount = ((watched && watched[String(s.seasonNumber)]) || []).length;
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

function renderEpisodeRows(episodes, watchedSet) {
  return episodes
    .map(
      (e) => `
      <label class="episode-row ${watchedSet.has(e.episodeNumber) ? "is-watched" : ""}">
        <input type="checkbox" data-episode="${e.episodeNumber}" ${
        watchedSet.has(e.episodeNumber) ? "checked" : ""
      } />
        <span class="episode-row__num">E${e.episodeNumber}</span>
        <span class="episode-row__name">${escapeHtml(e.name)}</span>
      </label>`
    )
    .join("");
}

export function openTvModal(
  item,
  seasonsMeta,
  progress,
  { onExpandSeason, onToggleEpisode, onToggleSeason, onSaveMeta, onDelete }
) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const nextLine = progress.nextEpisode
    ? `Siguiente: T${progress.nextEpisode.season}E${progress.nextEpisode.episode}`
    : "¡Serie completada!";
  const pct = progress.totalEpisodes
    ? Math.round((progress.totalWatched / progress.totalEpisodes) * 100)
    : 0;

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

    <div class="seasons-list">
      ${seasonsMeta.map((s) => renderSeasonBlock(s, item.watched)).join("")}
    </div>

    <div class="field-group">
      <label>Valoración</label>
      <div class="rating-picker" id="field-rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" data-value="${n}" class="${
                item.rating >= n ? "is-active" : ""
              }">${n}</button>`
          )
          .join("")}
      </div>
    </div>

    <div class="field-group">
      <label for="field-notes">Notas</label>
      <textarea id="field-notes" placeholder="Impresiones...">${escapeHtml(
        item.notes || ""
      )}</textarea>
    </div>

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

  function wireEpisodeCheckboxes(block, seasonNumber, episodeCount) {
    block.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        const episodeNumber = Number(cb.dataset.episode);
        cb.disabled = true;
        try {
          const newProgress = await onToggleEpisode(seasonNumber, episodeNumber);
          cb.closest(".episode-row").classList.toggle("is-watched", cb.checked);
          const watchedCountInSeason = block.querySelectorAll(
            'input[type="checkbox"]:checked'
          ).length;
          updateSeasonCount(seasonNumber, watchedCountInSeason, episodeCount);
          updateBanner(newProgress);
        } catch (err) {
          cb.checked = !cb.checked;
        } finally {
          cb.disabled = false;
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
        const watchedSet = new Set(
          (item.watched && item.watched[String(seasonNumber)]) || []
        );
        block.innerHTML = renderEpisodeRows(episodes, watchedSet);
        block.dataset.loaded = "1";
        const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
        wireEpisodeCheckboxes(block, seasonNumber, episodeCount);
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
          episodesBlock.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.checked = shouldMarkAll;
            cb.closest(".episode-row").classList.toggle("is-watched", shouldMarkAll);
          });
        }
      } finally {
        btn.disabled = false;
      }
    });
  });

  let selectedRating = item.rating || 0;
  const ratingButtons = content.querySelectorAll("#field-rating button");
  ratingButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.value);
      selectedRating = value === selectedRating ? 0 : value;
      ratingButtons.forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.value) <= selectedRating)
      );
    });
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: selectedRating || null,
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
