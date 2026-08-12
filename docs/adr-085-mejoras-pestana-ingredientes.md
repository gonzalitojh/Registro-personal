# ADR-085: Mejoras de la pestaña de Ingredientes — grafía original, supermercados, cantidad de paquete, iconos de categoría y ordenación fija A-Z (issue #224)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #224 pide cuatro mejoras en la pestaña **«Ingredientes»** de la
sección de Recetas (issue #64):

1. **Conservar la grafía original**: almacenar y mostrar los
   ingredientes tal y como se escribieron, respetando tildes y
   mayúsculas.
2. **Ficha ampliada**: al añadir o consultar un ingrediente, mostrar
   campos opcionales — **supermercados** donde se puede comprar (con
   etiquetas de color coherente con cada cadena: Lidl, Aldi, Mercadona,
   Día, Carrefour y El Corte Inglés) y **cantidad del paquete** (número
   + unidad: g, Kg, mL, L, unidades).
3. **Icono junto al título** de cada categoría del catálogo.
4. **Eliminar el selector de ordenación** de la barra de herramientas.

Estado previo (construido en ADR-080, issue #209, y ADR-082, issue
#218): la pestaña mostraba el catálogo como **tarjetas agrupadas por
categorías** con una **toolbar** de botón de alta manual, **filtro por
categorías** (multiselección, todas por defecto) y **select de
ordenación** (`#ingredient-sort`, 4 modos: Alfabético A-Z por defecto,
Z-A, Recientes añadidos y Más usadas). El **alta manual normalizaba el
nombre** antes de guardarlo (sin tildes, minúsculas, vía
`normalizeIngredientName`), por lo que la grafía escrita por el usuario
se perdía. El modal de detalle solo permitía editar la **categoría**
(con guardado inmediato); el de alta, nombre + categoría.

Nota del flujo: la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde ahí
y la PR va **también a esa rama, no a `dev`** — excepción puntual a la
regla de PRs contra `dev` de AGENTS.md §1, pedida explícitamente por el
usuario en la issue, igual que en ADR-083. Además, el ADR de esta issue
se numera **085** (no 084) porque la rama hermana
`style/issue-221-pestana-lista-compra` (sobre la misma base) ya ocupa el
número 084 con `docs/adr-084-lista-compra-estetica-ocio.md`.

Decisiones clave:

1. **Grafía original en el catálogo, deduplicación intacta**: el
   documento del ingrediente (colección `users/{uid}/ingredients`)
   guarda el **nombre tal cual se escribió** (con tildes y mayúsculas),
   tanto en el alta manual como en el auto-llenado desde recetas
   (`syncIngredientsCatalog` persiste `ing.nombre.trim()`). La
   **deduplicación** (alta manual y `syncIngredientsCatalog`) y la
   **agregación** (recetas que usan el ingrediente y lista de la
   compra) **siguen usando `normalizeIngredientName`** (slug: sin
   tildes, en minúsculas): el catálogo conserva la **primera grafía
   escrita** y los reintentos con otra grafía (otras mayúsculas, sin
   tildes) no duplican.
2. **Campos nuevos opcionales en el documento**: `supermercados`
   (`string[]` con los ids de la constante `SUPERMARKETS`: `lidl`,
   `aldi`, `mercadona`, `dia`, `carrefour`, `el_corte_ingles`),
   `paqueteCantidad` (`number|null`) y `paqueteUnidad` (`string`: `""`,
   `g`, `Kg`, `mL`, `L`, `unidades`). Son opcionales: los documentos
   antiguos sin ellos renderizan vacíos. En `db.js` se amplía
   `addIngredient` (campos persistidos solo si vienen definidos) y
   `updateIngredientCategory` se sustituye por `updateIngredient(uid,
   id, fields)` **genérico** (actualización parcial de `updateDoc` +
   `updatedAt`).
3. **UI del modal**: el bloque **«Supermercados»** son **chips de
   selección** (checkbox oculto + estado `is-checked` en el label,
   patrón `.recipe-form__chip`) y la **«Cantidad del paquete»** una fila
   con input `number` + select (`—`, g, Kg, mL, L, unidades), con los
   mismos ids en el alta y en el detalle. En el **detalle** el guardado
   es **inmediato** al cambiar (patrón del cambio de categoría), con
   validación (cantidad `>= 0`; vacío → `null`; inválidos revertidos);
   en el **alta** solo cambia la marca visual y todo se recoge en el
   submit.
4. **Colores de marca hardcodeados a propósito** (AGENTS.md §4.4): los
   chips marcados y las etiquetas usan el color corporativo de cada
   cadena, idéntico en los 4 modos de tema, con contraste AA verificado:
   Lidl `#0050AA` con texto blanco, Aldi `#002B5C` blanco, Mercadona
   `#FFCB05` (amarillo de marca) con texto negro, Día `#A50F26` (rojo
   de marca oscurecido por contraste AA) blanco, Carrefour `#004E9F`
   blanco y El Corte Inglés `#00543F` blanco. Solo los chips
   **desmarcados** usan variables de tema (y por eso necesitan override
   en negro puro).
5. **Iconos de categoría**: cada grupo del catálogo lleva un **icono
   emoji** (`aria-hidden`) junto al título: las **12 predefinidas** con
   icono propio en `INGREDIENT_CATEGORIES` (🍎🥩🐟🥛🌾🧂🌿🍿🧼☕❄️🗂️), las
   **personalizadas** con 🏷️ (`CUSTOM_CATEGORY_ICON`) y **«Sin
   categoría»** con 🧺 (`UNCATEGORIZED_ICON`). Se eligió emoji por el
   precedente en la app (el grupo «friends» de la búsqueda global
   conserva su 👤, issue #134) y por coste cero de assets.
6. **Eliminación del selector de ordenación**: se quitan
   `#ingredient-sort` (HTML), el estado `ingredientSort`, su listener y
   las ramas `za`/`recent`/`used` del comparador; el catálogo queda
   fijo en **orden alfabético A-Z** (`localeCompare` `es`) con
   tie-break determinista por `id`. Supersede parcialmente la
   decisión 7 de ADR-082.
7. **Accesibilidad y estilos**: foco de teclado visible en los chips
   vía `:focus-within` (outline `--teal-reel`, el mismo del catálogo),
   chips desmarcados con variables de tema + overrides agrupados de
   negro puro (`--ink-raised`) y fila cantidad+unidad con `flex-wrap`
   responsiva (envuelve en móvil ≤480px, AGENTS.md §2).

## Decisión

1. **HTML** (`index.html`): se **elimina** el label y el select
   `#ingredient-sort` de la toolbar (el comentario de la pestaña ya no
   menciona la ordenación). Nada más cambia en el marcado: los chips y
   la fila de cantidad los renderiza `js/recipes.js` dentro del modal,
   igual que el resto de campos.
2. **JS**:
   - `js/recipes-data.js`: `INGREDIENT_CATEGORIES` gana el campo `icon`
     (emoji por categoría); nuevas constantes `CUSTOM_CATEGORY_ICON`
     (`🏷️`), `UNCATEGORIZED_ICON` (`🧺`) y `SUPERMARKETS` (array de
     `{id, label}` de las 6 cadenas; los colores viven en el CSS, no
     aquí).
   - `js/recipes.js`: se elimina el estado `ingredientSort` (incluido
     su reset en `resetRecipesData`), el listener `change` de
     `#ingredient-sort` en `setupRecipes` y las ramas del comparador;
     `compareIngredients(a, b)` queda en A-Z con tie-break por `id` y
     `renderIngredientsCatalog` ya no calcula `getUsageIndex()` para el
     render (el índice solo sirve al modal «Usada en»). El render de
     grupos añade `<span class="ingredient-group__icon"
     aria-hidden="true">` con el icono correspondiente. El modal gana
     `supermarketChipsHtml(selected)` (labels `.supermarket-chip` con
     checkbox oculto y `data-supermercado`), `packageQtyRowHtml(ing)`
     (ids `ing-modal-paquete`/`ing-modal-unidad` compartidos) y la
     constante `PACKAGE_UNITS`. En el **alta manual** el nombre se
     guarda tal cual (`trim`, sin normalizar) y la deduplicación
     compara por `normalizeIngredientName` de ambos lados;
     `syncIngredientsCatalog` persiste `ing.nombre.trim()`.
     `bindIngredientModalHandlers` gestiona: cambio de categoría y
     supermercados (guardado inmediato en el detalle, array completo
     nuevo) y cantidad/unidad del paquete (en el detalle, con
     validación `>= 0`, vacío → `null` e inválidos revertidos; en el
     alta se recogen en el submit con la misma validación de número).
   - `js/db.js`: `addIngredient` ampliado con los tres campos opcionales
     (solo se persisten si vienen definidos) y nuevo
     `updateIngredient(uid, ingredientId, fields)` que hace
     `updateDoc` parcial + `updatedAt`, sustituyendo a
     `updateIngredientCategory` (eliminado; `js/app.js` re-exporta
     `updateIngredient` en el contexto).
3. **CSS** (`css/styles.css`): bloque nuevo
   `/* Supermercados y cantidad del paquete del ingrediente (issue
   #224) */` con `.ingredient-modal__chips`, `.supermarket-chip` (fondo
   `--paper-dim`, borde `--paper-line`, texto `--ink`; override
   agrupado `[data-theme="black"]` con `--ink-raised`/`--paper`/
   `--paper-alpha-20`), `.supermarket-chip:focus-within` (outline
   `--teal-reel`), las clases de marca
   `.supermarket-chip--{id}.is-checked` y `.supermarket-tag--{id}` con
   los hex corporativos hardcodeados y su comentario justificando el
   contraste AA, `.supermarket-tag` (etiqueta no interactiva, mismo
   aspecto que el chip marcado, preparada para vistas de solo lectura),
   la fila `.ingredient-modal__qty-row` (input flexible `min-width: 0`,
   select fijo, `flex-wrap` en ≤480px) y el icono
   `.ingredient-group__icon` con el título de grupo en flex (AGENTS.md
   §2: `min-width: 0`, `overflow-wrap: break-word`).
4. **Manual de usuario**: §8.5 actualizada — sin mención al
   «Ordenar»; grafía original («se guardan y muestran tal y como los
   escribes», sin duplicados si ya existe con otra grafía);
   supermercados y cantidad del paquete **al añadir** (opcionales) y
   **editables en el detalle** (el cambio se guarda en el momento,
   como la categoría).
5. **PWA**: bump de versión `20260913 → 20260914` en `js/config.js`
   (`APP_VERSION`), `index.html` (`?v=` de estilos y `app.js`) y
   `service-worker.js` (`STATIC_ASSETS`).

## Consecuencias

- **Positivas**: los ingredientes se ven **exactamente como los escribió
  el usuario** (tildes y mayúsculas respetadas en el catálogo, en el
  modal y en las recetas que los usan), sin perder la deduplicación por
  nombre normalizado (el catálogo conserva la primera grafía); la ficha
  del ingrediente gana datos útiles de compra (dónde se compra y cuánto
  trae el paquete) opcionales y editables al momento; los iconos hacen
  las categorías reconocibles de un vistazo; la toolbar queda más
  limpia y el A-Z fijo elimina un control redundante; `updateIngredient`
  genérico queda reutilizable para futuras ediciones parciales.
- **Neutras**: los supermercados y la cantidad de paquete son
  **informativos en la ficha del ingrediente**: la lista de la compra
  sigue agregando igual (nombre normalizado + unidad, como hasta
  ahora); los documentos antiguos sin los campos nuevos renderizan
  vacíos; los iconos emoji dependen de la fuente del dispositivo (son
  estándar Unicode y no requieren assets); bump PWA `20260913 →
  20260914` (invalida la caché anterior para propagar CSS/JS nuevos);
  el ADR se numera 085 porque el 084 ya lo ocupa la rama hermana de la
  lista de la compra.
- **Negativas**: la ordenación Z-A / Recientes / Más usadas
  **desaparece** de la UI (decisión deliberada de la issue #224, que
  supersede parcialmente la decisión 7 de ADR-082); ninguna otra
  conocida. QA validó los criterios de aceptación (grafía original en
  alta y catálogo, ficha ampliada, iconos, selector eliminado),
  responsividad en 360 / 768 / 1280 px sin scroll horizontal y los
  cuatro modos de tema sin puntos muertos ni contrastes insuficientes
  (las marcas superan AA, ≥7,7:1 en las cinco de texto blanco y 13,9:1
  el negro sobre el amarillo de Mercadona); el escaneo de seguridad no
  encontró hallazgos (todo dato de usuario pasa por `escapeHtml`).

Related issue: #224