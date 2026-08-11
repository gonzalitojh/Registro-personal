# ADR-073: Estudio de almacenamiento mínimo en base de datos — se adopta el híbrido A2 + pasada mínima A5-a para una futura implementación (issue #183)

## Estado
Aceptado (decisión de estudio: define la estrategia a implementar en una issue
futura; esta issue no implementa nada).

## Fecha
2026-08-10

## Contexto

La issue #183 pide **realizar un estudio, sin implementar nada**, de la
posibilidad de hacer un guardado de **información mínima en base de datos**,
de forma que la mayor parte de la información se extraiga directamente de las
APIs (TMDB, Google Books, Open Library, IGDB). La propia issue plantea la
pregunta central: ¿guardar solo el id y los datos de visionados/valoraciones
sería demasiado poco (sobrecarga de APIs), o conviene guardar la información
básica de las tarjetas y consultar las APIs al visualizar la información?

El punto de partida, verificado en el código real (sección 3 del estudio):

- **Arquitectura 100 % cliente**: Firebase Hosting, vanilla JS, PWA con
  service worker (`js/firebase.js:7-29`), sin backend propio salvo el proxy
  de IGDB (ADR-067). Los datos viven en Firestore con el modelo
  `users/{uid}/movies|series|books|games` y `users/{uid}/notifications`
  (`js/db.js:1-14` y `:33-38`).
- **Guardado completo al alta**: películas/series/juegos persisten el
  snapshot enriquecido de las APIs al añadir el ítem (snapshot de búsqueda +
  `getMovieDetails`/`getTvExtraDetails`/`getGameDetails`), y **refresco
  diario masivo** con política **truthy-only** (ADR-021) que consulta las
  APIs por **todos** los ítems no manuales: películas, series (incluidas las
  abandonadas) y libros de Open Library; los juegos no se refrescan. Un ítem
  sin `releaseDate` quedaría `awaitingRelease` para siempre
  (`isUnreleasedDate(null)` es true, `js/release.js:13-15`).
- **Consumidores**: tarjetas, ficha modal, progreso de series, avisos de
  estreno, amigos, feed, ICS, backup/restore, estadísticas y ordenación leen
  casi todo del documento Firestore (sección 3.4); solo la ficha hace ya
  llamadas en vivo (providers/similares, cacheadas 24 h en memoria,
  `js/api-movies.js:227-243`).
- **Cachés existentes**: service worker con `networkFirst` para las APIs y
  GET de Firestore (`service-worker.js:305-322`) y tope de 50 entradas en la
  caché dinámica (`DYNAMIC_MAX_ENTRIES`, `:21`).

**Por qué era necesario el estudio**: el coste actual (baseline A0, sección
3.7 del estudio) es **proporcional al tamaño de la biblioteca** y crece con
la cobertura total del ADR-021: ~445 llamadas a APIs/día/usuario (410 TMDB +
~35 Open Library), ~120 escrituras Firestore/día, ~10.100 lecturas/día y
~2,2 MB/usuario (480 ítems). Aunque hoy no se golpean los límites (Spark:
50.000 lecturas/día, 20.000 escrituras/día, 1 GiB), el riesgo de sobrecargar
las APIs con llamadas repetidas a TMDB/IGDB (4 req/s) es la preocupación
explícita de la issue y justifica evaluar cuantitativamente qué conviene
guardar.

El estudio ya está **realizado y validado (QA PASS)**:
`docs/estudio-almacenamiento-minimo.md` (788 líneas, evidencia verificada con
el código real y los límites oficiales de cada API consultados el
2026-08-10). Su veredicto: **es factible y recomendable guardar menos
información en Firestore, pero no hace falta llegar al extremo de guardar
"solo el id"**. Este ADR documenta la decisión/conclusión a posteriori, como
hicieron los ADR-065 y ADR-067 para sus estudios, y cumple la definición de
done de `tasks/task-issue-183.json` («ADR documentando la decisión/conclusión
del estudio (con 'Related issue: #183')»).

Related issue: #183 — https://github.com/gonzalitojh/Registro-personal/issues/183

## Decisión

**Se adopta el híbrido A2 (campos de tarjeta + campos de notificación en
Firestore; detalles de ficha bajo demanda con caché) complementado con la
pasada diaria mínima A5-a**, como estrategia para una futura issue de
implementación — **fuera del alcance de esta issue**, que no implementa nada
(secciones 4.2, 4.5 y 8 del estudio). Frente al statu quo supone, por usuario
medio y día (secciones 6 y 7; todas las cifras son estimaciones declaradas en
la sección 6):

- **Llamadas a APIs**: ~445 → **~125** (~-72 %); la pasada diaria pasa de
  ~445 a **~70** (~-85 %).
- **Escrituras Firestore**: ~120 → **~35** (~-70 %).
- **Almacenamiento**: ~2,2 MB → **~0,9 MB** (~-59 %; Anexo A.1).
- **Lecturas Firestore**: intactas (~10.100/día): dependen del nº de
  documentos, no de los campos.
- **Latencia de tarjetas**: instantánea y sin red en todas las alternativas
  que guardan la tarjeta.

### Campos a guardar SIEMPRE en Firestore (sección 8.1 del estudio)

| Grupo | Campos |
|---|---|
| Identidad + tarjeta | `externalId`, `type`, `title`, `year`, `coverUrl` |
| Datos del usuario | `status`, `rating`, `notes`, `watchLog`, `watched` (+ `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history`), `readLog`, `playLog`, `progress`, `manual` |
| Avisos (notificaciones) | `releaseDate`, `firstAirDate`, `nextEpisodeToAir`, `nextEpisodeAirDate`, `seasonAirDates`, `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` |
| Control | `manual`, `addedAt`, `updatedAt` |
| Rating comunitario | `communityRating` (**decisión explícita**: la tarjeta lo muestra, `js/ui.js:46-53`; guardarlo evita una llamada por tarjeta y su frescura se recupera con *stale-while-revalidate* al abrir la ficha) |
| Libros (excepción justificada) | `author`, `pages`, `description` |

Excepción de libros: la tarjeta y la ficha de libro los pintan al instante y
la ficha de libro no tiene llamada de detalle (Google Books/Open Library solo
dan la descripción en la búsqueda); re-consultar la sinopsis en cada apertura
añadiría llamadas por ítem sin valor.

### Campos bajo demanda, con caché en memoria 24 h + `networkFirst` del SW (sección 8.2)

`overview`/`description` (no libros), `runtime`, `episodeRuntime`, `genres`,
`cast`, `director`, `creators`, `trailerUrl`, `collectionId/Name/Poster`
(películas), `platforms`, `developers`, `publishers`, `esrbName`,
`metacritic`, `playtime` (juegos). Todos solo se consumen en la ficha
(`extraInfoHtml`, `js/ui.js:623-665`), que ya hace llamadas en vivo a
`getWatchProviders`/`getSimilarMovies` con la caché 24 h existente
(`js/modal-handlers.js:115` y `:126`).

### Pasada diaria mínima A5-a (sección 4.5)

La pasada consulta la API **solo** para ítems `awaitingRelease`
(películas/series/juegos sin estrenar) y **series en curso** con
`nextEpisode` pendiente (detectar episodio nuevo y auto-standby, ADR-033),
más los libros `/works/` sin sinopsis: ~65 TMDB + ~5 Open Library ≈ **~70
llamadas/día** (vs 445), conservando el 100 % del sistema de avisos actual.
La variante A5-d (pedir solo campos de notificación) equivale en la práctica
a A5-a y no reduce más las llamadas por ítem, por lo que se asume A5-a.

### Descarte con datos de la opción literal de la issue (sección 4.1)

**Guardar solo `externalId` + datos de usuario/visionados (A1) se descarta
cuantitativamente**: sin `title`/`coverUrl`/fechas en el documento, la app no
pagina las tarjetas (`renderGrid`/`renderList` pintan el array completo,
`js/ui.js:342-381` y `:455-498`), por lo que:

- Abrir la pestaña de películas = **~300 llamadas a TMDB** (una por tarjeta):
  ~23 s con el pool 4 del daily-check, ~15 s con el límite de ~6 conexiones
  del navegador por host.
- Abrir la pestaña de videojuegos = **~30 llamadas a IGDB ≈ 7,5 s mínimos**
  por el límite de 4 req/s; con los 3 usuarios simultáneos, 90 llamadas =
  22,5 s.
- Amigos = **M×N llamadas por visita** (~960 para 2 amigos de tamaño medio,
  con ~15 s solo por los juegos); el feed añadiría lo mismo. La cuota se
  dispara a nivel de cuenta API, compartida entre amigos.
- **No ahorra la pasada de avisos**: sin `releaseDate`/`nextEpisodeToAir` en
  BD, la pasada diaria seguiría llamando a TMDB por todos los ítems (~410
  llamadas/día).
- **Rompe el offline** de la PWA (el SW `networkFirst` no puede pintar
  tarjetas sin red) y **degrada consumidores locales** (orden alfabético/año
  en vivo, estadísticas, ICS).

## Alternativas descartadas

- **A1 — Solo `externalId` + datos de usuario, todo lo demás en vivo**
  (sección 4.1): descartada con números (ver descarte anterior): colapsa la
  UX con picos de 300 llamadas por pestaña y 960 por amigo, rompe offline y
  no ahorra las llamadas del sistema de avisos.
- **A3 — Almacenamiento solo local (IndexedDB/localStorage)** (sección 4.3):
  descartada — rompe amigos y feed (leen los documentos de otros usuarios,
  `firestore.rules:36-57`), el multi-dispositivo (la PWA usa Firestore como
  única fuente compartida) y las notificaciones de estreno (la pasada diaria
  compara fechas en la nube); backup/ICS/estadísticas pasarían a ser
  por-dispositivo.
- **A4 — Capa proxy / caché centralizada (tipo Worker IGDB, precedente
  ADR-067)** (sección 4.4): descartada ahora — para 3 usuarios no compensa
  (una ficha abierta por 2 amigos genera 2 llamadas igualmente; el ahorro
  marginal no justifica operar un servicio nuevo y rompería la arquitectura
  sin backend). Queda documentada como **opción futura si el grupo creciera**
  (escenario M=10).
- **A5-b — Sin pasada (solo *stale-while-revalidate* en ficha)** (sección
  4.5): descartada — rompe los avisos: un ítem que el usuario nunca abre
  nunca se avisaría.
- **A5-c — Pasada semanal** (sección 4.5): descartada — retrasa hasta 7 días
  los avisos de estreno/episodio; con M=3 usuarios el coste de A5-a ya es
  bajo, no merece el riesgo de UX.
- **A5-d — Pasada diaria solo campos de notificación** (sección 4.5): es en
  la práctica A5-a (TMDB no tiene un endpoint «lite» de fechas); no aporta
  una alternativa distinta.

## Consecuencias

### Positivas

- **Ahorro de costes** (por usuario medio y día): ~-72 % de llamadas a APIs
  (con -85 % en la pasada diaria), ~-70 % de escrituras Firestore y ~-59 %
  de almacenamiento, sin tocar las lecturas (secciones 6 y 7).
- **Tarjetas, amigos, feed, ICS, backup y estadísticas siguen funcionando
  sin llamadas a APIs**: todo lo que consumen está en el documento guardado
  (sección 3.4).
- **Aprovecha cachés ya existentes**: memoria 24 h (`js/api-movies.js:227-243`)
  y `networkFirst` del service worker (`service-worker.js:305-313`) para las
  fichas bajo demanda.
- **Sin infraestructura nueva**: se mantiene la arquitectura 100 % cliente;
  nada que desplegar ni vigilar.
- **Offline conservado**: tarjetas siempre; fichas tras la primera visita
  (patrón actual de la PWA, sección 3.5).

### Negativas / Riesgos

- **Pérdida de frescura de metadatos en tarjetas/ficha** (portadas,
  `communityRating`, colección, tráiler dejaron de curarse a diario; sección
  8.3.1): mitigación obligada en la implementación — *stale-while-revalidate*
  al abrir la ficha (`updateItem` de portada/rating, ~20 escrituras/día;
  riesgos R1-R3 de la sección 9).
- **Tope del service worker de 50 entradas** (`DYNAMIC_MAX_ENTRIES`): con 480
  ítems la LRU expulsa pronto las respuestas de ficha; mitigación — caché de
  detalles en IndexedDB por `externalId`+tipo y/o subir el tope (sección
  8.3.3, riesgo R1).
- **IGDB a 4 req/s**: el enriquecimiento bajo demanda de juegos debe
  serializarse con **throttle ≤ 4 req/s** (reutilizando `mapConcurrent` de
  `js/daily-check.js:80-96` o un semáforo; sección 8.3.5, riesgo R2).
- **Backup/restore deja de incluir metadatos de ficha** (sinopsis, cast,
  tráiler): un restore traería tarjetas sin detalles hasta abrir cada ficha;
  aceptable si se re-enriquece al restaurar (sección 8.3.6).
- **El botón «Sincronizar ahora» (ADR-021) pierde su alcance de curado
  total**: habría que redefinirlo («revalidar pendientes de estreno»,
  manteniendo el cooldown de 30 min; sección 8.3.7, riesgo R9).
- **Migración de los documentos existentes** (~480×M con metadatos
  sobrantes): obligatorio **coexistencia primero** (ignorar campos viejos) y
  limpieza de campos solo tras validar las fichas bajo demanda; nunca borrar
  antes (sección 8.3.8, riesgo R5).
- **Los avisos de estreno requieren mantener la pasada mínima A5-a**: la
  issue planteaba «no mantener una actualización de datos de base de datos»;
  con A2+A5-a queda una pasada diaria, pero ~85 % más barata y limitada a los
  ítems relevantes (sección 8.3.2). La «cero pasada» (A5-b) se rechaza.
- **Fichas de amigos read-only**: si el amigo no abrió esa ficha, el lector
  hará el fetch on-demand (cuota del lector) o verá solo la tarjeta —
  degradación elegante documentada (sección 8.3.4).

### Neutras

- **Sin cambios de UX ahora**: esta issue no implementa nada; la estrategia
  queda fijada para la issue de implementación futura.
- **El estudio queda como referencia**: `docs/estudio-almacenamiento-minimo.md`
  (788 líneas, QA PASS) sirve de evidencia cuantitativa (modelo de la sección
  6, límites de APIs de la sección 11) y de punto de partida para la
  implementación (trabajo futuro esbozado en la sección 10: alta sin
  enriquecimiento, ficha bajo demanda, throttle IGDB, pasada A5-a,
  redefinición de «Sincronizar ahora», migración, manual de usuario y ADR-021).
- **ADR-021 no se modifica** con esta decisión; su política actual sigue
  vigente hasta la issue de implementación.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `docs/adr-073-estudio-almacenamiento-minimo.md` | **Nuevo**: este documento |
| `docs/estudio-almacenamiento-minimo.md` | **Nuevo en esta issue**: estudio completo (788 líneas, QA PASS) cuya conclusión documenta este ADR — no se modifica |
| `tasks/task-issue-183.json` | **Nuevo**: definición de done (criterio «ADR documentando la decisión/conclusión del estudio (con 'Related issue: #183')») que este ADR cumple |

**No se modifica ningún archivo de código**: la issue era «sin implementar
nada» (criterio de aceptación n.º 8: no se toca `js/`, `css/`, `index.html`,
`service-worker.js`, `firestore.rules`, `cloudflare/` ni `config`). Todas las
rutas y líneas citadas en este ADR son evidencia del estado actual, verificada
en el estudio (sección 3).

Relacionado con: docs/estudio-almacenamiento-minimo.md

Related issue: #183 — https://github.com/gonzalitojh/Registro-personal/issues/183
