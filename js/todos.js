// =============================================================
// Sección de Cosas que hacer (issue #283) — pestañas «Tareas» y
// «Hechas».
// Lista de tareas con texto, categoría (presets: corto plazo, largo
// plazo, casa, personal, trabajo, otro), nota y fecha límite
// opcionales. La pestaña «Tareas» muestra las pendientes (por fecha
// límite asc, sin fecha al final, luego por alta); la pestaña
// «Hechas» las completadas (recientes primero) para desmarcarlas o
// borrarlas. Marcar/desmarcar hecho se hace desde el checkbox de la
// fila; editar y eliminar desde los botones de la fila.
//
// Datos: users/{uid}/todos/{id} con { texto, categoria, nota?,
// fechaLimiteISO?, hecha, fechaCompletadaISO, addedAt, updatedAt }.
// fechaCompletadaISO se pone (todayISO) al marcar hecha y null al
// desmarcar (null, nunca deleteField: firebase.js no se toca).
//
// Patrón: como gym.js, se conecta desde app.js vía setupTodos({ ctx }),
// que devuelve la API de apertura de la vista ({ openTodos({ tab }) })
// para el router y la sidebar.
// =============================================================

import { navigate } from "./router.js";
import { trapFocus } from "./focus-utils.js";
import { showToast } from "./ui.js";

// ---------- Constantes ----------

// Categorías de tarea (issue #283): presets del select del
// alta/edición. Las tareas guardadas conservan la categoría como
// texto; los ids de abajo son los canónicos.
const TODO_CATEGORIES = [
  { id: "corto_plazo", label: "Corto plazo" },
  { id: "largo_plazo", label: "Largo plazo" },
  { id: "casa", label: "Casa" },
  { id: "personal", label: "Personal" },
  { id: "trabajo", label: "Trabajo" },
  { id: "otro", label: "Otro" },
];

const CATEGORY_LABELS = Object.fromEntries(TODO_CATEGORIES.map((c) => [c.id, c.label]));

// Longitud máxima del texto de la tarea (igual en el input y en la
// validación del guard).
const TODO_MAX_LENGTH = 200;

// ---------- Estado del módulo ----------

let currentUser = null;
let ctx = null;
let todos = [];
// Pestaña de Cosas que hacer activa: se re-renderiza solo la pestaña
// a la vista cuando llegan datos nuevos (patrón de recipes.js #209).
// El default es «tareas»: la primera pestaña de la sección.
let currentTab = "tareas";

// Modal: null = cerrado; "new" | "edit". Sin modo lectura: la fila ya
// muestra todo el contenido (texto, categoría, fecha, nota).
let todoModalMode = null;
let editingTodoId = null;
let todoModalCleanup = null;

// Wiring de los listeners del DOM (idempotente): setupTodos corre tras
// cada login y los addEventListener no deben acumularse.
let todosWired = false;

// ---------- Utilidades ----------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Etiqueta de una categoría (preset conocido o texto libre).
function categoryLabel(id) {
  return CATEGORY_LABELS[id] || id || "";
}

// Época (ms) de un timestamp de Firestore, con fallback defensivo
// para documentos legacy sin el campo (serverTimestamp ausente).
function epochMs(t) {
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

// Comparador de la pestaña «Tareas»: pendientes por urgencia —
// fechaLimiteISO asc con las sin fecha al final, luego addedAt desc
// (lo más nuevo primero) y tie-break final por id para que el orden
// sea SIEMPRE determinista (el snapshot de Firestore solo ordena por
// addedAt desc; este sort puro se aplica sobre copia).
function pendingOrder(a, b) {
  const da = a.fechaLimiteISO || "";
  const db_ = b.fechaLimiteISO || "";
  if (da && db_ && da !== db_) return da < db_ ? -1 : 1;
  if (da && !db_) return -1;
  if (!da && db_) return 1;
  const ta = epochMs(a.addedAt);
  const tb = epochMs(b.addedAt);
  if (ta !== tb) return tb - ta;
  return String(a.id).localeCompare(String(b.id));
}

// Comparador de la pestaña «Hechas»: recientes primero —
// fechaCompletadaISO desc con las sin fecha al final, luego updatedAt
// desc y tie-break por id (mismo patrón de determinismo).
function doneOrder(a, b) {
  const da = a.fechaCompletadaISO || "";
  const db_ = b.fechaCompletadaISO || "";
  if (da && db_ && da !== db_) return da > db_ ? -1 : 1;
  if (da && !db_) return -1;
  if (!da && db_) return 1;
  const ta = epochMs(a.updatedAt);
  const tb = epochMs(b.updatedAt);
  if (ta !== tb) return tb - ta;
  return String(a.id).localeCompare(String(b.id));
}

// Tarea pendiente vencida: tiene fecha límite, no está hecha y la
// fecha es anterior a hoy (patrón UTC de ctx.todayISO()).
function isOverdue(todo) {
  return (
    !todo.hecha &&
    todo.fechaLimiteISO &&
    ctx.todayISO() > todo.fechaLimiteISO
  );
}

// ---------- Setup ----------

// Idempotente: los elementos del DOM se wirean una sola vez aunque
// setupTodos se llame tras cada login (ver app.js).
export function setupTodos(opts) {
  ctx = opts?.ctx || null;

  if (todosWired) return { openTodos };
  todosWired = true;

  document.getElementById("btn-new-todo").addEventListener("click", () => openTodoModal());

  // Pestañas (issue #283): la UI solo navega; el router (fromRouter)
  // hace el render. Patrón de recetas (recipes.js).
  document.querySelectorAll("[data-todos-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "todos", tab: btn.dataset.todosTab });
    });
  });

  // Modal de tarea: cierre por ✕, backdrop y Escape (sin modo
  // lectura ni constructor: el formulario es simple y se cierra
  // siempre, patrón del resto de modales de alta/edición).
  document.getElementById("todo-modal-close").addEventListener("click", closeTodoModal);
  document.getElementById("todo-modal-backdrop").addEventListener("click", closeTodoModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("todo-modal").classList.contains("hidden")) {
      e.preventDefault();
      closeTodoModal();
    }
  });

  // Filas de tareas (pestañas Tareas y Hechas): delegación en los
  // contenedores estables, no en el innerHTML re-renderizado.
  // El checkbox marca/desmarca hecho sin abrir el modal; los botones
  // Editar/Eliminar van con data-* propios.
  document.getElementById("todos-list").addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-todo-toggle]");
    if (toggle) {
      e.stopPropagation();
      toggleTodo(toggle.dataset.todoToggle);
      return;
    }
    const edit = e.target.closest("[data-todo-edit]");
    if (edit) {
      openTodoModal(edit.dataset.todoEdit);
      return;
    }
    const del = e.target.closest("[data-todo-delete]");
    if (del) deleteTodoItem(del.dataset.todoDelete);
  });
  // El checkbox también responde a Enter/Espacio por su naturaleza
  // nativa; la delegación de click ya lo cubre. Mismo wiring en la
  // lista de Hechas.
  document.getElementById("todos-done-list").addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-todo-toggle]");
    if (toggle) {
      e.stopPropagation();
      toggleTodo(toggle.dataset.todoToggle);
      return;
    }
    const edit = e.target.closest("[data-todo-edit]");
    if (edit) {
      openTodoModal(edit.dataset.todoEdit);
      return;
    }
    const del = e.target.closest("[data-todo-delete]");
    if (del) deleteTodoItem(del.dataset.todoDelete);
  });

  return { openTodos };
}

// Arranca la suscripción en tiempo real (lo llama app.js tras el
// login, como el resto de secciones). Devuelve la función de
// cancelación. Cada snapshot solo re-renderiza la pestaña a la vista
// (patrón de recipes.js).
export function subscribeTodosData(uid, onChange, onError) {
  currentUser = uid;
  return ctx.subscribeToTodos(uid, (items) => {
    todos = items;
    const renderers = { tareas: renderTodos, hechas: renderDone };
    renderers[currentTab]?.();
    if (onChange) onChange();
  }, onError);
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetTodosData() {
  todos = [];
  currentTab = "tareas";
  editingTodoId = null;
  closeTodoModal();
}

// ---------- Apertura / cierre de la vista ----------

export function openTodos({ tab = "tareas", fromRouter = false } = {}) {
  if (!fromRouter) {
    navigate({ section: "todos", tab });
  }
  currentTab = tab;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("recipes-view").classList.add("hidden");
  document.getElementById("gym-view").classList.add("hidden");
  document.getElementById("todos-view").classList.remove("hidden");

  document.querySelectorAll("[data-todos-tab]").forEach((btn) => {
    const isActive = btn.dataset.todosTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  const panels = {
    tareas: "panel-todos-tab",
    hechas: "panel-todos-done-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  const renderers = { tareas: renderTodos, hechas: renderDone };
  renderers[tab]?.();
}

// ---------- Pestaña Tareas: pendientes ----------

// Fila de tarea compartida por ambas pestañas (checkbox + texto +
// chips + acciones). `done` controla el estado visual y del checkbox.
function todoItemHtml(todo, done) {
  const texto = escapeHtml(todo.texto || "");
  const categoria = categoryLabel(todo.categoria);
  const note = todo.nota ? escapeHtml(todo.nota) : "";
  const fecha = todo.fechaLimiteISO ? escapeHtml(ctx.formatDateEs(todo.fechaLimiteISO) || todo.fechaLimiteISO) : "";
  const overdue = !done && isOverdue(todo);
  const doneClass = done ? " todo-item--done" : "";
  const dateClass = overdue ? " todo-item__deadline--overdue" : "";
  return `<div class="todo-item${doneClass}" data-todo-id="${escapeHtml(todo.id)}">
    <label class="todo-item__check">
      <input type="checkbox" data-todo-toggle="${escapeHtml(todo.id)}"
             ${done ? "checked" : ""}
             aria-label="${done ? "Desmarcar como hecha: " : "Marcar como hecha: "}${texto}" />
      <span class="todo-item__checkmark" aria-hidden="true"></span>
    </label>
    <div class="todo-item__main">
      <p class="todo-item__text">${texto}</p>
      ${note ? `<p class="todo-item__note">${note}</p>` : ""}
      <div class="todo-item__meta">
        ${categoria ? `<span class="todo-category-chip">${escapeHtml(categoria)}</span>` : ""}
        ${fecha ? `<span class="todo-item__deadline${dateClass}">📅 ${fecha}</span>` : ""}
      </div>
    </div>
    <div class="todo-item__actions">
      <button type="button" class="btn btn--small" data-todo-edit="${escapeHtml(todo.id)}">✏️ Editar</button>
      <button type="button" class="btn btn--small btn--danger" data-todo-delete="${escapeHtml(todo.id)}">🗑</button>
    </div>
  </div>`;
}

function renderTodos() {
  const container = document.getElementById("todos-list");
  if (!container) return;

  const pending = todos.filter((t) => !t.hecha);
  if (!pending.length) {
    container.innerHTML = `<p class="empty-state">Aún no tienes tareas. Pulsa «+ Nueva tarea» para añadir la primera.</p>`;
    return;
  }

  container.innerHTML = `<div class="todo-list">
    ${[...pending].sort(pendingOrder).map((t) => todoItemHtml(t, false)).join("")}
  </div>`;
}

// ---------- Pestaña Hechas: completadas ----------

function renderDone() {
  const container = document.getElementById("todos-done-list");
  if (!container) return;

  const done = todos.filter((t) => t.hecha);
  if (!done.length) {
    container.innerHTML = `<p class="empty-state">Todavía no has completado ninguna tarea. Cuando marques una tarea como hecha aparecerá aquí.</p>`;
    return;
  }

  container.innerHTML = `<div class="todo-list">
    ${[...done].sort(doneOrder).map((t) => todoItemHtml(t, true)).join("")}
  </div>`;
}

// ---------- Acciones de fila ----------

// Marca/desmarca la tarea. El estado siguiente se calcula del
// documento en memoria (no del DOM). Se aplica optimista: el espejo
// local se invierte antes del round-trip a Firestore, así un doble
// clic rápido lee el estado nuevo y envía el toggle de vuelta (sin
// esto, el segundo clic reenviaría el mismo valor y el desmarcado se
// perdería; el DOM se actualiza al llegar el snapshot). En error se
// revierten ambos campos a sus valores previos.
async function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo || !currentUser) return;
  const next = !todo.hecha;
  const prevHecha = todo.hecha;
  const prevFecha = todo.fechaCompletadaISO;
  todo.hecha = next;
  todo.fechaCompletadaISO = next ? ctx.todayISO() : null;
  try {
    await ctx.updateTodo(currentUser, id, {
      hecha: next,
      fechaCompletadaISO: todo.fechaCompletadaISO,
    });
  } catch (err) {
    todo.hecha = prevHecha;
    todo.fechaCompletadaISO = prevFecha;
    console.error("No se pudo actualizar la tarea:", err);
    showToast(next ? "No se pudo marcar la tarea como hecha." : "No se pudo desmarcar la tarea.");
  }
}

async function deleteTodoItem(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo || !currentUser) return;
  const label = (todo.texto || "").trim();
  if (!confirm(`¿Eliminar la tarea «${label || "sin texto"}»?`)) return;
  try {
    await ctx.deleteTodo(currentUser, id);
    showToast("Tarea eliminada.");
  } catch (err) {
    console.error("No se pudo eliminar la tarea:", err);
    showToast("No se pudo eliminar la tarea.");
  }
}

// ---------- Modal de tarea (alta / edición) ----------

function openTodoModal(id) {
  const modal = document.getElementById("todo-modal");
  const content = document.getElementById("todo-modal-content");
  const todo = id ? todos.find((t) => t.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");

  if (todo) {
    editingTodoId = todo.id;
    todoModalMode = "edit";
  } else {
    editingTodoId = null;
    todoModalMode = "new";
  }

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    todoModalMode === "edit" ? "Editar tarea" : "Nueva tarea"
  );

  content.innerHTML = renderTodoModalHtml(todo);
  bindTodoModalHandlers(content, todo);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  if (todoModalCleanup) todoModalCleanup();
  todoModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // Foco al campo de texto (patrón del modal de ingrediente): en un
  // segundo rAF tras el de trapFocus (que enfoca la ✕) el foco final
  // queda en el input.
  requestAnimationFrame(() => {
    content.querySelector("#todo-texto")?.focus({ preventScroll: false });
  });
}

function closeTodoModal() {
  const modal = document.getElementById("todo-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  todoModalMode = null;
  editingTodoId = null;
  if (todoModalCleanup) {
    todoModalCleanup();
    todoModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

function renderTodoModalHtml(todo) {
  const texto = todo?.texto || "";
  const categoria = todo?.categoria || TODO_CATEGORIES[0].id;
  const fechaLimite = todo?.fechaLimiteISO || "";
  const nota = todo?.nota || "";
  const options = TODO_CATEGORIES.map((c) =>
    `<option value="${c.id}"${c.id === categoria ? " selected" : ""}>${escapeHtml(c.label)}</option>`
  ).join("");

  return `<form id="todo-form" class="todo-modal__form">
    <h3 class="todo-modal__title">${todoModalMode === "edit" ? "Editar tarea" : "Nueva tarea"}</h3>
    <div class="todo-form__field">
      <label for="todo-texto">Texto *</label>
      <input type="text" id="todo-texto" required maxlength="${TODO_MAX_LENGTH}"
             autocomplete="off" placeholder="¿Qué hay que hacer?"
             value="${escapeHtml(texto)}" />
    </div>
    <div class="todo-form__field">
      <label for="todo-categoria">Categoría</label>
      <select id="todo-categoria" aria-label="Categoría de la tarea">
        ${options}
      </select>
    </div>
    <div class="todo-form__field">
      <label for="todo-fecha-limite">Fecha límite</label>
      <input type="date" id="todo-fecha-limite" value="${escapeHtml(fechaLimite)}" />
    </div>
    <div class="todo-form__field">
      <label for="todo-nota">Nota</label>
      <textarea id="todo-nota" rows="3" maxlength="500"
                placeholder="Detalles, contexto, dónde, cómo…">${escapeHtml(nota)}</textarea>
    </div>
    <div class="todo-modal__actions">
      <button type="button" class="btn btn--small" data-todo-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function bindTodoModalHandlers(content, todo) {
  content.querySelector("[data-todo-cancel]")?.addEventListener("click", closeTodoModal);

  content.querySelector("#todo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = content.querySelector("#todo-texto").value.trim();
    // Guard: el texto es obligatorio (además del required del input).
    if (!texto) {
      content.querySelector("#todo-texto").focus();
      return;
    }
    const categoria = content.querySelector("#todo-categoria").value;
    const fechaLimite = content.querySelector("#todo-fecha-limite").value || null;
    const nota = content.querySelector("#todo-nota").value.trim() || null;
    const isEdit = todoModalMode === "edit";
    try {
      if (isEdit && editingTodoId) {
        await ctx.updateTodo(currentUser, editingTodoId, { texto, categoria, fechaLimiteISO: fechaLimite, nota });
        showToast("Tarea actualizada.");
      } else {
        await ctx.addTodo(currentUser, { texto, categoria, fechaLimiteISO: fechaLimite, nota });
        showToast("Tarea añadida.");
      }
      closeTodoModal();
    } catch (err) {
      console.error("No se pudo guardar la tarea:", err);
      showToast("No se pudo guardar la tarea.");
    }
  });
}
