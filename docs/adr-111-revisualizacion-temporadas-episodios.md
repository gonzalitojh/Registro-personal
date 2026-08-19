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
  - `setSeasonWatched(allWatched)`: los episodios **ya vistos** que
    pasan por «Marcar todo» en pleno rewatch **incrementan `times` y
    añaden fecha** en lugar de quedar igual (el flag `rewatching` del
    ítem lo decide vía `progressWithRewatch`).
  - `isRewatchComplete(seasonsMeta, watched)` y
    `progressWithRewatch(seasonsMeta, item, newWatched)`: mientras el
    ítem esté en `rewatching: true`, la serie **no se considera
    completa** y `nextEpisode` vuelve a T1E1 al llegar al final; al
    completar el rewatch (todos los episodios con `times ≥ 2` cuando el
    mínimo lo pide) se **limpia el flag**.
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
- Botón/lista de fechas: misma tipografía mono que antes,
  `--ink-soft`/`--paper` con overrides por familia; el **hover** del
  botón subraya y oscurece.

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
- El desplegable es **toggle local**: cualquier repintado derivado del
  estado (marcar/desmarcar/valorar) lo repliega (coherente con el
  patrón #136; el contenido siempre deriva de `item.watched`).
- `strings` legacy en `watched` (formato string por episodio) se
  conservan en el read (normalize) sin reescribirse en Firestore salvo
  que el episodio se vuelva a tocar.
- Versión PWA bumped a `20261003` (la base feat/issue-201 usa
  `20261002` de la issue #308; se evita colisión de precache y de las
  versiones en vuelo de otras ramas).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/tv-progress.js` | **Modificado**: `startRewatch` conserva `watched` y marca `rewatching: true`; `normalizeEntry`/`entryDates` siempre derivan `dates` (legacy `[date]`); `setEpisodeDate`, `setEpisodeRating`, `setSeasonWatched`, `markEpisodeSeenAgain` mantienen/acumulan `dates`; `setSeasonWatched` (allWatched) suma +1 a los ya vistos en rewatch; nuevos `isRewatchComplete` y `progressWithRewatch` |
| `js/modal-handlers.js` | **Modificado**: `progressWithStatus` respeta el flag `rewatching` (pendiente + nextEpisode T1E1); `persistWatched` usa `progressWithRewatch` y persiste/limpia el flag |
| `js/quick-actions.js` | **Modificado**: `saveTvProgress`, `quickMarkTv` (rewatch → `markEpisodeSeenAgain`), `quickUnwatchTv`, `quickMarkTvComplete` y sus deshaceres usan los nuevos helpers y restauran `rewatching` |
| `js/ui.js` | **Modificado**: `episodeAverageBadgeHtml` (chip, id fijo `item-episode-average`) en hero (tv con valoración propia) y modal clásico; `renderEpisodeRows` sin input de fecha + botón `episode-rewatches` y bloque `episode-rewatches__dates` (toggle aria-expanded); `applyEpisodeRowState`/`wireEpisodeRows` rellenan y repliegan el desplegable |
| `ocio/ocio.css` | **Modificado**: bloque `.item-episode-average` (chip, `[hidden]` forzado) e `.episode-rewatches`/`__dates`/`__list` (botón y lista de fechas, área táctil 32px); overrides `[data-theme="dark"]` (tinta suave #6b6355 sobre superficies de papel, strong papel en item-view) y `[data-theme="black"]` (hover botón, strong chip); eliminadas las referencias a `.episode-date`/`.episode-average` de la media query móvil y de los bloques de tema |
| `css/styles.css` | **Modificado**: override `[data-theme="dark"] .item-view` pasa de `.episode-average strong` a `.item-episode-average strong` (color papel sobre el fondo oscuro de la página) |
| `docs/manual-de-usuario.md` | **Modificado**: §4.3 (fechas por episodio ocultas tras «Visionados anteriores»), §4.5 (el rewatch conserva los episodios y suma contadores), §12 (chip de media en el hero de series) y §13 (media de episodios en la parte superior, estilo chip) |
| `docs/adr-111-revisualizacion-temporadas-episodios.md` | **Nuevo**: este documento |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificados**: bump de versión PWA a `20261003` |
| `tasks/task-issue-310.json` | Task file de la tarea |

Related issue: #310 — https://github.com/gonzalitojh/Registro-personal/issues/310