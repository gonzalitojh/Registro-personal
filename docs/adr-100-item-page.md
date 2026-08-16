# ADR-100: Página nueva de detalle para películas y series (issue #285)

## Estado

Aceptado

## Fecha

2026-08-16

## Contexto

La issue #285 pedía que, al pulsar una **película o serie** — tanto en la
colección de Ocio como en la barra de búsqueda global — la app abriera una
**PÁGINA NUEVA** con URL propia (`#/ocio/series/<externalId>` o
`#/ocio/peliculas/<externalId>`) en lugar del modal clásico
(`#item-modal`). La ficha de películas y series es la única que vive en
Ocio con URL navegable `/ocio/series|peliculas`; **libros y videojuegos
conservan el modal** (la issue solo cubre series y películas).

La cabecera global superior se respeta (se mantienen la búsqueda y la
campana), pero el botón ☰ de hamburguesa — y el ⚙ de ajustes — se
sustituyen por un botón **atrás** que vuelve a la pantalla previa. El swap
se hace por CSS con una clase de `body` (`is-item-page`): así sobrevive a
los re-renders de la barra lateral (sidebar.js, issue #97) sin coordinar
estado en JS.

El router de hash (ADR-051) ya existía, por lo que la página nueva se
integra como una sección de ruta más (`section: "item"`) con `#/` +
historial del navegador nativo (atrás/adelante y swipe atrás funcionan
sobre la página).

Contexto de ramificación: la decisión se implementa en la rama
`feat/issue-285-pagina-detalle` y se documenta a posteriori, como los ADR
recientes (ADR-093 … ADR-099).

Related issue: #285 — https://github.com/gonzalitojh/Registro-personal/issues/285

## Decisión

Al pulsar una película o serie (colección de Ocio o barra de búsqueda
global) la app **navega** a la página de detalle
`#/ocio/series/<externalId>` o `#/ocio/peliculas/<externalId>` en lugar de
abrir el modal. La página renderiza, según el caso:

- **ítem ya en el registro** → la ficha completa en página (misma ficha
  del modal clásico, en modo target);
- **ítem del catálogo / URL directa compartida** → vista previa con los
  detalles de TMDB y botón «Añadir» (al añadir, pasa a la ficha completa);
- **sin sesión / error / ítem manual borrado** → mensaje informativo con
  botón Volver.

La cabecera superior se mantiene, con el botón atrás en lugar del ☰/⚙. La
ficha se cierra con el botón ←, la tecla **Esc** o el botón atrás del
navegador. Libros y videojuegos siguen abriendo su modal clásico, sin
cambios.

## Detalles técnicos

### 1. Rutas de ítem en `js/router.js`

- Nuevo mapa `ITEM_KEY_TO_KIND = { series: "tv", peliculas: "movie" }`:
  relaciona el token de URL público (castellano, consistente con las
  claves de Ocio) con el tipo interno de ítem. Libros y videojuegos no
  tienen entrada: no tienen ruta de ítem.
- Nueva `ITEM_ID_RE = /^[A-Za-z0-9._-]{1,64}$/`: admite los externalId de
  TMDB (numéricos) y los sintéticos de alta manual (`"manual-…"`), el
  mismo alfabeto que los uid de Firebase.
- `parseHash` admite 3 segmentos (`#/ocio/<clave>/<id>`): valida la clave
  contra `ITEM_KEY_TO_KIND`, decodifica el id con `decodeURIComponent`
  dentro de `try/catch` y lo valida contra `ITEM_ID_RE`. Id o clave
  inválidos → saneado a la pestaña Ocio por defecto (URL canónica, misma
  política de saneo que el resto de rutas).
- `canonicalHashFor`, caso item → nuevo `itemHashFor(kind, externalId)`
  (un kind desconocido cae a `peliculas`), y `navigate` acepta el objeto
  `{ section: "item", kind, externalId }` normalizado a hash canónico.

### 2. Marcado en `index.html`

- Nuevo botón `#btn-item-back` (clase `icon-btn`, oculto por defecto,
  `aria-label="Volver a la pantalla anterior"`, flecha ‹) en la cabecera
  global, junto al ☰.
- Nueva vista hermana de primer nivel `#item-view` (role `main`) con
  `#item-view-content`, **fuera de `#app`**, en el mismo nivel que
  `profile-view`: la página de ítem no comparte superficie con las
  secciones de Ocio/Recetas/Gimnasio.

### 3. CSS en `css/styles.css`

- `.item-view`: `max-width: 720px` centrado, `min-height: 100vh`,
  padding superior `calc(var(--header-h) + 1.25rem)` (hueco para la
  cabecera fija, que SÍ se muestra a diferencia del perfil) e inferior
  `calc(env(safe-area-inset-bottom, 0px) + 3.5rem)`; familia oscura por
  defecto (`--ink`/`--paper`).
- Overrides `[data-theme="light"] .item-view, [data-theme="white"]
  .item-view` → `background: var(--paper-dim); color: var(--ink)`
  (patrón del perfil).
- `.item-view__card`: misma superficie que `.modal__card` (`--paper`/
  `--ink`, `--radius`, `--shadow-pop`, padding cómodo,
  `overflow-wrap: anywhere`). La ficha reutiliza las clases de detalle
  del modal de ocio/ocio.css (`.modal-detail__*`, `.field-group`,
  `.rec-card`…, sin anidar bajo `.modal__card`), por lo
  que no hay duplicación de estilos.
- `.item-view__card` se añade al **selector agrupado de negro puro**
  (`[data-theme="black"] … { background: var(--ink-raised); color:
  var(--paper); border: 1px solid var(--paper-alpha-20); }`), donde la
  sombra no separa sobre fondo negro (patrón ADR-066).
- `.item-preview__hint` (aviso «Este título aún no está en tu registro»):
  llamada **invertida** (`background: var(--ink); color: var(--paper)`,
  borde `--paper-alpha-20`) en **una sola regla** sin overrides: al
  intercambiarse `--ink`/`--paper` por familia de tema, cumple contraste
  AA en los cuatro modos.
- Swap de cabecera, **regla única de verdad** vía clase de body:
  `body.is-item-page #btn-sidebar-toggle` y
  `body.is-item-page #btn-header-settings` → `display: none`;
  `body.is-item-page #btn-item-back` → `display: inline-flex`. Los
  re-renders de la barra lateral no pueden romperlo.
- `.item-view .back-to-top { display: none }`: el botón flotante «Volver
  arriba» (issue #137) no aplica en la página de ítem.

### 4. Modos de render en `js/ui.js` (modales)

`openMovieModal` y `openTvModal` aceptan un 6º/7º parámetro de opciones
`{ target = null }`:

- Con `target` (contenedor `#item-view-content` o la tarjeta) la ficha se
  renderiza en el contenedor dado **sin abrir el modal ni su focus trap**;
  se enfoca el título (`.modal-detail__title`, `tabindex="-1"`,
  `focus({ preventScroll: true })`), patrón de foco de las rutas de Ocio.
- El `rerender` interno **propaga el target**: los re-renders (marcar
  visto, cambiar estado, editar…) repintan en la página, no en el modal.
- Sin `target` el comportamiento clásico queda intacto (modal + foco
  atrapado sobre `#modal-content`).

### 5. Handlers en `js/modal-handlers.js`

- `openMovieItem` / `openTvItem(item, ctx, isRerender = false, target =
  null)` ahora se exportan; `reopen` propaga `target` y evita re-pedir
  detalles de API en los re-renders (`isRerender`).
- `confirmDelete(item, kind, ctx, onDone)`: en modo página, tras borrar
  (con deshacer) se vuelve a la pantalla previa; en el modal clásico,
  igual que siempre.
- `saveMeta(item, kind, ctx, onDone)`: en modo página re-renderiza la
  ficha en la página; en el modal clásico cierra la ventana.
- `editHandlerFor(item, kind, reopen, ctx, target)`: el modal de edición
  se usa **igual en ambos modos** (es un form con foco atrapado), pero en
  modo página se cierra `#item-modal` al guardar o cancelar — el
  re-render va en la página; en el clásico el re-render ocurre dentro del
  modal.
- Nuevo hook `setItemPageBackHandler(fn)` (inyectado desde item-page.js)
  para el «volver» de `confirmDelete`: evita una **dependencia circular**
  (item-page.js importa `openMovieItem`/`openTvItem` desde aquí).
- `openItem` queda **intacto**: libros y videojuegos siguen abriendo su
  modal (`openBookItem`/`openGameItem`).

### 6. Nuevo módulo `js/item-page.js`

- `setupItemPage(ctx, { ensureGroup })` devuelve la API
  `{ openPage, closePage, notifyGroupChanged, isActive }`.
- `openPage(kind, externalId, optimisticItem)`:
  - token de ruta `{ kind, externalId }` (anti-race: `isCurrent(token)`
    tras cada `await`, patrón del dropdown de búsqueda global);
  - limpia modales/drawer residuales, muestra `#item-view`, añade
    `body.is-item-page` y hace `scrollTo(0, 0)`;
  - **sin sesión** (recarga directa de una URL compartida) → mensaje
    «Inicia sesión para ver la ficha…»; al entrar, app.js re-aplica la
    ruta con `router.applyRoute()`;
  - `ensureGroup(group)` **suscribe el grupo del ítem si no está activo**
    (lazy loading, issue #178) para que los snapshots refresquen la
    página y el alta desde preview funcione;
  - `resolve()`: ítem en colección (`getGroupItemsResolved`) → ficha
    (`openMovieItem`/`openTvItem` con target); id `"manual-…"` no
    encontrado → mensaje «Este ítem ya no está en tu registro» (borrado
    desde otro dispositivo); resto → vista previa.
- Vista previa: pintado inmediato con el resultado de búsqueda (si hay,
    con aviso de carga) y enriquecimiento desde TMDB vía
    `buildPreviewItem` (`getMovieDetails`/`getTvExtraDetails` +
    `getTvSeasonsMeta`); botón **«Añadir»** → `handleAdd` (issue #22) →
    `refreshAfterAdd` lee con `getItemsOnce` (lectura directa: el
    snapshot del grupo puede no haber llegado aún) y pasa a la ficha
    completa. Si la API no devuelve datos → mensaje de error con botón
    Volver.
- `goBack()`: `history.back()` con **fallback por timeout (350 ms)** a
  `navigate(normalizeTabKey("ocio", getLastOcioKey()))` (última pestaña
  visible de Ocio, issue #97) para el caso de acceso directo por URL sin
  historial interno.
- **Escape = volver** en fase de captura, con guardas: si hay un modal
  abierto, el drawer lateral, el dropdown de búsqueda/notificaciones/
  perfil o el foco está en la cabecera (el usuario escribe en la
  búsqueda), no navega.
- `notifyGroupChanged(group, items)`: solo re-renderiza en **cambios
  estructurales** (preview → ficha tras alta; ficha → mensaje/preview si
  el ítem se borró desde otro dispositivo). Los cambios de datos del ítem
  visible NO re-renderizan: interrumpirían al usuario (p. ej. mientras
  escribe una nota).

### 7. Integración en `js/app.js`

- `onRoute`, caso `section === "item"`: oculta `profile-view`,
  `recipes-view`, `gym-view` y `#app`, y llama
  `itemApi?.openPage(route.kind, route.externalId)`.
- `itemApi?.closePage()` en el resto de secciones **y en logout**.
- `setActiveSection(null)` para item: la página de detalle no tiene
  entrada propia en la barra lateral.
- `routerApi` a nivel de módulo: `renderLibraryFor` lo usa para navegar
  (el router se crea dentro de `init()`).
- `renderLibraryFor`, `onOpen`: tv/movie → `routerApi.navigate({ section:
  "item", … })`; books/games → `openItem` (modal).
- `subscribeGroup`, `onChange` → `itemApi?.notifyGroupChanged(groupKey,
  items)`.
- Login: si `getCurrentSection() === "item"` → `router.applyRoute()`
  (retoma las recargas de URL compartida sin sesión).
- `itemApi = setupItemPage(ctx, { ensureGroup: ensureGroupSubscribed })`
  al final del arranque; `onRoute` lo usa con optional chaining.

### 8. Búsqueda global en `js/global-search.js`

`navigateTo`: tv/movie → `closeGlobalSearch()` y `navigate({ section:
"item", kind, externalId })`; books/games conservan el modal con su delay
de 150 ms (el cierre del dropdown no debe interferir con el foco).

### 9. `js/api-movies.js` — título aditivo

`getMovieDetails` y `getTvExtraDetails` devuelven ahora también `title`
(`data.title` / `data.name` en TMDB). Es **aditivo**: lo consume la
vista previa de página directa (`buildPreviewItem`) y el resto de
llamadores lo ignoran (política truthy-only del ADR-021).

### 10. Bump de versión de la PWA a `20261001`

Versión `20260929` → `20261001` (vía `scripts/bump-version.sh`) en
`index.html` y `service-worker.js`, más `./js/item-page.js` añadido a
`STATIC_ASSETS` (patrón ADR-099/ADR-007). El service worker es
cache-first: sin el bump, la app seguiría sirviendo el JS viejo en caché.

## Alternativas descartadas

- **Mantener el modal clásico para todo**: descartado — la issue pide
  explícitamente página nueva para películas y series (libros y
  videojuegos sí lo conservan, como pidió la issue).
- **Modal con URL hash (deep-link al modal abierto)**: descartado — se
  necesitaría un modal «pagificado» con estado extra (historial,
  focus, scroll); una página real de primer nivel reutiliza el router de
  hash existente y da historial nativo (atrás/adelante, swipe).
- **Swap ☰/⚙ → ← por JS en cada render**: descartado — frágil ante los
  re-renders de la barra lateral; la clase `body.is-item-page` es la
  única fuente de verdad, sin estado que coordinar.
- **Reusar el modal con re-render dentro de la página (copiar ficha al
  modal abierto)**: descartado — el `rerender` del modal repinta dentro
  de `#modal-content`; el modo target propaga el contenedor y evita tocar
  el flujo clásico.

## Consecuencias

### Para el usuario

- Las **fichas de películas y series ya no usan el modal**: al pulsar un
  título se navega a una página nueva (URL propia compartible
  `#/ocio/series|peliculas/<id>`), con la cabecera superior intacta
  (búsqueda y campana siguen funcionando) y un botón **←** en lugar del
  ☰ para volver a la lista.
- La ficha también se cierra con la tecla **Esc** o el botón atrás del
  navegador; **atrás/adelante del navegador y el swipe atrás funcionan
  sobre la página** (el historial es nativo).
- **Recarga directa de una URL compartida pide iniciar sesión**: la
  página muestra el estado de espera y, al entrar, retoma la ficha o la
  vista previa (los enlaces compartidos funcionan).
- Desde la búsqueda global: un resultado de película/serie que ya está
  en el registro abre su ficha en página nueva; uno del catálogo (TMDB,
  aún no añadido) abre la vista previa en la misma página con el botón
  «Añadir» igual que siempre; libros y videojuegos siguen abriendo su
  ventana.
- Las tarjetas de **recomendaciones y de sagas dentro de una ficha
  siguen abriendo su ventana clásica** (no cambian).
- **Libros y videojuegos no cambian nada**: siguen abriendo su modal.

### Para el mantenimiento

- **`body.is-item-page` es la única fuente de verdad del swap** de
  cabecera: sobrevive a los re-renders de la barra lateral sin
  coordinación en JS.
- La próxima versión de assets **debe seguir el patrón de bump `?v=…`**
  (y, si hay módulos nuevos, añadirlos a `STATIC_ASSETS` del service
  worker): sin el bump, la app sirve el JS/CSS viejo en caché.
- El patrón `target` en `openXModal`/`openXItem` es **reutilizable** para
  futuros modos de presentación de la ficha; el hook
  `setItemPageBackHandler` mantiene los módulos sin dependencias
  circulares.

### Negativas / Riesgos

- **Dos modos de presentación de la misma ficha** (modal clásico y
  página): más superficie de regresión visual. Mitigado reutilizando las
  mismas clases de detalle de `ocio/ocio.css` y las mismas variables de
  tema, con verificación en los cuatro modos (regla 4 de AGENTS.md).
- La página de ítem **no tiene entrada en la barra lateral**
  (`setActiveSection(null)`): la navegación de salida depende del botón
  ←, Esc o el historial del navegador.
- Los mensajes de estado de la página (sin sesión, error) dependen de la
  red y del estado de autenticación: los handles anti-race (`isCurrent`)
  evitan pintados obsoletos tras navegar rápido.
- **Ninguna otra conocida.**

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/router.js` | **Modificado**: rutas de ítem — `ITEM_KEY_TO_KIND` (series→tv, peliculas→movie), `ITEM_ID_RE` (`^[A-Za-z0-9._-]{1,64}$`, admite ids `manual-…`), `parseHash` con 3 segmentos (`decodeURIComponent` validado + `try/catch`, saneo a la pestaña Ocio por defecto), `itemHashFor`/`canonicalHashFor` caso item, `navigate` con `{ section: "item", kind, externalId }` |
| `index.html` | **Modificado**: botón `#btn-item-back` (oculto) en la cabecera; `#item-view`/`#item-view-content` (vista hermana de primer nivel de `profile-view`, fuera de `#app`); bump `?v=20260929` → `?v=20261001` |
| `css/styles.css` | **Modificado**: `.item-view` (max-width 720px, padding `calc(var(--header-h) + 1.25rem)…`), `.item-view__card` (misma superficie que `.modal__card`; reutiliza las clases de detalle del modal de ocio/ocio.css sin anidar), overrides `[data-theme="light"]/[data-theme="white"] .item-view` (`--paper-dim`/`--ink`, patrón del perfil), `.item-view__card` en el selector agrupado de negro puro (`--ink-raised` + borde), `.item-preview__hint` invertido (`background: var(--ink); color: var(--paper)`, contraste AA en los 4 temas), swap `body.is-item-page` (oculta `#btn-sidebar-toggle` y `#btn-header-settings`, muestra `#btn-item-back`), `.item-view .back-to-top { display: none }` |
| `js/ui.js` | **Modificado**: `openMovieModal`/`openTvModal(…, { target })` — con target renderizan la ficha en el contenedor dado sin abrir modal ni focus trap, enfocan el título (`tabindex="-1"`) y propagan el target en los re-renders |
| `js/modal-handlers.js` | **Modificado**: `openMovieItem`/`openTvItem(item, ctx, isRerender, target)` exportados; `confirmDelete`/`saveMeta` con `onDone` (modo página: volver al eliminar / re-render al guardar); `editHandlerFor` target-aware (cierra `#item-modal` al guardar/cancelar en modo página); hook `setItemPageBackHandler(fn)` (evita dependencia circular); `openItem` intacto (books/games → modal) |
| `js/api-movies.js` | **Modificado**: `getMovieDetails`/`getTvExtraDetails` devuelven `title` aditivo (lo consume la preview de página directa; el resto de llamadores lo ignoran) |
| `js/item-page.js` | **Nuevo**: módulo de la página de detalle — `setupItemPage(ctx, { ensureGroup })` → API `{ openPage, closePage, notifyGroupChanged, isActive }`; estados mensaje/ficha/preview; preview vía `buildPreviewItem` + botón Añadir (`handleAdd` → `refreshAfterAdd` con `getItemsOnce`); anti-race con token por ruta (`isCurrent` tras cada await); `goBack()` con fallback timeout a `navigate(normalizeTabKey("ocio", getLastOcioKey()))`; Escape en fase de captura con guardas; `notifyGroupChanged` solo en cambios estructurales |
| `js/app.js` | **Modificado**: onRoute caso `section === "item"` (oculta `#app`/perfil/recetas/gym y llama `itemApi?.openPage(route.kind, route.externalId)`); `itemApi?.closePage()` en el resto de secciones y en logout; `setActiveSection(null)` para item; `routerApi` a nivel de módulo; `renderLibraryFor` onOpen → tv/movie navega (books/games → `openItem`); `subscribeGroup` onChange → `notifyGroupChanged`; login con ruta item → `router.applyRoute()`; `ensureGroupSubscribed` pasado a `setupItemPage` |
| `js/global-search.js` | **Modificado**: `navigateTo` para tv/movie → `closeGlobalSearch()` + `navigate` item; books/games conservan el modal con su delay |
| `service-worker.js` | **Modificado**: `?v=20260929` → `?v=20261001` en todos los assets; `./js/item-page.js` añadido a `STATIC_ASSETS` (cache-first: sin bump seguiría sirviendo el JS viejo en caché) |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 4.3, 5.4, 10.1, 10.2 y 12 actualizadas con el nuevo comportamiento (ficha en página nueva para películas/series, botón ←, Esc; libros/videojuegos sin cambios) |
| `docs/adr-100-item-page.md` | **Nuevo**: este documento |

Related issue: #285 — https://github.com/gonzalitojh/Registro-personal/issues/285