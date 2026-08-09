# ADR-060: Ocultar la navegación al desplazar y botón flotante «Volver arriba» (issue #137)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #137 (type: feature) pide que al desplazar **hacia abajo** en
las listas de ocio (series, películas o libros — y cualquier pestaña
futura) se oculten las **pestañas** y la **barra de búsqueda superior**;
en cuanto se desplace hacia arriba, ambos deben reaparecer, con una
animación sencilla «como si surgiesen del borde de la pantalla». Como
añadido, tan pronto como se baje más allá de los filtros de la lista
(queden fuera de vista), debe mostrarse un botón **arriba, en el
centro**, para volver al principio; el botón **no debe ocupar una línea
entera**, sino flotar sobre la lista de ítems.

Desde ADR-040 (issue #79) la cabecera y las pestañas son fijas y
**siempre visibles**:

- `.app-header` (`index.html`): `position: fixed; top: 0; z-index: 46`,
  contiene la búsqueda global `#global-search-input` y los botones
  (hamburguesa, campana `#btn-notifications`, perfil
  `#btn-open-profile`). Altura `--header-h` (3.5rem).
- `.tabs--bar`: `position: fixed; z-index: 45`, **abajo** (`bottom: 0`)
  en móvil (≤768px) y **bajo la cabecera** (`top: var(--header-h)`) en
  ≥768px (ADR-040, iteración 4).
- Los dropdowns `#notif-dropdown`, `#profile-dropdown` y
  `.global-search__results` viven **dentro de** `.app-header`
  (`index.html`) y en móvil (≤600px) pasan a `position: fixed` (patrón
  de ADR-027).
- `.app` reserva espacio con `padding-top: calc(var(--header-h) +
  var(--tabs-bar-h) + 1rem)` en ≥768px (ADR-040); el contenido vive en
  `#main-content`.
- Los filtros de cada pestaña están en `.library-controls` dentro del
  `.panel` activo (`ocio/*.html`).

El problema: en listas largas la navegación fija ocupa de forma
permanente ~`--header-h` + `--tabs-bar-h` de alto vertical que no se
aprovecha para leer, y el «Volver arriba» requería scroll manual largo
cuando la lista es muy extensa.

La implementación está validada (QA PASS, 9/9 criterios de aceptación) y
escaneada (seguridad PASS, 0 hallazgos); el manual de usuario se
actualizó en la misma tarea (regla 3 de AGENTS.md). Este ADR documenta
la decisión a posteriori, como los recientes (ADR-059).

Related issue: #137 — https://github.com/gonzalitojh/Registro-personal/issues/137

## Decisión

Crear el módulo **`js/auto-hide-nav.js`** (ES module, integrado en
`js/app.js` vía `initAutoHideNav()` dentro de `init()`) que decide el
estado de la navegación según la dirección del scroll, y reflejarlo en
**clases de `<body>`**: `is-nav-hidden` e `is-back-to-top-visible`. El
CSS hace el resto con **transforms sobre elementos fixed** — no se toca
el flujo del documento, no hay reflows del contenido.

### 1. CSS (`css/styles.css`, bloque «Ocultar navegación al desplazar»)

- `body.is-nav-hidden .app-header { transform: translateY(-100%);
  visibility: hidden; transition: transform 0.25s ease, visibility 0s
  0.25s; }` — la cabecera sale por el **borde superior**;
  `translateY(-100%)` cubre su altura completa aunque varíe. El
  `visibility` se retrasa (`0s 0.25s`) para que el deslizamiento se vea
  completo y solo entonces el elemento salga del árbol de
  accesibilidad/foco; al reaparecer (clase quitada) la transición
  desaparece y `visibility` vuelve al instante.
- `body.is-nav-hidden .tabs--bar`: **móvil** `transform: translateY(100%)`
  (sale por el **borde inferior**, donde cuelga); **≥768px**
  `transform: translateY(calc(-100% - var(--header-h)))` (sube con la
  cabecera hasta el borde superior del viewport).
- Transiciones de `transform` de **0.25s** en ambos casos; con
  `prefers-reduced-motion` la media query global existente anula
  transiciones y el cambio es instantáneo.
- **Botón `.back-to-top`** (`#btn-back-to-top` en `index.html`, con
  `aria-label="Volver arriba"` y contenido `↑ Volver arriba`):
  `position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%)`,
  píldora flotante sobre la lista (no ocupa línea), `z-index: 44` — por
  **debajo** de cabecera (46) y pestañas (45) para no taparlas cuando
  reaparecen, pero por encima del contenido. Base con
  `opacity: 0; visibility: hidden; pointer-events: none` y
  `body.is-back-to-top-visible .back-to-top` con
  `opacity: 1; visibility: visible; pointer-events: auto` (fade de
  0.2s con retardo de 0.15s a la entrada); `:focus-visible` con outline
  `--teal-reel`.

### 2. `js/auto-hide-nav.js`: lógica y umbrales

- `CONFIG = { hideThreshold: 80, deltaThreshold: 8 }`:
  - **`hideThreshold: 80`**: por debajo de 80px de `scrollY` la
    navegación **nunca** se oculta (no esconderla nada más empezar a
    desplazarse).
  - **`deltaThreshold: 8`**: la dirección se decide solo si el delta de
    scroll supera ±8px; con deltas menores se **conserva el estado
    anterior** (la inercia o un trackpad lento no hacen parpadear la
    navegación).
- El **delta se calcula en el listener de `scroll`** (no dentro del
  rAF): el evento `scroll` se despacha antes que el rAF del mismo frame,
  así que dentro del rAF `window.scrollY` ya coincide con `lastY` y el
  delta sería siempre 0 (corregido en la revisión QA, commit `ac6d594`).
  El listener es `passive` y se **throttlea con rAF** (una evaluación
  por frame).
- `evaluate(delta)`:
  1. Si `isInteracting()` o `scrollY < hideThreshold` → mostrar.
  2. Si `delta > deltaThreshold` → ocultar.
  3. Si `delta < -deltaThreshold` → mostrar.
  4. En cualquier caso, re-evaluar el botón «Volver arriba»
     (`updateBackToTop()`): la posición de los filtros cambia en el
     mismo descenso en el que se oculta la navegación, no solo cuando
     cambia el estado o en `resize`.
- `setNavHidden(hidden)`: solo actúa si el estado cambia (evita trabajos
  y reflows innecesarios) y mantiene el botón sincronizado.
- **Guards `isInteracting()`** — la navegación NUNCA se oculta mientras
  el usuario interactúa con ella o hay superposición:
  - Foco dentro de `.app-header, .tabs--bar` (p. ej. escribiendo en la
    búsqueda).
  - Dropdowns anclados a la cabecera abiertos: `#notif-dropdown`,
    `#profile-dropdown`, `.global-search__results` sin `.hidden`.
  - Drawer lateral `.app-sidebar.is-open`.
  - Modal abierto `.modal:not(.hidden)`.
  - App oculta (`#app.hidden`, pantalla de acceso) o **sin panel de
    lista activo** (`activePanel()` → `#app:not(.hidden) .panel:not(.hidden)`,
    p. ej. perfil/ajustes): la ocultación por scroll **solo aplica a
    las listas de ocio**.
- **Botón «Volver arriba»**: visible solo si `navHidden` Y los filtros
  de la lista activa quedaron **totalmente fuera de vista**
  (`controls.getBoundingClientRect().bottom <= 0` sobre `.library-controls`
  del panel activo). Al pulsarlo: `setNavHidden(false)` +
  `window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })` —
  con `prefers-reduced-motion` el salto es instantáneo.
- **Reactividad**: `MutationObserver` (atributo `class`, `subtree`) sobre
  `.panel, .modal, .app-sidebar, #notif-dropdown, #profile-dropdown,
  .global-search__results, #app, body` (los cambios del propio `<body>`
  son inofensivos: `setNavHidden` es no-op si el estado no cambia);
  `focusin` en cabecera/pestañas; clics en `#btn-notifications` y
  `#btn-open-profile`; `focus` en `#global-search-input`; `resize` del
  viewport; y `evaluate()` inicial al cargar.

### 3. Integración, manual y PWA

- `js/app.js`: `import { initAutoHideNav }` + llamada en `init()`.
- `index.html`: botón `#btn-back-to-top` antes de los scripts; bump
  `?v=20260832` → `?v=20260833` (×3).
- **Manual** (`docs/manual-de-usuario.md`): §3 corregida (la cabecera ya
  no es «siempre visible») y nueva §3.2 «La cabecera y las pestañas al
  hacer scroll» (ocultación al bajar, botón «Volver arriba» flotando
  sobre la lista, nunca se oculta mientras se usa la navegación).
- **Bump PWA** `20260832` → `20260833` (un bump por PR que toca assets,
  cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html` (`?v=`
  ×3), `service-worker.js` (`?v=` ×6 en `STATIC_ASSETS` + **precache
  del nuevo módulo** `./js/auto-hide-nav.js`, sin `?v`: el módulo se
  invalida vía el cache-busting de `app.js?v=20260833`), aplicado con
  `scripts/bump-version.sh`.

## Alternativas descartadas

- **Ocultar solo la cabecera** (dejar las pestañas siempre visibles):
  descartado — la issue pide explícitamente ocultar «las pestañas y la
  barra de búsqueda superior»; además, en ≥768px las pestañas cuelgan
  bajo la cabecera y en móvil la barra inferior seguiría robando
  `--tabs-bar-h` de alto en listas largas.
- **Animación por JS directo** (estilos inline o classList sobre los
  elementos, sin clases en `body`): descartado — acopla el JS al layout
  concreto y duplica lógica que ya vive en CSS (transiciones,
  `prefers-reduced-motion`); las clases en `body` dejan la animación en
  una sola capa (CSS) y el estado es inspeccionable.
- **Botón «Volver arriba» como línea entera** (elemento en el flujo
  entre los filtros y la lista): descartado — la issue pide
  explícitamente que **no ocupe una línea entera** y que flote sobre la
  lista; un elemento en flujo además empujaría los ítems al aparecer.
- **Sin botón «Volver arriba»**: descartado — es un añadido explícito
  de la issue: con la navegación oculta y los filtros fuera de vista no
  quedaría forma de volver al principio sin scroll manual largo.
- **Extender la ocultación a toda la app** (acceso, perfil, ajustes):
  descartado — son pantallas sin listas largas ni barra de búsqueda
  relevante; ocultar la navegación allí sorprendería y complicaría los
  guards (los paneles de perfil no tienen `.library-controls`).
- **Ocultar también con `scrollY` pequeño** (sin `hideThreshold`):
  descartado — la navegación parpadearía nada más empezar a desplazarse;
  los 80px de margen la estabilizan al inicio del scroll.

## Consecuencias

### Positivas

- **Más espacio vertical de lectura**: en listas largas cabecera y
  pestañas salen de la pantalla y la lista ocupa todo el alto; vuelven
  al instante al subir o al interactuar.
- **Animación barata y aislada**: solo transforms de 2 elementos fixed
  (trabajo del compositor), sin tocar el flujo del documento ni el
  padding reservado de `.app`; `prefers-reduced-motion` respetado.
- **Guards de interacción robustos**: foco en búsqueda, dropdowns
  abiertos, modal, drawer y pantallas no-ocio — criterio 7 de la issue
  cumplido; los dropdowns anclados a la cabecera nunca quedan
  descuelgados.
- **Accesibilidad**: `visibility` retardado permite ver el deslizamiento
  y luego saca cabecera/pestañas (y el botón oculto) del árbol de foco;
  el botón tiene `aria-label` y `:focus-visible`; con
  `prefers-reduced-motion` el cambio es instantáneo y el salto al top es
  `auto`.
- **Botón flotante con `z-index: 44`**: por debajo de cabecera/pestañas
  (46/45) — al reaparecer la navegación nunca queda tapada ni el botón
  la pisa; por encima del contenido de la lista.
- **Estado centralizado en `body`**: las clases `is-nav-hidden` e
  `is-back-to-top-visible` hacen el estado inspeccionable desde
  DevTools y reutilizable por futuras features.
- **Manual al día**: regla 3 de AGENTS.md cumplida en la misma tarea
  (§3 y §3.2), y QA/seguridad PASS antes de documentar.

### Negativas / Riesgos

- **Dropdowns `fixed` bajo un ancestro con transform**: los dropdowns
  viven dentro de `.app-header`; con `transform` activo el header pasa a
  ser el containing block de sus `position: fixed` (móvil ≤600px). El
  riesgo queda **mitigado por los guards** (`isInteracting()` + listener
  de apertura): la cabecera nunca se oculta con un dropdown abierto, y
  el `MutationObserver` reevalúa al cerrarse. Si en el futuro se añade
  un dropdown que no pase por esos guards, habrá que revisarlo.
- **`visibility` con retardo**: durante la transición de salida el
  elemento sigue visible (0.25s); un vaivén muy rápido de scroll puede
  percibirse como parpadeo residual. Aceptado para que el deslizamiento
  se vea completo; el `deltaThreshold` de 8px amortigua los cambios
  rápidos de dirección.
- **Umbrales empíricos (80/8 px)**: el comportamiento de parpadeo
  depende del dispositivo, trackpad o ratón; si algún dispositivo lo
  nota, se ajustan en `CONFIG` del módulo.
- **Alcance limitado a ocio**: la ocultación no aplica en perfil,
  ajustes ni acceso. Es el alcance pedido (y cualquier pestaña futura
  con `.panel` y `.library-controls` la hereda), pero una sección nueva
  con listas largas fuera de ese patrón necesitaría ampliar los guards.
- **El observer reacciona a sus propias clases en `body`**: reevaluación
  inofensiva (no-op si el estado no cambia) y con coste despreciable.

### Neutras

- **Bump PWA de rutina**: `20260832` → `20260833` (un bump por PR,
  ADR-049) con `scripts/bump-version.sh`; `js/auto-hide-nav.js` entra en
  el precache del service worker.
- **ADR-040 sigue vigente como registro histórico**: documentaba la
  navegación «siempre visible»; este ADR describe su evolución, no lo
  modifica. Los ADRs de dropdowns (ADR-027, ADR-035, ADR-038) tampoco se
  tocan.
- **Rama `feat/issue-137-auto-hide-nav`** con 7 commits (base `dev`):
  `3541d29` (index.html: botón + bump), `ffccffd` (styles.css: bloque de
  ocultación + botón), `a77d68b` (js/auto-hide-nav.js), `0df13f7`
  (app.js: integración), `f8de71d` (manual §3.2), `ac6d594` (fix delta
  en listener y conservación de estado), `9fe9dac` (bump PWA + precache).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/auto-hide-nav.js` | **Nuevo**: módulo ES con `initAutoHideNav()` — `CONFIG { hideThreshold: 80, deltaThreshold: 8 }`; `activePanel()` (`#app:not(.hidden) .panel:not(.hidden)`), `isInteracting()` (foco en cabecera/pestañas, dropdowns, drawer, modal, app oculta o sin panel), `setNavHidden()` (clase `body.is-nav-hidden`), `updateBackToTop()` (`body.is-back-to-top-visible` solo con nav oculta y `.library-controls` con `bottom <= 0`), `evaluate(delta)`; listener `scroll` passive con delta calculado en el listener + throttle rAF; `focusin`, clics en `#btn-notifications`/`#btn-open-profile`, `focus` en `#global-search-input`, `MutationObserver` de clase en subtree, `resize`, click de `#btn-back-to-top` (scroll `smooth`, `auto` con `prefers-reduced-motion`) y evaluación inicial |
| `css/styles.css` | **Modificado**: bloque «Ocultar navegación al desplazar (issue #137)» — `body.is-nav-hidden .app-header` con `transform: translateY(-100%)` + `visibility` retardado; `.tabs--bar` con `translateY(100%)` en móvil y `translateY(calc(-100% - var(--header-h)))` en ≥768px; transiciones `transform 0.25s ease, visibility 0s 0.25s`; `.back-to-top` (fixed, centrado, `top: 0.75rem`, `z-index: 44`, píldora) con `body.is-back-to-top-visible` (opacity/visibility/pointer-events, fade 0.2s con retardo 0.15s) y `:focus-visible` con `--teal-reel` |
| `index.html` | **Modificado**: botón `#btn-back-to-top` (`.back-to-top`, `aria-label="Volver arriba"`, `↑ Volver arriba`) antes de los scripts; bump `?v=20260832` → `?v=20260833` (×3) |
| `js/app.js` | **Modificado**: `import { initAutoHideNav }` e `initAutoHideNav()` en `init()` (issue #137) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260832` → `20260833` |
| `service-worker.js` | **Modificado**: bump `?v=20260833` en los 6 assets de `STATIC_ASSETS` y **precache nuevo** `./js/auto-hide-nav.js` (vía `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modificado**: §3 (la cabecera y las pestañas «se ocultan al bajar y vuelven al subir», ya no «siempre visibles») y nueva §3.2 «La cabecera y las pestañas al hacer scroll» (ocultación al bajar, botón flotante «Volver arriba», la navegación nunca se oculta mientras se usa) — regla 3 de AGENTS.md |
| `docs/adr-060-ocultar-navegacion-al-desplazar.md` | **Nuevo**: este documento |

Related issue: #137 — https://github.com/gonzalitojh/Registro-personal/issues/137
