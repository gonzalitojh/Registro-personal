// =============================================================
// Sección de Recetas (issue #64) — pestaña «Lista de la compra».
// Calcula automáticamente lo que se necesita a partir del menú
// activo (js/menu.js): cada ingrediente se multiplica por
// (comensales / porciones de la receta). Las «recetas a la
// semana» no escalan (cantidad fija) y las recetas excluidas
// (recetasExcluidasCompra del menú) se saltan.
// Además permite ítems extra manuales (comestibles y no
// comestibles, p. ej. productos de limpieza) persistidos en el
// documento del menú (itemsExtra), y marcar lo ya comprado
// (estado visual de la sesión, primera versión).
// =============================================================

import { showToast } from "./ui.js";
import { registerTabRenderer, getRecipes } from "./recipes.js";
import {
  INGREDIENT_CATEGORIES,
  DAY_KEYS,
  MEAL_KEYS,
  normalizeIngredientName,
  normalizeUnit,
  escapeHtml,
  formatCantidad,
  formatDateEs,
} from "./recipes-data.js";
import { getActiveMenuData, setRecipeExcluded, isRecipeExcluded, updateMenuExtras } from "./menu.js";

// ---------- Estado ----------

let showingExtraForm = false;

export function setupShoppingList(opts) {
  document.getElementById("btn-add-extra-item").addEventListener("click", () => {
    showingExtraForm = !showingExtraForm;
    const form = document.getElementById("shopping-extra-form");
    form.classList.toggle("hidden", !showingExtraForm);
    if (showingExtraForm) renderExtraForm();
  });

  document.getElementById("shopping-extra-form").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-extra-action]");
    if (!btn) return;
    if (btn.dataset.extraAction === "add") addExtraItem();
    if (btn.dataset.extraAction === "cancel") {
      showingExtraForm = false;
      document.getElementById("shopping-extra-form").classList.add("hidden");
    }
  });

  document.getElementById("shopping-list").addEventListener("click", (e) => {
    const removeExtra = e.target.closest("[data-remove-extra]");
    if (removeExtra) {
      removeExtraItem(removeExtra.dataset.removeExtra);
      return;
    }
    const excludeBtn = e.target.closest("[data-exclude-recipe]");
    if (excludeBtn) {
      const recipeId = excludeBtn.dataset.excludeRecipe;
      setRecipeExcluded(recipeId, !isRecipeExcluded(recipeId));
    }
  });

  // «Comprado»: estado visual de la sesión (la línea se tacha).
  document.getElementById("shopping-list").addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox][data-bought]");
    if (!box) return;
    const lineEl = box.closest(".shopping-line");
    if (lineEl) lineEl.classList.toggle("is-bought", box.checked);
  });

  registerTabRenderer("compra", renderShoppingList);
}

// ---------- Cálculo ----------

function computeLines() {
  const data = getActiveMenuData();
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const excluded = new Set(data.recetasExcluidasCompra || []);
  const lines = new Map(); // key (nombre|unidad) → línea

  function addLine(nombre, cantidad, unidad, categoriaId, comestible, origen) {
    if (!nombre) return;
    const key = `${normalizeIngredientName(nombre)}|${normalizeUnit(unidad)}`;
    if (!lines.has(key)) {
      lines.set(key, {
        key,
        nombre: normalizeIngredientName(nombre),
        cantidad: 0,
        unidad: normalizeUnit(unidad),
        categoriaId: categoriaId || "",
        comestible: comestible !== false,
        origen,
      });
    }
    const line = lines.get(key);
    const value = Number(cantidad || 0);
    line.cantidad += value;
  }

  // Recetas del menú (por día y comida), escaladas por comensales.
  const comensales = Number(data.comensales) || 1;
  DAY_KEYS.forEach((day) => {
    MEAL_KEYS.forEach((meal) => {
      (data.dias?.[day]?.[meal] || []).forEach((recipeId) => {
        if (excluded.has(recipeId)) return;
        const recipe = byId.get(recipeId);
        if (!recipe) return;
        const factor = Number(recipe.porciones) > 0 ? comensales / Number(recipe.porciones) : comensales;
        (recipe.ingredientes || []).forEach((ing) => {
          addLine(ing.nombre, Number(ing.cantidad || 0) * factor, ing.unidad, ing.categoriaId, true, recipe.nombre);
        });
      });
    });
  });

  // Recetas a la semana: cantidad fija, sin escalar.
  (data.recetasPorSemana || []).forEach((entry) => {
    if (excluded.has(entry.recipeId)) return;
    const recipe = byId.get(entry.recipeId);
    if (!recipe) return;
    (recipe.ingredientes || []).forEach((ing) => {
      addLine(ing.nombre, Number(ing.cantidad || 0), ing.unidad, ing.categoriaId, true, recipe.nombre);
    });
  });

  // Ítems extra manuales (comestibles y no comestibles).
  (data.itemsExtra || []).forEach((item) => {
    addLine(item.nombre, item.cantidad, item.unidad, item.categoriaId, item.comestible, "extra");
  });

  return lines;
}

// ---------- Render ----------

export function renderShoppingList() {
  const weekStart = getActiveMenuData().semanaInicio;
  document.getElementById("shopping-week-label").textContent = `Lista de la semana del ${formatDateEs(weekStart)}`;

  const lines = computeLines();
  const container = document.getElementById("shopping-list");
  const recipes = getRecipes();

  // Agrupación por categoría (predefinidas en orden + sin categoría).
  const groups = new Map();
  INGREDIENT_CATEGORIES.forEach((c) => groups.set(c.id, []));
  groups.set("", []);
  lines.forEach((line) => {
    const key = line.categoriaId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  });

  const hasLines = [...groups.values()].some((l) => l.length);
  if (!hasLines) {
    container.innerHTML = `<p class="empty-state">No hay nada que comprar. Añade recetas al menú semanal
      (o un ítem extra con «+ Ítem extra») y aquí aparecerá la lista calculada.</p>`;
    return;
  }

  container.innerHTML = [...groups.entries()].map(([catId, groupLines]) => {
    if (!groupLines.length) return "";
    const catLabel = catId
      ? (INGREDIENT_CATEGORIES.find((c) => c.id === catId)?.label || catId)
      : "Sin categoría";
    return `<section class="shopping-group">
      <h3 class="shopping-group__title">${escapeHtml(catLabel)}</h3>
      <ul class="shopping-group__list">
        ${groupLines.map((line) => `<li class="shopping-line${line.comestible ? "" : " shopping-line--hogar"}">
          <label class="shopping-line__main">
            <input type="checkbox" data-bought="${escapeHtml(line.key)}" aria-label="Marcar ${escapeHtml(line.nombre)} como comprado" />
            <span class="shopping-line__name">${escapeHtml(line.nombre)}</span>
          </label>
          <span class="shopping-line__qty">${formatCantidad(line.cantidad)} ${escapeHtml(line.unidad)}</span>
          ${line.origen === "extra" ? `<button type="button" class="shopping-line__remove" data-remove-extra="${escapeHtml(line.key)}"
            aria-label="Eliminar ${escapeHtml(line.nombre)} de la lista" title="Quitar de la lista">✕</button>` : ""}
        </li>`).join("")}
      </ul>
    </section>`;
  }).join("");

  container.insertAdjacentHTML("beforeend", excludedRecipesNote());
  container.insertAdjacentHTML("beforeend", `<p class="shopping-hint">Los ítems de recetas se quitan excluyendo la receta
    desde el menú; el ✕ solo aparece en los ítems extra añadidos a mano.</p>`);
}

// Nota con las recetas excluidas del cálculo (y botón para volver a incluirlas).
function excludedRecipesNote() {
  const data = getActiveMenuData();
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const excluded = (data.recetasExcluidasCompra || [])
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (!excluded.length) return "";
  return `<div class="shopping-excluded">
    <p>Recetas fuera de la lista (marcadas como ya hechas en el menú):
      ${excluded.map((r) => `<button type="button" class="shopping-excluded__btn" data-exclude-recipe="${r.id}">${escapeHtml(r.nombre)}</button>`).join(", ")}
    </p>
  </div>`;
}

// ---------- Ítems extra manuales ----------

function renderExtraForm() {
  const form = document.getElementById("shopping-extra-form");
  form.innerHTML = `<div class="shopping-extra-form__row">
      <input type="text" id="extra-nombre" placeholder="Nombre (p. ej. lavavajillas)" maxlength="100" />
      <input type="number" id="extra-cantidad" placeholder="Cant." step="any" min="0" />
      <input type="text" id="extra-unidad" placeholder="Unidad" maxlength="30" />
      <select id="extra-categoria" aria-label="Categoría">
        <option value="">—</option>
        ${INGREDIENT_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}
      </select>
    </div>
    <label class="shopping-extra-form__check">
      <input type="checkbox" id="extra-comestible" checked /> No es comestible (limpieza, hogar…)
    </label>
    <div class="shopping-extra-form__actions">
      <button type="button" class="btn btn--small btn--primary" data-extra-action="add">Añadir</button>
      <button type="button" class="btn btn--small" data-extra-action="cancel">Cancelar</button>
    </div>`;
}

async function addExtraItem() {
  const form = document.getElementById("shopping-extra-form");
  const nombre = form.querySelector("#extra-nombre").value.trim();
  if (!nombre) {
    showToast("Escribe un nombre para el ítem extra.");
    return;
  }
  const item = {
    nombre,
    cantidad: form.querySelector("#extra-cantidad").value === "" ? null : Number(form.querySelector("#extra-cantidad").value),
    unidad: normalizeUnit(form.querySelector("#extra-unidad").value),
    categoriaId: form.querySelector("#extra-categoria").value,
    comestible: !form.querySelector("#extra-comestible").checked,
  };
  try {
    const data = getActiveMenuData();
    await updateMenuExtras([...(data.itemsExtra || []), item]);
    showToast("Ítem añadido a la lista.");
    showingExtraForm = false;
    form.classList.add("hidden");
    renderShoppingList();
  } catch (err) {
    console.error("No se pudo añadir el ítem:", err);
    showToast("No se pudo añadir el ítem.");
  }
}

async function removeExtraItem(key) {
  try {
    const data = getActiveMenuData();
    const rest = (data.itemsExtra || []).filter(
      (item) => `${normalizeIngredientName(item.nombre)}|${normalizeUnit(item.unidad)}` !== key
    );
    await updateMenuExtras(rest);
    showToast("Ítem eliminado.");
  } catch (err) {
    console.error("No se pudo eliminar el ítem:", err);
    showToast("No se pudo eliminar el ítem.");
  }
}
