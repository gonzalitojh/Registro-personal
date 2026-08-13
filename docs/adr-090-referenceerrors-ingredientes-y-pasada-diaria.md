# ADR-090: Fix de dos ReferenceErrors — modal de ingrediente roto y comprobación diaria abortada (issue #243)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #243 reporta dos errores de consola que rompen funciones
independientes de la web:

1. **`recipes.js:912 Uncaught ReferenceError: edit is not defined at
   openIngredientModal`** — al pulsar «Añadir ingrediente» (botón de la
   pestaña Ingredientes) o **cualquier ingrediente del catálogo**, el
   modal no se abre. Causa raíz: una **regresión de fusión**. El merge
   `e30f073` (rama de la issue #240, ADR-089) resolvió el conflicto de
   `openIngredientModal` quedándose con la firma de la issue #240
   (`{ onCreated = null }`) pero dejando en el cuerpo las referencias a
   la opción `edit` de la issue #232 (ADR-088): `ingredientEditMode =
   edit;` y el guard `if (!ingredient || edit)` seguían presentes sin
   que `edit` existiera en scope, y la rama condicional del render
   (`edit ? ingredientEditHtml(...) : ingredientDetailHtml(...)`) se
   perdió (quedaba siempre `ingredientDetailHtml`). La issue #232
   (ADR-088-ventana-ingrediente) había añadido el modo edición del
   modal; la issue #240 (ADR-089) añadió el `onCreated` del alta desde
   el formulario de receta. Ambas opciones conviven en la misma firma y
   el merge las rompió.

2. **`daily-check.js:440 ReferenceError: getItemsByGroup is not defined
   at checkForUpdates`** — la comprobación diaria fallaba entera: el
   error se lanzaba en el bloque de videojuegos y abortaba toda la
   pasada, incluido el estampado de `lastReleaseCheckAt` (la próxima
   pasada se reintentaba al día siguiente con el mismo fallo). Causa
   raíz: la issue #178 (lazy loading, ADR-069) sustituyó en
   `daily-check.js` el destructuring y las lecturas por
   `getItemsByGroup` por lecturas puntuales con `getItemsOnce` para
   movies/tv/books, pero el bloque de videojuegos (issue #175, aviso de
   lanzamiento, ADR-071) quedó llamando a `getItemsByGroup("games")`,
   helper que ya no existe en scope desde ese cambio.

Nota del flujo (misma excepción que ADR-083, ADR-085, ADR-087, ADR-088
y ADR-089): la base de trabajo es la rama `content/issue-64-seccion-recetas`;
la rama de trabajo (`wip/issue-243`) se crea desde ahí y la PR va
**también a esa rama, no a `dev`**. El ADR se numera **090** (el más
alto existente era el 089).

## Decisión

### 1. Modal de ingrediente: restaurar la opción `edit` (js/recipes.js)

- **Firma**: `openIngredientModal(id, { edit = false, onCreated = null } = {})`
  — `edit` se restaura con su valor por defecto `false`, junto a
  `onCreated` de la issue #240. Por defecto el detalle se abre en modo
  lectura (issue #232); con `edit: true` se abre directamente la vista
  de edición. La llamada `openIngredientModal(ingredient.id, { edit: true })`
  de la tarjeta del catálogo (fila «✏️ Editar» de la issue #232) vuelve
  a funcionar.
- **Render condicional**: `content.innerHTML = ingredient ? (edit ?
  ingredientEditHtml(ingredient) : ingredientDetailHtml(ingredient)) :
  ingredientNewHtml()` — la rama de edición perdida en el merge se
  restaura.
- **Guard de foco**: `if (!ingredient || edit)` vuelve a estar activo:
  en el alta manual y al entrar en edición el foco va directo al input
  `#ing-modal-nombre` en el segundo rAF (tras el de `trapFocus`, que
  enfoca la ✕).
- **Documentación del código**: el JSDoc de la función se actualiza
  para describir ambos parámetros y las issues #232/#240 que los
  introdujeron.

### 2. Comprobación diaria: videojuegos vía `getItemsOnce` (js/daily-check.js)

- Se añade `getItemsOnce(user.uid, "game")` al `Promise.all` de
  lecturas puntuales (que ya contenía movie/tv/book desde la issue
  #178), como cuarta entrada `allGames`.
- El bloque de aviso de lanzamiento (issue #175) pasa de
  `getItemsByGroup("games")` a `allGames.filter((g) => !g.manual)`,
  con el mismo filtro de juegos manuales y el mismo patrón fail-open
  (un error de escritura no aborta la pasada).
- Los videojuegos **no refrescan metadatos** en la pasada (IGDB no se
  consulta, misma restricción de rate limit del ADR-067/ADR-071): solo
  participan en el aviso de lanzamiento comparando `releaseDate` con la
  fecha actual. El comentario del código se corrige para reflejarlo
  (decía «los videojuegos no participan en la pasada diaria»).

## Consecuencias

- **Positivas**: los botones de la pestaña Ingredientes vuelven a
  funcionar («Añadir ingrediente» abre el alta vacía; pulsar un
  ingrediente abre su detalle en modo lectura y «✏️ Editar» abre la
  edición, comportamientos de la issue #232); el alta desde el
  formulario de receta (issue #240, `onCreated`) sigue intacta; la
  comprobación diaria completa su ejecución sin errores y vuelve a
  estampar `lastReleaseCheckAt`; los videojuegos siguen generando el
  aviso de lanzamiento (issue #175) sin consultar IGDB.
- **Neutras**: la pasada diaria ahora hace una lectura adicional de
  Firestore (`game`) que antes no hacía, en línea con el patrón de
  lecturas puntuales de la issue #178; sin bump PWA (el cambio de
  `daily-check.js` no altera assets precacheados de la UI).
- **Negativas**: ninguna conocida. QA validó los criterios de
  aceptación (sin ReferenceErrors en consola al pulsar «Añadir
  ingrediente» o cualquier ingrediente, modal en modo edición con datos
  existentes y vacío en creación, comprobación diaria completa sin
  errores) y el escaneo de seguridad terminó en PASS; `node --check`
  de `js/recipes.js` y `js/daily-check.js` OK.

## Referencias

- Issue #232 (ADR-088-ventana-ingrediente): modo edición del modal de
  ingrediente, origen de la opción `edit`.
- Issue #240 (ADR-089): `onCreated` del alta de ingrediente desde el
  formulario de receta, origen de la firma que sobrevivió al merge.
- Issue #178 (ADR-069): lazy loading por pestaña, origen de
  `getItemsOnce` en `daily-check.js`.
- Issue #175 (ADR-071): aviso de lanzamiento de videojuegos en la
  pasada diaria, bloque que quedó llamando a `getItemsByGroup`.

Related issue: #243 — https://github.com/gonzalitojh/Registro-personal/issues/243
