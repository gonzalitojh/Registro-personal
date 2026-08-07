# ADR-045: Unificación de buscadores — la barra superior busca en la colección y en el catálogo (issue #82)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

Hasta la issue #82 existían **dos flujos de búsqueda separados**:

1. **Buscador global de la cabecera** (ADR-013, issue #46): el dropdown
   `#global-search-results` anclado bajo `#global-search-input` buscaba
   **solo en la colección del usuario** — películas, series, libros (también
   por autor) y amigos, agrupados con iconos y con un **chip de estado** a
   la derecha de cada fila. El click en una fila abría la ficha del ítem
   (cerrando el dropdown).
2. **Buscadores «para añadir» dentro de cada pestaña** (`ocio/*.html`): un
   formulario `.search-slip` por grupo («Busca una serie…», «Busca una
   película…», «Busca un libro o autor…») que buscaba en el catálogo (TMDB /
   Google Books con respaldo de Open Library) y pintaba los resultados en
   una **tira horizontal** (`.results-strip` con `.result-card`), con
   toolbar de «Cargar más» / «Ocultar resultados» (`#btn-load-more-*`,
   `#btn-hide-results-*`), botones de alta manual (`#btn-manual-movie/tv/
   book`) y, en libros, la casilla **«Solo en español»** (`#books-spanish-
   only`, ADR-002). La vista previa de ADR-030 se abría desde estas tarjetas
   (`renderSearchResults` con callback `onPreview`).

Además, cada pestaña tenía su **buscador de colección** `.library-search`
(«Buscar en mi lista…»), que filtraba la biblioteca en memoria con un input
propio (`librarySearchText` en `js/app.js`).

La issue #82 pide **unificar todo en la barra superior**: al buscar deben
aparecer los resultados de la colección (comportamiento actual) y, encima
de estos, **botones de tipo** (Serie / Película / Libro) para buscar en el
catálogo; los resultados del catálogo se muestran **en lista dentro del
mismo dropdown** (no horizontal), con un botón **«Añadir»** a la derecha
(donde antes iba el chip de estado); pulsar sobre un resultado de catálogo
amplía su información (preview de ADR-030) **sin cerrar el dropdown**; la
fila **«Añadir manualmente»** se mueve al final de los resultados de
catálogo y **se eliminan** tanto la barra de búsqueda de la colección como
toda la UI de búsqueda para añadir. La issue pide además **estudiar cómo
distinguir** «buscar en la colección» de «buscar algo nuevo».

Related issue: #82 — https://github.com/gonzalitojh/Registro-personal/issues/82

## Decisión

Unificar las búsquedas en un **único punto de entrada**: la barra de la
cabecera. El dropdown `#global-search-results` integra los resultados de la
colección (comportamiento previo de ADR-013) y las secciones de catálogo
(TMDB / Google Books / Open Library) bajo los botones de tipo, con el alta
(`handleAdd`), la vista previa (ADR-030) y el alta manual (`handleManualAdd`)
de `js/search.js`. La orquestación de la UI sigue en `js/global-search.js`
(módulo existente, **sin módulo nuevo**); `js/search.js` pasa a ser
**stateless** (solo lógica pura y llamadas a API, sin tocar el DOM).

### 1. Distinción colección vs. catálogo: `kind` en `flatResults`

La clave de la unificación es que **una sola lista plana** (`flatResults`)
alimenta el dropdown, y cada entrada lleva un discriminador `kind`:

- `{ kind: "collection", type, item, group }` — ítem de la colección del
  usuario (o amigo). Click → abrir ficha (cierra el dropdown).
- `{ kind: "external", type, item, group }` — resultado del catálogo API.
  Click → preview (ADR-030) **sin cerrar el dropdown**.
- `{ kind: "manual", type, group, item: null }` — fila «Añadir
  manualmente». Click → `openManualAddModal` sin cerrar el dropdown.

Tanto las filas de colección como las de catálogo usan la **misma clase CSS
`.global-search__item`** (misma estructura: portada, título, metadatos); lo
único que cambia es el **elemento derecho**: el chip de estado
(`.global-search__item-status`, solo colección) frente al **botón
«Añadir»/«Añadido»** (`.global-search__item-add`, solo catálogo). La
navegación por teclado (flechas + Enter/Space, `data-global-idx`) y el
resaltado son comunes a los tres `kind`. Se elimina la UI de la tira
horizontal (`.result-card` / `renderSearchResults`) del flujo de alta.

### 2. `js/search.js` refactorizado a stateless (sin módulo nuevo)

`js/search.js` deja de tocar el DOM y de guardar estado de resultados
(desaparecen `searchState`, `lastMoviesResults`, etc.) y pasa a exportar
solo lógica pura:

- **`searchExternal(group, query, page = 1)`**: delega en `api-movies.js`
  (`searchMovies`/`searchTv`) o `api-books.js` (`searchBooks`). Para
  libros siempre llama con `spanishOnly = true` (punto 7). Devuelve
  `{ items, hasMore, source }`.
- **`handleAdd(item, btn, ctx)`** y **`handleManualAdd(type, data, ctx)`**:
  flujos de alta existentes (incluida la ruta multi-portada de libros vía
  `openBookConfirmModal`), sin cambios de comportamiento.
- **`openSearchPreviewFromResults(item, added, ctx)`**: preview de ADR-030;
  recalcula `added` con el estado actual del `ctx`.
- **`existingIdsFor(group, ctx)`**, **`existingBookKeys(ctx)`** e
  **`isBookAlreadyAdded(item, idsSet, keysSet)`**: detección de «ya
  añadido» por `externalId` y, en libros, por cruce título+autor.
- **`enrichSearchItem(item)`**: enriquecimiento no bloqueante de la preview
  (nunca lanza).

**Eliminados**: `setupSearch`, `clearAllSearches`, `refreshSearchAddButtons`,
`hideResults` y `toggleResultsToolbar` (y con ellos sus `addEventListener`
sobre `#form-search-*`, `#btn-load-more-*`, `#btn-hide-results-*`,
`.search-clear-btn`, `#btn-manual-*` y `#books-spanish-only`). La UI del
dropdown (colección + catálogo) vive en `js/global-search.js`.

### 3. Botones de tipo SIEMPRE visibles encima de los resultados

Los botones **«Serie» / «Película» / «Libro»** (`renderTypeButtons`,
`.global-search__type-buttons`) se renderizan **en todos los estados del
dropdown**: hint inicial (< 2 caracteres), resultados, estados de catálogo
y «sin resultados». Pulsar uno marca el grupo como activo
(`activeGroup` → `.is-active`) y lanza la búsqueda en el catálogo
(`runExternalSearch(group, query)`) con la query actual; con query corta
muestra el hint de mínimo 2 caracteres sin llamar a la API.

### 4. Secciones de catálogo en lista dentro del dropdown

**Selección única** (comentario del usuario en la issue #82, opción B): al
pulsar un botón de tipo se muestra **solo la sección «Catálogo · X» del
grupo activo** (`activeGroup`); los resultados del catálogo previamente
pulsado se **ocultan** inmediatamente. La colección del usuario (grupos
Películas/Series/Libros/Amigos) se renderiza siempre y nunca se ve
afectada por la selección de catálogo. El estado de cada grupo externo
(carga `inFlight`, error `externalError` o caché `externalCache`) se
**conserva en memoria** para poder volver al grupo anterior sin re-llamar
a la API, pero solo se renderiza el del grupo activo.

Cada sección tiene cuatro estados posibles — y en **todos** ellos la fila
**«¿No la encuentras? Añadir manualmente…»** al final (`manualRowHtml`;
en el estado «cargando» lo hace `externalSectionLoadingHtml`):

| Estado | Contenido |
|---|---|
| **Buscando** | «Buscando en el catálogo…» + fila manual |
| **Error** | «No se pudo buscar: \<mensaje\>» + fila manual |
| **Vacío** | «No hay resultados de serie/película/libro para "X".» + fila manual |
| **Resultados** | Hasta 5 filas con portada, título, año (y autor en libros) y botón **«Añadir»** a la derecha (`.global-search__item-add`, `btn--small`) + fila manual |

El botón «Añadir» usa `handleAdd(entry.item, btn, ctx)` con
`e.stopPropagation()` (no abre la preview); al añadir con éxito pasa a
`disabled` + «Añadido». El **click en la fila** (o Enter/Space) abre la
**vista previa** (`openSearchPreviewFromResults`, ADR-030) **sin cerrar el
dropdown**: el modal se superpone y, al cerrarlo, el usuario sigue en su
búsqueda.

### 5. Anti-race: `searchSeq` + caché por grupo + `inFlight`

Para que las respuestas de la API nunca pisen estado más reciente:

- **`searchSeq`**: contador monotónico que se incrementa en cada nueva
  búsqueda (`performSearch`), en cada `runExternalSearch` y en
  `closeGlobalSearch()`. Cada búsqueda captura su `seq`; al resolver, si
  `seq !== searchSeq` (o el dropdown ya no está abierto) la respuesta se
  **descarta silenciosamente**.
- **Caché por grupo** `externalCache[group] = { query, items, source }`:
  solo se guarda la búsqueda del grupo terminada con éxito para la query
  actual; `renderExternalSection` decide el estado comparando
  `cache.query === query`.
- **`inFlight[group]`** y **`externalError[group] = { query, message }`**:
  marcan búsquedas en curso y errores (el error solo se pinta si su `query`
  es la actual).
- **`closeGlobalSearch()` invalida todo**: incrementa `searchSeq` y limpia
  caché, `inFlight`, errores y `activeGroup`; el texto del input se
  conserva (patrón Gmail, ya documentado en ADR-013).

### 6. Sin paginación en el dropdown (solo primera página)

A diferencia del antiguo `.results-strip` (con «Cargar más» por grupo), el
dropdown **no pagina**: `runExternalSearch` llama siempre a
`searchExternal(group, query, 1)` y recorta a **5 resultados por grupo**
(`slice(0, 5)`). La colección mantiene su cap preexistente (5 por grupo de
ítems, 3 amigos). El dropdown es un panel de acción rápida: la preview
(ADR-030) y el alta manual cubren los casos de descubrimiento.

### 7. Libros siempre en español (casilla eliminada)

`searchExternal` para `books` llama a `apiSearchBooks(query, page, null,
true)` — `spanishOnly` siempre `true`. Se **elimina** la casilla
`#books-spanish-only` (ADR-002) y el `change` listener que relanzaba la
búsqueda; el comportamiento por defecto (descartar ediciones confirmadas en
otro idioma, conservar las sin dato de idioma) pasa a ser el único. La API
`searchBooks` conserva el parámetro por compatibilidad interna.

### 8. `refreshExternalResults(ctx)`: botones «Añadir»/«Añadido» al día

Nueva función exportada de `js/global-search.js`: **re-renderiza las
secciones externas desde la caché** con el estado actual de la colección.
`js/app.js` la llama tras **cada snapshot de Firestore**
(`subscribeToItems` de movie/tv/book, sustituyendo a las llamadas a
`refreshSearchAddButtons`): si el dropdown está abierto, los botones
«Añadir» pasan a «Añadido» (y viceversa) sin rehacer búsquedas ni perder
la posición del usuario.

### 9. UI eliminada (colección y «para añadir»)

- `ocio/*.html`: **eliminados** los formularios `.search-slip`
  (`#form-search-movies/tv/books`, `#search-*-input`, `.search-clear-btn`),
  las tiras `.results-strip` (`#search-*-results`), los toolbars
  (`#results-toolbar-*`, `#btn-load-more-*`, `#btn-hide-results-*`), los
  botones `#btn-manual-movie/tv/book`, la casilla `#books-spanish-only` y
  el buscador de colección `.library-search` («Buscar en mi lista…»).
- `js/app.js`: eliminados `librarySearchText` y los listeners de
  `.library-search-input`; eliminado `clearAllSearches()` al cambiar de
  sección.
- `js/ui.js`: eliminado `renderSearchResults` (y sus helpers de tarjeta
  `.result-card`); se conservan `openSearchPreviewModal`,
  `openBookConfirmModal` y `openManualAddModal` (la preview de ADR-030 y el
  alta manual se mantienen, ahora alimentados desde el dropdown).
- `ocio/ocio.css`: limpieza de los estilos de `.search-slip`,
  `.results-strip`, `.result-card*`, `.results-toolbar`, `.lang-filter-check`
  y `.library-search*` (que ADR-027/042/016/009 referenciaban).

### 10. Responsividad (AGENTS.md)

- **Botones de tipo con `flex-wrap`**: `.global-search__type-buttons`
  envuelve a una segunda línea si no caben (base y refuerzo en la media
  query ≤600 px), sin desbordar.
- **Dropdown fixed en móvil (≤600 px)**: `#global-search-results` pasa a
  `position: fixed; left/right: 1rem; top: 4.5rem` (patrón exacto del
  `.notif-dropdown` de ADR-027): el wrap de la barra es estrecho y el panel
  desbordaría; anclado al viewport nunca sale del ancho visible.
- **Títulos y metadatos en móvil**: `white-space: normal` con clamp a 2
  líneas (en desktop conservan nowrap + ellipsis + `title`); filas con
  `min-width: 0` y `overflow-wrap`, sin scroll horizontal a nivel de
  página en 360/768/1280 px.

### 11. Sin cambios de versionado PWA

No se modifica `APP_VERSION` (`js/config.js`), los `?v=` de `index.html` ni
`STATIC_ASSETS` del service worker: la versión `20260816` (introducida en la
issue #92) ya está activa en la rama de integración y cubre los cambios de
UI de esta issue al desplegarse junto con ellos.

## Alternativas descartadas

- **Mantener los buscadores «para añadir» en las pestañas y solo enlazarlos
  desde la barra superior**: descartado — la issue pide explícitamente
  eliminar la barra de búsqueda de la colección y la búsqueda para añadir;
  un único punto de búsqueda evita la duplicación de UI y de estado.
- **Módulo nuevo para la búsqueda de catálogo** (p. ej.
  `js/catalog-search.js`): descartado — `js/search.js` ya alojaba la lógica
  de búsqueda/alta; el refactor a stateless la conserva sin DOM, y
  `js/global-search.js` ya orquesta el dropdown (ADR-013). Cero módulos
  nuevos.
- **Filas de catálogo con clase CSS propia**
  (`.global-search__item--external` u otra): descartado — la misma clase
  `.global-search__item` con elemento derecho distinto (chip vs. botón
  Añadir) reutiliza layout, hover, foco y responsividad; el `kind` de
  `flatResults` ya diferencia el comportamiento.
- **Paginación en el dropdown** («Cargar más» por sección, como en el
  antiguo `.results-strip`): descartado — el dropdown es una paleta de
  acción rápida, no una página de búsqueda; el cap de 5 por grupo más la
  preview y el alta manual cubren el descubrimiento sin complejidad.
- **Cerrar el dropdown al abrir la preview** (patrón de la colección):
  descartado — interrumpiría el flujo «buscar → comparar → añadir»; la
  preview se superpone al dropdown y al cerrarla el usuario retoma su
  búsqueda exactamente donde estaba.
- **Mantener la casilla «Solo en español»**: descartado — la app es en
  español y la casilla estaba activada por defecto; eliminarla simplifica
  la UI de libros (ADR-002) sin perder capacidad de búsqueda.
- **Multi-selección de catálogos (opción A del comentario de la issue
  #82)**: mantener marcados varios botones de tipo a la vez y permitir
  desmarcarlos para ocultar sus resultados — descartado en favor de la
  **selección única** (opción B): el dropdown es un panel de acción rápida
  y acumular varias secciones «Catálogo · X» lo alargaba y confundía (el
  usuario reportó que al pulsar Películas tras Series se mantenían ambos
  resultados); con un único catálogo activo el panel se mantiene legible,
  y el estado de los demás grupos se conserva en caché para volver sin
  re-consultar la API.
- **Conservar la caché de catálogo al cerrar el dropdown** (reabrir y
  reutilizar): descartado — la caché se invalida en `closeGlobalSearch()`
  para que ninguna sección muestre resultados de otra sesión; el coste es
  una llamada a la API al volver a pulsar el botón de tipo.
- **Mantener el buscador `.library-search` de la colección**: descartado —
  la issue pide eliminarlo; la barra superior ya filtra la colección (y por
  autor en libros), así que era funcionalmente redundante.

## Consecuencias

### Positivas

- **Un solo punto de búsqueda**: buscar lo tuyo y añadir lo nuevo ocurre en
  el mismo panel, con el mismo patrón de lista, teclado y responsividad.
- **Menos UI que mantener**: desaparecen 3 `.search-slip`, 3
  `.results-strip`, 3 toolbars, 6 botones (`#btn-load-more-*`,
  `#btn-hide-results-*`), 3 `#btn-manual-*`, 3 `.library-search`, la casilla
  de idioma y `renderSearchResults` (~650 líneas netas menos en el diff
  global entre lo eliminado y lo añadido).
- **`search.js` stateless**: lógica pura y testeable, sin acoplamiento al
  DOM ni estado de resultados; las funciones de alta/preview (ADR-030) se
  reutilizan sin cambios de comportamiento.
- **Anti-race robusto**: `searchSeq` + caché por grupo + `inFlight`
  descartan respuestas obsoletas; `closeGlobalSearch()` invalida todo de
  una vez, sin estados colgantes.
- **Botones «Añadir»/«Añadido» siempre al día**: `refreshExternalResults`
  re-renderiza desde caché tras cada snapshot de Firestore, sin búsquedas
  nuevas ni pérdida de contexto.
- **Flujo de alta continuo**: la preview no cierra el dropdown; añadir,
  comparar y volver a buscar no requieren reabrir el panel.
- **Menos opciones en libros**: siempre en español, sin casilla que
  gestionar (ADR-002 queda reducido a su comportamiento por defecto).
- **Responsividad verificada** según AGENTS.md (360/768/1280 px sin scroll
  horizontal): `flex-wrap` en los botones de tipo, dropdown `fixed` en
  móvil, clamp a 2 líneas en títulos/meta móvil, `min-width: 0` en filas.

### Negativas / Riesgos

- **Sin paginación ni «Cargar más»**: de una búsqueda con muchos resultados
  solo se ven los 5 primeros por grupo en el dropdown; la preview y el alta
  manual mitigan, pero no hay forma de recorrer el resto desde el panel.
- **La caché externa se invalida al cerrar el dropdown**: reabrir y repetir
  la búsqueda del catálogo implica una nueva llamada a la API (coste de red
  y de cuota); aceptado a cambio de no mostrar resultados obsoletos.
- **Cambio de costumbre**: quien buscaba dentro de la pestaña («Buscar en
  mi lista…» o el buscador «para añadir») debe usar la barra superior; el
  manual de usuario se actualizó para reflejarlo (obligación de AGENTS.md).
- **El dropdown crece**: con colección + varias secciones de catálogo el
  panel puede superar la altura del viewport; `max-height: min(60vh,
  480px)` + `overflow-y: auto` (preexistente) lo mantienen scrollable sin
  desbordar.

### Neutras

- **ADR-013 parcialmente superado**: el buscador global que documentó
  (colección + amigos, chips de estado) se conserva tal cual como primera
  parte del dropdown; su ámbito se amplía con las secciones de catálogo.
- **ADR-030 vigente pero con nuevo anfitrión**: la vista previa se mantiene
  íntegra (modal, enriquecimiento, guardas `isConnected`), pero ahora se
  abre desde filas del dropdown en lugar de desde `.result-card`;
  `renderSearchResults` (con su 6º parámetro `onPreview`) se elimina al
  desaparecer la tira horizontal.
- **ADR-002 reducido**: la búsqueda de libros conserva Google Books con
  respaldo de Open Library y el agrupado de ediciones; la casilla «Solo en
  español» desaparece y su comportamiento activado pasa a ser el único.
- **ADR-042/027/016/009**: los selectores `.search-slip input` y
  `.library-search-input` que mencionan ya no existen; su regla de
  `font-size: 16px` global sigue aplicando a los inputs restantes.
- **PWA**: sin cambios en esta issue; el versionado `20260816` (issue #92)
  ya cubría los parciales y módulos tocados aquí.
- **`docs/manual-de-usuario.md` actualizado**: secciones 3, 4.2 (series),
  5.2 (películas), 6.2 (libros, siempre en español) y 7 (Cómo buscar:
  7.1 catálogo con botones de tipo, 7.2 tu registro, 7.3 añadir manualmente)
  y TOC, reflejando el flujo unificado.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/search.js` | **Refactor a stateless**: eliminados `setupSearch`, `clearAllSearches`, `refreshSearchAddButtons`, `hideResults`, `toggleResultsToolbar` y el estado de resultados; exporta `searchExternal(group, query, page=1)` (delega en api-movies/api-books; libros siempre `spanishOnly=true`), `existingIdsFor`, `existingBookKeys`, `isBookAlreadyAdded`, `handleAdd`, `handleManualAdd`, `openSearchPreviewFromResults`, `enrichSearchItem` (estos últimos sin cambios de comportamiento) |
| `js/global-search.js` | **Dropdown unificado (issue #82)**: `flatResults` con `kind` `"collection"`/`"external"`/`"manual"`; botones de tipo SIEMPRE visibles (`renderTypeButtons`, `activeGroup`); **selección única**: solo la sección «Catálogo · X» del grupo activo (al pulsar otro tipo se ocultan los anteriores; caché conservada para volver sin re-llamar); secciones en lista con botón Añadir/Añadido y fila manual al final (también en buscando/error/vacío: `manualRowHtml`, `externalSectionLoadingHtml`); click en fila external → preview sin cerrar el dropdown; anti-race `searchSeq` + caché por grupo `{ query, items, source }` + `inFlight` + `externalError`; `closeGlobalSearch()` invalida todo; sin paginación (página 1, cap 5); nueva `refreshExternalResults(ctx)` exportada; botón Añadir con `stopPropagation` y refresh a «Añadido» tras éxito |
| `js/app.js` | Importa `refreshExternalResults` (sustituye a `refreshSearchAddButtons`); la llama tras cada snapshot de `subscribeToItems` (movie/tv/book); eliminados `librarySearchText` y los listeners de `.library-search-input`; eliminado `clearAllSearches()` |
| `js/ui.js` | Eliminado `renderSearchResults` (y el render de `.result-card` de la tira horizontal); se conservan `openSearchPreviewModal`, `openBookConfirmModal` y `openManualAddModal` |
| `ocio/series.html`, `ocio/peliculas.html`, `ocio/libros.html` | Eliminados `.search-slip` (`#form-search-*`, `#search-*-input`, `.search-clear-btn`), `.results-strip` (`#search-*-results`), `.results-toolbar` (`#btn-load-more-*`, `#btn-hide-results-*`), `#btn-manual-movie/tv/book`, `#books-spanish-only` y `.library-search` («Buscar en mi lista…») |
| `css/styles.css` | `.global-search__type-buttons`/`__type-btn`/`.is-active` (flex-wrap), `.global-search__group-title`, `.global-search__status`, `.global-search__item-add` (btn Añadir), `.global-search__manual-add`, `.global-search__item-status` (chip, compartido con la colección); `@media (max-width: 600px)`: refuerzo de flex-wrap y títulos/meta con clamp a 2 líneas (el dropdown ya era `position: fixed` en móvil) |
| `ocio/ocio.css` | Limpieza de estilos de `.search-slip`, `.results-strip`, `.result-card*`, `.results-toolbar`, `.lang-filter-check`, `.library-search*` |
| `js/config.js` | `APP_VERSION` de `20260815` a **`20260816`** |
| `service-worker.js` | `STATIC_ASSETS` con `?v=20260816` (styles, ocio.css, app.js y `ocio/*.html`); invalida las cachés de `20260815` y anteriores |
| `docs/manual-de-usuario.md` | Secciones 3, 4.2, 5.2, 6.2 y 7 (7.1 catálogo con botones de tipo y fila manual; 7.2 tu registro; 7.3 añadir manualmente) y TOC actualizados al flujo unificado: libros siempre en español, sin «Buscar en mi lista…» ni buscadores dentro de las pestañas |
| `docs/adr-045-unificacion-buscadores.md` | **Nuevo**: este documento |

Related issue: #82 — https://github.com/gonzalitojh/Registro-personal/issues/82
