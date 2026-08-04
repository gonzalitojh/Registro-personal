# ADR-023: Episodio sin fecha de estreno sin next_episode_to_air (serie entre temporadas): confirmación y badge "Aún no estrenado" (issue #27, reabierta)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

El fix original de la issue #27 (ADR-020, PR #33) cubrió el caso de películas sin fecha y de series con `nextEpisodeToAir` presente (con fecha o sin ella). La issue se **reabrió** porque quedaba sin cubrir el caso en que TMDB devuelve `next_episode_to_air = null`: una serie **entre temporadas** sin fecha anunciada, como «Dune: La Profecía» T2. En ese escenario el episodio siguiente del usuario (T2E1) no tiene fecha de estreno y podía marcarse como visto sin ningún aviso.

Los cuatro puntos de fallo detectados con `nextEpisodeToAir = null`:

1. **Acción rápida** (`quickMarkTv`): `unreleasedConfirmMessage(item)` devuelve `null` para TV cuando no hay `nextEpisodeToAir` (su guard `if (!nextEpisode || !nextEpisodeToAir) return null;`), así que no se pedía confirmación al marcar el siguiente episodio.
2. **Badge "Aún no estrenado"** (`isNextEpisodeUnreleased`): dependía exclusivamente de `nextEpisodeToAir`; con `null` devolvía `false` y el badge, la clase CSS de tarjeta y el orden por actividad no reflejaban el episodio bloqueado.
3. **Checkbox individual del modal de serie** (`js/ui.js`): solo bloqueaba cuando `airDate` existía y era futura; un episodio sin fecha (T2E1) se marcaba como visto sin confirmación.
4. **"Marcar todo" de temporada** (`js/ui.js`): no comprobaba fechas de estreno en absoluto.

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27

## Decisión

Ampliar el criterio de ADR-020 a **episodios concretos** cuyo `airDate` se desconoce (null) o es futuro, sin depender de que TMDB devuelva `next_episode_to_air`: se añade un helper de mensaje para episodios, un fallback de verificación vía la temporada, un campo persistido como fuente alternativa del badge y confirmaciones en los puntos de marcado que antes quedaban fuera. Las series manuales quedan **excluidas de todo el control** (no tienen fechas reales de TMDB).

### 1. `episodeUnreleasedMessage` en `js/release.js`: criterio único para episodios concretos

Nuevo helper `episodeUnreleasedMessage(title, season, episode, airDate)` que devuelve el mensaje de `window.confirm` para un episodio concreto del que conocemos (o no) su fecha de emisión:

- `airDate` futura ⇒ mensaje con fecha («Según TMDB este episodio (T2E1) se estrena el …»), idéntico en texto al patrón preexistente.
- `airDate` null ⇒ mensaje sin fecha («… no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenado …»).
- `airDate` pasado/hoy ⇒ `null` (estrenado).

Es el **criterio único** para episodios concretos: lo consumen `quickMarkTv` (fallback) y el checkbox individual del modal, garantizando el mismo aviso en todos los puntos.

### 2. Fallback en `quickMarkTv` (`js/quick-actions.js`): verificación vía `getSeasonEpisodes`

Cuando la confirmación base (`unreleasedConfirmMessage`) no aplica —típicamente por `nextEpisodeToAir` ausente— y la serie **no es manual** y tiene `externalId`, `quickMarkTv` consulta `getSeasonEpisodes(tvId, season)` y busca el episodio concreto del siguiente episodio del usuario; si existe, genera el mensaje con `episodeUnreleasedMessage`.

- **Fail-open documentado**: si la consulta falla (red/API), se registra en consola y se marca **sin confirmación** (el marcado nunca se bloquea por un fallo de red). La llamada no se repite: los episodios obtenidos se reutilizan para la persistencia del campo nuevo (punto 4) y para la ventana de valoración del episodio (ADR-022).

### 3. Guard `!item.manual` en todos los puntos

Las series manuales tienen `airDate: null` en todos sus episodios porque no hay datos reales de TMDB; aplicar el control ahí bloquearía el flujo de progreso manual. El guard `!item.manual` (o `manual` como opción de render) excluye a las series manuales de:

- el fallback de `quickMarkTv`;
- la confirmación del checkbox individual (`!item.manual && isUnreleasedDate(airDate)`);
- el conteo y la confirmación de "Marcar todo";
- el indicador "(sin estrenar)" de `renderEpisodeRows` (opción `{ manual }`);
- la persistencia de `nextEpisodeAirDate` al expandir una temporada;
- `getNextEpisodeAirInfo` (devuelve `null`).

### 4. Campo persistido `nextEpisodeAirDate`: fuente alternativa para el badge

Nuevo campo en los documentos de serie, con forma `{ season, episode, airDate }` (airDate puede ser `null` para «sin fecha oficial»). Guarda localmente la fecha de emisión del próximo episodio para que el badge "Aún no estrenado" funcione aunque TMDB deje de devolver `next_episode_to_air` (serie entre temporadas). Se escribe desde tres vías:

- **`quickMarkTv`** (`js/quick-actions.js`): `saveTvProgress` acepta un 5º parámetro `nextEpisodeAirDate`; si tras marcar el episodio el siguiente del usuario sigue en la misma temporada y ya se consultaron los episodios, persiste su `airDate` (o `null` si TMDB no la tiene) junto al progreso. El campo se muta también en memoria.
- **`js/daily-check.js`** (`buildTvUpdates`): cuando `fresh.nextEpisodeToAir` existe, además de sobrescribirlo (política del ADR-021) se copia localmente como `nextEpisodeAirDate` con `airDate` normalizado a `null` si viene vacío.
- **Expansión de temporada en el modal** (`js/ui.js` → `js/modal-handlers.js`): al expandir la temporada donde está el siguiente episodio del usuario, se persiste su `airDate` vía el callback `onUpdateNextEpisodeAirDate` (**fuego-y-olvido**: `Promise.resolve(...).catch(() => {})` por el lado de `ui.js` y `.catch` que no lanza por el lado de `modal-handlers.js`; un fallo no rompe el modal).

### 5. `getNextEpisodeAirInfo` en `js/sorting.js`: fuente unificada del badge

Nuevo helper `getNextEpisodeAirInfo(item)` que devuelve `{ season, episode, airDate }` del siguiente episodio del usuario, o `null` si no aplica:

- Prioriza `nextEpisodeToAir` (TMDB en vivo) **solo si coincide** en `season` + `episode` con `nextEpisode` del usuario.
- Si no, usa el dato guardado `nextEpisodeAirDate` **solo si coincide** en `season` + `episode`.
- Series manuales, sin `nextEpisode` o sin coincidencia ⇒ `null`.

La **invalidación por coincidencia de `season` + `episode`** garantiza que un dato guardado obsoleto (de otra temporada o episodio) nunca se aplique. `isNextEpisodeUnreleased` se refactoriza sobre este helper (`!!info && isUnreleasedDate(info.airDate)`), de modo que el badge "Aún no estrenado", las clases CSS `item-card--episode-unreleased` / `list-row--episode-unreleased` y el orden por actividad (ADR-020) cubren automáticamente el caso `nextEpisodeToAir = null`. El badge renderizado en `upcomingBadge` (`js/ui.js`) muestra ahora «Aún no estrenado · T2E1» con o sin fecha formateada según lo que devuelva `getNextEpisodeAirInfo`.

### 6. Confirmación en "Marcar todo" (`js/ui.js`)

Al marcar toda una temporada (`season-mark-all`, solo cuando se va a marcar, no al desmarcar, y solo si la serie no es manual), se cuenta cuántos episodios están sin estrenar (`isUnreleasedDate(e.airDate)`: sin fecha oficial o con fecha futura) y, si hay alguno, se pide **una única confirmación** indicando el número: «… N episodio(s) sin estrenar (sin fecha oficial o con fecha futura). ¿Marcarlos todos igualmente como vistos?».

- Los episodios se leen del bloque de temporada ya expandido si está cargado; si no, se consultan con `onExpandSeason` (fail-open: si la consulta falla, `episodes = null` y se marca sin confirmación).
- Si el usuario cancela, no se marca nada.

## Alternativas descartadas

- **Backfill diario masivo en `daily-check.js` consultando las temporadas** (llamar a `getSeasonEpisodes` por cada serie durante la pasada diaria): descartado por coste — una llamada adicional por serie y día incrementaría sensiblemente las peticiones a TMDB — y por desfase — el dato llegaría con hasta 24 h de retraso respecto al momento del marcado, que es cuando hace falta el aviso. Se prefirió la escritura bajo demanda (punto 4), que persiste la fecha exactamente cuando se consulta la temporada.
- **Bloqueo duro (impedir marcar, no preguntar)**: descartado por consistencia con el patrón histórico del repo y de ADR-020: la confirmación suave (`window.confirm`) es el criterio establecido para ítems sin estrenar, y un episodio sin fecha puede estar realmente emitido.
- **"Marcar todo" solo para episodios emitidos** (marcar todo excepto los sin estrenar): descartado porque cambia la semántica del botón — "Marcar todo" debe marcar todo o no marcar nada; la confirmación única preserva esa semántica y deja la decisión al usuario.
- **Dejar el badge fuera cuando `nextEpisodeToAir` es null**: descartado por UX: el usuario no vería que la serie está bloqueada entre temporadas, y el orden por actividad tampoco la relegaría al final.

## Consecuencias

### Positivas
- **El caso reportado queda cubierto en los tres puntos de marcado**: episodio sin fecha en serie entre temporadas (`next_episode_to_air = null`) ya no se marca sin aviso desde la acción rápida, el checkbox individual ni "Marcar todo".
- **El badge "Aún no estrenado" sobrevive a la ausencia de `next_episode_to_air`**: gracias al dato guardado `nextEpisodeAirDate` (escrito al consultar la temporada o en la pasada diaria), la tarjeta, la lista y el orden por actividad siguen reflejando el episodio bloqueado.
- **Criterio único para episodios concretos**: `episodeUnreleasedMessage` centraliza el mensaje y la decisión "estrenado/sin estrenar" para un episodio dado; los consumidores no repiten lógica con matices distintos.
- **Sin regresiones en series manuales**: el guard `!item.manual` en todos los puntos preserva el flujo de progreso manual (la razón por la que ADR-020 los había excluido).
- **Sin llamadas duplicadas**: los episodios consultados en el fallback de `quickMarkTv` se reutilizan para persistir `nextEpisodeAirDate` y para la ventana de valoración (ADR-022).

### Negativas
- **Llamada adicional a `getSeasonEpisodes` en la acción rápida** cuando la confirmación base no aplica (típicamente series entre temporadas); mitigada por la caché en memoria de 24 h de `getSeasonEpisodes` (ADR-022), que amortiza repeticiones dentro del mismo día.
- **El dato guardado `nextEpisodeAirDate` puede quedar desfasado** (depende de la última pasada diaria o de la última vez que se consultó la temporada, y la caché de 24 h puede servir un `airDate` antiguo). El impacto es limitado porque la confirmación es suave (si el episodio ya se estrenó, el usuario simplemente confirma) y el dato se reescribe con cada consulta fresca.
- **Fail-open ante errores de red**: si `getSeasonEpisodes` falla en el fallback de `quickMarkTv` o en el conteo de "Marcar todo", se marca sin confirmación. Es un compromiso deliberado: un fallo de red nunca debe bloquear el marcado (documentado en los comentarios del código).

### Neutras
- **Nuevo campo en el esquema de series**: `nextEpisodeAirDate` `{ season, episode, airDate }`; no proviene directamente de TMDB (es una copia local derivada), se persiste en Firestore y nunca se sobrescribe con `null` global: solo se reemplaza cuando las vías del punto 4 escriben un objeto nuevo (o se conserva intacto).
- **`onUpdateNextEpisodeAirDate` es fuego-y-olvido**: un fallo de persistencia no rompe la apertura ni la expansión de temporada del modal.
- **`isNextEpisodeUnreleased` cambia de implementación pero no de contrato**: los consumidores (`ui.js`, `daily-check.js`, ordenación) no cambian; el comportamiento se amplía al caso `nextEpisodeToAir = null`.
- **Sin cambios en `service-worker.js`**: los helpers nuevos viven en módulos ya precacheados (`release.js`, `sorting.js`, `quick-actions.js`, `ui.js`, `daily-check.js`, `modal-handlers.js`).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/release.js` | **Nuevo helper** `episodeUnreleasedMessage(title, season, episode, airDate)`: mensaje de confirmación para un episodio concreto (fecha futura o sin fecha oficial); `null` si ya está estrenado |
| `js/sorting.js` | **Nuevo** `getNextEpisodeAirInfo(item)`: fuente unificada del próximo episodio (prioriza `nextEpisodeToAir` si coincide con `nextEpisode`; si no, el dato guardado `nextEpisodeAirDate`; invalidación por `season` + `episode`); `isNextEpisodeUnreleased` refactorizada sobre él |
| `js/quick-actions.js` | `quickMarkTv`: fallback de confirmación vía `getSeasonEpisodes` (fail-open, episodios reutilizados) y persistencia de `nextEpisodeAirDate`; `saveTvProgress` con 5º parámetro `nextEpisodeAirDate` |
| `js/ui.js` | `renderEpisodeRows`: indicador "(sin estrenar)" también sin fecha (opción `manual`); checkbox individual con confirmación para `airDate` vacío/futuro (guard `!item.manual`); "Marcar todo" con confirmación contando episodios sin estrenar; `upcomingBadge` con `getNextEpisodeAirInfo`; expansión de temporada dispara `onUpdateNextEpisodeAirDate` (fuego-y-olvido) |
| `js/daily-check.js` | `buildTvUpdates`: persiste `nextEpisodeAirDate` `{ season, episode, airDate }` (airDate normalizado a `null`) cuando `nextEpisodeToAir` existe |
| `js/modal-handlers.js` | Nuevo callback `onUpdateNextEpisodeAirDate` (fuego-y-olvido): muta `item.nextEpisodeAirDate` y persiste en Firestore sin lanzar |
| `docs/adr-023-episode-unreleased-no-date.md` | **Nuevo**: este documento |

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27
