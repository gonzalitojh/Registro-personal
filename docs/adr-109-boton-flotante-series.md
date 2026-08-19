# ADR-109: Botón flotante para series (issue #304)

## Estado

Aceptado

## Fecha

2026-08-19

## Contexto

La issue #304 pide adaptar el **botón flotante de acciones** (FAB,
ADR-106, issue #298) a los **estados de las series**: el botón debe
reflejar con un icono y un color propios cuándo una serie se está
viendo, está en pausa (standby) o ha sido abandonada, y las acciones
de **pausar / abandonar / retomar** — que hasta ahora vivían en la
propia página de la serie (`renderStatusActions` de `js/ui.js`,
botones «En pausa», «Abandonar» y «Retomar») — deben pasar al botón
flotante y **desaparecer de la página de la serie**.

Estado actual del código antes del cambio:

- El FAB (`js/item-page.js`) tiene tres estados visuales (iteraciones
  3 y 4 de la issue #298): `+` gris del tema en la preview, `+` verde
  (`.item-fab--added`) en la ficha sin ver y `✓` ocre
  (`.item-fab--seen`) en la ficha vista. En las **series** solo se
  distinguían esos tres estados: cualquier serie añadida no completada
  (pendiente, en curso, en pausa o abandonada) mostraba el `+` verde.
- El menú del FAB en la ficha ofrecía la opción inversa («Quitar de
  añadidos» / «Quitar última visualización»), «Marcar como vista»
  (oculto en series completadas/en pausa/abandonadas o sin
  `nextEpisode`) y «Valorar»: **2-3 opciones** en abanico
  (`FAB_ARC_ANGLES` 1-3 con radio 9.5 rem).
- La ficha de serie (`openTvModal` en `js/ui.js`, modo página desde la
  issue #285) mostraba `renderStatusActions(item.status)` con los
  botones «En pausa» / «Abandonar» / «Retomar» y los cableaba con
  `wireStatusActions` → `onSetStatus` (`js/modal-handlers.js`), que
  persiste el estado literal (o lo recomputa del progreso con `null`).
  Las series siempre abren la **página** (nunca el modal clásico)
  desde la issue #285, y el FAB solo existe en el modo página.
- Los estados de serie y sus colores ya tenían tokens propios:
  `--bg-state-standby` (gris, `#d9d2c0` en las familias oscura/clara y
  `#26241e` en negro puro) y `--bg-state-abandonado` (rojo/salmón,
  `#f0c2b8` / `#3d1f18`), usados en los sellos y tarjetas de la lista.
- La versión PWA era `20260823`.

La implementación está en la rama `feat/issue-304-boton-flotante-series`,
creada desde `feat/issue-201` (instrucción explícita de la issue: la PR
también va a `feat/issue-201`, patrón apilado de las issues #300/#302).

## Decisión

### 1. Estado visual del toggle según el estado de la serie

En la **ficha de una serie** el toggle del FAB ahora refleja el estado
interno (issue #304), además de los tres estados de la issue #298:

| Estado de la serie | Icono del toggle | Fondo | Clase CSS |
|---|---|---|---|
| `pendiente` (añadida, sin episodios vistos) | `+` | verde `--teal-reel` | `.item-fab--added` |
| `en_curso` (viéndose) | **reproducir ▶** | verde `--teal-reel` | `.item-fab--added` |
| `completado` | `✓` | ocre `--ochre-spine` | `.item-fab--seen` |
| `standby` (en pausa) | **pausa ⏸** | **gris del estado** (`--fab-standby`) | `.item-fab--standby` |
| `abandonado` | **tachado 🚫** (círculo con barra) | **rojo del estado** (`--fab-abandoned`) | `.item-fab--abandoned` |

Los iconos nuevos (`play`, `pause`, `ban`) se añaden a `FAB_ICONS` con
el mismo lenguaje visual (stroke) que el resto. El `aria-label` del
toggle informa el estado («viéndose», «en pausa», «abandonada», …).

Los colores de los estados pausa/abandonado usan los **mismos tonos
que los sellos de las tarjetas** (regla «el color empleado para dichos
estados» de la issue): variables nuevas `--fab-standby` /
`--fab-standby-dark` / `--fab-abandoned` / `--fab-abandoned-dark`,
definidas por familia (claras en `:root` — familia oscura y clara /
blanco puro heredan — y oscuras en negro puro, mismo patrón que
`--bg-state-*`). El icono es `--ink` (contraste ≈ 7.5:1-9:1 sobre los
tonos claros) y en negro puro pasa a `--paper` (≈ 10:1) con un
override agrupado (patrón de selectores agrupados de AGENTS.md). En
las familias claras, el estado standby (gris claro `#d9d2c0`) queda
visualmente cerca del FAB «no añadido» (`--fab-idle` `#d8d3c8`): se
distinguen por el **icono** (pausa vs `+`), que es el criterio de la
issue.

### 2. Acciones de estado en el menú del FAB

`fabOptions` (modo ficha, solo series no completadas) añade tras
«Marcar como vista» las acciones de estado, con el mismo criterio que
tenía `renderStatusActions`:

- **«En pausa»** (icono pausa, `data-fab-action="pause"`) cuando la
  serie **no** está en standby: persiste `status: "standby"`.
- **«Abandonar»** (icono tachado, `data-fab-action="abandon"`) cuando
  no está abandonada: confirma con `window.confirm` (el mismo texto que
  el botón antiguo) y persiste `status: "abandonado"`.
- **«Retomar»** (icono reproducir, `data-fab-action="resume"`) cuando
  está en pausa o abandonada: persiste `status: null` → el estado se
  **recomputa del progreso** (`computeProgress(seasonsMeta, watched)`,
  mismo criterio que el `onSetStatus` antiguo).

El nuevo helper `setTvStatus(item, statusOrNull)` de `js/item-page.js`
replica el patrón del `onSetStatus` de `modal-handlers.js` (que se
elimina para TV): obtiene la meta de temporadas con
`getSeasonsMetaFor` (de `quick-actions.js`), persiste el nuevo estado y
**muta el ítem en memoria**; el repintado posterior (`renderFicha(item,
true)` + `renderFab`) deja la ficha, el banner de estado y el propio
FAB en el estado nuevo (mismo patrón de mutación que ADR-106).

`renderStatusActions`, el `wireStatusActions` de TV y el callback
`onSetStatus` de TV se **eliminan** (libros y videojuegos conservan sus
botones de estado en sus modales: la issue solo afecta a las series).

### 3. Geometría del abanico para 4 y 5 opciones

Con las acciones de estado, la ficha de una serie en curso pasa a
**5 opciones** («Quitar de añadidos», «Marcar como vista», «En pausa»,
«Abandonar», «Valorar») y la de una serie en pausa/abandonada a 4. Un
único arco circular no las alberga sin solapes (ver ADR-106, iteración
5): el cuadrante superior-izquierdo con radio 9.5 rem admite como
máximo 3 pastillas de 59 px con separación vertical ≥ 4.2 rem, y 5
exigirían un radio de ~17 rem que saca las pastillas del viewport de
360 px. Se añade `FAB_ARC_POINTS` (issue #304): **puntos explícitos**
`{fx, fy}` en rem para 4 y 5 opciones, en **diagonal escalonada** con
separación vertical constante de 4.2 rem entre centros (holgura ≈ 0.5
rem sobre pastillas de 2 líneas) y contención en el viewport: la
opción 0 (etiqueta larga, «Quitar de añadidos») va arriba cerca de la
vertical del botón (fx -3.5) y la última («Valorar», etiqueta corta)
abajo a la izquierda (fx -13.5, extremo izquierdo ≈ 0.5 rem del borde
en 360 px). Los abanicos de 1-3 opciones conservan su geometría por
ángulos (`FAB_ARC_ANGLES`).

### 4. Sin cambios en los flujos existentes

`quickMarkTvComplete`, `quickUnwatchTv`, `promptItemRating`,
`scheduleDeletion` y el resto de acciones del FAB no cambian; las
nuevas acciones de estado solo persisten `status` (mismo payload de
1 campo que `onSetStatus` antiguo, sin tocar `watched`). El aviso
«Está en pausa/abandonada. Ábrela para retomarla.» de las acciones
rápidas de la lista (`quick-actions.js`) se mantiene: con el «Retomar»
del FAB la serie vuelve a su estado normal.

### Manual, temas y PWA

- **Manual de usuario** (regla 3 de AGENTS.md): §4.4 («Pausar,
  abandonar y retomar») pasa a describir las acciones en el **botón
  flotante** (ya no «dentro de la ficha»); §12.1 añade las tres
  acciones de estado al listado del abanico y describe los **estados
  visuales nuevos de las series** (reproducir verde viéndose, pausa
  gris, tachado rojo) y el «Retomar» para series en pausa/abandonadas.
- **Cuatro modos de tema** (regla 4 de AGENTS.md): los dos estados
  nuevos usan variables por familia (`--fab-standby*` /
  `--fab-abandoned*`) con el patrón de selectores agrupados y
  contrastes AA validados (icono ink sobre tonos claros ≈ 7.5:1-9:1;
  paper sobre los oscuros de negro puro ≈ 10:1; hovers con las
  variantes oscurecidas).
- **PWA**: bump `20260823` → `20260824` en la misma tarea
  (`js/config.js` `APP_VERSION`, `index.html` y `service-worker.js`,
  vía `scripts/bump-version.sh`) para invalidar las cachés (ADR-019).

## Alternativas descartadas

- **Mantener los botones en la página además del FAB**: la issue pide
  explícitamente eliminarlos de la página de la serie; duplicar la
  acción en dos sitios fragmentaría la única fuente de verdad del
  estado y el repintado.
- **Aumentar el radio del arco único para 5 opciones**: un radio de
  ~17 rem sacaría las pastillas exteriores del viewport de 360 px
  (las etiquetas largas miden hasta 11.5 rem) — se descarta por la
  regla 2 de AGENTS.md (nada fuera de pantalla).
- **Menú de dos niveles (submenú de estado)**: añade complejidad de
  navegación (menú dentro de menú, foco, cierre) y la issue pide que
  los botones «aparezcan en el botón flotante»: las pastillas de la
  diagonal escalonada los muestran de un vistazo, como el resto de
  acciones.
- **Reutilizar el gris `--fab-idle` del FAB para el estado standby**:
  el gris «no añadido» es un gris neutro (por familia) que no es el
  color del estado standby; la issue pide «el color empleado para
  dichos estados», que es `--bg-state-standby`.

## Consecuencias

**Positivas:**

- El FAB comunica el estado real de la serie de un vistazo (viéndose /
  en pausa / abandonada), con el mismo lenguaje de color que la lista
  (sellos y tarjetas).
- Pausar, abandonar y retomar una serie queda al alcance del pulgar,
  sin desplazarse al final de la ficha (mismo beneficio que ADR-106
  para marcar/valorar); el deshacer de una serie abandonada es
  inmediato con «Retomar».
- Sin lógica duplicada: el helper de estado reutiliza
  `getSeasonsMetaFor`/`computeProgress` (únicas fuentes de verdad) y
  el patrón de mutación en memoria + repintado de ADR-106.
- El abanico sigue sin solapes y dentro del viewport con 4-5 opciones
  (puntos explícitos con separación vertical garantizada).
- Cuatro modos de tema con contraste AA en los estados nuevos.

**Negativas / neutras:**

- Un estado de la ficha de serie más para mantener sincronizado (la
  mutación en memoria + repintado tras las acciones del FAB lo cubre;
  el caso de marcar episodios desde la página mantiene el
  comportamiento pre-existente del FAB, que solo se repinta en
  navegación/acciones del propio botón — mismo alcance que ADR-106).
- El FAB de una serie en curso muestra **5 opciones** (diagonal): el
  abanico es más amplio que el de 3 opciones, aunque contenido en el
  viewport.
- PWA bump a `20260824`: un precache/recarga adicional para los
  usuarios al desplegar (mismo coste asumido en cada bump, ADR-019).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/item-page.js` | **Modificado**: `FAB_ICONS` con `play`/`pause`/`ban` (issue #304); nuevo `FAB_ARC_POINTS` (puntos explícitos para abanicos de 4 y 5 opciones); `fabOptions` añade «En pausa»/«Abandonar»/«Retomar» en series no completadas; `renderFab` con estados de serie (clases `.item-fab--standby`/`.item-fab--abandoned`, iconos por estado y `aria-label` «viéndose»/«en pausa»/«abandonada»); `runFabAction` con las acciones `pause`/`abandon` (confirmación)/`resume`; nuevo helper `setTvStatus` (persiste y muta el estado, recomputa con `null`); imports de `getSeasonsMetaFor` y `computeProgress`; comentarios de cabecera de la sección actualizados |
| `js/ui.js` | **Modificado**: eliminados `renderStatusActions` y el `wireStatusActions` de la ficha/modal de serie (la issue #304 los mueve al FAB; libros y videojuegos conservan los suyos) y `onSetStatus` de la desestructuración de `openTvModal` |
| `js/modal-handlers.js` | **Modificado**: eliminado el callback `onSetStatus` de los callbacks de serie (los de libro/videojuego se mantienen) |
| `css/styles.css` | **Modificado**: variables nuevas `--fab-standby`/`--fab-standby-dark`/`--fab-abandoned`/`--fab-abandoned-dark` en `:root` y `[data-theme="black"]` (mismos tonos que `--bg-state-standby`/`--bg-state-abandonado`); reglas de `.item-fab--standby`/`.item-fab--abandoned` (toggle + hover) con override agrupado de negro puro para el icono `--paper`; comentarios de la sección del FAB actualizados |
| `docs/manual-de-usuario.md` | **Modificado**: §4.4 (acciones de estado en el botón flotante) y §12.1 (acciones «En pausa»/«Abandonar»/«Retomar» en el abanico, estados visuales de serie: ▶ verde viéndose, ⏸ gris en pausa, 🚫 rojo abandonada) |
| `docs/adr-109-boton-flotante-series.md` | **Nuevo**: este documento |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20260824` |
| `index.html` | **Modificado**: refs `?v=` al bump `20260824` |
| `service-worker.js` | **Modificado**: bump PWA a `20260824` en `STATIC_ASSETS` |

Related issue: #304 — https://github.com/gonzalitojh/Registro-personal/issues/304