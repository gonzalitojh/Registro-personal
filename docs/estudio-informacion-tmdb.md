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
