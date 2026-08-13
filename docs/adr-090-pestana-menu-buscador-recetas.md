# ADR-090: Pestaña Menú — eliminación del desayuno y buscador de recetas con comensales por receta (issue #242)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #242 pide cuatro cambios en la pestaña **Menú** (ADR-076,
sección de recetas, issue #64):

1. **Eliminar el desayuno** del menú: este pasa a cubrir solo
   **Almuerzo** y **Cena**.
2. Al añadir una receta a una comida, **sustituir el desplegable** por
   una **ventana con tarjetas** de las recetas: foto (si la tiene) en
   pequeño a la izquierda, nombre como título arriba a la derecha y
   etiquetas de **alérgenos y tipos de plato** debajo.
3. Ese buscador debe permitir **buscar por texto** y **filtrar por las
   dos etiquetas** (alérgenos y tipo de plato).
4. Al pulsar una receta se abre la **ventana de lectura** igual que la
   de la pestaña Recetas (ADR-088, issue #236).
5. Al añadir una receta se pueden elegir los **comensales de esa
   receta** (no todos comen de todo); si no se indica ninguno, se usa
   la **selección global del menú**.

Estado previo: `addRecipeToMeal` en js/menu.js mostraba un
`<select>` inline bajo el botón «+ Receta» con las recetas aún no
añadidas; las entradas de comida en el documento Firestore
(`users/{uid}/menus`, `dias[day][meal]`) eran **strings** con el id de
la receta; el menú tenía tres comidas fijas (`MEAL_KEYS` con
`desayuno`, `almuerzo`, `cena`); «recetas a la semana»
(`recetasPorSemana`) era un bloque aparte con su propio desplegable y
**no** es objeto de esta issue.

Nota del flujo (misma excepción que ADR-083, ADR-085, ADR-087,
ADR-088 y ADR-089): la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde
ahí y la PR va **también a `content/issue-64-seccion-recetas`, no a
`dev`**. El ADR se numera **090**.

## Decisión

1. **Menú de dos comidas**: `MEAL_KEYS`/`MEAL_LABELS` en
   js/recipes-data.js pasan a `["almuerzo", "cena"]`. Los datos
   antiguos `dias[day].desayuno` guardados en Firestore se ignoran
   (rejilla y lista de la compra iteran solo las comidas actuales).
   El tipo de plato «Desayunos» de `MEAL_TYPES` (etiqueta de recetas)
   **se mantiene**: es una etiqueta de tipo de plato, no una comida
   del menú. Se actualiza el hint de «Recetas a la semana» en
   index.html (ya no se menciona el pan de los desayunos).
2. **Ventana del buscador de recetas** (`recipe-picker-modal` en
   index.html, render de `renderRecipePicker` en js/menu.js): un modal
   con el mismo patrón que el de receta (`modal__card--wide`), cuyo
   contenido es una **lista de tarjetas** `.recipe-pick__card`:
   foto pequeña a la izquierda (solo si `fotoUrl`), nombre a la
   derecha arriba y etiquetas de alérgenos / tipos debajo (las mismas
   píldoras `.recipe-card__tag--alergeno/tipo` de la pestaña
   Recetas). Cada tarjeta es pulsable (role button, tabindex 0) y
   tiene su botón «+ Añadir».
   - **Buscador y filtros**: campo de búsqueda en vivo (coincidencia
     por nombre, ingrediente normalizado y etiquetas, mismo criterio
     que la pestaña Recetas) y dos botones de filtro desplegables
     (alérgenos y tipo de plato) que **reutilizan el patrón y las
     clases `.recipes-filter__*`** de la pestaña Recetas (issue #234):
     multiselección con «Todas» marcada por defecto, fuente de verdad
     en Sets (`pickerAlergenoFilter`/`pickerTipoFilter`) y panel
     pintado solo al abrir. Se abre con todas marcadas en cada
     apertura; no hay flag de "tocado" (el estado del buscador es
     efímero, se descarta al cerrar).
   - **Lectura**: pulsar una tarjeta (click, Enter o Espacio) cierra
     el buscador y abre `openRecipeModal(recipe, { readOnly: true,
     onClose })`: la misma ventana de lectura de la pestaña Recetas.
     Se añade un **callback `onClose`** a `openRecipeModal` (issue
     #242) que se invoca una única vez al cerrar el modal y se
     limpia; menu.js lo usa para **restaurar el buscador** (trap de
     foco y foco al campo de búsqueda; el estado de búsqueda/filtros
     se conserva porque la lista no se re-renderiza).
3. **Comensales por receta**: las entradas de comida pasan de strings
   a **objetos `{ recipeId, comensales }`** (`comensales` = número o
   null si hereda el global). `mealEntryOf` normaliza ambos formatos
   (string antiguo → `{ recipe, comensales: null }`) y se usa en
   rejilla, alta, borrado y limpieza de recetas borradas
   (`cleanupDeletedRecipe`), que antes comparaba el id contra la
   entrada entera y no habría borrado las nuevas.
   - En la tarjeta del buscador, «+ Añadir» despliega una **fila de
     comensales** (número opcional con placeholder «Menú (N)») con
     botones **Añadir** (confirma el alta) y **Cancelar** (repliega);
     Enter en el número también confirma. Vacío/0 → `null` (hereda el
     global del menú). La rejilla muestra el número como distintivo
     pequeño junto al nombre (`.menu-meal__comensales`) y en el
     tooltip.
   - **Lista de la compra** (js/shopping-list.js, ADR-076): el
     cálculo escala cada receta con sus **propios comensales** si los
     tiene y con los **globales** si no: `factor = comensales ÷
     porciones`. Compatible con entradas string antiguas.
4. **Accesibilidad y listeners**: el modal usa `trapFocus` y
   devuelve el foco al abrir; Escape cierra; los listeners globales de
   documento (Escape y cierre de paneles al hacer click fuera) se
   enlazan **una sola vez** (`pickerDocEventsBound`): el contenido del
   modal se re-renderiza en cada apertura y de otro modo se
   acumularían. El callback `onClose` de recetas se invoca en
   `closeRecipeModal` **después** de restaurar el foco y de resetear
   `editingRecipeId`/`modalReadOnly` (el guardado WIP previo dejó esas
   líneas fuera de la función y rompía la carga del módulo).
5. **Responsividad** (AGENTS.md §2): la tarjeta usa `flex-wrap`,
   `min-width: 0` y `overflow-wrap: break-word`; el campo de búsqueda
   es `flex: 1 1 200px` y los paneles de filtro se limitan a
   `max-width: calc(100vw - 3.5rem)`. Sin scroll horizontal en
   360 / 768 / 1280 px.
6. **Cuatro modos de tema** (AGENTS.md §4): todos los estilos nuevos
   usan solo variables de tema (`--ink-raised`/`--paper` en el chip,
   `--paper-dim`/`--ink` en el input de comensales, `--ink-soft` en
   textos secundarios, `--paper-alpha-*` en bordes); las píldoras de
   etiquetas reutilizan los modificadores ya agrupados con sus
   overrides por familia. Sin colores hardcodeados.
7. **Manual de usuario**: §8.3 describe el menú de dos comidas, la
   ventana de tarjetas con buscador/filtros, la lectura de receta y
   los comensales por receta.
8. **PWA**: bump `20260920 → 20260921` en js/config.js
   (`APP_VERSION`), index.html (`?v=`) y service-worker.js
   (`STATIC_ASSETS`).

## Iteración (2026-08-13): contraste del buscador en modo oscuro y negro puro

Hallazgo del usuario tras la PR inicial: **el modo oscuro no se veía
bien en la ventana de búsqueda de recetas**. Causa raíz: las tarjetas
`.recipe-pick__card` y el mensaje vacío `.recipe-pick__empty` no
declaraban color de texto explícito y **heredaban `--ink` del modal**
(que en la familia oscura es papel claro con tinta oscura); sobre el
chip `--ink-raised` de la tarjeta, la tinta daba ≈ **1.1:1**
(invisible) y el mensaje con `--ink-soft` ≈ **2.84:1** (no AA).

Corrección aplicada (mismo patrón que `.recipes-filter__btn` y
`.recipe-view__meta`, selectores agrupados con una sola fuente de
verdad por regla):

- `.recipe-pick__card`: `color: var(--paper)` explícito en la base
  (familia oscura) y override agrupado
  `[data-theme="light"]/[data-theme="white"]` a `--ink`.
- `.recipe-pick__empty`: `--ink → --ink` (tinta del contenido, 15.2:1
  sobre el modal papel) y override `[data-theme="black"]` a
  `--paper` (en negro puro el modal es superficie oscura y `--ink` es
  #000 invisible).
- `.recipe-pick__search` en negro puro: override a
  `--ink` + borde `--paper-alpha-20`, patrón de
  `ingredient-modal__field` / `.recipe-pick__comensales input` — sin
  él, el campo (base `--ink-raised`) compartiría el fondo con el modal
  negro puro y no se distinguiría.

Contrastes resultantes: tarjeta 13.85:1 (oscuro) / 16.51:1 (negro
puro) / 14.65:1 y 21:1 (claro y blanco puro); mensaje vacío 15.2:1 /
16.51:1; placeholder del buscador 6.16:1 (negro puro, AA). Sin cambios
de comportamiento, HTML ni JS: solo CSS de tema, por lo que el manual
de usuario no requiere actualización.

## Iteración 2 (2026-08-13): AA del distintivo de comensales de la rejilla

Hallazgo de la re-validación QA de la iteración anterior: el distintivo
`.menu-meal__comensales` (`· N` junto al nombre de la receta en la
rejilla del menú, nuevo en esta PR) usaba `--ink-soft` y sobre el chip
`.menu-meal__item` (`--paper-alpha-10` sobre la celda `--ink-raised`)
daba ≈ **3.73:1** en el tema Oscuro — por debajo de AA 4.5:1 para
texto de 0.68rem.

Corrección aplicada (mismo patrón que `.recipe-pick__empty` de la
iteración anterior): la base pasa a `--paper-alpha-92` sobre el chip
oscuro (blend ≈ 9.24:1 en Oscuro, 12.2:1 en Negro puro) y la familia
clara recupera `--ink-soft` en un override agrupado
`[data-theme="light"]/[data-theme="white"]` (5.02:1 y 5.44:1, AA) — en
esos temas el papel translúcido de la base es blanco y quedaría
invisible sobre el chip claro. Sin cambios de comportamiento, HTML ni
JS: solo CSS de tema.

## Consecuencias

- **Positivas**: añadir recetas a una comida deja de ser un
  desplegable plano: la ventana con tarjetas, búsqueda y filtros
  facilita encontrar recetas con restricciones (alérgenos) y tipos;
  los comensales por receta reflejan que no todos comen de todo, y la
  lista de la compra escala cada receta por lo que realmente se
  cocina; el menú queda ajustado a almuerzo y cena.
- **Neutras**: las entradas antiguas (strings) siguen siendo válidas;
  el desayuno guardado en documentos existentes queda sin uso visible;
  «recetas a la semana» conserva su desplegable (fuera del alcance de
  la issue); bump PWA `20260920 → 20260921`.
- **Negativas**: ninguna conocida. Se prevé validar los criterios de
  aceptación (sin desayuno, ventana con tarjetas con foto/nombre/
  etiquetas, búsqueda y filtros por las dos etiquetas, lectura de
  receta, comensales por receta con herencia del global), la
  responsividad en 360 / 768 / 1280 px sin scroll horizontal, los
  cuatro modos de tema con contraste AA y el escaneo de seguridad sin
  hallazgos (todo dato de usuario pasa por `escapeHtml`, incluidos
  nombres de receta, etiquetas y atributos `data-*`).

Related issue: #242