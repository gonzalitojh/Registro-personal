# ADR-030: Modal de vista previa en los resultados de búsqueda — información completa de un ítem antes de añadirlo (issue #22)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #22 reporta que al buscar una nueva serie, película o libro para añadir (páginas `ocio/peliculas.html`, `ocio/series.html`, `ocio/libros.html`), los resultados de búsqueda (`.result-card` dentro de `.results-strip`) solo mostraban portada, título, año y botón "Añadir". El usuario no podía ver la sinopsis, la duración, el reparto, el rating de comunidad ni el tráiler de un resultado **antes** de añadirlo a su colección: la única vía era dar de alta el ítem y abrir su modal de detalle, con el coste de una alta no deseada si la información no convencía.

Los modales de detalle de la colección (`openMovieModal`/`openTvModal`/`openBookModal` en `js/ui.js`) ya tenían todos los helpers de render necesarios (`extraInfoHtml`, `communityRatingDisplay`, `trailerButtonHtml`, clases `modal-detail__*`), pero estaban acoplados al flujo de un ítem ya añadido: incluyen edición, progreso, logs y callbacks de persistencia que no aplican a un ítem no añadido. `js/search.js` ya conocía el estado de la colección (`existingIdsFor`) y las rutas de alta (`handleAdd`/`doAddBook`), incluida la ruta multi-portada de libros (`openBookConfirmModal`).

Related issue: #22 — https://github.com/gonzalitojh/Registro-personal/issues/22

## Decisión

Implementar un **modal de vista previa de solo lectura** que se abre al pulsar sobre una tarjeta de resultado (click o tecla Enter/Space) y muestra la información del ítem **como si ya estuviera en la colección**, con el botón "Añadir" delegando en el flujo de alta existente. La decisión se organiza en cuatro capas: tarjeta clicable accesible, modal reutilizando los helpers de render existentes, enriquecimiento asíncrono no bloqueante, y orquestación en `js/search.js` (el módulo de UI no habla con APIs).

### 1. Tarjeta de resultado clicable y accesible (`js/ui.js`, `renderSearchResults`)

`renderSearchResults` acepta un **6º parámetro opcional** `onPreview(item, added)`. Cuando está definido:

- Cada `.result-card` gana `role="button"`, `tabindex="0"` y un `aria-label` descriptivo (`"Ver información de <título>"`).
- El **click** sobre la tarjeta abre la preview, **respetando el botón Añadir habilitado**: si el evento viene de un `button` no deshabilitado, el botón gestiona su propio click y la tarjeta no reacciona; un botón deshabilitado ("Añadido") sí deja pasar el click a la tarjeta.
- Las teclas **Enter/Space** abren la preview solo cuando el foco no está sobre un botón (si el foco está en "Añadir", el botón gestiona su propia tecla).

### 2. `openSearchPreviewModal(item, { added, onAdd, onEnrich })` (`js/ui.js`)

Nueva función exportada que reutiliza los helpers de render existentes del modal de detalle:

- **Header** `modal-detail__header`: portada, título y línea de metadatos (año, y `autor · págs.` para libros).
- **Nota de ediciones** para libros agrupados con varias ediciones: `"N ediciones — al añadir podrás elegir portada"`.
- **`#preview-details`** con `extraInfoHtml(item)`: la sinopsis (u otros datos) que ya traiga el resultado de búsqueda se pinta **inmediatamente**.
- **Rating de comunidad + tráiler** (`communityRatingDisplay`/`trailerButtonHtml`) solo para películas y series; los libros no tienen esos bloques.
- **Footer** con botones "Cerrar" y "Añadir": este último se muestra deshabilitado con el texto "Ya añadido" cuando `added` es `true`, y delega en `onAdd` cuando está definido.
- Apertura con el **patrón estándar del proyecto**: `_previousActiveElement` + `trapFocus`.

### 3. Enriquecimiento asíncrono no bloqueante

Si se pasa `onEnrich`, el modal pinta primero los datos del resultado de búsqueda, muestra el hint `"Cargando detalles…"` y lanza el enriquecimiento en un `async` **sin bloquear el render ni el botón Añadir**:

- Al resolver, se hace `Object.assign(item, details)` y se re-renderiza **solo `#preview-details`** (nunca la estructura del modal).
- Los bloques de rating/tráiler se refrescan **solo si llegaron datos nuevos**: si el tráiler no existía en el render inicial (los resultados de búsqueda nunca traen `trailerUrl`), el botón se **inserta** antes de `.modal-actions`.
- El hint de carga se elimina siempre, tanto en éxito como en fallo (el `catch` no bloquea la vista previa).
- **Guardas de validez**: antes de tocar el DOM se comprueba `previewDetailsEl.isConnected` y que el modal no esté oculto (`modal.classList.contains("hidden")`), para no pisar un modal cerrado o **reemplazado** mientras tanto — p. ej. el flujo preview → añadir libro multi-portada, donde `openBookConfirmModal` re-renderiza `#modal-content` y registra su propio focus trap.

### 4. Orquestación en `js/search.js` (la UI no habla con APIs)

- **`handleAdd`/`doAddBook` ahora devuelven booleano de éxito**: `true` tras `addItem`, `false` en el `catch`; la ruta multi-portada devuelve `undefined` porque el flujo continúa en `openBookConfirmModal` (que se encarga de su propio cierre).
- **`enrichSearchItem(item)`** (privada): `movie` → `getMovieDetails`, `tv` → `getTvExtraDetails`, `book` de Open Library (externalId `/works/...`) sin `description` → `getOpenLibraryDescription`. **Nunca lanza**: devuelve `{}` ante cualquier fallo de red/API.
- **`openSearchPreviewFromResults(item, added, ctx)`** (privada): **recalcula `added`** con el estado actual del `ctx` (defensa frente a cambios entre el render y el click), mapeando el `type` singular al grupo plural `"movies"`/`"tv"`/`"books"` que usa `ctx`; para libros reutiliza `isBookAlreadyAdded` (cruce por título+autor). El `onAdd` llama a `handleAdd` y **cierra el modal si el alta fue exitosa** — `closeModal` es idempotente, por lo que la ruta multi-portada (que ya cerró dentro de `doAddBook`) no rompe nada.
- **Los 6 call sites de `renderSearchResults`** (3 en `refreshSearchAddButtons`, 3 en `setupSearch`) pasan el callback de preview.
- En `openBookConfirmModal` (`js/ui.js`) se añadió el **cleanup del focus trap previo** (`if (modal._focusTrapCleanup) modal._focusTrapCleanup()`), necesario en el flujo preview → añadir libro multi-portada para no dejar dos traps activos sobre el mismo modal.

### 5. CSS (`ocio/ocio.css`)

- `.result-card`: `cursor: pointer` (la tarjeta es clicable; inofensivo cuando el callback no está definido).
- `.result-card:hover`: `box-shadow: var(--shadow-pop)` — elevación que indica clicabilidad.
- `.result-card:focus-visible`: `outline: 2px solid var(--teal-reel)` — foco visible para navegación por teclado.

## Alternativas descartadas

- **Reutilizar los modales de detalle de la colección (`openMovieModal`/`openTvModal`/`openBookModal`) tal cual**: descartado — incluyen edición, progreso y logs que no aplican a un ítem no añadido, y requieren callbacks de persistencia que no existen para un ítem que aún no está en la colección; además su apertura asume datos ya enriquecidos.
- **Ficha embebida sin modal (expandir la tarjeta o un panel inline)**: descartado — rompe la consistencia con el patrón modal del proyecto (todos los detalles se muestran en `#item-modal`) y complica el focus management en `.results-strip`.
- **Sin enriquecimiento (solo los datos del resultado de búsqueda)**: descartado — TMDB ya tiene los detalles (sinopsis, reparto, duración, rating, tráiler) y el enriquecimiento es no bloqueante: el usuario ve los datos de búsqueda al instante y los ampliados cuando llegan, sin coste perceptible.

## Consecuencias

### Positivas
- **Información completa sin añadir**: el usuario decide con sinopsis, duración, rating de comunidad y tráiler antes del alta; se evitan altas no deseadas.
- **Sin duplicar lógica de alta**: el botón "Añadir" del modal delega en `handleAdd`/`doAddBook` existentes, incluida la ruta multi-portada de libros; `handleAdd` solo devolvía estado, ahora devuelve éxito, lo que no rompe a sus llamadores (que ignoraban el retorno).
- **Cero duplicación de render**: la preview reutiliza `extraInfoHtml`, `communityRatingDisplay`, `trailerButtonHtml` y las clases `modal-detail__*` del modal de detalle.
- **Accesible**: la tarjeta es un botón semántico (`role="button"` + `tabindex="0"` + `aria-label`), operable con Enter/Space, con `:focus-visible` visible y focus trap estándar en el modal.
- **Enriquecimiento robusto**: las guardas `isConnected` + modal no oculto evitan pisar un modal cerrado o reemplazado (flujo de libros multi-portada), y el hint de carga se limpia siempre.
- **Responsive**: el modal reutiliza la estructura `modal-detail__*` ya verificada en la revisión de responsividad; no introduce contenedores nuevos.

### Negativas
- **Una llamada extra a TMDB por cada preview abierta** de película o serie (y a Open Library para libros `/works/` sin sinopsis); se asume el coste porque el enriquecimiento no bloquea y solo ocurre bajo demanda del usuario.
- **El tráiler solo aparece tras el enriquecimiento**: el botón se inserta al resolver, no en el render inicial; si la API falla, el usuario no ve el tráiler en esa preview.
- **Los resultados de Google Books ya traen sinopsis**, con lo que los libros apenas requieren enriquecimiento (solo la fuente Open Library vía `getOpenLibraryDescription`); la nota de ediciones y el selector de portadas siguen delegados al flujo de alta.

### Neutras
- **`openSearchPreviewModal` y `openSearchPreviewFromResults` se exportan/usan como funciones nuevas**: no cambian la firma de `renderSearchResults` (el 6º parámetro es opcional y `undefined` para consumidores sin preview).
- **Sin cambios de contrato en `handleAdd`/`doAddBook`**: el retorno booleano es aditivo; los llamadores existentes ignoraban el valor de retorno.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | `renderSearchResults`: 6º parámetro `onPreview` (tarjeta con `role="button"`/`tabindex="0"`/`aria-label`, click respetando el botón Añadir habilitado, Enter/Space fuera de botones). Nueva `openSearchPreviewModal` (header, nota de ediciones, `#preview-details`, rating/tráiler para películas/series, footer Cerrar/Añadir con estado `added`, `_previousActiveElement` + `trapFocus`, enriquecimiento asíncrono con guardas `isConnected`/modal oculto y re-render parcial). `openBookConfirmModal`: cleanup del focus trap previo |
| `js/search.js` | `handleAdd`/`doAddBook` devuelven booleano de éxito. Nuevas `enrichSearchItem` (nunca lanza; movie/tv/book Open Library) y `openSearchPreviewFromResults` (recalcula `added` mapeando type → `movies`/`tv`/`books`; `onAdd` cierra el modal si el alta fue exitosa). Los 6 call sites de `renderSearchResults` pasan el callback de preview |
| `ocio/ocio.css` | `.result-card`: `cursor: pointer`; `.result-card:hover`: `box-shadow: var(--shadow-pop)`; `.result-card:focus-visible`: `outline: 2px solid var(--teal-reel)` |
| `docs/adr-030-search-preview.md` | **Nuevo**: este documento |

Related issue: #22 — https://github.com/gonzalitojh/Registro-personal/issues/22
