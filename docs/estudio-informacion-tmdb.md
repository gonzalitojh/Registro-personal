# Estudio de la información de la API de TMDB (issue #184)

## Fecha

2026-08-10

## Issue

#184 — «Estudio información TMDB»: realizar un estudio, sin implementar nada,
de toda la información que se puede extraer de la API de TMDB, organizada por
secciones, para saber hasta dónde puede llegar la idea de montar una especie
de _IMDB_ o _TMDB_ dentro de la web: consultar mucha más información sobre
películas, series, actores, directores, etc.
https://github.com/gonzalitojh/Registro-personal/issues/184

## Estado

Estudio finalizado, **sin implementación**: este documento no aporta ni
propone código a la aplicación (criterio de aceptación n.º 7: no se
implementa nada; no se modifica ningún archivo fuera de `docs/` y `tasks/`).

---

## 1. Resumen ejecutivo

**Veredicto: es técnicamente factible montar una "especie de IMDB/TMDB"
dentro de la web actual —100 % cliente, sin backend— porque la práctica
totalidad de la información que TMDB ofrece (películas, series, personas,
créditos, colecciones, proveedores de visionado, imágenes, vídeos,
traducciones, IDs externos, etc.) es consultable desde el navegador con una
sola clave de API ya integrada y CORS habilitado.** No se necesita ninguna
infraestructura nueva para el 95 % de los datos; solo un proxy (patrón ya
probado con IGDB, ADR-067) sería necesario si el número de usuarios creciese
hasta golpear el rate limit conjunto (~40 req/s por clave, compartida entre
todos los usuarios).

El catálogo completo se detalla en la sección 4: **21 secciones** de la API
v3 cubren desde la ficha técnica de películas (presupuesto, recaudación,
productoras, idiomas) hasta biografías de actores y directores, filmografías
completas, listas editoriales (trending, populares, estrenos), galerías de
imágenes, vídeos, certificaciones por país, plataformas de streaming,
keywords temáticas, empresas y redes, reviews, listas de usuarios y
traducciones a decenas de idiomas. Hoy la app ya consume 9 de esos endpoints
(sección 3); el resto es ampliable **bajo demanda con caché**, siguiendo los
patrones existentes (caché 24 h en memoria + `networkFirst` del service
worker + snapshots Firestore del ADR-021), sin tocar el modelo de datos.

**Recomendación de alcance por fases** (para issues futuras, sección 8), de
mayor a menor valor/esfuerzo:

1. **Fase 1 — Personas y filmografía** (`person/{id}`, `combined_credits`,
   `movie/{id}/credits` ya usado parcialmente): fichas de actores/directores
   con biografía, foto y «ver más de este actor/director». Es el salto más
   visible hacia un "IMDB propio" y cuesta 1-3 llamadas por apertura de ficha.
2. **Fase 2 — Descubrimiento** (`discover/movie|tv`, `trending/*`,
   `movie/popular|now_playing|upcoming|top_rated`): secciones de tendencias,
   estrenos, "lo más visto" y exploración avanzada sin lógica propia.
3. **Fase 3 — Riqueza de ficha** (imágenes, vídeos, certificaciones,
   release dates por país, keywords): galerías, tráilers adicionales y datos
   técnicos completos.
4. **Fase 4 — Integración externa** (`external_ids`, `find`, `configuration`):
   deep links a IMDb/Wikipedia, importar por ID externo y eliminar tamaños de
   imagen hardcodeados.
5. **Fuera de alcance**: reviews y listas de usuarios de TMDB (la app ya
   tiene valoración y listas propias), autenticación/cuentas de TMDB (v3 y
   v4) y el changelog de cambios (solo como nota futura para el refresh
   diario).

**Límites que condicionan todo** (sección 6): uso gratuito solo **no
comercial** con **atribución obligatoria** (ya cumplida en el footer);
**caché de datos de la API ≤ 6 meses** (los snapshots Firestore son el
mecanismo coherente); rate limit **blando de ~40 req/s por clave**, compartido
por todos los usuarios (por eso la caché y el bajo volumen de llamadas son
críticos); sin SLA; prohibido el entrenamiento de modelos de ML/AI con los
datos.

Tabla de una vista (detalle en las secciones 4 y 5):

| Sección de TMDB | Endpoints representativos | ¿Usable hoy en cliente? | Valor tipo IMDB |
|---|---|---|---|
| Películas (ficha) | `movie/{id}` | ✅ Sí (ya se usa) | Datos técnicos, económicos, productoras, idiomas |
| Series y episodios | `tv/{id}`, `tv/{id}/season/{n}/episode/{m}` | ✅ Sí (parcial) | Ficha de serie, episodios, certificaciones, redes |
| Personas | `person/{id}`, `person/popular` | ✅ Sí | Biografía de actores/directores |
| Créditos y reparto | `movie|tv/{id}/credits`, `person/{id}/combined_credits` | ✅ Sí (parcial) | Reparto completo, filmografía, grafo persona↔obra |
| Búsqueda | `search/movie|tv|person|multi|collection|company|keyword` | ✅ Sí (parcial) | Buscador global multi-tipo |
| Discover | `discover/movie|tv` | ✅ Sí | Exploración avanzada con 30+ filtros |
| Trending y listas | `trending/*`, `movie/popular|now_playing|upcoming|top_rated`, `tv/*` | ✅ Sí | Secciones editoriales automáticas |
| Colecciones y sagas | `collection/{id}` | ✅ Sí (ya se usa) | Sagas completas |
| Géneros y keywords | `genre/*/list`, `keyword/{id}` | ✅ Sí | Navegación temática |
| Empresas y redes | `company/{id}`, `network/{id}` | ✅ Sí | Filmografías de estudios/cadenas |
| Watch providers | `movie|tv/{id}/watch/providers`, `watch/providers/*` | ✅ Sí (parcial) | «Dónde ver» por plataforma y país |
| Imágenes | `movie|tv|person/{id}/images` + CDN | ✅ Sí | Galerías y fondos sin rate limit |
| Vídeos | `movie|tv/{id}/videos` (+ season/episode) | ✅ Sí (parcial) | Tráilers y extras |
| Traducciones | `*/{id}/translations` | ✅ Sí | Multiidioma |
| External IDs y find | `*/{id}/external_ids`, `find/{id}` | ✅ Sí | Deep links e importación por ID |
| Reviews y listas | `movie|tv/{id}/reviews`, `list/{id}` | ✅ Sí | Valor marginal (UGC propio) |
| Changes/changelog | `movie|tv|person/changes` | ✅ Sí | Sincronización futura |
| Configuración | `configuration` (+ countries/jobs/tz/languages) | ✅ Sí | Datos dinámicos de la API |
| Autenticación/cuentas | `authentication/*`, `account/*`, v4 `4/account` | ⚠️ Con gestión de sesiones | **No recomendado**: UGC propio |
| API v3 vs v4 | `3/*` vs `4/*` | ✅ v3 | Decisión: mantener v3 |

---

## 2. Alcance y metodología

**Qué se estudia**: toda la información que se puede extraer de la API de
TMDB, organizada por secciones (endpoints, datos que devuelven y utilidad
para una web tipo IMDB/TMDB), y la viabilidad de montar esa experiencia en la
arquitectura actual de la app (100 % cliente, Firebase Hosting, vanilla JS,
sin backend). Se evalúa también qué requeriría infraestructura nueva y cuáles
son los límites (rate limits, costes, términos de uso, CORS).

**Qué NO se estudia / hace**: no se implementa nada. No se toca ningún
archivo de código (`js/`, `css/`, `index.html`, `service-worker.js`,
`firestore.rules`, `cloudflare/`, `config`). Este documento cita rutas y
líneas reales del estado actual solo como evidencia.

**Metodología**:

1. **Fuentes primarias de TMDB** (consultadas el 2026-08-10):
   - Documentación oficial de la API v3: `developer.themoviedb.org`
     (índice `llms.txt`, «Getting Started», «FAQ», «Rate Limiting»,
     «Append To Response», y el catálogo de la OpenAPI v3 con las 21
     secciones/etiquetas de endpoints).
   - Términos de uso de la API: `themoviedb.org/documentation/api/terms-of-use`
     (versión del 20/10/2023, leídos textualmente).
   - Página de logos y atribución: `themoviedb.org/about/logos-attribution`.
2. **Verificación empírica de cortesía** (2026-08-10, sin scraping): una
   petición `curl` a `https://api.themoviedb.org/3/configuration` con cabecera
   `Origin` para confirmar el CORS (`access-control-allow-origin: *`) y la
   disponibilidad del endpoint público. No se realizó ninguna otra llamada ni
   se usó la clave de la app.
3. **Contraste con el código real de la app**: inventario de los endpoints
   TMDB ya usados en `js/api-movies.js` (sección 3), las cachés existentes
   (memoria 24 h y `networkFirst` del service worker), el consumo actual de
   TMDB (~410 llamadas/día del baseline del estudio de almacenamiento,
   ADR-073) y la atribución ya presente en el footer de `index.html`.
4. **Análisis por secciones** (sección 4): para cada una de las 21 secciones
   de la API se listan los endpoints principales, los datos que devuelven y
   su utilidad potencial, con una clasificación de viabilidad en la
   arquitectura actual (categorías A/B de la sección 5).

**Limitaciones del estudio**: fotografía puntual de la API a 2026-08-10. TMDB
puede cambiar endpoints, límites o términos sin aviso (así lo declara su
propia documentación); los campos citados se basan en la documentación
oficial y en el uso real ya verificado en la app, no en un inventario campo a
campo de cada respuesta (eso se hará en las issues de implementación de cada
fase). Las cifras de carga son estimaciones con los supuestos de la sección 6.

---

## 3. Contexto actual de la app (uso de TMDB hoy)

La app es **100 % cliente**: Firebase Hosting, vanilla JS (ES modules), PWA
con service worker, datos en Firestore (`users/{uid}/movies|series|books|games`),
sin backend propio salvo el proxy de IGDB (ADR-067). Películas y series usan
TMDB desde el origen (ADR-006 colecciones/sagas, ADR-007 service worker,
ADR-021 refresh diario, ADR-056 buscador). Todo el acceso a TMDB vive en
`js/api-movies.js`.

### 3.1 Endpoints TMDB ya usados (9 llamadas distintas)

| Función | Endpoint | Frecuencia | Dato extraído |
|---|---|---|---|
| `searchMovies` | `GET /3/search/movie` | búsqueda | `id`, `title`, `year`, `poster_path`, `overview` |
| `searchTv` | `GET /3/search/tv` | búsqueda | idem en serie |
| `getMovieDetails` | `GET /3/movie/{id}?append_to_response=credits,videos` | al alta | duración, sinopsis, géneros, reparto (5), director, fecha, valoración, tráiler, colección |
| `getTvExtraDetails` | `GET /3/tv/{id}?append_to_response=credits,videos` | al alta | duración episodio, sinopsis, géneros, reparto (5), creadores, estado, `next_episode_to_air`, fechas por temporada |
| `getTvSeasonsMeta` | `GET /3/tv/{id}` | en vivo | temporadas (nº, nombre, episodios, fecha) |
| `getSeasonEpisodes` | `GET /3/tv/{id}/season/{n}` | bajo demanda | episodios (nº, nombre, fecha, valoración) |
| `getCollectionDetails` | `GET /3/collection/{id}` | bajo demanda | partes de la saga (ADR-006) |
| `getWatchProviders` | `GET /3/movie|tv/{id}/watch/providers` | bajo demanda | plataformas ES (flatrate/rent/buy) |
| `getSimilarMovies`/`getSimilarTv` | `GET /3/movie|tv/{id}/similar` | bajo demanda | contenidos similares |

La clave se envía como `api_key` en query string desde `js/config.js`
(`TMDB_API_KEY`), patrón que la documentación oficial soporta para uso no
comercial y que ya está expuesto en el cliente por diseño (no es un secreto
real, igual que las claves de Google Books/Open Library).

### 3.2 Cachés y consumo actuales

- **Caché en memoria 24 h** para watch providers y episodios de temporada
  (`providersCache`/`getCached`, `js/api-movies.js:227-243`).
- **Service worker**: `networkFirst` para `api.themoviedb.org` y `cacheFirst`
  para `image.tmdb.org` (`service-worker.js:288` y `:307`).
- **Snapshots Firestore**: al alta se persiste el snapshot enriquecido y el
  refresh diario (ADR-021) re-consulta las APIs con política truthy-only.
- **Consumo**: baseline del estudio de almacenamiento (ADR-073): **~410
  llamadas a TMDB/día/usuario** con la cobertura total del refresh diario.
  Las llamadas bajo demanda (providers, similares, episodios) son pocas por
  visita gracias a la caché 24 h.
- **Atribución**: ya presente en el footer de `index.html:222`
  («Esta aplicación usa la API de TMDB pero no está respaldada ni certificada
  por TMDB»), cumpliendo el requisito de atribución de TMDB.

### 3.3 Qué implica «montar un IMDB/TMDB» sobre esto

Hoy la ficha ya muestra un subconjunto de la información de TMDB (datos
básicos + reparto de 5 + director + tráiler + plataformas + similares). La
idea de la issue es **ampliar la información consultable** hacia lo que
ofrece IMDB/TMDB: biografías y filmografías de personas, datos técnicos
completos, galerías, listas editoriales, exploración avanzada, etc. La
sección 4 cataloga **todo** lo que TMDB puede aportar; la sección 5 evalúa
dónde encaja en la arquitectura actual.

---

## 4. Catálogo de la información de TMDB por secciones

Fuente: OpenAPI oficial de la API v3 (21 secciones/tags) + documentación de
cada endpoint. Para cada sección: **endpoints**, **datos principales** y
**utilidad para una web tipo IMDB/TMDB**. Los endpoints ya usados por la app
se marcan con 🟢; los parcialmente usados con 🟡.

### 4.1 Películas — ficha y datos ampliados

**Endpoints**: `GET /3/movie/{id}` 🟡 (ya se usa sin `append_to_response`
completo).

**Datos**: además de lo ya usado (título, sinopsis, duración, géneros,
fecha, valoración, colección), la ficha completa incluye: `budget`
(presupuesto), `revenue` (recaudación), `homepage`, `imdb_id`,
`original_title`, `original_language`, `tagline` (eslogan), `status`
(rumoreada/en producción/estrenada), `adult`, `popularity`,
`production_companies` (productoras con logo), `production_countries`,
`spoken_languages`, `belongs_to_collection`.

**Utilidad**: ficha técnica de película al estilo IMDb (datos económicos,
productoras, idiomas, eslogan, estado). Con `append_to_response` se pueden
combinar hasta decenas de sub-endpoints (créditos, vídeos, imágenes, keywords,
recomendaciones, similares, external IDs, traducciones, release dates,
watch providers…) en **una sola llamada HTTP** (ver sección 4.21), lo que
hace que «enriquecer la ficha» sea barato en llamadas.

### 4.2 Series, temporadas y episodios

**Endpoints**: `GET /3/tv/{id}` 🟡 (parcial), `tv/{id}/season/{n}` 🟡
(parcial), `tv/{id}/season/{n}/episode/{m}`, `tv/{id}/aggregate_credits`,
`tv/{id}/content_ratings`, `tv/{id}/episode_groups`, `tv/{id}/screened_theatrically`,
`tv/{id}/networks`, `tv/{id}/external_ids`, y sub-endpoints por temporada y
episodio (`credits`, `videos`, `images`, `translations`, `external_ids`,
`watch/providers`).

**Datos**: `number_of_seasons`, `number_of_episodes`, `networks` (cadenas),
`origin_country`, `last_episode_to_air`, `status`, `episode_run_time`,
`created_by`, `next_episode_to_air` (ya usado). Por episodio: nombre, número,
fecha de emisión, valoración, still (fotograma), invitados, crew. Además:
reparto **agregado por personaje** (`aggregate_credits`, clave para series
largas), certificaciones por país (`content_ratings`), grupos de episodios
alternativos (`episode_groups`, p. ej. "orden de visionado" tipo Star Wars),
y si la serie se estrenó en cines (`screened_theatrically`).

**Utilidad**: ficha de serie completa estilo IMDb (cadena, país, nº de
temporadas/episodios), ficha de **episodio individual** con fotograma y
reparto invitado, «orden correcto de visionado» (episode groups), edad
recomendada por país (certificaciones) y detección de estreno en cines.

### 4.3 Personas (actores, directores, guionistas…)

**Endpoints**: `GET /3/person/{id}`, `person/popular`, `person/{id}/translations`,
`person/{id}/tagged_images`, `person/{id}/external_ids`, `person/changes`,
`person/{id}/images`, `person/{id}/movie_credits`, `person/{id}/tv_credits`,
`person/{id}/combined_credits`.

**Datos**: `birthday`, `deathday`, `place_of_birth`, `biography`,
`known_for_department` (Acting/Directing/Writing…), `also_known_as`,
`popularity`, `profile_path` (foto), género (1/2), `imdb_id` y redes sociales
(external IDs). `combined_credits` devuelve **toda la filmografía**
(películas + series) con personaje/job por obra.

**Utilidad**: **página de actor/director tipo IMDb**: foto, biografía, datos
personales públicos, filmografía completa clickable y "conocido por"
(obras más populares). Es la pieza que más acerca la web a un "IMDB propio"
y es 100 % navegable desde los créditos ya mostrados en la ficha (solo hay
que enlazar el `person_id`, que ya llega en `credits`).

### 4.4 Créditos y reparto (grafo persona ↔ obra)

**Endpoints**: `GET /3/movie/{id}/credits` 🟢 (vía append), `tv/{id}/credits`,
`tv/{id}/season/{n}/credits`, `tv/{id}/season/{n}/episode/{m}/credits`,
`tv/{id}/aggregate_credits`, `person/{id}/combined_credits`,
`person/{id}/movie_credits`, `person/{id}/tv_credits`, `credit/{id}`.

**Datos**: cast con `character`, `order`, `cast_id`, `credit_id` y
`profile_path` por persona; crew con `job` (Director, Producer, Writer,
Composer…); créditos por temporada/episodio; crédito individual (`credit/{id}`)
que enlaza obra+persona+jobs.

**Utilidad**: navegación bidireccional «ver más de este actor/director»,
reparto completo desplegable (hoy la ficha solo muestra 5), orden de billing,
y el grafo de colaboraciones (actor ↔ director ↔ obra) que es la base de la
navegación de IMDB.

### 4.5 Búsqueda

**Endpoints**: `GET /3/search/movie` 🟢, `search/tv` 🟢, `search/person`,
`search/multi` (películas+series+personas en una sola llamada),
`search/collection`, `search/company`, `search/keyword`. Parámetros:
`query`, `language`, `region`, `year`, `include_adult`, `page`.

**Datos**: resultados paginados (`page`, `total_pages`, `total_results`) con
los campos de tarjeta de cada tipo (id, título, año, póster, sinopsis,
valoración, `profile_path` para personas).

**Utilidad**: buscador global multi-tipo (una llamada para ver películas,
series **y personas** que coinciden con la búsqueda — hoy el buscador de la
app solo busca películas y series por separado), y búsqueda de sagas,
estudios y keywords (para autocompletado/desambiguación).

### 4.6 Discover (exploración avanzada)

**Endpoints**: `GET /3/discover/movie`, `discover/tv`.

**Datos**: listas paginadas de películas/series filtradas por **30+ criterios
combinables**: `with_genres`, `with_people`, `with_watch_providers`,
`with_companies`, `with_keywords`, `vote_average.gte/lte`, `vote_count.gte`,
`release_date.gte/lte`, `first_air_date.*`, `with_original_language`,
`with_runtime.gte/lte`, `region`, `sort_by` (popularity, revenue, vote_average,
release_date…), `certification`, `with_networks`, `with_origin_country`.

**Datos**: iguales a los de búsqueda (tarjetas paginadas).

**Utilidad**: el equivalente al **Advanced Search de IMDb**: «películas de
terror españolas de los 80 ordenadas por valoración», «series de HBO con
nota > 8», «películas de Christopher Nolan en streaming gratis (flatrate)».
Todo el filtrado lo hace TMDB: la app solo pinta resultados. Combinable con
`with_watch_providers` para filtrar por plataforma (Netflix/Prime…).

### 4.7 Trending y listas editoriales

**Endpoints**: `GET /3/trending/all|movie|tv|person/{day|week}`,
`movie/now_playing`, `movie/popular`, `movie/top_rated`, `movie/upcoming`,
`tv/popular`, `tv/top_rated`, `tv/airing_today`, `tv/on_the_air`.

**Datos**: listas curadas y actualizadas automáticamente por TMDB (tendencias
diarias/semanales por tipo, en cines ahora, populares, mejor valoradas,
próximos estrenos, emitiéndose hoy/en antena), con los campos de tarjeta.

**Utilidad**: secciones «Tendencias», «Lo más visto», «Mejor valoradas»,
«Próximos estrenos» y «En emisión» **sin ninguna lógica propia** (ni
recopilación, ni ranking): una llamada por sección. `trending/person` da
además los actores en auge.

### 4.8 Colecciones y sagas

**Endpoints**: `GET /3/collection/{id}` 🟢 (ya se usa), `collection/{id}/images`,
`collection/{id}/translations`.

**Datos**: nombre, sinopsis, póster, backdrops y **todas las partes** de la
saga ordenadas cronológicamente (ya usado para «Añadir resto de la saga»,
ADR-006). `images` añade la galería de la saga; `translations` los títulos
traducidos.

**Utilidad**: ampliar la ficha de saga actual con galería de imágenes,
sinopsis de la colección y navegación por las partes (ya existe el esqueleto).

### 4.9 Géneros y keywords

**Endpoints**: `GET /3/genre/movie/list`, `genre/tv/list`, `keyword/{id}`,
`keyword/{id}/movies`, `movie/{id}/keywords`, `tv/{id}/keywords`.

**Datos**: listas de géneros por tipo (id+nombre, localizables por `language`),
keywords (temas/asuntos) por título —p. ej. "time travel", "based on novel"—
y películas asociadas a una keyword.

**Utilidad**: navegación por género (chips/selectores), página de género
("todas las películas de ciencia ficción"), y «temas relacionados» en la
ficha — el equivalente a las keywords de IMDb. Las keywords además
alimentan el Discover (`with_keywords`).

### 4.10 Empresas y redes

**Endpoints**: `GET /3/company/{id}`, `company/{id}/movies`, `company/{id}/images`,
`company/{id}/alternative_names`, `network/{id}`, `network/{id}/images`,
`network/{id}/alternative_names`.

**Datos**: productoras/estudios (nombre, logo, sede, descripción, películas
producidas) y cadenas de TV (Netflix, HBO, AMC… con su catálogo).

**Utilidad**: «Películas de esta productora» (Marvel, A24, Studio Ghibli…)
y «Series de esta cadena» — navegación temática por origen, clickable desde
`production_companies`/`networks` de la ficha.

### 4.11 Watch providers (dónde ver)

**Endpoints**: `GET /3/movie|tv/{id}/watch/providers` 🟢 (ES), `watch/providers/movie|tv`
(índice global de plataformas), `watch/providers/regions`.

**Datos**: por título y país: `flatrate` (streaming incluido), `rent`
(alquiler), `buy` (compra) con nombre, logo y `display_priority`; además el
`link` de justwatch. El índice global lista todas las plataformas por país.

**Utilidad**: ampliar «dónde ver» actual con navegación por plataforma
(«todo lo que hay en Prime» vía Discover `with_watch_providers`), selector de
país (hoy fijado ES) y logos de las plataformas en la ficha.

### 4.12 Imágenes

**Endpoints**: `GET /3/movie|tv|person|collection/{id}/images` (+ season,
episode), CDN `image.tmdb.org` 🟢 (posters) con tamaños de
`configuration`.

**Datos**: posters, backdrops (fondos), logos y stills, cada uno con
`aspect_ratio`, `language` y `file_path` por tamaño (w92 → w500 → original).

**Utilidad**: galerías de imágenes en la ficha, fondos para cabeceras de
sección, retratos de personas y fotogramas de episodios. El CDN **no está
sujeto al rate limit** y admite caché agresiva (`cacheFirst` ya en el SW) —
es el recurso más barato de ampliar.

### 4.13 Vídeos

**Endpoints**: `GET /3/movie|tv/{id}/videos` 🟢 (tráiler vía append),
`tv/{id}/season/{n}/videos`, `tv/{id}/season/{n}/episode/{m}/videos`.

**Datos**: lista de vídeos con `site` (YouTube/Vimeo), `type` (Trailer,
Teaser, Featurette, Behind the Scenes, Bloopers, Opening Credits…), `name`,
`key`, `official`, `size` y `published_at`.

**Utilidad**: galería de vídeos más allá del tráiler principal ya usado
(teasers, making-of, bloopers), vídeos por temporada y por episodio.
Coste: 1 llamada por ficha con `append_to_response`.

### 4.14 Traducciones e idiomas

**Endpoints**: `GET /3/movie|tv|person|collection/{id}/translations`,
`tv/{id}/season/{n}/translations`, `tv/{id}/season/{n}/episode/{m}/translations`.

**Datos**: títulos, sinopsis y datos localizados en decenas de idiomas
(la app trabaja fijado a `es-ES` hoy).

**Utilidad**: soporte multiidioma futuro de la ficha y de las búsquedas
(«ver el título original vs. el español»), y selección de idioma por ítem
para usuarios que consumen contenido en otros idiomas.

### 4.15 External IDs e integración externa

**Endpoints**: `GET /3/movie|tv|person/{id}/external_ids` (+ season,
episode), `find/{external_id}?external_source=imdb_id|tvdb_id|freebase_mid|freebase_id|tvdb_id|tvrage_id|wikidata_id|facebook_id|instagram_id|twitter_id`.

**Datos**: `imdb_id`, `tvdb_id`, `wikidata_id`, IDs de redes sociales; y la
resolución inversa (dado un ID externo, obtener el TMDB id).

**Utilidad**: **deep links a IMDb/Wikipedia** desde la ficha («ver en IMDb»),
importar un título pegando su IMDb id (búsqueda inversa), y enlazar redes
sociales de actores. Es la pieza que conecta la web con el ecosistema IMDb.

### 4.16 Reviews y listas de usuarios

**Endpoints**: `GET /3/movie/{id}/reviews`, `tv/{id}/reviews`, `review/{id}`,
`list/{id}`, `movie|tv/{id}/lists`.

**Datos**: reseñas de usuarios TMDB (autor, contenido, valoración) y listas
públicas curadas por usuarios.

**Utilidad**: **valor marginal**: la app ya tiene su propio sistema de
valoración y listas comunitarias (ADRs de rating y listas propias); el UGC
de TMDB en español es escaso y no aporta valor diferencial. Solo `list/{id}`
podría ser interesante como "listas curadas de la comunidad TMDB", pero
añade complejidad de navegación por poco valor. Se recomienda no incluirlo
en el alcance.

### 4.17 Changes / changelog

**Endpoints**: `GET /3/movie|tv|person/changes` (con `start_date`/`end_date`),
`movie|tv|person/{id}/changes`.

**Datos**: registro de cambios por título (fecha y tipo de cambio) para
sincronización incremental.

**Utilidad**: futuro para el refresh diario (ADR-021): en lugar de re-consultar
todo, consultar solo lo que cambió. Hoy el snapshot con política truthy-only
ya cubre el caso de uso; se documenta como **nota futura**, no como
necesidad actual.

### 4.18 Configuración de la API

**Endpoints**: `GET /3/configuration` (verificado con curl, HTTP 200 con
clave), `configuration/countries`, `configuration/jobs`, `configuration/timezones`,
`configuration/languages`, `configuration/primary_translations`.

**Datos**: URLs base del CDN de imágenes y tamaños disponibles; listas de
países (código, inglés, español), jobs de crew (Director, Producer…),
zonas horarias, idiomas soportados y traducciones primarias.

**Utilidad**: **eliminar tamaños hardcodeados** (`w342`, `w185`, `w92` en
`js/api-movies.js`) consultando la configuración dinámicamente, alimentar
selectores de país/idioma, y traducir jobs de crew al español. Coste: 1
llamada cacheable durante meses (es un endpoint estático).

### 4.19 Autenticación y cuentas (v3 y v4)

**Endpoints**: v3: `authentication/guest_session/new`,
`authentication/token/new`, `authentication/create_session`,
`account`, `account/{id}/rated|favorite|watchlist`, `account/{id}/lists`;
v4: `4/auth/request_token`, `4/auth/access_token`, `4/account`,
`4/list`, `4/list/{id}` (crear/editar listas propias).

**Datos**: sesiones de invitado, sesiones de usuario, valoraciones/favoritos/
watchlists de una cuenta TMDB, y listas propias (v4).

**Utilidad**: **no recomendado**. La app tiene su propio sistema de
valoración, listas, favoritos y watchlist (funciones sociales propias con
Firestore). Integrar las cuentas TMDB añadiría OAuth, gestión de sesiones y
duplicidad de conceptos sin valor diferencial. La única excepción
potencialmente atractiva es `4/list` (listas propias), pero requiere
autenticación OAuth completa — se descarta por coste/beneficio.

### 4.20 API v3 vs v4

**v3**: autenticación por `api_key` en query string (la usada hoy); acceso
gratuito no comercial; CORS habilitado; toda la información del catálogo.

**v4**: autenticación por **Access Token** (`Authorization: Bearer`) —
obligatorio para las operaciones de cuenta (listas, favoritos, ratings) y
recomendado por TMDB para nuevas integraciones; mismo catálogo de datos;
CORS también habilitado.

**Decisión para la web**: **mantener v3**. En un cliente público la clave ya
es visible por diseño (no es un secreto), por lo que v4 no añade seguridad
real para lectura y obliga a gestionar un token adicional sin beneficio
funcional. v4 solo aportaría si se quisieran las listas/cuentas (sección
4.19), que se descartan. No hay endpoints de datos exclusivos de v4 que la
web necesite.

### 4.21 `append_to_response`: combinar llamadas

Aunque no es una "sección" de datos, es la **palanca más importante** para
el objetivo de la issue: `movie`, `tv`, `season`, `episode` y `person`
aceptan `append_to_response` con una lista separada por comas (hasta decenas
de sub-endpoints: `credits,videos,images,keywords,reviews,external_ids,
release_dates,watch/providers,translations,similar,recommendations,
content_ratings,aggregate_credits…`), de modo que **una sola llamada HTTP
devuelve toda la ficha enriquecida**. La app ya usa este mecanismo
(`getMovieDetails`/`getTvExtraDetails`). Implicación: enriquecer la ficha
tipo IMDB cuesta **1 llamada por apertura** (con caché), no N llamadas.

