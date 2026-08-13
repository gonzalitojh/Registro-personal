# ADR-091: Ítem extra con buscador del catálogo y «Añadir a la lista de la compra» desde la ficha del ingrediente (issue #249)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #249 pide dos cambios:

1. En la pestaña **Compra** (ADR-076, issue #225), el botón
   **«Item extra»** debe funcionar como añadir ingrediente en las
   recetas (issue #240): un **desplegable con búsqueda de un
   ingrediente** del catálogo, con **cantidad** y **unidad de medida**,
   pero **sin** selector de categoría ni checkbox de «es/no es
   producto de limpieza».
2. En la pestaña **Ingredientes**, al pulsar un ingrediente (modal de
   detalle, ADR-089, issue #248) debe haber un botón **«Añadir a la
   lista de la compra»** que despliegue una ventana para seleccionar
   **únicamente** cantidad y unidad de medida.

Estado previo: el formulario de ítem extra (`renderExtraForm` en
js/shopping-list.js) tenía un `<input>` de **nombre libre** (maxlength
100), un `<select>` de **categoría** y un checkbox **«No es comestible
(limpieza, hogar…)»**; el ítem se escribía a mano en todas las semanas
seleccionadas. El catálogo de ingredientes (ADR-089, issue #248) no
guarda un flag de «comestible»: solo nombre, foto, categoría,
supermercados y cantidad de paquete.

Nota del flujo (misma excepción que ADR-083, ADR-085, ADR-087,
ADR-088, ADR-089 y ADR-090): la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde
ahí y la PR va **también a `content/issue-64-seccion-recetas`, no a
`dev`**. El ADR se numera **091** (el número 090 quedó usado por dos
ADR de la issue #242).

## Decisión

1. **Formulario de ítem extra con combobox** (`renderExtraForm` en
   js/shopping-list.js): el nombre libre, el select de categoría y el
   checkbox de limpieza desaparecen; el formulario queda con el
   **mismo combobox `.ing-combo` de las recetas** (issue #240:
   input buscador + toggle + listbox, con `data-*` ocultos para el
   valor elegido) más los campos de **cantidad** (`#extra-cantidad`,
   `min="0"`) y **unidad** (`#extra-unidad`, normalizada con
   `normalizeUnit`). El combobox se reutiliza exportando de
   js/recipes.js `bindIngredienteCombo(combo, { emptyText })` y
   `renderIngredienteComboList(combo, emptyText)`, con un mensaje
   «sin coincidencias» propio para la compra que remite a la pestaña
   Ingredientes.
   - **Categoría y comestible derivados del catálogo**: el ítem toma
     `categoriaId` del ingrediente elegido y `comestible` se deduce
     como `categoriaId !== "hogar"` (la categoría «hogar» es la de los
     productos de limpieza; el catálogo no guarda el flag). El texto
     libre por sí solo **no** selecciona nada: `addExtraItem` exige
     que el valor oculto esté relleno y que el texto visible coincida
     con él (mismo patrón de validación que las recetas, issue #240),
     avisando de que se elija del desplegable.
   - El hint `.shopping-extra-form__hint` bajo el formulario explica
     al usuario que la categoría sale de la ficha del ingrediente y
     que si no está en el catálogo debe crearlo en la pestaña
     Ingredientes.
2. **Botón en la ficha del ingrediente** (js/recipes.js): la vista de
   detalle del modal (`ingredientDetailHtml`, ADR-089) gana el botón
   **«🛒 Añadir a la lista de la compra»** (`data-ing-shopping`, junto
   a Eliminar/Editar). Al pulsarlo se abre el mismo modal en modo
   **shopping** (`openIngredientModal(id, { shopping: true })`) con
   una vista nueva `ingredientShoppingHtml`: nombre del ingrediente en
   **solo lectura**, cantidad y unidad de medida, y botones
   Cancelar (vuelve al detalle) / Añadir a la lista. La ventana solo
   permite esos dos campos, como pide la issue.
   - **Dependencia inyectada sin import circular**: recipes.js no
     importa shopping-list.js (que a su vez importa recipes.js): el
     modal persiste el ítem vía una función registrada por
     `registerShoppingListAdder(fn)` (nuevo export de recipes.js), que
     shopping-list.js llama en `setupShoppingList` con el adder que
     persiste en `itemsExtra`. Si el adder no está registrado (caso
     defensivo), se muestra toast de error y no se rompe nada.
   - **Bloqueo de cierre involuntario**: como en el modo edición, el
     cierre por backdrop/Escape queda bloqueado mientras la ventana de
     cantidad/unidad está abierta (nuevo flag `ingredientShoppingMode`,
     reseteado en `closeIngredientModal`); la ✕ explícita y los botones
     sí cierran.
3. **Persistencia compartida**: el nuevo helper `persistExtraItem(item,
   { create })` en js/shopping-list.js centraliza la escritura de un
   ítem extra en **todas las semanas seleccionadas** (`selectedWeeks`)
   vía la cola de mutaciones (`enqueueMutation` + `updateMenuWeek`,
   patrón del issue #225). Lo usan tanto el formulario de ítem extra
   como el adder del modal del ingrediente. El adder **alinea la
   selección con la semana activa del menú** si el usuario aún no ha
   tocado los chips (`if (!userTouchedChips) syncSelectionWithMenu()`):
   así el ítem añadido desde la ficha aparece en la semana que verá al
   abrir la pestaña Compra.
4. **Temas y responsividad** (AGENTS.md §2 y §4): el combobox dentro
   del form extra toma los estilos de los inputs del form (píldora
   `--ink-raised`/`--paper`, foco teal) con overrides agrupados para
   la familia clara (`[data-theme="light"]/[data-theme="white"]`) y
   negro puro; el `.ing-combo` es `flex: 2 1 180px` en una fila con
   `flex-wrap: wrap` y `min-width: 0` (en ~360 px el buscador baja a
   su línea y cantidad + unidad caben en la segunda), y el desplegable
   `.ing-combo__list` (absolute, z-index 20) no se corta por overflow
   de ningún ancestro. Contrastes AA en los cuatro temas (hint con
   `--ink-soft`: 6.2:1 oscuro, 5.93:1 claro).
5. **Validación QA**: todos los criterios de aceptación cumplidos;
   hallazgo de severidad baja corregido en iteración (el mensaje de
   «sin coincidencias» del combobox de recetas quedaba vacío al reabrir
   por foco porque se pasaba `emptyText: null` a
   `renderIngredienteComboList`, cuyo default solo aplica con
   `undefined`: el parámetro de la opción pasa a `{ emptyText }`).
6. **Manual de usuario**: §8.4 (formulario de ítem extra con buscador,
   sin categoría ni limpieza — se toman de la ficha —, añadido a todas
   las semanas seleccionadas) y §8.5 (botón «Añadir a la lista de la
   compra» en la ficha del ingrediente, con ventana de solo cantidad y
   unidad).
7. **PWA**: bump `20260922 → 20260923` en js/config.js
   (`APP_VERSION`), index.html (`?v=`) y service-worker.js
   (`STATIC_ASSETS`).

## Consecuencias

- **Positivas**: el ítem extra sale siempre del catálogo, con
  categoría y comestible coherentes con la ficha (se acaba el nombre
  libre «lavavajillas» sin categoría); añadir un ingrediente a la
  compra desde su ficha es directo y solo pide lo que la issue quiere
  (cantidad y unidad); la escritura comparte una única vía
  (`persistExtraItem`) con la cola de mutaciones, sin dependencia
  circular entre módulos.
- **Neutras**: los ítems extra antiguos ya guardados (con `categoriaId`
  y `comestible` explícitos) se siguen leyendo y mostrando igual; el
  checkbox de limpieza y el select de categoría del form extra
  desaparecen de la UI (y del CSS: `.shopping-extra-form__check` y sus
  reglas se eliminan); el `min="0"` de la cantidad en el form extra
  sigue siendo decorativo (el form es un `<div>`, no un `<form>`; el
  modal shopping sí lo aplica porque usa un `<form>` real) — hallazgo
  preexistente, sin regresión.
- **Negativas**: ninguna conocida. Validado: sintaxis JS, criterios de
  aceptación 1-7 (el 8, este ADR, se documenta ahora), responsividad
  360 / 768 / 1280 px sin scroll horizontal, cuatro modos de tema con
  contraste AA y escaneo de seguridad sin hallazgos (todo dato de
  usuario pasa por `escapeHtml` en las interpolaciones nuevas, incluido
  el `emptyText`).

Related issue: #249
