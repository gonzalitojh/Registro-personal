# ADR-025: air_date de temporada como fuente de verdad: mapa persistido `seasonAirDates` y precedencia de fuentes en `getNextEpisodeAirInfo` (issue #27, 3ª reapertura)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

En la 3ª reapertura de la issue #27 el usuario consultó la API de TMDB y señaló que el campo `air_date` viene **tanto en las temporadas como en los episodios**, y que cuando viene `null` se debe entender que la serie **no está estrenada** y tratarla como tal. La lógica acumulada hasta entonces (ADR-020, ADR-023, ADR-024) solo consumía dos fuentes:

1. `nextEpisodeToAir` (TMDB en vivo, fuente principal del badge y las confirmaciones).
2. `nextEpisodeAirDate` (backfill persistido por el PR #36 y el `ensureNextEpisodeAirDate` de ADR-024).

**La brecha**: el `air_date` de la **temporada** nunca se usaba como fuente. `getTvSeasonsMeta`/`getTvExtraDetails` ya lo normalizaban (`airDate: air_date || null`), pero nadie lo persistía ni lo consumía. Consecuencia concreta: una serie entre temporadas sin `next_episode_to_air` y con un `nextEpisodeAirDate` obsoleto persistido (p. ej. `null` guardado para siempre) quedaba sin fuente: `getNextEpisodeAirInfo` devolvía `null` y la serie no mostraba badge, rayas ni relegación, y podía marcarse sin confirmación, aunque el `air_date` de su temporada indicara que aún no está estrenada.

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27

## Decisión

Persistir el mapa de fechas de emisión por temporada (`seasonAirDates`) en los ítems de serie y usarlo como **segunda fuente** en la precedencia de `getNextEpisodeAirInfo`, con `null` dentro del mapa como **información real** ("temporada sin estrenar") que nunca se filtra. Componentes:

### 1. `js/api-movies.js`: helper interno `normalizeSeasons` y export `seasonAirDateMap`

- **`normalizeSeasons(seasons)`** (interno): filtra los "specials" (`season_number > 0`) y normaliza `airDate: s.air_date || null`. `getTvSeasonsMeta` se refactoriza sobre él (contrato sin cambios: lista de temporadas con nombre y nº de episodios).
- **`seasonAirDateMap(seasons)`** (export): devuelve el mapa `{ "1": "YYYY-MM-DD", "2": null }` vía `Object.fromEntries`. **Los `null` se conservan**: una temporada sin `air_date` es "temporada sin estrenar" y esa información es real, no un fallo de la API.
- **`getTvExtraDetails`** devuelve ahora `seasonAirDates: seasonAirDateMap(data.seasons)` en el detalle de la serie.

### 2. `js/sorting.js`: precedencia documentada de fuentes en `getNextEpisodeAirInfo`

El helper pasa a resolver en este orden:

1. **`nextEpisodeToAir`** (TMDB en vivo) cuando coincide en `season` + `episode` con el siguiente episodio del usuario → tag `source: "toAir"`.
2. **`seasonAirDates[temporada]`** (refrescado a diario) cuando la temporada del siguiente episodio existe en el mapa — **incluye `null`** (`!== undefined`), que significa temporada sin estrenar → tag `source: "season"`.
3. **`nextEpisodeAirDate`** (backfill histórico persistido, ADR-023/024) cuando coincide en `season` + `episode` → tag `source: "stored"`.

**Racional de la precedencia** (decisión de diseño clave): el mapa de temporadas se refresca a diario y al abrir el modal, por lo que es **más fresco que el backfill almacenado** — evita datos obsoletos del tipo `nextEpisodeAirDate = null` persistidos para siempre. Además, el `air_date` **pasado** de la temporada manda sobre un episodio "fantasma" sin fecha (caso raro donde la temporada ya se estrenó pero el episodio concreto no tiene fecha): en ese caso `isUnreleasedDate(airDate pasado)` es `false` y no hay confirmación base; lo cubren las confirmaciones por episodio (fallback `getSeasonEpisodes` + `episodeUnreleasedMessage`, checkbox individual y "Marcar todo", ADR-023).

El tag `source` se añade en memoria vía spread (`{ ...toAir, source: "toAir" }`) y es **solo informativo del predicado**: **nunca se persiste** (las 5 vías de escritura documentadas en el punto 3 construyen los objetos persistidos sin tag — verificadas).

### 3. Persistencia del mapa: 5 vías de escritura de `seasonAirDates`

1. **Alta de serie** (`js/search.js` `handleAdd` y `js/modal-handlers.js` `addFromRecommendation`): si `details.seasonAirDates` viene con claves (`Object.keys(...).length`), se añade al draft del alta.
2. **Refresco diario** (`js/daily-check.js` `buildTvUpdates`): se sobrescribe `updates.seasonAirDates` con el mapa fresco. **Excepción documentada a la política truthy-only** del ADR-021: el mapa es **completo** cuando la llamada tiene éxito y un `null` dentro es información real (no un dato ausente que haya que conservar), por lo que no aplica el patrón `if (fresh.x) updates.x = fresh.x` por campo.
3. **Refresco al abrir el modal** (`js/modal-handlers.js` `openTvItem`): fuego-y-olvido — si la meta recién consultada difiere de la persistida (comparación `JSON.stringify`), se asigna en memoria (el badge del modal vía `upcomingBadge` se pinta al momento) y se persiste con `.catch(...)` que no lanza. Las series manuales se excluyen.
4. **Acción rápida** (`js/quick-actions.js` `quickMarkTv`): mismo patrón fuego-y-olvido sobre la meta ya consultada por `getSeasonsMetaFor` (sin llamada adicional).
5. *(Las series manuales nunca reciben el mapa: no tienen fechas reales de TMDB.)*

### 4. `js/daily-check.js`: propagación del mapa fresco a los predicados

- `ensureNextEpisodeAirDate` inyecta `seasonAirDates: fresh.seasonAirDates` en el spread sobre el que consulta `getNextEpisodeAirInfo`: si la temporada ya resuelve como fuente, no hace falta el backfill por episodio.
- El bloque de `releasedNoticedAt` (transición bloqueado → estrenado) propaga también `seasonAirDates` frescas a `isNextEpisodeUnreleased`: cuando el `air_date` de la temporada ya es pasado, el episodio deja de estar bloqueado y se fija `releasedNoticedAt` en la misma pasada.

### 5. `js/release.js`: confirmación TV implementada vía inyección de parámetro

`unreleasedConfirmMessage(item, airInfo = null)` — la rama TV usa ahora el `airInfo` inyectado por parámetro en lugar de leer `nextEpisodeToAir` del propio ítem:

- El consumidor (`quick-actions.js`) pasa `getNextEpisodeAirInfo(item)`; así se **evita el ciclo de imports ES modules** que ADR-024 descartó (`release.js` solo importa `dates.js`; la dependencia de `sorting.js` queda en el lado del consumidor).
- Guard de coincidencia `season` + `episode` con el siguiente episodio del usuario; sin `airInfo` (o sin coincidencia) ⇒ `null` (sin información no hay confirmación).
- **Mensaje específico para `source: "season"`**: «Según TMDB la temporada N de «Título» aún no está estrenada (se estrena el … | sin fecha oficial). ¿Marcarlo igualmente como visto?» — distinto del mensaje por episodio, porque aquí es la temporada entera la que aún no se ha estrenado.

### 6. `js/quick-actions.js` y `js/modal-handlers.js`: consumidores

- `quick-actions.js`: import de `getNextEpisodeAirInfo`; la confirmación base pasa a ser `unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item))` (cubre cualquier fuente: en vivo, temporada o backfill); refresh fuego-y-olvido de `seasonAirDates` (punto 3.4).
- `modal-handlers.js` (`openTvItem`): refresh fuego-y-olvido de `seasonAirDates` **antes** de abrir el modal (punto 3.3).

## Alternativas descartadas

- **Consultar la temporada en vivo en cada render** (llamar a `getSeasonEpisodes`/`getSeasonEpisodesMeta` desde el render para conocer el estado de la temporada): descartado — caro (una llamada TMDB por renderizado de tarjeta/lista) y asíncrono (el render es síncrono; complicaría la caché y el renderizado). Ya fue el argumento contra el backfill síncrono en ADR-024; aquí se refuerza con la persistencia del mapa, que hace la consulta innecesaria.
- **Confiar solo en el backfill** (`nextEpisodeAirDate` almacenado, sin el mapa de temporadas): descartado — no cubre el caso reportado: un `nextEpisodeAirDate = null` persistido "para siempre" (serie entre temporadas sin fecha anunciada) nunca se corregiría aunque TMDB publicara el `air_date` de la temporada; el mapa refrescado a diario sí lo corrige.
- **Normalizar `null` a una fecha lejana en `seasonAirDateMap`** (para conservar la política truthy-only sin excepción): descartado — falsearía la realidad (una temporada sin fecha no tiene fecha lejana) y contaminaría los mensajes al usuario ("se estrena el …" con una fecha inventada). El `null` como valor real con excepción documentada en `buildTvUpdates` es más honesto.

## Consecuencias

### Positivas
- **El caso reportado queda cubierto**: el `air_date` de la **temporada** del siguiente episodio es ahora fuente de verdad (si es `null` o futura ⇒ no estrenada ⇒ rayas, relegación, badge y confirmación) aunque no existan `next_episode_to_air` ni `nextEpisodeAirDate` (criterio 3ª reapertura nº 1); el `air_date` del **episodio** sigue cubierto por las vías de ADR-023 (criterio nº 2); y el mapa se persiste y se mantiene actualizado con el refresco diario + apertura de modal + acción rápida (criterio nº 3).
- **Datos obsoletos auto-curativos**: un `nextEpisodeAirDate = null` persistido deja de bloquear el estado porque la temporada (más fresca) manda.
- **La fase de confirmación TV de `release.js` queda implementada** (descartada en ADR-024 por el ciclo de imports): resuelta con inyección de parámetro, sin tocar la dirección de las dependencias.
- **QA aprobado**: 6/6 criterios de aceptación y 60/60 pruebas; escaneo de seguridad CLEAR (`security-cleared` en el task file).
- **Sin cambios de contrato**: `isItemUnreleased`, `isNextEpisodeUnreleased` y `upcomingBadge` consumen `getNextEpisodeAirInfo` y no cambian su interfaz; los consumidores de ADR-024 siguen funcionando.

### Negativas
- **Un campo persistido más en el esquema de series**: `seasonAirDates` (`{ "1": "YYYY-MM-DD", "2": null }`), que se escribe en las 5 vías del punto 3 (más escrituras de Firestore que antes).
- **Hallazgos LOW (no bloqueantes, documentados en el QA)**:
  - *`JSON.stringify` sensible al orden de claves*: si TMDB reordena las temporadas en su respuesta, la comparación puede dar "distinto" con contenido idéntico ⇒ una escritura redundante e inofensiva (el contenido persistido es el mismo).
  - *Temporada pasada + episodio "fantasma"*: si la temporada ya tiene `air_date` pasado pero el episodio concreto no tiene fecha (caso raro), la precedencia hace que la temporada mande y no haya confirmación base; lo cubren las confirmaciones por episodio (fallback `getSeasonEpisodes` en `quickMarkTv`, checkbox individual y "Marcar todo", ADR-023).

### Neutras
- **`null` en el mapa es información real**: no se filtra ni se sustituye; es la **excepción documentada** a la política truthy-only de ADR-021 en `buildTvUpdates` (el mapa completo se sobrescribe siempre que la llamada tenga éxito).
- **El tag `source` es un artefacto en memoria**: se añade vía spread en `getNextEpisodeAirInfo` y nunca se persiste (5 vías de escritura verificadas construyen los objetos persistidos sin tag).
- **Patrón fail-open preservado**: los refrescos fuego-y-olvido (`JSON.stringify` + `.catch`) no rompen la apertura del modal ni la acción rápida si la persistencia falla.
- **Series manuales excluidas**: no reciben el mapa (punto 3.5); su flujo de progreso manual no se ve afectado (consistente con ADR-020/023/024).
- **Sin cambios en `service-worker.js`**: todos los módulos tocados ya están precacheados (ADR-019).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Nuevo** helper interno `normalizeSeasons` (filtra `season_number > 0`, `airDate: air_date \|\| null`); `getTvSeasonsMeta` refactorizada sobre él; **nuevo export** `seasonAirDateMap(seasons)` (conserva `null`); `getTvExtraDetails` devuelve `seasonAirDates` |
| `js/sorting.js` | `getNextEpisodeAirInfo`: precedencia documentada 1) `nextEpisodeToAir` (source "toAir") 2) `seasonAirDates[temporada]` (source "season", `!== undefined`, incluye `null`) 3) `nextEpisodeAirDate` (source "stored"); tag `source` en memoria vía spread, nunca persistido |
| `js/search.js` | `handleAdd` (alta de serie): persiste `details.seasonAirDates` en el draft si tiene claves |
| `js/modal-handlers.js` | `addFromRecommendation` (alta de serie): persiste `details.seasonAirDates`; `openTvItem`: refresh fuego-y-olvido de `seasonAirDates` antes de abrir el modal (comparación `JSON.stringify` + `.catch`, exclusión de manuales) |
| `js/daily-check.js` | `buildTvUpdates`: sobrescribe `seasonAirDates` con el mapa fresco (excepción documentada a la política truthy-only); `ensureNextEpisodeAirDate` y el bloque `releasedNoticedAt` propagan `seasonAirDates` frescas al spread (transición bloqueado → estrenado correcta) |
| `js/quick-actions.js` | Import de `getNextEpisodeAirInfo`; confirmación base `unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item))`; refresh fuego-y-olvido de `seasonAirDates` sobre la meta ya consultada |
| `js/release.js` | `unreleasedConfirmMessage(item, airInfo = null)`: rama TV usa `airInfo` inyectado (evita el ciclo de imports con `sorting.js`); mensaje específico para `source: "season"` («Según TMDB la temporada N de «Título» aún no está estrenada …») |
| `docs/adr-024-unreleased-uniform-treatment.md` | Nota de actualización: la fase de confirmación TV (descartada allí por el ciclo de imports) queda implementada vía inyección de parámetro, y `seasonAirDates` extiende la historia de fuentes |
| `docs/adr-025-season-air-dates.md` | **Nuevo**: este documento |

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27
