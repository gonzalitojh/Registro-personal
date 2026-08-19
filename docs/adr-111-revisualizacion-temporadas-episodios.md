# ADR-111: Revisualización de temporadas y episodios (issue #310)

## Estado

Aceptado

## Fecha

2026-08-19

## Contexto

La issue #310 pide tres cambios relacionados con el rewatch de series y
la información por episodio:

1. **El rewatch conserva el progreso**: al volver a ver una serie desde
   el principio, la app **desmarcaba todos los episodios** (vaciaba
   `item.watched`). El usuario pide que los episodios vistos **se
   conserven marcados** y que, al volver a ver un episodio concreto, su
   contador sume y la casilla muestre el **número de visualizaciones**
   en lugar del tick.
2. **Fechas por episodio ocultas**: cada episodio visto mostraba un
   **input de fecha siempre visible** (editable). La issue pide que la
   fecha de visionado **no se muestre directamente** y que cada episodio
   tenga un desplegable **«Visionados anteriores»** (oculto por defecto)
   con las fechas de **todos** los visionados (sirve también con un solo
   visionado; con varios, una fecha por vez).
3. **Media de episodios en la parte superior**: la media de episodios
   valorados vivía como línea informativa **junto a las temporadas**
   (ADR-063). La issue pide que aparezca **en la parte superior de la
   ficha de la serie**, junto a la valoración de TMDB y la propia, con
   un **estilo ligeramente distinto** para diferenciarla.

Relación con lo existente: el diálogo que pregunta «¿Lo has visto de
nuevo o lo desmarcas?» (issue #133, ADR-059) se conserva intacto; los
datos de episodio viven en `item.watched` como mapa
`{ [ep]: {date, times, rating} }`. La gestión del rewatch se hacía con
`startRewatch` (limpiaba `watched`) y el avance con `persistWatched`
(que usaba `progressWithStatus`).

Related issue: #310 — https://github.com/gonzalitojh/Registro-personal/issues/310

## Decisión

### 1. Rewatch que conserva el progreso y contador por episodio

- `js/tv-progress.js`:
  - `startRewatch` **conserva `watched`** (antes lo vaciaba a `{}`) y
    añade el flag `rewatching: true` al ítem.
  - New helper `entryDates(entry)` y `normalizeEntry` **siempre
    devuelve `dates`**: array con las fechas de TODOS los visionados,
    con `dates.length === times`. Compatibilidad legacy: si la entrada
    guardada no trae `dates` (datos previos a #310), se deriva
    `dates = [entry.date]`. Entradas string → `{date, times: 1, dates:
    [date]}`.
  - `setEpisodeDate`, `setEpisodeRating` y `setSeasonWatched`
    **conservan `dates`** en las entradas que actualizan.
  - `markEpisodeSeenAgain(entry, date)` (new): suma una vez al
    contador y **añade la fecha** al array `dates` («visionado
    anterior»).
  - `removeLastEpisodeViewing(watched, seasonNumber, episodeNumber)`
    (new, iteración por feedback de #310): quita **solo la ÚLTIMA
    visualización** de un episodio. Si `times === 1` elimina la entrada
    (desmarcar previo); si `times > 1` decrementa el contador y quita la
    fecha más reciente de `dates` (conserva `rating` y las visiones
    previas); las entradas legacy (`{date, times}` sin `dates`) quedan
    con su fecha representativa y `times - 1`. Es la acción de
    **«Quitar última visualización»** (checkbox del episodio y botón
    flotante).
  - `setSeasonWatched(allWatched)`: los episodios **ya vistos** que
    pasan por «Marcar todo» en pleno rewatch **incrementan `times` y
    añaden fecha** en lugar de quedar igual (el flag `rewatching` del
    ítem lo decide vía `progressWithRewatch`).
  - `isRewatchComplete(seasonsMeta, watched)` y
    `progressWithRewatch(seasonsMeta, item, newWatched)`: mientras el
    ítem esté en `rewatching: true`, la serie **no se considera
    completa** y `nextEpisode` vuelve a T1E1 al llegar al final; al
    completar el rewatch (todos los episodios con `times ≥ 2` cuando el
    mínimo lo pide — criterio por contador, sustituido desde la
    iteración 2 por el de fechas `rewatchStartedAt`, ver §4) se
    **limpia el flag**.
- `js/modal-handlers.js`: `progressWithStatus` respeta `item.rewatching`
  (estado «pendiente» y `nextEpisode` T1E1 si el episodio siguiente ya
  está visto en el rewatch); `persistWatched` usa `progressWithRewatch`
  y persiste/limpia `rewatching`.
- `js/quick-actions.js`: `saveTvProgress`, `quickMarkTv`,
  `quickUnwatchTv` y `quickMarkTvComplete` (más sus deshaceres) usan los
  nuevos helpers. En un episodio del rewatch, «marcar» llama a
  `markEpisodeSeenAgain` en vez de `setEpisodeDate`.

### 2. «Visionados anteriores» por episodio (fechas ocultas)

- `js/ui.js` (`renderEpisodeRows`): se **elimina el input de fecha** de
  la fila y se añade un **botón «Visionados anteriores»** (solo visible
  si el episodio está visto), que despliega —con `aria-expanded` y
  toggle local, sin repintado derivado— el bloque `.episode-rewatches
  __dates` (oculto por defecto) con una línea por visión
  (`rewatchesListHtml`, «Visto el DD/MM/AAAA»). `applyEpisodeRowState`
  rellena el bloque desde `entry.dates` y lo repliega en cada repintado
  derivado de dato (patrón issue #136).
- Iteración por feedback de #310 (estética y datos legacy):
  - El botón tiene la **misma estética que el summary «Visionados
    anteriores (N)» de la serie y el cabecero de temporada**: tinta
    `--ink`, `chevron ▸` (`--ink-soft`, `aria-hidden`) que **rota 90°**
    con `[aria-expanded="true"]`, hover subrayado, focus-visible con
    outline — nunca `--ink-raised` como color de texto (en las familias
    Claro/Blanco puro vale `#ffffff` e invisibilizaría el botón; en
    Negro puro el override agrupado lo pasa a `--paper`).
  - El label muestra **siempre el contador** «Visionados anteriores
    (N)» (`N = times`), igual que el summary de la serie.
  - `rewatchesListHtml` muestra una **línea informativa en cursiva**
    («N visión/visiones más sin fecha registrada») cuando `times` es
    mayor que las fechas conocidas: los datos previos a la issue solo
    guardaban `{date, times}` (sin `dates[]`), así el desplegable
    queda **coherente con el contador** de la casilla (p. ej. una
    serie vista dos veces completa).
  - El diálogo #133 adapta su etiqueta: **«Desmarcar»** si `times ===
    1`, **«Quitar última visualización»** si `times > 1` (anticipa que
    el episodio sigue marcado). Aria-label del checkbox y acción
    rápida del FAB (`quickUnwatchTv`) usan también
    `removeLastEpisodeViewing`.

### 3. Media de episodios en la parte superior de la ficha

- `js/ui.js`: `episodeAverageHtml(item.watched, idPrefix)` pasa a
  `episodeAverageBadgeHtml(item.watched)` con **id fijo
  `#item-episode-average`** y markup de chip (label en mayúsculas +
  valor). Se renderiza en el **hero** (`itemHeroHtml`, solo `type ===
  "tv"` con valoración propia) y en la fila de valoraciones del **modal
  clásico**; se elimina la línea pegada a las temporadas.
- `ocio/ocio.css`: nuevo bloque `.item-episode-average` (inline-flex,
  borde `--paper-line`, `border-radius: 999px`, tipografía mono,
  `[hidden]` forzado). Tema oscuro: el `strong` del chip hereda el
  papel en página (`[data-theme="dark"] .item-view .item-episode-average
  strong`) y el label usa la tinta suave de la familia clara sobre las
  superficies de papel del modal (`[data-theme="dark"] .modal__card
  .item-episode-average` ≈ 4.9:1 AA). Negro puro: overrides agrupados
  `[data-theme="black"]` para `strong` y hover del botón de visionados.
- Botón/lista de fechas: el botón usa `--ink` con **chevron rotatorio**
  (mismo lenguaje que `.season-toggle` y el summary de la serie) y
  **hover subrayado** (hasta la iteración 2, que lo elimina en favor del
  outline; ver §4); la lista mantiene la tipografía mono;
  `--ink-soft`/`--paper` con overrides por familia (negro puro:
  selectores agrupados para el botón completo, hover y focus-visible).

### 4. Iteración 2 (feedback 2026-08-19)

Segunda ronda de feedback del usuario en la issue #310 (comentario
2026-08-19T22:07:39Z). Cuatro decisiones nuevas, todas dentro del mismo
diseño «por episodio» de la iteración anterior:

**«Marcar todo»/«Desmarcar todo» con la semántica del episodio
individual** (`js/tv-progress.js`, `js/ui.js`):
- `setSeasonWatched` aplica a **cada episodio de la temporada** la misma
  lógica que marcar/desmarcar un episodio suelto: **«Marcar todo»
  AÑADE una visualización** a cada episodio (los ya vistos suman +1 y
  registran la fecha del día; los no vistos quedan con `{date, times: 1,
  dates: [date]}`) y **«Desmarcar todo» QUITA la última visualización**
  de cada episodio (antes vaciaba la temporada entera). La resta
  comparte el helper `lastViewingRemovedEntry` con
  `removeLastEpisodeViewing`: los vistos una sola vez se desmarcan;
  los vistos varias veces **siguen marcados** con `times - 1` y sin la
  fecha más reciente (hay que pulsar varias veces para desmarcarlos
  todos si todos tienen más de una visión).
- `js/ui.js`: el contador «marcados X de Y» de la temporada tras el
  toggle se **deriva de `item.watched`** (episodios con entrada
  `date` vía `normalizeEntry`), en lugar de fijarse a ciegas en
  `0`/`episodeCount`: tras «Desmarcar todo», la etiqueta refleja los
  episodios que siguen marcados por tener varias visualizaciones.

**«Visionados anteriores» sin subrayado** (`ocio/ocio.css`):
- Se elimina el `text-decoration: underline` del hover y del
  `focus-visible` de `.episode-rewatches` (en táctil, el tap aplica
  hover y el subrayado se quedaba pegado como texto seleccionado). El
  **foco de teclado se indica solo con el outline** (`focus-visible`),
  igual que el summary de la serie y el cabecero de temporada, que ya
  no subrayan. El motivo queda documentado en un comentario del CSS.

**Ventana de valoración con la valoración previa al «Lo he visto de
nuevo»** (`js/modal-handlers.js`, `js/ui.js`):
- `onEpisodeSeenAgain` persiste el +1 con la fecha de hoy
  (`markEpisodeSeenAgain`, conservando la valoración) y abre la ventana
  de valoración con **`initialRating = entry.rating`**: la valoración
  anterior **viene seleccionada por defecto** («debe ser siempre la
  misma a menos que se cambie»). La ventana **bloquea hasta cerrarla**
  igual que en el marcado de un episodio nuevo.
- **«Deshacer» revierte el +1 y la fecha recién registrada** vía
  `removeLastEpisodeViewing`, restaura los flags previos del ítem
  (`awaitingRelease`, `status`, `rewatching`) y, si el marcado hubiera
  completado el rewatch, `progressWithRewatch` con el flag restaurado
  devuelve el progreso del ciclo en curso para que el banner no pinte
  un «completado» fantasma (patrón issue #136).

**Completitud del rewatch por fechas con `rewatchStartedAt`**
(`js/tv-progress.js`):
- `startRewatch` persiste **`rewatchStartedAt`** (fecha de inicio del
  ciclo, `todayISO()`) y **eleva `timesCompleted` al máximo** entre el
  contador acumulado y las veces registradas por episodio: los datos
  legacy (serie vista dos veces completa antes de #310, con `times = 2`
  en episodios y sin contador) hacían que un ciclo nuevo se completara
  al marcar un solo episodio.
- `isRewatchComplete(seasonsMeta, watched, startedAt, minTimes)`: con
  `startedAt`, el ciclo **termina solo cuando CADA episodio tiene una
  visión con fecha `>= rewatchStartedAt`** (las visualizaciones antiguas
  no cuentan para terminarlo); es robusto frente a contadores legacy
  inflados. **Sin `startedAt`** (ciclos en vuelo iniciados por una
  versión anterior a la iteración) se cae al **fallback por contador**
  con `minTimes`, documentado en el código. `progressWithRewatch` pasa
  `item.rewatchStartedAt || null`.

## Alternativas descartadas

- **Seguir limpiando `watched` en `startRewatch` y mostrar el rewatch
  solo en el historial de la serie**: pierde el contador por episodio y
  la casilla con nº de veces que pide la issue.
- **Migración de datos** (reescribir `item.watched` de todos los
  usuarios): innecesaria; la compatibilidad legacy de `dates`
  (`dates = [entry.date]`) deriva el pasado de forma determinista sin
  tocar Firestore.
- **Mantener el input de fecha y añadir además el desplegable**: duplica
  la UI de fechas; la issue pide que la fecha **no se muestre
  directamente** — el desplegable sustituye al input.
- **Chip con el estilo exacto de las demás valoraciones del hero**:
  el «ligeramente distinto» de la issue pide diferenciarlo; borde
  redondeado + label en mayúsculas lo separa sin romper la identidad.
- **Mostrar la media de episodios también en la preview de búsqueda**:
  la preview no tiene valoraciones propias; el badge solo se renderiza
  con `showUserRating` (el hero de búsqueda lo pinta con `false`).

## Consecuencias

**Positivas:**

- El rewatch conserva todo lo visto: la casilla muestra el **nº de
  veces** por episodio y «Visionados anteriores» acumula las fechas de
  cada vez.
- Desmarcar con varias visualizaciones es **no destructivo**: quita
  solo la visión más reciente y conserva el historial previo.
- El desplegable es **coherente con el contador** también con datos
  legacy (línea «N visiones más sin fecha registrada»), sin inventar
  fechas.
- Las fechas por episodio dejan de ocupar espacio visible y pasan a ser
  **bajo demanda**.
- La media de episodios es visible **sin desplegar temporadas** (top de
  la ficha, junto a TMDB y la propia).
- Cero migración de datos: los registros antiguos derivan `dates`
  desde `date`, y los nuevos escriben `dates` junto a `times`.
- Reportes de contraste: el chip y el botón pasan AA en los cuatro
  modos (dark, negro puro, claro, blanco puro).

**Negativas / neutras:**

- **No hay edición de fecha por episodio** a partir de ahora (la issue
  lo pide implícitamente al ocultar la fecha directa; la fecha de cada
  visionado se registra con la fecha real de la acción).
- **Desmarcar con varias visualizaciones no desmarca**: quita solo la
  visión más reciente (contador baja, el episodio sigue marcado). Es el
  comportamiento pedido por el usuario en la iteración; el diálogo lo
  anticipa con la etiqueta «Quitar última visualización».
- Las **fechas antiguas irrecuperables** (datos pre-#310 con `times >
  fechas`) se muestran como línea informativa «N visiones más sin fecha
  registrada», nunca como fechas inventadas.
- El desplegable es **toggle local**: cualquier repintado derivado del
  estado (marcar/desmarcar/valorar) lo repliega (coherente con el
  patrón #136; el contenido siempre deriva de `item.watched`).
- `strings` legacy en `watched` (formato string por episodio) se
  conservan en el read (normalize) sin reescribirse en Firestore salvo
  que el episodio se vuelva a tocar.
- Versión PWA bumped a `20261004` (la iteración se publica sobre la
  `20261003` de la primera implementación de #310; se evita colisión
  de precache y de las versiones en vuelo de otras ramas).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/tv-progress.js` | **Modificado**: `startRewatch` conserva `watched` y marca `rewatching: true`; `normalizeEntry`/`entryDates` siempre derivan `dates` (legacy `[date]`); `setEpisodeDate`, `setEpisodeRating`, `setSeasonWatched`, `markEpisodeSeenAgain` mantienen/acumulan `dates`; `setSeasonWatched` (allWatched) suma +1 a los ya vistos en rewatch; nuevos `isRewatchComplete`, `progressWithRewatch` y `removeLastEpisodeViewing` (quita solo la última visión; iteración #310). **Iteración 2 (feedback 2026-08-19)**: `setSeasonWatched` aplica «Marcar/Desmarcar todo» con la semántica del episodio individual por episodio (`lastViewingRemovedEntry` compartido con `removeLastEpisodeViewing`; «Desmarcar todo» ya no vacía la temporada); `startRewatch` persiste `rewatchStartedAt` y eleva `timesCompleted` al máximo entre contador y veces por episodio (datos legacy); `isRewatchComplete` pasa a decidir por fechas `>= rewatchStartedAt` con fallback por contador para ciclos en vuelo sin el campo |
| `js/modal-handlers.js` | **Modificado**: `progressWithStatus` respeta el flag `rewatching` (pendiente + nextEpisode T1E1); `persistWatched` usa `progressWithRewatch` y persiste/limpia el flag; callback `onRemoveLastViewing` (iteración #310). **Iteración 2 (feedback 2026-08-19)**: `onEpisodeSeenAgain` (renombrado desde `onSetEpisodeSeenAgain`) persiste el +1 y abre la ventana de valoración con la **valoración anterior por defecto** (`initialRating`); «Deshacer» revierte el +1 vía `removeLastEpisodeViewing` y restaura `awaitingRelease`/`status`/`rewatching` (sin «completado» fantasma con `progressWithRewatch`) |
| `js/quick-actions.js` | **Modificado**: `saveTvProgress`, `quickMarkTv` (rewatch → `markEpisodeSeenAgain`), `quickUnwatchTv` (iteración #310 → `removeLastEpisodeViewing`), `quickMarkTvComplete` y sus deshaceres usan los nuevos helpers y restauran `rewatching` |
| `js/ui.js` | **Modificado**: `episodeAverageBadgeHtml` (chip, id fijo `item-episode-average`) en hero (tv con valoración propia) y modal clásico; `renderEpisodeRows` sin input de fecha + botón `episode-rewatches` (chevron + label con contador; iteración #310) y bloque `episode-rewatches__dates` (toggle aria-expanded); `rewatchesListHtml` con línea informativa legacy; `applyEpisodeRowState`/`wireEpisodeRows` rellenan y repliegan el desplegable; rama «unmarked» → `onRemoveLastViewing`. **Iteración 2 (feedback 2026-08-19)**: rama «seen_again» → `onEpisodeSeenAgain` (espera a la ventana de valoración con la valoración previa); el contador de temporada tras «Marcar/Desmarcar todo» se deriva de `item.watched` (etiqueta fiel tras desmarcar con varias visiones) |
| `js/episode-actions-modal.js` | **Modificado** (iteración #310): etiqueta «Quitar última visualización» si `times > 1`, «Desmarcar» si `times === 1` |
| `ocio/ocio.css` | **Modificado**: bloque `.item-episode-average` (chip, `[hidden]` forzado) e `.episode-rewatches`/`__chevron`/`__dates`/`__list`/`__unknown` (botón con chevron rotatorio y área táctil 32px; iteración #310); overrides `[data-theme="dark"]` (tinta suave #6b6355 sobre superficies de papel, strong papel en item-view) y `[data-theme="black"]` (botón completo → `--paper`, hover/focus, strong chip); eliminadas las referencias a `.episode-date`/`.episode-average` de la media query móvil y de los bloques de tema. **Iteración 2 (feedback 2026-08-19)**: `.episode-rewatches` **sin subrayado en hover/pulso** (el foco de teclado se indica solo con outline; motivo documentado en comentario del CSS) |
| `css/styles.css` | **Modificado**: override `[data-theme="dark"] .item-view` pasa de `.episode-average strong` a `.item-episode-average strong` (color papel sobre el fondo oscuro de la página) |
| `docs/manual-de-usuario.md` | **Modificado**: §4.3 (fechas por episodio ocultas tras «Visionados anteriores»; «Quitar última visualización» vs «Desmarcar»), §4.5 (el rewatch conserva los episodios y suma contadores), §4.7 y §12 (desmarcado del último episodio con varias visiones), §12 (chip de media en el hero de series) y §13 (media de episodios en la parte superior, estilo chip; FAQ desmarcar episodios). **Iteración 2 (feedback 2026-08-19)**: §4.3 («Marcar todo» añade una visualización a cada episodio; «Desmarcar todo» quita la última de cada uno —los vistos varias veces siguen marcados—; al «Lo he visto de nuevo» la ventana de valoración trae la valoración anterior por defecto y «Deshacer» revierte el visionado recién añadido) y §4.5 (la visualización termina al volver a ver TODOS los episodios; las visiones antiguas no cuentan) |
| `docs/adr-111-revisualizacion-temporadas-episodios.md` | **Nuevo**: este documento (incluye la iteración por feedback de #310 y la subsección «Iteración 2 (feedback 2026-08-19)» con las 4 decisiones de la segunda ronda) |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificados**: bump de versión PWA a `20261003` (primera implementación) y `20261004` (iteración por feedback) |
| `tasks/task-issue-310.json` | Task file de la tarea |

Related issue: #310 — https://github.com/gonzalitojh/Registro-personal/issues/310