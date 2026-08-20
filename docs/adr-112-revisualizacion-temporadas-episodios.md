# ADR-112: Revisualización de temporadas y episodios (issue #310)

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
  está visto en el rewatch — comportamiento sustituido en la iteración
  3 por el progreso del ciclo actual, ver §5); `persistWatched` usa
  `progressWithRewatch` y persiste/limpia `rewatching`.
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

### 5. Iteración 3 (feedback 2026-08-20)

Tercera ronda de feedback del usuario en la issue #310 (comentario
2026-08-20T05:33:45Z). Cinco puntos, todos sobre la COHERENCIA de los
contadores y el estado visual durante un rewatch:

**El progreso mostrado durante un rewatch es el del CICLO ACTUAL, no el
histórico completo** (`js/tv-progress.js`, `js/modal-handlers.js`,
`js/ui.js`):
- Nuevo `entrySeenSince(entry, startedAt)`: una entrada cuenta como
  «vista en el ciclo» si alguna de sus fechas (`dates`, o `date` en
  datos legacy) es `>= rewatchStartedAt`. Sin `startedAt` (sin rewatch)
  cualquier fecha cuenta.
- `progressWithRewatch` (con `rewatchStartedAt`): `totalWatched` cuenta
  solo los episodios del ciclo (**1/73 al empezar**, no los 73
  históricos), `nextEpisode` es el siguiente episodio del ciclo sin ver
  y el estado de hecho es **`en_curso` («viendo»)**, no «pendiente».
  El ciclo legacy en vuelo (sin `rewatchStartedAt`, iniciado antes de
  la iteración 2) conserva el comportamiento previo (pendiente + T1E1).
- `progressWithStatus` (ficha, modal y página) delega en
  `progressWithRewatch` salvo standby/abandonado: los contadores se
  derivan SIEMPRE de las fechas del ciclo.
- En el modal: `renderSeasonBlock` + `updateSeasonCount` muestran el
  progreso del ciclo en el cabecero de temporada (`seasonCycleCount`),
  `renderEpisodeRows` y `applyEpisodeRowState` marcan cada fila según
  `entrySeenSince(entry, startedAt)` y, al marcar una casilla durante
  un rewatch, un episodio con visiones históricas pero sin vista en el
  ciclo se trata como «Verlo de nuevo» (+1 real, `onEpisodeSeenAgain`)
  — `setEpisodeDate` no incrementaría el contador.

**«Marcar todo»/«Desmarcar todo» de temporada como CHECK CIRCULAR**
(`js/ui.js`, `ocio/ocio.css`): el botón de texto se sustituye por una
casilla con el mismo patrón visual que los episodios
(`.episode-checkbox-wrap` + `:checked ~ .episode-checkbox-visual`).
El estado se deriva de `seasonCompleteTimes` (temporada completa
histórica): **tick si se ha completado 1 vez, número si > 1** (misma
semántica del `data-count` por episodio). El contador del cabecero de
temporada sigue mostrando el ciclo actual; el check, la completitud
histórica (coherente con las casillas de los episodios: para completar
la temporada todos sus episodios deben estar marcados).

**Coherencia del contador de la serie y de «Visionados anteriores»**
(`js/tv-progress.js`, `js/ui.js`):
- `seriesCompleteTimes(watched)` = mínimo de `times` de todos los
  episodios marcados: el nº de veces que la serie está completa según
  los episodios (fuente de verdad). `seasonCompleteTimes` es su versión
  por temporada (0 si algún episodio sin marcar).
- `progressLine` (tarjetas/lista) y el banner de «Has terminado esta
  serie» usan `seriesCompleteTimes` en lugar del `timesCompleted`
  inflado por marcados completos erróneos (fallback `timesCompleted+1`
  solo sin episodios).
- El sumario «Visionados anteriores (N)» de la serie deriva N del mismo
  contador: `max(seriesCompleteTimes, history.length)`, y si los
  episodios indican más visiones completas que las fechadas en el
  historial se añade la línea «N visiones completas más sin fecha
  registrada» (mismo patrón informativo que el desplegable por
  episodio). `history` (ciclos iniciados con «Volver a verla desde el
  principio») sigue mostrando sus fechas `startedAt → finishedAt`.

**FAB de serie en rewatch: icono de «viendo» con color de visto**
(`js/item-page.js`, `css/styles.css`): nueva clase `.item-fab--rewatch`
(icono REPRODUCIR sobre el dúo OCRE del FAB visto, con los mismos
contrastes AA documentados para `.item-fab--seen`, incluidos hover y
override de negro puro). Gana a los estados activos (en curso/
pendiente) pero respeta pausa/abandono; el `aria-label` del toggle pasa
a «viéndose de nuevo».

### 6. Iteración 4 (feedback 2026-08-20)

Cuarta ronda de feedback del usuario en la issue #310 (comentario
2026-08-20T07:12:48Z). Reordena el momento en que un visionado pasa a
«Visualizaciones anteriores» y endurece el reinicio del ciclo:

**El visionado se archiva en «Visionados anteriores» al COMPLETAR la
serie, no al pulsar «Volver a verla desde el principio»**
(`js/tv-progress.js`, `js/modal-handlers.js`, `js/quick-actions.js`):
- `startRewatch` **ya no empuja el visionado anterior a `history`**
  (antes añadía `{ startedAt: firstWatchedAt, finishedAt:
  lastWatchedAt }` en el momento del reinicio, lo que adelantaba el
  registro e inflaba el historial sin que la serie se hubiera
  terminado). Ahora **solo reinicia el ciclo**: `nextEpisode` vuelve a
  T1E1, la serie pasa a **«viendo»** (`status: "en_curso"` — antes
  "pendiente") y se conservan `watched`, contadores, valoraciones y
  `timesCompleted`.
- Nuevo helper `completedViewingChanges(item, newWatched,
  newProgress)`: detecta la transición a `status: "completado"` (item
  aún no estaba completado) y devuelve `{ history, timesCompleted }`
  para persistir. La entrada de `history` usa `startedAt =
  rewatchStartedAt` si era un rewatch, o `firstWatchedAt` en la
  primera completitud; `finishedAt = lastWatchedAt`. `timesCompleted =
  max(acumulado + 1, seriesCompleteTimes)` para no bajar del mínimo de
  veces de los episodios (datos legacy sin contador).
- Se aplica en los tres puntos de persistencia que pueden completar una
  serie: `persistWatched` (modal), `saveTvProgress` y
  `quickMarkTvComplete` (acciones rápidas/FAB). El flujo queda:
  terminar la serie (primera vez o rewatch) → se archiva el visionado
  con sus fechas y el contador de la serie sube; al pulsar «Volver a
  verla» no se archiva nada, solo se reinicia el ciclo.

**Los deshaceres restauran el historial y el contador** (`js/
modal-handlers.js`, `js/quick-actions.js`): si un marcado que COMPLETABA
la serie se deshace (ventana de valoración, issue #136), se restauran
también `history` y `timesCompleted` previos (además de `status`,
`rewatching` y `awaitingRelease`), en el modal (`onSetEpisodeDate`,
`onEpisodeSeenAgain`) y en las acciones rápidas (`quickMarkTv`,
`quickMarkTvComplete`).

**El texto del botón «Volver a verla» ya no promete guardar el
visionado** (`js/ui.js`): el diálogo de confirmación explica que se
empezará un nuevo visionado desde T1E1, que la serie pasará a «viendo»
y que se conservan visualizaciones y valoraciones.

**El auto-standby ignora las series en rewatch** (`js/daily-check.js`):
con `status: "en_curso"` las series en un ciclo de rewatch entraban en
la heurística de inactividad (ADR-033) y podían pasar solas a standby
su siguiente episodio es T1E1 con fecha de emisión antigua por diseño.
`shouldAutoStandby` devuelve `false` si `show.rewatching` está activo.

### 7. Iteración 5 (feedback 2026-08-20)

Quinta ronda de feedback del usuario en la issue #310 (comentario
2026-08-20T08:46:50Z): «No está funcionando el volver a ver una serie
desde el principio. No se reinician los contadores y, en el momento en
que veo el primer episodio, ya se da la serie por terminada.»

**Causa raíz**: la completitud y la pertenencia al ciclo se decidían por
FECHAS (`>= rewatchStartedAt`). Si el ciclo anterior se había completado
el MISMO DÍA en que se iniciaba el rewatch, todos los episodios tenían
fechas de hoy → el primer episodio marcado «completaba» el rewatch al
instante y los contadores no se reiniciaban (la serie ya estaba «vista»
en el ciclo nuevo nada más empezar).

**Decisión: criterio por CONTADOR con baseline por episodio**
(`js/tv-progress.js`, `js/ui.js`), tal como lo definió el propio
usuario: «si una serie se ha visto completa 3 veces y se comienza de
nuevo, los episodios parten de esas 3 visualizaciones; hasta que no
tengan 4 no se consideran vistos en esta revisualización»:
- `startRewatch` persiste además **`rewatchBaseline`**: mapa
  `{ temporada: { episodio: veces } }` con las veces que tenía cada
  episodio **al iniciar el ciclo** (`buildRewatchBaseline`; los
  episodios sin marcar no aparecen → baseline 0, la primera visión del
  ciclo ya les cuenta).
- Nuevo helper `episodeBaseline(baselineMap, seasonNumber,
  episodeNumber)`: veces al iniciar el ciclo; `0` si el episodio no
  estaba marcado entonces; `null` sin mapa (sin rewatch → cualquier
  episodio marcado cuenta, comportamiento previo).
- Nuevo helper `entrySeenInCycle(entry, baseline)`: «visto en el ciclo»
  ⇔ `times > baseline`. Es robusto frente a fechas del mismo día y a
  datos legacy con contadores inflados.
- `isRewatchComplete` y `progressWithRewatch` reciben `baselineMap`
  (`item.rewatchBaseline`) y lo aplican como criterio PRIORITARIO de
  completitud y de pertenencia al ciclo (`totalWatched`/`nextEpisode`).
  **Fallback** para ciclos en vuelo iniciados por versiones anteriores
  (sin `rewatchBaseline`): criterio por fechas (`rewatchStartedAt`) de
  la iteración 2, y por contador con `minTimes` para los ciclos legacy
  de la iteración 1 (sin `rewatchStartedAt`).
- UI coherente en todo el modal (siempre con fallback por fechas para
  ciclos en vuelo): `applyEpisodeRowState`, `seasonCycleCount`,
  `renderSeasonBlock`, `renderEpisodeRows`, `updateSeasonCount` y la
  detección de «episodio visto» en el checkbox del episodio usan
  `episodeBaseline` + `entrySeenInCycle` cuando hay `cycleBaseline`.

Con esto, al reiniciar una serie completada hoy: contadores a **0/N**
(al empezar) y **1/N** tras ver el primer episodio (no «completado»);
el ciclo se completa solo cuando TODOS los episodios superan su
baseline (N+1 visualizaciones).

### 8. Iteración 6 (resume workflow_dispatch 2026-08-20)

Sexta ronda: reanudación manual del flujo SDD (workflow_dispatch) para
re-analizar, re-validar y re-publicar la PR #313 tras el feedback de la
iteración 5. Cambios de esta iteración:

- **Integración de `feat/issue-201`**: la PR #313 se había quedado en
  CONFLICTING porque la rama base avanzó con la issue #311 (lista de
  premios completa, PR #312). Se integró `feat/issue-201` en la rama de
  la PR (merge `9ade5e1`) resolviendo los conflictos de versión
  (`js/config.js`, `service-worker.js`, `index.html`: se conserva la
  versión más alta de la rama de #310) sin tocar la lógica de rewatch.
- **Renumeración ADR-111 → ADR-112**: el ADR-111 quedó ocupado en
  `feat/issue-201` por la documentación de la issue #311 (lista de
  premios completa). Este ADR se renumeró a **ADR-112** para evitar dos
  ADR-111 al fusionar la PR #313 (un número de ADR por documento).
- **Re-validación QA**: 38/38 checks de simulación re-ejecutados sobre
  la lógica de rewatch (escenarios A-H: baseline por episodio, el bug
  «no se reinicia / se completa al primer episodio» sigue corregido,
  archive al completar, desmarcar última visión, marcar/desmarcar todo
  por temporada, progreso del ciclo actual, fallback por fechas para
  ciclos en vuelo y legacy con contadores inflados).
- Versión PWA bumped a `20261009`.

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
- **Registrar el visionado en `history` al pulsar «Volver a verla»**
  (comportamiento anterior a la iteración 4): adelantaba el archive y
  añadía una entrada por cada reinicio aunque la serie volviera a
  terminarse; el usuario pide que el archivo ocurra **cuando la serie
  se termina**, no antes (comentario 2026-08-20T07:12:48Z).

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
- **Iteración 4**: `history` refleja solo visionados **terminados de
  verdad** (fechas coherentes con los episodios); «Volver a verla»
  reinicia sin efectos secundarios en el historial; el contador
  «Completa · ×N» de la lista vuelve a coincidir con las fechas del
  desplegable.

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
- **Iteración 4**: las series ya completadas antes de esta iteración no
  reciben entradas retroactivas en `history` (siguen cubiertas por la
  línea «N visiones completas más sin fecha registrada»); el feed de
  actividad deja de emitir el evento «Empezó (de nuevo) la serie» al
  reiniciar (las entradas de `history` solo se crean ya terminadas, con
  `finishedAt`).
- Versión PWA bumped a `20261004` (la iteración se publica sobre la
  `20261003` de la primera implementación de #310; se evita colisión
  de precache y de las versiones en vuelo de otras ramas). La
  iteración 3 la sube a `20261006` (la `20261005` la consumió la
  iteración 2) y la iteración 4 a `20261007`.
- **Iteración 5**: los ciclos de rewatch iniciados **con la versión
  nueva** se deciden por contador contra su baseline. Los ciclos **en
  vuelo** (iniciados por la iteración 2/3/4, sin `rewatchBaseline`)
  conservan el criterio por fechas hasta que se completen; solo los
  ciclos NUEVOS disfrutan del reinicio real de contadores. Versión PWA
  bumped a `20261008`. La iteración 6 (resume 2026-08-20) la sube a
  `20261009`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/tv-progress.js` | **Modificado**: `startRewatch` conserva `watched` y marca `rewatching: true`; `normalizeEntry`/`entryDates` siempre derivan `dates` (legacy `[date]`); `setEpisodeDate`, `setEpisodeRating`, `setSeasonWatched`, `markEpisodeSeenAgain` mantienen/acumulan `dates`; `setSeasonWatched` (allWatched) suma +1 a los ya vistos en rewatch; nuevos `isRewatchComplete`, `progressWithRewatch` y `removeLastEpisodeViewing` (quita solo la última visión; iteración #310). **Iteración 2 (feedback 2026-08-19)**: `setSeasonWatched` aplica «Marcar/Desmarcar todo» con la semántica del episodio individual por episodio (`lastViewingRemovedEntry` compartido con `removeLastEpisodeViewing`; «Desmarcar todo» ya no vacía la temporada); `startRewatch` persiste `rewatchStartedAt` y eleva `timesCompleted` al máximo entre contador y veces por episodio (datos legacy); `isRewatchComplete` pasa a decidir por fechas `>= rewatchStartedAt` con fallback por contador para ciclos en vuelo sin el campo. **Iteración 3 (feedback 2026-08-20)**: nuevos `entrySeenSince` (visión en el ciclo `>= startedAt`), `seasonCompleteTimes` y `seriesCompleteTimes` (mínimo de `times` de los episodios: completitud de temporada/serie según los episodios, 0 si algún episodio sin marcar); `progressWithRewatch` cuenta `totalWatched` y `nextEpisode` del ciclo actual con `startedAt` y devuelve `status: "en_curso"` («viendo») en lugar de «pendiente». **Iteración 4 (feedback 2026-08-20)**: `startRewatch` deja de archivar el visionado en `history` y pasa a `status: "en_curso"` («viendo») al reiniciar; nuevo `completedViewingChanges` (registra el visionado y eleva `timesCompleted` al COMPLETAR la serie: `startedAt = rewatchStartedAt` si era rewatch, si no `firstWatchedAt`). **Iteración 5 (feedback 2026-08-20)**: `startRewatch` persiste también `rewatchBaseline` (`buildRewatchBaseline`: veces por episodio al iniciar el ciclo); nuevos `episodeBaseline` y `entrySeenInCycle` (criterio por CONTADOR: «visto en el ciclo» ⇔ `times > baseline`); `isRewatchComplete` y `progressWithRewatch` reciben `baselineMap` como criterio prioritario con fallback por fechas (`rewatchStartedAt`) para ciclos en vuelo sin baseline — un rewatch iniciado el mismo día en que se completó el ciclo anterior ya no se da por terminado al ver el primer episodio |
| `js/modal-handlers.js` | **Modificado**: `progressWithStatus` respeta el flag `rewatching` (pendiente + nextEpisode T1E1); `persistWatched` usa `progressWithRewatch` y persiste/limpia el flag; callback `onRemoveLastViewing` (iteración #310). **Iteración 2 (feedback 2026-08-19)**: `onEpisodeSeenAgain` (renombrado desde `onSetEpisodeSeenAgain`) persiste el +1 y abre la ventana de valoración con la **valoración anterior por defecto** (`initialRating`); «Deshacer» revierte el +1 vía `removeLastEpisodeViewing` y restaura `awaitingRelease`/`status`/`rewatching` (sin «completado» fantasma con `progressWithRewatch`). **Iteración 3 (feedback 2026-08-20)**: `progressWithStatus` delega en `progressWithRewatch` (progreso por ciclo) salvo standby/abandonado. **Iteración 4 (feedback 2026-08-20)**: `persistWatched` aplica `completedViewingChanges` (archiva el visionado al completar la serie); los deshaceres de `onSetEpisodeDate` y `onEpisodeSeenAgain` restauran `history`/`timesCompleted` previos |
| `js/quick-actions.js` | **Modificado**: `saveTvProgress`, `quickMarkTv` (rewatch → `markEpisodeSeenAgain`), `quickUnwatchTv` (iteración #310 → `removeLastEpisodeViewing`), `quickMarkTvComplete` y sus deshaceres usan los nuevos helpers y restauran `rewatching`. **Iteración 4 (feedback 2026-08-20)**: `saveTvProgress` y `quickMarkTvComplete` aplican `completedViewingChanges` (archivan el visionado al completar la serie); los deshaceres de `quickMarkTv` y `quickMarkTvComplete` restauran `history`/`timesCompleted` previos |
| `js/ui.js` | **Modificado**: `episodeAverageBadgeHtml` (chip, id fijo `item-episode-average`) en hero (tv con valoración propia) y modal clásico; `renderEpisodeRows` sin input de fecha + botón `episode-rewatches` (chevron + label con contador; iteración #310) y bloque `episode-rewatches__dates` (toggle aria-expanded); `rewatchesListHtml` con línea informativa legacy; `applyEpisodeRowState`/`wireEpisodeRows` rellenan y repliegan el desplegable; rama «unmarked» → `onRemoveLastViewing`. **Iteración 2 (feedback 2026-08-19)**: rama «seen_again» → `onEpisodeSeenAgain` (espera a la ventana de valoración con la valoración previa); el contador de temporada tras «Marcar/Desmarcar todo» se deriva de `item.watched` (etiqueta fiel tras desmarcar con varias visiones). **Iteración 3 (feedback 2026-08-20)**: `renderSeasonBlock`/`updateSeasonCount`/`seasonCycleCount` (progreso del ciclo en el cabecero de temporada) y «Marcar todo» como **check circular** con `seasonCompleteTimes` (tick si 1, número si > 1; `applySeasonMarkAllState`); filas y `applyEpisodeRowState` según `entrySeenSince` con `cycleStartedAt`; marcar una casilla con visiones históricas en rewatch → `onEpisodeSeenAgain` (+1); `progressLine` y banner «Has terminado esta serie» con `seriesCompleteTimes` (sin `timesCompleted` inflado); sumario «Visionados anteriores (N)» de la serie coherente con los episodios (línea «N visiones completas más sin fecha registrada» si procede). **Iteración 4 (feedback 2026-08-20)**: texto del diálogo «Volver a verla desde el principio» (reinicio desde T1E1 a «viendo», sin prometer archivo en el historial); comentario del sumario actualizado a la nueva semántica de `history` (visionados completados). **Iteración 5 (feedback 2026-08-20)**: `applyEpisodeRowState`, `seasonCycleCount`, `renderSeasonBlock`, `renderEpisodeRows`, `updateSeasonCount` y la detección de «episodio visto» del checkbox usan `episodeBaseline` + `entrySeenInCycle` con `cycleBaseline` (criterio por contador del ciclo) y `cycleStartedAt` como fallback por fechas para ciclos en vuelo sin baseline (import de `entrySeenInCycle`/`episodeBaseline` junto a `entrySeenSince`) |
| `js/episode-actions-modal.js` | **Modificado** (iteración #310): etiqueta «Quitar última visualización» si `times > 1`, «Desmarcar» si `times === 1` |
| `js/item-page.js` | **Modificado** (iteración 3, feedback 2026-08-20): `renderFab` con estado propio `.item-fab--rewatch` (icono REPRODUCIR con color de VISTO ocre — «el estado de hecho debería ser viendo pero pon el color de visto»; respeta pausa/abandono; aria-label «viéndose de nuevo»); `setTvStatus` usa `progressWithRewatch` al retomar un rewatch (sin «completado» fantasma) |
| `js/daily-check.js` | **Modificado** (iteración 4, feedback 2026-08-20): `shouldAutoStandby` ignora las series en rewatch (`rewatching: true`) — su siguiente episodio es T1E1 con fecha antigua por diseño y el ritmo lo marca el usuario |
| `ocio/ocio.css` | **Modificado**: bloque `.item-episode-average` (chip, `[hidden]` forzado) e `.episode-rewatches`/`__chevron`/`__dates`/`__list`/`__unknown` (botón con chevron rotatorio y área táctil 32px; iteración #310); overrides `[data-theme="dark"]` (tinta suave #6b6355 sobre superficies de papel, strong papel en item-view) y `[data-theme="black"]` (botón completo → `--paper`, hover/focus, strong chip); eliminadas las referencias a `.episode-date`/`.episode-average` de la media query móvil y de los bloques de tema. **Iteración 2 (feedback 2026-08-19)**: `.episode-rewatches` **sin subrayado en hover/pulso** (el foco de teclado se indica solo con outline; motivo documentado en comentario del CSS). **Iteración 3 (feedback 2026-08-20)**: `.season-mark-all` como label del check circular (reutiliza `.episode-checkbox-wrap`), foco visible con `:has(input:focus-visible)` sobre `.episode-checkbox-visual` |
| `css/styles.css` | **Modificado**: override `[data-theme="dark"] .item-view` pasa de `.episode-average strong` a `.item-episode-average strong` (color papel sobre el fondo oscuro de la página). **Iteración 3 (feedback 2026-08-20)**: `.item-fab--rewatch` (dúo ocre de `.item-fab--seen` con hover y override de negro puro; la familia clara lo excluye del selector agrupado base) |
| `docs/manual-de-usuario.md` | **Modificado**: §4.3 (fechas por episodio ocultas tras «Visionados anteriores»; «Quitar última visualización» vs «Desmarcar»), §4.5 (el rewatch conserva los episodios y suma contadores), §4.7 y §12 (desmarcado del último episodio con varias visiones), §12 (chip de media en el hero de series) y §13 (media de episodios en la parte superior, estilo chip; FAQ desmarcar episodios). **Iteración 2 (feedback 2026-08-19)**: §4.3 («Marcar todo» añade una visualización a cada episodio; «Desmarcar todo» quita la última de cada uno —los vistos varias veces siguen marcados—; al «Lo he visto de nuevo» la ventana de valoración trae la valoración anterior por defecto y «Deshacer» revierte el visionado recién añadido) y §4.5 (la visualización termina al volver a ver TODOS los episodios; las visiones antiguas no cuentan). **Iteración 3 (feedback 2026-08-20)**: §4.3 («Marcar todo» pasa a ser un check circular con contador y el progreso de temporada muestra el ciclo actual durante un rewatch), §4.5 (los contadores de la serie y «Visionados anteriores» se derivan de los episodios), §4.6 (coherencia del contador de la serie con los episodios) y §12.1 (FAB del rewatch: icono de «viendo» con color de visto). **Iteración 4 (feedback 2026-08-20)**: §4.5 («Volver a verla» reinicia el ciclo desde T1E1 pasando a «viendo» sin archivar nada; el visionado se archiva al terminar la serie) y §4.6 (cada visionado se registra con sus fechas cuando la serie se termina). **Iteración 5 (feedback 2026-08-20)**: §4.5 (al reiniciar, los contadores del ciclo vuelven a 0 y el episodio cuenta como visto en el nuevo visionado solo cuando supera las veces que tenía al empezar —«hasta que no tengan N+1 no se consideran vistos en esta revisualización»—; ya no se da la serie por terminada al ver el primer episodio) |
| `docs/adr-112-revisualizacion-temporadas-episodios.md` | **Nuevo**: este documento (incluye la iteración por feedback de #310 y la subsección «Iteración 2 (feedback 2026-08-19)» con las 4 decisiones de la segunda ronda). **Iteración 6 (resume workflow_dispatch 2026-08-20)**: renumerado de ADR-111 a ADR-112 porque el ADR-111 quedó ocupado en `feat/issue-201` por la issue #311 (lista de premios completa, PR #312) — dos ADR-111 colisionarían al fusionar la PR #313; Documentado también el bump PWA `20261009` |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificados**: bump de versión PWA a `20261003` (primera implementación), `20261004` (iteración por feedback), `20261006` (iteración 3), `20261007` (iteración 4), `20261008` (iteración 5) y `20261009` (iteración 6) |
| `tasks/task-issue-310.json` | Task file de la tarea |

Related issue: #310 — https://github.com/gonzalitojh/Registro-personal/issues/310