// =============================================================
// Sección de Gimnasio (issue #62) — pestañas «Resumen», «Entrenos»
// y «Ejercicios».
// La pestaña Resumen (issue #269) agrega los entrenos de un periodo
// elegido (semana/mes en curso o rango libre) en totales y desglose
// por ejercicio. Gestiona además el registro de entrenos (fecha,
// nombre, nota y ejercicios con series de peso × repeticiones) y el
// catálogo de ejercicios del usuario (users/{uid}/gym-workouts y
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
// El default es «resumen»: la primera pestaña de la sección (#269).
let currentTab = "resumen";

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

// Rango libre del resumen (issue #269, iteración 3): fechas YYYY-MM-DD
// elegidas en el calendario del recuadro único; null = límite abierto.
// Ya no hay dos inputs de fecha independientes: el primer click en el
// calendario fija «desde» y el segundo «hasta» (intercambiando si el
// segundo es anterior al primero). Iteración 4: el calendario NO se
// cierra al fijar solo el primer extremo — permanece abierto hasta
// que las dos fechas están elegidas (el cierre al completar el rango
// y el de fuera/Esc/«Listo» se mantienen).
let summaryRange = { from: null, to: null };
// Mes visible en el calendario del rango ({year, month 0-11}).
let summaryRangeMonth = null;
// El calendario está abierto (aria-expanded del trigger).
let summaryRangePopoverOpen = false;

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

  // Selector de periodo del resumen (issue #269): el click en un chip
  // sincroniza la UI (is-active/aria-pressed) y la visibilidad del
  // recuadro del rango libre (solo con la opción «Rango», iteración
  // del comentario de la issue), y si el periodo cambió se
  // re-renderiza el resumen (lee el periodo nuevo del DOM). Los chips
  // de semana/mes en curso no aplican al rango libre.
  document.querySelectorAll("[data-summary-period]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const previous = document.querySelector(".gym-summary-chip.is-active")?.dataset.summaryPeriod || null;
      syncSummaryPeriodUI(chip.dataset.summaryPeriod);
      if (previous !== chip.dataset.summaryPeriod) renderSummary();
    });
  });

  // Recuadro único del rango (iteración 3): el trigger abre/cierra el
  // calendario; dentro se eligen «desde» (primer click) y «hasta»
  // (segundo click) en el mismo control. Cierra con «Listo», con
  // Escape o al hacer click fuera del recuadro.
  //
  // Iteración 4: el click fuera NO debe cerrar el calendario cuando
  // se acaba de pulsar un día — el re-render de la rejilla que hace
  // onSummaryRangeDayClick() detacha el botón pulsado antes de que el
  // evento llegue a este handler (fase burbuja en document), y
  // e.target.closest("#gym-summary-range") fallaría sobre un nodo
  // descolgado, cerrando el calendario con solo «desde» elegido. La
  // marca en fase de CAPTURA (que corre antes del re-render) recuerda
  // que el click nació dentro del recuadro: el calendario permanece
  // abierto hasta que las dos fechas están elegidas (el cierre al
  // completar el rango lo hace onSummaryRangeDayClick(), y Esc /
  // «Listo» / click fuera real siguen cerrando igual).
  document.getElementById("gym-summary-range")?.addEventListener("click", (e) => {
    e.__summaryRangeInside = true;
  }, true);
  const rangeTrigger = document.getElementById("gym-summary-range-trigger");
  rangeTrigger?.addEventListener("click", () => {
    if (summaryRangePopoverOpen) {
      closeSummaryRangePopover();
    } else {
      openSummaryRangePopover();
    }
  });
  document.getElementById("gym-summary-range-prev")?.addEventListener("click", () => {
    shiftSummaryRangeMonth(-1);
  });
  document.getElementById("gym-summary-range-next")?.addEventListener("click", () => {
    shiftSummaryRangeMonth(1);
  });
  document.getElementById("gym-summary-range-days")?.addEventListener("click", (e) => {
    const day = e.target.closest("[data-summary-range-day]");
    if (!day) return;
    onSummaryRangeDayClick(day.dataset.summaryRangeDay);
  });
  document.getElementById("gym-summary-range-clear")?.addEventListener("click", () => {
    // Borrar el rango deja ambos extremos sin límite y el calendario
    // abierto para volver a elegir.
    summaryRange = { from: null, to: null };
    renderSummaryRangeCalendar();
    updateSummaryRangeSummary();
    renderSummary();
  });
  document.getElementById("gym-summary-range-done")?.addEventListener("click", closeSummaryRangePopover);
  document.addEventListener("click", (e) => {
    if (summaryRangePopoverOpen && !e.__summaryRangeInside && !e.target.closest(".gym-summary-chip")) {
      closeSummaryRangePopover();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && summaryRangePopoverOpen) closeSummaryRangePopover();
  });

  // Selector de unidad de peso (issue #62): se persiste con setUnit
  // (localStorage + sync a Firestore) y se re-renderiza la pestaña
  // activa (Resumen incluida, #269) y el modal de entreno abierto,
  // si lo hay.
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
    // El resumen (issue #269) vive de los entrenos: se re-renderiza
    // en tiempo real al alta/edición/eliminación.
    if (currentTab === "resumen") renderSummary();
    if (onChange) onChange();
  }, onError));

  subs.push(ctx.subscribeToGymExercises(uid, (items) => {
    exercises = items;
    if (currentTab === "ejercicios") renderCatalog();
    // El resumen (issue #269) usa el catálogo para resolver el grupo
    // muscular y el nombre canónico de los ejercicios: si llega un
    // snapshot nuevo con la pestaña a la vista, se repinta.
    if (currentTab === "resumen") renderSummary();
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
// los datos del usuario anterior no se muestren al siguiente),
// incluido el rango libre del resumen y el calendario (iteración 3).
export function resetGymData() {
  workouts = [];
  exercises = [];
  currentTab = "resumen";
  editingWorkoutId = null;
  workoutDraft = null;
  editingExerciseId = null;
  summaryRange = { from: null, to: null };
  summaryRangeMonth = null;
  summaryWeekdayLabels = null;
  const rangeBox = document.getElementById("gym-summary-range");
  if (rangeBox) rangeBox.hidden = true;
  summaryRangePopoverOpen = false;
  const popover = document.getElementById("gym-summary-range-popover");
  if (popover) popover.hidden = true;
  document.getElementById("gym-summary-range-trigger")?.setAttribute("aria-expanded", "false");
  closeWorkoutModal();
  closeExerciseModal();
}

// ---------- Apertura / cierre de la vista ----------

export function openGym({ tab = "resumen", fromRouter = false } = {}) {
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
    resumen: "panel-gym-summary-tab",
    entrenos: "panel-gym-workouts-tab",
    ejercicios: "panel-gym-exercises-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  // Dispatch de render por pestaña (#269): el resumen entra como una
  // pestaña más, sin if/else encadenados.
  const renderers = { resumen: renderSummary, entrenos: renderWorkouts, ejercicios: renderCatalog };
  renderers[tab]?.();
}

// ---------- Unidad de peso: re-render global (issue #62) ----------

// Tras cambiar el select de unidad se repinta todo lo que muestra
// pesos: la pestaña activa y, si el modal de entreno está abierto,
// su vista (lectura o edición, desde el borrador en memoria).
function renderAllWithUnit() {
  // Dispatch de render por pestaña (#269): el resumen se repinta por
  // uniformidad y porque desde las iteraciones 3/4 muestra pesos (la
  // columna Diferencia) convertidos una sola vez al pintar: al
  // cambiar la unidad debe repintarse con la conversión nueva.
  const renderers = { resumen: renderSummary, entrenos: renderWorkouts, ejercicios: renderCatalog };
  renderers[currentTab]?.();
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

// ---------- Pestaña Resumen (issue #269) ----------

// Rango de fechas (fechaISO YYYY-MM-DD) del periodo activo, leído
// del DOM (chip .gym-summary-chip.is-active) y del estado del rango
// libre elegido en el calendario del recuadro único (#269), con el
// patrón UTC de ctx.todayISO():
//   - week: lunes de la semana en curso → hoy.
//   - month: primer día del mes en curso → hoy.
//   - custom: summaryRange.from/summaryRange.to, inclusivo.
//     Un extremo vacío es un límite abierto (null); si from > to se
//     intercambian (el calendario ya lo evita al elegir, defensivo).
function summaryPeriodRange() {
  const today = ctx.todayISO();
  const active = document.querySelector(".gym-summary-chip.is-active")?.dataset.summaryPeriod || "week";
  if (active === "month") {
    return { period: "month", custom: false, from: today.slice(0, 8) + "01", to: today };
  }
  if (active === "custom") {
    let { from, to } = summaryRange;
    if (from && to && from > to) [from, to] = [to, from];
    return { period: "custom", custom: true, from, to };
  }
  // Semana en curso: el lunes es hoy − ((getUTCDay() + 6) % 7) días
  // (domingo = 0 → offset 6; lunes = 1 → offset 0).
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { period: "week", custom: false, from: monday.toISOString().slice(0, 10), to: today };
}

// Clave de agrupación de una entrada de ejercicio de un entreno: el
// id canónico si existe y sigue en el catálogo; si no (ejercicio
// borrado del catálogo o datos legacy sin id) se agrupa por el
// nombre snapshot normalizado.
function summaryExerciseKey(e) {
  if (e?.ejercicioId && exercises.some((x) => x.id === e.ejercicioId)) {
    return e.ejercicioId;
  }
  return String(e?.nombre || "").trim().toLowerCase();
}

// Grupo muscular de una entrada de entreno: el guardado en la propia
// entrada si lo tiene; si no, el del catálogo (por ejercicioId o,
// para legacy sin id, por nombre normalizado).
function summaryGroupFor(e) {
  if (e?.grupoMuscular) return e.grupoMuscular;
  const byId = e?.ejercicioId && exercises.find((x) => x.id === e.ejercicioId);
  if (byId?.grupoMuscular) return byId.grupoMuscular;
  const norm = String(e?.nombre || "").trim().toLowerCase();
  if (!norm) return null;
  const byName = exercises.find((x) => String(x.nombre || "").trim().toLowerCase() === norm);
  return byName?.grupoMuscular || null;
}

// Agrega los entrenos del rango [from, to] (fechas YYYY-MM-DD,
// comparación lexicográfica; from/to null = límite abierto) en:
//   - totals { entrenos, ejercicios } del periodo (nº de entrenos y
//     nº de ejercicios distintos).
//   - perExercise: Map clave → { nombre, grupoMuscular, veces,
//     pesoAntiguo, pesoNuevo } con veces = nº de entrenos distintos
//     en que aparece y el peso más ANTIGUO y el más NUEVO registrados
//     en el periodo (kg canónicos; las series sin peso —null o ≤ 0—
//     no cuentan).
//   - perGroup: Map grupo → { label, ejercicios, entrenos } con el nº
//     de ejercicios distintos y de entrenos de cada grupo muscular.
// Iteraciones de los comentarios del usuario en la issue: los
// sumatorios de series, repeticiones y volumen se eliminan — el
// resumen se centra en lo que pide: nº de entrenos, ejercicios
// totales, desglose por grupos musculares y, desde la iteración 4, la
// DIFERENCIA de peso por ejercicio (el peso más antiguo del periodo
// frente al más nuevo, con signo: positivo si aumentó, negativo si
// bajó). Una entrada sin id ni nombre no agrupa ni cuenta (no hay
// ejercicio al que atribuirla); sin grupo muscular solo cuenta en los
// totales, no en el desglose por grupos.
function summarizeWorkouts(workoutsList, from, to) {
  const totals = { entrenos: 0, ejercicios: 0 };
  const perExercise = new Map();
  const perGroup = new Map();
  const seenWorkouts = new Map(); // clave de ejercicio → Set de ids de entreno

  // workoutsList llega ordenado desc por fechaISO (suscripción de
  // db.js, ADR-095): el PRIMER entreno procesado es el más NUEVO y el
  // ÚLTIMO el más ANTIGUO. Ese orden define los extremos cronológicos
  // de la iteración 4 (el peso más antiguo y el más nuevo), no los
  // mínimos/máximos de la iteración 3.
  for (const w of workoutsList) {
    if (from && w.fechaISO < from) continue;
    if (to && w.fechaISO > to) continue;
    totals.entrenos += 1;
    for (const e of w.ejercicios || []) {
      const key = summaryExerciseKey(e);
      // Entrada sin id ni nombre: no agrupa ni cuenta (no hay
      // ejercicio al que atribuirla).
      if (!key) continue;
      let agg = perExercise.get(key);
      if (!agg) {
        const catalogEx = e.ejercicioId ? exercises.find((x) => x.id === e.ejercicioId) : null;
        agg = {
          nombre: catalogEx?.nombre || e.nombre || "",
          grupoMuscular: summaryGroupFor(e),
          veces: 0,
          pesoAntiguo: null,
          pesoNuevo: null,
        };
        perExercise.set(key, agg);
      }
      if (!seenWorkouts.has(key)) seenWorkouts.set(key, new Set());
      seenWorkouts.get(key).add(w.id);
      // Extremos cronológicos de peso del periodo (kg canónicos,
      // iteración 4): una serie sin peso registrado (null o ≤ 0,
      // p. ej. peso corporal) no puede ser extremo. Dentro de un
      // entreno, el peso más antiguo es la primera serie con peso y
      // el más nuevo la última. Entre entrenos (lista desc), la
      // primera vez que se ve el ejercicio fija su peso más NUEVO (el
      // entreno más reciente del periodo) y cada entreno posterior
      // sobrescribe el peso más ANTIGUO hasta quedarse con el del
      // entreno más remoto del periodo.
      let serieAntigua = null;
      let serieNueva = null;
      for (const s of e.series || []) {
        const kg = s?.pesoKg;
        if (kg == null || kg <= 0) continue;
        if (serieAntigua == null) serieAntigua = kg;
        serieNueva = kg;
      }
      if (serieNueva != null) {
        if (agg.pesoNuevo == null) agg.pesoNuevo = serieNueva;
        agg.pesoAntiguo = serieAntigua;
      }
      const group = agg.grupoMuscular;
      if (!group) continue;
      let gagg = perGroup.get(group);
      if (!gagg) {
        gagg = { label: groupLabel(group), ejercicios: 0, entrenos: 0, keys: new Set(), workouts: new Set() };
        perGroup.set(group, gagg);
      }
      gagg.keys.add(key);
      gagg.workouts.add(w.id);
    }
  }
  // Veces = nº de entrenos distintos en que aparece el ejercicio;
  // ejercicios totales = nº de ejercicios distintos del periodo.
  totals.ejercicios = perExercise.size;
  for (const [key, agg] of perExercise) {
    agg.veces = seenWorkouts.get(key)?.size || 0;
  }
  for (const gagg of perGroup.values()) {
    gagg.ejercicios = gagg.keys.size;
    gagg.entrenos = gagg.workouts.size;
  }
  return { totals, perExercise, perGroup };
}

// Pinta el resumen del periodo activo en #gym-summary-data: cabecera
// con el rango, tarjetas (entrenos y ejercicios totales) y dos
// desgloses — por grupos musculares y por ejercicio — ordenados por
// frecuencia desc, tie-break alfabético (iteración del comentario de
// la issue: sin sumatorios de series/reps/volumen).
function renderSummary() {
  const container = document.getElementById("gym-summary-data");
  if (!container) return;
  const { from, to } = summaryPeriodRange();

  if (!workouts.length) {
    container.innerHTML = `<p class="empty-state">Aún no has registrado entrenos. Registra entrenos en la pestaña «Entrenos» para ver aquí tu resumen.</p>`;
    return;
  }

  const { totals, perExercise, perGroup } = summarizeWorkouts(workouts, from, to);

  if (!totals.entrenos) {
    container.innerHTML = `<p class="empty-state">No hay entrenos en este periodo. Registra entrenos en la pestaña «Entrenos» para ver aquí tu resumen.</p>`;
    return;
  }

  const fmtDate = (iso) => (iso ? ctx.formatDateEs(iso) : "sin límite");

  const cards = `
    <div class="gym-summary-grid">
      <div class="gym-summary-card">
        <span class="gym-summary-card__label">Entrenos</span>
        <span class="gym-summary-card__value">${totals.entrenos}</span>
      </div>
      <div class="gym-summary-card">
        <span class="gym-summary-card__label">Ejercicios</span>
        <span class="gym-summary-card__value">${totals.ejercicios}</span>
      </div>
    </div>`;

  const groupRows = [...perGroup.values()]
    .sort((a, b) => b.ejercicios - a.ejercicios || a.label.localeCompare(b.label, "es"))
    .map((g) => `
      <tr>
        <td>${escapeHtml(g.label)}</td>
        <td>${g.ejercicios}</td>
        <td>${g.entrenos}</td>
      </tr>`)
    .join("");

  const groupsTable = groupRows.length
    ? `<h3 class="gym-summary-section-title">Por grupos musculares</h3>
        <div class="gym-summary-table-wrap">
          <table class="gym-summary-table">
            <thead>
              <tr>
                <th>Grupo muscular</th>
                <th>Ejercicios</th>
                <th>Entrenos</th>
              </tr>
            </thead>
            <tbody>${groupRows}</tbody>
          </table>
        </div>`
    : "";

  // Iteración 4: cada ejercicio muestra SOLO la diferencia de peso del
  // periodo — el peso más nuevo frente al más antiguo, con signo
  // (positivo si aumentó, negativo si bajó) — en la unidad de
  // presentación activa; «—» si no hay ninguna serie con peso en el
  // periodo (todo sin peso registrado). Los extremos mín/máx de la
  // iteración 3 se eliminan: el usuario quiere ver únicamente el
  // cambio entre el peso más antiguo y el más nuevo.
  const unitHeader = escapeHtml(unitLabel());
  // Formatea la diferencia con signo explícito (+ para aumento, −
  // para disminución; 0 sin signo). Se calcula en kg canónicos y se
  // convierte una sola vez al pintar (mismo patrón de la iteración 3).
  const fmtDiff = (kg) => {
    if (kg == null) return "—";
    const d = kgToDisplay(kg);
    return escapeHtml(d > 0 ? `+${d}` : String(d));
  };
  // Iteración 5: la diferencia se pinta con color semántico — verde si
  // aumentó, rojo si bajó — y SIN clase cuando es cero (hereda el
  // color normal de la celda, «blanco como ahora»). El matiz lo
  // aplica css/styles.css con variantes AA por familia de tema.
  const diffClass = (kg) =>
    kg == null || kg === 0 ? "" : `gym-summary-table__diff--${kg > 0 ? "up" : "down"}`;
  const rows = [...perExercise.values()]
    .sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre, "es"))
    .map((agg) => {
      // Diferencia = peso más nuevo − peso más antiguo del periodo
      // (kg canónicos); null si falta alguno de los dos extremos.
      const diffKg = agg.pesoAntiguo != null && agg.pesoNuevo != null ? agg.pesoNuevo - agg.pesoAntiguo : null;
      return `
      <tr>
        <td class="gym-summary-table__name">
          ${escapeHtml(agg.nombre)}
          ${agg.grupoMuscular ? `<span class="gym-muscle-chip">${escapeHtml(groupLabel(agg.grupoMuscular))}</span>` : ""}
        </td>
        <td>${agg.veces}</td>
        <td class="${diffClass(diffKg)}">${fmtDiff(diffKg)}</td>
      </tr>`;
    })
    .join("");

  const table = rows.length
    ? `<h3 class="gym-summary-section-title">Por ejercicio</h3>
        <div class="gym-summary-table-wrap">
          <table class="gym-summary-table">
            <thead>
              <tr>
                <th>Ejercicio</th>
                <th>Veces</th>
                <th>Diferencia (${unitHeader})</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
    : "";

  container.innerHTML = `
    <p class="gym-summary-period">Periodo: ${escapeHtml(fmtDate(from))} – ${escapeHtml(fmtDate(to))}</p>
    ${cards}
    ${groupsTable}
    ${table}`;
}

// Sincroniza la UI del selector de periodo: is-active/aria-pressed
// solo en el chip del periodo indicado (los otros quedan inactivos) y
// el recuadro del rango libre visible únicamente con la opción
// «Rango» (iteración del comentario de la issue). Al activar «Rango»
// el calendario nace abierto y con el rango ya elegido resumido en el
// trigger; al salir a semana/mes el calendario se cierra.
function syncSummaryPeriodUI(period) {
  document.querySelectorAll("[data-summary-period]").forEach((chip) => {
    const isActive = chip.dataset.summaryPeriod === period;
    chip.classList.toggle("is-active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
  const rangeBox = document.getElementById("gym-summary-range");
  if (rangeBox) {
    rangeBox.hidden = period !== "custom";
    if (period === "custom") {
      openSummaryRangePopover();
    } else {
      closeSummaryRangePopover();
    }
  }
}

// Texto del trigger del recuadro del rango libre
// (#gym-summary-range-summary): las fechas «desde – hasta» ya
// elegidas en el calendario (o «sin límite» si un extremo está
// vacío), en el mismo formato que la cabecera del periodo pintado.
function updateSummaryRangeSummary() {
  const summaryEl = document.getElementById("gym-summary-range-summary");
  if (!summaryEl) return;
  const { from, to } = summaryRange;
  const fmtDate = (iso) => (iso ? ctx.formatDateEs(iso) : "sin límite");
  summaryEl.textContent = `${fmtDate(from)} – ${fmtDate(to)}`;
}

// ---------- Calendario del rango libre (issue #269, iteración 3) ----------

// Mes inicial del calendario: el del extremo «desde» (o «hasta» si
// solo se eligió ese) si hay rango; si no, el mes en curso.
function summaryRangeCalMonth() {
  const anchor = summaryRange.from || summaryRange.to;
  if (anchor) {
    const [y, m] = anchor.split("-").map(Number);
    return { year: y, month: m - 1 };
  }
  const [y, m] = ctx.todayISO().split("-").map(Number);
  return { year: y, month: m - 1 };
}

// Cabeceras de la semana (lunes primero) en el idioma de la
// interfaz (es-ES): "L M X J V S D". Se calculan una vez y se
// recuerdan (fallback explícito si el entorno no las produce).
let summaryWeekdayLabels = null;
function summaryWeekdayLabelsFn() {
  if (summaryWeekdayLabels) return summaryWeekdayLabels;
  const fallback = ["L", "M", "X", "J", "V", "S", "D"];
  summaryWeekdayLabels = Array.from({ length: 7 }, (_, i) => {
    // 2024-01-01 fue lunes: los 7 primeros días de enero de 2024
    // cubren la semana completa en orden.
    const label = new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString("es-ES", {
      weekday: "narrow",
      timeZone: "UTC",
    });
    return label || fallback[i];
  });
  return summaryWeekdayLabels;
}

// Título del mes del calendario ("Agosto de 2026", es-ES).
function summaryRangeMonthLabel(year, month) {
  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : `${year}`;
}

// Grid del mes en curso: 42 celdas (6 filas × 7 columnas, lunes
// primero). Las celdas fuera del mes son null (vacías) para que la
// rejilla no salte de altura al navegar entre meses.
function summaryRangeDayGrid(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (firstWeekday + 6) % 7; // lunes primero (domingo = 0 → 6)
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

// Primer click (sin rango o con rango completo): empieza un rango
// nuevo en ese día. Segundo click (con «desde» elegido y «hasta»
// vacío): cierra el rango, intercambiando los extremos si el click
// es anterior al «desde»; al completarse el calendario se cierra.
function onSummaryRangeDayClick(iso) {
  if (!summaryRange.from || (summaryRange.from && summaryRange.to)) {
    summaryRange = { from: iso, to: null };
  } else {
    let { from, to } = summaryRange;
    if (iso < from) {
      to = from;
      from = iso;
    } else {
      to = iso;
    }
    summaryRange = { from, to };
  }
  const completed = summaryRange.from && summaryRange.to;
  renderSummaryRangeCalendar();
  updateSummaryRangeSummary();
  renderSummary();
  if (completed) closeSummaryRangePopover();
}

// Pinta el mes visible en el calendario del recuadro: cabecera con el
// mes y la navegación, fila de días de la semana y rejilla de días
// con los estados (hoy, extremos del rango, días intermedios).
function renderSummaryRangeCalendar() {
  const grid = document.getElementById("gym-summary-range-days");
  if (!grid) return;
  const monthEl = document.getElementById("gym-summary-range-month");
  const weekdaysEl = document.getElementById("gym-summary-range-weekdays");
  const cal = summaryRangeMonth;
  if (monthEl) monthEl.textContent = summaryRangeMonthLabel(cal.year, cal.month);
  if (weekdaysEl) {
    weekdaysEl.innerHTML = summaryWeekdayLabelsFn()
      .map((l) => `<span class="gym-summary-range__cal-weekday">${l}</span>`)
      .join("");
  }
  const today = ctx.todayISO();
  const { from, to } = summaryRange;
  grid.innerHTML = summaryRangeDayGrid(cal.year, cal.month).map((iso) => {
    if (!iso) return `<span class="gym-summary-range__cal-blank" aria-hidden="true"></span>`;
    const selected = iso === from || iso === to;
    const inRange = !selected && from && to && iso > from && iso < to;
    const classes = [
      "gym-summary-range__day",
      iso === today ? "gym-summary-range__day--today" : "",
      selected ? "gym-summary-range__day--selected" : "",
      inRange ? "gym-summary-range__day--in-range" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-summary-range-day="${iso}"
      aria-label="${escapeHtml(ctx.formatDateEs(iso))}" aria-pressed="${selected ? "true" : "false"}">${Number(iso.slice(8))}</button>`;
  }).join("");
}

// Abre el calendario: recuerda el mes del rango elegido (o el mes en
// curso), repinta y deja el foco en el extremo «desde» (o en hoy si
// el rango está vacío) para poder navegar también con teclado.
function openSummaryRangePopover() {
  const popover = document.getElementById("gym-summary-range-popover");
  const trigger = document.getElementById("gym-summary-range-trigger");
  if (!popover || !trigger || !popover.hidden) return;
  summaryRangeMonth = summaryRangeCalMonth();
  renderSummaryRangeCalendar();
  updateSummaryRangeSummary();
  popover.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  summaryRangePopoverOpen = true;
  const focusDay = summaryRange.from
    ? document.querySelector(`[data-summary-range-day="${summaryRange.from}"]`)
    : document.querySelector(".gym-summary-range__day--today");
  (focusDay || trigger).focus({ preventScroll: false });
}

function closeSummaryRangePopover() {
  const popover = document.getElementById("gym-summary-range-popover");
  const trigger = document.getElementById("gym-summary-range-trigger");
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
  summaryRangePopoverOpen = false;
  // Retorno de foco al trigger (a11y): salvo cuando el recuadro queda
  // oculto justo después (cambio de chip a semana/mes en curso), caso
  // en el que enfocar un elemento oculto perdería el foco a body.
  const rangeBox = document.getElementById("gym-summary-range");
  if (trigger && rangeBox && !rangeBox.hidden) {
    trigger.focus({ preventScroll: false });
  }
}

// Navega el calendario un mes (delta ±1); el mes visible se
// recomputa con aritmética modular sobre (year, month 0-11).
function shiftSummaryRangeMonth(delta) {
  const cal = summaryRangeMonth;
  const m = cal.month + delta;
  const year = cal.year + Math.floor(m / 12);
  summaryRangeMonth = { year, month: ((m % 12) + 12) % 12 };
  renderSummaryRangeCalendar();
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

// Última ocurrencia de un ejercicio (#265, #270): recorre workouts (ya
// ordenados por fechaISO desc desde db.js) y devuelve la ocurrencia
// más reciente con series como {fechaISO, series} — copia {pesoKg,
// reps} — o null. Match canónico por ejercicioId con prioridad
// estricta; solo si no hay ninguna entrada canónica se usa el fallback
// por nombre snapshot normalizado (legacy sin id).
function lastWorkoutForExercise(exerciseId, nombre) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const nameNorm = norm(nombre);
  let legacy = null; // { w, ex } de la primera entrada legacy con series
  for (const w of workouts) {
    for (const ex of w.ejercicios || []) {
      if (!(ex.series || []).length) continue;
      if (exerciseId && ex.ejercicioId === exerciseId) {
        return { fechaISO: w.fechaISO, series: ex.series.map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })) };
      }
      if (legacy === null && !ex.ejercicioId && nameNorm && norm(ex.nombre) === nameNorm) {
        legacy = { w, ex };
      }
    }
  }
  return legacy
    ? { fechaISO: legacy.w.fechaISO, series: legacy.ex.series.map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })) }
    : null;
}

// Pre-relleno (#265): solo si el bloque aún no tiene series (no pisa
// lo ya escrito ni lo traído de un entreno en edición). Re-renderiza
// y devuelve el foco al select (patrón de «Añadir serie»).
function maybePrefillSeriesFromLastWorkout(select) {
  if (!workoutDraft) return;
  const block = select.closest(".gym-exercise-block");
  if (!block) return;
  const idx = parseInt(block.dataset.gymExIdx, 10);
  const entry = workoutDraft.ejercicios[idx];
  const exerciseId = select.value || null;
  if (!exerciseId || !entry || entry.series.length) return;
  const prev = lastWorkoutForExercise(exerciseId, entry.nombre);
  if (!prev) return;
  workoutDraft.ejercicios[idx].series = prev.series;
  renderWorkoutEditor();
  document.querySelector(`[data-gym-ex-idx="${idx}"]`)
    ?.querySelector("[data-gym-ex-select]")?.focus();
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
      <label for="gym-wk-unit">Unidad de peso</label>
      <select id="gym-wk-unit" aria-label="Unidad de peso del entreno">
        <option value="kg"${unit() === "kg" ? " selected" : ""}>kg</option>
        <option value="lbs"${unit() === "lbs" ? " selected" : ""}>lbs</option>
      </select>
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

// Bloque de un ejercicio del constructor: select del catálogo (con
// placeholder del nombre snapshot en los datos antiguos sin id),
// filas de serie (peso en la unidad activa + reps) y botones de
// quitar serie/ejercicio.
function workoutExerciseBlockHtml(ex, i) {
  const options = exercises.map((e) =>
    `<option value="${escapeHtml(e.id)}"${e.id === ex.ejercicioId ? " selected" : ""}>${escapeHtml(e.nombre)}</option>`
  ).join("");
  // Datos antiguos (legacy «Otro…»): sin id y con nombre snapshot; se
  // muestra el nombre como placeholder para no perder la referencia.
  const placeholderLabel = ex.ejercicioId === null && ex.nombre ? ex.nombre : "Elige un ejercicio…";
  const seriesRows = ex.series.map((s, si) => workoutSeriesRowHtml(i, si, s)).join("");
  // Cabecera de la tabla de series (etiquetas peso/reps, #265): misma
  // rejilla que las filas para que las columnas queden alineadas; la
  // tercera celda está vacía porque en las filas es el botón ✕.
  const seriesHead = `<div class="gym-series-row gym-series-row--head" aria-hidden="true">
    <span>Peso (${escapeHtml(unitLabel())})</span>
    <span>Repeticiones</span>
    <span></span>
  </div>`;

  return `<div class="gym-exercise-block" data-gym-ex-idx="${i}">
    <div class="gym-exercise-block__header">
      <select data-gym-ex-select aria-label="Ejercicio ${i + 1}">
        <option value="">${escapeHtml(placeholderLabel)}</option>
        ${options}
      </select>
      <button type="button" class="gym-remove-btn" data-gym-ex-remove="${i}" aria-label="Quitar ejercicio ${i + 1}">✕</button>
    </div>
    <div class="gym-series-table">${seriesHead}${seriesRows}</div>
    <div class="gym-block-button-row">
      <button type="button" class="gym-add-series-btn" data-gym-add-series="${i}">+ Añadir serie</button>
      <button type="button" class="gym-add-series-btn" data-gym-dup-series="${i}">Duplicar serie</button>
    </div>
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
    const ejercicioId = select.value || null;
    // Si el ejercicio se borró del catálogo tras guardarse el entreno,
    // el select ya no tiene su opción: se conserva el nombre snapshot
    // del borrador (los entrenos guardados conservan su nombre).
    const found = exercises.find((e) => e.id === select.value);
    const nombre = found?.nombre ?? workoutDraft.ejercicios[idx]?.nombre ?? "";
    // Las filas de serie son las .gym-series-row SIN la cabecera de
    // etiquetas (.gym-series-row--head, #265): la cabecera solo tiene
    // spans y no debe leerse como una fila de datos.
    const series = Array.from(block.querySelectorAll(".gym-series-row:not(.gym-series-row--head)")).map((row) => ({
      pesoKg: displayToKg(parseFloat(row.querySelector("[data-gym-series-peso]").value) || 0),
      reps: parseInt(row.querySelector("[data-gym-series-reps]").value, 10) || 0,
    }));
    return { ejercicioId, nombre, series };
  });
}

function bindWorkoutEditorHandlers(content) {
  // Selector de unidad de peso del modal (alta/edición, #265): misma
  // lógica y persistencia que el global #gym-unit-select, así que
  // solo se re-renderiza lo que muestra pesos (renderAllWithUnit
  // repinta pestaña, editor abierto y deja el select global en sync).
  content.querySelector("#gym-wk-unit")?.addEventListener("change", (e) => {
    // Guardar lo tecleado antes de re-renderizar: el re-render parte
    // del borrador (kg canónico) y convertiría y conservaría lo
    // escrito en lugar de perderlo.
    syncWorkoutDraftFromDom();
    setUnit(e.target.value);
    const globalSelect = document.getElementById("gym-unit-select");
    if (globalSelect) globalSelect.value = unit();
    renderAllWithUnit();
  });

  // Selección de ejercicio del catálogo: se sincroniza el borrador (el
  // nombre snapshot puede cambiar al pasar de un ejercicio a otro) y se
  // pre-rellenan las series con las de la última vez (#265).
  content.querySelectorAll("[data-gym-ex-select]").forEach((select) => {
    select.addEventListener("change", () => {
      syncWorkoutDraftFromDom();
      maybePrefillSeriesFromLastWorkout(select);
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

  // Duplicar serie (#265): copia la última serie del ejercicio (peso y
  // reps) al final, sin tener que reescribirla. Avisa si no hay ninguna.
  content.querySelectorAll("[data-gym-dup-series]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymDupSeries, 10);
      const series = workoutDraft.ejercicios[idx].series;
      if (!series.length) {
        showToast("No hay ninguna serie que duplicar.");
        return;
      }
      const last = series[series.length - 1];
      series.push({ pesoKg: last.pesoKg, reps: last.reps });
      renderWorkoutEditor();
      const row = document.querySelector(`[data-gym-series-peso="${idx}-${series.length - 1}"]`);
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

// Vista de solo lectura del ejercicio: nombre, grupo muscular, notas
// y sección «Última vez» (#270) con la fecha y las series del entreno
// más reciente donde se trabajó; acciones Editar/Eliminar.
function exerciseDetailHtml(ex) {
  const last = lastWorkoutForExercise(ex.id, ex.nombre);
  const lastSection = last
    ? `<div class="gym-form__field">
        <span class="gym-modal__label">Última vez</span>
        <p class="gym-modal__text">${escapeHtml(ctx.formatDateEs(last.fechaISO) || last.fechaISO || "")}</p>
        <div class="gym-series-table">
          ${last.series.map((s) => `
            <div class="gym-series-row">
              <span>${s.pesoKg != null ? escapeHtml(String(kgToDisplay(s.pesoKg))) : ""} ${escapeHtml(unitLabel())}</span>
              <span>${s.reps != null ? escapeHtml(String(s.reps)) : ""} reps</span>
              <span></span>
            </div>`).join("")}
        </div>
      </div>`
    : "";
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
    ${lastSection}
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