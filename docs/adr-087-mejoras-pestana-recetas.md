# ADR-087: Mejoras de la pestaña de Recetas — tarjetas clickeables, ventana de información con Editar/Eliminar y filtros multiselección (issue #234)

## Estado
Aceptado

## Fecha
2026-08-12

## Contexto

La issue #234 pide rediseñar la interacción con las recetas de la
pestaña «Recetas» de la sección de Recetas (issue #64), en la línea de
lo que ADR-082/ADR-085 hicieron con la pestaña de Ingredientes:

1. **Eliminar los botones «Ver», «Editar» y «Eliminar»** de las tarjetas
   de receta.
2. **La tarjeta entera es clickeable**: pulsar en cualquier punto abre
   la **ventana de información** de la receta en **modo solo lectura**.
3. La ventana **no lleva botón «Cerrar» al final** (la ✕ superior ya
   cumple esa función), pero **sí botones «Editar» y «Eliminar»**.
4. En **modo edición**, pulsar fuera de la ventana **no la cierra**
   (evitar perder lo escrito); en **modo lectura** sí se puede cerrar
   pulsando fuera.
5. Añadir **dos filtros desplegables multiselección** arriba del
   listado: uno de **alérgenos** y otro de **tipo de comida**, con el
   mismo patrón («Todos» + etiquetas marcables, filtrado en vivo) que
   el filtro de categorías de la pestaña de Ingredientes.

Estado previo: las tarjetas mostradas por `recipeCardHtml` llevaban
tres botones (`data-action="view|edit|delete"`); el modal de receta se
abría siempre en modo edición; la ventana en los flujos de solo lectura
(búsqueda global, «Usada en») reutilizaba ese mismo modal; solo existía
la búsqueda de cabecera como medio de filtrar recetas.

Nota del flujo (misma excepción que ADR-083 y ADR-085): la base de
trabajo es la rama `content/issue-64-seccion-recetas`; la rama de
trabajo se crea desde ahí y la PR va **también a esa rama, no a
`dev`**. El ADR se numera **087** (el 086 ya lo ocupa la lista de la
compra).

## Decisión

1. **Tarjetas sin botones, clickeables por completo**: `recipeCardHtml`
   deja de emitir `.recipe-card__actions` y los tres botones; la tarjeta
   pasa a `role="button"` con `tabindex="0"` y `data-recipe-id`. Un
   único listener delegado en `#recipes-list` (click, y keydown de
   Enter/Espacio con `preventDefault`) abre
   `openRecipeModal(recipe, { readOnly: true })` — no hay elementos
   interactivos dentro de la tarjeta, así que la delegación no entra en
   conflicto con nada. Estética: `cursor: pointer`, hover con
   `--shadow-pop` y `:focus-visible` con `--ochre-spine` (acento ocre de
   la pestaña Recetas, patrón de `.recipe-card:focus-visible` previo).
2. **Ventana de información en solo lectura**: `recipeModalHtml`
   detecta el modo lectura y renderiza los campos con `disabled`, los
   botones `[data-recipe-edit]` (Editar) y `[data-recipe-delete]`
   (Eliminar) y **sin botón «Cerrar»** al final. `bindRecipeModalHandlers`
   conecta: **Editar** re-renderiza la misma ventana en modo edición
   (`openRecipeModal(recipe)` dentro de la misma llamada, sin cerrar ni
   ocultar el modal, liberando el `trapFocus` previo vía
   `modalCleanup()` y devolviendo el foco a `#recipe-nombre`); **Eliminar**
   pasa por `deleteRecipeFlow` (que ahora devuelve `true/false`) y solo
   cierra la ventana si el borrado tuvo éxito.
3. **Cierre por fuera y Escape según modo**: el listener del backdrop y
   el de la tecla Escape solo actúan si `modalReadOnly` es verdadero;
   en modo edición las vías de salida explícitas son la ✕ superior y
   «Cancelar». En lectura, la ✕ y el click fuera cierran igual que
   antes (el foco vuelve a la tarjeta origen, `_previousActiveElement`
   preservado por `wasHidden`).
4. **Filtros multiselección de alérgenos y tipo**: dos dropdowns en
   `.recipes-toolbar` con el patrón del filtro de categorías de
   Ingredientes (`__btn` píldora con `aria-expanded`/`aria-controls`,
   `__panel` con `__all` + `__item` por etiqueta, checkbox oculto y
   estado `is-checked` en el label):
   - Estado vivo: `activeAlergenoFilter` y `activeTipoFilter` (Set de
     ids), más `recipeFilterTouched` (flag que replica
     `ingredientFilterTouched`: impide que la carga tardía de etiquetas
     propias sobrescriba la selección del usuario; la suscripción de
     tags solo sincroniza los filtros si no se han tocado).
   - Render: `renderRecipeFilterPanel(scope)` pinta el panel desde las
     constantes `ALERGEN_TAGS`/`MEAL_TYPES` + etiquetas propias;
     `updateRecipeFilterLabel` pone «Todos los alérgenos»/«Todos los
     tipos» o «N alérgenos»/«N tipos»; `syncRecipeFilterAll/Items`
     mantienen coherencia sin re-render del panel.
   - Filtrado: `renderRecipesList` aplica
     `recipeMatchesAlergenoFilter && recipeMatchesTipoFilter` con la
     semántica «**al menos una** etiqueta marcada en cada filtro; las
     recetas **sin etiquetas** de ese tipo se ven siempre» (mismo
     criterio que los ingredientes sin categoría). Estado vacío con
     mensaje de ajuste de filtros.
   - Comportamiento: los paneles se cierran al cambiar de pestaña
     (nuevo scroll de pestañas en `resetRecipesData`, que también
     reinicia selecciones y `recipeFilterTouched`); Escape y click
     fuera cierran el panel abierto; en móvil (≤767px) el panel se
     ancla al viewport (`position: fixed`) para no desbordar la
     pantalla (AGENTS.md §2).
5. **Estética del filtro (issue #218/ADR-082)**: píldoras con
   `--ink-raised`/`--paper` (overrides de familia clara a
   `--white`/`--ink`), panel con `--paper`/`--ink`, ítems con hover
   `--paper-dim`, marca `is-checked` con **`--ochre-spine-dark`** +
   texto `--white` (≈6.2:1 en Oscuro/Claro/Blanco; en negro puro la
   variante clara `#c99a4e` con texto casi negro ≈7.4:1 — comentario
   documentando el porqué, AGENTS.md §4.4). En **negro puro**, bloque
   `[data-theme="black"] .recipes-filter__*` espejo del de
   Ingredientes: panel `--ink-raised`/`--paper` con borde
   `--paper-alpha-20`, ítems texto `--paper`, hover `--paper-alpha-10`
   y `.is-checked:hover` conservando el ocre (la especificidad del
   override evita que el hover genérico deje texto ilegible). Los
   `:focus-visible` del filtro usan **ocre** (acento de Recetas), en un
   bloque separado del teal del filtro de Ingredientes.
6. **Manual de usuario**: §8.1 refleja el nuevo comportamiento
   (tarjeta pulsable, lectura con Editar/Eliminar, cierre por ✕ y por
   fuera solo en lectura, filtros multiselección con la semántica «al
   menos una»).
7. **PWA**: bump de versión `20260914 → 20260915` en `js/config.js`
   (`APP_VERSION`), `index.html` (`?v=` de estilos y `app.js`) y
   `service-worker.js` (`STATIC_ASSETS`).

## Consecuencias

- **Positivas**: la tarjeta queda limpia (un solo gesto abre la receta,
  como en Ingredientes); la ventana de información en lectura muestra
  claramente sus dos acciones (Editar/Eliminar) sin botón «Cerrar»
  redundante; el modo edición protegido del cierre accidental evita
  perder formularios; los filtros multiselección hacen la pestaña mucho
  más usable cuando hay muchas recetas, con la misma mecánica que el
  filtro de Ingredientes ya conocido; «Editar» desde lectura conserva
  el foco y el estado visual de forma continua.
- **Neutras**: la búsqueda global y el modal «Usada en» reutilizan el
  mismo modal de lectura (ahora con Editar/Eliminar, coherente); las
  recetas sin etiquetas pasan siempre los filtros (decisión deliberada,
  igual que los ingredientes sin categoría); bump PWA `20260914 →
  20260915`.
- **Negativas**: pulsar fuera de la ventana en modo lectura la cierra —
  quien quiera seguir leyendo sin interaccionar debe evitar pulsar el
  fondo (comportamiento pedido por la issue); ninguna otra conocida.
  QA validó los 9 criterios de aceptación (tarjetas sin botones,
  apertura por click y teclado, lectura sin «Cerrar» con Editar/
  Eliminar, cierre por fuera solo en lectura, filtros multiselección en
  vivo con reset y estado vacío), responsividad en 360 / 768 / 1280 px
  sin scroll horizontal y los cuatro modos de tema sin puntos muertos
  ni contrastes insuficientes (marca ocre AA, ≥6.2:1; hover de negro
  puro 7.4:1); el escaneo de seguridad no encontró hallazgos (todo dato
  de usuario pasa por `escapeHtml`).

Related issue: #234