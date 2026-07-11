// =============================================================
// Renderizado del DOM. Este módulo no habla con Firebase ni con
// las APIs externas: recibe datos ya listos y devuelve HTML,
// o dispara callbacks que app.js conecta con db.js.
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
  document.getElementById("user-avatar").src =
    user.photoURL || PLACEHOLDER_COVER;
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

/* ---------- Modal de detalle ---------- */

export function openModal(item, { onSave, onDelete }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const scope = scopeFor(item.type);
  const labels = STATUS_LABELS[scope];
  const showProgress = item.type === "tv" || item.type === "book";
  const progressLabel = item.type === "tv" ? "Temporada actual" : "Página actual";

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
            <label for="field-progress">${progressLabel}</label>
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
