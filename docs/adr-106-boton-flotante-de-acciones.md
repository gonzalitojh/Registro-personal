# ADR-106: Botón flotante de acciones para películas y series (issue #298)

## Estado

Aceptado

## Fecha

2026-08-18

## Contexto

La issue #298 pide un **botón flotante de acciones** (FAB) para
**películas y series** en la página de detalle: en móvil, las acciones
de la ficha (marcar como vista, valorar y, si aún no está en el
registro, añadir) quedaban ocultas tras las múltiples pestañas de
detalle, haciendo pesado actuar sobre un título.

Estado actual del código antes del cambio:

- La página de detalle (`#/ocio/...`, ADR-100/ADR-102, issue #285)
  renderiza la ficha (`renderFicha` → `openMovieItem`/`openTvItem` en
  `js/modal-handlers.js`, con `isRerender` para no re-pedir detalles en
  los re-renders) o la vista previa del catálogo (`paintPreview`), donde
  existe el botón real **«Añadir»** (`#btn-preview-add`) que usa
  `handleAdd` de `js/search.js` (ADR-030/ADR-062) y `refreshAfterAdd`
  para pasar a la ficha.
- Las acciones «Marcar como vista», «Valorar» y «Vista» de la lista
  viven en `js/quick-actions.js` (`quickMarkMovie`, `quickMarkTv`,
  `maybeQuickItemRating`, ADR-022/ADR-052/ADR-062) y en la ficha quedaban
  por debajo del contenido, tras las secciones de producción, elenco,
  saga y recomendaciones: en móvil, actuar sobre un título exigía
  desplazarse o cambiar de pestaña.
- La versión PWA era `20261009` (ADR-105).

La implementación está en la rama `feat/issue-298-boton-flotante` con
los commits `b012f14` (FAB en ficha/preview), `fc2a15d` (acciones
completas: `quickMarkMovie` exportado, `quickMarkTvComplete`,
`promptItemRating`), `97e4161` (bump PWA), `0dd4bfa` (manual §12.1),
`73cdec7` (estado fresco tras marcar película, candado anti doble alta y
ocultar «Marcar como vista» en series sin pendientes) y `20271c1` (el
candado cubre también el paso a ficha tras añadir). El manual de usuario
se actualizó en la misma tarea (`docs/manual-de-usuario.md` §12.1, regla
3 de AGENTS.md).

**Iteración 2 (comentario de revisión de la PR #299)**: en la **vista
previa** el FAB debe ofrecer también **«Marcar como vista»** y
**«Valorar»** (solo tenía «Añadir»), y el menú pasa de un listado
vertical a un **abanico circular animado** alrededor del botón. Las
acciones nuevas de preview **añaden el título al registro primero**
(`handleAddSeen`/`handleAdd`) y encadenan valoración, manteniendo el
candado anti doble alta; el menú se gestiona con la clase `is-open`
(visibilidad/animación CSS) en lugar del atributo `hidden`.

Related issue: #298 — https://github.com/gonzalitojh/Registro-personal/issues/298

## Decisión

Añadir un **botón flotante de acciones (FAB)** fijo abajo a la derecha
en la página de detalle de ítem, visible SOLO en la ficha (ítem en el
registro) y en la vista previa (catálogo, aún no añadido) de
películas y series, y ausente en carga/mensajes/cierre de la página.
La decisión se organiza en siete puntos.

### 1. Posicionamiento y visibilidad

- `position: fixed`, abajo a la derecha, con margen de `1.25rem` y
  `env(safe-area-inset-bottom)` para respetar el indicador de home
  (ADR-048): `bottom: calc(env(safe-area-inset-bottom, 0px) + 1.25rem)`.
- En pantallas anchas se ancla al **borde derecho de la columna de
  720 px** en lugar del borde del viewport, para no quedar lejos del
  contenido: `right: max(1.25rem, calc(50vw - 360px + 1.25rem))`
  (50vw − 360px = mitad del hueco de la columna centrada).
- `z-index: 40`: sobre el contenido de la ficha, **por debajo** de la
  cabecera (46), de las pestañas (45) y de los modales (≥50), igual que
  el resto de superficies flotantes, para que nunca tape las ventanas;
  el menú desplegable comparte ese apilamiento.
- El FAB se pinta con `renderFab(item, mode)` dentro de `#item-view`
  desde `renderFicha` (modo `"ficha"`) y desde la vista previa (modo
  `"preview"`); `removeFab()` lo retira al salir de la página o al
  cambiar de modo.

### 2. Menú en abanico circular según el modo

`fabOptionsHtml(item, mode)` genera las acciones (`data-fab-action` por
acción) dentro de `.item-fab__menu` (`role="menu"`, `pointer-events:
none`; las acciones individuales llevan `role="menuitem"`):

- **Preview** (modo `"preview"`): tres acciones en abanico —
  **«Añadir película» / «Añadir serie»** (`add`), **«Marcar como
  vista»** (`mark`) y **«Valorar»** (`rate`). «Marcar como vista» y
  «Valorar» **añaden el título al registro primero** (ver punto 4).
- **Ficha** (modo `"ficha"`):
  - **«Marcar como vista»** (`data-fab-action="mark"`), **oculto cuando
    no hay nada que marcar**: no se ofrece en series con estado
    `completado`, `standby` o `abandonado`, ni en series completas con
    estado manual sin `nextEpisode` pendiente
    (`markable = !isTv || (!["completado", "standby", "abandonado"].includes(item.status) && item.nextEpisode)`).
  - **«Añadir otro visionado»** en una **película ya vista** (mismo
    comportamiento que el botón «Vista» de la lista).
  - **«Valorar»** (`data-fab-action="rate"`), siempre presente.
  - La ficha no ofrece «Añadir»: el ítem ya está en el registro.

### 2-bis. Abanico circular (animación y geometría)

- El menú es un **abanico circular** alrededor del toggle: cada acción
  es una **pastilla** con `position: absolute` centrada en el botón y
  desplazada con variables CSS `--fx`/`--fy` (offsets en `rem`,
  `translate(calc(var(--fx) - 50%), calc(var(--fy) - 50%))`). Los
  ángulos y el radio son una única fuente de verdad en JS:
  `FAB_ARC_ANGLES = {1: [-70], 2: [-30, -85], 3: [-20, -55, -88]}`
  (grados sobre el eje X, negativo = hacia arriba/izquierda) y
  `FAB_ARC_RADIUS = 9` (`rem`).
- El despliegue usa la clase `is-open` en `.item-fab` (CSS, sin
  atributos `hidden`): en reposo las pastillas están `visibility:
  hidden` + `opacity: 0` + `scale(0.4)`; con `is-open` salen con
  `scale(1)` y un **retardo escalonado** `transition-delay: calc(var(--i,
  0) * 0.06s)` (cada acción con su `--i`), y `visibility` sin retardo en
  la apertura para que el teclado encuentre el foco al instante.
  `openFabMenu`/`closeFabMenu` alternan la clase; el listener global
  cierra con clic fuera y `handleEscape` con Esc (devolviendo el foco al
  toggle).
- **Reduced motion**: el bloque global `@media (prefers-reduced-motion:
  reduce)` de `css/styles.css` anula las transiciones, por lo que el
  abanico aparece/desaparece al instante (regla AGENTS.md).

### 3. Estado visual del botón

El toggle se ve **distinto según el estado** (`isItemSeen`):
`.item-fab--seen` (icono `✓` y fondo ocre, `--ochre-spine`/`--ink` con
hover `--ochre-spine-dark`/`--paper`) si el ítem ya está visto —
película con al menos un visionado (`watchLog.length`) o serie
`completada` — frente al **icono `+` verde** (`--teal-reel`/`--paper`,
hover `--teal-reel-dark`) de «no visto». El `aria-label` del toggle lo
refleja («Acciones rápidas (visto|pendiente)»). El dúo ocre/check es el
mismo de `.btn--accent-books`, con contraste AA en los cuatro temas.

### 4. Reutilización de flujos existentes (sin lógica duplicada)

`runFabAction(item, action)` delega en los flujos ya existentes, en vez
de reimplementarlos:

- **Añadir**: `addFromPreview(item, btn)` usa `handleAdd` de
  `js/search.js` — el MISMO del botón real «Añadir» de la preview
  (`#btn-preview-add`, que lo deshabilita durante el alta; el objeto
  local es solo el fallback para el FAB) — y `refreshAfterAdd()` pasa a
  la ficha completa leyendo el ítem recién creado.
- **Marcar (preview)**: `addSeenFromPreview(item)` usa `handleAddSeen`
  de `js/search.js` (marcado + ventana de valoración con deshacer,
  issue #136) con un target local `{disabled: false, textContent: ""}`
  en lugar del botón de la lista, y después `refreshAfterAdd()`: en la
  vista previa, **marcar como vista añade el título a la vez** — un solo
  paso en lugar de añadir y luego marcar.
- **Marcar (ficha)**: `quickMarkMovie(item, pageCtx)` (`js/quick-actions.js`,
  ahora exportado) para películas, y el **nuevo `quickMarkTvComplete`**
  (exportado) para series: marca completa TODA la serie — todos los
  episodios de todas las temporadas con `markAllSeasonsWatched` +
  `computeProgress` — con **confirmación cuando hay temporadas aún no
  estrenadas** (`window.confirm`, mismo criterio que la alta directa del
  catálogo; las series manuales sin fechas reales de TMDB se excluyen)
  y **ventana de valoración con deshacer** (issue #136) que restaura el
  progreso previo (watched, status literal, nextEpisode, fechas y
  `awaitingRelease`).
- **Valorar (preview)**: `addAndRateFromPreview(item)` usa `handleAdd`
  (o el botón real `#btn-preview-add` si está presente en el DOM, para
  respetar su deshabilitado) + `refreshAfterAdd()` y encadena
  `promptItemRating(registered, pageCtx)` sobre el ítem recién
  registrado: **valorar desde la preview añade el título primero y abre
  la valoración después**.
- **Valorar (ficha)**: el export `promptItemRating(item, pageCtx)` abre
  la ventana de valoración **sin marcar nada** vía
  `maybeQuickItemRating`.

`js/search.js` no requiere cambios: `handleAddSeen` solo toca
`btn.disabled`/`btn.textContent` sobre el target y `restoreSeenBtn`
protege con `if (!btn) return`, por lo que acepta el objeto local
`{disabled: false, textContent: ""}` sin tocar el DOM.

Los dos flujos nuevos de preview (`addSeenFromPreview`,
`addAndRateFromPreview`) comparten el candado global `previewAddInFlight`
y `refreshAfterAdd()` **devuelve el ítem** encontrado (o `null`) para
poder encadenar la acción posterior (valoración) sobre el objeto
registrado.

### 5. Repintado tras la acción sin re-pedir detalles

Tras marcar o valorar, `runFabAction` llama a `renderFicha(item, true)`
con `isRerender=true` — el **mismo patrón que el reopen del modal**
(issue #285): repinta la ficha sin volver a consultar TMDB. Para que la
ficha y el propio FAB reflejen al momento el nuevo estado, los flujos
mutan el **objeto `item` en memoria** (mismo patrón de mutación que
`persist()` en el modal): `quickMarkMovie` actualiza
`watchLog`/`status`/`awaitingRelease` y `quickMarkTvComplete`
`watched`/`status`/`nextEpisode`/fechas/`awaitingRelease`, de modo que
`renderFab` repinta el botón con el estado correcto (verde ↔ ocre) y el
menú con la opción correspondiente («Añadir otro visionado», «Marcar
como vista» oculto en series completas, etc.).

### 6. Candado anti doble alta compartido

`previewAddInFlight` es un candado **compartido entre el botón real
«Añadir» de la preview y el FAB**: el botón real solo se deshabilita
durante el `handleAdd` del propio alta, pero el FAB puede reabrir su
menú mientras tanto y volver a ofrecer «Añadir»; el candado previene
dobles altas concurrentes. Permanece activo hasta que `refreshAfterAdd`
termina — la ficha ya está en pantalla y la preview no puede volver a
reabrir «Añadir» (fix `20271c1`).

### 7. Accesibilidad y cuatro modos de tema

- **Accesibilidad**: `role="menu"` en el contenedor y `role="menuitem"`
  en cada acción, `aria-haspopup` + `aria-expanded` en el toggle, foco
  al primer menuitem al abrir, cierre con **Escape** (el `handleEscape`
  de la página cierra el menú y devuelve el foco al toggle sin navegar
  atrás) y con **clic fuera** (listener de `document`), y
  `overflow-wrap: anywhere` + `max-width: min(11.5rem, calc(100vw -
  3.5rem))` en las pastillas para que ningún texto largo se salga de
  pantalla (regla 2 de AGENTS.md). El estado oculto usa `visibility:
  hidden`, que retira las acciones del orden de tabulación y de los
  lectores de pantalla; en la apertura, `visibility` transiciona sin
  retardo para que el foco programado llegue al primer menuitem.
- **Cuatro modos de tema** (regla 4 de AGENTS.md): `.item-fab__action`
  entra en el **selector agrupado** de negro puro (fondo `--ink-raised`,
  texto `--paper`, borde `--paper-alpha-20`, misma fuente de verdad que
  el resto de superficies) y el hover de la pastilla usa el tinte claro
  `--paper-alpha-14`; el resto de superficies del FAB (toggle verde/ocre)
  usan variables de tema ya cubiertas por las familias clara y oscura
  (ADR-009/ADR-064/ADR-066).

### Manual y PWA

- **Manual de usuario** (regla 3 de AGENTS.md): actualizada la **§12.1
  «El botón flotante de acciones (películas y series)»** — menú en
  abanico alrededor del botón, acciones según el estado (tres en la
  vista previa, dos en la ficha), «Marcar como vista»/«Valorar» que
  añaden el título desde la preview, serie completa con confirmación de
  temporadas no estrenadas, «Añadir otro visionado» en películas ya
  vistas, estados visuales del botón (✓ dorado / + verde) y cierre con
  Esc/clic fuera.
- **PWA**: bump `20261010` → `20261011` en la misma tarea
  (`js/config.js` `APP_VERSION`, `index.html` y `service-worker.js`)
  para invalidar las cachés del precache (ADR-019).

## Alternativas descartadas

- **Poner las acciones en la cabecera de la ficha**: la cabecera ya
  concentra atrás/compartir y, en móvil, queda fuera del alcance del
  pulgar; la issue pide una acción rápida al alcance de la mano, que es
  exactamente lo que resuelve el FAB inferior.
- **Un solo botón que ejecuta la acción principal sin menú**: no cubre
  la valoración sin marcar ni el caso preview/ficha con acciones
  distintas; el menú en abanico (`role="menu"`) es la única forma de
  ofrecer «Añadir», «Marcar como vista»/«Añadir otro visionado» y
  «Valorar» sin ocupar espacio en la ficha.
- **Menú desplegable vertical clásico**: en la iteración 1 el menú
  abría un listado vertical sobre el FAB; la revisión de la PR pidió el
  **abanico circular** alrededor del botón (todas las opciones visibles
  de un vistazo, sin superficie que tape la esquina de la ficha). La
  geometría se parametriza en JS (`FAB_ARC_ANGLES`/`FAB_ARC_RADIUS`)
  para poder ajustarla sin tocar CSS por acción.
- **Duplicar la lógica de marcar completo en `item-page.js`** en lugar
  de exportar `quickMarkTvComplete` desde `quick-actions.js`: rompería
  la única fuente de verdad de las acciones rápidas y el deshacer
  (ADR-052/ADR-062); se prefirió reutilizar y ampliar el módulo
  existente.
- **Mostrar el FAB siempre (también en carga/mensajes o fuera de
  `#item-view`)**: sin contexto de ítem el botón no tiene acción que
  ofrecer; visible solo en ficha y preview, como pide la issue.

## Consecuencias

**Positivas:**

- **Acciones de registro en una sola pulsación**, en móvil y escritorio:
  marcar como vista, valorar o añadir desde el catálogo sin buscar el
  botón entre las secciones de la ficha; en móvil el pulgar llega al
  FAB sin desplazamiento. En la **vista previa**, marcar o valorar
  **añaden el título automáticamente**, con lo que registrar y puntuar
  un título del catálogo son dos pasos en total, no cuatro.
- **Sin lógica duplicada**: el FAB delega íntegramente en `handleAdd`,
  `handleAddSeen`, `quickMarkMovie`, `quickMarkTvComplete` y
  `promptItemRating`; el deshacer de la valoración (issue #136) y la
  confirmación de temporadas no estrenadas se heredan de los flujos
  existentes.
- **Estado siempre coherente**: la mutación en memoria + repintado con
  `isRerender` (patrón de ADR-100/issue #285) deja el FAB y la ficha
  reflejando el nuevo estado al momento, sin llamadas extra a TMDB.
- **Candado anti doble alta efectivo**: `previewAddInFlight` cubre
  también el paso a ficha tras añadir, cerrando la ventana de doble alta
  entre el botón real, el FAB y los flujos nuevos de preview (marcar y
  valorar comparten el candado).
- **Abanico parametrizado**: ángulos y radio viven en una única fuente
  (JS); el despliegue escalonado con `--i` y la anulación con
  `prefers-reduced-motion` mantienen la animación ligera y accesible.
- El manual de usuario queda alineado con el comportamiento real (regla
  3 de AGENTS.md) y los cuatro modos de tema quedan cubiertos con el
  patrón de selectores agrupados (regla 4 de AGENTS.md).

**Negativas / neutras:**

- **Un elemento más en el DOM de la ficha** (`#item-fab` con su menú):
  superficie adicional que hay que mantener — en particular, **mantener
  sincronizados los estados visto/no visto** entre ficha, lista y FAB
  (mitigado por la mutación en memoria del ítem y el repintado
  posterior).
- **El repintado post-acción hereda el riesgo pre-existente de ficha en
  blanco** si TMDB falla justo en ese momento (issue #285): `renderFicha`
  con `isRerender=true` no re-pide detalles; el riesgo queda mitigado en
  la marca rápida porque `quickMarkTvComplete` acaba de obtener la meta
  de temporadas con éxito, y en el resto de acciones el ítem ya está
  materializado en memoria.
- **Las acciones de preview «Marcar como vista»/«Valorar» añaden el
  título sin pasar por la ficha**: el usuario ve el alta y la
  valoración encadenadas; es el comportamiento pedido en la revisión,
  y el deshacer de la ventana de valoración (issue #136) cubre el caso
  de arrepentimiento.
- **PWA bump a `20261011`**: un precache/recarga adicional para los
  usuarios al desplegar (mismo coste asumido en cada bump, ADR-019).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/item-page.js` | **Modificado**: nueva sección «Botón flotante de acciones (issue #298)»: `FAB_ID`, `FAB_ICONS`, `isItemSeen` (película con `watchLog` / serie `completado`), `FAB_ARC_ANGLES`/`FAB_ARC_RADIUS` (geometría del abanico, única fuente de verdad), `fabOptionsHtml` (preview → «Añadir»/«Marcar como vista»/«Valorar»; ficha → «Marcar como vista»/«Añadir otro visionado» + «Valorar», oculto en series completadas/en pausa/abandonadas o sin `nextEpisode`), `openFabMenu`/`closeFabMenu` (clase `is-open`), `renderFab` (toggle con `aria-expanded`, pastillas del abanico con `--fx`/`--fy`/`--i` inline, clase `.item-fab--seen`), `runFabAction` (preview: `addFromPreview`/`addSeenFromPreview`/`addAndRateFromPreview`; ficha: `quickMarkMovie`/`quickMarkTvComplete`/`promptItemRating`; repinta con `renderFicha(item, true)`), helpers nuevos de preview `addSeenFromPreview` (marcar añade vía `handleAddSeen` con target local) y `addAndRateFromPreview` (valorar añade vía `handleAdd`/`#btn-preview-add` y encadena `promptItemRating`), `refreshAfterAdd()` ahora devuelve el ítem, candado `previewAddInFlight` compartido con `#btn-preview-add` (mantenido hasta `refreshAfterAdd`) y con los flujos nuevos, cierre del menú con Escape (`handleEscape`), clic fuera y `is-open` |
| `js/quick-actions.js` | **Modificado**: `quickMarkMovie` exportado y con mutación en memoria del ítem (patrón `persist()` del modal, comentario issue #298); nuevo export `quickMarkTvComplete(item, ctx)` (serie completa: guardas de standby/abandonado y sin `nextEpisode`, `markAllSeasonsWatched` + `computeProgress`, confirmación de temporadas no estrenadas excluyendo series manuales, payload con `awaitingRelease: false`, mutación en memoria y deshacer que restaura el progreso previo); nuevo export `promptItemRating(item, ctx)` (valora sin marcar vía `maybeQuickItemRating`) |
| `css/styles.css` | **Modificado**: sección del FAB reescrita para el abanico circular: `.item-fab` (fixed, `right: max(1.25rem, calc(50vw - 360px + 1.25rem))` anclado a la columna de 720 px, `z-index: 40`), `.item-fab__toggle` (teal/`--paper`, hover `--teal-reel-dark`, `focus-visible`), `.item-fab--seen .item-fab__toggle` (ocre `--ochre-spine`/`--ink`, hover `--ochre-spine-dark`/`--paper`), `.item-fab__menu` (absoluto `inset: 0`, `pointer-events: none` — ya no es superficie visible), `.item-fab__action` (pastillas posicionadas con `--fx`/`--fy` vía `translate`, `visibility: hidden`/`opacity: 0`/`scale(0.4)` en reposo, despliegue con `.item-fab.is-open` y `transition-delay: calc(var(--i, 0) * 0.06s)`, borde 999px, `overflow-wrap: anywhere`, `max-width: min(11.5rem, calc(100vw - 3.5rem))`, `--paper`/`--ink`/`--shadow-pop`); negro puro (selector agrupado): `.item-fab__action` con `--ink-raised`/`--paper`/`--paper-alpha-20` y hover con `--paper-alpha-14` |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261011` |
| `service-worker.js` | **Modificado**: bump PWA a `20261011` en `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modificado**: §12.1 «El botón flotante de acciones (películas y series)» — menú en **abanico** alrededor del botón, tres acciones en la vista previa (la de «Marcar como vista» y «Valorar» añaden el título primero), dos en la ficha («Marcar como vista»/«Añadir otro visionado» + «Valorar»), serie completa con confirmación de no estrenadas, estados visuales (✓ dorado / + verde) y cierre con Esc/clic fuera |
| `docs/adr-106-boton-flotante-de-acciones.md` | **Nuevo**: este documento |

Related issue: #298 — https://github.com/gonzalitojh/Registro-personal/issues/298