# ADR-089: Ingredientes de receta elegidos del catálogo — combobox con buscador y alta desde el formulario (issue #240)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #240 pide que en la vista de **edición** de una receta los
ingredientes **no se puedan escribir libremente** ni se pueda elegir su
**categoría**:

1. Al añadir un ingrediente debe haber un **desplegable con buscador**
   para elegir entre los ingredientes de la lista (el catálogo de
   ingredientes, `users/{uid}/ingredients`).
2. Debe haber un **botón para crear uno nuevo**, que despliegue la
   misma ventana de creación de ingrediente que la pestaña
   Ingredientes.

Estado previo: cada fila de ingrediente del formulario
(`ingredienteRowHtml` en js/recipes.js) era un `input` de texto libre
con un `<datalist>` de autocompletado (el usuario podía escribir
cualquier cosa), más un `<select>` de categoría propio de la fila. El
catálogo se rellenaba solo al guardar (`syncIngredientsCatalog`,
upsert por nombre normalizado, issue #224). ADR-087/ADR-088
introdujeron el modo lectura de la ventana de receta, que no toca el
formulario de edición.

Nota del flujo (misma excepción que ADR-083, ADR-085, ADR-087 y
ADR-088): la base de trabajo es la rama `style/issue-236-ventana-recetas-lectura`;
la rama de trabajo se crea desde ahí y la PR va **también a
`content/issue-64-seccion-recetas`, no a `dev`**. El ADR se numera
**089**.

## Decisión

1. **Combobox con buscador sobre el catálogo**: cada fila de
   ingrediente del formulario pasa a un `.ing-combo`: un `input`
   (rol `combobox`) que al enfocar o escribir abre un desplegable
   `.ing-combo__list` (rol `listbox`) con las opciones del catálogo
   filtradas en vivo (coincidencia por nombre normalizado, sin
   tildes/minúsculas) y ordenadas alfabéticamente. Solo las **opciones
   del catálogo** asignan la selección: el texto libre que no
   corresponde a una opción no selecciona nada (la fila se ignora al
   guardar y se avisa con un toast listando los nombres descartados).
   El `<datalist id="recipe-ingredients-datalist">` de index.html se
   elimina (quedaba un autocompletado que permitía texto libre).
2. **La categoría ya no se edita en la receta**: el `<select
   .ing-categoria>` de la fila desaparece. La categoría se toma del
   catálogo al guardar (`ingredientCategoriaDe`: busca el ingrediente
   por nombre normalizado; si no está, p. ej. porque se eliminó del
   catálogo, conserva la categoría guardada en la receta). La ficha
   del catálogo (pestaña Ingredientes, ADR-085/#218) sigue siendo el
   único sitio donde se cambia.
3. **Botón «Nuevo ingrediente»**: en el fieldset Ingredientes, junto a
   «+ Ingrediente», un segundo botón que abre el modal de alta de
   ingrediente existente (`openIngredientModal(null)`, la misma ventana
   que «+ Nuevo ingrediente» de la pestaña Ingredientes). Al guardarse
   el alta, `onCreated({ nombre, categoriaId })` añade una fila a la
   receta con ese ingrediente ya elegido y enfoca la cantidad. El
   modal de ingrediente se superpone al de receta sin cambios de
   z-index (los dos comparten `z-index: 50` y el de ingrediente va
   después en el DOM); los traps de foco son independientes y el cierre
   devuelve el foco al botón.
4. **Selección y teclado**: click en opción o Enter seleccionan (Enter
   elige la opción activa o la primera); flechas ↑/↓ navegan con
   `.is-active`; Escape revierte al valor seleccionado; el desplegable
   cierra al salir del campo (blur con retardo de 120 ms para no
   adelantarse al click de una opción, cuyo `mousedown` con
   `preventDefault` mantiene el foco). El valor elegido se guarda en
   hidden `.ing-nombre-valor` / `.ing-categoria-valor`, que son los
   que lee `readRecipeFromForm` al guardar. Cada combo se enlaza al
   render del modal y al insertar cada fila nueva (`bindIngredienteCombo`),
   sin escuchas globales.
5. **Dato legado**: si la receta ya tenía un ingrediente que ya no
   está en el catálogo (se pudo eliminar de él sin tocar las recetas),
   la fila lo muestra y lo mantiene elegible en el desplegable para
   que el dato no se pierda al guardar.
6. **Responsividad** (AGENTS.md §2): la fila pasa de 5 columnas a 4
   (`1.4fr 0.7fr 0.9fr auto`: combo, cantidad, unidad, ✕); en móvil
   (≤ 560 px) el combo ocupa la fila entera (`grid-column: 1 / -1`)
   para que el desplegable tenga todo el ancho y las opciones
   (`overflow-wrap: break-word`, `max-height: 200px` con scroll)
   nunca desborden el viewport.
7. **Cuatro modos de tema** (AGENTS.md §4): el desplegable usa
   superficie `--paper`/`--ink` (fondo elevado sobre el `--paper-dim`
   del formulario) y en negro puro `--ink-raised`/`--paper` con borde
   `--paper-alpha-20` y hover `--paper-alpha-10` (selectores agrupados
   con una sola fuente de verdad); el hover/is-active general usa
   `--teal-alpha-18`, suficiente para los modos de la familia clara.
8. **Manual de usuario**: §8.1 describe los ingredientes como elección
   del catálogo con buscador, el botón «Nuevo ingrediente» (misma
   ventana que la pestaña Ingredientes) y que la categoría se gestiona
   desde el catálogo.
9. **PWA**: bump de versión `20260919 → 20260920` en `js/config.js`
   (`APP_VERSION`), `index.html` (`?v=` de estilos y `app.js`) y
   `service-worker.js` (`STATIC_ASSETS`).

## Consecuencias

- **Positivas**: el nombre de ingrediente siempre viene del catálogo
  (datos limpios y consistentes con la lista de la compra y las
  deduplicaciones por nombre normalizado); la categoría de la receta
  sigue al catálogo en tiempo real; crear un ingrediente sobre la
  marcha desde la receta es un flujo con la misma ventana ya conocida;
  el texto libre mal escrito no se guarda como ingrediente fantasma.
- **Neutras**: `syncIngredientsCatalog` al guardar queda como
  salvaguarda (con selección solo del catálogo ya no añade nada
  nuevo); el alta manual de ingrediente desde la pestaña
  Ingredientes es idéntico (el `onCreated` es opcional); bump PWA
  `20260919 → 20260920`.
- **Negativas**: ninguna conocida. Se prevé validar los criterios de
  aceptación (sin texto libre, desplegable con buscador, botón de
  creación con la ventana del catálogo, categoría no editable en la
  receta), responsividad en 360 / 768 / 1280 px sin scroll horizontal,
  los cuatro modos de tema con contraste AA y el escaneo de seguridad
  sin hallazgos (todo dato de usuario pasa por `escapeHtml`, incluidos
  los `data-nombre`/`data-categoria` de las opciones).

Related issue: #240
