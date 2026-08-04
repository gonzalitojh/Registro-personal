# ADR-020: Ítems sin fecha de estreno se tratan como no estrenados (fix issue #27)

## Estado
Aceptado

## Fecha
Agosto 2026

**Nota (alcance ampliado por ADR-023):** este documento describe el fix original de la issue #27 (PR #33). Tras la reapertura de la issue —caso `next_episode_to_air = null` en series entre temporadas sin fecha anunciada (p. ej. «Dune: La Profecía» T2)—, el alcance aquí definido queda **ampliado/supersedido** por el [ADR-023](adr-023-episode-unreleased-no-date.md): los checkboxes de episodios individuales, el botón "Marcar todo" de temporada y el badge cuando TMDB no devuelve `next_episode_to_air` ahora SÍ están cubiertos.

**Nota (clases CSS renombradas y tratamiento uniforme por ADR-024):** tras la 2ª reapertura de la issue #27 (tratamiento uniforme en todos los niveles: rayas, relegación al final y badge "Aún no estrenado/a" iguales para ítems sin fecha y con fecha futura), las clases CSS citadas en la sección 4 (`item-card--episode-unreleased` / `list-row--episode-unreleased`) se renombraron a `item-card--unreleased` / `list-row--unreleased`, y el tratamiento visual y de ordenación pasa a cubrir **cualquier** ítem no estrenado —películas incluidas— vía el predicado unificado `isItemUnreleased`, no solo series con episodio sin estrenar. Ver [adr-024-unreleased-uniform-treatment.md](adr-024-unreleased-uniform-treatment.md).

## Contexto

TMDB devuelve la fecha de estreno vacía para películas/episodios sin fecha oficial, y `js/api-movies.js` la normaliza a `null` (`releaseDate: data.release_date || null`). El frontend controlaba el caso de "no estrenado" con el patrón `if (fecha && fecha > todayISO())` en todos los puntos de marcado como visto: al ser `null` falsy, un ítem sin fecha se consideraba **ya estrenado** y podía marcarse como visto **sin ningún aviso**, aunque en realidad no se sabía si había salido.

La issue #27 establece el criterio: **sin fecha de estreno ⇒ se supone que el ítem NO está estrenado** ⇒ mismo tratamiento que una fecha futura (no se puede marcar como visto sin confirmación).

Los puntos afectados eran: el alta de ítems (flag `awaitingRelease`), el marcado como visto (modal de película y acciones rápidas), el badge de episodios sin estrenar de series (`isNextEpisodeUnreleased`) y la comprobación diaria de backfill.

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27

## Decisión

Adoptar un criterio único centralizado: **un ítem sin fecha de estreno oficial se trata igual que uno con fecha futura (no estrenado)**, con confirmación suave (`window.confirm`) al marcarlo como visto, flag `awaitingRelease` en el alta y backfill progresivo de los ítems existentes. Componentes:

### 1. `js/release.js` (nuevo): criterio único y mensajes de confirmación

Módulo que centraliza la lógica de "no estrenado":

- **`isUnreleasedDate(dateStr)`**: devuelve `true` si `!dateStr || dateStr > todayISO()` — es decir, fecha vacía/`null`, o fecha futura (comparación de strings `YYYY-MM-DD`).
- **`unreleasedConfirmMessage(item)`**: devuelve el mensaje de `window.confirm` apropiado, o `null` si no aplica:
  - **Películas**: manual ⇒ `null` (sin aviso); estrenada ⇒ `null`; con fecha futura ⇒ mensaje con fecha (texto idéntico al preexistente); **sin fecha** ⇒ mensaje «no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenada».
  - **Series**: solo si `nextEpisodeToAir` coincide con `nextEpisode` (misma temporada y episodio); `airDate` futura ⇒ mensaje con fecha; `airDate` `null` ⇒ mensaje sin fecha; resto de casos ⇒ `null`.
  - **Resto de tipos** ⇒ `null`.

### 2. Alta de ítems (`js/search.js`, `js/modal-handlers.js`): flag `awaitingRelease` con fecha vacía

En `handleAdd` (`js/search.js`) y en `addSagaMovie`/`addFromRecommendation` (`js/modal-handlers.js`), el alta de película/serie ahora usa `details.<fecha> !== undefined && isUnreleasedDate(details.<fecha>)` (`releaseDate` para películas, `firstAirDate` para series) en lugar de `fecha && fecha > todayISO()`:

- Sin fecha oficial ⇒ `awaitingRelease = true` (tratada como no estrenada).
- El guard `!== undefined` evita flaggear ítems cuando la API falla de forma transitoria: `getMovieDetails`/`getTvExtraDetails` devuelven `{}` en el `catch` (el alta no se bloquea si este paso extra falla).

### 3. Marcado como visto (`js/ui.js`, `js/quick-actions.js`): confirmación unificada

El control ad-hoc de cada punto de marcado se sustituye por `unreleasedConfirmMessage(item)` + `window.confirm`:

- `js/ui.js` — handler de `#btn-add-watch` del modal de película (`openMovieModal`).
- `js/quick-actions.js` — `quickMarkMovie` y `quickMarkTv`.

Se mantiene el **patrón suave** de las fechas futuras (confirmación, no bloqueo duro): si el usuario confirma, el marcado procede.

### 4. Episodios de series (`js/sorting.js`): badge también con `airDate` null

En `isNextEpisodeUnreleased` se eliminó el `Boolean(item.nextEpisodeToAir.airDate)` del operador `&&`: ahora un `nextEpisodeToAir` **sin fecha** también se considera no estrenado (vía `isUnreleasedDate`). Consecuentemente, el badge "Aún no estrenado", la clase CSS `item-card--episode-unreleased` / `list-row--episode-unreleased` y el orden por actividad (ítems bloqueados al final) aplican también cuando `airDate` es `null`.

### 5. Backfill de ítems existentes (`js/daily-check.js`): comprobación diaria

En `checkForUpdates`, si un ítem no tiene fecha, no está visto y no tiene `awaitingRelease`, se setea el flag:

- **Películas**: `needsCheck` se amplía con `(!movie.releaseDate && !(movie.watchLog && movie.watchLog.length))`; nuevo bloque que fija `updates.awaitingRelease = true` cuando `!movie.awaitingRelease && fresh.releaseDate !== undefined && !(movie.watchLog && movie.watchLog.length) && isUnreleasedDate(fresh.releaseDate)`.
- **Series**: nuevo helper `hasAnyWatchedEpisode(show)` — recorre `watched` (temporada → episodio → `{ date, rating }`) y tolera el formato antiguo de fecha como texto plano vía `normalizeEntry` de `tv-progress.js`; el flag se setea con `fresh.firstAirDate !== undefined` y `isUnreleasedDate(fresh.firstAirDate)`.
- **Auto-cura**: cuando TMDB publique la fecha, el flujo existente (`updates.releaseDate = fresh.releaseDate` y el aviso de estreno con `fresh.releaseDate <= today`, que también limpia `awaitingRelease`) la rellena y notifica el estreno.

### Alcance explícitamente excluido

- **Checkboxes de episodios individuales del modal de serie**: NO se tocaron. Las series manuales tienen `airDate: null` en todos sus episodios; aplicar el control ahí rompería el flujo de progreso manual. La protección del "próximo episodio" (`isNextEpisodeUnreleased` + `unreleasedConfirmMessage`) cubre la vía principal de progreso de series con datos de TMDB.
- **`js/export-ics.js`**: ya excluía los ítems sin fecha (`if (!item.releaseDate) continue;`), por lo que no requirió cambios.
- **SUPERSEDIDO por ADR-023**: la reapertura de la issue #27 (serie entre temporadas con `next_episode_to_air = null`, p. ej. «Dune: La Profecía» T2) llevó a cubrir lo excluido en los puntos anteriores. El ADR-023 sí protege el checkbox de episodio individual (con guard `!item.manual`, que preserva el flujo de series manuales) y el botón "Marcar todo" de temporada (confirmación contando episodios sin estrenar), y también cubre el badge "Aún no estrenado" cuando TMDB no devuelve `next_episode_to_air` (campo persistido `nextEpisodeAirDate` + `getNextEpisodeAirInfo`). Ver [adr-023-episode-unreleased-no-date.md](adr-023-episode-unreleased-no-date.md).

## Alternativas descartadas

- **Bloqueo duro (impedir marcar sin confirmación)**: descartado porque el patrón establecido para fechas futuras era confirmación suave (`window.confirm`) y un bloqueo duro sería inconsistente con él; además, un ítem sin fecha oficial puede estar realmente estrenado, y exigir confirmación (no impedirlo) mantiene la flexibilidad sin perder el aviso.
- **Tocar los checkboxes de episodios del modal de serie**: descartado porque las series manuales tienen `airDate: null` en todos sus episodios, de modo que el control bloquearía todo el flujo de progreso manual. La protección del próximo episodio cubre la vía principal de avance de una serie sin afectar al caso manual. *(Esta decisión queda ampliada por el ADR-023: la reapertura de la issue #27 añadió el control al checkbox individual y a "Marcar todo" con el guard `!item.manual`, que deja intacto el flujo de las series manuales.)*
- **No hacer backfill**: descartado porque los ítems existentes (creados antes del fix) sin fecha y sin `awaitingRelease` seguirían marcables sin aviso; la ampliación de `checkForUpdates` los cura de forma progresiva en la comprobación diaria.

## Consecuencias

### Positivas
- **Criterio único y centralizado**: toda la lógica de "no estrenado" y sus mensajes viven en `js/release.js`; el resto de módulos consumen los helpers en lugar de repetir comparaciones de fechas con matices distintos.
- **Sin avisos que se saltan**: un ítem sin fecha de estreno oficial ya no puede marcarse como visto sin confirmación, igual que uno con fecha futura (películas, series y próximos episodios).
- **Cobertura de episodios sin fecha**: el badge "Aún no estrenado", la clase CSS de tarjeta y el orden por actividad ahora aplican también cuando `airDate` es `null`.
- **Auto-cura de datos**: cuando TMDB publique la fecha de un ítem sin ella, la comprobación diaria la rellena, limpia el flag y notifica el estreno sin intervención del usuario.
- **Textos preexistentes intactos**: los mensajes con fecha son idénticos a los anteriores, por lo que no cambia la experiencia para ítems con fecha futura.

### Negativas
- **Confirmación extra al marcar películas sin fecha**: aunque la película esté realmente estrenada, si TMDB no tiene fecha oficial el usuario verá un `confirm` adicional al marcarla como vista.
- **Llamada TMDB adicional por día**: la ampliación de `needsCheck` en películas hace que la comprobación diaria consulte la API por cada ítem sin fecha y sin historial de visionado (hasta que el flag `awaitingRelease` quede seteado o TMDB publique la fecha).

### Neutras
- **Nuevo módulo `js/release.js`**: es importado por `ui.js`, `quick-actions.js`, `search.js`, `sorting.js`, `modal-handlers.js` y `daily-check.js`. Incluido en `STATIC_ASSETS` de `service-worker.js` para su precacheo estático (consistencia con ADR-019).
- **Los checkboxes de episodios del modal de serie quedan fuera del control** de "no estrenado" por diseño (series manuales), mientras que la vía principal (próximo episodio) sí queda protegida.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/release.js` | **Nuevo**: `isUnreleasedDate(dateStr)` (`!dateStr \|\| dateStr > todayISO()`) y `unreleasedConfirmMessage(item)` con mensajes para películas (manual/fecha futura/sin fecha) y series (solo si `nextEpisodeToAir` coincide con `nextEpisode`; con fecha/sin fecha) |
| `js/search.js` | `handleAdd`: alta de película/serie con `details.<fecha> !== undefined && isUnreleasedDate(...)` para setear `awaitingRelease` (guard contra `{}` de la API) |
| `js/modal-handlers.js` | `addSagaMovie` y `addFromRecommendation` (ramas movie y tv): mismo criterio `!== undefined && isUnreleasedDate(...)` |
| `js/ui.js` | Handler de `#btn-add-watch` del modal de película: control ad-hoc sustituido por `unreleasedConfirmMessage` + `window.confirm` |
| `js/quick-actions.js` | `quickMarkMovie` y `quickMarkTv`: control ad-hoc sustituido por `unreleasedConfirmMessage` + `window.confirm` |
| `js/sorting.js` | `isNextEpisodeUnreleased`: eliminado `Boolean(airDate)`; ahora usa `isUnreleasedDate(airDate)` (null también ⇒ no estrenado) |
| `js/daily-check.js` | `checkForUpdates`: `needsCheck` ampliado para películas sin fecha; backfill de `awaitingRelease` para películas y series; nuevo helper `hasAnyWatchedEpisode` con `normalizeEntry` de `tv-progress.js` |
| `service-worker.js` | `js/release.js` añadido a `STATIC_ASSETS` para precacheo estático |
| `docs/adr-020-unreleased-without-date.md` | **Nuevo**: este documento |

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27
