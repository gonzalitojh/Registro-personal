# ADR-021: Sincronización de datos con TMDB/Open Library: refresco completo con política truthy-only (issue #23)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #23 establece que **los datos de Firestore deben reflejar siempre los datos actuales de TMDB/Open Library**: no puede ser que un ítem se actualice únicamente al momento del alta y quede congelado después. El ejemplo canónico: una película añadida antes de que TMDB la incorporara a una saga (`belongs_to_collection`) nunca recibía sus datos de colección, porque el refresco diario ignoraba los ítems "completados".

Antes de este cambio, `js/daily-check.js` ejecutaba `checkForUpdates` una vez al día (guard `profile.lastReleaseCheckAt === today`) pero con dos limitaciones:

1. **Solo revisaba ítems incompletos**: filtros `needsCheck` (películas) y `needsBackfill` (series), y las series abandonadas (`status === "abandonado"`) quedaban excluidas.
2. **Solo rellenaba huecos**: asignaciones del tipo `if (!movie.X && fresh.X)`, de modo que un campo ya presente (p.ej. la saga, `communityRating`, `trailerUrl` o los géneros) jamás se refrescaba aunque la API lo hubiera cambiado.

La opción idónea que plantea la issue — mantener la BD sincronizada en tiempo real con la API— no es viable por coste (una llamada por ítem en cada cambio es inasumible), así que se adoptó la opción mínima recomendada: **refresco diario completo** (ya no solo de huecos) más **botón de sincronización manual** en Ajustes.

Related issue: #23 — https://github.com/gonzalitojh/Registro-personal/issues/23

## Decisión

Refrescar los metadatos de **todos** los ítems no manuales una vez al día (y bajo demanda con el botón "Sincronizar ahora"), sobrescribiendo los campos con política **truthy-only**: un campo se actualiza solo si el valor fresco es no vacío; si la API devuelve vacío/`null`, se conserva lo guardado. Los campos editados por el usuario (historial, estado, notas) nunca se tocan.

### 1. Sobrescritura truthy-only (`buildMovieUpdates`, `buildTvUpdates`, `buildBookUpdates`)

Tres funciones constructoras de `updates` en `js/daily-check.js` aplican la misma semántica por tipo:

- **Películas** (`buildMovieUpdates`): `runtime`, `overview`, `genres` (array no vacío), `cast` (array no vacío), `director`, `releaseDate` (solo si difiere de la guardada), `communityRating` (`!= null`), `trailerUrl`, `collectionId`/`collectionName`/`collectionPoster` (saga) y `coverUrl`.
- **Series** (`buildTvUpdates`): los anteriores excepto `releaseDate`/saga, más `creators`, `episodeRuntime`, `firstAirDate` (solo si difiere), `tmdbStatus` (nuevo) y `coverUrl` (nuevo).
- **Libros** (`buildBookUpdates`): solo `description` (sinopsis), y únicamente si la nueva es no vacía (Open Library a veces no la devuelve).

**Excepción**: `nextEpisodeToAir` se sobrescribe siempre que la API lo devuelva, sin condición truthy-only, porque es un campo transitorio (comportamiento histórico que el refresco de episodios necesita).

**Campos estables (nunca sobrescritos)**: `title`, `year`, `externalId`, `manual`, `status`, `watchLog`, `readLog`, `notas` y los flags de notificación (`awaitingRelease`, `lastNotifiedEpisode`, `releasedNoticedAt`). Estos solo los mueve la lógica de avisos de la propia pasada (estreno, episodio nuevo), nunca el refresco de metadatos.

### 2. Cobertura completa

Se eliminaron los filtros `needsCheck`/`needsBackfill` y el skip de libros que ya tenían sinopsis (`if (book.manual || book.description) continue`). La pasada recorre ahora **todos** los ítems no manuales con `externalId`:

- **Películas**: `!m.manual && m.externalId`.
- **Series**: `!s.manual && s.externalId`, **incluidas las abandonadas** (antes excluidas con `s.status !== "abandonado"`); su `status` sigue intacto porque es campo estable.
- **Libros**: `!b.manual && b.externalId && b.externalId.startsWith("/works/")` (este último filtro se conserva: solo las claves de *work* tienen descripción consultable en Open Library).

### 3. Límites de coste

- **Pasada diaria por usuario**: guard `profile.lastReleaseCheckAt === today`; el sello solo se estampa al terminar la pasada con éxito (no al abortar), de modo que una pasada fallida se reintenta en la siguiente carga.
- **Cooldown manual de 30 minutos**: `MANUAL_SYNC_COOLDOWN_MS` persistido en `profile.lastManualSyncAt` (se estampa solo si la pasada manual completó sin abortar).
- **Pool de 4 peticiones concurrentes**: `REFRESH_CONCURRENCY` con `mapConcurrent(items, limit, fn)` (promesas en orden, sin dependencias entre ítems).
- **Aborto por fallos encadenados**: si `consecutiveFailures` supera `MAX_CONSECUTIVE_FAILURES` (= 5, es decir, al **sexto fallo consecutivo**) la pasada se aborta (`{ aborted: true }`) para no seguir golpeando una API que está caída; se reintenta en la próxima pasada.

### 4. Anti-concurrencia

- El flag `isRefreshing` lo gestiona **`checkForUpdates`**, no `syncNow`, para cubrir tanto la pasada diaria automática como la manual con una única guarda. El chequeo y el seteo son **síncronos y contiguos** (sin `await` entre ambos), por lo que dos llamadas nunca atraviesan la guarda a la vez; la limpieza ocurre en `finally`.
- `checkForUpdates` devuelve `{ aborted: boolean }`: `true` si entró con una pasada en curso (reentrancia) o si la pasada abortó por fallos; en ese caso **no estampa `lastReleaseCheckAt`** ni `lastManualSyncAt`.
- `syncNow` hace un **doble chequeo** de `isRefreshing` (antes y después de leer el perfil) y, si la pasada abortó, devuelve error **sin quemar el cooldown** ni reportar éxito.

### 5. Nuevos campos en `js/api-movies.js`

- `tmdbStatus: data.status || null` en `getTvExtraDetails`: estado de emisión de la serie según TMDB ("Returning Series", "Ended", "Canceled", ...), ahora refrescable.
- `coverUrl: data.poster_path ? IMG_BASE + poster_path : null` en `getMovieDetails` y `getTvExtraDetails`, con `IMG_BASE = "https://image.tmdb.org/t/p/w342"` — el **mismo patrón w342 que el alta** (resultados de búsqueda), de modo que una portada retirada o añadida por TMDB se propaga a las fichas existentes.

### 6. UI: card "Sincronización de datos" en Ajustes

- Nueva card en `index.html` con el botón `#btn-sync-now` (clase `btn btn--outline`).
- `wireSyncButton` (`js/settings.js`) lanza `syncNow(ctx)` y traduce el resultado a toasts: éxito ("Datos sincronizados con las APIs."), cooldown ("Sincronización reciente, inténtalo en un rato."), pasada en curso ("Ya hay una sincronización en curso.") o error.
- El botón queda **deshabilitado durante la ejecución** (texto "Sincronizando…", restaurado en `finally`) y también mientras haya cualquier pasada en curso vía `isSyncRunning()` (exportado por `daily-check.js` y consultado en `renderSettings`).

### 7. Bump de versión

`APP_VERSION` pasa a `'20260804'` en `js/config.js`, con el `?v=20260804` correspondiente en `index.html` (styles, ocio.css, app.js) y en `STATIC_ASSETS` de `service-worker.js`, para que el nuevo `daily-check.js`/`settings.js` llegue a los clientes (consistencia con ADR-019).

## Alternativas descartadas

- **Sincronización en tiempo real / reactiva (cada cambio de la API se propaga al instante)**: la opción idónea de la issue, descartada por coste: TMDB no ofrece webhooks y un polling continuo por ítem excedería los límites de la API. El botón manual cubre el caso "quiero datos frescos ahora".
- **Refrescar solo ítems incompletos (status quo)**: descartado por definición — es exactamente el comportamiento que reporta la issue: un ítem completado (p.ej. con saga ausente) nunca se curaba.
- **Sobrescritura incondicional (el dato de la API siempre gana)**: descartado: si la API devuelve `overview: ""` o `communityRating: null` de forma transitoria, se destruirían datos válidos. La política truthy-only refresca sin riesgo de vaciado.
- **Botón manual sin cooldown**: descartado: permitiría lanzar pasadas completas de N ítems ilimitadamente y tumbar los límites de TMDB; el cooldown de 30 min persistido en `profile.lastManualSyncAt` lo impide.
- **Flag anti-concurrencia gestionado en `syncNow`**: descartado: no cubriría la pasada diaria (dos pasadas diarias de pestañas distintas podrían correr en paralelo duplicando coste y notificaciones); al centralizarlo en `checkForUpdates` la guarda cubre ambas vías.

## Consecuencias

### Positivas
- **La BD refleja los datos actuales de la API**: un ítem completado se cura cuando TMDB añade su saga, cambia su valoración, portada o tráiler, o cuando una serie pasa a "Ended" (`tmdbStatus`).
- **Sin riesgo de vaciado**: la política truthy-only nunca destruye un campo guardado por una respuesta vacía o fallo transitorio de la API.
- **Los datos del usuario son intocables**: `watchLog`, `readLog`, `status`, `notas` y los flags de notificación quedan fuera del refresco.
- **Cobertura total**: series abandonadas y libros con sinopsis ya incluidos en la pasada diaria.
- **Control de coste y robustez**: una pasada por día y usuario, cooldown de 30 min para la manual, pool de 4 peticiones y aborto temprano ante fallos encadenados evitan exceder los límites de TMDB y no bloquean indefinidamente al usuario (el cooldown no se quema si la pasada aborta).
- **Sin pasadas duplicadas**: el flag `isRefreshing` con seteo síncrono contiguo cierra la carrera entre la pasada diaria y la manual.

### Negativas
- **Más peticiones diarias a TMDB**: la pasada diaria ahora consulta la API por **todos** los ítems no manuales, no solo los incompletos; con bibliotecas grandes el coste diario por usuario crece proporcionalmente (mitigado por el pool de 4 y la frecuencia de una pasada/día).
- **Escrituras Firestore adicionales**: aunque `buildMovieUpdates` devuelve `{}` cuando no hay nada que cambiar (sin `updateItem`), es esperable que más ítems reciban `updateItem` que antes.

### Neutras
- `checkForUpdates(ctx, { force })` pasa a devolver `{ aborted: boolean }` (antes `undefined`); el único consumidor de la pasada diaria (`app.js` → `maybeTriggerDailyCheck`) no usa el retorno, y `syncNow` lo interpreta para no quemar el cooldown.
- `syncNow(ctx)` y `isSyncRunning()` son exportaciones nuevas de `daily-check.js`; `settings.js` las importa (sin ciclos: `settings.js` ya importaba de `daily-check.js` vía `getNotificationPrefs`).
- `coverUrl` se guarda en los documentos de películas/series; las fichas que muestran portada la leen del documento, por lo que el refresco diario las actualiza sin cambios de UI.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/daily-check.js` | Refactor de `checkForUpdates`: pasa a `(ctx, { force })` y devuelve `{ aborted }`; flag `isRefreshing` interno con seteo síncrono + `finally`; eliminados `needsCheck`/`needsBackfill` y el skip de libros; cobertura total de ítems no manuales (incluidas series abandonadas); nuevas funciones `buildMovieUpdates`/`buildTvUpdates`/`buildBookUpdates` (truthy-only), `mapConcurrent` (pool `REFRESH_CONCURRENCY` = 4), aborto con `MAX_CONSECUTIVE_FAILURES`; nuevas exportaciones `syncNow(ctx)` (cooldown `MANUAL_SYNC_COOLDOWN_MS` = 30 min + doble chequeo) e `isSyncRunning()` |
| `js/api-movies.js` | `getTvExtraDetails`: nuevo `tmdbStatus` (`data.status`); `getMovieDetails` y `getTvExtraDetails`: nuevo `coverUrl` (patrón w342 de `IMG_BASE`, igual que el alta) |
| `index.html` | Card "Sincronización de datos" en Ajustes con botón `#btn-sync-now` (`btn--outline`); assets con `?v=20260804` |
| `js/settings.js` | `wireSyncButton` (toasts por resultado, deshabilitado durante ejecución con "Sincronizando…") y `renderSettings` deshabilita el botón si `isSyncRunning()` |
| `js/config.js` | `APP_VERSION` → `'20260804'` |
| `service-worker.js` | `STATIC_ASSETS` actualizados a `?v=20260804` para propagar el cambio (consistencia con ADR-019) |
| `docs/adr-021-db-data-sync.md` | **Nuevo**: este documento |

Related issue: #23 — https://github.com/gonzalitojh/Registro-personal/issues/23
