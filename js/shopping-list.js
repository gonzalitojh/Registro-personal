// =============================================================
// Sección de Recetas (issue #64) — pestaña «Lista de la compra».
// Calcula automáticamente lo que se necesita a partir del menú
// semanal (js/menu.js): cada ingrediente se multiplica por
// (comensales / porciones de la receta). Las «recetas a la
// semana» no escalan (cantidad fija) y las recetas excluidas
// (recetasExcluidasCompra del menú) se saltan.
//
// Mejoras de la issue #225:
//  - Selección de VARIAS semanas a la vez: los chips de la toolbar
//    permiten marcar/desmarcar semanas y se suman los ingredientes
//    totales de todas las seleccionadas (cada semana escala con sus
//    propios comensales y aplica sus propias exclusiones).
//  - Cantidad en PAQUETES: si el ingrediente del catálogo tiene
//    cantidad y unidad de paquete (paqueteCantidad/paqueteUnidad,
//    issue #224), la cantidad necesaria se compara con la del
//    paquete y se redondea al alza (550 g con paquete de 1 Kg → 1
//    paquete; 2,5 Kg → 3). El usuario puede ajustar esa cantidad
//    con el stepper −/+ y el ajuste persiste en localStorage. Si no
//    hay dato de paquete (o las unidades no son comparables) se
//    muestra la cantidad necesaria.
//  - Eliminar ítems DESPLAZÁNDOLOS HACIA LA IZQUIERDA: el swipe
//    revela un botón «Eliminar» (también accesible por hover en
//    escritorio y por teclado). Los ítems de recetas dejan de
//    calcularse en las semanas seleccionadas (itemsEliminados del
//    documento de menú); los ítems extra se quitan de las semanas
//    donde estaban. Hay deshacer (toast) y una nota para volver a
//    incluir lo quitado.
// Además permite ítems extra manuales (comestibles y no
// comestibles) persistidos en el documento del menú (itemsExtra),
// y marcar lo ya comprado (estado visual de la sesión).
// =============================================================

import { showToast, showUndoToast } from "./ui.js";
import { registerTabRenderer, getRecipes, getIngredients } from "./recipes.js";
import {
  INGREDIENT_CATEGORIES,
  DAY_KEYS,
  MEAL_KEYS,
  normalizeIngredientName,
  normalizeUnit,
  escapeHtml,
  formatCantidad,
  formatDateEs,
  mondayISO,
} from "./recipes-data.js";
import { getMenuDataByWeek, updateMenuWeek, getActiveWeekOffset } from "./menu.js";

// ---------- Estado ----------

let ctx = null;
let showingExtraForm = false;
// Ventana de chips visible: semanas chipOffset-2 … chipOffset+2.
let chipOffset = 0;
// Semanas seleccionadas (semanaInicio ISO). Por defecto la semana
// activa del menú; se puede sumar más marcando los chips.
let selectedWeeks = new Set([mondayISO(0)]);
// Hasta que el usuario toca los chips, la selección sigue la semana
// activa del menú (si navegas el menú a otra semana, la lista pasa
// a esa semana). Tras tocar los chips, la selección es del usuario.
let userTouchedChips = false;
// Ajustes manuales de paquetes (issue #225): clave «nombre|unidad»
// → nº de paquetes. Persiste en localStorage por usuario.
let pkgOverrides = new Map();

// Desplazamiento del contenido al revelar «Eliminar» (px).
const SWIPE_OPEN = -88;

export function setupShoppingList(opts) {
  ctx = opts?.ctx || null;

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

  // Navegación de la ventana de semanas.
  document.getElementById("shopping-prev-week").addEventListener("click", () => {
    userTouchedChips = true;
    chipOffset -= 1;
    renderWeekChips();
  });
  document.getElementById("shopping-next-week").addEventListener("click", () => {
    userTouchedChips = true;
    chipOffset += 1;
    renderWeekChips();
  });

  // Selección de semanas (multi-semana, issue #225).
  document.getElementById("shopping-week-chips").addEventListener("change", (e) => {
    const box = e.target.closest("input[data-week-chip]");
    if (!box) return;
    userTouchedChips = true;
    if (box.checked) {
      selectedWeeks.add(box.dataset.weekChip);
    } else if (selectedWeeks.size > 1) {
      selectedWeeks.delete(box.dataset.weekChip);
    } else {
      box.checked = true;
      showToast("Selecciona al menos una semana.");
      return;
    }
    renderWeekChips();
    renderShoppingList();
  });

  document.getElementById("shopping-list").addEventListener("click", (e) => {
    // Eliminar un ítem (swipe/hover/teclado, issue #225).
    const delBtn = e.target.closest("[data-del-key]");
    if (delBtn) {
      deleteLine(delBtn.dataset.delKey);
      return;
    }
    // Volver a incluir un ítem quitado de la lista.
    const restoreBtn = e.target.closest("[data-restore-key]");
    if (restoreBtn) {
      restoreKey(restoreBtn.dataset.restoreKey);
      return;
    }
    // Volver a incluir una receta excluida del cálculo.
    const excludeBtn = e.target.closest("[data-exclude-recipe]");
    if (excludeBtn) {
      includeRecipe(excludeBtn.dataset.excludeRecipe);
      return;
    }
    // Stepper de paquetes (issue #225).
    const pkgBtn = e.target.closest("[data-pkg-op]");
    if (pkgBtn) {
      adjustPackages(pkgBtn.dataset.pkgKey, pkgBtn.dataset.pkgOp);
    }
  });

  // «Comprado»: estado visual de la sesión (la línea se tacha).
  document.getElementById("shopping-list").addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox][data-bought]");
    if (!box) return;
    const lineEl = box.closest(".shopping-line-wrap");
    if (lineEl) lineEl.classList.toggle("is-bought", box.checked);
  });

  registerTabRenderer("compra", () => {
    syncSelectionWithMenu();
    renderShoppingList();
  });
}

// Vacía el estado local (lo llama app.js al cerrar sesión, para que
// los datos del usuario anterior no se muestren al siguiente).
export function resetShoppingListState() {
  showingExtraForm = false;
  chipOffset = 0;
  selectedWeeks = new Set([mondayISO(0)]);
  userTouchedChips = false;
  pkgOverrides = new Map();
}

// Mientras el usuario no haya tocado los chips, la selección sigue
// la semana activa del menú (issue #225).
function syncSelectionWithMenu() {
  if (userTouchedChips) return;
  const off = getActiveWeekOffset();
  chipOffset = off;
  selectedWeeks = new Set([mondayISO(off)]);
}

// ---------- Ajustes de paquetes (localStorage por usuario) ----------

function pkgStorageKey() {
  const uid = ctx?.getCurrentUser?.()?.uid;
  return uid ? `compraPaquetes:${uid}` : null;
}

function loadPkgOverrides() {
  const key = pkgStorageKey();
  if (!key) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(key) || "{}")));
  } catch {
    return new Map();
  }
}

function savePkgOverrides() {
  const key = pkgStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(pkgOverrides)));
  } catch (err) {
    console.error("No se pudieron guardar los ajustes de paquetes:", err);
  }
}

function adjustPackages(lineKey, op) {
  const lines = computeLines([...selectedWeeks]);
  const line = lines.get(lineKey);
  const info = line ? pkgInfo(line) : null;
  if (!info) return;
  pkgOverrides = loadPkgOverrides();
  let value = pkgOverrides.has(lineKey) ? pkgOverrides.get(lineKey) : info.packages;
  if (op === "minus") value = Math.max(0, value - 1);
  if (op === "plus") value += 1;
  if (op === "reset") pkgOverrides.delete(lineKey);
  else pkgOverrides.set(lineKey, value);
  savePkgOverrides();
  renderShoppingList();
}

// ---------- Cálculo ----------

// Suma los ingredientes de las semanas seleccionadas (issue #225).
// Cada semana escala con sus propios comensales y aplica sus
// exclusiones (recetasExcluidasCompra) e ítems eliminados
// (itemsEliminados).
function computeLines(weekStarts) {
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
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

  weekStarts.forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    const excluded = new Set(data.recetasExcluidasCompra || []);
    const eliminados = new Set(data.itemsEliminados || []);
    const skip = (nombre, unidad) =>
      eliminados.has(`${normalizeIngredientName(nombre)}|${normalizeUnit(unidad)}`);

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
            if (skip(ing.nombre, ing.unidad)) return;
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
        if (skip(ing.nombre, ing.unidad)) return;
        addLine(ing.nombre, Number(ing.cantidad || 0), ing.unidad, ing.categoriaId, true, recipe.nombre);
      });
    });

    // Ítems extra manuales (comestibles y no comestibles).
    (data.itemsExtra || []).forEach((item) => {
      if (skip(item.nombre, item.unidad)) return;
      addLine(item.nombre, item.cantidad, item.unidad, item.categoriaId, item.comestible, "extra");
    });
  });

  return lines;
}

// ---------- Cantidad en paquetes (issue #225) ----------

// Familias de unidades comparables entre «cantidad necesaria» y
// «cantidad del paquete»: masa (g/Kg), volumen (mL/L) y unidades.
// `base` convierte la unidad a la unidad base de su familia.
function unitFamily(unit) {
  const u = normalizeUnit(unit);
  if (["g", "gr", "grs", "gramo", "gramos"].includes(u)) return { family: "mass", base: 1 };
  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(u)) return { family: "mass", base: 1000 };
  if (["ml", "mililitro", "mililitros"].includes(u)) return { family: "volume", base: 1 };
  if (["l", "litro", "litros"].includes(u)) return { family: "volume", base: 1000 };
  if (["unidad", "unidades", "ud", "uds", "u", "pieza", "piezas", "pza"].includes(u)) return { family: "count", base: 1 };
  return null;
}

// Calcula los paquetes de una línea: busca el ingrediente en el
// catálogo, compara unidades (solo si son de la misma familia) y
// redondea al alza con tolerancia de coma flotante. Devuelve null si
// el ingrediente no tiene cantidad de paquete o no es comparable (en
// ese caso se muestra la cantidad necesaria).
function pkgInfo(line) {
  const ing = getIngredients().find((i) => normalizeIngredientName(i.nombre) === line.nombre);
  if (!ing) return null;
  const pkgCant = Number(ing.paqueteCantidad);
  const needed = unitFamily(line.unidad);
  const pkg = unitFamily(ing.paqueteUnidad);
  if (!(pkgCant > 0) || !needed || !pkg || needed.family !== pkg.family) return null;
  const neededBase = Number(line.cantidad) * needed.base;
  const pkgBase = pkgCant * pkg.base;
  if (!(pkgBase > 0)) return null;
  const packages = Math.max(0, Math.ceil(neededBase / pkgBase - 1e-9));
  return { packages, pkgUnit: normalizeUnit(ing.paqueteUnidad) };
}

// ---------- Render ----------

export function renderShoppingList() {
  const weekStarts = [...selectedWeeks].sort();
  document.getElementById("shopping-week-label").textContent =
    weekStarts.length === 1
      ? `Lista de la semana del ${formatDateEs(weekStarts[0])}`
      : `Lista de la compra · ${weekStarts.length} semanas`;

  renderWeekChips();

  const lines = computeLines(weekStarts);
  pkgOverrides = loadPkgOverrides();
  const container = document.getElementById("shopping-list");

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
      (o un ítem extra con «+ Ítem extra») y aquí aparecerá la lista calculada.
      Puedes marcar varias semanas en los chips para sumarlas.</p>`;
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
        ${groupLines.map((line) => lineHtml(line)).join("")}
      </ul>
    </section>`;
  }).join("");

  container.insertAdjacentHTML("beforeend", deletedItemsNote());
  container.insertAdjacentHTML("beforeend", excludedRecipesNote());
  container.insertAdjacentHTML("beforeend", `<p class="shopping-hint">Desliza un ítem hacia la izquierda
    (o pulsa «Eliminar» en escritorio) para quitarlo de la lista. Los ajustes de paquetes se guardan en este
    dispositivo.</p>`);

  // Swipe para eliminar (issue #225): patrón ADR-028 con axis lock.
  container.querySelectorAll(".shopping-line-wrap").forEach((wrap) => {
    attachLineSwipe(wrap, wrap.querySelector(".shopping-line__content"));
  });
}

function lineHtml(line) {
  const pkgQty = qtyHtml(line);
  return `<li class="shopping-line-wrap${line.comestible ? "" : " shopping-line-wrap--hogar"}">
    <div class="shopping-line__swipe-bg">
      <button type="button" class="shopping-line__del" data-del-key="${escapeHtml(line.key)}"
        aria-label="Eliminar ${escapeHtml(line.nombre)} de la lista" title="Quitar de la lista">Eliminar</button>
    </div>
    <div class="shopping-line__content">
      <label class="shopping-line__main">
        <input type="checkbox" data-bought="${escapeHtml(line.key)}" aria-label="Marcar ${escapeHtml(line.nombre)} como comprado" />
        <span class="shopping-line__name">${escapeHtml(line.nombre)}</span>
      </label>
      ${pkgQty}
    </div>
  </li>`;
}

// Cantidad de la línea: con paquete → «N paquetes · cantidad
// necesaria» y stepper −/+ (y ↺ para volver al cálculo automático si
// hay ajuste manual); sin paquete → la cantidad necesaria.
function qtyHtml(line) {
  const info = pkgInfo(line);
  if (!info) {
    return `<span class="shopping-line__qty shopping-line__qty--plain">${formatCantidad(line.cantidad)} ${escapeHtml(line.unidad)}</span>`;
  }
  const override = pkgOverrides.has(line.key);
  const shown = override ? pkgOverrides.get(line.key) : info.packages;
  const paqueteLabel = `${formatCantidad(shown)} ${shown === 1 ? "paquete" : "paquetes"}`;
  return `<span class="shopping-line__qty">
      <button type="button" class="shopping-line__stepper" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="minus"
        aria-label="Quitar un paquete de ${escapeHtml(line.nombre)}" title="Quitar un paquete">−</button>
      <span class="shopping-line__pkgcount">${paqueteLabel}</span>
      <button type="button" class="shopping-line__stepper" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="plus"
        aria-label="Añadir un paquete de ${escapeHtml(line.nombre)}" title="Añadir un paquete">+</button>
      ${override ? `<button type="button" class="shopping-line__pkgreset" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="reset"
        aria-label="Volver al cálculo automático de ${escapeHtml(line.nombre)}" title="Volver al cálculo automático">↺</button>` : ""}
    </span>
    <span class="shopping-line__detail">· ${formatCantidad(line.cantidad)} ${escapeHtml(line.unidad)}</span>`;
}

// Chips de semanas (issue #225): ventana de 5 alrededor de chipOffset.
function renderWeekChips() {
  const container = document.getElementById("shopping-week-chips");
  const chips = [];
  for (let off = chipOffset - 2; off <= chipOffset + 2; off++) {
    const iso = mondayISO(off);
    const checked = selectedWeeks.has(iso);
    chips.push(`<label class="shopping-week-chip${checked ? " is-checked" : ""}">
      <input type="checkbox" data-week-chip="${iso}" ${checked ? "checked" : ""} />
      <span class="shopping-week-chip__label" title="Semana del ${formatDateEs(iso)}">${formatDateEs(iso).slice(0, 5)}</span>
    </label>`);
  }
  container.innerHTML = chips.join("");
}

// Nota con los ítems quitados de la lista en las semanas
// seleccionadas (issue #225): pulsa uno para volver a incluirlo.
function deletedItemsNote() {
  const seen = new Map(); // key → nombre
  [...selectedWeeks].forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    (data.itemsEliminados || []).forEach((key) => {
      if (!seen.has(key)) seen.set(key, key.split("|")[0] || key);
    });
  });
  if (!seen.size) return "";
  return `<div class="shopping-deleted">
    <p>Quitados de la lista (dejan de calcularse en las semanas marcadas):
      ${[...seen.entries()].map(([key, nombre]) => `<button type="button" class="shopping-deleted__btn"
        data-restore-key="${escapeHtml(key)}">${escapeHtml(nombre)}</button>`).join(", ")}
    </p>
  </div>`;
}

// Nota con las recetas excluidas del cálculo en las semanas
// seleccionadas (y botón para volver a incluirlas).
function excludedRecipesNote() {
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ids = new Set();
  [...selectedWeeks].forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    (data.recetasExcluidasCompra || []).forEach((id) => ids.add(id));
  });
  const excluded = [...ids].map((id) => byId.get(id)).filter(Boolean);
  if (!excluded.length) return "";
  return `<div class="shopping-excluded">
    <p>Recetas fuera de la lista (marcadas como ya hechas en el menú):
      ${excluded.map((r) => `<button type="button" class="shopping-excluded__btn" data-exclude-recipe="${r.id}">${escapeHtml(r.nombre)}</button>`).join(", ")}
    </p>
  </div>`;
}

// ---------- Eliminar ítems (swipe hacia la izquierda, issue #225) ----------

// Aplica la eliminación a las semanas seleccionadas y ofrece
// deshacer. Ítems de recetas → itemsEliminados (dejan de calcularse
// en esas semanas); ítems extra → se quitan de itemsExtra de las
// semanas donde estaban.
async function deleteLine(key) {
  const lines = computeLines([...selectedWeeks]);
  const line = lines.get(key);
  if (!line) return;
  const isExtra = line.origen === "extra";
  const snapshots = []; // para el deshacer

  for (const weekStart of [...selectedWeeks]) {
    const data = getMenuDataByWeek(weekStart);
    if (!data.hasDoc) continue;
    if (isExtra) {
      const rest = (data.itemsExtra || []).filter(
        (item) => `${normalizeIngredientName(item.nombre)}|${normalizeUnit(item.unidad)}` !== key
      );
      if (rest.length === (data.itemsExtra || []).length) continue;
      snapshots.push({ weekStart, extraBefore: data.itemsExtra || [] });
      await updateMenuWeek(weekStart, { itemsExtra: rest }, { create: false });
    } else {
      if ((data.itemsEliminados || []).includes(key)) continue;
      snapshots.push({ weekStart, eliminadosBefore: data.itemsEliminados || [] });
      await updateMenuWeek(weekStart, { itemsEliminados: [...(data.itemsEliminados || []), key] }, { create: false });
    }
  }

  if (!snapshots.length) return;
  renderShoppingList();
  const { hide } = showUndoToast(line.nombre, async () => {
    for (const s of snapshots) {
      const fields = {};
      if (s.extraBefore !== undefined) fields.itemsExtra = s.extraBefore;
      if (s.eliminadosBefore !== undefined) fields.itemsEliminados = s.eliminadosBefore;
      await updateMenuWeek(s.weekStart, fields, { create: false });
    }
    renderShoppingList();
    hide();
  });
}

// Vuelve a incluir un ítem quitado: elimina su clave de
// itemsEliminados en las semanas seleccionadas que lo tengan.
async function restoreKey(key) {
  for (const weekStart of [...selectedWeeks]) {
    const data = getMenuDataByWeek(weekStart);
    if (!data.hasDoc) continue;
    const rest = (data.itemsEliminados || []).filter((k) => k !== key);
    if (rest.length !== (data.itemsEliminados || []).length) {
      await updateMenuWeek(weekStart, { itemsEliminados: rest }, { create: false });
    }
  }
  renderShoppingList();
  showToast("Ítem de vuelta en la lista.");
}

// Vuelve a incluir una receta excluida en las semanas seleccionadas.
async function includeRecipe(recipeId) {
  for (const weekStart of [...selectedWeeks]) {
    const data = getMenuDataByWeek(weekStart);
    if (!data.hasDoc) continue;
    const rest = (data.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
    if (rest.length !== (data.recetasExcluidasCompra || []).length) {
      await updateMenuWeek(weekStart, { recetasExcluidasCompra: rest }, { create: false });
    }
  }
  renderShoppingList();
  showToast("Receta de vuelta en la lista.");
}

// Swipe horizontal con axis lock (patrón ADR-028): a la izquierda
// revela «Eliminar» (no borra al soltar, hay que pulsar el botón);
// deslizar a la derecha vuelve a cerrar. La posición final la
// aplica el CSS (.is-revealed → translateX(-88px)); durante el
// arrastre se usa transform inline, que gana sobre la clase.
function attachLineSwipe(wrap, content) {
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let dragging = false;
  let lock = null; // null | 'vertical' | 'horizontal'
  let startTouchId = null;
  let revealed = false;
  const lockThreshold = 10;

  const snap = (isOpen) => {
    revealed = isOpen;
    content.style.transform = "";
    wrap.classList.toggle("is-revealed", isOpen);
  };

  wrap.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTouchId = touch.identifier;
      dragging = true;
      wrap.classList.add("is-dragging");
    },
    { passive: true }
  );

  wrap.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const touch = Array.from(e.touches).find((t) => t.identifier === startTouchId) || e.touches[0];
      deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      // Axis lock (ADR-028): al cruzar el slop se decide el eje y no
      // se vuelve atrás; el empate gana 'vertical' (el scroll manda).
      if (lock === null && (Math.abs(deltaX) >= lockThreshold || Math.abs(deltaY) >= lockThreshold)) {
        lock = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      }
      if (lock === "vertical") return;
      const offset = Math.max(SWIPE_OPEN, Math.min(0, (revealed ? SWIPE_OPEN : 0) + deltaX));
      content.style.transform = `translateX(${offset}px)`;
      wrap.classList.toggle("is-revealed", offset < SWIPE_OPEN / 2);
    },
    { passive: true }
  );

  const resetGesture = () => {
    dragging = false;
    wrap.classList.remove("is-dragging");
    lock = null;
    startTouchId = null;
    deltaX = 0;
  };

  wrap.addEventListener(
    "touchend",
    () => {
      const offset = Math.max(SWIPE_OPEN, Math.min(0, (revealed ? SWIPE_OPEN : 0) + deltaX));
      snap(offset < SWIPE_OPEN / 2);
      resetGesture();
    },
    { passive: true }
  );

  wrap.addEventListener(
    "touchcancel",
    () => {
      snap(revealed);
      resetGesture();
    },
    { passive: true }
  );

  // Accesibilidad por teclado: el «Eliminar» se revela al enfocarlo
  // (el CSS con :hover solo cubre ratón). El blur cierra solo si no
  // hay un arrastre en curso.
  const delBtn = wrap.querySelector(".shopping-line__del");
  if (delBtn) {
    delBtn.addEventListener("focus", () => snap(true));
    delBtn.addEventListener("blur", () => {
      if (!dragging) snap(false);
    });
  }
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
    // El ítem extra se añade a todas las semanas seleccionadas: la
    // lista de la compra es multi-semana (issue #225).
    for (const weekStart of [...selectedWeeks]) {
      const data = getMenuDataByWeek(weekStart);
      await updateMenuWeek(weekStart, { itemsExtra: [...(data.itemsExtra || []), item] }, { create: true });
    }
    showToast("Ítem añadido a la lista.");
    showingExtraForm = false;
    form.classList.add("hidden");
    renderShoppingList();
  } catch (err) {
    console.error("No se pudo añadir el ítem:", err);
    showToast("No se pudo añadir el ítem.");
  }
}
