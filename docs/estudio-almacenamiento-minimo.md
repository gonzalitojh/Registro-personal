# Estudio de almacenamiento mínimo en base de datos (issue #183)

## Fecha

2026-08-10

## Issue

#183 — «Estudio almacenamiento mínimo»: realizar un estudio, sin implementar
nada, sobre la posibilidad de hacer un guardado de información mínima en base
de datos, de forma que la mayor parte de la información se extraiga
directamente de las APIs (TMDB, Google Books, Open Library, IGDB).
https://github.com/gonzalitojh/Registro-personal/issues/183

## Estado

Estudio finalizado, **sin implementación**: este documento no aporta ni
propone código a la aplicación (criterio de aceptación n.º 8: no se modifica
ningún archivo fuera de `docs/` y `tasks/`).

---

## 1. Resumen ejecutivo

**Veredicto: es factible y recomendable guardar menos información en
Firestore, pero no hace falta llegar al extremo de guardar "solo el id".**
La alternativa óptima es un **híbrido (A2)**: persistir en base de datos todo
lo que la interfaz necesita para pintar tarjetas y avisos sin red (campos de
tarjeta + campos de notificación), y pedir a las APIs bajo demanda (con
caché) todo lo que solo se ve al abrir la ficha (sinopsis, reparto, director,
tráiler, colección/saga, plataformas, desarrolladores, etc.). Complementado
con una **pasada diaria mínima (A5-a)** que solo consulta la API para los
ítems pendientes de estreno y las series en curso, el ahorro estimado del
coste de API es de ~72 % frente al statu quo, sin degradar la experiencia
offline ni las funciones sociales (amigos, feed, notificaciones).

La opción literal de la issue («guardar solo el id y los datos de visionado y
valoración») **se descarta con datos**: abrir la pestaña de películas exigiría
~300 llamadas a TMDB (una por tarjeta), abrir la de videojuegos ~30 llamadas a
IGDB (7,5 s mínimos por el límite de 4 req/s), la sección de amigos O(n·m)
llamadas por visita, y no ahorraría las llamadas de la pasada diaria de
avisos, porque `releaseDate`/`nextEpisodeToAir` no estarían en base de datos.
Además destruiría la experiencia offline de la PWA y las estadísticas y
ordenación locales (sección 4.1 y 7).

Tabla de una vista (detalle en las secciones 4 y 7; todas las cifras son
**estimaciones** con los supuestos de la sección 6):

| Criterio (usuario medio, valores por día) | A0 statu quo | A1 solo id + usuario | A2 híbrido (propuesto) | A3 solo local | A4 proxy/caché central |
|---|---|---|---|---|---|
| Llamadas a APIs | ~445 | ~5.000-6.700 (con uso social; colapso UX, rompe offline) | **~125** | 0 (pero rompe todo lo social) | ~125 + backend |
| Escrituras Firestore | ~120 | ~20 | **~35** | 0 | ~35 |
| Lecturas Firestore | ~10.100 | ~10.100 (mismo nº de docs) | ~10.100 | _n/a_ | ~10.100 |
| Almacenamiento (480 docs) | ~2,2 MB | ~0,45 MB | ~0,9 MB | _n/a_ | ~0,9 MB |
| Latencia primer render de pestaña | instantánea | 15-23 s (películas) / 7,5 s (juegos) | **instantánea** | instantánea | instantánea |
| Offline (PWA) | tarjetas + fichas visitadas | solo lo visitado | **tarjetas + fichas visitadas** | offline total del propio dispositivo, pero sin amigos ni multi-dispositivo | igual que A2 |
| Amigos y feed | completos | extremadamente lentos (M×N llamadas) | **completos** | rotos (firestore.rules) | completos |
| Notificaciones de estrenos | pasada diaria completa | pasada diaria completa (sin ahorro) | **pasada mínima (A5-a)** | rotas (sin backend) | pasada mínima |
| Complejidad / riesgo de migración | — (baseline) | alta (reescritura de todos los consumidores) | **media** | media (y abandono de Firestore) | alta (nueva infraestructura) |

---

## 2. Alcance y metodología

**Qué se estudia**: el coste (Firestore y APIs), la latencia, la experiencia
offline y la funcionalidad de todos los consumidores de datos de la app ante
distintas estrategias de almacenamiento: cuántos campos guardar por ítem y
cuáles pedir en vivo a las APIs. Se evalúa cuantitativamente el riesgo de
sobrecargar las APIs y se recomienda un conjunto concreto de campos a
persistir.

**Qué NO se estudia / hace**: no se implementa nada. No se toca ningún
archivo de código (`js/`, `css/`, `index.html`, `service-worker.js`,
`firestore.rules`, `cloudflare/`, `config`). Este documento cita rutas y
líneas reales del estado actual solo como evidencia.

**Metodología**:

1. **Lectura del estado actual**: se leyeron y verificaron (mediante
   `grep`/`read`, con las líneas reales citadas en cada sección) `js/db.js`,
   `js/search.js`, `js/daily-check.js`, `js/api-movies.js`, `js/api-games.js`,
   `js/api-books.js`, `js/ui.js`, `js/modal-handlers.js`, `js/profile.js`,
   `js/activity-feed.js`, `js/tv-progress.js`, `js/release.js`,
   `js/sorting.js`, `js/settings.js`, `js/export-ics.js`,
   `js/export-backup.js`, `service-worker.js`, `firestore.rules`, `README.md`
   y los ADR-021, ADR-067, ADR-025, ADR-062, ADR-065 y ADR-066 entre otros.
2. **Límites documentados de cada API** consultados en las fuentes oficiales
   con fecha de consulta (2026-08-10) en la sección 11.
3. **Modelo cuantitativo declarado**: sin telemetría de uso real (la app no
   registra métricas), todas las cifras de tráfico son **estimaciones**
   construidas sobre un perfil de usuario declarado (sección 6). Cualquier
   cifra sin fuente externa está marcada como estimación con sus supuestos.

**Limitaciones**: no hay datos reales de tamaño de documentos (no se ha
podido medir Firestore desde este entorno); los tamaños por documento son
estimaciones de estructura basadas en los campos guardados al alta (sección
3.2). El límite efectivo de escrituras de Firebase Spark (20.000/día) proviene
de la documentación oficial de Firebase; el README.md:307 documenta solo
50.000 lecturas/día y 1 GiB. Los límites de las APIs pueden cambiar sin aviso
(a TMDB «esta cifra puede cambiar en cualquier momento», sección 11).

---

## 3. Estado actual

### 3.1 Arquitectura de datos y reglas

La app es 100 % cliente (Firebase Hosting, vanilla JS, PWA con service
worker, `js/firebase.js:7-29`). Los datos viven en Firestore con un modelo de
usuario → subcolecciones por tipo:

- `users/{uid}/movies/{id}`, `users/{uid}/series/{id}`,
  `users/{uid}/books/{id}`, `users/{uid}/games/{id}` y
  `users/{uid}/notifications/{id}` (`js/db.js:1-14` y
  `COLLECTION_BY_TYPE` en `js/db.js:33-38`).
- `users/{uid}` (documento de perfil) guarda email, nombre, foto y sellos de
  la pasada diaria (`lastReleaseCheckAt`, `lastManualSyncAt`;
  `js/db.js:44-46`, `js/daily-check.js:467` y `:525`).

`firestore.rules:21-27` permite registrarse solo a 3 correos (los "amigos");
cada usuario escribe solo en sus documentos y **cualquier usuario autorizado
puede leer los documentos de cualquier otro** (`allow read: if
isAllowedUser()` en `firestore.rules:36-57`) — prerrequisito de las secciones
Amigos y feed (ADR-015). Las notificaciones son privadas
(`firestore.rules:60-62`).

### 3.2 Campos guardados al alta, por tipo

Toda la persistencia se construye al alta en `js/search.js` (`handleAdd`,
`doAddBook`, `handleAddSeen`, `handleManualAdd`) y se actualiza con acciones
del usuario y con la pasada diaria. Verificado en el código real:

**Películas** — draft en `js/search.js:171-182` (ruta normal y
`js/search.js:429-442` en "marcada como vista"), enriquecido con
`getMovieDetails` (`js/search.js:187-189`) y sobreescrito a diario:

| Campo | Origen | Función/consumidor |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl`, `author`, `pages` | resultado de búsqueda (TMDB) | identidad + tarjeta (grid/lista, `js/ui.js:342-381` y `:455-498`) |
| `status`, `rating`, `notes`, `watchLog` | usuario (estados, valoración, notas, log de visionados) | tarjetas, ficha, ordenación (`js/sorting.js:81-107`), feed (`js/activity-feed.js:44-54`), estadísticas |
| `runtime`, `overview`, `genres`, `cast`, `director` | `getMovieDetails` (`js/api-movies.js:146-150`) | ficha (`extraInfoHtml`, `js/ui.js:623-665`) |
| `releaseDate`, `communityRating`, `trailerUrl` | `getMovieDetails` (`js/api-movies.js:151-153`) | aviso de estreno + badge «Aún no estrenada» (`upcomingBadge`, `js/ui.js:326-340`; `release.js:13-15`) y rating comunitario en tarjeta (`js/ui.js:46-53`) |
| `collectionId`, `collectionName`, `collectionPoster` | `getMovieDetails` (`js/api-movies.js:154-158`) | saga/colección en ficha y «Añadir resto de la saga» |
| `awaitingRelease`, `releasedNoticedAt` | lógica de avisos (`js/daily-check.js:271-281`) | campana de notificaciones |
| `manual` (solo alta manual), `addedAt`, `updatedAt` | alta/escritura (`js/db.js:96-109`) | filtros de pasada diaria (`js/daily-check.js:264`) y ordenación (`js/sorting.js:81`) |

**Series** — draft en `js/search.js:171-182`, enriquecido con
`getTvExtraDetails` (`js/search.js:200-206`) + estado de series del usuario
(`js/search.js:194-199`):

| Campo | Origen | Función/consumidor |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl` | búsqueda (TMDB) | tarjeta (ídem películas) |
| `watched`, `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history` | usuario (progreso de episodios) | ficha, progreso (`js/tv-progress.js:48-85`), feed (`js/activity-feed.js:57-154`), ordenación, estadísticas |
| `status`, `rating`, `notes` | usuario | tarjetas, ficha, feed, estadísticas |
| `episodeRuntime`, `overview`, `genres`, `cast`, `creators` | `getTvExtraDetails` (`js/api-movies.js:195-199`) | ficha (`extraInfoHtml`) |
| `firstAirDate`, `tmdbStatus`, `nextEpisodeToAir`, `communityRating`, `trailerUrl` | `getTvExtraDetails` (`js/api-movies.js:200-210`) | badge de estreno, aviso de premiere/episodio nuevo (`js/daily-check.js:321-342`), ordenación por bloqueados |
| `seasonAirDates` (mapa temporada→fecha, null = aún sin estrenar) | `getTvExtraDetails` (`js/api-movies.js:212-215`), normalizado en `seasonAirDateMap` (`js/api-movies.js:81-85`) | avisos de «no estrenado» incluso si TMDB deja de devolver `next_episode_to_air` (ADR-025; `js/sorting.js:20-36`; refresco en vivo en `js/modal-handlers.js:420-435`) |
| `nextEpisodeAirDate` (backfill persistido) | pasada diaria (`js/daily-check.js:139-143` y `ensureNextEpisodeAirDate` `:171-194`) | avisos entre temporadas |
| `manualEpisodeCount` (solo alta manual) | `js/search.js:634` | progreso de series manuales |
| `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` | lógica de avisos | campana de notificaciones |

**Libros** — draft en `js/search.js:66-80` (`doAddBook`) y
`js/search.js:277-291` (`doAddBookSeen`):

| Campo | Origen | Función/consumidor |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl`, `author`, `pages` | Google Books (principal; `js/api-books.js:146-160`) u Open Library (respaldo; `js/api-books.js:212-234`) | tarjeta y ficha |
| `status`, `rating`, `notes`, `progress`, `readLog` | usuario | tarjetas, ficha, feed (`js/activity-feed.js:156-173`), estadísticas |
| `description` | Google Books en el resultado, u Open Library bajo demanda al alta (`js/search.js:84-90`; `js/api-books.js:238-247`) | ficha (`extraInfoHtml`, `js/ui.js:661-662`) |

**Videojuegos** — draft en `js/search.js:134-144` y `js/search.js:365-376`,
enriquecido con `getGameDetails` (`js/search.js:146-152`; `js/api-games.js:202-228`):

| Campo | Origen | Función/consumidor |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl` | búsqueda IGDB (`js/api-games.js:144-159`) | tarjeta |
| `status`, `rating`, `notes`, `playLog`, `progress` (solo manual) | usuario | tarjetas, ficha, feed (`js/activity-feed.js:175-190`), estadísticas (ADR-070) |
| `description`, `genres`, `platforms`, `developers`, `publishers`, `esrbName`, `metacritic` (siempre null), `playtime` (siempre null) | `getGameDetails` (`js/api-games.js:209-221`) | ficha (`extraInfoHtml`, `js/ui.js:643-660`) |
| `releaseDate`, `communityRating`, `trailerUrl` | `getGameDetails` / `mapGameResult` | aviso de lanzamiento (ADR-071; `js/daily-check.js:434-464`), badge, rating comunitario IGDB |
| `awaitingRelease`, `releasedNoticedAt` | lógica de avisos (`js/daily-check.js:443-456`) | campana |

Notas de esta sección (verificado en el código):

- El alta arrastra siempre el **snapshot completo enriquecido**: películas y
  series llaman a `getMovieDetails`/`getTvExtraDetails` en el alta
  (`js/search.js:187` y `:201`), y los juegos a `getGameDetails`
  (`js/search.js:146`), cuyos resultados se `Object.assign` al draft con el
  bloque «no bloqueamos el alta si este paso extra falla»
  (`js/search.js:153-155`, `:190-192`, `:207-209`).
- `releaseDate` **truthy obligatorio** para películas/series/juegos:
  `isUnreleasedDate(null)` devuelve true (`js/release.js:13-15`) y un ítem sin
  fecha quedaría `awaitingRelease` para siempre (`js/search.js:149-152`).
- Los ítems manuales guardan `externalId` sintético `manual-…`
  (`js/search.js:606-608`) y `manual: true`; se excluyen de la pasada diaria
  y de los avisos TMDB.

### 3.3 Refresco diario y sincronización (ADR-021)

`js/daily-check.js` (`checkForUpdates`, `:217`) ejecuta una pasada diaria por
usuario y un botón «Sincronizar ahora» (`syncNow`, `:491`; ADR-021). Mecánica
verificada:

- **Cobertura total**: todos los ítems no manuales con `externalId`
  (películas `:264`, series «incluidas las abandonadas» `:302`, libros de
  Open Library `/works/` `:406`) se consultan a la API y se sobrescriben con
  política **truthy-only** (`buildMovieUpdates` `:102-119`,
  `buildTvUpdates` `:123-158`, `buildBookUpdates` `:162-165`): un campo se
  actualiza solo si el valor fresco es no vacío. Excepción:
  `nextEpisodeToAir`/`seasonAirDates` se sobrescriben siempre
  (`js/daily-check.js:133-144` y `:154-156`, documentado en ADR-021).
- **Videojuegos NO se refrescan**: la pasada no consulta IGDB en ningún caso
  (`js/daily-check.js:10-12` y `:434-464`); solo avisa de lanzamientos con
  los datos guardados (criterio ADR-071).
- **Límites de la pasada**: pool de 4 peticiones concurrentes
  (`REFRESH_CONCURRENCY = 4`, `:26`, con `mapConcurrent` `:80-96`), aborto si
  se encadenan más de 5 fallos consecutivos (`MAX_CONSECUTIVE_FAILURES = 5`,
  `:29`, comprobado en `:290-295`), cooldown de 30 min para la sincronización
  manual (`MANUAL_SYNC_COOLDOWN_MS = 30 min`, `:24`, `:504-509`), guard diario
  `lastReleaseCheckAt === today` (`:248`), flag anti-concurrencia `isRefreshing`
  (`:35`, `:238-239`).
- El disparo de la pasada ocurre al cargar la app una vez por sesión
  (`maybeTriggerDailyCheck`, `js/app.js:124-129`).

### 3.4 Consumidores de los campos guardados

Qué lee cada consumidor del documento (y con qué dependencia de red):

| Consumidor | Archivo:línea | Datos que usa del documento | ¿Tiene red? |
|---|---|---|---|
| Tarjetas grid/lista (título, año, portada, estado, estrellas, rating comunitario, progreso, badge de estreno) | `js/ui.js:342-381` (`renderGrid`), `:455-498` (`renderList`), `:326-340` (`upcomingBadge`), `:46-53` (`communityRatingHtml`), `:257` (`progressLine`) | casi todos los campos | no (snapshot en memoria vía `onSnapshot`) |
| Ficha modal (información ampliada) | `js/ui.js:623-665` (`extraInfoHtml`), `openMovieModal` `:965`, `openBookModal` `:1196`, `openGameModal` `:1316`, `openTvModal` `:1554` | runtime/episodeRuntime, overview/description, genres, cast, director, creators, developers/publishers/metacritic/esrbName/playtime, tráiler | `js/modal-handlers.js:115` (`getWatchProviders`), `:126` (`getSimilarMovies`), `:443`, `:512` — llamadas en vivo al abrir la ficha, cacheadas 24 h en memoria (`js/api-movies.js:227-243`) |
| Progreso de series | `js/tv-progress.js:48-85` (`computeProgress`), `js/modal-handlers.js:408-437` | `watched`, `seasonAirDates` + **temporadas en vivo** de TMDB (`getTvSeasonsMeta`, `js/api-movies.js:90-96`) | temporadas sí (la ficha de serie consulta TMDB); `getSeasonEpisodes` con caché 24 h (`js/api-movies.js:102-119`) |
| Avisos de estreno/episodio | `js/daily-check.js:217-475`, `js/release.js:13-80`, `js/sorting.js:20-60` | `releaseDate`, `firstAirDate`, `nextEpisodeToAir`, `seasonAirDates`, `nextEpisodeAirDate`, `awaitingRelease`, `lastNotifiedEpisode` | pasada diaria sí (TMDB/OL), juegos no |
| Amigos (solo lectura) | `js/db.js:65-70` (`getItemsOnce`), `js/profile.js:411-451` (`openFriend`), `js/ui.js:2126-2164` (`openReadOnlyModal`) | copia puntual de TODOS los documentos del amigo | solo Firestore (sin APIs) |
| Feed de actividad | `js/profile.js:587-630` (`loadActivityFeed`), `js/activity-feed.js:40-202` (`buildFriendFeed`) | `watchLog`, `watched`, `history`, `readLog`, `playLog`, `status`, `updatedAt`, `pages`, `progress` | solo Firestore |
| Exportación ICS | `js/export-ics.js:120-197` (`collectUpcomingEvents`) | `nextEpisodeToAir`, `releaseDate`, `title`, `overview`, `playLog`, `status`, `awaitingRelease` | no |
| Backup/restore | `js/export-backup.js:29-93` (`exportBackup`), `:100-240` (`importBackup`) | **documentos completos** (metadatos incluidos) | solo Firestore |
| Estadísticas | `js/profile.js:72` (`computeStats`), consumida en `js/profile.js:207-217` (`renderStats`→tiles, gráficas) | `watchLog`, `watched`, `readLog`, `playLog`, `status`, `genres`, `platforms`, `timesCompleted` | no (ctx en memoria) |
| Ordenación y filtros | `js/sorting.js:20-145` (`getSortDate`, `isItemUnreleased`, `applySort`), `js/app.js:115-121` | `watchLog`, `lastWatchedAt`, `readLog`, `playLog`, `releasedNoticedAt`, `releaseDate`, `nextEpisode`, `awaitingRelease` | no |
| Edición manual de metadatos | `js/ui.js:739-778` (`openEditModal`), `saveMeta` en `modal-handlers.js` | título, año, autor, páginas, portada (campos editables) | Firestore |
| Búsqueda «Añadir resto de la saga» | `js/api-movies.js:166-185` (`getCollectionDetails`) | `collectionId`, `collectionName` del documento | sí, al pulsar el botón |
| Recomendaciones | `js/api-movies.js:284-296` | `externalId` | sí, bajo demanda |

### 3.5 Cachés y red existentes

- **Service worker** (`service-worker.js`): `cacheFirst` para imágenes de
  TMDB, Open Library e IGDB (`:287-303`); `networkFirst` para
  `api.themoviedb.org`, `www.googleapis.com` y `openlibrary.org`
  (`:305-313`) y para lecturas Firestore GET (`:315-322`); escrituras de
  Firestore y auth pasan sin intervención (`:221-234`). La **caché dinámica
  tiene tope de 50 entradas** (`DYNAMIC_MAX_ENTRIES = 50`, `:21`, poda en
  `trimCache` `:204-212`).
- **Caché en memoria de 24 h** (`js/api-movies.js:227-243`): watch providers
  y episodios de temporada (`getSeasonEpisodes` `:102-119`).
- Offline: las fichas de ítems visitados previamente se sirven de caché del
  SW (hasta 50 URLs); las tarjetas vienen de Firestore (GET cacheado por el
  SW ante caídas de red).

### 3.6 Límites de plataforma y APIs (fuentes en sección 11, consulta 2026-08-10)

| Plataforma/API | Límite | Nota |
|---|---|---|
| Firebase Firestore Spark (gratis) | **50.000 lecturas/día**, **20.000 escrituras/día**, **1 GiB de almacenamiento**, 1 MiB por documento | 50K/1 GiB documentados en `README.md:307`; 20K escrituras en la documentación oficial de Firebase |
| TMDB | ~**40-50 req/s** (techo de mitigación anti-scraping; la doc oficial dice «40 requests per second range» y que «puede cambiar en cualquier momento») | sin cuota diaria publicada; respetar 429 |
| IGDB (vía Cloudflare Worker `cloudflare/igdb-proxy`) | **4 req/s** | documentado en `cloudflare/igdb-proxy/README.md:54` («admite 4 peticiones por segundo») |
| Google Books | **1.000 consultas/día por clave** por defecto (cuota diaria configurable) y ~100 consultas/100 s por usuario | el README de la app documenta los reintentos ante 503 (`README.md:288-297`) |
| Open Library | sin límite publicado (cortesía: ~1 req/s recomendado por la comunidad) | respaldo de Google Books y sinopsis bajo demanda (`js/api-books.js:162-247`) |

### 3.7 Coste actual estimado (baseline A0)

Con el perfil medio de la sección 6 (480 ítems, M=3 usuarios, L=5 aperturas,
D=20 fichas, V=2 vistas de amigo, 1 pasada diaria + 1 sync manual/semana;
todas cifras **estimadas**):

- **Llamadas a APIs por usuario y día**: ~410 TMDB (300 películas + 100
  series + ~10 backfills de temporada) + ~35 Open Library (libros `/works/`)
  + 0 IGDB ≈ **~445**. En la pasada, con pool 4 y ~250-400 ms de latencia por
  llamada, el pico dura ~25-40 s por usuario (asíncrono, en segundo plano).
- **Escrituras Firestore por usuario y día**: ~100 de la pasada (películas
  ~10 %, series ~65 % con `nextEpisodeToAir`/`seasonAirDates`,
  libros ~15 %, juegos ~0) + ~20 de acciones del usuario ≈ **~120**
  (≈ 1,8 % del tope diario entre los 3 usuarios: 360 de 20.000).
- **Lecturas Firestore por usuario y día**: ~486 por carga de app (4
  subcolecciones suscritas + perfil + notificaciones; `onSnapshot`,
  `js/db.js:79-94`) × 5 aperturas ≈ 2.430 + vistas de amigo (2 × 1.920 =
  3.840) + feed (1 × 1.920-3.840) ≈ **~10.100** (×3 usuarios ≈ 30.300/día =
  61 % del tope; cada snapshot de escritura añade lecturas extra).
- **Almacenamiento**: ~2,2 MB por usuario medio (Anexo A.1) ≈ 6,6 MB en
  total ≈ **0,6 % del GiB** de Spark (no es un factor limitante).

Conclusión del baseline: hoy NO se golpean los límites, pero el coste de
API y de escrituras es **proporcional al tamaño de la biblioteca** y crece
con la cobertura total del ADR-021 (que fue justamente la decisión de la
issue #23), y las lecturas son el componente que más se acerca a un tope.

---

## 4. Alternativas de almacenamiento

### 4.0 A0 — Statu quo (snapshot completo + refresco diario masivo)

**Qué se guarda**: todo lo de la sección 3.2 (snapshot completo al alta +
refresco truthy-only diario para películas/series/libros; juegos sin
refresco).

**Flujo**: el alta consulta las APIs y persiste; la pasada diaria vuelve a
consultar TODO y reescribe lo que cambia; la UI lee solo de Firestore.

**Ventajas**: cero cambios; tarjetas y fichas 100 % offline sin lógica nueva;
ficha instantánea; los datos de API están siempre curados (ADR-021).

**Inconvenientes** (medidos en 3.7): ~445 llamadas/día/usuario a APIs;
~120 escrituras/día/usuario; ~2,2 MB/usuario; el coste escala con N y con el
número de usuarios; duplica trabajo de la API con la BD (misma info en dos
sitios, verificación diaria de que no ha cambiado).

### 4.1 A1 — Solo `externalId` + datos del usuario; todo lo demás en vivo

**Qué se guarda**: `externalId`, `type`, `status`, `rating`, `notes`,
`watchLog`/`watched`/`readLog`/`playLog`/`history`/`progress`, y nada más.
Todo lo demás (título, portada, año, fechas, sinopsis, rating comunitario,
tráiler, colección…) se pediría a la API en cada render y en cada ficha.

**Cuantificación del colapso** (supuestos de la sección 6; la app NO pagina
las tarjetas — `renderGrid`/`renderList` pintan el array completo,
`js/ui.js:342-381` y `:455-498`):

- **Abrir la pestaña de películas = ~300 llamadas a TMDB** (una por tarjeta).
  Con el pool de 4 del daily-check (~300 ms por llamada) ≈ **23 s** de
  carga; con el límite del navegador de ~6 conexiones por host ≈ **15 s**.
  Cada cambio de orden/filtro con re-render volvería a pedirlo (a menos de
  construir una caché viva nueva desde cero).
- **Abrir la pestaña de videojuegos = ~30 llamadas a IGDB = 7,5 s mínimos**
  por el límite de 4 req/s (sección 3.6), más espera de colas. Con los 3
  usuarios simultáneos, 90 llamadas = 22,5 s.
- **Amigos = M×N llamadas**: abrir el registro de 2 amigos de tamaño medio =
  960 llamadas (TMDB 800 + IGDB 60 con ~15 s solo por los juegos), cada vez
  que se abre la sección. El feed (que ya lee todo el archivo de cada amigo,
  `js/profile.js:597-611`) añadiría lo mismo. La cuota se dispara a nivel de
  cuenta API, compartida entre amigos.
- **Notificaciones: NO ahorra nada**: el aviso de estreno exige conocer
  `releaseDate`/`firstAirDate`/`nextEpisodeToAir` frescos, y `isUnreleasedDate`
  necesita fecha (o ausencia) por ítem (`js/release.js:13-15`); sin esos campos
  en BD, la pasada diaria seguiría llamando a TMDB por **todos** los ítems
  (~410 llamadas/día). La única ganancia sería guardar menos bytes.
- **Rompe offline**: sin `title`/`coverUrl`/`status` en el documento, el SW
  (`networkFirst`, `service-worker.js:305-322`) no puede pintar tarjetas ni
  la ficha sin red; echa abajo la PWA y el «guard diario sin red» de los
  juegos (`js/daily-check.js:429-433`).
- **Rompe/degrada consumidores locales**: ordenación por actividad y bloqueo
  (`js/sorting.js:81-107`), estadísticas (`js/profile.js:72`, `:207-217`), ICS
  (`js/export-ics.js:120-197`) y feed dependen de fechas y logs guardados
  (esos sí se mantendrían), pero el orden alfabético/año requeriría
  `title`/`year` en vivo.

**Veredicto**: descartada con números: sobrecarga las APIs a nivel de pestaña
(criterio de aceptación 5), destruye la UX de primer render, rompe offline y
no ahorra las llamadas del sistema de avisos.

### 4.2 A2 — Híbrido (la opción de la issue): campos de tarjeta + campos de notificación en BD; detalles bajo demanda con caché

**Qué se guarda**: los campos que la UI necesita **sin red** (tarjeta
completa: `externalId`, `type`, `title`, `year`, `coverUrl`, `status`,
`rating`, `notes`, logs del usuario, `releaseDate`/`firstAirDate`,
`nextEpisodeToAir`/`nextEpisodeAirDate`, `seasonAirDates`, `awaitingRelease`,
`releasedNoticedAt`, `lastNotifiedEpisode`, `manual`, `addedAt`/`updatedAt`,
y `communityRating` — ver decisión explícita en 8.1) y **bajo demanda con
caché** los detalles de ficha (`overview`/`description`, `runtime`,
`episodeRuntime`, `genres`, `cast`, `director`, `creators`, `trailerUrl`,
`collection*`, `platforms`, `developers`, `publishers`, `esrbName`,
`metacritic`, `playtime`). Los libros conservan `author`, `pages` y
`description` en BD por ser campos que la propia tarjeta/ficha consume al
instante (ver 8.1, excepción justificada).

**Flujo**: alta = guardar tarjeta en BD (sin la llamada de enriquecimiento o
con ella opcional, decidiéndolo en 8/10); render de pestañas y notificaciones
= solo Firestore (0 llamadas API); apertura de ficha = 1-2 llamadas API por
ítem, cacheadas en memoria 24 h (patrón ya existente:
`js/api-movies.js:102-119` y `:227-243`) y aprovechando la `networkFirst` del
SW (`service-worker.js:305-313`) para offline tras la primera visita.

**Ventajas** (medidas en sección 7): tarjetas instantáneas y offline; ficha
con 1-2 llamadas en lugar de ~480 ya pagadas hoy; notificaciones intactas con
la pasada mínima A5-a; almacenamiento ~-59 %; escrituras ~-70 %; sin
infraestructura nueva.

**Inconvenientes honestos** (desarrollados como contraargumentos en 8.2):
pérdida de curado diario de los datos de ficha; la pasada diaria mínima ya no
es «gratis total» (sigue siendo necesaria para los avisos, aunque ~7 veces
más barata); primera apertura de ficha requiere red (o caché SW con tope de
50); migración de los documentos existentes.

### 4.3 A3 — Almacenamiento solo local (IndexedDB/localStorage)

**Qué se guardaría**: todo en el dispositivo; Firestore quedaría solo para
identidad.

**Por qué se descarta con datos**:

1. **Amigos y feed rotos por diseño**: ambos leen los documentos de otros
   usuarios (`firestore.rules:36-57` lo permite expresamente; `js/profile.js:411-451`
   y `:587-630`). Sin datos en Firestore no hay nada que leer (o habría que
   duplicar escrituras, volviendo al problema original).
2. **Multi-dispositivo perdido**: la app es una PWA usada desde varios
   navegadores; Firestore es la única fuente compartida (función de
   sincronización real-time, `js/db.js:79-94`).
3. **Notificaciones rotas**: el aviso de estreno se decide en la pasada
   diaria comparando fechas (`js/daily-check.js:271-281`); sin datos en la
   nube, cada dispositivo avisaría de forma independiente (o no avisaría si
   está cerrado) y el push de dispositivo (`js/push.js`, ADR-037) perdería su
   base común.
4. **Backup/ICS/estadísticas** se vuelven por-dispositivo (hoy usan Firestore).

**Veredicto**: descartada: resuelve el coste de red a costa de destruir las
funcionalidades sociales y multi-dispositivo del proyecto, que dependen de que
los datos estén en Firestore.

### 4.4 A4 — Capa proxy / caché centralizada (tipo Worker IGDB, precedente ADR-067)

**Qué sería**: un backend ligero (p. ej. Worker de Cloudflare, como el
existente `cloudflare/igdb-proxy/` — ADR-067) que actúe de caché común de
detalles TMDB/IGDB/GB/OL con TTL, para que una ficha solicitada por un
usuario sirva también a los demás.

**Evaluación**:

- **Precedente real**: el proyecto ya tiene un Worker como proxy de IGDB
  (`cloudflare/igdb-proxy/worker.js`), pero es un **reenvío sin caché**: solo
  oculta el Client Secret y el límite de IGDB cuando se adopte A1/A2 seguiría
  aplicando al origen.
- **Para 3 usuarios no compensa**: la cuenta TMDB es única y compartida; una
  ficha abierta por 2 amigos genera 2 llamadas igualmente. La caché solo
  ahorra cuando el mismo ítem se repite en breve (efecto ya cubierto por la
  caché de memoria 24 h y el SW). El ahorro marginal no justifica operar y
  vigilar un servicio nuevo (función `isRefreshing` y guardas a nivel de
  cliente serían más complejas).
- **Riesgo**: una caché centralizada que devuelva datos viejos atacaría
  justo la garantía que ADR-021 instauró; exigiría invalidación por TTL y por
  versión, y la ficha seguiría necesitando la llamada en caliente en el
  primer usuario.
- **Opción futura**: si el grupo creciera (sección 6, escenario M=10) y un
  mismo estreno se consultara muchas veces, este sería el siguiente paso
  natural; hoy no.

**Veredicto**: no compensa ahora; se documenta como evolución futura
(sección 10).

### 4.5 A5 — Variantes de refresco sobre A2

Cuatro variantes sobre la pasada diaria, evaluadas sobre el mismo esquema A2:

| Variante | Descripción | Coste API/día/usuario (medio) | Veredicto |
|---|---|---|---|
| **A5-a (RECOMENDADA)**: pasada mínima de avisos | Solo se consulta la API para ítems `awaitingRelease` (películas/series/juegos sin estrenar) y series en curso con `nextEpisode` pendiente (para detectar emisión de episodio nuevo y auto-standby, ADR-033). Libros: solo los `/works/` sin `description`. | ~65 TMDB (15 pelis + 40 series en curso + ~10 series awaiting) + ~5 OL ≈ **~70** (vs 445) | conserva todos los avisos y el auto-standby con ~85 % menos llamadas; no reseca metadatos de ficha (bajo demanda) |
| A5-b: sin pasada (stale-while-revalidate en ficha) | Cero pasada programada; la ficha revalida los datos al abrirse (y guarda el resultado). | ~50-80 (solo fichas; D=20) | viable si se acepta que los avisos dependan de que el usuario abra fichas: **rompe los avisos** (un ítem nunca abierto nunca se avisa) → rechazada como única vía |
| A5-c: pasada semanal | Igual que A5-a pero cada 7 días (÷7). | ~10/día de media | ahorra más, pero retrasa hasta 7 días avisos de estreno/episodio; con M=3 usuarios el coste ya es bajo → no merece el riesgo de UX |
| A5-d: pasada diaria solo campos de notificación | Igual que A5-a pero pidiendo solo lo necesario (en TMDB, `append_to_response` mínimo). | ~70 (igual) | es en la práctica A5-a; las llamadas no se pueden reducir más por ítem (TMDB no tiene endpoint de fechas lite) |

**Conclusión de A5**: A5-a es la variante recomendada: conserva el 100 % del
sistema de avisos actual con ~85 % menos llamadas API (~445 → ~70) y ~70 %
menos escrituras que A0 (~120 → ~35).

---

## 5. Criterios de evaluación y métricas

Diez criterios, con su métrica y dirección de bondad:

| # | Criterio | Métrica | Mejor si… |
|---|---|---|---|
| C1 | Coste Firestore: lecturas | lecturas/día/usuario (y global) | ↓ |
| C2 | Coste Firestore: escrituras | escrituras/día/usuario | ↓ |
| C3 | Coste Firestore: almacenamiento | bytes por documento y total (vs 1 GiB) | ↓ |
| C4 | Llamadas a APIs (TMDB, GB, OL, IGDB) | llamadas/día/usuario y **picos por acción** (abrir pestaña, abrir ficha, abrir amigo) | ↓ y sin picos violentos |
| C5 | Latencia/UX | tiempo hasta primer render de pestaña y de ficha | instantáneo en tarjetas; ficha < 1 s online |
| C6 | Offline/PWA | qué se puede ver sin red (tarjetas, fichas visitadas, avisos pendientes) | tarjetas siempre; fichas tras primera visita |
| C7 | Amigos y feed | nº llamadas API por visita a sección Amigos/feed (M×N) | 0 (solo Firestore) |
| C8 | Notificaciones de estrenos | garantías de detección (plazo máximo) y llamadas necesarias | detección ≤ 24 h con pocas llamadas |
| C9 | ICS / backup / estadísticas | qué campos necesitan y cuánta red | sin red; autónomos del snapshot de metadatos |
| C10 | Complejidad / riesgo de migración | archivos a tocar, migración de datos existentes, riesgo de regresión | mínimo |

---

## 6. Modelo cuantitativo

**Perfil base (usuario medio)**: 300 películas, 100 series, 50 libros,
30 videojuegos = **480 ítems**. Escenarios de sensibilidad: usuario pequeño
(50/20/10/5 = 85), medio (300/100/50/30 = 480) y grande (1.000/300/150/100 =
1.550).

**Parámetros de actividad (estimados, sin telemetría)**:

| Parámetro | Valor | Supuesto |
|---|---|---|
| M (usuarios) | 3 hoy (los de `firestore.rules:22-26`); escenario M=10 | grupo pequeño de amigos |
| L (aperturas de la app/día) | 5 | pestañas del navegador / recargas |
| D (fichas abiertas/día) | 20 | consulta realista de fichas |
| V (vistas a sección Amigos/día) | 2 | — |
| F (aperturas del feed/día) | 1 | — |
| Pasada diaria | 1/día (`js/daily-check.js:248`) + 1 sync manual/semana | ADR-021 |
| Latencia TMDB/OL por llamada | 250-400 ms | red doméstica |
| Pool de la pasada | 4 concurrentes (`js/daily-check.js:26`) | implementación real |
| Límite navegador por host | ~6 conexiones | HTTP/1.1 estándar |

**Fórmulas (todas las cifras marcadas como estimaciones)**:

- `LlamadasApi(A0) = P+S+0,1·S+(0,7·B)` (pasada: 1 llamada por película y por
  serie no manual + 10 % de serie con backfill de temporada + 70 % de libros
  `/works/`) → medio: 300+100+10+35 = **445**.
- `LlamadasApi(A1, abrir pestaña X) = N del grupo` (cada tarjeta en vivo) →
  películas 300, juegos 30 (≈ 7,5 s a 4 req/s). `Abrir amigo = M·N` (todos
  los grupos) → 960 para 2 amigos de tamaño medio.
- `LlamadasApi(A2) = D·(1,2 TMDB + 0,5 OL) + pasadaMinima` → 20·1,7 = 34 +
  70 ≈ **~105-125**.
- `LlamadasApi(A5-a) = 0,05·P + 0,4·S + 0,1·S + 0,1·B` (5 % de películas
  awaitingRelease, 40 % series en curso, 10 % series awaitingRelease, 10 %
  de libros `/works/` sin sinopsis) → 15+40+10+5 = **~70**.
- `EscriturasFirestore(A0) = ~0,1·P+0,65·S+0,15·B+0,1·G + 20` (acciones de
  usuario) → 30+65+7+0+20 ≈ **~120**.
- `EscriturasFirestore(A2+A5-a) = ~0,02·P+0,1·S+0,02·B + 20` (2 % de
  películas/juegos con revalidación en ficha, 10 % de series) → 6+10+1+20 =
  37 ≈ **~35** (redondeo; ahorro frente a A0 ≈ **-70 %** en ambos casos).
- `LecturasFirestore = (4 colecciones+perfil+campana)·L + V·4colecciones·N +
  F·(M-1)·4colecciones·N` → (486)·5 + 2·1.920 + 1·3.840 ≈ **~10.100**
  (idéntico en A0 y A2: no depende de los campos, sino del nº de documentos).
- `Espacio = ΣN_t·tamaño_medio_t` (Anexo A.1).

**Tabla de sensibilidad** (todas columnas son estimaciones; perfil → tamaño
medio por tipo según el Anexo A.1; nombre de usuario medio en negrita):

| Escenario | ítems | Almac. A0 | Almac. A2 | Llamadas A0/día | Llamadas A2+A5-a/día | Lecturas Firestore/día (M=3) |
|---|---|---|---|---|---|---|
| Pequeño (50/20/10/5) | 85 | ~340 KB | ~150 KB | ~85 | ~25 | ~6.500 |
| **Medio (300/100/50/30)** | **480** | **~2,2 MB** | **~0,9 MB** | **~445** | **~125** | **~30.300** |
| Grande (1000/300/150/100) | 1.550 | ~7,4 MB | ~3,1 MB | ~1.470 | ~390 | ~107.000 (requeriría plan de pago o reducir suscripciones) |

*Nota: las llamadas A2+A5-a de la tabla asumen que las fichas abiertas al
día (D) escalan con la biblioteca (≈7 % de los ítems; D = 20 → ~105 en el
perfil grande, D ≈ 6 en el pequeño), igual que la pasada mínima; con D fijo
en 20 las cifras serían ~47 (pequeño) y ~73 (grande), y las conclusiones no
cambian.*

---

## 7. Evaluación comparativa

Matriz A0–A5 sobre los criterios de la sección 5 (cifras para el usuario
medio; supuestos de la sección 6; ▲ bueno, ● aceptable, ▼ malo):

| Criterio | A0 | A1 | A2+A5-a | A3 | A4 |
|---|---|---|---|---|---|
| C1 Lecturas Firestore | ● ~10.100/día/usuario (61 % del tope con M=3) | ● idéntico (no reduce lecturas) | ● idéntico | ▼ n/a (no compartido) | ● idéntico |
| C2 Escrituras | ▼ ~120/día | ▲ ~20 (pero con coste C4) | ▲ ~35 | ▲ 0 (pero C7 roto) | ▲ ~35 |
| C3 Almacenamiento | ▼ ~2,2 MB/usuario | ▲ ~0,45 MB | ▲ ~0,9 MB | — | ▲ ~0,9 MB |
| C4 Llamadas API | ▼ ~445/día | ▼▼ ~5.000-6.700/día + **picos 300 por pestaña de películas y 960 por amigo** | ▲ ~125/día, sin picos | ▲ 0 (degradación social) | ▲ ~125/día |
| C5 Latencia | ▲ tarjetas y fichas instantáneas | ▼▼ pestañas 15-23 s, juegos 7,5 s mínimos | ▲ tarjetas instantáneas; ficha ~0,3-1 s | ▲ | ▲ |
| C6 Offline | ▲ tarjetas + fichas visitadas (SW) | ▼ sin tarjetas offline | ▲ tarjetas + fichas visitadas | ▼ solo dispositivo local | ▲ |
| C7 Amigos/feed | ▲ solo Firestore | ▼▼ M×N llamadas por visita | ▲ solo Firestore | ▼▼ roto | ▲ |
| C8 Notificaciones | ▲ 100 % avisos ≤ 24 h | ▼ mismo coste que A0 (sin ahorro) | ▲ avisos ≤ 24 h con pasada mínima | ▼ roto | ▲ |
| C9 ICS/backup/estadísticas | ▲ | ● parcial (fechas/logs sí; metadatos de ficha no incluibles en backup) | ▲ (backup conserva tarjeta completa) | ▼ por-dispositivo | ▲ |
| C10 Complejidad/riesgo | ▲ (baseline) | ▼▼ reescritura total de renders | ● medio (migración + fichas bajo demanda) | ▼▼ abandono de Firestore | ▼▼ infraestructura nueva |

**Lectura de la matriz**: A1 y A3 quedan eliminados por criterios C4-C8 con
datos cuantitativos; A4 no demuestra beneficio para M=3; A2+A5-a gana o
empata en todos los criterios salvo en los contraargumentos puntuales de la
sección 8.2 (frescura de metadatos de ficha, primera apertura de ficha
offline), que tienen mitigaciones en las secciones 9 y 10.

---

## 8. Recomendación y justificación

**Se recomienda adoptar A2 (híbrido) con la variante de refresco A5-a** en
una futura issue de implementación (fuera del alcance de este estudio, que
no implementa nada). La justificación: (1) es la única alternativa que
reduce el tráfico a APIs (~-72 % de llamadas, -85 % en la pasada) sin
degradar la UX, el offline ni las funciones sociales; (2)
aprovecha cachés ya existentes (`service-worker.js:305-313`,
`js/api-movies.js:227-243`); (3) el ahorro de almacenamiento, aunque
significativo (-59 %), demuestra que no es el factor crítico (el tope real
está en lecturas y en el ratio llamadas/usuarios).

### 8.1 Campos a guardar SIEMPRE en Firestore

| Grupo | Campos | Motivo |
|---|---|---|
| Identidad + tarjeta | `externalId`, `type`, `title`, `year`, `coverUrl` | sin red no hay tarjeta (grid/lista, `js/ui.js:342-381`) |
| Estado del usuario | `status`, `rating`, `notes`, `watchLog`, `watched` (+ `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history`), `readLog`, `playLog`, `progress`, `manual` | datos exclusivos del usuario; los consumen feed, estadísticas, ordenación e ICS sin red |
| Avisos (notificaciones) | `releaseDate` (películas/juegos), `firstAirDate`, `nextEpisodeToAir`, `nextEpisodeAirDate`, `seasonAirDates` (series), `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` | sin ellos no hay aviso de estreno ni badge de «no estrenada»; permiten la pasada mínima A5-a |
| Libros (excepción justificada) | `author`, `pages`, `description` | la tarjeta y la ficha de libro los pintan al instante y la ficha no tiene llamada de detalle (Google Books/OL solo dan descripción en la búsqueda); re-consultar la sinopsis en cada ficha añadiría llamadas por ítem sin valor |
| Control | `manual`, `addedAt`, `updatedAt` | ordenación estable (`js/sorting.js:81`) y sellos de la pasada |
| Rating comunitario | `communityRating` **se guarda** (decisión explícita) | la tarjeta lo muestra (`js/ui.js:46-53`); guardarlo (8 bytes) evita una llamada por tarjeta; su frescura se recupera con *stale-while-revalidate* al abrir la ficha (sección 9, mitigación M2) |

### 8.2 Campos bajo demanda (con caché en memoria 24 h + networkFirst del SW)

`overview`/`description` (no libros), `runtime`, `episodeRuntime`, `genres`,
`cast`, `director`, `creators`, `trailerUrl`, `collectionId/Name/Poster`
(películas), `platforms`/`developers`/`publishers`/`esrbName`/`metacritic`/
`playtime` (juegos). Todos ellos solo se ven en la ficha
(`extraInfoHtml`, `js/ui.js:623-665`), y la ficha ya hace llamadas en vivo a
`getWatchProviders`/`getSimilarMovies` (`js/modal-handlers.js:115`, `:126`,
`:443`, `:512`) con la caché 24 h existente.

### 8.3 Contraargumentos honestos (obligatorio considerarlos)

1. **Pérdida de frescura de metadatos en tarjetas/ficha**: hoy la pasada
   diaria cura `communityRating`, `trailerUrl`, colección y portadas
   (ADR-021; `js/daily-check.js:112-117`, `:145-148`). Con A2, una portada
   retirada de TMDB o una nota que sube dejan de refrescarse solas. **Matiz**:
   el impacto visual real es bajo (título/año/portada rara vez cambian), y la
   ficha (que es donde se consume el resto) revalida al abrirse — siempre que
   se implemente el *stale-while-revalidate* (M2). La portada sí es un campo
   sensible: se recomienda revalidarla también al abrir la ficha y, en todo
   caso, no quitarla del documento (costo negligible).
2. **Los avisos de estreno requieren una pasada mínima (A5-a)**: la issue
   plantea «no mantener una actualización de datos de base de datos»; con
   A2+A5-a sí queda una pasada diaria, pero **~85 % más barata** que hoy y
   limitada a ítems con `awaitingRelease`/series en curso. La alternativa
   «cero pasada» (A5-b) rompería los avisos para los ítems que el usuario no
   abre: se rechaza. Si el usuario quisiera ahorrar hasta la última llamada,
   la única vía sería avisar solo al abrir la app (degradación del servicio,
   no recomendada).
3. **Latencia/offline de la primera apertura de ficha**: la ficha necesita
   red la primera vez que se abre un ítem concreto; el SW la cachea
   (`networkFirst`, `service-worker.js:305-313`) pero **con tope de 50
   entradas** (`DYNAMIC_MAX_ENTRIES`, `:21`). Con 480 ítems, la LRU expulsa
   pronto. **Mitigación obligada** en la implementación: subir el límite o
   persistir las respuestas de detalle en IndexedDB por `externalId`+tipo
   (sección 10). Las tarjetas nunca pierden el offline.
4. **Fichas de amigos read-only**: hoy muestran el snapshot guardado
   (`openReadOnlyModal`, `js/ui.js:2126-2164`). Con A2, si el amigo no ha
   abierto esa ficha, el lector tendría que hacer el fetch on-demand (cuota
   **del lector**, compartida entre todos los amigos) o mostrar solo la
   tarjeta (degradación). Se recomienda el fetch on-demand opcional con
   caché y degradación elegante a «solo tarjeta» si falla (sección 10).
5. **IGDB a 4 req/s**: el enriquecimiento bajo demanda de juegos
   (`getGameDetails`) debe serializarse con **throttle ≤ 4 req/s**
   (actualmente un solo juego al añadir no lo necesita; una ficha sí, y
   varias fichas seguidas lo exigirían). Reutilizar el patrón `mapConcurrent`
   de `js/daily-check.js:80-96` o un semáforo simple.
6. **Backup/restore deja de incluir metadatos de ficha**: el backup actual
   exporta documentos completos (`js/export-backup.js:44-49`); con A2, un
   restore traería tarjetas sin sinopsis/cast/tráiler hasta que se abra cada
   ficha (refetch al restaurar o al navegar). Aceptable: el restore que
   importa (`:100-240`) ya recrea documentos; habría que re-enriquecer.
7. **El botón «Sincronizar ahora» (ADR-021) pierde sentido**: su función era
   curar TODO desde las APIs (`syncNow`, `js/daily-check.js:491-531`);
   con A2+A5-a solo tendría sentido como «revalidar pendientes de estreno»
   (y mantendría su cooldown de 30 min). Habría que **redefinirlo** (texto,
   alcance y card de Ajustes, `js/settings.js:277`).
8. **Migración de documentos existentes**: los ~480×M documentos actuales
   traen metadatos sobrantes. Opciones: coexistencia (ignorar campos viejos,
   cero riesgo) o limpieza (un pase que borre los campos movidos a
   bajo-demanda, -59 % de bytes). Se recomienda coexistencia + limpieza
   diferida (sección 10); en ningún caso borrar antes de que la UI de ficha
   bajo demanda esté desplegada.

---

## 9. Riesgos y mitigaciones

| # | Riesgo | Probabilidad | Impacto | Mitigación (para la futura implementación) |
|---|---|---|---|---|
| R1 | Ficha sin red la primera vez (tope SW de 50) | alta | medio (UX offline) | caché de detalles en IndexedDB por `externalId`+tipo; subir `DYNAMIC_MAX_ENTRIES` para respuestas de API |
| R2 | IGDB 4 req/s con fichas consecutivas | media | medio (429, ficha sin datos) | throttle/semáforo ≤ 4 req/s en `api-games.js`; caché en memoria como en `api-movies.js:227-243` |
| R3 | Olvido de revalidar la tarjeta (portada, communityRating) y que quede congelada | media | bajo (cosmético) | *stale-while-revalidate*: al abrir la ficha, revalidar y `updateItem` de portada/rating/tráiler (1 escritura por ficha visitada, ~20/día) |
| R4 | Avisos degradados si la pasada mínima omitiera casos (p. ej. serie «en pausa» sin `status` en_curso) | baja | medio | A5-a debe revisar TODAS las series con `nextEpisode` pendiente y `awaitingRelease`, no solo `en_curso` (equivalente al criterio actual de `js/daily-check.js:302-317`) |
| R5 | Migración con borrado prematuro | baja | alto (pérdida de datos) | coexistencia primero; migración de campos solo tras validar fichas bajo demanda en staging (previews de rama del workflow CI) |
| R6 | Sobrecarga de lecturas Firestore al crecer M (>3) | media (solo si el grupo crece) | medio (tope 50K/día) | recorte de suscripciones (cargar colección visible), caché de feed, paginación de amigo; en M=10 se revisa el plan de pago |
| R7 | Regresión en consumidores que no se tocaron (ICS, stats, sorting) | media | medio | suite manual del manual de usuario (ADR-032) + revisión de responsividad/temas (reglas 2 y 4 de AGENTS.md) en la PR de implementación |
| R8 | Google Books (cuota 1.000/día) si el alta bajo demanda consulta sinopsis repetidamente | baja | bajo | el alta solo consulta si falta (`js/search.js:84-90`); Open Library como respaldo (`js/api-books.js:270-277`) |
| R9 | Confusión del usuario con el botón «Sincronizar ahora» redefinido | baja | bajo | actualizar el manual de usuario (`docs/manual-de-usuario.md`) en la misma tarea (regla 3 de AGENTS.md) |

---

## 10. Trabajo futuro si se adoptara (esbozo sin código)

Fuera del alcance de esta issue (estudio sin implementación); lista de
trabajo para una issue de implementación posterior:

1. **Alta sin enriquecimiento**: `handleAdd` guardaría solo la tarjeta
   (`js/search.js:171-182`); el enriquecimiento pasa a la ficha bajo demanda.
   O (opción intermedia) mantener el enriquecimiento en el alta (1 llamada
   por alta es trivial) — decisión de la issue de implementación; este
   estudio no la prejuzga (ambas respetan A2, solo cambia dónde se paga la
   primera llamada).
2. **Ficha bajo demanda** (`js/modal-handlers.js:614-619`, `js/ui.js:623-665`):
   cargar detalles con spinner, caché en memoria 24 h, persistencia
   IndexedDB, *stale-while-revalidate* de portada/communityRating/tráiler.
3. **Ficha de amigo** (`openReadOnlyModal`, `js/ui.js:2126-2164`): fetch
   on-demand opt-in con degradación a «solo tarjeta».
4. **Throttle IGDB** ≤ 4 req/s en `js/api-games.js` (patrón de
   `js/daily-check.js:80-96`).
5. **Pasada mínima A5-a**: reescribir `checkForUpdates` (~70 llamadas/día);
   libros `/works/` sin sinopsis; juegos sin red (como hoy).
6. **Redefinición del botón «Sincronizar ahora»**: alcance «revalidar
   pendientes de estreno», manteniendo el cooldown de 30 min (ADR-021).
7. **Migración**: coexistencia de campos + limpieza diferida; **backup
   (ADR-008)**: exportar también la caché de detalles o regenerarla al
   restaurar.
8. **Manual de usuario**: actualizar secciones afectadas (regla 3 de
   AGENTS.md) y ADR-021 con la nueva política.
9. **Caché dinámica del SW**: subir el tope o derivar a IndexedDB las
   respuestas de detalle (`service-worker.js:21`).

---

## 11. Referencias y evidencia

**Código citado (verificado en el estado actual del repo, rama `dev`)**:

| Archivo | Líneas clave |
|---|---|
| `js/db.js` | 1-14 (modelo de datos), 33-38 (colecciones por tipo), 65-70 (`getItemsOnce`), 79-94 (`subscribeToItems`), 96-109 (`addItem`/`updateItem`) |
| `js/search.js` | 62-102 (`doAddBook`), 129-165 (alta de juegos), 167-221 (alta de películas/series), 606-650 (alta manual) |
| `js/api-movies.js` | 90-96 (`getTvSeasonsMeta`), 102-119 (`getSeasonEpisodes` + caché), 138-161 (`getMovieDetails`), 166-185 (`getCollectionDetails`), 190-217 (`getTvExtraDetails`), 227-243 (caché 24 h) |
| `js/api-games.js` | 144-159 (`mapGameResult`), 202-228 (`getGameDetails`), 32-70 (`igdbPost` con límite 4 req/s comentado) |
| `js/api-books.js` | 146-160 (Google Books), 212-234 (Open Library), 238-247 (sinopsis bajo demanda) |
| `js/daily-check.js` | 24-29 (cooldown/pool/aborto), 102-165 (`build*Updates` truthy-only), 217-475 (`checkForUpdates`), 491-531 (`syncNow`) |
| `js/ui.js` | 46-53 (`communityRatingHtml`), 257 (`progressLine`), 326-340 (`upcomingBadge`), 342-381 (`renderGrid`), 455-498 (`renderList`), 623-665 (`extraInfoHtml`), 2126-2164 (`openReadOnlyModal`) |
| `js/modal-handlers.js` | 115-134 (ficha película + providers/similares), 408-447 (ficha serie), 614-619 (`openItem`) |
| `js/tv-progress.js` | 48-85 (`computeProgress`), 152-157 (`markAllSeasonsWatched`) |
| `js/profile.js` | 207-217 (estadísticas), 411-451 (`openFriend`), 587-630 (`loadActivityFeed`) |
| `js/activity-feed.js` | 40-202 (`buildFriendFeed`), 210-228 (`buildGlobalFeed`) |
| `js/sorting.js` | 20-60 (fuentes de emisión), 81-107 (`getSortDate`), 138-145 (`applySort`) |
| `js/release.js` | 13-15 (`isUnreleasedDate`), 40-80 (confirmaciones) |
| `js/export-ics.js` | 120-197 (`collectUpcomingEvents`) |
| `js/export-backup.js` | 29-93 (export), 100-240 (import) |
| `js/settings.js` | 277 (`wireSyncButton`), 451 (`getNotificationPrefs`) |
| `js/app.js` | 124-129 (`maybeTriggerDailyCheck`) |
| `service-worker.js` | 21 (`DYNAMIC_MAX_ENTRIES`), 287-322 (estrategias de caché) |
| `firestore.rules` | 21-27 (usuarios autorizados), 33-63 (lecturas compartidas) |
| `README.md` | 305-313 (límites y pasada diaria; 50.000 lecturas y 1 GiB en la línea 307) |
| `cloudflare/igdb-proxy/README.md` | 54 (IGDB: 4 peticiones por segundo) |

**Límites de plataforma y APIs (todas consultadas el 2026-08-10)**:

- Firebase Firestore quotas (Spark): 50.000 lecturas/día, 20.000 escrituras/día, 1 GiB almacenamiento, 1 MiB por documento — https://firebase.google.com/docs/firestore/quotas (también `README.md:307` para lecturas/GiB).
- TMDB Rate Limiting: «somewhere in the 40 requests per second range» (documentación oficial; el límite puede cambiar; respetar 429) — https://developer.themoviedb.org/docs/rate-limiting (página actualizada el 2025-10-20; mirror de la comunidad: ~50 req/s).
- IGDB rate limits: 4 requests per second — https://api-docs.igdb.com/#rate-limits y `cloudflare/igdb-proxy/README.md:54`.
- Google Books API: cuota por defecto de 1.000 consultas/día por clave (configurable) y límites por usuario — https://developers.google.com/books/docs/v1/using (la app documenta el fallo 503 y los reintentos en `README.md:288-297`).
- Open Library: sin límite publicado; se usa con cortesía — https://openlibrary.org/developers/api.

**ADR existentes relevantes**: ADR-021 (refresco diario truthy-only), ADR-025 (fechas de emisión por temporada), ADR-033 (auto-standby), ADR-005 (rating comunitario), ADR-006 (colecciones/sagas TMDB), ADR-007 (PWA/service worker), ADR-008 (backup), ADR-014 (ICS), ADR-015 (feed de actividad), ADR-037 (notificaciones de dispositivo), ADR-045/056/057/062 (búsqueda, portadas, reintentos, marcar visto), ADR-065 (estudio de viabilidad — precedente de formato de este documento), ADR-067 (IGDB + Worker proxy), ADR-069/070/071/072 (videojuegos: feed, estadísticas, avisos, ICS). Todo el análisis de la sección 3 se contrastó con estos ADR y con el manual de usuario (`docs/manual-de-usuario.md`).

---

## Anexo A — Tablas de cálculo

### A.1 Tamaño medio estimado por documento y alternativa (estimaciones de estructura, sin medición real de Firestore)

| Tipo | A0 (statu quo) | A2 (híbrido) | A1 (solo id + usuario) |
|---|---|---|---|
| Película | ~2,5-4 KB (overview 0,6-1,5 KB, cast 5 nombres, géneros, colección, tráiler, rating) | ~1,2-1,8 KB (tarjeta + fechas + flags) | ~0,5-0,8 KB |
| Serie | ~3,5-8 KB (`seasonAirDates`, `nextEpisodeToAir`, `watched` puede crecer con cientos de episodios) | ~1,5-3 KB (tarjeta + fechas + flags; `watched` se conserva igual) | ~0,6-1 KB (`watched`/`history` se conservan) |
| Libro | ~1,5-3 KB (descripción de Google Books/OL 0,5-2 KB) | ~0,8-1,5 KB (tarjeta + autor/páginas + descripción, excepción 8.1) | ~0,4-0,6 KB (`readLog`/`progress` se conservan) |
| Videojuego | ~2-3 KB (description, géneros, plataformas, developers, publishers, ESRB) | ~1-1,5 KB (tarjeta + fechas + flags) | ~0,4-0,7 KB (`playLog` se conserva) |
| **Usuario medio (480 docs)** | **~2,2 MB** | **~0,9 MB** | **~0,45 MB** |
| **3 usuarios** | **~6,6 MB (0,6 % del GiB)** | **~2,7 MB (0,3 %)** | **~1,3 MB (0,1 %)** |

Conclusiones del anexo: el almacenamiento **nunca es el cuello de botella**
(≈ 0,6 % del GiB con los 3 usuarios medios y ≈ 2,2 % en el escenario grande
de la sección 6); el cuello de botella real son las lecturas (C1, sección 7)
y el ratio llamadas-API/usuarios (C4).

### A.2 Desglose de llamadas por escenario (un usuario, día normal)

| Escenario | Acción | A0 | A1 | A2+A5-a |
|---|---|---|---|---|
| Render de pestañas (L=5) | 4 pestañas desde memoria | 0 | 5×(300+100+50+30) = ~730-2.400 TMDB + IGDB, según cuántas pestañas se naveguen por carga (cota superior: las 4) | 0 |
| Abrir ficha (D=20) | detalles + providers + similares | 0 (ya guardado) | 20×(1-3) = 20-60 | 20×(1-3) ≈ 40, cacheados 24 h |
| Abrir 1 amigo (V=2) | 4 colecciones del amigo | 0 | 2×960 ≈ **1.920** | 0 (solo Firestore) |
| Feed (F=1) | 4 colecciones × (M-1) | 0 | 1×1.920 ≈ **1.920** | 0 |
| Pasada diaria | avisos + curado | **~445** (TMDB+OL) | ~410 (igual, no ahorra avisos) | ~70 (solo pending + en curso) |
| **Total** | | **~445** | **~5.000-6.700** | **~125** |

*El rango de A1 refleja el uso social del día: sin abrir amigos ni feed el
mínimo baja a ~1.200-2.900 (solo pestañas + fichas + pasada), pero el caso
normal del perfil de la sección 6 (V=2 amigos y F=1 feed) cae en
~5.000-6.700.*

Todas las cifras de este anexo son estimaciones construidas sobre los
supuestos de la sección 6; la app no dispone de telemetría para medirlas.

---

Related issue: #183 — https://github.com/gonzalitojh/Registro-personal/issues/183