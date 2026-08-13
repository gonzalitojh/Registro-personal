// =============================================================
// Sección de Recetas (issue #64) — pestaña «Menú».
// Menú semanal: rejilla día × comida con varias opciones por
// comida (cada comensal puede comer distinto), número de
// comensales y «recetas a la semana» (que NO escalan por
// comensales). Desde la issue #242 el menú cubre almuerzo y cena
// (el desayuno se eliminó) y cada receta añadida a una comida
// puede llevar SUS propios comensales (comensales propios o null
// para heredar el global de la semana).
//
// Un único botón «+ Añadir receta» en la barra (issue #242,
// iteración) abre el buscador con un selector de destino: día de la
// semana o «Toda la semana» y comida (almuerzo/cena). Lo que se
// añade a cada celda se muestra como tarjetas en miniatura (foto,
// nombre y etiquetas) clicables para ver la receta en modo lectura.
//
// Un documento por semana en users/{uid}/menus (semanaInicio =
// lunes ISO). La lista de la compra (shopping-list.js) consume
// este mismo documento.
// =============================================================

import { showToast } from "./ui.js";
import { trapFocus } from "./focus-utils.js";
import { registerTabRenderer, notifyRecipesChanged, getRecipes, getCustomTags, openRecipeModal } from "./recipes.js";
import {
  ALERGEN_TAGS,
  MEAL_TYPES,
  DAY_KEYS,
  DAY_LABELS,
  MEAL_KEYS,
  MEAL_LABELS,
  mergeTags,
  normalizeIngredientName,
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
  // Único botón de añadir receta (issue #242, iteración): el destino
  // (día o toda la semana + comida) se elige dentro del buscador.
  document.getElementById("btn-add-menu-recipe").addEventListener("click", () => openRecipePicker());
  // Lista de «recetas a la semana» (issue #242, iteración): las
  // mismas tarjetas .menu-meal__card que las celdas — la ✕ quita la
  // receta y la tarjeta (fuera de la ✕) abre la receta en lectura.
  document.getElementById("menu-weekly-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-weekly-remove]");
    if (btn) {
      removeWeeklyRecipe(btn.dataset.weeklyRemove);
      return;
    }
    const card = e.target.closest("[data-menu-card]");
    if (!card) return;
    const recipe = getRecipes().find((r) => r.id === card.dataset.menuCard);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });
  // Teclado de las tarjetas de la semana: Enter/Espacio abren la
  // lectura (los botones internos gestionan su propio Enter).
  document.getElementById("menu-weekly-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("button")) return;
    const card = e.target.closest("[data-menu-card]");
    if (!card) return;
    e.preventDefault();
    const recipe = getRecipes().find((r) => r.id === card.dataset.menuCard);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
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
  return menuForWeek(mondayISO(weekOffset));
}

// Menú de una semana concreta (semanaInicio = lunes ISO). Si no hay
// documento guardado se devuelve uno en memoria sin id (la lista de
// la compra multi-semana lo usa para semanas sin datos: aportan 0).
function menuForWeek(weekStart) {
  let menu = menus.find((m) => m.semanaInicio === weekStart);
  if (!menu) {
    menu = {
      id: null,
      semanaInicio: weekStart,
      comensales: 2,
      dias: emptyDias(),
      recetasPorSemana: [],
      recetasExcluidasCompra: [],
      itemsEliminados: [],
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
  await updateMenuWeek(activeMenu().semanaInicio, changes, { create: true });
}

// Igual que updateActiveMenu pero para una semana concreta (lista de
// la compra multi-semana, issue #225). Con `create: false` solo se
// actualiza si la semana ya tiene documento: eliminar ítems de una
// semana vacía no debe crear un documento.
export async function updateMenuWeek(weekStart, changes, { create = true } = {}) {
  const menu = { ...menuForWeek(weekStart), ...changes };
  try {
    if (menu.id) {
      await ctx.updateMenu(currentUser, menu.id, menuDataOf(menu));
    } else if (create) {
      const ref = await ctx.addMenu(currentUser, menuDataOf(menu));
      menu.id = ref.id;
    } else {
      return;
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
    // Ítems eliminados por el usuario desde la lista de la compra
    // (issue #225): claves normalizadas «nombre|unidad» que ya no se
    // calculan en esa semana.
    itemsEliminados: menu.itemsEliminados || [],
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
        const entries = (menu.dias[day][meal] || []).map(mealEntryOf).filter((e) => e.recipe && byId.has(e.recipe));
        const excluded = new Set(menu.recetasExcluidasCompra || []);
        return `<div class="menu-grid__cell menu-grid__cell--meal" data-day="${day}" data-meal="${meal}">
          <div class="menu-meal__items">
            ${entries.map(({ recipe, comensales }) => {
              const r = byId.get(recipe);
              const tagHtml = recipeTagsHtml(r);
              return `<article class="menu-meal__card${excluded.has(recipe) ? " is-excluded" : ""}"
                  role="button" tabindex="0" data-menu-card="${escapeHtml(recipe)}"
                  aria-label="Ver receta ${escapeHtml(r.nombre)}">
                  ${r.fotoUrl ? `<img class="menu-meal__card-photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
                  <span class="menu-meal__card-copy">
                    <span class="menu-meal__card-name">${escapeHtml(r.nombre)}</span>
                    ${tagHtml ? `<span class="menu-meal__card-tags">${tagHtml}</span>` : ""}
                  </span>
                  ${comensales ? `<small class="menu-meal__comensales">· ${comensales}</small>` : ""}
                  <button type="button" class="menu-meal__remove" data-day="${day}" data-meal="${meal}" data-remove-recipe="${escapeHtml(recipe)}"
                    aria-label="Quitar ${escapeHtml(r.nombre)}">✕</button>
                </article>`;
            }).join("")}
          </div>
        </div>`;
      });
      return `<div class="menu-grid__row">
        <span class="menu-grid__cell menu-grid__cell--day">${DAY_LABELS[day]}<small>${dateLabel}</small></span>
        ${cells.join("")}
      </div>`;
    }).join("")}`;

  // Tarjetas de las celdas: click (o Enter/Espacio) abre la receta en
  // modo lectura, la misma ventana de la pestaña Recetas (issue #242,
  // iteración). El botón ✕ quita la receta de la comida.
  grid.querySelectorAll("[data-menu-card]").forEach((card) => {
    const openCard = () => {
      const recipe = byId.get(card.dataset.menuCard);
      if (!recipe) return;
      openRecipeModal(recipe, { readOnly: true });
    };
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-recipe]")) return;
      openCard();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button")) return;
      e.preventDefault();
      openCard();
    });
  });

  // Quitar receta de una comida (y de la exclusión si estaba).
  grid.querySelectorAll("[data-remove-recipe]").forEach((btn) => {
    btn.addEventListener("click", () => removeRecipeFromMeal(btn.dataset.day, btn.dataset.meal, btn.dataset.removeRecipe));
  });
}

// Normaliza una entrada de comida del menú: las entradas nuevas
// (issue #242) son objetos { recipeId, comensales } con el número de
// comensales propios de esa receta (null = heredar el global de la
// semana); las antiguas guardadas en Firestore son strings con solo el
// id. Devuelve { recipe, comensales } con la receta resuelta o null.
function mealEntryOf(entry) {
  if (typeof entry === "string") return { recipe: entry, comensales: null };
  return { recipe: entry?.recipeId || null, comensales: entry?.comensales ?? null };
}

// ---------- Buscador de recetas (issue #242) ----------
//
// Ventana modal que sustituye al desplegable de añadir receta: lista
// de tarjetas (foto a la izquierda, nombre arriba, etiquetas abajo),
// con buscador de texto y filtros por alérgenos y tipo de plato. Al
// pulsar una tarjeta se abre la receta en modo lectura (la misma
// ventana de la pestaña Recetas); «Añadir» permite elegir los
// comensales de esa receta (vacío = heredar el global del menú).

let pickerDay = null;
let pickerMeal = null;
let pickerQuery = "";
// Filtros del buscador (issue #242): multiselección con «todas»
// marcadas por defecto (patrón de la pestaña Recetas, issue #234).
let pickerAlergenoFilter = new Set();
let pickerTipoFilter = new Set();
// Limpieza del trap de foco del modal del buscador.
let pickerCleanup = null;
// Los listeners de documento (Escape y cierre de paneles al hacer
// click fuera) se enlazan una sola vez: el modal se re-renderiza en
// cada apertura y de otro modo se acumularían.
let pickerDocEventsBound = false;

// Ids de todas las etiquetas visibles en el panel del buscador
// (predefinidas + propias del usuario).
function pickerTagIds(scope) {
  const preset = scope === "alergeno" ? ALERGEN_TAGS : MEAL_TYPES;
  return mergeTags(preset, getCustomTags().filter((t) => t.tipo === scope)).map((t) => t.id);
}

// «Todas» está marcado si y solo si TODAS las etiquetas del panel
// están en el filtro (patrón de recipeFilterAllChecked).
function pickerFilterAllChecked(scope) {
  const ids = pickerTagIds(scope);
  return ids.length > 0 && ids.every((id) =>
    scope === "alergeno" ? pickerAlergenoFilter.has(id) : pickerTipoFilter.has(id)
  );
}

function pickerFilterLabel(scope) {
  if (pickerFilterAllChecked(scope)) return scope === "alergeno" ? "Todos los alérgenos" : "Todos los tipos";
  const n = scope === "alergeno" ? pickerAlergenoFilter.size : pickerTipoFilter.size;
  const word = scope === "alergeno" ? "alérgeno" : "tipo";
  return `${n} ${n === 1 ? word : word + "s"}`;
}

// Apertura del buscador para una comida (día × comida de la rejilla).
// El botón único «+ Añadir receta» (issue #242, iteración) lo abre sin
// destino: el usuario elige dentro el día (o «Toda la semana») y la
// comida. pickerDay "*" = semana completa (pickerMeal = null).
function openRecipePicker(day = DAY_KEYS[0], meal = MEAL_KEYS[0]) {
  pickerDay = day;
  pickerMeal = meal;
  pickerQuery = "";
  pickerAlergenoFilter = new Set(pickerTagIds("alergeno"));
  pickerTipoFilter = new Set(pickerTagIds("tipo"));

  const modal = document.getElementById("recipe-picker-modal");
  if (!modal) return;
  modal._previousActiveElement = document.activeElement;
  renderRecipePicker();
  modal.classList.remove("hidden");
  if (pickerCleanup) pickerCleanup();
  pickerCleanup = trapFocus(modal.querySelector(".modal__card"));
  // Foco al buscador (tras el rAF de trapFocus, que enfoca la ✕).
  requestAnimationFrame(() => {
    document.getElementById("recipe-pick-search")?.focus({ preventScroll: false });
  });
}

function closeRecipePicker() {
  const modal = document.getElementById("recipe-picker-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (pickerCleanup) {
    pickerCleanup();
    pickerCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Restaura el buscador tras cerrar la ventana de lectura de una
// receta (callback onClose de openRecipeModal). El estado (día,
// comida, búsqueda y filtros) vive en las variables de módulo y no se
// resetea al re-renderizar, así que el buscador reaparece tal como se
// dejó.
function restoreRecipePicker() {
  const modal = document.getElementById("recipe-picker-modal");
  if (!modal) return;
  renderRecipePicker();
  modal.classList.remove("hidden");
  if (pickerCleanup) pickerCleanup();
  pickerCleanup = trapFocus(modal.querySelector(".modal__card"));
  requestAnimationFrame(() => {
    document.getElementById("recipe-pick-search")?.focus({ preventScroll: false });
  });
}

function renderRecipePicker() {
  const content = document.getElementById("recipe-picker-content");
  const wholeWeek = pickerDay === "*";
  content.innerHTML = `
    <div class="recipe-pick">
      <h3 class="recipe-pick__title"></h3>
      <div class="recipe-pick__target">
        <label class="recipe-pick__field" for="recipe-pick-day">Día
          <select id="recipe-pick-day">
            <option value="*">Toda la semana</option>
            ${DAY_KEYS.map((d) => `<option value="${d}">${DAY_LABELS[d]}</option>`).join("")}
          </select>
        </label>
        <label class="recipe-pick__field" for="recipe-pick-meal">Comida
          <select id="recipe-pick-meal">
            ${MEAL_KEYS.map((m) => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="recipe-pick__week-hint hidden" aria-live="polite">Se añade una vez a la semana y NO se multiplica
        por los comensales (p. ej. una masa de pizza para toda la semana).</p>
      <div class="recipe-pick__toolbar">
        <input type="search" id="recipe-pick-search" class="recipe-pick__search"
          placeholder="Buscar receta…" aria-label="Buscar receta" autocomplete="off" />
        <div class="recipes-filter" id="recipe-pick-alergeno-filter">
          <button type="button" id="btn-recipe-pick-alergeno" class="recipes-filter__btn"
            aria-haspopup="true" aria-expanded="false" aria-controls="recipe-pick-alergeno-panel">
            <span id="recipe-pick-alergeno-label">${pickerFilterLabel("alergeno")}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div id="recipe-pick-alergeno-panel" class="recipes-filter__panel recipe-pick__panel hidden"></div>
        </div>
        <div class="recipes-filter" id="recipe-pick-tipo-filter">
          <button type="button" id="btn-recipe-pick-tipo" class="recipes-filter__btn"
            aria-haspopup="true" aria-expanded="false" aria-controls="recipe-pick-tipo-panel">
            <span id="recipe-pick-tipo-label">${pickerFilterLabel("tipo")}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div id="recipe-pick-tipo-panel" class="recipes-filter__panel recipe-pick__panel hidden"></div>
        </div>
      </div>
      <div id="recipe-pick-list" class="recipe-pick__list"></div>
    </div>`;

  // Estado inicial de los selectores de destino (día / comida). Con
  // «Toda la semana» la comida no aplica: el selector queda desactivado.
  const daySel = content.querySelector("#recipe-pick-day");
  const mealSel = content.querySelector("#recipe-pick-meal");
  daySel.value = pickerDay === "*" ? "*" : pickerDay;
  mealSel.value = pickerMeal || MEAL_KEYS[0];
  if (wholeWeek) mealSel.disabled = true;
  updatePickerTargetUi(content);

  bindRecipePickerEvents(content);
  renderRecipePickerList();
}

// Título del buscador y aviso de «Toda la semana» según el destino.
function updatePickerTargetUi(content) {
  const title = content.querySelector(".recipe-pick__title");
  const targetLabel = pickerDay === "*"
    ? "toda la semana"
    : `${DAY_LABELS[pickerDay]} · ${MEAL_LABELS[pickerMeal]}`;
  title.textContent = `Añadir receta a ${targetLabel}`;
  const hint = content.querySelector(".recipe-pick__week-hint");
  if (hint) hint.classList.toggle("hidden", pickerDay !== "*");
}

function bindRecipePickerEvents(content) {
  document.getElementById("recipe-picker-close").addEventListener("click", closeRecipePicker);
  document.getElementById("recipe-picker-backdrop").addEventListener("click", closeRecipePicker);
  ensureRecipePickerDocEvents();

  // Búsqueda en vivo.
  content.querySelector("#recipe-pick-search").addEventListener("input", (e) => {
    pickerQuery = e.target.value.trim().toLowerCase();
    renderRecipePickerList();
  });

  // Selector de destino: día (o toda la semana) y comida. Cambiar el
  // día a «Toda la semana» desactiva la comida y muestra el aviso.
  const daySel = content.querySelector("#recipe-pick-day");
  const mealSel = content.querySelector("#recipe-pick-meal");
  daySel.addEventListener("change", () => {
    pickerDay = daySel.value === "*" ? "*" : daySel.value;
    if (pickerDay === "*") {
      pickerMeal = null;
      mealSel.disabled = true;
    } else {
      pickerMeal = mealSel.value || MEAL_KEYS[0];
      mealSel.disabled = false;
    }
    updatePickerTargetUi(content);
    renderRecipePickerList();
  });
  mealSel.addEventListener("change", () => {
    if (pickerDay === "*") return;
    pickerMeal = mealSel.value;
    updatePickerTargetUi(content);
    renderRecipePickerList();
  });

  // Filtros por etiquetas (patrón de los paneles de la pestaña
  // Recetas): se pintan al abrir y se alterna solo la marca.
  ["alergeno", "tipo"].forEach((scope) => {
    const btn = content.querySelector(`#btn-recipe-pick-${scope}`);
    const panel = content.querySelector(`#recipe-pick-${scope}-panel`);
    btn.addEventListener("click", () => {
      if (panel.classList.contains("hidden")) {
        renderRecipePickerFilterPanel(scope, panel);
        panel.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
      } else {
        panel.classList.add("hidden");
        btn.setAttribute("aria-expanded", "false");
      }
    });
    panel.addEventListener("change", (e) => {
      const input = e.target.closest("input[type='checkbox']");
      if (!input) return;
      const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
      if (input.value === "__all__") {
        if (input.checked) {
          pickerTagIds(scope).forEach((id) => active.add(id));
        } else {
          active.clear();
        }
      } else if (input.checked) {
        active.add(input.value);
      } else {
        active.delete(input.value);
      }
      syncPickerFilterPanel(scope, panel);
      content.querySelector(`#recipe-pick-${scope}-label`).textContent = pickerFilterLabel(scope);
      renderRecipePickerList();
    });
  });

  // Lista de tarjetas: delegación (ver receta en lectura / añadir).
  const list = content.querySelector("#recipe-pick-list");
  list.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-pick-add]");
    if (addBtn) {
      expandComensalesRow(addBtn);
      return;
    }
    const confirmBtn = e.target.closest("[data-pick-confirm]");
    if (confirmBtn) {
      // Guard contra doble clic: el botón se desactiva y, si el alta
      // no se produjo (receta ya añadida), se rehabilita.
      confirmBtn.disabled = true;
      const card = confirmBtn.closest("[data-pick-card]");
      if (!card) return;
      const input = card.querySelector(".recipe-pick__comensales input");
      const raw = Number(input?.value);
      const comensales = input && input.value !== "" && Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : null;
      addRecipeToMeal(pickerDay, pickerMeal, card.dataset.pickCard, comensales).then((added) => {
        if (!added) confirmBtn.disabled = false;
      });
      return;
    }
    const cancelBtn = e.target.closest("[data-pick-cancel]");
    if (cancelBtn) {
      const card = cancelBtn.closest("[data-pick-card]");
      if (!card) return;
      collapseComensalesRow(card);
      return;
    }
    // Click en la tarjeta (fuera de sus botones y de la fila de
    // comensales): abre la receta en modo lectura, la misma ventana
    // de la pestaña Recetas.
    const cardEl = e.target.closest("[data-pick-card]");
    if (cardEl && !e.target.closest("button, input, label")) {
      const recipe = getRecipes().find((r) => r.id === cardEl.dataset.pickCard);
      if (!recipe) return;
      closeRecipePicker();
      openRecipeModal(recipe, { readOnly: true, onClose: restoreRecipePicker });
    }
  });
  // Soporte de teclado: Enter/Espacio en la tarjeta (fuera de botones
  // e inputs) abre la lectura; Enter en el número de comensales
  // confirma el alta de la receta.
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches(".recipe-pick__comensales input")) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const inputEl = e.target;
      if (inputEl.disabled) return; // guard de doble Enter
      inputEl.disabled = true;
      const card = inputEl.closest("[data-pick-card]");
      if (!card) return;
      const input = card.querySelector(".recipe-pick__comensales input");
      const raw = Number(input?.value);
      const comensales = input && input.value !== "" && Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : null;
      addRecipeToMeal(pickerDay, pickerMeal, card.dataset.pickCard, comensales).then((added) => {
        if (!added) inputEl.disabled = false;
      });
      return;
    }
    // Los botones internos de la tarjeta gestionan su propio Enter
    // (click nativo): no abrir la lectura.
    if (e.target.closest("button")) return;
    const card = e.target.closest("[data-pick-card]");
    if (!card) return;
    e.preventDefault();
    const recipe = getRecipes().find((r) => r.id === card.dataset.pickCard);
    if (!recipe) return;
    closeRecipePicker();
    openRecipeModal(recipe, { readOnly: true, onClose: restoreRecipePicker });
  });
}

// Listeners globales del buscador (Escape y cierre de paneles con
// click fuera): se enlazan una vez al abrir por primera vez y se
// resuelven los elementos del render actual en el momento del evento.
function ensureRecipePickerDocEvents() {
  if (pickerDocEventsBound) return;
  pickerDocEventsBound = true;
  const modal = document.getElementById("recipe-picker-modal");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      e.preventDefault();
      closeRecipePicker();
    }
  });
  document.addEventListener("click", (e) => {
    const content = document.getElementById("recipe-picker-content");
    if (!content) return;
    ["alergeno", "tipo"].forEach((scope) => {
      const wrap = content.querySelector(`#recipe-pick-${scope}-filter`);
      const panel = content.querySelector(`#recipe-pick-${scope}-panel`);
      if (wrap && panel && !wrap.contains(e.target) && !panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        content.querySelector(`#btn-recipe-pick-${scope}`).setAttribute("aria-expanded", "false");
      }
    });
  });
}

// Panel de filtro del buscador: «Todas» + etiquetas (predefinidas y
// propias). Se pinta solo al abrir.
function renderRecipePickerFilterPanel(scope, panel) {
  const preset = scope === "alergeno" ? ALERGEN_TAGS : MEAL_TYPES;
  const tags = mergeTags(preset, getCustomTags().filter((t) => t.tipo === scope));
  const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
  const allChecked = pickerFilterAllChecked(scope);
  panel.innerHTML = `<label class="recipes-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todas</span>
    </label>
    <div class="recipes-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = active.has(t.id);
      return `<label class="recipes-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

// Marca visual de las casillas del panel (la fuente de verdad es el
// Set activo, no input.checked; patrón del filtro de Recetas).
function syncPickerFilterPanel(scope, panel) {
  const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
  const allChecked = pickerFilterAllChecked(scope);
  const all = panel.querySelector(".recipes-filter__all");
  if (all) {
    all.classList.toggle("is-checked", allChecked);
    all.querySelector("input").checked = allChecked;
  }
  panel.querySelectorAll(".recipes-filter__item").forEach((item) => {
    const input = item.querySelector("input");
    const checked = active.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

// Etiquetas de una receta (alérgenos + tipo de plato) como HTML de
// píldoras .recipe-card__tag: misma fuente de verdad para las
// tarjetas del buscador y las tarjetas en miniatura de la rejilla.
function recipeTagsHtml(r) {
  const alergenos = mergeTags(ALERGEN_TAGS, getCustomTags().filter((t) => t.tipo === "alergeno"))
    .filter((t) => (r.alergenos || []).includes(t.id));
  const tipos = mergeTags(MEAL_TYPES, getCustomTags().filter((t) => t.tipo === "tipo"))
    .filter((t) => (r.tipos || []).includes(t.id));
  return [
    ...alergenos.map((t) => `<span class="recipe-card__tag recipe-card__tag--alergeno">${escapeHtml(t.label)}</span>`),
    ...tipos.map((t) => `<span class="recipe-card__tag recipe-card__tag--tipo">${escapeHtml(t.label)}</span>`),
  ].join("");
}

// Lista de tarjetas del buscador: foto a la izquierda (si la tiene),
// nombre como título arriba a la derecha y etiquetas de alérgenos y
// tipo de plato abajo. La tarjeta entera abre la lectura; el botón
// «Añadir» despliega la selección de comensales.
function renderRecipePickerList() {
  const list = document.getElementById("recipe-pick-list");
  if (!list) return;
  const menu = activeMenu();
  // Ya añadidas al destino elegido: la comida del día (días concretos)
  // o las recetas de la semana (destino «Toda la semana»).
  const existing = new Set(
    pickerDay === "*"
      ? (menu.recetasPorSemana || []).map((e) => e.recipeId)
      : (menu.dias?.[pickerDay]?.[pickerMeal] || []).map((e) => (typeof e === "string" ? e : e.recipeId))
  );
  const candidates = getRecipes().filter((r) => {
    if (existing.has(r.id)) return false;
    if (!pickerFilterAllChecked("alergeno") && !(r.alergenos || []).some((id) => pickerAlergenoFilter.has(id))) return false;
    if (!pickerFilterAllChecked("tipo") && !(r.tipos || []).some((id) => pickerTipoFilter.has(id))) return false;
    if (pickerQuery && !recipeMatchesQuery(r, pickerQuery)) return false;
    return true;
  });

  if (!candidates.length) {
    const all = getRecipes();
    const allInTarget = pickerDay === "*"
      ? "Ya están todas tus recetas en la semana."
      : "Ya están todas tus recetas en esta comida.";
    const msg = !all.length
      ? "Aún no hay recetas. Crea la primera en la pestaña Recetas."
      : existing.size === all.length
        ? allInTarget
        : "Ninguna receta coincide con la búsqueda o los filtros.";
    list.innerHTML = `<p class="recipe-pick__empty">${msg}</p>`;
    return;
  }

  list.innerHTML = candidates.map((r) => {
    const tagHtml = recipeTagsHtml(r);
    return `<article class="recipe-pick__card" role="button" tabindex="0" data-pick-card="${escapeHtml(r.id)}"
        aria-label="Ver receta ${escapeHtml(r.nombre)}">
      <div class="recipe-pick__card-main">
        ${r.fotoUrl ? `<img class="recipe-pick__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
        <span class="recipe-pick__copy">
          <span class="recipe-pick__name">${escapeHtml(r.nombre)}</span>
          ${tagHtml ? `<span class="recipe-pick__tags">${tagHtml}</span>` : ""}
        </span>
      </div>
      <button type="button" class="btn btn--small btn--primary recipe-pick__add" data-pick-add="${escapeHtml(r.id)}">+ Añadir</button>
    </article>`;
  }).join("");
}

// Coincidencia con el texto del buscador: por nombre, ingrediente y
// etiquetas (mismo criterio que la búsqueda de la pestaña Recetas).
function recipeMatchesQuery(r, q) {
  if ((r.nombre || "").toLowerCase().includes(q)) return true;
  if ((r.ingredientes || []).some((i) => normalizeIngredientName(i.nombre).toLowerCase().includes(q))) return true;
  const labels = [
    ...(r.alergenos || []).map((id) => tagLabelInMenu("alergeno", id)),
    ...(r.tipos || []).map((id) => tagLabelInMenu("tipo", id)),
    ...(r.ingredientes || []).map((i) => tagLabelInMenu("ingrediente", i.categoriaId)),
  ];
  return labels.some((t) => t && t.toLowerCase().includes(q));
}

function tagLabelInMenu(scope, id) {
  if (!id) return "";
  const preset = scope === "alergeno" ? ALERGEN_TAGS : scope === "tipo" ? MEAL_TYPES : [];
  const found = preset.find((t) => t.id === id);
  if (found) return found.label;
  const custom = getCustomTags().find((t) => t.id === id);
  return custom ? custom.nombre || custom.id : id;
}

// Fila de comensales de la tarjeta: un número opcional más los
// botones «Añadir» (confirma el alta) y «Cancelar». Vacío (o 0) → la
// receta hereda los comensales globales del menú.
function expandComensalesRow(addBtn) {
  const card = addBtn.closest("[data-pick-card]");
  if (!card) return;
  const global = Number(activeMenu().comensales) || 1;
  const pickId = escapeHtml(card.dataset.pickCard);
  addBtn.insertAdjacentHTML("beforebegin", `<span class="recipe-pick__comensales">
      <label for="pick-com-${pickId}">Comensales</label>
      <input type="number" id="pick-com-${pickId}" min="1" max="99" inputmode="numeric"
        placeholder="Menú (${global})" aria-label="Comensales de esta receta (vacío = los del menú)" />
      <button type="button" class="btn btn--small btn--primary recipe-pick__confirm" data-pick-confirm>Añadir</button>
      <button type="button" class="btn btn--small recipe-pick__cancel" data-pick-cancel>Cancelar</button>
    </span>`);
  addBtn.hidden = true;
  card.querySelector(".recipe-pick__comensales input").focus();
}

function collapseComensalesRow(card) {
  card.querySelector(".recipe-pick__comensales")?.remove();
  const addBtn = card.querySelector("[data-pick-add]");
  if (addBtn) addBtn.hidden = false;
}

// Añade la receta al destino con sus comensales propios (o null si
// no se indicó → hereda el global del menú). Con day "*" la receta va
// a «recetas a la semana» (NO se multiplica por los comensales).
// Devuelve true si se añadió y false si ya estaba (el buscador sigue
// abierto).
async function addRecipeToMeal(day, meal, recipeId, comensales = null) {
  const current = activeMenu();
  if (day === "*") {
    const list = current.recetasPorSemana || [];
    if (list.some((e) => e.recipeId === recipeId)) {
      showToast("Esa receta ya está en la semana.");
      renderMenu();
      return false;
    }
    await updateActiveMenu({ recetasPorSemana: [...list, { recipeId, cantidad: 1 }] });
    closeRecipePicker();
    renderMenu();
    showToast("Receta añadida a la semana.");
    return true;
  }
  const entries = (current.dias[day][meal] || []).map(mealEntryOf).map((e) => e.recipe);
  if (entries.includes(recipeId)) {
    showToast("Esa receta ya está en esa comida.");
    renderMenu();
    return false;
  }
  const dias = {
    ...current.dias,
    [day]: { ...current.dias[day], [meal]: [...(current.dias[day][meal] || []), { recipeId, comensales }] },
  };
  await updateActiveMenu({ dias });
  closeRecipePicker();
  renderMenu();
  showToast("Receta añadida al menú.");
  return true;
}

async function removeRecipeFromMeal(day, meal, recipeId) {
  const menu = activeMenu();
  const entries = (menu.dias[day][meal] || []).filter((e) => mealEntryOf(e).recipe !== recipeId);
  const dias = { ...menu.dias, [day]: { ...menu.dias[day], [meal]: entries } };
  await updateActiveMenu({ dias });
  renderMenu();
}

// ---------- Recetas a la semana (no escalan) ----------

// «Recetas a la semana» (issue #242, iteración): las mismas tarjetas
// .menu-meal__card que las celdas de la rejilla (foto, nombre y
// etiquetas; la ✕ quita y la tarjeta abre la receta en lectura), en
// lugar del simple nombre con botón «Quitar» de antes. Reutilizan las
// mismas clases y el mismo recipeTagsHtml, así que su aspecto y su
// comportamiento coinciden con el menú por días.
function renderWeeklyRecipes(menu) {
  const list = document.getElementById("menu-weekly-list");
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  if (!menu.recetasPorSemana?.length) {
    list.innerHTML = `<p class="menu-weekly__empty">Ninguna receta a la semana.</p>`;
    return;
  }
  list.innerHTML = menu.recetasPorSemana.map((entry) => {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) return "";
    const tagHtml = recipeTagsHtml(recipe);
    return `<article class="menu-meal__card" role="button" tabindex="0"
        data-menu-card="${escapeHtml(entry.recipeId)}"
        aria-label="Ver receta ${escapeHtml(recipe.nombre)}">
        ${recipe.fotoUrl ? `<img class="menu-meal__card-photo" src="${escapeHtml(recipe.fotoUrl)}" alt="" loading="lazy" />` : ""}
        <span class="menu-meal__card-copy">
          <span class="menu-meal__card-name">${escapeHtml(recipe.nombre)}</span>
          ${tagHtml ? `<span class="menu-meal__card-tags">${tagHtml}</span>` : ""}
        </span>
        <button type="button" class="menu-meal__remove" data-weekly-remove="${escapeHtml(entry.recipeId)}"
          aria-label="Quitar ${escapeHtml(recipe.nombre)} de la semana">✕</button>
      </article>`;
  }).join("");
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

// Semana activa del menú (offset). La lista de la compra la usa para
// arrancar su selección en la misma semana que el menú (issue #225).
export function getActiveWeekOffset() {
  return weekOffset;
}

// Datos del menú activo para la lista de la compra: devuelve
// { semanaInicio, comensales, dias, recetasPorSemana, recetasExcluidasCompra }.
export function getActiveMenuData() {
  return getMenuDataByWeek(activeMenu().semanaInicio);
}

// Datos de una semana concreta para la lista de la compra
// multi-semana (issue #225): mismo shape que getActiveMenuData pero
// para cualquier semana (con o sin documento guardado).
export function getMenuDataByWeek(weekStart) {
  const menu = menuForWeek(weekStart);
  return {
    semanaInicio: menu.semanaInicio,
    comensales: Number(menu.comensales) || 1,
    dias: menu.dias || emptyDias(),
    recetasPorSemana: menu.recetasPorSemana || [],
    recetasExcluidasCompra: menu.recetasExcluidasCompra || [],
    itemsExtra: menu.itemsExtra || [],
    itemsEliminados: menu.itemsEliminados || [],
    // Semanas sin documento guardado: id null (para no crear docs al
    // eliminar ítems de semanas vacías, issue #225).
    hasDoc: Boolean(menu.id),
  };
}

// Actualiza los ítems extra de la lista de la compra (persisten en
// el documento del menú activo).
export async function updateMenuExtras(itemsExtra) {
  await updateActiveMenu({ itemsExtra });
}

// Limpia referencias a una receta borrada en los menús existentes
// (entradas string antiguas y objetos { recipeId, comensales } de la
// issue #242, a través de mealEntryOf).
export async function cleanupDeletedRecipe(recipeId) {
  for (const menu of menus) {
    const data = menuDataOf(menu);
    let changed = false;
    let dias = data.dias;
    DAY_KEYS.forEach((day) => {
      MEAL_KEYS.forEach((meal) => {
        const entries = (dias[day]?.[meal] || []).filter((e) => mealEntryOf(e).recipe !== recipeId);
        if (entries.length !== (dias[day]?.[meal] || []).length) {
          dias = { ...dias, [day]: { ...dias[day], [meal]: entries } };
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
