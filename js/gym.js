// =============================================================
// Sección de Gimnasio (issue #62) — pestañas «Entrenos» y
// «Ejercicios».
// Gestiona el registro de entrenos (fecha, nombre, nota y
// ejercicios con series de peso × repeticiones) y el catálogo de
// ejercicios del usuario (users/{uid}/gym-workouts y
// users/{uid}/gym-exercises).
//
// Peso y unidad (issue #62): el peso canónico en Firestore es
// SIEMPRE kg (pesoKg). La unidad de presentación (kg/lbs) vive en
// settings.unidadPeso y solo afecta a los displays, a las entradas
// y al placeholder de los inputs: los valores guardados nunca
// cambian al alternar.
//
// Patrón: como recipes.js, se conecta desde app.js vía
// setupGym({ ctx }), que devuelve la API de apertura de la vista
// ({ openGym({ tab }) }) para el router y la sidebar.
// =============================================================

import { navigate } from "./router.js";
import { trapFocus } from "./focus-utils.js";
import { showToast } from "./ui.js";
import { getUnit, setUnit } from "./settings.js";

// ---------- Constantes ----------

// Conversión kg → lbs (1 kg = 2.20462 lbs). El peso se guarda
// siempre en kg; esta constante solo alimenta la presentación.
const KG_PER_LB = 2.20462;

// Grupos musculares del catálogo de ejercicios (issue #62): presets
// del select del alta/edición. Los entrenos guardados conservan el
// grupo como texto; los ids de abajo son los canónicos.
const GYM_MUSCLE_GROUPS = [
  { id: "pecho", label: "Pecho" },
  { id: "espalda", label: "Espalda" },
  { id: "hombros", label: "Hombros" },
  { id: "biceps", label: "Bíceps" },
  { id: "triceps", label: "Tríceps" },
  { id: "antebrazos", label: "Antebrazos" },
  { id: "piernas", label: "Piernas" },
  { id: "gluteos", label: "Glúteos" },
  { id: "core", label: "Core" },
  { id: "cardio", label: "Cardio" },
  { id: "cuerpo_completo", label: "Cuerpo completo" },
  { id: "otro", label: "Otro" },
];

const GROUP_LABELS = Object.fromEntries(GYM_MUSCLE_GROUPS.map((g) => [g.id, g.label]));

// ---------- Estado del módulo ----------

let currentUser = null;
let ctx = null;
let workouts = [];
let exercises = [];
// Pestaña de Gimnasio activa: se re-renderiza solo la pestaña a la
// vista cuando llegan datos nuevos (patrón de recipes.js #209).
let currentTab = "entrenos";

// Modales: null = cerrado; "read" | "edit" | "new". El flag edit
// bloquea el cierre por backdrop/Escape (patrón recipes.js:159-186).
let workoutModalMode = null;
let exerciseCardModalMode = null;
let workoutModalCleanup = null;
let exerciseModalCleanup = null;

// Entreno en edición: id del documento (null en el alta) y borrador
// en memoria (peso SIEMPRE en kg). El formulario se re-renderiza a
// partir del borrador en cada cambio del constructor.
let editingWorkoutId = null;
let workoutDraft = null;

// Ejercicio en edición: id (null en el alta). El formulario se lee
// al pulsar Guardar (sin borrador: no hay constructor).
let editingExerciseId = null;

// Wiring de los listeners del DOM (idempotente): setupGym corre tras
// cada login y los addEventListener no deben acumularse.
let gymWired = false;

// ---------- Utilidades ----------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Unidad de presentación activa (leída fresca desde localStorage).
function unit() {
  return getUnit();
}

// Etiqueta corta de la unidad activa para placeholders y summaries.
function unitLabel() {
  return unit();
}

// kg (canónico) → unidad de presentación, redondeado a 1 decimal.
function kgToDisplay(kg) {
  const v = unit() === "lbs" ? kg * KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

// unidad de presentación → kg (canónico), redondeado a 2 decimales.
function displayToKg(v) {
  const kg = unit() === "lbs" ? v / KG_PER_LB : v;
  return Math.round(kg * 100) / 100;
}

// Etiqueta de un grupo muscular (preset conocido o texto libre).
function groupLabel(id) {
  return GROUP_LABELS[id] || id || "";
}

// ---------- Setup ----------

// Idempotente: los elementos del DOM se wirean una sola vez aunque
// setupGym se llame tras cada login (ver app.js).
export function setupGym(opts) {
  ctx = opts?.ctx || null;

  if (gymWired) return { openGym };
  gymWired = true;

  document.getElementById("btn-new-workout").addEventListener("click", () => openWorkoutModal());
  document.getElementById("btn-new-exercise").addEventListener("click", () => openExerciseModal());

  // Pestañas (issue #62): la UI solo navega; el router (fromRouter)
  // hace el render. Patrón de recetas (recipes.js).
  document.querySelectorAll("[data-gym-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "gimnasio", tab: btn.dataset.gymTab });
    });
  });

  // Selector de unidad de peso (issue #62): se persiste con setUnit
  // (localStorage + sync a Firestore) y se re-renderizan las dos
  // pestañas (y el modal de entreno abierto, si lo hay).
  const unitSelect = document.getElementById("gym-unit-select");
  if (unitSelect) {
    unitSelect.addEventListener("change", () => {
      setUnit(unitSelect.value);
      renderAllWithUnit();
    });
  }

  // Modal de entreno: cierre por ✕, backdrop y Escape. Backdrop y
  // Escape solo cierran en modo lectura; en edición se bloquean para
  // no perder el progreso del constructor (patrón recipes.js #234).
  document.getElementById("gym-workout-modal-close").addEventListener("click", closeWorkoutModal);
  document.getElementById("gym-workout-modal-backdrop").addEventListener("click", () => {
    if (workoutModalMode === "read") closeWorkoutModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("gym-workout-modal").classList.contains("hidden") && workoutModalMode === "read") {
      e.preventDefault();
      closeWorkoutModal();
    }
  });

  // Modal de ejercicio: mismo patrón.
  document.getElementById("gym-exercise-modal-close").addEventListener("click", closeExerciseModal);
  document.getElementById("gym-exercise-modal-backdrop").addEventListener("click", () => {
    if (exerciseCardModalMode === "read") closeExerciseModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("gym-exercise-modal").classList.contains("hidden") && exerciseCardModalMode === "read") {
      e.preventDefault();
      closeExerciseModal();
    }
  });

  // Cards de entrenos: toda la tarjeta es el botón; click (y
  // Enter/Espacio) abren el detalle en modo lectura.
  document.getElementById("gym-workouts-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-workout-id]");
    if (!card) return;
    openWorkoutModal(card.dataset.workoutId);
  });
  document.getElementById("gym-workouts-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-workout-id]");
    if (!card) return;
    e.preventDefault();
    openWorkoutModal(card.dataset.workoutId);
  });

  // Cards del catálogo de ejercicios: idem.
  document.getElementById("gym-exercises-catalog").addEventListener("click", (e) => {
    const card = e.target.closest("[data-exercise-id]");
    if (!card) return;
    openExerciseModal(card.dataset.exerciseId);
  });
  document.getElementById("gym-exercises-catalog").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-exercise-id]");
    if (!card) return;
    e.preventDefault();
    openExerciseModal(card.dataset.exerciseId);
  });

  return { openGym };
}

// Arranca las suscripciones en tiempo real (lo llama app.js tras el
// login, como el resto de secciones). Devuelve la función de
// cancelación. Cada snapshot solo re-renderiza la pestaña a la vista
// (patrón de recipes.js).
export function subscribeGymData(uid, onChange, onError) {
  currentUser = uid;
  const subs = [];

  subs.push(ctx.subscribeToGymWorkouts(uid, (items) => {
    workouts = items;
    if (currentTab === "entrenos") renderWorkouts();
    if (onChange) onChange();
  }, onError));

  subs.push(ctx.subscribeToGymExercises(uid, (items) => {
    exercises = items;
    if (currentTab === "ejercicios") renderCatalog();
    // Constructor de entreno abierto (alta/edición): el catálogo puede
    // llegar después que el modal (issue #62, primer ejercicio desde
    // «Ver catálogo de ejercicios»). El borrador está en kg, así que
    // re-renderizar es seguro; el editor se repinta con el select
    // actualizado.
    const workoutModal = document.getElementById("gym-workout-modal");
    if (workoutModal && !workoutModal.classList.contains("hidden")) {
      if (workoutModalMode === "edit" || workoutModalMode === "new") {
        renderWorkoutEditor();
      }
    }
    if (onChange) onChange();
  }, onError));

  return () => subs.forEach((unsub) => unsub && unsub());
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetGymData() {
  workouts = [];
  exercises = [];
  currentTab = "entrenos";
  editingWorkoutId = null;
  workoutDraft = null;
  editingExerciseId = null;
  closeWorkoutModal();
  closeExerciseModal();
}

// ---------- Apertura / cierre de la vista ----------

export function openGym({ tab = "entrenos", fromRouter = false } = {}) {
  if (!fromRouter) {
    navigate({ section: "gimnasio", tab });
  }
  currentTab = tab;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("recipes-view").classList.add("hidden");
  document.getElementById("gym-view").classList.remove("hidden");

  document.querySelectorAll("[data-gym-tab]").forEach((btn) => {
    const isActive = btn.dataset.gymTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  const panels = {
    entrenos: "panel-gym-workouts-tab",
    ejercicios: "panel-gym-exercises-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  if (tab === "entrenos") {
    renderWorkouts();
  } else {
    renderCatalog();
  }
}

// ---------- Unidad de peso: re-render global (issue #62) ----------

// Tras cambiar el select de unidad se repinta todo lo que muestra
// pesos: la pestaña activa y, si el modal de entreno está abierto,
// su vista (lectura o edición, desde el borrador en memoria).
function renderAllWithUnit() {
  if (currentTab === "entrenos") renderWorkouts();
  else renderCatalog();
  const workoutModal = document.getElementById("gym-workout-modal");
  if (workoutModal && !workoutModal.classList.contains("hidden")) {
    if (workoutModalMode === "read") {
      const workout = workouts.find((w) => w.id === editingWorkoutId);
      if (workout) openWorkoutModal(workout.id);
    } else if (workoutModalMode === "edit" || workoutModalMode === "new") {
      renderWorkoutEditor();
    }
  }
}

// ---------- Pestaña Entrenos: listado ----------

function renderWorkouts() {
  const container = document.getElementById("gym-workouts-list");
  if (!container) return;

  if (!workouts.length) {
    container.innerHTML = `<p class="empty-state">Aún no hay entrenos. Pulsa «+ Nuevo entreno» para registrar el primero.</p>`;
    return;
  }

  container.innerHTML = `<div class="gym-workouts-grid">
    ${workouts.map(workoutCardHtml).join("")}
  </div>`;
}

function workoutCardHtml(w) {
  const ejercicios = w.ejercicios || [];
  const series = ejercicios.reduce((n, e) => n + (e.series || []).length, 0);
  const summary = `${ejercicios.length} ${ejercicios.length === 1 ? "ejercicio" : "ejercicios"} · ${series} ${series === 1 ? "serie" : "series"}`;
  const title = w.nombre || "Entreno";
  return `<article class="gym-workout-card" role="button" tabindex="0" data-workout-id="${escapeHtml(w.id)}"
    aria-label="Ver entreno ${escapeHtml(title)} (${(ctx.formatDateEs(w.fechaISO) || "").replace(/\//g, "/")})">
    <h3 class="gym-card__title">${escapeHtml(title)}</h3>
    <p class="gym-card__meta">${escapeHtml(ctx.formatDateEs(w.fechaISO) || w.fechaISO || "")} · ${escapeHtml(summary)}</p>
  </article>`;
}

// ---------- Pestaña Ejercicios: catálogo ----------

function renderCatalog() {
  const container = document.getElementById("gym-exercises-catalog");
  if (!container) return;

  if (!exercises.length) {
    container.innerHTML = `<p class="empty-state">El catálogo de ejercicios está vacío. Pulsa «+ Nuevo ejercicio» para
      añadir los que haces, y luego podrás usarlos al registrar entrenos.</p>`;
    return;
  }

  // El snapshot ya llega ordenado por nombre (db.js); el sort local
  // con tie-break por id es defensivo frente a catálogos antiguos.
  const sorted = [...exercises].sort(
    (a, b) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id)
  );

  container.innerHTML = `<div class="gym-exercises-grid">
    ${sorted.map(exerciseCardHtml).join("")}
  </div>`;
}

function exerciseCardHtml(ex) {
  const group = groupLabel(ex.grupoMuscular);
  return `<article class="gym-exercise-card" role="button" tabindex="0" data-exercise-id="${escapeHtml(ex.id)}"
    aria-label="Ver ejercicio ${escapeHtml(ex.nombre)}">
    <h3 class="gym-card__title">${escapeHtml(ex.nombre)}</h3>
    ${group ? `<span class="gym-muscle-chip">${escapeHtml(group)}</span>` : ""}
  </article>`;
}

// ---------- Modal de entreno ----------

// Abre el modal de entreno: con id = detalle en modo lectura (con
// Editar/Eliminar); sin id = alta con el constructor de ejercicios.
function openWorkoutModal(id) {
  const modal = document.getElementById("gym-workout-modal");
  const content = document.getElementById("gym-workout-modal-content");
  const workout = id ? workouts.find((w) => w.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");

  if (workout) {
    editingWorkoutId = workout.id;
    workoutModalMode = "read";
  } else {
    editingWorkoutId = null;
    workoutModalMode = "new";
    workoutDraft = {
      fechaISO: ctx.todayISO(),
      nombre: "",
      nota: "",
      ejercicios: [],
    };
  }

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    workout ? `Entreno: ${workout.nombre || "Sin nombre"}` : "Nuevo entreno"
  );

  content.innerHTML = workout ? workoutDetailHtml(workout) : renderWorkoutEditorHtml();
  bindWorkoutDetailHandlers(content, workout);
  if (workoutModalMode !== "read") bindWorkoutEditorHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  if (workoutModalCleanup) workoutModalCleanup();
  workoutModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  if (workoutModalMode !== "read") {
    // Foco al campo de fecha en el alta/edición (patrón del modal de
    // ingrediente): en un segundo rAF tras el de trapFocus (que
    // enfoca la ✕) el foco final queda en el input.
    requestAnimationFrame(() => {
      content.querySelector("#gym-wk-fecha")?.focus({ preventScroll: false });
    });
  }
}

function closeWorkoutModal() {
  const modal = document.getElementById("gym-workout-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  workoutModalMode = null;
  editingWorkoutId = null;
  workoutDraft = null;
  if (workoutModalCleanup) {
    workoutModalCleanup();
    workoutModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Vista de solo lectura del entreno: fecha, nombre y nota opcionales,
// ejercicios con su tabla de series (peso × repeticiones, unidad de
// presentación activa) y acciones Editar/Eliminar.
function workoutDetailHtml(w) {
  const ejercicios = w.ejercicios || [];
  const blocks = ejercicios.map((ex, i) => {
    const seriesRows = (ex.series || []).map((s) => `
      <div class="gym-series-row">
        <span>${s.pesoKg != null ? escapeHtml(String(kgToDisplay(s.pesoKg))) : ""} ${escapeHtml(unitLabel())}</span>
        <span>${s.reps != null ? escapeHtml(String(s.reps)) : ""} reps</span>
        <span></span>
      </div>`).join("");
    return `<div class="gym-exercise-block">
      <div class="gym-exercise-block__header">
        <h4 class="gym-exercise-block__name">${escapeHtml(ex.nombre || "Ejercicio")}</h4>
        <span class="gym-muscle-chip">${(ex.series || []).length} ${(ex.series || []).length === 1 ? "serie" : "series"}</span>
      </div>
      <div class="gym-series-table">${seriesRows}</div>
    </div>`;
  }).join("");

  return `<div class="gym-modal__view">
    <h3 class="gym-modal__title">${escapeHtml(w.nombre || "Entreno")}</h3>
    <div class="gym-form__field">
      <span class="gym-modal__label">Fecha</span>
      <p class="gym-modal__text">${escapeHtml(ctx.formatDateEs(w.fechaISO) || w.fechaISO || "Sin fecha")}</p>
    </div>
    ${w.nombre ? `<div class="gym-form__field">
      <span class="gym-modal__label">Nombre</span>
      <p class="gym-modal__text">${escapeHtml(w.nombre)}</p>
    </div>` : ""}
    ${w.nota ? `<div class="gym-form__field">
      <span class="gym-modal__label">Nota</span>
      <p class="gym-modal__text">${escapeHtml(w.nota)}</p>
    </div>` : ""}
    <div class="gym-form__field">
      <span class="gym-modal__label">Ejercicios</span>
      ${ejercicios.length ? blocks : `<p class="gym-modal__text">Sin ejercicios.</p>`}
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-gym-wk-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-gym-wk-edit>✏️ Editar</button>
    </div>
  </div>`;
}

function bindWorkoutDetailHandlers(content, workout) {
  content.querySelector("[data-gym-wk-edit]")?.addEventListener("click", () => {
    if (!workout) return;
    // El borrador de edición parte de los datos guardados (kg
    // canónicos; la conversión ocurre en el render de los inputs).
    workoutDraft = {
      fechaISO: workout.fechaISO || ctx.todayISO(),
      nombre: workout.nombre || "",
      nota: workout.nota || "",
      ejercicios: (workout.ejercicios || []).map((ex) => ({
        ejercicioId: ex.ejercicioId || null,
        nombre: ex.nombre || "",
        series: (ex.series || []).map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })),
      })),
    };
    workoutModalMode = "edit";
    renderWorkoutEditor();
  });

  content.querySelector("[data-gym-wk-delete]")?.addEventListener("click", async () => {
    if (!workout) return;
    if (!confirm(`¿Eliminar el entreno «${workout.nombre || ctx.formatDateEs(workout.fechaISO) || "sin fecha"}»?`)) return;
    try {
      await ctx.deleteGymWorkout(currentUser, workout.id);
      closeWorkoutModal();
      showToast("Entreno eliminado.");
    } catch (err) {
      console.error("No se pudo eliminar el entreno:", err);
      showToast("No se pudo eliminar el entreno.");
    }
  });
}

// Render del editor (alta o edición): se repinta completo a partir
// de workoutDraft en cada cambio del constructor (añadir/quitar
// serie o ejercicio).
function renderWorkoutEditor() {
  const modal = document.getElementById("gym-workout-modal");
  const content = document.getElementById("gym-workout-modal-content");
  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    workoutModalMode === "edit" ? "Editar entreno" : "Nuevo entreno"
  );
  content.innerHTML = renderWorkoutEditorHtml();
  bindWorkoutEditorHandlers(content);
}

function renderWorkoutEditorHtml() {
  const d = workoutDraft;
  const exercisesHtml = d.ejercicios.map((ex, i) => workoutExerciseBlockHtml(ex, i)).join("");
  const hint = !exercises.length
    ? `<p class="gym-empty-hint">Añade ejercicios de tu catálogo para registrar pesos y repeticiones.</p>`
    : "";
  const emptyCatalogHint = !exercises.length
    ? `<button type="button" class="btn btn--small" data-gym-open-catalog>Ver catálogo de ejercicios</button>`
    : "";

  return `<form id="gym-workout-form" class="gym-modal__form">
    <h3 class="gym-modal__title">${workoutModalMode === "edit" ? "Editar entreno" : "Nuevo entreno"}</h3>
    <div class="gym-form__field">
      <label for="gym-wk-fecha">Fecha *</label>
      <input type="date" id="gym-wk-fecha" required value="${escapeHtml(d.fechaISO)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-wk-nombre">Nombre</label>
      <input type="text" id="gym-wk-nombre" maxlength="200" autocomplete="off" placeholder="P. ej. Push day"
             value="${escapeHtml(d.nombre)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-wk-nota">Nota</label>
      <textarea id="gym-wk-nota" rows="3" placeholder="Cómo fue el entreno, sensaciones, progreso…">${escapeHtml(d.nota)}</textarea>
    </div>
    <div class="gym-form__field">
      <label>Ejercicios</label>
      ${hint}
      ${exercisesHtml}
      ${emptyCatalogHint}
      <div class="gym-block-button-row">
        <button type="button" class="btn btn--small" data-gym-add-exercise>+ Añadir ejercicio</button>
        <button type="button" class="btn btn--small" data-gym-new-exercise>Nuevo ejercicio</button>
      </div>
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small" data-gym-wk-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

// Bloque de un ejercicio del constructor: select del catálogo (con la
// opción «Otro…» para escribir un nombre libre, ejercicioId null),
// filas de serie (peso en la unidad activa + reps) y botones de
// quitar serie/ejercicio.
function workoutExerciseBlockHtml(ex, i) {
  const options = exercises.map((e) =>
    `<option value="${escapeHtml(e.id)}"${e.id === ex.ejercicioId ? " selected" : ""}>${escapeHtml(e.nombre)}</option>`
  ).join("");
  const customSelected = ex.ejercicioId === null;
  const customNameInput = customSelected
    ? `<input type="text" class="gym-custom-name" maxlength="200" autocomplete="off"
         placeholder="Nombre del ejercicio" aria-label="Nombre del ejercicio"
         value="${escapeHtml(ex.nombre)}" />`
    : "";
  const seriesRows = ex.series.map((s, si) => workoutSeriesRowHtml(i, si, s)).join("");

  return `<div class="gym-exercise-block" data-gym-ex-idx="${i}">
    <div class="gym-exercise-block__header">
      <select data-gym-ex-select aria-label="Ejercicio ${i + 1}">
        <option value="">Elige un ejercicio…</option>
        ${options}
        <option value="__custom__"${customSelected ? " selected" : ""}>Otro (escribir nombre)…</option>
      </select>
      <button type="button" class="gym-remove-btn" data-gym-ex-remove="${i}" aria-label="Quitar ejercicio ${i + 1}">✕</button>
    </div>
    ${customNameInput}
    <div class="gym-series-table">${seriesRows}</div>
    <button type="button" class="gym-add-series-btn" data-gym-add-series="${i}">+ Añadir serie</button>
  </div>`;
}

// Fila de serie de un ejercicio del constructor: peso (unidad activa,
// paso 0.5 y inputmode decimal para teclado numérico) + reps (mínimo
// 1) + botón de quitar. Valor en la unidad de presentación.
function workoutSeriesRowHtml(exIdx, si, s) {
  const peso = s.pesoKg ? kgToDisplay(s.pesoKg) : "";
  return `<div class="gym-series-row">
    <input type="number" data-gym-series-peso="${exIdx}-${si}" step="0.5" min="0" inputmode="decimal"
           placeholder="${escapeHtml(unitLabel())}" aria-label="Peso de la serie ${si + 1} del ejercicio ${exIdx + 1} (${escapeHtml(unitLabel())})"
           value="${escapeHtml(String(peso))}" />
    <input type="number" data-gym-series-reps="${exIdx}-${si}" min="1" step="1" inputmode="numeric"
           placeholder="reps" aria-label="Repeticiones de la serie ${si + 1} del ejercicio ${exIdx + 1}"
           value="${s.reps ? escapeHtml(String(s.reps)) : ""}" />
    <button type="button" class="gym-remove-btn" data-gym-series-remove="${exIdx}-${si}" aria-label="Quitar serie ${si + 1}">✕</button>
  </div>`;
}

// Lectura del formulario hacia el borrador (peso convertido a kg).
// Se ejecuta antes de cada mutación del constructor y al guardar.
function syncWorkoutDraftFromDom() {
  const form = document.getElementById("gym-workout-form");
  if (!form) return;
  workoutDraft.fechaISO = form.querySelector("#gym-wk-fecha").value;
  workoutDraft.nombre = form.querySelector("#gym-wk-nombre").value;
  workoutDraft.nota = form.querySelector("#gym-wk-nota").value;
  workoutDraft.ejercicios = Array.from(form.querySelectorAll(".gym-exercise-block")).map((block, idx) => {
    const select = block.querySelector("[data-gym-ex-select]");
    const customName = block.querySelector(".gym-custom-name");
    const ejercicioId = select.value === "__custom__" ? null : select.value || null;
    // Si el ejercicio se borró del catálogo tras guardarse el entreno,
    // el select ya no tiene su opción: se conserva el nombre snapshot
    // del borrador (los entrenos guardados conservan su nombre).
    const found = exercises.find((e) => e.id === select.value);
    const nombre = select.value === "__custom__"
      ? customName.value.trim()
      : (found?.nombre ?? workoutDraft.ejercicios[idx]?.nombre ?? "");
    const series = Array.from(block.querySelectorAll(".gym-series-row")).map((row) => ({
      pesoKg: displayToKg(parseFloat(row.querySelector("[data-gym-series-peso]").value) || 0),
      reps: parseInt(row.querySelector("[data-gym-series-reps]").value, 10) || 0,
    }));
    return { ejercicioId, nombre, series };
  });
}

function bindWorkoutEditorHandlers(content) {
  // Selección de ejercicio del catálogo («Otro…» revela el input de
  // nombre libre). Se sincroniza el borrador y se alterna el input en
  // sitio (sin re-render, para no perder el foco del select).
  content.querySelectorAll("[data-gym-ex-select]").forEach((select) => {
    select.addEventListener("change", () => {
      syncWorkoutDraftFromDom();
      const block = select.closest(".gym-exercise-block");
      const customInput = block.querySelector(".gym-custom-name");
      if (select.value === "__custom__") {
        if (!customInput) {
          const input = document.createElement("input");
          input.type = "text";
          input.className = "gym-custom-name";
          input.maxLength = 200;
          input.autocomplete = "off";
          input.placeholder = "Nombre del ejercicio";
          input.setAttribute("aria-label", "Nombre del ejercicio");
          select.closest(".gym-exercise-block__header").insertAdjacentElement("afterend", input);
          input.focus();
        }
      } else if (customInput) {
        customInput.remove();
      }
    });
  });

  // Añadir serie: guarda lo escrito en el borrador y re-renderiza.
  content.querySelectorAll("[data-gym-add-series]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymAddSeries, 10);
      workoutDraft.ejercicios[idx].series.push({ pesoKg: 0, reps: 0 });
      renderWorkoutEditor();
      const row = document.querySelector(`[data-gym-series-peso="${idx}-${workoutDraft.ejercicios[idx].series.length - 1}"]`);
      row?.focus();
    });
  });

  // Quitar serie: idem, sin la fila.
  content.querySelectorAll("[data-gym-series-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const [exIdx, si] = btn.dataset.gymSeriesRemove.split("-").map(Number);
      workoutDraft.ejercicios[exIdx].series.splice(si, 1);
      renderWorkoutEditor();
      const block = document.querySelector(`[data-gym-ex-idx="${exIdx}"]`);
      block?.querySelector(".gym-add-series-btn")?.focus();
    });
  });

  // Quitar ejercicio del constructor.
  content.querySelectorAll("[data-gym-ex-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymExRemove, 10);
      workoutDraft.ejercicios.splice(idx, 1);
      renderWorkoutEditor();
      const addBtn = document.querySelector("[data-gym-add-exercise]");
      addBtn?.focus();
    });
  });

  // Añadir ejercicio vacío al constructor.
  content.querySelector("[data-gym-add-exercise]")?.addEventListener("click", () => {
    syncWorkoutDraftFromDom();
    workoutDraft.ejercicios.push({ ejercicioId: "", nombre: "", series: [] });
    renderWorkoutEditor();
    const block = document.querySelector(".gym-exercise-block:last-of-type");
    block?.querySelector("[data-gym-ex-select]")?.focus();
  });

  // Nuevo ejercicio (#265): abre el mismo modal de alta que la pestaña
  // Ejercicios sin cerrar el del entreno (patrón de open-catalog).
  content.querySelector("[data-gym-new-exercise]")?.addEventListener("click", () => {
    openExerciseModal();
  });

  // Atajo al catálogo (hint cuando el catálogo está vacío y el
  // constructor no puede ofrecer opciones): abre el modal de alta de
  // ejercicio sin cerrar el del entreno (patrón de los modales de
  // recetas al abrir el catálogo de ingredientes).
  content.querySelector("[data-gym-open-catalog]")?.addEventListener("click", () => {
    openExerciseModal();
  });

  // Cancelar: vuelve a la lectura (si se está editando) o cierra.
  content.querySelector("[data-gym-wk-cancel]")?.addEventListener("click", () => {
    if (workoutModalMode === "edit" && editingWorkoutId) {
      workoutModalMode = "read";
      workoutDraft = null;
      const workout = workouts.find((w) => w.id === editingWorkoutId);
      if (workout) {
        openWorkoutModal(workout.id);
        return;
      }
    }
    closeWorkoutModal();
  });

  content.querySelector("#gym-workout-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncWorkoutDraftFromDom();
    // Guard del guardado (issue #62): solo valen las series con
    // reps ≥ 1; los ejercicios sin series válidas se descartan. Sin
    // ninguna serie válida no se puede guardar.
    const validExercises = workoutDraft.ejercicios
      .map((ex) => ({ ...ex, series: ex.series.filter((s) => s.reps > 0) }))
      .filter((ex) => ex.series.length > 0);
    if (!validExercises.length) {
      showToast("Añade al menos un ejercicio con una serie (reps ≥ 1).");
      return;
    }
    const payload = {
      fechaISO: workoutDraft.fechaISO,
      ...(workoutDraft.nombre.trim() && { nombre: workoutDraft.nombre.trim() }),
      ...(workoutDraft.nota.trim() && { nota: workoutDraft.nota.trim() }),
      ejercicios: validExercises,
    };
    try {
      if (workoutModalMode === "edit" && editingWorkoutId) {
        await ctx.updateGymWorkout(currentUser, editingWorkoutId, payload);
        showToast("Entreno actualizado.");
      } else {
        await ctx.addGymWorkout(currentUser, payload);
        showToast("Entreno guardado.");
      }
      closeWorkoutModal();
    } catch (err) {
      console.error("No se pudo guardar el entreno:", err);
      showToast("No se pudo guardar el entreno.");
    }
  });
}

// ---------- Modal de ejercicio ----------

// Abre el modal de ejercicio: con id = detalle en modo lectura (con
// Editar/Eliminar); sin id = alta.
function openExerciseModal(id) {
  const modal = document.getElementById("gym-exercise-modal");
  const content = document.getElementById("gym-exercise-modal-content");
  const exercise = id ? exercises.find((x) => x.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");

  if (exercise) {
    editingExerciseId = exercise.id;
    exerciseCardModalMode = "read";
  } else {
    editingExerciseId = null;
    exerciseCardModalMode = "new";
  }

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    exercise ? `Ejercicio: ${exercise.nombre}` : "Nuevo ejercicio"
  );

  content.innerHTML = exercise
    ? exerciseDetailHtml(exercise)
    : exerciseFormHtml(null);
  bindExerciseDetailHandlers(content, exercise);
  if (!exercise) bindExerciseFormHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  if (exerciseModalCleanup) exerciseModalCleanup();
  exerciseModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  if (!exercise) {
    requestAnimationFrame(() => {
      content.querySelector("#gym-ex-nombre")?.focus({ preventScroll: false });
    });
  }
}

function closeExerciseModal() {
  const modal = document.getElementById("gym-exercise-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  exerciseCardModalMode = null;
  editingExerciseId = null;
  if (exerciseModalCleanup) {
    exerciseModalCleanup();
    exerciseModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Vista de solo lectura del ejercicio: nombre, grupo muscular y
// notas; acciones Editar/Eliminar.
function exerciseDetailHtml(ex) {
  return `<div class="gym-modal__view">
    <h3 class="gym-modal__title">${escapeHtml(ex.nombre)}</h3>
    <div class="gym-form__field">
      <span class="gym-modal__label">Grupo muscular</span>
      ${ex.grupoMuscular
        ? `<span class="gym-muscle-chip" style="align-self:flex-start">${escapeHtml(groupLabel(ex.grupoMuscular))}</span>`
        : `<p class="gym-modal__text">Sin indicar</p>`}
    </div>
    <div class="gym-form__field">
      <span class="gym-modal__label">Notas</span>
      <p class="gym-modal__text">${ex.notas ? escapeHtml(ex.notas) : "Sin notas."}</p>
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-gym-ex-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-gym-ex-edit>✏️ Editar</button>
    </div>
  </div>`;
}

function bindExerciseDetailHandlers(content, exercise) {
  content.querySelector("[data-gym-ex-edit]")?.addEventListener("click", () => {
    if (!exercise) return;
    exerciseCardModalMode = "edit";
    renderExerciseForm(exercise);
  });

  content.querySelector("[data-gym-ex-delete]")?.addEventListener("click", async () => {
    if (!exercise) return;
    if (!confirm(`¿Eliminar el ejercicio «${exercise.nombre}» del catálogo?`)) return;
    try {
      await ctx.deleteGymExercise(currentUser, exercise.id);
      closeExerciseModal();
      // Los entrenos guardados conservan el nombre (snapshot, #62).
      showToast("Ejercicio eliminado (los entrenos guardados conservan su nombre).");
    } catch (err) {
      console.error("No se pudo eliminar el ejercicio:", err);
      showToast("No se pudo eliminar el ejercicio.");
    }
  });
}

// Render del formulario de ejercicio (alta o edición).
function renderExerciseForm(exercise) {
  const modal = document.getElementById("gym-exercise-modal");
  const content = document.getElementById("gym-exercise-modal-content");
  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    exercise ? "Editar ejercicio" : "Nuevo ejercicio"
  );
  content.innerHTML = exerciseFormHtml(exercise);
  bindExerciseFormHandlers(content);
  requestAnimationFrame(() => {
    content.querySelector("#gym-ex-nombre")?.focus({ preventScroll: false });
  });
}

function exerciseFormHtml(exercise) {
  const nombre = exercise?.nombre || "";
  const grupo = exercise?.grupoMuscular || "";
  const notas = exercise?.notas || "";
  const options = GYM_MUSCLE_GROUPS.map((g) =>
    `<option value="${escapeHtml(g.id)}"${g.id === grupo ? " selected" : ""}>${escapeHtml(g.label)}</option>`
  ).join("");
  return `<form id="gym-exercise-form" class="gym-modal__form">
    <h3 class="gym-modal__title">${exercise ? "Editar ejercicio" : "Nuevo ejercicio"}</h3>
    <div class="gym-form__field">
      <label for="gym-ex-nombre">Nombre *</label>
      <input type="text" id="gym-ex-nombre" required maxlength="200" autocomplete="off"
             placeholder="P. ej. press banca" value="${escapeHtml(nombre)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-ex-grupo">Grupo muscular</label>
      <select id="gym-ex-grupo" aria-label="Grupo muscular del ejercicio">
        <option value="">Sin categoría</option>
        ${options}
      </select>
    </div>
    <div class="gym-form__field">
      <label for="gym-ex-notas">Notas</label>
      <textarea id="gym-ex-notas" rows="3" placeholder="Técnica, anotaciones, variantes…">${escapeHtml(notas)}</textarea>
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small" data-gym-ex-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function bindExerciseFormHandlers(content) {
  content.querySelector("[data-gym-ex-cancel]")?.addEventListener("click", () => {
    if (exerciseCardModalMode === "edit" && editingExerciseId) {
      const exercise = exercises.find((x) => x.id === editingExerciseId);
      exerciseCardModalMode = "read";
      if (exercise) {
        openExerciseModal(exercise.id);
        return;
      }
    }
    closeExerciseModal();
  });

  content.querySelector("#gym-exercise-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = content.querySelector("#gym-ex-nombre").value.trim();
    if (!nombre) return;
    const grupo = content.querySelector("#gym-ex-grupo").value;
    const notas = content.querySelector("#gym-ex-notas").value.trim();
    const payload = {
      nombre,
      ...(grupo && { grupoMuscular: grupo }),
      ...(notas && { notas }),
    };
    try {
      if (exerciseCardModalMode === "edit" && editingExerciseId) {
        await ctx.updateGymExercise(currentUser, editingExerciseId, payload);
        showToast("Ejercicio actualizado.");
      } else {
        await ctx.addGymExercise(currentUser, payload);
        showToast("Ejercicio añadido al catálogo.");
      }
      closeExerciseModal();
    } catch (err) {
      console.error("No se pudo guardar el ejercicio:", err);
      showToast("No se pudo guardar el ejercicio.");
    }
  });
}