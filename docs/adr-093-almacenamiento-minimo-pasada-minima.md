# ADR-093: Almacenamiento mínimo (A2) y pasada diaria mínima (A5-a) (issue #200)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #200 pide **rehacer cómo se almacena la información** buscando
la mayor optimización, según el estudio de la issue #183
(`docs/estudio-almacenamiento-minimo.md`, ADR-073). El estudio cuantifica
el problema: hoy el alta persiste el **snapshot completo** de la API
(sinopsis, reparto, géneros, tráiler, saga, plataformas...) en Firestore
y la pasada diaria `checkForUpdates` (ADR-021) lo **vuelve a consultar y
sobrescribir cada día** para todos los ítems no manuales (~75 llamadas a
las APIs al día para un usuario medio), con política truthy-only.

Ese coste no tiene contrapartida en la UI: los campos de ficha solo se
leen al abrir el modal, y los datos guardados quedan obsoletos igualmente
entre pasadas. El estudio propone (sección 10) el híbrido **A2** +
pasada mínima **A5-a**, que es lo que implementa este ADR.

## Decisión

### 1. Almacenamiento mínimo en el alta (A2)

`minimalStoredFields(details, type)` (`js/search.js`) filtra el snapshot
ampliado y persiste **solo**:

- **tarjeta**: `title`, `year`, `coverUrl`, `externalId`;
- **avisos y badges**: `releaseDate`, `firstAirDate`, `nextEpisodeToAir`
  (y su copia local `nextEpisodeAirDate`), `seasonAirDates`,
  `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode`,
  `status`/`autoStandbyAt`;
- **rating comunitario**: `communityRating` (la tarjeta lo pinta).

**Excepción libros** (estudio §8.1): conservan `author`, `pages` y
`description` — la tarjeta y el modal de libro las pintan al instante y
recuperarlas siempre exigiría red.

Los campos de ficha (`overview`, `runtime`, `episodeRuntime`, `genres`,
`cast`, `director`, `creators`, `trailerUrl`, `collectionId`/`Name`/
`Poster`, `platforms`, `developers`, `publishers`, `esrbName`,
`metacritic`, `playtime`) quedan en `ON_DEMAND_DETAIL_FIELDS`
(`js/constants.js`) y **no se persisten** en las altas nuevas (búsqueda,
visto, saga, recomendación).

### 2. Ficha bajo demanda (A2)

- `js/item-details.js` — `needsDetailFetch(item)` y `loadItemDetails(item)`:
  si al ítem le faltan detalles, se piden a la API con la **caché en
  memoria de 24 h** que ya usaban `getMovieDetails`/`getTvExtraDetails`
  (`js/api-movies.js`, misma caché que `getWatchProviders`); nunca lanza
  (degradación elegante ante fallo de red).
- `js/modal-handlers.js` — `loadDetailsForModal(item, ctx, rerender)`
  cargada en `openMovieItem`/`openTvItem`/`openGameItem`: placeholder de
  carga («Cargando detalles…»), re-render al llegar los datos y
  **stale-while-revalidate** de `coverUrl`/`communityRating` (cambios de
  portada/rating se persisten de vuelta, el resto no).
- `js/ui.js` — `extraInfoHtml` degradada a `detailStatusHtml` cuando no
  hay detalles; `openReadOnlyModal` (ficha de amigo) carga bajo demanda
  con degradación a «solo tarjeta» y **sin escrituras** en Firestore.
- `js/api-games.js` — throttle IGDB ≤ 4 req/s (`IGDB_MIN_INTERVAL_MS =
  250`) para no chocar con el límite de la API al abrir fichas de varias
  juegos seguidas.

### 3. Pasada diaria mínima (A5-a)

`checkForUpdates` (`js/daily-check.js`) ya no cura metadatos: solo
consulta a las APIs lo que **puede generar un aviso**:

- **Películas**: solo las que buscan estreno (`movieNeedsCheck`:
  `awaitingRelease` o `releaseDate` futura sin ver — backfill de ítems
  antiguos). Se refresca `releaseDate` si cambió y el aviso de estreno.
- **Series**: solo las que esperan estreno o con el próximo episodio sin
  estrenar hoy/en el futuro (`showNeedsCheck`, vía
  `getNextEpisodeAirInfo`). Se conservan los avisos (premiere, episodio
  nuevo, liberación de bloqueado) y el auto-standby evaluado con datos
  frescos. Para las **series en curso con episodio ya emitido**, el
  auto-standby (ADR-033) se evalúa **sin red**, con los datos guardados
  (nuevo bucle `offlineStandbyShows`).
- **Libros**: solo los de Open Library (`/works/`) **sin sinopsis**
  guardada; sigue la política truthy-only.
- **Videojuegos**: sin red, como hasta ahora (aviso de lanzamiento con
  datos guardados, ADR-071).

Con la caché de 24 h, una ficha consultada hoy no repite llamada en la
pasada. La concurrencia (pool 4), el aborto por fallos consecutivos y el
guard diario `lastReleaseCheckAt` se mantienen intactos.

### 4. «Sincronizar ahora» → «Comprobar estrenos»

El botón de Ajustes se redefine con el alcance de la pasada mínima
(revalidar pendientes de estreno), conservando el **cooldown de 30
minutos** (`profile.lastManualSyncAt`) y los toasts de estado. `syncNow`
e `isSyncRunning` no cambian de forma.

### 5. Migración de datos existentes (limpieza diferida)

`js/migration.js` — `runStorageMigration(uid, ctx)`: **una sola vez por
usuario** (marcador `profile.storageMigration = "200-a2"`) poda los
campos de `ON_DEMAND_DETAIL_FIELDS` de los documentos antiguos
(`deleteField` por campo presente; **los libros conservan
`description`**). Es idempotente, best-effort y fail-open: si falla no
bloquea el arranque y se reintenta en la próxima sesión. Se lanza desde
`app.js` tras el login, en paralelo con las suscripciones. La ficha
recupera esos campos bajo demanda, así que la poda es invisible para el
usuario y reduce el tamaño facturado de los documentos.

### 6. Cachés y versión

`scripts/bump-version.sh 20260926` — `APP_VERSION`/refs `?v=` a
20260926 (SW invalida la caché estática); `DYNAMIC_MAX_ENTRIES` 50 → 100
(la ficha bajo demanda cachea más imágenes en la caché dinámica).

## Alternativas descartadas

Resumen de la sección 10 del estudio (detalle en ADR-073):

- **A1 (mínimo estricto total) y B/B2/B3**: descartados por pérdida de
  funciones (valoraciones comunitarias en tarjeta, orden por fecha de
  actividad) o por complejidad sin beneficio.
- **Mantener ADR-021 (refresco completo diario)**: descartado por coste
  ~75 llamadas/día sin consumo real (los campos solo se leen al abrir la
  ficha); A2 + A5-a reducen las llamadas diarias a las de los ítems con
  avisos pendientes (habitualmente 0-2), manteniendo todas las
  notificaciones.
- **Persistir la sinopsis en el alta de libros**: se conserva por la
  excepción §8.1 (la tarjeta y el modal la pintan al instante).

## Consecuencias

- **ADR-021 queda parcialmente sustituido**: ya no hay curación diaria
  de metadatos ni sincronización manual de TODO; en vigor siguen el
  guard diario, el anti-concurrencia `isRefreshing`, el cooldown de 30
  min y el aborto por fallos. ADR-020 (`awaitingRelease`), ADR-033
  (auto-standby) y ADR-071 (lanzamiento de juegos) siguen vigentes.
- Series entre temporadas sin fecha anunciada dejan de consultarse a
  diario (su auto-standby es offline); los avisos de «episodio
  disponible» dependen de que TMDB devuelva `next_episode_to_air` con
  fecha hoy/pasada en el momento de la pasada (mismo comportamiento que
  antes: la pasada diaria siempre vio esa ventana el día del estreno).
- Latencias: la ficha muestra el placeholder de carga la primera vez
  (luego caché de 24 h y precarga del partial); si falla la red se
  degrada a «solo tarjeta».
- Beneficio de la migración diferido hasta la primera sesión de cada
  usuario tras el despliegue (poda única, idempotente).
- Regla 3 de AGENTS.md: `docs/manual-de-usuario.md` §§16-17 reescritas
  («Comprobar estrenos», datos bajo demanda).

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `js/constants.js` | `ON_DEMAND_DETAIL_FIELDS` (lista de campos bajo demanda) |
| `js/api-movies.js` | caché 24 h en `getMovieDetails`/`getTvExtraDetails` |
| `js/api-games.js` | throttle IGDB ≤ 4 req/s |
| `js/item-details.js` | **Nuevo**: `needsDetailFetch`/`loadItemDetails` |
| `js/search.js` | `minimalStoredFields`; altas sin enriquecimiento |
| `js/modal-handlers.js` | `loadDetailsForModal` (on-demand + stale-while-revalidate) |
| `js/ui.js` | `detailStatusHtml`; `openReadOnlyModal` on-demand (amigos) |
| `js/daily-check.js` | pasada mínima A5-a (`movieNeedsCheck`, `showNeedsCheck`, auto-standby offline) |
| `js/migration.js` | **Nuevo**: poda única por usuario (`storageMigration`) |
| `js/app.js` | lanzamiento de la migración tras el login |
| `js/firebase.js` | re-export de `deleteField` |
| `js/settings.js` + `index.html` | botón «Comprobar estrenos» |
| `service-worker.js` + `js/config.js` | versión 20260926, `DYNAMIC_MAX_ENTRIES` 100 |
| `docs/manual-de-usuario.md` | §§16-17 reescritas |
| `docs/adr-021-db-data-sync.md` | anotado como parcialmente sustituido |

Related issue: #200 — https://github.com/gonzalitojh/Registro-personal/issues/200