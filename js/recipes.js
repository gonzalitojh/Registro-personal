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
  SUPERMARKETS,
  CUSTOM_CATEGORY_ICON,
  UNCATEGORIZED_ICON,
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
// Estado del catálogo de ingredientes (issue #218): categorías
// seleccionadas en el filtro (todas por defecto). El flag de "tocado"
// evita que las categorías propias recién cargadas rompan la selección
// hecha por el usuario. (El selector de ordenación se eliminó en la
// issue #224: el catálogo se muestra siempre en orden alfabético.)
let ingredientFilterTouched = false;
let activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
let ingredientModalCleanup = null;
let modalCleanup = null;
let editingRecipeId = null;
let modalReadOnly = false;
// Modo de la ventana de ingrediente (issue #232): true cuando se está
// editando. El cierre por backdrop/Escape solo aplica en modo lectura
// (patrón de la ventana de receta, issue #234); en edición las vías de
// salida son la ✕, «Cancelar» y «Guardar».
let ingredientEditMode = false;
let onRecipeDeleted = null;
// Filtros de la pestaña Recetas (issue #234): alérgenos y tipo de
// comida, multiselección con «todas» marcadas por defecto. El flag de
// "tocado" evita que las etiquetas propias recién cargadas rompan la
// selección hecha por el usuario (patrón de ingredientFilterTouched).
let recipeFilterTouched = false;
let activeAlergenoFilter = new Set(ALERGEN_TAGS.map((t) => t.id));
let activeTipoFilter = new Set(MEAL_TYPES.map((t) => t.id));

// Renderers de las otras pestañas (registrados por menu.js y
// shopping-list.js): openRecipes los llama al activar su tab.
const tabRenderers = {};

export function registerTabRenderer(tab, fn) {
  tabRenderers[tab] = fn;
}

export function getRecipes() {
  return recipes;
}

// Etiquetas personalizadas del usuario (users/{uid}/tags). La pestaña
// Menú (menu.js) las necesita para el buscador de recetas (issue #242).
export function getCustomTags() {
  return customTags;
}

// Catálogo de ingredientes (users/{uid}/ingredients). La lista de la
// compra (shopping-list.js) lo consulta para la cantidad por paquete
// (issue #225): paqueteCantidad + paqueteUnidad (issue #224).
export function getIngredients() {
  return ingredients;
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetRecipesData() {
  recipes = [];
  ingredients = [];
  customTags = [];
  currentTab = "recetas";
  ingredientFilterTouched = false;
  activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
  recipeFilterTouched = false;
  activeAlergenoFilter = new Set(ALERGEN_TAGS.map((t) => t.id));
  activeTipoFilter = new Set(MEAL_TYPES.map((t) => t.id));
  closeIngredientModal();
  closeIngredientFilterPanel();
  closeRecipeAlergenoFilterPanel();
  closeRecipeTipoFilterPanel();
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
  // Backdrop y Escape (issue #234): solo cierran en modo lectura. En
  // edición se bloquean para no perder el progreso del formulario; la
  // ✕ y «Cancelar» siguen siendo las vías explícitas de cierre.
  document.getElementById("recipe-modal-backdrop").addEventListener("click", () => {
    if (modalReadOnly) closeRecipeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("recipe-modal").classList.contains("hidden") && modalReadOnly) {
      e.preventDefault();
      closeRecipeModal();
    }
  });

  // Modal de ingrediente (issue #218): cierre por ✕, backdrop y Escape.
  // Backdrop y Escape (issue #232): solo cierran en modo lectura; en
  // edición se bloquean para no perder el progreso del formulario (la
  // ✕, «Cancelar» y «Guardar» son las vías explícitas).
  document.getElementById("ingredient-modal-close").addEventListener("click", closeIngredientModal);
  document.getElementById("ingredient-modal-backdrop").addEventListener("click", () => {
    if (!ingredientEditMode) closeIngredientModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("ingredient-modal").classList.contains("hidden") && !ingredientEditMode) {
      e.preventDefault();
      closeIngredientModal();
    }
  });

  // Barra de herramientas del catálogo de ingredientes (issue #218).
  document.getElementById("btn-new-ingredient").addEventListener("click", () => openIngredientModal(null));
  setupIngredientFilter();

  // Delegación de acciones de las cards de ingredientes: la tarjeta es
  // un <button> con el nombre; al pulsarla se abre el modal de detalle.
  document.getElementById("ingredients-catalog").addEventListener("click", (e) => {
    const card = e.target.closest("[data-ingredient-id]");
    if (!card) return;
    openIngredientModal(card.dataset.ingredientId);
  });

  // Delegación de acciones de las cards de recetas (issue #234): la
  // tarjeta entera es el botón; al pulsarla se abre el detalle en modo
  // solo lectura (ya no hay botones Ver/Editar/Eliminar en la tarjeta).
  document.getElementById("recipes-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-recipe-id]");
    if (!card) return;
    const recipe = recipes.find((r) => r.id === card.dataset.recipeId);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });
  // Soporte de teclado para la tarjeta (role="button" + tabindex): Enter
  // o Espacio abren el detalle igual que el click.
  document.getElementById("recipes-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-recipe-id]");
    if (!card) return;
    e.preventDefault();
    const recipe = recipes.find((r) => r.id === card.dataset.recipeId);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });

  setupRecipeFilters();

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
    // El filtro por defecto incluye todas las etiquetas: si el usuario
    // aún no lo ha tocado, las propias recién cargadas se suman a los
    // Sets de los filtros de la pestaña Recetas (issue #234) y a los
    // del catálogo de Ingredientes.
    if (!ingredientFilterTouched) {
      ingredientFilterCategoryIds().forEach((id) => activeCategoryFilter.add(id));
      if (currentTab === "ingredientes") {
        updateIngredientFilterLabel();
        renderIngredientsCatalog();
      }
    }
    if (!recipeFilterTouched) {
      recipeFilterTagIds("alergeno").forEach((id) => activeAlergenoFilter.add(id));
      recipeFilterTagIds("tipo").forEach((id) => activeTipoFilter.add(id));
      if (currentTab === "recetas") {
        updateRecipeAlergenoFilterLabel();
        updateRecipeTipoFilterLabel();
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

  // Si los paneles de filtro quedaron abiertos, cerrarlos al
  // cambiar de pestaña (evita estado obsoleto al volver).
  if (tab !== "ingredientes") closeIngredientFilterPanel();
  if (tab !== "recetas") {
    closeRecipeAlergenoFilterPanel();
    closeRecipeTipoFilterPanel();
  }

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

  // Filtros de la pestaña (issue #234): alérgenos y tipo de comida.
  const filtered = recipes.filter((r) => recipeMatchesAlergenoFilter(r) && recipeMatchesTipoFilter(r));
  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">Ninguna receta coincide con los filtros seleccionados.
      Ajusta los filtros de alérgenos o tipo de comida para ver más.</p>`;
    return;
  }

  container.innerHTML = `<div class="recipes-grid">
    ${filtered.map(recipeCardHtml).join("")}
  </div>`;
}

// Coincidencia de una receta con el filtro de alérgenos (issue #234):
// con «todas» seleccionadas (por defecto) pasa todo; si no, la receta
// debe estar marcada con al menos uno de los alérgenos elegidos. Las
// recetas sin alérgenos marcados pasan siempre (como los ingredientes
// sin categoría en el catálogo). Mismo criterio para el tipo de comida.
function recipeMatchesAlergenoFilter(r) {
  if (recipeFilterAllChecked(activeAlergenoFilter, "alergeno")) return true;
  return !(r.alergenos || []).length || (r.alergenos || []).some((id) => activeAlergenoFilter.has(id));
}

function recipeMatchesTipoFilter(r) {
  if (recipeFilterAllChecked(activeTipoFilter, "tipo")) return true;
  return !(r.tipos || []).length || (r.tipos || []).some((id) => activeTipoFilter.has(id));
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
  // La tarjeta entera es el botón (issue #234): al pulsarla se abre el
  // detalle en modo lectura. role="button" + tabindex para teclado.
  // Las etiquetas llevan el mismo color por tipo que en la vista de
  // lectura (issue #236, iteración): alérgenos en teal y tipo en ocre.
  const alergenoTags = alergenos.map((t) => `<span class="recipe-card__tag recipe-card__tag--alergeno">${escapeHtml(t.label)}</span>`).join("");
  const tipoTags = tipos.map((t) => `<span class="recipe-card__tag recipe-card__tag--tipo">${escapeHtml(t.label)}</span>`).join("");
  return `<article class="recipe-card${r.needsReview ? " recipe-card--review" : ""}"
    role="button" tabindex="0" data-recipe-id="${r.id}"
    aria-label="Ver receta ${escapeHtml(r.nombre)}">
    <div class="recipe-card__top">
      <h3 class="recipe-card__title">${escapeHtml(r.nombre)}</h3>
      ${badge}
    </div>
    ${r.fotoUrl ? `<img class="recipe-card__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
    <p class="recipe-card__meta">
      ${Number(r.porciones) ? `${formatCantidad(r.porciones)} porciones` : ""}
      ${r.ingredientes?.length ? ` · ${r.ingredientes.length} ingredientes` : ""}
    </p>
    ${(alergenoTags || tipoTags) ? `<p class="recipe-card__tags">${alergenoTags}${tipoTags}</p>` : ""}
  </article>`;
}

async function deleteRecipeFlow(recipe) {
  if (!confirm(`¿Eliminar la receta «${recipe.nombre}»?`)) return false;
  try {
    await ctx.deleteRecipe(currentUser, recipe.id);
    // Limpiar referencias en los menús (si app.js inyectó el callback).
    if (onRecipeDeleted) onRecipeDeleted(recipe.id);
    showToast("Receta eliminada.");
    return true;
  } catch (err) {
    console.error("No se pudo eliminar la receta:", err);
    showToast("No se pudo eliminar la receta.");
    return false;
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
// en el modal de detalle («Usada en»).
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

  const sorted = [...ingredients].sort(compareIngredients);
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
  // por orden alfabético de etiqueta y «Sin categoría» al final. Cada
  // título lleva su icono (issue #224): el de la categoría predefinida,
  // el genérico de etiqueta para las propias y el de «Sin categoría».
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
        <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${c.icon}</span>${escapeHtml(c.label)}</h3>
        <div class="ingredient-grid">
          ${items.map((ing) => ingredientCardHtml(ing)).join("")}
        </div>
      </section>`;
    }).join("")}
    ${customGroupIds.map((id) => `<section class="ingredient-group">
      <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${CUSTOM_CATEGORY_ICON}</span>${escapeHtml(tagLabel("ingrediente", id))}</h3>
      <div class="ingredient-grid">
        ${groups.get(id).map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>`).join("")}
    ${groups.get("").length ? `<section class="ingredient-group">
      <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${UNCATEGORIZED_ICON}</span>Sin categoría</h3>
      <div class="ingredient-grid">
        ${groups.get("").map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>` : ""}`;
}

// Comparador del catálogo: orden alfabético A-Z (es) con tie-break
// determinista por id. (El selector de ordenación se eliminó en la
// issue #224 y solo existe este orden.)
function compareIngredients(a, b) {
  return a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id);
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

// ---------- Filtros de la pestaña Recetas (issue #234) ----------

// Checkboxes de los paneles de filtro: «Todas» + las etiquetas
// (predefinidas y propias del usuario). Mismo patrón que el filtro por
// categorías del catálogo de ingredientes (issue #218): el panel se
// pinta solo al abrir; los cambios posteriores solo alternan clases
// is-checked (sin re-render) y el filtrado se aplica en vivo.

// Ids de todas las etiquetas visibles en el panel de un scope
// (predefinidas + propias).
function recipeFilterTagIds(scope) {
  return mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  ).map((t) => t.id);
}

// «Todas» está marcado si y solo si TODAS las etiquetas del panel
// (predefinidas y propias) están en el filtro.
function recipeFilterAllChecked(activeSet, scope) {
  const ids = recipeFilterTagIds(scope);
  return ids.length > 0 && ids.every((id) => activeSet.has(id));
}

// Config de los dos filtros (ids de los elementos del DOM por scope).
const RECIPE_FILTER_UI = {
  alergeno: {
    btnId: "btn-recipe-alergeno-filter",
    panelId: "recipe-alergeno-filter-panel",
    labelId: "recipe-alergeno-filter-label",
  },
  tipo: {
    btnId: "btn-recipe-tipo-filter",
    panelId: "recipe-tipo-filter-panel",
    labelId: "recipe-tipo-filter-label",
  },
};

// Referencia a los manejadores de Escape de cada panel (registrados al
// abrirlo; se guardan para poder desregistrarlos desde el cierre).
const recipeFilterEscHandlers = {};

function recipeFilterActiveSet(scope) {
  return scope === "alergeno" ? activeAlergenoFilter : activeTipoFilter;
}

function recipeFilterSetActive(scope, set) {
  if (scope === "alergeno") activeAlergenoFilter = set;
  else activeTipoFilter = set;
}

function renderRecipeFilterPanel(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const tags = mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  );
  const activeSet = recipeFilterActiveSet(scope);
  const allChecked = recipeFilterAllChecked(activeSet, scope);
  panel.innerHTML = `<label class="recipes-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todos</span>
    </label>
    <div class="recipes-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = activeSet.has(t.id);
      return `<label class="recipes-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

function updateRecipeAlergenoFilterLabel() {
  updateRecipeFilterLabel("alergeno");
}

function updateRecipeTipoFilterLabel() {
  updateRecipeFilterLabel("tipo");
}

function updateRecipeFilterLabel(scope) {
  const { labelId } = RECIPE_FILTER_UI[scope];
  const label = document.getElementById(labelId);
  if (!label) return;
  const activeSet = recipeFilterActiveSet(scope);
  if (recipeFilterAllChecked(activeSet, scope)) {
    label.textContent = scope === "alergeno" ? "Todos los alérgenos" : "Todos los tipos";
    return;
  }
  const n = activeSet.size;
  const word = scope === "alergeno" ? "alérgeno" : "tipo";
  label.textContent = `${n} ${n === 1 ? word : word + "s"}`;
}

// Toggle de la marca del checkbox «Todas» (marcado solo si lo están
// todas las etiquetas del panel).
function syncRecipeFilterAll(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const all = document.querySelector(`#${panelId} .recipes-filter__all`);
  if (!all) return;
  const checked = recipeFilterAllChecked(recipeFilterActiveSet(scope), scope);
  all.classList.toggle("is-checked", checked);
  const input = all.querySelector("input");
  input.checked = checked;
}

// Marca visual de cada casilla en tiempo real (patrón de
// syncIngredientFilterItems): la fuente de verdad es el Set activo, no
// input.checked.
function syncRecipeFilterItems(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const activeSet = recipeFilterActiveSet(scope);
  document.querySelectorAll(`#${panelId} .recipes-filter__item`).forEach((item) => {
    const input = item.querySelector("input");
    if (!input) return;
    const checked = activeSet.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

function closeRecipeFilterPanel(scope) {
  const { panelId, btnId } = RECIPE_FILTER_UI[scope];
  const panel = document.getElementById(panelId);
  const btn = document.getElementById(btnId);
  if (!panel || panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  if (recipeFilterEscHandlers[scope]) {
    document.removeEventListener("keydown", recipeFilterEscHandlers[scope]);
    delete recipeFilterEscHandlers[scope];
  }
}

function closeRecipeAlergenoFilterPanel() {
  closeRecipeFilterPanel("alergeno");
}

function closeRecipeTipoFilterPanel() {
  closeRecipeFilterPanel("tipo");
}

function setupRecipeFilters() {
  ["alergeno", "tipo"].forEach((scope) => {
    const { btnId, panelId } = RECIPE_FILTER_UI[scope];
    const wrap = document.getElementById(`recipes-${scope}-filter`);
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    if (!wrap || !panel || !btn) return;

    const escHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRecipeFilterPanel(scope);
        btn.focus();
      }
    };

    btn.addEventListener("click", () => {
      if (panel.classList.contains("hidden")) {
        renderRecipeFilterPanel(scope);
        panel.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
        recipeFilterEscHandlers[scope] = escHandler;
        document.addEventListener("keydown", escHandler);
      } else {
        closeRecipeFilterPanel(scope);
        btn.focus();
      }
    });

    // Click fuera del wrapper: cerrar (patrón del dropdown de perfil).
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target) && !panel.classList.contains("hidden")) {
        closeRecipeFilterPanel(scope);
      }
    });

    panel.addEventListener("change", (e) => {
      const input = e.target.closest("input[type='checkbox']");
      if (!input) return;
      recipeFilterTouched = true;
      if (input.value === "__all__") {
        recipeFilterSetActive(
          scope,
          input.checked ? new Set(recipeFilterTagIds(scope)) : new Set()
        );
      } else if (input.checked) {
        recipeFilterActiveSet(scope).add(input.value);
      } else {
        recipeFilterActiveSet(scope).delete(input.value);
      }
      // Marca visual y filtro en vivo (patrón del catálogo).
      syncRecipeFilterAll(scope);
      syncRecipeFilterItems(scope);
      updateRecipeFilterLabel(scope);
      renderRecipesList();
    });
  });
}

// ---------- Modal de ingrediente (issue #218) ----------

// Unidades disponibles para la cantidad del paquete (issue #224); la
// primera opción vacía («—») significa sin especificar.
const PACKAGE_UNITS = ["", "g", "Kg", "mL", "L", "unidades"];

// Chips de supermercados (issue #224): las mismas etiquetas en el alta
// y en el detalle. `selected` son los ids marcados (en el alta, nada).
function supermarketChipsHtml(selected = []) {
  return SUPERMARKETS.map((s) => {
    const checked = selected.includes(s.id);
    return `<label class="supermarket-chip supermarket-chip--${s.id}${checked ? " is-checked" : ""}" data-supermercado="${s.id}">
      <input type="checkbox" value="${s.id}"${checked ? " checked" : ""} />
      <span>${escapeHtml(s.label)}</span>
    </label>`;
  }).join("");
}

// Fila «Cantidad del paquete» (número + unidad, issue #224): los ids
// son los mismos en el alta y en el detalle para reutilizar lecturas.
function packageQtyRowHtml(ing = {}) {
  const cantidad = ing.paqueteCantidad ?? "";
  const unidad = ing.paqueteUnidad || "";
  return `<div class="ingredient-modal__qty-row">
    <input type="number" id="ing-modal-paquete" min="0" step="any" placeholder="Cantidad" value="${escapeHtml(cantidad)}" />
    <select id="ing-modal-unidad" aria-label="Unidad de la cantidad del paquete">
      ${PACKAGE_UNITS.map((u) => `<option value="${escapeHtml(u)}"${u === unidad ? " selected" : ""}>${u === "" ? "—" : escapeHtml(u)}</option>`).join("")}
    </select>
  </div>`;
}

// Abre el modal de ingrediente: con id = detalle ampliado (categoría,
// recetas que lo usan, eliminar); sin id = alta manual. Por defecto
// (issue #232) el detalle se muestra en modo lectura; con `edit: true`
// se abre directamente la vista de edición. `onCreated` (issue #240)
// se llama al guardar un alta manual con el ingrediente recién creado
// ({ nombre, categoriaId }), para que el formulario de receta pueda
// usarlo al momento.
function openIngredientModal(id, { edit = false, onCreated = null } = {}) {
  const modal = document.getElementById("ingredient-modal");
  const content = document.getElementById("ingredient-modal-content");
  const ingredient = id ? ingredients.find((i) => i.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");
  ingredientEditMode = edit;

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    ingredient ? `Ingrediente: ${ingredient.nombre}` : "Nuevo ingrediente"
  );
  content.innerHTML = ingredient
    ? (edit ? ingredientEditHtml(ingredient) : ingredientDetailHtml(ingredient))
    : ingredientNewHtml();
  bindIngredientModalHandlers(content, ingredient, onCreated);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  // Re-render en caliente (lectura → edición o viceversa): liberar el
  // trap de foco anterior antes de crear el nuevo.
  if (ingredientModalCleanup) ingredientModalCleanup();
  ingredientModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // En el alta manual y al entrar en edición, foco directo al nombre
  // para escribir ya. Se hace en un segundo rAF tras el de trapFocus
  // (que enfoca la ✕, el primer enfocable): los callbacks del mismo
  // frame corren en orden, así el foco final queda en el input y el
  // trap no se rompe.
  if (!ingredient || edit) {
    requestAnimationFrame(() => {
      content.querySelector("#ing-modal-nombre")?.focus({ preventScroll: false });
    });
  }
}

function closeIngredientModal() {
  const modal = document.getElementById("ingredient-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  ingredientEditMode = false;
  if (ingredientModalCleanup) {
    ingredientModalCleanup();
    ingredientModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Vista de solo lectura de la ventana de ingrediente (issue #232): el
// nombre como título, la foto solo si existe (sin placeholder ni "sin
// imagen" cuando no hay), la categoría y la cantidad del paquete como
// texto y los supermercados como etiquetas no interactivas. Sin botón
// «Cerrar» (queda la ✕) y sin el texto «Categoría actual: …».
function ingredientDetailHtml(ing) {
  const byName = getUsageIndex();
  const usedRecipes = recipes.filter((r) =>
    (byName.get(normalizeIngredientName(ing.nombre)) || new Set()).has(r.id)
  );
  const catLabel = tagLabel("ingrediente", ing.categoriaId);
  const qtyText = ing.paqueteCantidad != null && ing.paqueteCantidad !== ""
    ? `${ing.paqueteCantidad}${ing.paqueteUnidad ? ` ${ing.paqueteUnidad}` : ""}`
    : "Sin indicar";
  const supers = (ing.supermercados || [])
    .map((id) => SUPERMARKETS.find((s) => s.id === id))
    .filter(Boolean);
  return `<div class="ingredient-modal__view">
    ${ing.fotoUrl ? `<img class="ingredient-modal__photo" src="${escapeHtml(ing.fotoUrl)}" alt="" loading="lazy" />` : ""}
    <h3 class="ingredient-modal__title">${escapeHtml(ing.nombre)}</h3>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Categoría</span>
      <p class="ingredient-modal__text">${catLabel ? escapeHtml(catLabel) : "Sin categoría"}</p>
    </div>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Supermercados</span>
      ${supers.length
        ? `<div class="ingredient-modal__chips">${supers.map((s) => `<span class="supermarket-tag supermarket-tag--${s.id}">${escapeHtml(s.label)}</span>`).join("")}</div>`
        : `<p class="ingredient-modal__text">Sin indicar</p>`}
    </div>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Cantidad del paquete</span>
      <p class="ingredient-modal__text">${escapeHtml(qtyText)}</p>
    </div>
    ${usedRecipes.length ? `<p class="ingredient-modal__used">Usada en ${usedRecipes.length}
      ${usedRecipes.length === 1 ? "receta" : "recetas"}:
      ${usedRecipes.map((r) =>
        `<button type="button" class="ingredient-modal__link" data-recipe-id="${r.id}">${escapeHtml(r.nombre)}</button>`).join(", ")}</p>`
      : `<p class="ingredient-modal__used">No se usa en ninguna receta aún.</p>`}
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-ing-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-ing-edit>✏️ Editar</button>
    </div>
  </div>`;
}

// Vista de edición de la ventana de ingrediente (issue #232): se editan
// nombre, foto (URL), categoría, supermercados y cantidad del paquete,
// y se guardan todos juntos con «Guardar» (a diferencia del guardado
// inmediato anterior, aquí el formulario persiste en bloque).
function ingredientEditHtml(ing) {
  return `<form id="ingredient-edit-form" class="ingredient-modal__form">
    <h3 class="ingredient-modal__title">Editar ingrediente</h3>
    <div class="ingredient-modal__field">
      <label for="ing-modal-nombre">Nombre *</label>
      <input type="text" id="ing-modal-nombre" required maxlength="200" autocomplete="off"
             value="${escapeHtml(ing.nombre)}" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-foto">Foto (URL)</label>
      <input type="url" id="ing-modal-foto" placeholder="https://…" autocomplete="off"
             value="${escapeHtml(ing.fotoUrl || "")}" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-categoria">Categoría</label>
      <select id="ing-modal-categoria" aria-label="Categoría de ${escapeHtml(ing.nombre)}">
        ${optionsFor("ingrediente", ing.categoriaId)}
      </select>
    </div>
    <div class="ingredient-modal__field">
      <label>Supermercados</label>
      <div class="ingredient-modal__chips">
        ${supermarketChipsHtml(ing.supermercados || [])}
      </div>
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-paquete">Cantidad del paquete</label>
      ${packageQtyRowHtml(ing)}
    </div>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--outline" data-ing-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
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
    <div class="ingredient-modal__field">
      <label>Supermercados</label>
      <div class="ingredient-modal__chips">
        ${supermarketChipsHtml()}
      </div>
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-paquete">Cantidad del paquete</label>
      ${packageQtyRowHtml()}
    </div>
    <p class="ingredient-modal__cat-hint">Si el ingrediente ya está en el catálogo, no se añadirá otra vez.</p>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small" data-ing-close>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function bindIngredientModalHandlers(content, ingredient, onCreated = null) {
  content.querySelector("[data-ing-close]")?.addEventListener("click", closeIngredientModal);

  // Edición (issue #232): Cancelar vuelve a la vista de lectura sin
  // guardar; el formulario Guardar persiste en bloque todos los campos.
  content.querySelector("[data-ing-cancel]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id);
  });

  // Chips de supermercados: la marca visual cambia al instante en el
  // alta y en la edición; el guardado de la edición se hace en bloque
  // con «Guardar» (issue #232), no al momento.
  content.querySelectorAll(".ingredient-modal__chips").forEach((chips) => {
    chips.addEventListener("change", (e) => {
      const label = e.target.closest("[data-supermercado]");
      if (!label) return;
      label.classList.toggle("is-checked", e.target.checked);
    });
  });

  // Vista de lectura (issue #232): el lápiz pasa a modo edición; el
  // botón «Cerrar» inferior desapareció (queda la ✕ superior).
  content.querySelector("[data-ing-edit]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id, { edit: true });
  });
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

  // Guardado en bloque de la vista de edición (issue #232): nombre,
  // foto (URL), categoría, supermercados y cantidad del paquete se
  // persisten de una vez con updateIngredient; luego se vuelve a la
  // vista de lectura mostrando los datos guardados.
  content.querySelector("#ingredient-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = content.querySelector("#ing-modal-nombre").value.trim();
    if (!nombre) return;
    const fotoUrl = content.querySelector("#ing-modal-foto").value.trim();
    const categoriaId = content.querySelector("#ing-modal-categoria").value;
    const supermercados = [...content.querySelectorAll(".ingredient-modal__chips input:checked")].map((i) => i.value);
    const qtyRaw = content.querySelector("#ing-modal-paquete").value;
    const qtyNum = qtyRaw === "" ? null : Number(qtyRaw);
    const paqueteCantidad = qtyNum !== null && Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : null;
    const paqueteUnidad = content.querySelector("#ing-modal-unidad").value;
    try {
      await ctx.updateIngredient(currentUser, ingredient.id, {
        nombre, fotoUrl, categoriaId, supermercados, paqueteCantidad, paqueteUnidad,
      });
      // Refresco local inmediato (el snapshot de Firestore llega
      // después): la vista de lectura muestra ya los datos guardados.
      const idx = ingredients.findIndex((i) => i.id === ingredient.id);
      if (idx !== -1) {
        ingredients[idx] = { ...ingredients[idx], nombre, fotoUrl, categoriaId, supermercados, paqueteCantidad, paqueteUnidad };
      }
      openIngredientModal(ingredient.id);
      showToast("Ingrediente actualizado.");
    } catch (err) {
      console.error("No se pudo actualizar el ingrediente:", err);
      showToast("No se pudo actualizar el ingrediente.");
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

  // Alta manual: el nombre se guarda tal cual se escribió (tildes y
  // mayúsculas, issue #224); la deduplicación sigue por nombre
  // normalizado (sin tildes, minúsculas).
  content.querySelector("#ingredient-new-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = content.querySelector("#ing-modal-nombre").value.trim();
    if (!raw) return;
    const nombre = raw;
    const exists = ingredients.some((i) => normalizeIngredientName(i.nombre) === normalizeIngredientName(raw));
    if (exists) {
      showToast("Ese ingrediente ya existe en el catálogo.");
      return;
    }
    const categoriaId = content.querySelector("#ing-modal-categoria-nueva").value;
    // Campos opcionales (issue #224): supermercados marcados (array de
    // ids) y cantidad del paquete (número, vacío → null; unidad).
    const supermercados = [...content.querySelectorAll(".ingredient-modal__chips input:checked")].map((i) => i.value);
    const qtyRaw = content.querySelector("#ing-modal-paquete").value;
    const qtyNum = qtyRaw === "" ? null : Number(qtyRaw);
    const paqueteCantidad = qtyNum !== null && Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : null;
    const paqueteUnidad = content.querySelector("#ing-modal-unidad").value;
    try {
      await ctx.addIngredient(currentUser, { nombre, categoriaId, supermercados, paqueteCantidad, paqueteUnidad });
      closeIngredientModal();
      showToast("Ingrediente añadido al catálogo.");
      if (onCreated) onCreated({ nombre, categoriaId });
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

// Callback opcional de cierre del modal (issue #242): lo usa menu.js
// para restaurar el buscador de recetas al cerrar la ventana de
// lectura abierta desde el menú. Se invoca siempre al cerrar y se
// limpia después, para que no se acumulen callbacks de una apertura.
// La transición lectura → edición (openRecipeModal sin onClose)
// NO lo pisa: el callback sigue vivo hasta que el modal se cierre.
let recipeModalCloseCb = null;

export function openRecipeModal(recipe = null, { readOnly = false, onClose = null } = {}) {
  const modal = document.getElementById("recipe-modal");
  const content = document.getElementById("recipe-modal-content");
  const wasHidden = modal.classList.contains("hidden");
  editingRecipeId = recipe?.id || null;
  modalReadOnly = readOnly;
  if (onClose) recipeModalCloseCb = onClose;

  content.innerHTML = recipeModalHtml(recipe);
  bindRecipeModalHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  // Re-render en caliente (p. ej. lectura → edición): liberar el trap
  // de foco anterior antes de crear el nuevo.
  if (modalCleanup) modalCleanup();
  modalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // Transición a modo edición: el foco va al primer campo del form.
  if (!wasHidden && !modalReadOnly && recipe) {
    requestAnimationFrame(() => {
      content.querySelector("#recipe-nombre")?.focus({ preventScroll: false });
    });
  }
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
  // Callback de cierre (issue #242): restaurar el buscador del menú.
  const cb = recipeModalCloseCb;
  recipeModalCloseCb = null;
  if (cb) cb();
}

function recipeModalHtml(recipe) {
  // Modo lectura (issue #236): no es el formulario con campos
  // deshabilitados, sino una vista de texto propia (foto, nombre como
  // título, etiquetas, descripción, porciones, listas y enlaces).
  if (modalReadOnly && recipe) return recipeReadOnlyHtml(recipe);
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
      <div class="recipe-form__ingredientes-actions">
        <button type="button" id="btn-add-ingrediente" class="btn btn--small">+ Ingrediente</button>
        <button type="button" id="btn-nuevo-ingrediente-receta" class="btn btn--small">+ Nuevo ingrediente</button>
      </div>
      <p class="recipe-form__hint">Los ingredientes se eligen del catálogo (con buscador); la categoría viene de
        ahí. Con «Nuevo ingrediente» lo creas al momento si no está.</p>
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
      ${modalReadOnly
        ? `<button type="button" class="btn btn--small btn--danger" data-recipe-delete>Eliminar</button>
           <button type="button" class="btn btn--small" data-recipe-edit>✎ Editar</button>`
        : `<button type="button" id="btn-recipe-cancel" class="btn btn--outline">Cancelar</button>
           <button type="submit" class="btn btn--primary">Guardar</button>`}
    </div>
  </form>`;
}

// Vista de receta en modo lectura (issue #236): un render propio,
// como texto legible (no como el formulario con campos deshabilitados).
// Orden: foto, nombre como título con las etiquetas (alérgenos y tipo
// diferenciados por color), descripción, porciones, ingredientes en
// lista (solo nombre y cantidad), instrucciones numeradas y enlaces de
// referencia al final si los hay. No se muestran nombres de campo.
function recipeReadOnlyHtml(recipe) {
  const r = recipe || {};
  const alergenos = tagsByIds(ALERGEN_TAGS, customTags, r.alergenos || []);
  const tipos = tagsByIds(MEAL_TYPES, customTags, r.tipos || []);
  const ingredientes = r.ingredientes || [];
  const instrucciones = r.instrucciones || [];
  const enlaces = r.enlaces || [];

  const foto = r.fotoUrl
    ? `<img class="recipe-view__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />`
    : "";
  const tags = alergenos.length || tipos.length
    ? `<div class="recipe-view__tags">
        ${alergenos.map((t) => `<span class="recipe-view__tag recipe-view__tag--alergeno">${escapeHtml(t.label)}</span>`).join("")}
        ${tipos.map((t) => `<span class="recipe-view__tag recipe-view__tag--tipo">${escapeHtml(t.label)}</span>`).join("")}
      </div>`
    : "";
  const descripcion = r.descripcion
    ? `<p class="recipe-view__descripcion">${escapeHtml(r.descripcion)}</p>`
    : "";
  const porciones = Number(r.porciones)
    ? `<p class="recipe-view__meta">${formatCantidad(r.porciones)} porciones</p>`
    : "";
  const ingredientesHtml = ingredientes.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Ingredientes</h4>
        <ul class="recipe-view__list">
          ${ingredientes.map((i) => `<li class="recipe-view__ingrediente">
            <span class="recipe-view__ing-nombre">${escapeHtml(i.nombre)}</span>
            ${cantidadRecetaHtml(i)}
          </li>`).join("")}
        </ul>
      </section>`
    : "";
  const instruccionesHtml = instrucciones.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Instrucciones</h4>
        <ol class="recipe-view__list recipe-view__pasos">
          ${instrucciones.map((p) => `<li class="recipe-view__paso">${escapeHtml(p)}</li>`).join("")}
        </ol>
      </section>`
    : "";
  const enlacesHtml = enlaces.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Enlaces</h4>
        <ul class="recipe-view__list recipe-view__links">
          ${enlaces.map((url) => `<li>${enlaceRecetaHtml(url)}</li>`).join("")}
        </ul>
      </section>`
    : "";

  return `<div class="recipe-view">
    ${foto}
    <h3 class="recipe-view__title">${escapeHtml(r.nombre)}</h3>
    ${tags}
    ${descripcion}
    ${porciones}
    ${ingredientesHtml}
    ${instruccionesHtml}
    ${enlacesHtml}
    <div class="recipe-view__actions">
      <button type="button" class="btn btn--small btn--danger" data-recipe-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-recipe-edit>✎ Editar</button>
    </div>
  </div>`;
}

// Cantidad de un ingrediente en la vista de lectura: "200 g" o vacío.
// Se muestra junto al nombre (la categoría no se muestra, issue #236).
function cantidadRecetaHtml(ing) {
  const cantidad = ing.cantidad ?? "";
  const unidad = (ing.unidad || "").trim();
  const partes = [cantidad !== "" && cantidad !== null ? formatCantidad(cantidad) : "", unidad].filter(Boolean);
  if (!partes.length) return "";
  return `<span class="recipe-view__ing-cantidad">${partes.map(escapeHtml).join(" ")}</span>`;
}

// Enlace de referencia en la vista de lectura. Higiene defensiva: solo
// los esquemas http/https son clickeables (un `javascript:` pegado a
// mano en el formulario no debe ejecutarse al pulsar); el resto se
// muestra como texto plano.
function enlaceRecetaHtml(url) {
  const texto = escapeHtml(url);
  return /^https?:\/\//i.test(url)
    ? `<a class="recipe-view__link" href="${texto}" target="_blank" rel="noopener noreferrer">${texto}</a>`
    : texto;
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

// Categoría de un ingrediente de receta (issue #240): la fuente de
// verdad es el catálogo (el formulario ya no la selecciona); si el
// nombre no está en el catálogo (p. ej. se eliminó de él), se conserva
// el valor guardado en la receta para no perder el dato.
function ingredientCategoriaDe(nombre, guardada) {
  if (!nombre) return guardada || "";
  const cat = ingredients.find((i) => normalizeIngredientName(i.nombre) === normalizeIngredientName(nombre));
  return cat ? (cat.categoriaId || "") : (guardada || "");
}

// Fila de ingrediente del formulario de receta (issue #240): el nombre
// ya no se escribe libremente ni se elige categoría. Es un combobox con
// buscador sobre el catálogo de ingredientes (input + desplegable); la
// selección queda en los hidden .ing-nombre-valor / .ing-categoria-valor,
// que son los que lee readRecipeFromForm al guardar. El texto libre que
// no corresponda a una opción no selecciona nada (la fila se ignora).
function ingredienteRowHtml(ing, i) {
  const nombre = ing.nombre || "";
  return `<div class="recipe-form__ingrediente" data-row="${i}">
    <div class="ing-combo">
      <input type="text" class="ing-nombre" placeholder="Buscar ingrediente…" value="${escapeHtml(nombre)}"
             role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"
             aria-label="Ingrediente (elige uno del catálogo)" />
      <button type="button" class="ing-combo__toggle" aria-label="Elegir ingrediente del catálogo" tabindex="-1">▾</button>
      <ul class="ing-combo__list" role="listbox" hidden></ul>
      <input type="hidden" class="ing-nombre-valor" value="${escapeHtml(nombre)}" />
      <input type="hidden" class="ing-categoria-valor" value="${escapeHtml(ingredientCategoriaDe(nombre, ing.categoriaId))}" />
    </div>
    <input type="number" class="ing-cantidad" placeholder="Cant." step="any" min="0" value="${escapeHtml(ing.cantidad ?? "")}" />
    <input type="text" class="ing-unidad" placeholder="Unidad" value="${escapeHtml(ing.unidad || "")}" />
    <button type="button" class="btn btn--small btn--danger ing-remove" aria-label="Quitar ingrediente">✕</button>
  </div>`;
}

// Pinta las opciones del desplegable de un combobox de ingrediente:
// las del catálogo que coinciden con el texto tecleado (orden
// alfabético), más el valor ya seleccionado de la fila si no está en el
// catálogo (dato legado que se conserva visible y elegible).
function renderIngredienteComboList(combo) {
  const list = combo.querySelector(".ing-combo__list");
  const texto = combo.querySelector(".ing-nombre").value.trim();
  const norm = normalizeIngredientName(texto);
  const matches = ingredients
    .filter((i) => !norm || normalizeIngredientName(i.nombre).includes(norm))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const currentVal = combo.querySelector(".ing-nombre-valor").value;
  const matched = new Set(matches.map((i) => normalizeIngredientName(i.nombre)));
  if (currentVal && !matched.has(normalizeIngredientName(currentVal))) {
    matches.unshift({ nombre: currentVal, categoriaId: combo.querySelector(".ing-categoria-valor").value });
  }
  list.innerHTML = matches.length
    ? matches.map((i) => `<li role="option" data-nombre="${escapeHtml(i.nombre)}" data-categoria="${escapeHtml(i.categoriaId || "")}">${escapeHtml(i.nombre)}</li>`).join("")
    : `<li role="option" class="ing-combo__empty" aria-disabled="true">Sin coincidencias. Crea el ingrediente con «Nuevo ingrediente».</li>`;
}

// Comportamiento del combobox de ingrediente (issue #240): abrir al
// enfocar o al escribir, filtrado en vivo, selección con click / Enter
// (y flechas arriba/abajo), cierre con Escape o al salir del campo. El
// texto libre por sí solo NO selecciona nada: solo las opciones del
// catálogo escriben el valor oculto de la fila.
function bindIngredienteCombo(combo) {
  const input = combo.querySelector(".ing-nombre");
  const toggle = combo.querySelector(".ing-combo__toggle");
  const list = combo.querySelector(".ing-combo__list");
  let activeIndex = -1;
  let closeTimer = null;

  const close = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const open = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    renderIngredienteComboList(combo);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const selectOption = (option) => {
    if (!option || option.getAttribute("aria-disabled") === "true") return;
    combo.querySelector(".ing-nombre-valor").value = option.dataset.nombre;
    combo.querySelector(".ing-categoria-valor").value = option.dataset.categoria || "";
    input.value = option.dataset.nombre;
    close();
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    renderIngredienteComboList(combo);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    activeIndex = -1;
  });
  input.addEventListener("keydown", (e) => {
    const options = [...list.querySelectorAll('[role="option"]')];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      const max = options.length - 1;
      activeIndex = activeIndex < 0 ? (e.key === "ArrowDown" ? 0 : max) : activeIndex + (e.key === "ArrowDown" ? 1 : -1);
      activeIndex = Math.min(max, Math.max(0, activeIndex));
      options.forEach((o, i) => o.classList.toggle("is-active", i === activeIndex));
    } else if (e.key === "Enter") {
      if (!list.hidden) {
        e.preventDefault();
        const opts = [...list.querySelectorAll('[role="option"]')];
        const target = opts[activeIndex] || opts[0];
        // Sin opciones elegibles (p. ej. solo el mensaje «Sin
        // coincidencias»): Enter no selecciona y cierra el desplegable.
        if (!target || target.getAttribute("aria-disabled") === "true") close();
        else selectOption(target);
      }
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      input.value = combo.querySelector(".ing-nombre-valor").value;
      close();
    }
  });
  // El blur cierra el desplegable con un pequeño retardo para no
  // adelantarse al click de una opción (el mousedown con preventDefault
  // de la lista mantiene el foco, así que aquí solo llegan los cierres
  // de pulsar fuera o tabular).
  input.addEventListener("blur", () => {
    closeTimer = setTimeout(close, 120);
  });
  toggle.addEventListener("click", () => {
    if (list.hidden) {
      open();
      input.focus();
    } else {
      close();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) e.preventDefault();
  });
  list.addEventListener("click", (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) selectOption(option);
  });
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
    bindIngredienteCombo(wrap.lastElementChild.querySelector(".ing-combo"));
  });
  // Nuevo ingrediente desde la receta (issue #240): abre la misma
  // ventana de creación del catálogo; al guardarse, se añade una fila
  // con ese ingrediente ya elegido.
  content.querySelector("#btn-nuevo-ingrediente-receta")?.addEventListener("click", () => {
    openIngredientModal(null, { onCreated: (ing) => {
      const wrap = content.querySelector("#recipe-ingredientes");
      wrap.insertAdjacentHTML("beforeend", ingredienteRowHtml(ing, wrap.children.length));
      bindIngredienteCombo(wrap.lastElementChild.querySelector(".ing-combo"));
      wrap.lastElementChild.querySelector(".ing-cantidad").focus();
    } });
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

  // Modo lectura (issue #234): la ventana de información tiene botones
  // de editar y eliminar; el cierre queda para la ✕ (y el backdrop solo
  // en lectura, ver setupRecipes).
  content.querySelector("[data-recipe-edit]")?.addEventListener("click", () => {
    const recipe = recipes.find((r) => r.id === editingRecipeId);
    if (!recipe) return;
    openRecipeModal(recipe); // re-render en modo edición
  });
  content.querySelector("[data-recipe-delete]")?.addEventListener("click", async () => {
    const recipe = recipes.find((r) => r.id === editingRecipeId);
    if (!recipe) return;
    if (await deleteRecipeFlow(recipe)) closeRecipeModal();
  });

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

  // Comboboxes de ingrediente (issue #240): uno por fila.
  content.querySelectorAll("#recipe-ingredientes .ing-combo").forEach(bindIngredienteCombo);
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

  // Ingredientes (issue #240): solo cuenta la selección del combobox
  // (el valor oculto que escribe una opción del catálogo), y solo si
  // el texto visible sigue siendo el de esa selección: si el usuario
  // tecleó encima (texto libre), la fila se descarta con aviso. La
  // categoría se toma del catálogo (o de la guardada en la receta si
  // ya no está en él).
  const sinSeleccion = [];
  const ingredientes = [...content.querySelectorAll("#recipe-ingredientes .recipe-form__ingrediente")]
    .map((row) => {
      const ingNombre = row.querySelector(".ing-nombre-valor").value.trim();
      const textoVisible = row.querySelector(".ing-nombre").value.trim();
      if (!ingNombre || normalizeIngredientName(textoVisible) !== normalizeIngredientName(ingNombre)) {
        if (textoVisible) sinSeleccion.push(textoVisible);
        return null;
      }
      return {
        nombre: ingNombre,
        cantidad: row.querySelector(".ing-cantidad").value === "" ? null : Number(row.querySelector(".ing-cantidad").value),
        unidad: normalizeUnit(row.querySelector(".ing-unidad").value),
        categoriaId: ingredientCategoriaDe(ingNombre, row.querySelector(".ing-categoria-valor").value),
      };
    })
    .filter(Boolean);
  if (sinSeleccion.length) {
    const lista = sinSeleccion.map((n) => `«${n}»`).join(", ");
    showToast(`No se añadió ${lista}: elige el ingrediente del desplegable (o créalo con «Nuevo ingrediente»).`);
  }

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
// El catálogo conserva la primera grafía escrita (issue #224): el
// nombre se guarda con sus tildes y mayúsculas tal cual vino en la
// receta, mientras que la deduplicación sigue usando el nombre
// normalizado (sin tildes, minúsculas).
async function syncIngredientsCatalog(ingredientes) {
  const known = new Set(ingredients.map((i) => normalizeIngredientName(i.nombre)));
  for (const ing of ingredientes || []) {
    const name = normalizeIngredientName(ing.nombre);
    if (!name || known.has(name)) continue;
    known.add(name);
    try {
      await ctx.addIngredient(currentUser, { nombre: ing.nombre.trim(), categoriaId: ing.categoriaId || "" });
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
