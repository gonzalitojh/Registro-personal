# ADR-024: Tratamiento uniforme de ítems no estrenados en todos los niveles: rayas, relegación y badge unificados (issue #27, 2ª reapertura)

## Estado
Aceptado

## Fecha
Agosto 2026

**Nota (actualizada por ADR-025, 3ª reapertura):** la fase de confirmación TV en `release.js` que la "Decisión notable" de abajo descartó por el ciclo de imports ES modules quedó **implementada** en la 3ª reapertura de la issue #27: `unreleasedConfirmMessage(item, airInfo = null)` recibe `getNextEpisodeAirInfo` como **parámetro inyectado** desde el consumidor (`quick-actions.js`), de modo que `release.js` sigue importando solo `dates.js` y el ciclo se evita sin mover dependencias. Además, la historia de fuentes se extiende: el nuevo campo persistido `seasonAirDates` (mapa temporada → `air_date`, donde `null` = temporada sin estrenar, refrescado a diario y al abrir el modal) pasa a ser la **2ª fuente** en la precedencia de `getNextEpisodeAirInfo` (toAir > season > stored), por delante del backfill `nextEpisodeAirDate`; y `ensureNextEpisodeAirDate` y el bloque `releasedNoticedAt` de este ADR propagan el mapa fresco en sus spreads. Ver [adr-025-season-air-dates.md](adr-025-season-air-dates.md).

## Contexto

La issue #27 (2ª reapertura) pedía que el tratamiento de "no estrenado" sea **uniforme en todos los niveles**: un ítem sin fecha de estreno debe tratarse exactamente igual que uno con fecha futura — mismo estilo de rayas en tarjeta y lista, misma relegación al final en la ordenación por actividad y misma etiqueta "Aún no estrenado/a".

Los fixes previos de la issue (ADR-020 / PR #33 y ADR-023 / PR #36) habían centralizado la lógica de confirmación y el badge de episodios, pero el tratamiento **visual y de ordenación** seguía siendo por tipo, con estas lagunas:

1. **Las rayas solo se aplicaban a series**: `renderGrid`/`renderList` usaban `isNextEpisodeUnreleased(item)`; las películas con `awaitingRelease` (sin fecha o con fecha futura) no recibían el estilo de rayas.
2. **La ordenación por actividad solo relegaba series**: `compareByActivityDesc` usaba el mismo predicado por tipo, de modo que una película no estrenada no iba al final de la lista.
3. **Serie entre temporadas sin dato persistido**: si `nextEpisodeAirDate` aún no se había guardado (ni expansión de temporada ni backfill con `next_episode_to_air` presente), la serie no mostraba etiqueta, rayas ni relegación, porque `getNextEpisodeAirInfo` no encontraba fuente.
4. **El badge de película no tenía clase CSS de rayas**: `item-card__upcoming--episode` solo cubría el caso de episodio; el badge de película con `awaitingRelease` usaba la clase genérica sin estilo distintivo de rayas.

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27

## Decisión

Unificar el criterio "no estrenado" en un único predicado (`isItemUnreleased`) consumido por la tarjeta, la lista, el badge y la ordenación, con clases CSS renombradas a un solo sufijo `--unreleased` (mismo gradiente de rayas), más un backfill diario que cierra el hueco de las series entre temporadas sin dato persistido y una limpieza idempotente de `awaitingRelease` al marcar como visto.

### 1. Predicado unificado `isItemUnreleased` (`js/sorting.js`)

Nuevo predicado que decide "sin estrenar" para cualquier ítem:

- **Manual** ⇒ `false` (las series manuales no tienen fechas reales de TMDB; se mantiene la exclusión histórica de ADR-020).
- **Película** ⇒ `!(item.watchLog && item.watchLog.length) && isUnreleasedDate(item.releaseDate)` — sin fecha o fecha futura y no vista.
- **Serie** ⇒ sin `nextEpisode` ⇒ `false` (completada, nunca "sin estrenar"); si no, `item.awaitingRelease === true || isNextEpisodeUnreleased(item)` — cubre tanto la premiere sin estrenar como la serie en curso con el próximo episodio sin estrenar.

`compareByActivityDesc` pasa a usar `isItemUnreleased` (antes `isNextEpisodeUnreleased`), de modo que **todos** los ítems no estrenados —películas incluidas— se relegan al final. `isNextEpisodeUnreleased` se conserva: `isItemUnreleased` la usa internamente y `daily-check.js` la sigue usando para `wasEpisodeBlocked`.

### 2. Clases CSS unificadas en `renderGrid`/`renderList` y `upcomingBadge` (`js/ui.js`)

- `renderGrid`/`renderList` aplican `item-card--unreleased` / `list-row--unreleased` vía `isItemUnreleased` (antes `item-card--episode-unreleased` / `list-row--episode-unreleased` vía `isNextEpisodeUnreleased`). Las películas no estrenadas reciben por fin las rayas.
- `upcomingBadge` se reescribe con un **guard único** (`if (!isItemUnreleased(item)) return "";`) y una **clase unificada** `item-card__upcoming item-card__upcoming--unreleased` para los tres casos:
  - **Película**: «Aún no estrenada» (+ fecha si existe).
  - **Serie premiere sin estrenar** (`awaitingRelease && nextEpisode`): «Aún no estrenada» (+ `firstAirDate` si existe).
  - **Serie en curso** con el próximo episodio sin estrenar: «Aún no estrenado · TSE» (+ fecha si existe), con **guard de seguridad**: si `getNextEpisodeAirInfo` devuelve `null` no se pinta el badge (en la práctica `isItemUnreleased` ya garantiza que hay info).

### 3. Renombrado de clases en `ocio/ocio.css` (mismo gradiente)

- `.item-card--episode-unreleased` → `.item-card--unreleased`
- `.list-row--episode-unreleased` → `.list-row--unreleased`
- `.item-card__upcoming--episode` → `.item-card__upcoming--unreleased`

El gradiente de rayas (`repeating-linear-gradient` entre los colores de "Viendo" y "Abandonada") es idéntico al anterior; solo cambia el alcance del selector (ahora cubre películas y series por igual). Comentarios actualizados.

### 4. Backfill diario `ensureNextEpisodeAirDate` (`js/daily-check.js`)

Nuevo helper que rellena `updates.nextEpisodeAirDate` cuando **ni** `nextEpisodeToAir` **ni** el dato guardado coinciden con el siguiente episodio del usuario (serie entre temporadas, caso ADR-023 con dato aún sin persistir):

- `show.manual || !show.nextEpisode` ⇒ `null` (no aplica).
- Si `getNextEpisodeAirInfo({ ...show, nextEpisodeToAir: fresh.nextEpisodeToAir })` ya resuelve, ⇒ `null` (ya hay fuente).
- Si no, consulta `getSeasonEpisodes(show.externalId, show.nextEpisode.season)`, busca el episodio por `episodeNumber` y devuelve `{ season, episode, airDate: ep ? ep.airDate : null }` (airDate `null` = «sin fecha oficial»).
- **Fail-open**: si la consulta falla, registra en consola y devuelve `null`; **no aborta la pasada ni incrementa `consecutiveFailures`** (a diferencia del resto de la pasada, que aborta por fallos encadenados según ADR-021).

`checkForUpdates` la invoca por cada serie (con `getSeasonEpisodes` del `ctx`) y, si devuelve algo, lo añade a `updates.nextEpisodeAirDate`. Es la **cuarta vía de escritura** de `nextEpisodeAirDate` (ADR-023 documentaba tres: `quickMarkTv`, `buildTvUpdates` y la expansión de temporada del modal).

### 5. Limpieza idempotente de `awaitingRelease` al marcar como visto (`js/modal-handlers.js`, `js/quick-actions.js`)

Los **4 caminos de marcado como visto** limpian ahora `awaitingRelease: false` —tanto en el payload de Firestore como en el objeto en memoria— de forma idempotente: un ítem ya visto no puede seguir "sin estrenar".

- `persist` (modal de película, `js/modal-handlers.js`).
- `persistWatched` (modal de serie, `js/modal-handlers.js`).
- `quickMarkMovie` (`js/quick-actions.js`).
- `saveTvProgress` (`js/quick-actions.js`, usado por `quickMarkTv` y el marcado de episodio).

### Decisión notable: fase de confirmación TV en `release.js` NO aplicada

Se evaluó ampliar `release.js` con un mensaje de confirmación TV basado en `getNextEpisodeAirInfo` (que unificaría el aviso de "no estrenado" también para series entre temporadas). **No se aplicó**: `release.js` es importado por `sorting.js` (que consume `isUnreleasedDate`), y la importación inversa (`release.js` → `sorting.js` para `getNextEpisodeAirInfo`) crearía un **ciclo de imports ES modules**. Sin impacto funcional: el caso `next_episode_to_air = null` en confirmaciones ya está cubierto por el PR #36 (backfill de `nextEpisodeAirDate` en `daily-check.js` + confirmaciones por episodio vía `episodeUnreleasedMessage` en la acción rápida, el checkbox individual y "Marcar todo").

## Alternativas descartadas

- **Mantener predicados por tipo (`isNextEpisodeUnreleased` para series + `awaitingRelease` para películas) y solo añadir rayas a películas**: descartado por tener dos fuentes de verdad con riesgo de divergencia entre tarjeta, lista, badge y ordenación; la issue pedía explícitamente tratamiento "todo igual".
- **Badge por tipo (clase distinta para película, premiere y episodio)**: descartado: la clase unificada `item-card__upcoming--unreleased` reduce CSS y garantiza el mismo aspecto para los tres casos (requisito de la 2ª reapertura).
- **Consulta síncrona de temporada en la UI** (`getSeasonEpisodes` en el render para conocer la fecha del siguiente episodio de series entre temporadas): descartado: bloquearía el render, añadiría llamadas a TMDB por cada renderizado y complicaría la caché; el backfill diario (`ensureNextEpisodeAirDate`) cubre el caso de forma asíncrona y fail-open.
- **Fase de confirmación TV en `release.js` vía `getNextEpisodeAirInfo`**: descartado por el ciclo de imports ES modules descrito en la Decisión.
- **Conservar los nombres antiguos de clases como alias**: descartado: las clases CSS son internas (sin consumidores externos) y el sufijo `--episode` ya no describe el alcance (ahora cubre cualquier ítem).

## Consecuencias

### Positivas
- **Uniformidad en todos los niveles**: rayas, relegación al final y badge idénticos para ítems sin fecha y con fecha futura, en películas, premieres de serie y series en curso.
- **Fuente única de verdad**: `isItemUnreleased` lo consumen `renderGrid`, `renderList`, `upcomingBadge` y `compareByActivityDesc`; no hay lógica "no estrenado" por tipo duplicada en la UI.
- **Las películas no estrenadas ya son visibles**: reciben rayas, van al final y muestran el badge (lagunas 1 y 2 del Contexto cerradas).
- **Series entre temporadas sin dato persistido quedan cubiertas**: el backfill diario rellena `nextEpisodeAirDate` en la siguiente pasada (laguna 3 cerrada), sin bloquear el render.
- **`awaitingRelease` se limpia siempre al marcar como visto** en los 4 caminos (payload + memoria): un ítem visto no puede quedarse "sin estrenar" aunque la pasada diaria no haya llegado aún.
- **QA aprobado**: 6/6 criterios de aceptación y 20/20 casos borde; hallazgos LOW no bloqueantes documentados a continuación.

### Negativas
- **Cambio visual para películas con `awaitingRelease`**: las películas sin fecha o con fecha futura muestran ahora las rayas (antes solo las series); es el comportamiento pedido, pero altera la apariencia previa.
- **Una llamada TMDB adicional por serie en la pasada diaria** cuando ni `nextEpisodeToAir` ni el dato guardado coinciden con el siguiente episodio; mitigada por la caché en memoria de 24 h de `getSeasonEpisodes` (ADR-022).
- **Hallazgos LOW (no bloqueantes, documentados en el QA)**:
  - *Serie premiere sin `nextEpisode`* (el usuario no ha visto ningún episodio): `isItemUnreleased` devuelve `false` (guard `!item.nextEpisode`) y la serie no recibe rayas ni relegación; aceptado porque no hay episodio concreto que proteger y el guard evita falsos positivos en series completadas.
  - *Pref `series_premiere` desactivado*: el bloque de la pasada diaria que limpia `awaitingRelease` al estrenarse la premiere está condicionado al pref (`prefs.series_premiere !== false`), de modo que con el pref desactivado el flag puede persistir transitoriamente en una serie ya estrenada (que seguirá con rayas) hasta que el usuario marque el primer episodio como visto, momento en que la limpieza idempotente del punto 5 la quita.

### Neutras
- **`isNextEpisodeUnreleased` mantiene su contrato**: sigue en `sorting.js`, la consume `isItemUnreleased` internamente y `daily-check.js` la usa para `wasEpisodeBlocked`; el renombrado solo afecta al predicado de cara a la UI.
- **El renombrado de clases CSS es interno**: no hay consumidores externos (el resto de selectores referenciados en HTML son los genéricos `item-card__upcoming`, etc., que no cambian).
- **Sin cambios en `service-worker.js`**: no se crean módulos nuevos; los archivos tocados (`sorting.js`, `ui.js`, `daily-check.js`, `modal-handlers.js`, `quick-actions.js`) ya están precacheados (ADR-019).
- **`ensureNextEpisodeAirDate` es fail-open por diseño**: un fallo de red no aborta la pasada (a diferencia del aborto por `MAX_CONSECUTIVE_FAILURES` de ADR-021) ni incrementa el contador de fallos.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/sorting.js` | **Nuevo** `isItemUnreleased(item)`: predicado unificado (manual→`false`; película: no vista y `isUnreleasedDate(releaseDate)`; serie: `awaitingRelease === true \|\| isNextEpisodeUnreleased(item)`, `false` sin `nextEpisode`); `compareByActivityDesc` lo usa para relegar al final |
| `js/ui.js` | `renderGrid`/`renderList`: clases `item-card--unreleased`/`list-row--unreleased` vía `isItemUnreleased`; `upcomingBadge` reescrito con guard único, clase unificada `item-card__upcoming--unreleased` y guard de seguridad si `getNextEpisodeAirInfo` devuelve `null` |
| `ocio/ocio.css` | Renombrado de clases (`.item-card--episode-unreleased`→`.item-card--unreleased`, `.list-row--episode-unreleased`→`.list-row--unreleased`, `.item-card__upcoming--episode`→`.item-card__upcoming--unreleased`) con el mismo gradiente de rayas; comentarios actualizados |
| `js/daily-check.js` | **Nuevo** `ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes)`: backfill de `nextEpisodeAirDate` cuando ni `nextEpisodeToAir` ni el dato guardado coinciden (fail-open, sin abortar la pasada ni tocar `consecutiveFailures`); `checkForUpdates` la invoca por serie y añade el resultado a `updates` |
| `js/modal-handlers.js` | `persist` (película) y `persistWatched` (serie): limpieza idempotente `awaitingRelease: false` en el payload de Firestore y en el objeto en memoria |
| `js/quick-actions.js` | `quickMarkMovie` y `saveTvProgress`: limpieza idempotente `awaitingRelease: false` en el payload de Firestore y en el objeto en memoria |
| `docs/adr-024-unreleased-uniform-treatment.md` | **Nuevo**: este documento |

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27
