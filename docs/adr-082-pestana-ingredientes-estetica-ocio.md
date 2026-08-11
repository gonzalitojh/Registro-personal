# ADR-082: Estética tipo Ocio de la pestaña de Ingredientes — toolbar, tarjetas agrupadas y modal de detalle (issue #218)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #218 pide mejorar la visualización de la pestaña
**«Ingredientes»** de la sección de Recetas (issue #64) para acercarla
estéticamente a las pestañas de **Ocio** (issue #118/#208): barra de
herramientas superior con **botón de alta manual**, **filtro por
categorías** (multiselección, todas por defecto) y **ordenación**,
catálogo **dividido por categorías** y **tarjetas que muestran solo el
nombre**, con la información ampliada en una **ventana modal** al
pulsarlas.

Estado previo (construido en ADR-080, issue #209): la pestaña mostraba
el catálogo como una **lista** (`renderIngredientsCatalog`) con el
nombre, un **select inline** para cambiar la categoría y un pie
«Usada en: …» con links a las recetas. No había forma de añadir
ingredientes a mano (el catálogo se rellenaba solo desde las recetas)
ni de filtrar u ordenar.

Decisiones clave del rediseño:

1. **Toolbar estilo Ocio**: se reutilizan los patrones de
   `ocio/libros.html` (`.library-controls` + `.sort-select`) — botón
   «+ Nuevo ingrediente» (`btn--primary`), dropdown de filtro y select
   de ordenación (Alfabético A-Z / Z-A, Recientes añadidos, Más
   usadas). El filtro es un **dropdown propio con checkboxes** (no hay
   patrón de multiselect nativo con buen aspecto): botón píldora
   (`aria-expanded`/`aria-haspopup`/`aria-controls`) + panel con
   «Todas» y una casilla por categoría (predefinidas + propias del
   usuario), cerrado con click-fuera y Escape (patrón
   `.profile-dropdown` de `profile.js`).
2. **«Todas» por defecto**: el filtro arranca con **todas las
   categorías seleccionadas**; la casilla «Todas» está marcada si y
   solo si lo están todas las visibles (predefinidas + propias). El
   flag `ingredientFilterTouched` evita que las categorías propias
   recién cargadas (suscripción asíncrona) rompan una selección hecha
   por el usuario: si no se ha tocado el filtro, las propias se suman
   al conjunto por defecto.
 3. **«Sin categoría» no es filtrable**: los ingredientes sin categoría
    se muestran siempre (son el cubo de entrada al que se les asigna la
    categoría desde el modal) y su grupo va **al final** de la lista.
 3-bis. **Filtro en vivo** (iteración tras comentario de la issue
    #218): el filtro se aplica y los ítems se colorean **a medida que
    se seleccionan**, sin esperar al cierre del panel. Los checkboxes
    nativos están ocultos (`opacity: 0`) y la única señal visual es la
    clase `is-checked` del label, así que el manejador `change`
    sincroniza esa clase (y el estado oculto del input) al instante
    para todas las casillas, tomando `activeCategoryFilter` como fuente
    de verdad — cubre también el caso de marcar «Todas», que deja los
    inputs de categorías sin tocar. El catálogo se re-renderiza en cada
    cambio; el panel no se re-renderiza al marcar para no perder el
    foco.
4. **Agrupación por categorías**: patrón de la lista de la compra
   (`shopping-list.js`): predefinidas en su orden, personalizadas
   presentes en los datos por orden alfabético de etiqueta y «Sin
   categoría» al final.
5. **Tarjetas con solo el nombre**: cada ingrediente es un `<button>`
   `.ingredient-card` en una grid `auto-fill` (patrón `.library-grid`).
   La información ampliada (categoría editable, recetas que lo usan,
   eliminar) vive en un **modal nuevo**.
6. **Modal propio `#ingredient-modal`**: se crea un modal nuevo
   siguiendo el patrón de `#recipe-modal` en lugar de reutilizar
   `#item-modal`, que gestiona Ocio con su propio binding en
   `ui.js`/`modal-handlers.js` (tocarlo sería un riesgo alto). El
   modal tiene dos modos sobre el mismo armazón: **detalle** (categoría
   con cambio inmediato + toast, «Usada en N recetas» con links que
   abren la receta en lectura, Eliminar con `confirm`) y **alta
   manual** (nombre + categoría, con deduplicación por nombre
   normalizado).
7. **Ordenación**: 4 modos — Alfabético A-Z (por defecto), Z-A,
   Recientes añadidos (`addedAt`, fallback 0) y Más usadas (conteo del
   índice de uso), todos con tie-break determinista (nombre, luego id).
8. **Cuatro temas**: todos los elementos nuevos usan variables de tema
   con overrides agrupados de la familia clara (`light`+`white`) y del
   negro puro (`black`), siguiendo AGENTS.md §4: violeta `--games` para
   los ítems marcados del filtro con `--games-dark` en negro puro,
   superficies `--paper`→`--ink-raised` en negro puro, etc. Se elimina
   el CSS muerto de la lista anterior (`.ingredient-row*`,
   `.ingredients-catalog__*`).
9. **Responsividad**: toolbar con `flex-wrap`, panel de filtro en
   `position: fixed` con márgenes laterales en móvil (≤767px, patrón
   `.profile-dropdown`) para no desbordar el viewport, grid con
   `minmax(min(150px, 100%), 1fr)`, `overflow-wrap: break-word` en
   tarjetas y títulos (AGENTS.md §2).

## Decisión

1. **HTML** (`index.html`): toolbar estático en `#panel-ingredients-tab`
   (botón `#btn-new-ingredient`, wrapper `#ingredients-filter` con
   `#btn-ingredient-filter` + `#ingredient-filter-panel` y select
   `#ingredient-sort`) y modal `#ingredient-modal` (backdrop + card +
   close + content) tras `#recipe-modal`. El listado de checkboxes del
   panel lo pinta `js/recipes.js` desde `INGREDIENT_CATEGORIES` +
   etiquetas propias (fuente única de verdad, sin duplicar en HTML).
2. **JS** (`js/recipes.js`): estado de módulo nuevo (`ingredientSort`,
   `activeCategoryFilter` — Set con todas por defecto,
   `ingredientFilterTouched`, `ingredientModalCleanup`), helpers
   `getUsageIndex()` / `compareIngredients()` /
   `ingredientFilterCategoryIds()` / `ingredientFilterAllChecked()`,
    `renderIngredientsCatalog()` reescrito (contador + grupos + grid de
    tarjetas + empty states diferenciados), `renderIngredientFilter()` /
    `updateIngredientFilterLabel()` / `syncIngredientFilterAll()` /
    `syncIngredientFilterItems()` (iteración: marca visual en vivo de
    cada casilla desde `activeCategoryFilter`) /
    `closeIngredientFilterPanel()` / `setupIngredientFilter()` (toggle +
    click-fuera + Escape con limpieza del listener; en `change`:
    actualiza el Set, sincroniza las marcas `is-checked` y re-renderiza
    el catálogo al momento), y el modal
   `openIngredientModal()` / `closeIngredientModal()` /
   `ingredientDetailHtml()` / `ingredientNewHtml()` /
   `bindIngredientModalHandlers()` (cambio de categoría inmediato,
   links a receta cerrando antes el modal — ambos comparten z-index —,
   eliminar con confirm, alta manual con normalización y sin
   duplicados). `setupRecipes` registra los bindings; `openRecipes`
   cierra el panel al cambiar de pestaña; `resetRecipesData` resetea
   orden/filtro y cierra modal y panel.
3. **CSS** (`css/styles.css`): bloque nuevo
   `/* --- Catálogo de ingredientes (issue #218): estética tipo Ocio --- */`
   con `.ingredients-toolbar`, `.ingredients-filter*`,
   `.ingredients-count`, `.ingredient-group*`, `.ingredient-grid`,
   `.ingredient-card`, `.ingredient-modal__*` y overrides de los 4
   temas (selectores agrupados light+white y black por separado). El
   select de ordenación reutiliza `.sort-select` de `ocio/ocio.css`
   (ya cargado en `index.html` y con overrides propios, precedente:
   `.empty-state`).
4. **Manual de usuario**: §8.5 reescrita con el nuevo comportamiento
   (toolbar, filtro multiselección, ordenación, tarjetas, modal de
   detalle, alta manual y eliminación).
5. **PWA**: bump de versión `20260910 → 20260911` con
   `scripts/bump-version.sh`.

## Consecuencias

- **Positivas**: la pestaña «Ingredientes» queda a la altura visual de
  Ocio; el catálogo gana herramientas de gestión (alta manual, filtro,
  orden, eliminar) sin perder ninguna funcionalidad previa (cambio de
  categoría y «Usada en» se conservan en el modal); las tarjetas
  despejan la lista de información; el modal propio aísla el cambio de
  la lógica de Ocio (`#item-modal` intacto). Tras la iteración, el
  filtro da **feedback inmediato**: la casilla se colorea y la lista se
  actualiza en el momento de marcar/desmarcar, sin depender del cierre
  del panel.
- **Neutras**: el cambio de categoría y la consulta de recetas ahora
  requieren un clic más (modal) que antes (controles inline); los
  ingredientes sin categoría no se pueden ocultar con el filtro
  (decisión deliberada, documentada en este ADR).
- **Negativas**: ninguna conocida. Todos los elementos nuevos usan
  variables de tema existentes y patrones ya validados en los cuatro
  temas (dropdown de perfil, chips de formulario de receta, grupos de
  la lista de la compra); QA validó funcionalidad, responsividad (360 /
  768 / 1280 px sin scroll horizontal) y los cuatro modos de tema; el
  escaneo de seguridad no encontró hallazgos (todos los datos de
  usuario pasan por `escapeHtml`).

### Actualización 2026-08-11 (iteración): filtro en vivo

El comentario de la issue #218 señalaba que, aunque el filtro
funcionaba, «se colorea lo marcado al cerrarse» y no se sabía qué se
había seleccionado: el manejador `change` solo sincronizaba la marca de
«Todas»; los ítems individuales no alternaban su `is-checked` hasta
volver a abrir el panel (y en móvil el panel tapa el catálogo, así que
el filtro parecía aplicarse al cerrar). Se añade
`syncIngredientFilterItems()`, que alterna la clase `is-checked` (y el
estado del input oculto) de todas las casillas desde
`activeCategoryFilter` en cada `change`, junto a la re-renderización
del catálogo que ya existía. Resultado: la selección se colorea y el
filtro se aplica **a medida que se selecciona**; cerrar el panel solo
lo oculta, no aplica cambios pendientes. No hay cambios de CSS (las
clases `is-checked` ya estaban estilizadas en los cuatro temas) ni de
marcado HTML; se actualiza el manual §8.5.

Related issue: #218
