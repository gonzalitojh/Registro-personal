// =============================================================
// Sección de Recetas (issue #64) — pestaña «Recetas».
// Gestiona el listado de recetas con búsqueda, el modal de
// alta/edición/importación, el catálogo de ingredientes y las
// etiquetas personalizadas del usuario (users/{uid}/tags).
//
// Patrón: como profile.js, se conecta desde app.js vía
// setupRecipes({ ctx }), que devuelve la API de apertura de la
// vista ({ openRecipes({ tab }) }) para el router y la sidebar.
// =============================================================

import { navigate } from "./router.js";
import { trapFocus } from "./focus-utils.js";
import { showToast } from "./ui.js";
import {
  INGREDIENT_CATEGORIES,
  ALERGEN_TAGS,
  MEAL_TYPES,
  normalizeIngredientName,
  normalizeUnit,
  mergeTags,
  tagsByIds,
  escapeHtml,
  formatCantidad,
} from "./recipes-data.js";

// Etiquetas predefinidas por scope (el tipo de etiqueta personalizada
// coincide con el scope del selector: "ingrediente" | "alergeno" | "tipo").
const PRESET_BY_SCOPE = {
  ingrediente: INGREDIENT_CATEGORIES,
  alergeno: ALERGEN_TAGS,
  tipo: MEAL_TYPES,
};

// ---------- Estado del módulo ----------

let currentUser = null;
let ctx = null;
let recipes = [];
let ingredients = [];
let customTags = [];
// Pestaña de Recetas activa (issue #209): el catálogo de ingredientes
// vive en su propia pestaña, así que se re-renderiza solo si está a la
// vista cuando llegan datos nuevos.
let currentTab = "recetas";
// Estado del catálogo de ingredientes (issue #218): ordenación activa y
// categorías seleccionadas en el filtro (todas por defecto). El flag
// de "tocado" evita que las categorías propias recién cargadas rompan
// la selección hecha por el usuario.
let ingredientSort = "az";
let ingredientFilterTouched = false;
let activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
let ingredientModalCleanup = null;
let modalCleanup = null;
let editingRecipeId = null;
let modalReadOnly = false;
let onRecipeDeleted = null;

// Renderers de las otras pestañas (registrados por menu.js y
// shopping-list.js): openRecipes los llama al activar su tab.
const tabRenderers = {};

export function registerTabRenderer(tab, fn) {
  tabRenderers[tab] = fn;
}

export function getRecipes() {
  return recipes;
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetRecipesData() {
  recipes = [];
  ingredients = [];
  customTags = [];
  currentTab = "recetas";
  ingredientSort = "az";
  ingredientFilterTouched = false;
  activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
  closeIngredientModal();
  closeIngredientFilterPanel();
}

export function notifyRecipesChanged() {
  if (tabRenderers.menu) tabRenderers.menu();
  if (tabRenderers.compra) tabRenderers.compra();
}

// ---------- Setup ----------

export function setupRecipes(opts) {
  ctx = opts?.ctx || null;
  onRecipeDeleted = opts?.onRecipeDeleted || null;

  document.getElementById("btn-new-recipe").addEventListener("click", () => openRecipeModal());

  // Subtabs internas: la UI solo navega; el router (fromRouter) hace
  // el render. Patrón idéntico al del perfil (profile.js).
  document.querySelectorAll("[data-recipes-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "recetas", tab: btn.dataset.recipesTab });
    });
  });

  // Modal de receta: cierre por ✕, backdrop y Escape.
  document.getElementById("recipe-modal-close").addEventListener("click", closeRecipeModal);
  document.getElementById("recipe-modal-backdrop").addEventListener("click", closeRecipeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("recipe-modal").classList.contains("hidden")) {
      e.preventDefault();
      closeRecipeModal();
    }
  });

  // Modal de ingrediente (issue #218): cierre por ✕, backdrop y Escape.
  document.getElementById("ingredient-modal-close").addEventListener("click", closeIngredientModal);
  document.getElementById("ingredient-modal-backdrop").addEventListener("click", closeIngredientModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("ingredient-modal").classList.contains("hidden")) {
      e.preventDefault();
      closeIngredientModal();
    }
  });

  // Barra de herramientas del catálogo de ingredientes (issue #218).
  document.getElementById("btn-new-ingredient").addEventListener("click", () => openIngredientModal(null));
  document.getElementById("ingredient-sort").addEventListener("change", (e) => {
    ingredientSort = e.target.value;
    renderIngredientsCatalog();
  });
  setupIngredientFilter();

  // Delegación de acciones de las cards de ingredientes: la tarjeta es
  // un <button> con el nombre; al pulsarla se abre el modal de detalle.
  document.getElementById("ingredients-catalog").addEventListener("click", (e) => {
    const card = e.target.closest("[data-ingredient-id]");
    if (!card) return;
    openIngredientModal(card.dataset.ingredientId);
  });

  // Delegación de acciones de las cards de recetas.
  document.getElementById("recipes-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const recipe = recipes.find((r) => r.id === btn.dataset.id);
    if (!recipe) return;
    if (btn.dataset.action === "view") openRecipeModal(recipe, { readOnly: true });
    if (btn.dataset.action === "edit") openRecipeModal(recipe);
    if (btn.dataset.action === "delete") deleteRecipeFlow(recipe);
  });

  return { openRecipes };
}

// Arranca las suscripciones en tiempo real (lo llama app.js tras el
// login, como las del resto de bibliotecas). Devuelve la función de
// cancelación.
export function subscribeRecipesData(uid, onChange, onError) {
  currentUser = uid;
  const subs = [];

  subs.push(ctx.subscribeToRecipes(uid, (items) => {
    recipes = items;
    renderRecipesList();
    // El catálogo muestra en qué recetas se usa cada ingrediente:
    // refrescarlo si la pestaña de Ingredientes está a la vista.
    if (currentTab === "ingredientes") renderIngredientsCatalog();
    notifyRecipesChanged();
    if (onChange) onChange();
  }, onError));

  subs.push(ctx.subscribeToIngredients(uid, (items) => {
    ingredients = items;
    if (currentTab === "ingredientes") renderIngredientsCatalog();
  }, onError));

  subs.push(ctx.subscribeToTags(uid, (items) => {
    customTags = items;
    // El filtro por defecto incluye todas las categorías: si el usuario
    // aún no lo ha tocado, las propias recién cargadas se suman al Set.
    if (!ingredientFilterTouched) {
      ingredientFilterCategoryIds().forEach((id) => activeCategoryFilter.add(id));
      if (currentTab === "ingredientes") {
        updateIngredientFilterLabel();
        renderIngredientsCatalog();
      }
    }
    renderRecipesList();
  }, onError));

  return () => subs.forEach((unsub) => unsub && unsub());
}

// ---------- Apertura / cierre de la vista ----------

export function openRecipes({ tab = "recetas", fromRouter = false } = {}) {
  if (!fromRouter) {
    navigate({ section: "recetas", tab });
  }
  currentTab = tab;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("recipes-view").classList.remove("hidden");

  document.querySelectorAll("[data-recipes-tab]").forEach((btn) => {
    const isActive = btn.dataset.recipesTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  const panels = {
    recetas: "panel-recipes-tab",
    ingredientes: "panel-ingredients-tab",
    menu: "panel-menu-tab",
    compra: "panel-shopping-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  // Si el panel de filtro del catálogo quedó abierto, cerrarlo al
  // cambiar de pestaña (evita estado obsoleto al volver).
  if (tab !== "ingredientes") closeIngredientFilterPanel();

  if (tab === "recetas") {
    renderRecipesList();
  } else if (tab === "ingredientes") {
    renderIngredientsCatalog();
  } else if (tabRenderers[tab]) {
    tabRenderers[tab]();
  }
}

// ---------- Pestaña Recetas: listado ----------

// Búsqueda de recetas para el buscador global de la cabecera
// (issue #206): la búsqueda superior se acota a la sección activa,
// así que desde Recetas filtra el listado local. Reutiliza el filtro
// de la pestaña (nombre, ingrediente y etiqueta).
export function searchRecipes(query) {
  return filterRecipes(recipes, query.trim().toLowerCase());
}

function renderRecipesList() {
  const container = document.getElementById("recipes-list");
  if (!container) return;

  if (!recipes.length) {
    container.innerHTML = `<p class="empty-state">Aún no hay recetas. Pulsa «+ Nueva receta» para crear la primera.</p>`;
    return;
  }

  container.innerHTML = `<div class="recipes-grid">
    ${recipes.map(recipeCardHtml).join("")}
  </div>`;
}

// Búsqueda: por nombre, por ingrediente (recetas que lo usan) y por
// etiquetas (alérgenos, tipos y categorías de ingrediente).
function filterRecipes(items, filter) {
  if (!filter) return items;
  const q = filter.toLowerCase();
  return items.filter((r) => {
    if ((r.nombre || "").toLowerCase().includes(q)) return true;
    const ingNames = (r.ingredientes || [])
      .map((i) => normalizeIngredientName(i.nombre).toLowerCase());
    if (ingNames.some((n) => n.includes(q))) return true;
    const tagNames = [
      ...(r.alergenos || []).map((id) => tagLabel("alergeno", id).toLowerCase()),
      ...(r.tipos || []).map((id) => tagLabel("tipo", id).toLowerCase()),
      ...(r.ingredientes || []).map((i) => tagLabel("ingrediente", i.categoriaId).toLowerCase()),
    ];
    return tagNames.some((t) => t && t.includes(q));
  });
}

function recipeCardHtml(r) {
  const alergenos = tagsByIds(ALERGEN_TAGS, customTags, r.alergenos || []);
  const tipos = tagsByIds(MEAL_TYPES, customTags, r.tipos || []);
  const badge = r.needsReview
    ? `<span class="recipe-card__badge" title="Importada desde una URL, pendiente de revisar">Revisar</span>`
    : "";
  const tags = [...alergenos, ...tipos];
  return `<article class="recipe-card${r.needsReview ? " recipe-card--review" : ""}">
    <div class="recipe-card__top">
      <h3 class="recipe-card__title">${escapeHtml(r.nombre)}</h3>
      ${badge}
    </div>
    ${r.fotoUrl ? `<img class="recipe-card__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
    <p class="recipe-card__meta">
      ${Number(r.porciones) ? `${formatCantidad(r.porciones)} porciones` : ""}
      ${r.ingredientes?.length ? ` · ${r.ingredientes.length} ingredientes` : ""}
    </p>
    ${tags.length ? `<p class="recipe-card__tags">
      ${tags.map((t) => `<span class="recipe-card__tag">${escapeHtml(t.label)}</span>`).join("")}
    </p>` : ""}
    <div class="recipe-card__actions">
      <button type="button" class="btn btn--small" data-action="view" data-id="${r.id}">Ver</button>
      <button type="button" class="btn btn--small" data-action="edit" data-id="${r.id}">Editar</button>
      <button type="button" class="btn btn--small btn--danger" data-action="delete" data-id="${r.id}">Eliminar</button>
    </div>
  </article>`;
}

async function deleteRecipeFlow(recipe) {
  if (!confirm(`¿Eliminar la receta «${recipe.nombre}»?`)) return;
  try {
    await ctx.deleteRecipe(currentUser, recipe.id);
    // Limpiar referencias en los menús (si app.js inyectó el callback).
    if (onRecipeDeleted) onRecipeDeleted(recipe.id);
    showToast("Receta eliminada.");
  } catch (err) {
    console.error("No se pudo eliminar la receta:", err);
    showToast("No se pudo eliminar la receta.");
  }
}

function tagLabel(scope, id) {
  if (!id) return "";
  const preset = PRESET_BY_SCOPE[scope].find((t) => t.id === id);
  if (preset) return preset.label;
  const custom = customTags.find((t) => t.id === id);
  if (custom) return custom.nombre || custom.id;
  return id;
}

// ---------- Catálogo de ingredientes (pestaña «Ingredientes», issue #209 / #218) ----------

// Índice de recetas por ingrediente (recetas que usan cada uno). Se usa
// en el render, en la ordenación «Más usadas» y en el modal de detalle.
function getUsageIndex() {
  const byName = new Map();
  recipes.forEach((r) => {
    (r.ingredientes || []).forEach((i) => {
      const key = normalizeIngredientName(i.nombre);
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(r.id);
    });
  });
  return byName;
}

function renderIngredientsCatalog() {
  const container = document.getElementById("ingredients-catalog");
  if (!container) return;

  const byName = getUsageIndex();
  const sorted = [...ingredients].sort((a, b) => compareIngredients(a, b, byName));
  if (!sorted.length) {
    container.innerHTML = `<p class="empty-state">El catálogo de ingredientes se rellena solo: cada vez que guardas una
      receta con ingredientes, aparecen aquí para poder asignarles una categoría (y se usan para la lista de la compra).
      También puedes añadirlos a mano con «+ Nuevo ingrediente».</p>`;
    return;
  }

  // Filtro por categorías (issue #218): multiselección con todas
  // seleccionadas por defecto. Los ingredientes sin categoría se
  // muestran siempre (son el cubo de entrada al que se les asigna).
  const filtered = sorted.filter(
    (ing) => !ing.categoriaId || activeCategoryFilter.has(ing.categoriaId)
  );
  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">Ningún ingrediente en las categorías seleccionadas.
      Ajusta el filtro de categorías para ver más.</p>`;
    return;
  }

  // Agrupación por categoría (patrón de la lista de la compra): las
  // predefinidas en su orden, las personalizadas presentes en los datos
  // por orden alfabético de etiqueta y «Sin categoría» al final.
  const groups = new Map();
  INGREDIENT_CATEGORIES.forEach((c) => groups.set(c.id, []));
  groups.set("", []);
  filtered.forEach((ing) => {
    const key = ing.categoriaId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ing);
  });
  const customGroupIds = [...groups.keys()]
    .filter((id) => id && !INGREDIENT_CATEGORIES.some((c) => c.id === id))
    .sort((a, b) => tagLabel("ingrediente", a).localeCompare(tagLabel("ingrediente", b), "es"));

  container.innerHTML = `<p class="ingredients-count" aria-live="polite">${filtered.length}
    ${filtered.length === 1 ? "ingrediente" : "ingredientes"}</p>
    ${INGREDIENT_CATEGORIES.map((c) => {
      const items = groups.get(c.id);
      if (!items?.length) return "";
      return `<section class="ingredient-group">
        <h3 class="ingredient-group__title">${escapeHtml(c.label)}</h3>
        <div class="ingredient-grid">
          ${items.map((ing) => ingredientCardHtml(ing)).join("")}
        </div>
      </section>`;
    }).join("")}
    ${customGroupIds.map((id) => `<section class="ingredient-group">
      <h3 class="ingredient-group__title">${escapeHtml(tagLabel("ingrediente", id))}</h3>
      <div class="ingredient-grid">
        ${groups.get(id).map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>`).join("")}
    ${groups.get("").length ? `<section class="ingredient-group">
      <h3 class="ingredient-group__title">Sin categoría</h3>
      <div class="ingredient-grid">
        ${groups.get("").map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>` : ""}`;
}

// Comparador de ingredientes según el orden activo (issue #218). Todos
// los modos terminan con tie-break determinista (nombre, luego id).
function compareIngredients(a, b, byName) {
  let diff = 0;
  if (ingredientSort === "za") {
    diff = b.nombre.localeCompare(a.nombre, "es");
  } else if (ingredientSort === "recent") {
    diff = (b.addedAt?.toMillis?.() || 0) - (a.addedAt?.toMillis?.() || 0);
  } else if (ingredientSort === "used") {
    const usedA = byName.get(normalizeIngredientName(a.nombre))?.size || 0;
    const usedB = byName.get(normalizeIngredientName(b.nombre))?.size || 0;
    diff = usedB - usedA;
  } else {
    diff = a.nombre.localeCompare(b.nombre, "es");
  }
  return diff || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id);
}

// Tarjeta del catálogo: muestra únicamente el nombre (issue #218); la
// información ampliada vive en el modal que abre al pulsarla.
function ingredientCardHtml(ing) {
  return `<button type="button" class="ingredient-card" data-ingredient-id="${ing.id}">${escapeHtml(ing.nombre)}</button>`;
}

// ---------- Filtro por categorías (issue #218) ----------

// Checkboxes del panel de filtro: «Todas» + las categorías (predefinidas
// y propias del usuario). El panel se pinta solo al abrir; los cambios
// posteriores solo alternan clases is-checked (sin re-render) para no
// perder el foco y para que la marca visual sea inmediata (iteración
// tras comentario de la issue #218: el filtro se aplica y se colorea a
// medida que se selecciona, no al cerrar el panel).

// Ids de todas las categorías visibles en el panel (predefinidas + propias).
function ingredientFilterCategoryIds() {
  return mergeTags(
    INGREDIENT_CATEGORIES,
    customTags.filter((t) => t.tipo === "ingrediente")
  ).map((t) => t.id);
}

// «Todas» está marcado si y solo si TODAS las categorías del panel
// (predefinidas y propias) están en el filtro.
function ingredientFilterAllChecked() {
  const ids = ingredientFilterCategoryIds();
  return ids.length > 0 && ids.every((id) => activeCategoryFilter.has(id));
}

function renderIngredientFilter() {
  const panel = document.getElementById("ingredient-filter-panel");
  if (!panel) return;
  const tags = mergeTags(
    INGREDIENT_CATEGORIES,
    customTags.filter((t) => t.tipo === "ingrediente")
  );
  const allChecked = ingredientFilterAllChecked();
  panel.innerHTML = `<label class="ingredients-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todas</span>
    </label>
    <div class="ingredients-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = activeCategoryFilter.has(t.id);
      return `<label class="ingredients-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

function updateIngredientFilterLabel() {
  const label = document.getElementById("ingredient-filter-label");
  if (!label) return;
  if (ingredientFilterAllChecked()) {
    label.textContent = "Todas las categorías";
    return;
  }
  const n = activeCategoryFilter.size;
  label.textContent = `${n} ${n === 1 ? "categoría" : "categorías"}`;
}

// Toggle de la marca del checkbox «Todas» (marcado solo si lo están
// todas las categorías del panel).
function syncIngredientFilterAll() {
  const all = document.querySelector("#ingredient-filter-panel .ingredients-filter__all");
  if (!all) return;
  const checked = ingredientFilterAllChecked();
  all.classList.toggle("is-checked", checked);
  const input = all.querySelector("input");
  input.checked = checked;
}

// Marca visual de cada casilla en tiempo real (issue #218, iteración
// tras comentario): el input está oculto (opacity: 0) y la única señal
// de seleccionado es la clase is-checked del label, así que se alterna
// en el momento de marcar/desmarcar, no al volver a abrir el panel.
// La fuente de verdad es activeCategoryFilter, no input.checked: al
// pulsar «Todas» el navegador solo actualiza ese input, los demás
// quedarían desincronizados.
function syncIngredientFilterItems() {
  document.querySelectorAll("#ingredient-filter-panel .ingredients-filter__item").forEach((item) => {
    const input = item.querySelector("input");
    if (!input) return;
    const checked = activeCategoryFilter.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

function closeIngredientFilterPanel() {
  const panel = document.getElementById("ingredient-filter-panel");
  const btn = document.getElementById("btn-ingredient-filter");
  if (!panel || panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  // Desregistrar el Escape del panel (se registra al abrirlo) para que
  // no robe foco tras cierres por fuera (openRecipes, resetRecipesData).
  document.removeEventListener("keydown", escHandlerRef);
}

// Referencia al manejador de Escape del panel (registrado al abrirlo);
// se guarda en el módulo para poder desregistrarlo desde
// closeIngredientFilterPanel sin acoplar el cierre al setup.
let escHandlerRef = null;

function setupIngredientFilter() {
  const wrap = document.getElementById("ingredients-filter");
  const panel = document.getElementById("ingredient-filter-panel");
  const btn = document.getElementById("btn-ingredient-filter");
  if (!wrap || !panel || !btn) return;

  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeIngredientFilterPanel();
      btn.focus();
    }
  };
  escHandlerRef = escHandler;

  btn.addEventListener("click", () => {
    if (panel.classList.contains("hidden")) {
      renderIngredientFilter();
      panel.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("keydown", escHandler);
    } else {
      closeIngredientFilterPanel();
      btn.focus();
    }
  });

  // Click fuera del wrapper: cerrar (patrón del dropdown de perfil).
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !panel.classList.contains("hidden")) {
      closeIngredientFilterPanel();
    }
  });

  panel.addEventListener("change", (e) => {
    const input = e.target.closest("input[type='checkbox']");
    if (!input) return;
    ingredientFilterTouched = true;
    if (input.value === "__all__") {
      activeCategoryFilter = input.checked
        ? new Set(ingredientFilterCategoryIds())
        : new Set();
    } else if (input.checked) {
      activeCategoryFilter.add(input.value);
    } else {
      activeCategoryFilter.delete(input.value);
    }
    // Marca visual y filtro en vivo (issue #218, iteración): colorear
    // lo seleccionado y aplicar el filtro a medida que se selecciona,
    // no cuando se cierra el panel.
    syncIngredientFilterItems();
    syncIngredientFilterAll();
    updateIngredientFilterLabel();
    renderIngredientsCatalog();
  });
}

// ---------- Modal de ingrediente (issue #218) ----------

// Abre el modal de ingrediente: con id = detalle ampliado (categoría,
// recetas que lo usan, eliminar); sin id = alta manual.
function openIngredientModal(id) {
  const modal = document.getElementById("ingredient-modal");
  const content = document.getElementById("ingredient-modal-content");
  const ingredient = id ? ingredients.find((i) => i.id === id) : null;

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    ingredient ? `Ingrediente: ${ingredient.nombre}` : "Nuevo ingrediente"
  );
  content.innerHTML = ingredient ? ingredientDetailHtml(ingredient) : ingredientNewHtml();
  bindIngredientModalHandlers(content, ingredient);

  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  ingredientModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // En el alta manual, foco directo al nombre para escribir ya. Se hace
  // en un segundo rAF tras el de trapFocus (que enfoca la ✕, el primer
  // enfocable): los callbacks del mismo frame corren en orden, así el
  // foco final queda en el input y el trap no se rompe.
  if (!ingredient) {
    requestAnimationFrame(() => {
      content.querySelector("#ing-modal-nombre")?.focus({ preventScroll: false });
    });
  }
}

function closeIngredientModal() {
  const modal = document.getElementById("ingredient-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (ingredientModalCleanup) {
    ingredientModalCleanup();
    ingredientModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

function ingredientDetailHtml(ing) {
  const byName = getUsageIndex();
  const usedRecipes = recipes.filter((r) =>
    (byName.get(normalizeIngredientName(ing.nombre)) || new Set()).has(r.id)
  );
  const catLabel = tagLabel("ingrediente", ing.categoriaId);
  return `<h3 class="ingredient-modal__title">${escapeHtml(ing.nombre)}</h3>
    <div class="ingredient-modal__field">
      <label for="ing-modal-categoria">Categoría</label>
      <select id="ing-modal-categoria" aria-label="Categoría de ${escapeHtml(ing.nombre)}">
        ${optionsFor("ingrediente", ing.categoriaId)}
      </select>
    </div>
    ${usedRecipes.length ? `<p class="ingredient-modal__used">Usada en ${usedRecipes.length}
      ${usedRecipes.length === 1 ? "receta" : "recetas"}:
      ${usedRecipes.map((r) =>
        `<button type="button" class="ingredient-modal__link" data-recipe-id="${r.id}">${escapeHtml(r.nombre)}</button>`).join(", ")}</p>`
      : `<p class="ingredient-modal__used">No se usa en ninguna receta aún.</p>`}
    <p class="ingredient-modal__cat-hint">${catLabel ? `Categoría actual: ${escapeHtml(catLabel)}.` : "Sin categoría."}
      La lista de la compra se agrupa por esta categoría.</p>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-ing-delete>Eliminar</button>
      <button type="button" class="btn btn--small btn--outline" data-ing-close>Cerrar</button>
    </div>`;
}

function ingredientNewHtml() {
  return `<form id="ingredient-new-form" class="ingredient-modal__form">
    <h3 class="ingredient-modal__title">Nuevo ingrediente</h3>
    <div class="ingredient-modal__field">
      <label for="ing-modal-nombre">Nombre *</label>
      <input type="text" id="ing-modal-nombre" required maxlength="200" autocomplete="off"
             placeholder="P. ej. azúcar moreno" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-categoria-nueva">Categoría</label>
      <select id="ing-modal-categoria-nueva" aria-label="Categoría del nuevo ingrediente">
        ${optionsFor("ingrediente", "")}
      </select>
    </div>
    <p class="ingredient-modal__cat-hint">Si el ingrediente ya está en el catálogo, no se añadirá otra vez.</p>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small" data-ing-close>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function bindIngredientModalHandlers(content, ingredient) {
  content.querySelector("[data-ing-close]")?.addEventListener("click", closeIngredientModal);

  // Cambio de categoría en el detalle: inmediato + toast (como antes).
  content.querySelector("#ing-modal-categoria")?.addEventListener("change", async (e) => {
    try {
      await ctx.updateIngredientCategory(currentUser, ingredient.id, e.target.value);
      showToast("Categoría actualizada.");
    } catch (err) {
      console.error("No se pudo actualizar la categoría:", err);
    }
  });

  // Links «Usada en»: abren la receta en modo lectura; el modal de
  // ingrediente se cierra antes (ambos comparten z-index).
  content.querySelectorAll("[data-recipe-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const recipe = recipes.find((r) => r.id === btn.dataset.recipeId);
      if (!recipe) return;
      closeIngredientModal();
      openRecipeModal(recipe, { readOnly: true });
    });
  });

  // Eliminar el ingrediente del catálogo (no afecta a las recetas).
  content.querySelector("[data-ing-delete]")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar el ingrediente «${ingredient.nombre}» del catálogo? No afecta a las recetas que lo usan.`)) return;
    try {
      await ctx.deleteIngredient(currentUser, ingredient.id);
      closeIngredientModal();
      showToast("Ingrediente eliminado del catálogo.");
    } catch (err) {
      console.error("No se pudo eliminar el ingrediente:", err);
      showToast("No se pudo eliminar el ingrediente.");
    }
  });

  // Alta manual: nombre normalizado y sin duplicados.
  content.querySelector("#ingredient-new-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = content.querySelector("#ing-modal-nombre").value.trim();
    if (!raw) return;
    const nombre = normalizeIngredientName(raw);
    const exists = ingredients.some((i) => normalizeIngredientName(i.nombre) === nombre);
    if (exists) {
      showToast("Ese ingrediente ya existe en el catálogo.");
      return;
    }
    const categoriaId = content.querySelector("#ing-modal-categoria-nueva").value;
    try {
      await ctx.addIngredient(currentUser, { nombre, categoriaId });
      closeIngredientModal();
      showToast("Ingrediente añadido al catálogo.");
    } catch (err) {
      console.error("No se pudo añadir el ingrediente:", err);
      showToast("No se pudo añadir el ingrediente.");
    }
  });
}

// ---------- Selectores de etiquetas (predefinidas + propias) ----------

function optionsFor(scope, selectedId) {
  const tags = mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  );
  return `<option value="">—</option>
    ${tags.map((t) => `<option value="${escapeHtml(t.id)}"${t.id === selectedId ? " selected" : ""}>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</option>`).join("")}`;
}

// ---------- Modal de receta ----------

export function openRecipeModal(recipe = null, { readOnly = false } = {}) {
  const modal = document.getElementById("recipe-modal");
  const content = document.getElementById("recipe-modal-content");
  editingRecipeId = recipe?.id || null;
  modalReadOnly = readOnly;

  content.innerHTML = recipeModalHtml(recipe);
  bindRecipeModalHandlers(content);

  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modalCleanup = trapFocus(modal.querySelector(".modal__card"));
}

function closeRecipeModal() {
  const modal = document.getElementById("recipe-modal");
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (modalCleanup) {
    modalCleanup();
    modalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
  editingRecipeId = null;
  modalReadOnly = false;
}

function recipeModalHtml(recipe) {
  const r = recipe || {};
  const alergenos = r.alergenos || [];
  const tipos = r.tipos || [];
  const ingredientes = r.ingredientes?.length ? r.ingredientes : [{ nombre: "", cantidad: "", unidad: "", categoriaId: "" }];
  const instrucciones = r.instrucciones?.length ? r.instrucciones : [""];
  const ro = modalReadOnly ? " disabled" : "";
  const alergenoTags = mergeTags(ALERGEN_TAGS, customTags.filter((t) => t.tipo === "alergeno"));
  const tipoTags = mergeTags(MEAL_TYPES, customTags.filter((t) => t.tipo === "tipo"));

  const importBox = !recipe
    ? `<div class="recipe-form__import">
        <label for="recipe-import-url">Importar desde una URL</label>
        <div class="recipe-form__import-row">
          <input type="url" id="recipe-import-url" placeholder="https://…" autocomplete="off" />
          <button type="button" id="btn-import-recipe" class="btn btn--small">Importar</button>
        </div>
        <p class="recipe-form__hint">Muchas webs no permiten leer su contenido desde otra página; en ese caso se
          guardará la URL y la receta quedará marcada como «Revisar» para que completes los datos.</p>
      </div>` : "";

  return `<form id="recipe-form" class="recipe-form">
    <h3 class="recipe-form__title">${recipe ? (modalReadOnly ? "Receta" : "Editar receta") : "Nueva receta"}</h3>
    ${importBox}
    <div class="recipe-form__field">
      <label for="recipe-nombre">Nombre *</label>
      <input type="text" id="recipe-nombre" required maxlength="200" value="${escapeHtml(r.nombre || "")}" ${ro} />
    </div>
    <div class="recipe-form__field">
      <label for="recipe-descripcion">Descripción</label>
      <textarea id="recipe-descripcion" rows="2" maxlength="1000" ${ro}>${escapeHtml(r.descripcion || "")}</textarea>
    </div>
    <div class="recipe-form__row">
      <div class="recipe-form__field">
        <label for="recipe-porciones">Porciones *</label>
        <input type="number" id="recipe-porciones" min="1" step="1" required value="${escapeHtml(r.porciones ?? "")}" ${ro} />
      </div>
      <div class="recipe-form__field">
        <label for="recipe-foto">Foto (URL)</label>
        <input type="url" id="recipe-foto" placeholder="https://…" value="${escapeHtml(r.fotoUrl || "")}" ${ro} />
      </div>
    </div>
    <div class="recipe-form__field">
      <label for="recipe-enlaces">Enlaces de referencia (uno por línea)</label>
      <textarea id="recipe-enlaces" rows="2" placeholder="https://…" ${ro}>${escapeHtml((r.enlaces || []).join("\n"))}</textarea>
    </div>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Ingredientes</legend>
      <div id="recipe-ingredientes">
        ${ingredientes.map((ing, i) => ingredienteRowHtml(ing, i)).join("")}
      </div>
      <button type="button" id="btn-add-ingrediente" class="btn btn--small">+ Ingrediente</button>
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Instrucciones</legend>
      <div id="recipe-instrucciones">
        ${instrucciones.map((paso, i) => instruccionRowHtml(paso, i)).join("")}
      </div>
      <button type="button" id="btn-add-paso" class="btn btn--small">+ Paso</button>
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Alérgenos / dieta</legend>
      <div class="recipe-form__chips" id="recipe-alergenos">
        ${alergenoTags.map((t) => chipHtml(t, alergenos.includes(t.id))).join("")}
      </div>
      ${customTagInput("alergeno", "alergeno-nueva")}
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Tipo de comida</legend>
      <div class="recipe-form__chips" id="recipe-tipos">
        ${tipoTags.map((t) => chipHtml(t, tipos.includes(t.id))).join("")}
      </div>
      ${customTagInput("tipo", "tipo-nuevo")}
    </fieldset>

    <div class="recipe-form__actions">
      <button type="button" id="btn-recipe-cancel" class="btn btn--outline">${modalReadOnly ? "Cerrar" : "Cancelar"}</button>
      ${modalReadOnly ? "" : `<button type="submit" class="btn btn--primary">Guardar</button>`}
    </div>
  </form>`;
}

function chipHtml(tag, checked) {
  return `<label class="recipe-form__chip${checked ? " is-checked" : ""}">
    <input type="checkbox" value="${escapeHtml(tag.id)}"${checked ? " checked" : ""} />
    <span>${escapeHtml(tag.label)}${tag.custom ? " (propia)" : ""}</span>
  </label>`;
}

// Campo para crear una etiqueta propia desde el propio modal.
function customTagInput(scope, id) {
  return `<div class="recipe-form__newtag">
    <input type="text" id="${id}" placeholder="Nueva etiqueta propia…" maxlength="60" autocomplete="off" aria-label="Nueva etiqueta" />
    <button type="button" class="btn btn--small" data-newtag-scope="${scope}" data-newtag-input="${id}">Añadir</button>
  </div>`;
}

function ingredienteRowHtml(ing, i) {
  return `<div class="recipe-form__ingrediente" data-row="${i}">
    <input type="text" class="ing-nombre" placeholder="Ingrediente" value="${escapeHtml(ing.nombre || "")}" list="recipe-ingredients-datalist" />
    <input type="number" class="ing-cantidad" placeholder="Cant." step="any" min="0" value="${escapeHtml(ing.cantidad ?? "")}" />
    <input type="text" class="ing-unidad" placeholder="Unidad" value="${escapeHtml(ing.unidad || "")}" />
    <select class="ing-categoria" aria-label="Categoría del ingrediente">${optionsFor("ingrediente", ing.categoriaId)}</select>
    <button type="button" class="btn btn--small btn--danger ing-remove" aria-label="Quitar ingrediente">✕</button>
  </div>`;
}

function instruccionRowHtml(paso, i) {
  return `<div class="recipe-form__paso" data-row="${i}">
    <span class="recipe-form__paso-num">${i + 1}.</span>
    <input type="text" class="paso-texto" placeholder="Paso ${i + 1}" value="${escapeHtml(paso || "")}" />
    <button type="button" class="btn btn--small btn--danger paso-remove" aria-label="Quitar paso">✕</button>
  </div>`;
}

function bindRecipeModalHandlers(content) {
  // Filas dinámicas de ingredientes e instrucciones.
  content.querySelector("#btn-add-ingrediente")?.addEventListener("click", () => {
    const wrap = content.querySelector("#recipe-ingredientes");
    wrap.insertAdjacentHTML("beforeend", ingredienteRowHtml({}, wrap.children.length));
  });
  content.querySelector("#btn-add-paso")?.addEventListener("click", () => {
    const wrap = content.querySelector("#recipe-instrucciones");
    wrap.insertAdjacentHTML("beforeend", instruccionRowHtml("", wrap.children.length));
    renumberPasos(content);
  });
  content.querySelector("#recipe-ingredientes")?.addEventListener("click", (e) => {
    const row = e.target.closest(".recipe-form__ingrediente");
    if (e.target.closest(".ing-remove") && row) row.remove();
  });
  content.querySelector("#recipe-instrucciones")?.addEventListener("click", (e) => {
    const row = e.target.closest(".recipe-form__paso");
    if (e.target.closest(".paso-remove") && row) {
      row.remove();
      renumberPasos(content);
    }
  });

  // Chips: estado visual al marcar.
  content.querySelectorAll(".recipe-form__chips").forEach((chips) => {
    chips.addEventListener("change", (e) => {
      const label = e.target.closest(".recipe-form__chip");
      if (label) label.classList.toggle("is-checked", e.target.checked);
    });
  });

  content.querySelector("#btn-recipe-cancel")?.addEventListener("click", closeRecipeModal);

  // Importación desde URL.
  content.querySelector("#btn-import-recipe")?.addEventListener("click", () => {
    importRecipeFromUrl(content.querySelector("#recipe-import-url").value, content);
  });

  // Etiquetas propias.
  content.querySelectorAll("[data-newtag-scope]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const input = content.querySelector(`#${btn.dataset.newtagInput}`);
      const name = input.value.trim();
      if (!name) return;
      try {
        await ctx.addTag(currentUser, { nombre: name, tipo: btn.dataset.newtagScope });
        input.value = "";
        showToast("Etiqueta añadida.");
      } catch (err) {
        console.error("No se pudo añadir la etiqueta:", err);
        showToast("No se pudo añadir la etiqueta.");
      }
    });
  });

  content.querySelector("#recipe-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveRecipeFromForm(content);
  });

  // Datalist de ingredientes del catálogo para autocompletar.
  const datalist = document.getElementById("recipe-ingredients-datalist");
  if (datalist) {
    datalist.innerHTML = ingredients.map((i) => `<option value="${escapeHtml(i.nombre)}"></option>`).join("");
  }
}

function renumberPasos(content) {
  content.querySelectorAll(".recipe-form__paso .recipe-form__paso-num").forEach((num, i) => {
    num.textContent = `${i + 1}.`;
  });
}

function readRecipeFromForm(content) {
  const nombre = content.querySelector("#recipe-nombre").value.trim();
  if (!nombre) {
    content.querySelector("#recipe-nombre").focus();
    throw new Error("El nombre es obligatorio.");
  }
  const porciones = Number(content.querySelector("#recipe-porciones").value);
  if (!porciones || porciones < 1) {
    content.querySelector("#recipe-porciones").focus();
    throw new Error("Las porciones son obligatorias.");
  }

  const ingredientes = [...content.querySelectorAll("#recipe-ingredientes .recipe-form__ingrediente")]
    .map((row) => {
      const ingNombre = row.querySelector(".ing-nombre").value.trim();
      if (!ingNombre) return null;
      return {
        nombre: ingNombre,
        cantidad: row.querySelector(".ing-cantidad").value === "" ? null : Number(row.querySelector(".ing-cantidad").value),
        unidad: normalizeUnit(row.querySelector(".ing-unidad").value),
        categoriaId: row.querySelector(".ing-categoria").value,
      };
    })
    .filter(Boolean);

  const instrucciones = [...content.querySelectorAll("#recipe-instrucciones .recipe-form__paso")]
    .map((row) => row.querySelector(".paso-texto").value.trim())
    .filter(Boolean);

  const alergenos = [...content.querySelectorAll("#recipe-alergenos input:checked")].map((i) => i.value);
  const tipos = [...content.querySelectorAll("#recipe-tipos input:checked")].map((i) => i.value);

  const enlaces = content.querySelector("#recipe-enlaces").value.split("\n").map((s) => s.trim()).filter(Boolean);
  // La URL pegada en «Importar desde una URL» se conserva como enlace
  // de origen aunque la extracción no haya podido leerla (CORS, etc.).
  const importUrl = content.querySelector("#recipe-import-url")?.value.trim();
  if (importUrl && !enlaces.includes(importUrl)) enlaces.unshift(importUrl);

  return {
    nombre,
    descripcion: content.querySelector("#recipe-descripcion").value.trim(),
    porciones,
    fotoUrl: content.querySelector("#recipe-foto").value.trim(),
    enlaces,
    ingredientes,
    instrucciones,
    alergenos,
    tipos,
  };
}

async function saveRecipeFromForm(content) {
  let data;
  try {
    data = readRecipeFromForm(content);
  } catch (err) {
    showToast(err.message);
    return;
  }

  try {
    if (editingRecipeId) {
      // Guardar una edición implica revisarla: se quita el distintivo
      // «Revisar» de las recetas importadas (ver manual 8.2).
      await ctx.updateRecipe(currentUser, editingRecipeId, { ...data, needsReview: false });
      showToast("Receta actualizada.");
    } else {
      const imported = Boolean(content.querySelector("#recipe-import-url")?.value.trim());
      await ctx.addRecipe(currentUser, { ...data, needsReview: imported });
      showToast(imported ? "Receta guardada (pendiente de revisar)." : "Receta guardada.");
    }
    // El catálogo de ingredientes se rellena solo (upsert por nombre).
    await syncIngredientsCatalog(data.ingredientes);
    closeRecipeModal();
  } catch (err) {
    console.error("No se pudo guardar la receta:", err);
    showToast("No se pudo guardar la receta.");
  }
}

// Añade al catálogo los ingredientes nuevos (los existentes no se tocan).
async function syncIngredientsCatalog(ingredientes) {
  const known = new Set(ingredients.map((i) => normalizeIngredientName(i.nombre)));
  for (const ing of ingredientes || []) {
    const name = normalizeIngredientName(ing.nombre);
    if (!name || known.has(name)) continue;
    known.add(name);
    try {
      await ctx.addIngredient(currentUser, { nombre: name, categoriaId: ing.categoriaId || "" });
    } catch (err) {
      console.error("No se pudo añadir el ingrediente al catálogo:", err);
    }
  }
}

// ---------- Importación desde URL ----------

async function importRecipeFromUrl(url, content) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    showToast("Pega una URL de la receta.");
    return;
  }
  // Higiene defensiva: solo protocolos http/https (bloquea data:,
  // file: y demás esquemas que el fetch del navegador no debe tocar).
  if (!/^https?:\/\//i.test(trimmed)) {
    showToast("La URL debe empezar por http:// o https://.");
    return;
  }
  const btn = content.querySelector("#btn-import-recipe");
  btn.disabled = true;
  btn.textContent = "Importando…";
  try {
    const res = await fetch(trimmed, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    // Extracción mínima con regex sobre el HTML: título, descripción
    // e imagen (og:image o el primer <img>). No es parseo semántico:
    // la receta queda marcada para revisar.
    const doc = document.implementation.createHTMLDocument("");
    doc.documentElement.innerHTML = text;
    const nombre = doc.querySelector("h1")?.textContent.trim()
      || doc.querySelector("title")?.textContent.trim()
      || "";
    const descripcion = doc.querySelector('meta[name="description"]')?.content
      || doc.querySelector('meta[property="og:description"]')?.content
      || "";
    const fotoUrl = doc.querySelector('meta[property="og:image"]')?.content
      || doc.querySelector("img")?.src
      || "";
    // Rellena el formulario con lo encontrado y marca la receta como
    // pendiente de revisión (si guarda con el formulario en este estado).
    if (nombre) {
      content.querySelector("#recipe-nombre").value = nombre;
      content.querySelector("#recipe-foto").value = fotoUrl || "";
      content.querySelector("#recipe-descripcion").value = descripcion || "";
      showToast("Datos extraídos. Repasa los campos y guarda (quedará marcada como «Revisar»).");
    } else {
      showToast("No se pudo extraer la receta de esa web; se guardará la URL y la revisarás después.");
    }
  } catch (err) {
    // CORS u otro fallo: la receta se guarda con la URL y needsReview.
    showToast("No se pudo leer esa web (bloquea la lectura desde otra página). La receta se guardará con la URL.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Importar";
  }
}
