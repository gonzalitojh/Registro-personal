// =============================================================
// Sección de Recetas (issue #64) — pestaña «Menú».
// Menú semanal: rejilla día × comida con varias opciones por
// comida (cada comensal puede comer distinto), número de
// comensales y «recetas a la semana» (que NO escalan por
// comensales, p. ej. pan para los desayunos).
//
// Un documento por semana en users/{uid}/menus (semanaInicio =
// lunes ISO). La lista de la compra (shopping-list.js) consume
// este mismo documento.
// =============================================================

import { showToast } from "./ui.js";
import { registerTabRenderer, notifyRecipesChanged, getRecipes } from "./recipes.js";
import {
  DAY_KEYS,
  DAY_LABELS,
  MEAL_KEYS,
  MEAL_LABELS,
  escapeHtml,
  mondayISO,
  addDaysISO,
  formatDateEs,
} from "./recipes-data.js";

// ---------- Estado ----------

let currentUser = null;
let ctx = null;
let menus = [];
let weekOffset = 0; // 0 = esta semana, -1 = anterior, 1 = siguiente

export function setupMenu(opts) {
  ctx = opts?.ctx || null;

  document.getElementById("menu-prev-week").addEventListener("click", () => {
    weekOffset -= 1;
    renderMenu();
  });
  document.getElementById("menu-next-week").addEventListener("click", () => {
    weekOffset += 1;
    renderMenu();
  });
  document.getElementById("menu-delete-week").addEventListener("click", deleteActiveMenu);
  document.getElementById("menu-comensales").addEventListener("change", (e) => {
    const value = Math.max(1, Number(e.target.value) || 1);
    e.target.value = value;
    updateActiveMenu({ comensales: value });
  });
  document.getElementById("btn-add-weekly-recipe").addEventListener("click", addWeeklyRecipe);
  document.getElementById("menu-weekly-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-weekly-remove]");
    if (!btn) return;
    removeWeeklyRecipe(btn.dataset.weeklyRemove);
  });

  registerTabRenderer("menu", renderMenu);
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetMenuData() {
  menus = [];
  weekOffset = 0;
}

export function subscribeMenuData(uid, onChange, onError) {
  currentUser = uid;
  return ctx.subscribeToMenus(uid, (items) => {
    menus = items;
    // Re-render de la pestaña activa y de las demás que consumen el
    // menú (la lista de la compra, si está abierta).
    notifyRecipesChanged();
    if (onChange) onChange();
  }, onError);
}

// ---------- Acceso al menú activo ----------

function activeMenu() {
  const weekStart = mondayISO(weekOffset);
  let menu = menus.find((m) => m.semanaInicio === weekStart);
  if (!menu) {
    menu = {
      id: null,
      semanaInicio: weekStart,
      comensales: 2,
      dias: emptyDias(),
      recetasPorSemana: [],
      recetasExcluidasCompra: [],
    };
  }
  return menu;
}

function emptyDias() {
  const dias = {};
  DAY_KEYS.forEach((d) => {
    dias[d] = {};
    MEAL_KEYS.forEach((m) => {
      dias[d][m] = [];
    });
  });
  return dias;
}

// Borra el menú de la semana activa (documento y estado local).
async function deleteActiveMenu() {
  const menu = activeMenu();
  if (!menu.id) {
    showToast("El menú de esta semana todavía no tiene datos guardados.");
    return;
  }
  if (!confirm(`¿Borrar el menú completo de la semana del ${formatDateEs(menu.semanaInicio)}?`)) return;
  try {
    await ctx.deleteMenu(currentUser, menu.id);
    menus = menus.filter((m) => m.id !== menu.id);
    renderMenu();
    showToast("Menú de la semana borrado.");
  } catch (err) {
    console.error("No se pudo borrar el menú:", err);
    showToast("No se pudo borrar el menú.");
  }
}

// Persistencia fuego-y-olvido: se crea el documento si no existe y
// se actualizan los campos del que hay. Tras cada guardado se
// actualiza el estado local de forma optimista: evita lecturas
// obsoletas entre guardados rápidos y que una segunda edición cree
// un documento duplicado de la misma semana antes de que llegue el
// snapshot de Firestore.
async function updateActiveMenu(changes) {
  const menu = { ...activeMenu(), ...changes };
  try {
    if (menu.id) {
      await ctx.updateMenu(currentUser, menu.id, menuDataOf(menu));
    } else {
      const ref = await ctx.addMenu(currentUser, menuDataOf(menu));
      menu.id = ref.id;
    }
    const idx = menus.findIndex((m) => m.id === menu.id);
    const fresh = { ...menuDataOf(menu), id: menu.id };
    if (idx >= 0) menus[idx] = fresh;
    else menus.push(fresh);
  } catch (err) {
    console.error("No se pudo guardar el menú:", err);
    showToast("No se pudo guardar el menú.");
  }
}

function menuDataOf(menu) {
  return {
    semanaInicio: menu.semanaInicio,
    comensales: menu.comensales,
    dias: menu.dias,
    recetasPorSemana: menu.recetasPorSemana,
    recetasExcluidasCompra: menu.recetasExcluidasCompra,
    // Ítems extra de la lista de la compra: viven en el documento del
    // menú de la semana (shopping-list.js los consume y actualiza).
    itemsExtra: menu.itemsExtra || [],
  };
}

// ---------- Render ----------

export function renderMenu() {
  const menu = activeMenu();

  document.getElementById("menu-week-label").textContent = `Semana del ${formatDateEs(menu.semanaInicio)}`;
  const comensalesInput = document.getElementById("menu-comensales");
  if (Number(comensalesInput.value) !== Number(menu.comensales)) {
    comensalesInput.value = menu.comensales;
  }

  renderMenuGrid(menu);
  renderWeeklyRecipes(menu);
}

function renderMenuGrid(menu) {
  const grid = document.getElementById("menu-grid");
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  grid.innerHTML = `<div class="menu-grid__head">${["Día", ...MEAL_KEYS.map((m) => MEAL_LABELS[m])]
    .map((h) => `<span class="menu-grid__cell menu-grid__cell--head">${h}</span>`).join("")}</div>
    ${DAY_KEYS.map((day) => {
      const dateLabel = formatDateEs(addDaysISO(menu.semanaInicio, DAY_KEYS.indexOf(day)));
      const cells = MEAL_KEYS.map((meal) => {
        const recipeIds = menu.dias[day][meal] || [];
        const items = recipeIds
          .map((id) => ({ id, recipe: byId.get(id) }))
          .filter((x) => x.recipe);
        const excluded = new Set(menu.recetasExcluidasCompra || []);
        return `<div class="menu-grid__cell menu-grid__cell--meal" data-day="${day}" data-meal="${meal}">
          <div class="menu-meal__items">
            ${items.map(({ id, recipe }) => `<span class="menu-meal__item${excluded.has(id) ? " is-excluded" : ""}"
                title="${excluded.has(id) ? "Excluida de la lista de la compra" : escapeHtml(recipe.nombre)}">
                ${escapeHtml(recipe.nombre)}
                <button type="button" class="menu-meal__remove" data-day="${day}" data-meal="${meal}" data-remove-recipe="${id}"
                  aria-label="Quitar ${escapeHtml(recipe.nombre)}">✕</button>
              </span>`).join("")}
          </div>
          <button type="button" class="btn btn--small menu-meal__add" data-day="${day}" data-meal="${meal}">+ Receta</button>
        </div>`;
      });
      return `<div class="menu-grid__row">
        <span class="menu-grid__cell menu-grid__cell--day">${DAY_LABELS[day]}<small>${dateLabel}</small></span>
        ${cells.join("")}
      </div>`;
    }).join("")}`;

  // Botones «+ Receta»: picker inline con las recetas disponibles.
  grid.querySelectorAll(".menu-meal__add").forEach((btn) => {
    btn.addEventListener("click", () => addRecipeToMeal(btn.dataset.day, btn.dataset.meal, btn));
  });

  // Quitar receta de una comida (y de la exclusión si estaba).
  grid.querySelectorAll("[data-remove-recipe]").forEach((btn) => {
    btn.addEventListener("click", () => removeRecipeFromMeal(btn.dataset.day, btn.dataset.meal, btn.dataset.removeRecipe));
  });
}

// Picker de recetas para una comida: dropdown sencillo con todas las
// recetas (las ya añadidas se muestran pero no se duplican).
function addRecipeToMeal(day, meal, btn) {
  const menu = activeMenu();
  const recipes = getRecipes();
  const existing = new Set(menu.dias[day][meal] || []);
  const candidates = recipes.filter((r) => !existing.has(r.id));

  if (!candidates.length) {
    showToast("No hay más recetas para añadir (o ninguna receta creada).");
    return;
  }

  const picker = document.createElement("div");
  picker.className = "menu-meal__picker";
  picker.innerHTML = `<select aria-label="Elegir receta">
      ${candidates.map((r) => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join("")}
    </select>
    <button type="button" class="btn btn--small btn--primary">Añadir</button>`;
  btn.replaceWith(picker);

  picker.querySelector("button").addEventListener("click", async () => {
    const recipeId = picker.querySelector("select").value;
    const current = activeMenu();
    const ids = current.dias[day][meal] || [];
    if (!ids.includes(recipeId)) {
      const dias = { ...current.dias, [day]: { ...current.dias[day], [meal]: [...ids, recipeId] } };
      await updateActiveMenu({ dias });
    }
    renderMenu();
  });
}

async function removeRecipeFromMeal(day, meal, recipeId) {
  const menu = activeMenu();
  const ids = (menu.dias[day][meal] || []).filter((id) => id !== recipeId);
  const dias = { ...menu.dias, [day]: { ...menu.dias[day], [meal]: ids } };
  await updateActiveMenu({ dias });
  renderMenu();
}

// ---------- Recetas a la semana (no escalan) ----------

function renderWeeklyRecipes(menu) {
  const list = document.getElementById("menu-weekly-list");
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  // Si el picker de «añadir» consumió el botón estático, lo
  // reconstruimos para que el flujo vuelva a estar disponible.
  if (!document.getElementById("btn-add-weekly-recipe")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-add-weekly-recipe";
    btn.className = "btn btn--small";
    btn.textContent = "+ Añadir receta a la semana";
    btn.addEventListener("click", addWeeklyRecipe);
    list.insertAdjacentElement("beforebegin", btn);
  }

  if (!menu.recetasPorSemana?.length) {
    list.innerHTML = `<p class="menu-weekly__empty">Ninguna receta a la semana.</p>`;
    return;
  }
  list.innerHTML = menu.recetasPorSemana.map((entry) => {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) return "";
    return `<div class="menu-weekly__item">
      <span>${escapeHtml(recipe.nombre)}</span>
      <button type="button" class="btn btn--small btn--danger" data-weekly-remove="${entry.recipeId}">Quitar</button>
    </div>`;
  }).join("");
}

function addWeeklyRecipe() {
  const menu = activeMenu();
  const recipes = getRecipes();
  const candidates = recipes.filter((r) => !(menu.recetasPorSemana || []).some((e) => e.recipeId === r.id));
  if (!candidates.length) {
    showToast("No hay recetas nuevas para añadir a la semana.");
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "menu-weekly__addrow";
  wrapper.innerHTML = `<select aria-label="Elegir receta a la semana">
      ${candidates.map((r) => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join("")}
    </select>
    <button type="button" class="btn btn--small btn--primary">Añadir</button>`;
  document.getElementById("btn-add-weekly-recipe").replaceWith(wrapper);

  wrapper.querySelector("button").addEventListener("click", async () => {
    const current = activeMenu();
    const list = current.recetasPorSemana || [];
    const recipeId = wrapper.querySelector("select").value;
    // Guard contra duplicados (el wrapper puede quedar vivo si el
    // render no llegó a reconstruir el botón a tiempo).
    if (list.some((e) => e.recipeId === recipeId)) {
      showToast("Esa receta ya está en la semana.");
      wrapper.remove();
      renderMenu();
      return;
    }
    const entry = { recipeId, cantidad: 1 };
    await updateActiveMenu({ recetasPorSemana: [...list, entry] });
    wrapper.remove();
    renderMenu();
  });
}

async function removeWeeklyRecipe(recipeId) {
  const menu = activeMenu();
  const list = (menu.recetasPorSemana || []).filter((e) => e.recipeId !== recipeId);
  await updateActiveMenu({ recetasPorSemana: list });
  renderMenu();
}

// ---------- Compartido con la lista de la compra ----------

// Excluir / incluir una receta del cálculo de la lista de la compra.
export async function setRecipeExcluded(recipeId, excluded) {
  const menu = activeMenu();
  const list = (menu.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
  if (excluded) list.push(recipeId);
  await updateActiveMenu({ recetasExcluidasCompra: list });
  renderMenu();
  notifyRecipesChanged();
}

export function isRecipeExcluded(recipeId) {
  return (activeMenu().recetasExcluidasCompra || []).includes(recipeId);
}

// Datos del menú activo para la lista de la compra: devuelve
// { semanaInicio, comensales, dias, recetasPorSemana, recetasExcluidasCompra }.
export function getActiveMenuData() {
  const menu = activeMenu();
  return {
    semanaInicio: menu.semanaInicio,
    comensales: Number(menu.comensales) || 1,
    dias: menu.dias || emptyDias(),
    recetasPorSemana: menu.recetasPorSemana || [],
    recetasExcluidasCompra: menu.recetasExcluidasCompra || [],
    itemsExtra: menu.itemsExtra || [],
  };
}

// Actualiza los ítems extra de la lista de la compra (persisten en
// el documento del menú activo).
export async function updateMenuExtras(itemsExtra) {
  await updateActiveMenu({ itemsExtra });
}

// Limpia referencias a una receta borrada en los menús existentes.
export async function cleanupDeletedRecipe(recipeId) {
  for (const menu of menus) {
    const data = menuDataOf(menu);
    let changed = false;
    let dias = data.dias;
    DAY_KEYS.forEach((day) => {
      MEAL_KEYS.forEach((meal) => {
        const ids = (dias[day]?.[meal] || []).filter((id) => id !== recipeId);
        if (ids.length !== (dias[day]?.[meal] || []).length) {
          dias = { ...dias, [day]: { ...dias[day], [meal]: ids } };
          changed = true;
        }
      });
    });
    const recetasPorSemana = (data.recetasPorSemana || []).filter((e) => e.recipeId !== recipeId);
    const recetasExcluidasCompra = (data.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
    if (recetasPorSemana.length !== (data.recetasPorSemana || []).length) changed = true;
    if (recetasExcluidasCompra.length !== (data.recetasExcluidasCompra || []).length) changed = true;
    if (changed) {
      try {
        await ctx.updateMenu(currentUser, menu.id, { ...data, dias, recetasPorSemana, recetasExcluidasCompra });
      } catch (err) {
        console.error("No se pudo limpiar el menú:", err);
      }
    }
  }
}
