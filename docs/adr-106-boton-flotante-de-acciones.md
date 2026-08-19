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

**Iteración 3 (comentario nuevo de la issue #298, 2026-08-18)**:
cuando un ítem se ha visto más de una vez, el botón flotante debe
mostrar el **número de visionados** en lugar del tick; hay que
**diferenciar los tres estados** posibles (no añadido / añadido y no
visto / visto), y en las series solo cuentan esos tres estados (igual
que en películas, aunque existan más estados internos); las opciones
desplegadas deben llevar un **sombreado** que las distinga del fondo
y del contenido de la página. Implementado en los commits `3c59ae2`
(3 estados + contador + sombra), `9f568f4` (manual §12.1), `f961058`
(precisión de contrastes en comentarios), `ac62e66` (contador a negro
puro en modo claro, AA texto 4.5:1) y `ea43a2b` (contraste AA del FAB
en hover: familia oscura con `--ochre-spine-hover`, negro puro con
`--white` en teal/ocre, contador claro en hover a paper), más
`124f3db` (errata de comentario).

**Iteración 5 (2026-08-19, comentarios nuevos de la issue #298)**: dos
ajustes visuales. (1) **Sin solapes en el abanico**: el usuario reportó
que las opciones desplegadas «en ocasiones se superponen, una un poco
por encima de la otra». Reproducido en QA headless con la fuente real
(IBM Plex Sans): las etiquetas largas de la ficha de película vista
(«Quitar última visualización», «Añadir otro visionado») envuelven a 2
líneas (pastillas de 184 × 59 px con `max-width: 11.5rem`), y la
separación vertical de la geometría anterior (3 opciones en [-20, -55,
-88] con radio 9 rem) era de solo 52.8 px < 59 px → **solape de 6.4 px**.
La geometría nueva (`FAB_ARC_ANGLES[3] = [-22, -62, -90]` con
`FAB_ARC_RADIUS = 9.5 rem`) da separaciones verticales de 69.6 px y
71.4 px (holgura ≥ 10 px sobre pastillas de 59 px), validada en 3
anchos × 4 temas × 6 configuraciones sin solapes, sin pastillas fuera
del viewport y sin scroll horizontal. (2) **Halo de difuminado**
alrededor del abanico (comentario «añadir un poco de difuminado para
diferenciar el fondo»): `.item-fab::before` (primer hijo → pinta bajo
las pastillas) con `backdrop-filter: blur(4px)` como círculo de 26 rem
centrado en el centroide del abanico (≈ 7.15 rem a la izquierda y 4.4
rem por encima del centro del FAB, alineado con la nueva geometría),
tinte radial nueva variable `--fab-halo` por familia (oscuro
`rgba(10,9,7,.5)` — mismo tono que `--backdrop` —, negro puro
`rgba(0,0,0,.55)`, claro `rgba(44,40,34,.14)`, blanco puro
`rgba(0,0,0,.16)`), visible solo con `.is-open` (`visibility`/
`opacity` transicionadas, `pointer-events: none`). Implementado en el
commit `9314604`.

**Iteración 6 (2026-08-19, comentario nuevo de la issue #298)**: el
usuario reportó que el difuminado del halo «es demasiado amplio, sobre
todo en móvil», y pide que **no sea un blur fijo para todo un círculo
inferior**: el difuminado debe nacer **a partir de cada opción**, con
poca anchura — **1 rem o menos sobresaliendo de cada pastilla**. Se
elimina el círculo de 26 rem (`.item-fab::before`) y cada opción
(`.item-fab__action::before`) lleva su propio anillo de
`backdrop-filter: blur(4px)` con `inset: -0.75 rem` (12 px ≤ 1 rem),
`border-radius: inherit` (sigue la silueta de la pastilla) y el tinte
`--fab-halo` por familia en un **borde de 12 px del pseudo** (las
familias oscuras se suavizan: `rgba(10,9,7,.35)` y `rgba(0,0,0,.4)`
frente al `.5`/`.55` del halo, para que el difuminado siga siendo
leve; claro y blanco puro conservan `.14`/`.16`). El tinte vive SOLO
en el borde: el interior del pseudo es transparente, así que la
pastilla no se vela (el backdrop-filter del área central desenfoca su
fondo opaco uniforme → sin cambio visible) y el contraste del icono no
se degrada. El pseudo queda contenido en el contexto de apilamiento
de la acción (su `transform` lo crea) con `z-index: -1`: pinta bajo el
contenido (texto/svg) y el outline de foco de la pastilla, y sobre su
fondo/sombra; `pointer-events: none` y solo con `.is-open` (opacity
transicionada, la `visibility` la hereda de la acción). En la revisión
QA se detectó que con `background: var(--fab-halo)` el tinte velaba
también el interior (icono a 1.23:1 en oscuro); se corrigió pasando el
tinte al borde del pseudo. Implementado en los commits `bff3ab9` y
`????????`.

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

`fabOptions(item, mode)` genera las acciones (`data-fab-action` por
acción) dentro de `.item-fab__menu` (`role="menu"`, `pointer-events:
none`; las acciones individuales llevan `role="menuitem"`):

- **Preview** (modo `"preview"`): tres acciones en abanico —
  **«Añadir película» / «Añadir serie»** (`add`), **«Marcar como
  vista»** (`mark`) y **«Valorar»** (`rate`). «Marcar como vista» y
  «Valorar» **añaden el título al registro primero** (ver punto 4).
- **Ficha** (modo `"ficha"`):
  - **Opción inversa a «Añadir»** (iteración 4, primera del abanico):
    **«Quitar de añadidos»** (`remove`) si el ítem NO está visto —
    programa el borrado con deshacer (`scheduleDeletion` de
    `undo-delete.js`, el mismo flujo que tenía el botón «Eliminar» del
    final de la ficha) y vuelve a la pantalla previa (`goBack()`); si
    SÍ está visto se convierte en **«Quitar última visualización»**
    (`unwatch`): en películas elimina la última entrada del `watchLog`;
    en series desmarca el último episodio visto (mayor fecha de marcado;
    desempate por temporada/episodio), de modo que una serie completada
    vuelve a «en curso» si ese episodio era el que la completaba.
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
  `FAB_ARC_ANGLES = {1: [-70], 2: [-30, -85], 3: [-22, -62, -90]}`
  (grados sobre el eje X, negativo = hacia arriba/izquierda) y
  `FAB_ARC_RADIUS = 9.5` (`rem`). La **separación vertical entre
  pastillas** de un arco es `R·(cos aᵢ − cos aᵢ₊₁)`: con la fuente
  real las etiquetas largas de la ficha envuelven a 2 líneas (pastillas
  de 184 × 59 px) y los ángulos de 3 opciones dan 69.6 px y 71.4 px
  (≥ 10 px de holgura; iteración 5, antes 52.8 px → solape de 6.4 px).
  El ángulo inferior queda en -90° (la pastilla nunca baja del centro
  del botón, no se sale por el borde inferior en móvil).
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

El toggle refleja **tres estados diferenciados** (iteraciones 3 y 4 de
la issue #298):

- **No añadido** (modo `"preview"`): icono **`+` gris del tema**
  (iteración 4, clase base — antes `+` verde): gris OSCURO en la
  familia oscura (`--fab-idle` `#57544d`, hover `#45423c`) y gris
  CLARO en la familia clara (`#d8d3c8`/`#c6c0b2` en claro,
  `#e4e0d6`/`#d4cfc2` en blanco puro; negro puro `#2e2e2e`/`#222222`).
  El icono es `--paper` en la familia oscura y `--ink` en la clara
  (selector agrupado `[data-theme="light|white"] .item-fab:not(...)`).
- **Añadido y no visto** (ficha): icono **`+` verde** (iteración 4;
  antes azul acero `--steel`, variables eliminadas): `--teal-reel`
  `#2b6459`/`--paper` en reposo, hover `--teal-reel-dark` `#1c4a41`.
- **Visto** (ficha, `isItemSeen`): **`✓` ocre**
  (`.item-fab--seen`, `--ochre-spine`/`--ink`, hover
  `--ochre-spine-hover` `#74501d`/`--paper`). En una **película vista
  más de una vez** (`watchLog.length > 1`) el `✓` se sustituye por el
  **número de visionados** (`span.item-fab__count`, tipografía
  compacta para dos dígitos, cap `99+` por defensa; el `aria-label`
  sigue informando el número real, «visto N veces»).

En **series** solo cuentan los tres estados (completada = vista;
`en_curso`/`standby`/`abandonado` = añadido y no visto), igual que en
películas. El `aria-label` del toggle refleja el estado («Acciones
rápidas (no añadido|pendiente|visto|visto N veces)»).

**Contraste AA en los cuatro temas** (validado numéricamente en QA):
el contador es TEXTO (exige 4.5:1) y los iconos GRÁFICOS (3:1):

| Estado | oscuro | negro puro | claro | blanco puro |
|---|---|---|---|---|
| `+` gris no añadido (reposo/hover) | 6.3 / 8.4 ✓ | 11.3 / 13.3 ✓ | 9.8 / 8.1 ✓ | 15.9 / 13.5 ✓ |
| `+` verde (reposo/hover) | 5.7 / 8.3 ✓ | 5.7 / 5.9 ✓ | 6.8 / 10 ✓ | 6.8 / 10 ✓ |
| `✓` ocre (reposo/hover) | 5.5 / 6.0 ✓ | 6.3 / 7.5 ✓ | 4.4 / 5.2 ✓ | 6.3 / 5.2 ✓ |
| contador (reposo/hover) | 5.5 / 6.0 ✓ | 6.3 / 7.5 ✓ | 6.3 / 5.2 ✓ | 6.3 / 5.2 ✓ |

Matices por tema (regla 4 de AGENTS.md): en **negro puro** las
variantes claras de los acentos (`--ochre-spine-dark` `#c99a4e`,
`--teal-reel-dark` `#4f9c8e`) con texto `paper` quedan en 2.1:1–2.7:1,
así que el hover del toggle en el estado añadido (teal claro) pasa el
texto a `--white` (`#0f0f0f`, ≈5.9:1); el gris «no añadido» en negro
puro usa un gris neutro oscuro (`#2e2e2e`) para distinguirse del fondo
negro sin perder el icono paper (11.3:1). El **modo claro** fija el
contador a negro puro en reposo (la tinta clara sobre el ocre da
4.39:1) y lo devuelve al `paper` en hover; en la **familia oscura** el
hover del FAB visto usa `--ochre-spine-hover` (la pareja global
`#8f6522`+`paper` da 4.32:1, justo por debajo de 4.5:1 para texto).

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
- **Quitar de añadidos** (`remove`, ficha no visto, iteración 4):
  `scheduleDeletion(item, uid, kind, pageCtx)` de `js/undo-delete.js`
  — el MISMO flujo con deshacer (6 s) que tenía el botón «Eliminar»
  (`confirmDelete` de modal-handlers) — y `goBack()` para salir de la
  ficha. `confirmDelete`/`onDelete` de películas y series se eliminan
  junto con el botón del final de la ficha (libros y videojuegos
  conservan su botón «Eliminar» del modal y su `confirmDelete`).
- **Quitar última visualización** (`unwatch`, ficha visto, iteración
  4): los nuevos exports `quickUnwatchMovie(item, ctx)` (quita la
  ÚLTIMA entrada del `watchLog` con `removeWatch`, recomputa
  `statusFromWatchLog`, persiste y muta en memoria, sin ventana de
  valoración) y `quickUnwatchTv(item, ctx)` (desmarca el último
  episodio visto con `setEpisodeDate(..., null)` +
  `computeProgress(seasonsMeta, ...)`, persistiendo `watched`/`status`/
  `nextEpisode`/fechas — mismo payload que `quickMarkTvComplete`).

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
`renderFab` repinta el botón con el estado correcto (verde ↔ azul acero
↔ ocre, y el contador al pasar de 1 a 2 visionados) y el menú con la
opción correspondiente («Añadir otro visionado», «Marcar como vista»
oculto en series completas, etc.).

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
  `--paper-alpha-14`; el resto de superficies del FAB (toggle gris/
  verde/ocre) usan variables de tema: desde la iteración 4 el estado
  «no añadido» tiene **variables propias por familia**
  (`--fab-idle`/`--fab-idle-dark` en `:root` y en los bloques
  negro puro/claro/blanco puro — patrón de selectores agrupados con
  una sola fuente de verdad por regla), y las familias clara y blanca
  cambian el icono del toggle base de `paper` a `ink` (ADR-009/
  ADR-064/ADR-066), con los matices de contraste del punto 3 (negro
  puro: `--white` en hover del estado añadido; claro: contador a
  negro; oscuro: `--ochre-spine-hover`).

### Manual y PWA

- **Manual de usuario** (regla 3 de AGENTS.md): actualizada la **§12.1
  «El botón flotante de acciones (películas y series)»** — menú en
  abanico alrededor del botón, acciones según el estado (tres en la
  vista previa, dos o tres en la ficha con la **opción inversa**):
  «Quitar de añadidos» / «Quitar última visualización» (iteración 4),
  «Marcar como vista»/«Valorar» que añaden el título desde la preview,
  serie completa con confirmación de temporadas no estrenadas, «Añadir
  otro visionado» en películas ya vistas, **tres estados visuales del
  botón** (+ **gris del tema** no añadido, + **verde** añadido sin ver,
  ✓ dorado visto con el **número de visionados** cuando una película se
  ha visto más de una vez), el **sombreado** de las opciones
  desplegadas y cierre con Esc/clic fuera. La iteración 4 también
  adapta **§4.7** y la ficha de película/serie: el **botón «Eliminar»
  del final de la ficha desaparece** (el borrado vive en el FAB con
  deshacer, ver §14.3). **Iteración 5**: §12.1 menciona el **halo de
  difuminado** detrás del abanico y que las opciones se despliegan sin
  solaparse (sin detalle de geometría, es interno). **Iteración 6**:
  §12.1 actualizado a que **cada opción** lleva su **difuminado
  propio** a su alrededor, de poca anchura.
- **Sombreado de las opciones** (iteración 3): las pastillas usan la
  nueva variable `--fab-action-shadow` (doble capa: sombra de contacto +
  difusa, más marcada que `--shadow-pop`) con valores por familia
  (oscuro/negro puro: rgba negro al 0.45/0.5; claro y blanco puro:
  tintes de tinta al 0.18/0.22 y 0.22/0.28). En **negro puro** las
  sombras negras no separan, así que el borde que da el selector
  agrupado se refuerza a `--paper-alpha-35` en la pastilla.
- **Difuminado por opción** (iteraciones 5→6): además de la sombra, el
  usuario pidió «un poco de difuminado para diferenciar el fondo»
  (iteración 5) y, tras ver el resultado, que el blur no fuera «fijo
  para todo un círculo inferior» sino que naciera **a partir de cada
  opción** con poca anchura (iteración 6). La iteración 5 usó un
  `.item-fab::before` con un **círculo de 26 rem** centrado en el
  **centroide del abanico** (≈ 7.15 rem a la izquierda y 4.4 rem por
  encima del centro del FAB; `left: -5.4rem; top: -2.65rem` +
  `translate(-50%, -50%)`) con `backdrop-filter: blur(4px)` (prefijo
  `-webkit-` para Safari) y tinte radial `--fab-halo` por familia
  (oscuro `rgba(10,9,7,.5)`, negro puro `rgba(0,0,0,.55)`, claro
  `rgba(44,40,34,.14)` y blanco puro `rgba(0,0,0,.16)`). La iteración
  6 **sustituye ese círculo por un anillo por pastilla**:
  `.item-fab__action::before` con `inset: -0.75 rem` (sobresale 12 px
  ≤ 1 rem de cada lado), `border-radius: inherit`, el mismo
  `backdrop-filter: blur(4px)` y el tinte en un **borde de 12 px**
  (`border: 12px solid var(--fab-halo)`). El anillo queda *dentro* del
  contexto de apilamiento de la acción (su `transform` lo crea) con
  `z-index: -1`: pinta sobre la sombra/fondo de la pastilla y bajo su
  contenido y su outline de foco (Blink pinta el self-outline al
  final; verificado por píxel: teal intacto sobre el anillo). El tinte
  está solo en el borde (el interior del pseudo es transparente), de
  modo que el **interior de la pastilla no se vela** — desenfocar un
  fondo opaco uniforme no cambia nada — y el contraste del icono se
  conserva (la primera versión velaba el interior con `background:
  var(--fab-halo)`: icono a 1.23:1 en oscuro, corregido en revisión
  QA). `pointer-events: none` para no interceptar clics ni hover.
  Aparece solo con `.is-open` (mismo patrón `opacity` que las
  pastillas; la `visibility` la hereda de la acción). Es contenido
  posicionado: no añade scroll horizontal (regla 2 de AGENTS.md).
- **PWA**: bump `20261010` → `20261011` (iteración 2) → `20261012`
  (iteración 3) → `20261013` (iteración 4) → `20261014` (iteración 5)
  → `20261015` (iteración 6) en la misma tarea
  (`js/config.js` `APP_VERSION`, `index.html` y `service-worker.js`,
  vía `scripts/bump-version.sh`) para invalidar las cachés del
  precache (ADR-019).

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
- **PWA bump a `20261011` (y `20261012` en la iteración 3)**: un
  precache/recarga adicional para los usuarios al desplegar (mismo
  coste asumido en cada bump, ADR-019).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/item-page.js` | **Modificado**: nueva sección «Botón flotante de acciones (issue #298)»: `FAB_ID`, `FAB_ICONS` (`plus`/`check`/`star` + `trash`/`rotateCcw`, iteración 4), `isItemSeen` (película con `watchLog` / serie `completado`), `FAB_ARC_ANGLES`/`FAB_ARC_RADIUS` (geometría del abanico, única fuente de verdad; **iteración 5**: `3: [-22, -62, -90]` y radio 9.5 rem — separación vertical ≥ 69.6 px para pastillas de 2 líneas (~59 px) con la fuente real → sin solapes), `fabOptions` (devuelve array de opciones; preview → «Añadir»/«Marcar como vista»/«Valorar»; ficha → antepone la **opción inversa** — no visto: «Quitar de añadidos» `remove`; visto: «Quitar última visualización» `unwatch` — seguida de «Marcar como vista»/«Añadir otro visionado» + «Valorar», «marcar» oculto en series completadas/en pausa/abandonadas o sin `nextEpisode`), `openFabMenu`/`closeFabMenu` (clase `is-open`), `renderFab` (toggle con `aria-expanded`, pastillas del abanico con `--fx`/`--fy`/`--i` inline; tres estados: preview `+` gris del tema (iteración 4, antes teal), ficha no visto clase `.item-fab--added` **verde teal** (iteración 4, antes azul acero), ficha visto clase `.item-fab--seen` con el `span.item-fab__count` — número de visionados, cap `99+` — en películas vistas más de una vez; `aria-label` del toggle por estado), `runFabAction` (preview: `addFromPreview`/`addSeenFromPreview`/`addAndRateFromPreview`; ficha: `quickMarkMovie`/`quickMarkTvComplete`/`promptItemRating` + `remove`/`unwatch` — `scheduleDeletion`+`goBack` y `quickUnwatchMovie`/`quickUnwatchTv` (iteración 4); repinta con `renderFicha(item, true)` y devuelve el foco al toggle del FAB nuevo), helpers nuevos de preview `addSeenFromPreview` (marcar añade vía `handleAddSeen` con target local) y `addAndRateFromPreview` (valorar añade vía `handleAdd`/`#btn-preview-add` y encadena `promptItemRating`), `refreshAfterAdd()` ahora devuelve el ítem, candado `previewAddInFlight` compartido con `#btn-preview-add` (mantenido hasta `refreshAfterAdd`) y con los flujos nuevos, cierre del menú con Escape (`handleEscape`), clic fuera y `is-open`; **eliminado** el registro de `setItemPageBackHandler` (hook muerto, iteración 4) |
| `js/quick-actions.js` | **Modificado**: `quickMarkMovie` exportado y con mutación en memoria del ítem (patrón `persist()` del modal, comentario issue #298); nuevo export `quickMarkTvComplete(item, ctx)` (serie completa: guardas de standby/abandonado y sin `nextEpisode`, `markAllSeasonsWatched` + `computeProgress`, confirmación de temporadas no estrenadas excluyendo series manuales, payload con `awaitingRelease: false`, mutación en memoria y deshacer que restaura el progreso previo); nuevo export `promptItemRating(item, ctx)` (valora sin marcar vía `maybeQuickItemRating`); **iteración 4**: nuevos exports `quickUnwatchMovie(item, ctx)` y `quickUnwatchTv(item, ctx)` (quitan la última visualización — último episodio por fecha, desempate temporada/episodio — con `removeWatch`/`setEpisodeDate(..., null)` + `computeProgress`, persisten y mutan en memoria con toast «última visualización quitada») |
| `css/styles.css` | **Modificado**: sección del FAB reescrita para el abanico circular (y nuevas variables `--steel`/`--steel-dark`/`--ochre-spine-hover`/`--fab-action-shadow` en `:root` y familias clara/blanca): `.item-fab` (fixed, `right: max(1.25rem, calc(50vw - 360px + 1.25rem))` anclado a la columna de 720 px, `z-index: 40`), `.item-fab__toggle` (base: **gris `--fab-idle`** `#57544d`/hover `#45423c` — iteración 4, antes teal; `focus-visible` con outline paper/ink según familia), `.item-fab--seen .item-fab__toggle` (ocre `--ochre-spine`/`--ink`, hover `--ochre-spine-hover`/`--paper` en la familia oscura; claro/blanco puro `--ochre-spine-dark`; negro puro `--ochre-spine-dark` + `--white`), `.item-fab--added .item-fab__toggle` (**verde teal `--teal-reel`**/`--paper`, hover `--teal-reel-dark` — iteración 4, `--steel`/`--steel-dark` eliminados), `.item-fab__count` (con `[data-theme="light"]` a negro puro y hover a `--paper`), negro puro: hover del toggle teal con `--white` (`:not` excluye `--added`), `.item-fab__menu` (absoluto `inset: 0`, `pointer-events: none` — ya no es superficie visible), `.item-fab__action` (pastillas posicionadas con `--fx`/`--fy` vía `translate`, `width: max-content` para que el shrink-to-fit no las encoja a una letra por línea, `visibility: hidden`/`opacity: 0`/`scale(0.4)` en reposo, despliegue con `.item-fab.is-open` y `transition-delay: calc(var(--i, 0) * 0.06s)`, borde 999px, `overflow-wrap: anywhere`, `max-width: min(11.5rem, calc(100vw - 3.5rem))`, `--paper`/`--ink`, sombra `--fab-action-shadow` — doble capa por familia, iteración 3); negro puro (selector agrupado): `.item-fab__action` con `--ink-raised`/`--paper`/`--paper-alpha-20`, hover con `--paper-alpha-14` y borde reforzado a `--paper-alpha-35` en la pastilla; **iteración 4**: nuevas variables `--fab-idle`/`--fab-idle-dark` en `:root` (dark), `[data-theme="black"]` (`#2e2e2e`/`#222222`), `[data-theme="light"]` (`#d8d3c8`/`#c6c0b2`) y `[data-theme="white"]` (`#e4e0d6`/`#d4cfc2`) — patrón de selectores agrupados, y override del icono base a `--ink` en las familias claras ; **iteración 5**: `.item-fab::before` **halo circular de 26 rem** con `backdrop-filter: blur(4px)` + tinte radial `--fab-halo` por familia (oscuras `.5`/`.55`, claras `.14`/`.16`); **iteración 6**: el halo de 26 rem se **elimina** y el difuminado pasa a **cada opción**: `.item-fab__action::before` (anillo `inset: -0.75rem`, `border-radius: inherit`, `backdrop-filter: blur(4px)` + tinte `--fab-halo` SOLO en `border: 12px solid` — el interior del pseudo es transparente y no vela la pastilla, corregido en revisión QA —, `z-index: -1`, `pointer-events: none`, opacity solo con `.is-open`) y `--fab-halo` de las familias oscuras suavizado a `.35`/`.4` (anillo estrecho, difuminado «leve») |
| `js/ui.js` | **Modificado** (iteración 4): eliminados el botón `#btn-delete-item` y su wiring de `openMovieModal` y `openTvModal`, y `onDelete` de la desestructuración de ambos (películas/series); los modales de libro y videojuego conservan su botón «Eliminar» |
| `js/modal-handlers.js` | **Modificado** (iteración 4): eliminados `onDelete` de los callbacks de `openMovieItem`/`openTvItem` y el hook muerto `setItemPageBackHandler`/`goBackFromItemPage`/`itemPageBackHandler`; `confirmDelete` se conserva para libros/videojuegos |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261011` (iteración 2), `20261012` (iteración 3), `20261013` (iteración 4), `20261014` (iteración 5) y `20261015` (iteración 6) |
| `index.html` | **Modificado**: refs `?v=` de `css/styles.css`, `ocio/ocio.css` y `js/app.js` al bump vigente (`20261011`/`20261012`/`20261013`/`20261014`/`20261015`) |
| `service-worker.js` | **Modificado**: bump PWA a `20261011`/`20261012`/`20261013`/`20261014`/`20261015` en `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modificado**: §12.1 «El botón flotante de acciones (películas y series)» — menú en **abanico** alrededor del botón, tres acciones en la vista previa (la de «Marcar como vista» y «Valorar» añaden el título primero), dos o tres en la ficha con la **opción inversa** («Quitar de añadidos» si no está visto, «Quitar última visualización» si lo está — iteración 4), serie completa con confirmación de no estrenadas, tres estados visuales (+ **gris del tema** no añadido, + **verde** añadido sin ver, ✓ dorado visto con número de visionados si >1), sombreado de las opciones y cierre con Esc/clic fuera; **iteración 4**: adaptadas §4.7 (series), la ficha de película/serie y §14.3 (la retirada del botón «Eliminar» del final de la ficha, borrado vía FAB con deshacer), y §12.1-colores; **iteración 5**: §12.1 con el **halo de difuminado** detrás del abanico; **iteración 6**: §12.1 actualizado a que **cada opción** lleva un **difuminado propio** del fondo a su alrededor, de poca anchura |
| `docs/adr-106-boton-flotante-de-acciones.md` | **Nuevo**: este documento |

Related issue: #298 — https://github.com/gonzalitojh/Registro-personal/issues/298