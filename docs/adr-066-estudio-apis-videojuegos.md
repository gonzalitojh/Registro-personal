# ADR-066: Estudio de APIs de videojuegos — se adopta IGDB con proxy Cloudflare Worker (issue #47)

## Estado
Aceptado (revisado: 2026-08-10 — RAWG caída, se sustituye por IGDB)

## Fecha
2026-08-09 (revisión 2026-08-10)

## Contexto

La issue #47 pide **añadir una pestaña de videojuegos** a la web con las
mismas características que las pestañas de series, películas y libros
(búsqueda en catálogo, alta manual, estados, filtros, orden, ficha de
detalle, valoración, notas, editar y eliminar) y, como primer paso, **elegir
la API de catálogo de videojuegos** que la alimente: el estudio comparativo
de candidatas y la justificación de la elección deben quedar documentados
junto con la implementación.

La app es **100 % cliente** (Firebase Hosting, vanilla JS, sin backend ni
proxy propio, con service worker): cualquier fuente de datos debe poder
consultarse desde el navegador (CORS) o a través de un **proxy mínimo** si
la API lo exige. Películas y series usan **TMDB** (clave en query string,
`networkFirst` para `api.themoviedb.org` y `cacheFirst` para
`image.tmdb.org` en el service worker, ADR-006 y ADR-007); libros usan
**Google Books + Open Library** (ADR-002, ADR-045, ADR-056 y ADR-065).

**Revisión (2026-08-10)**: la primera versión de este estudio eligió
**RAWG** como catálogo y la implementación de la pestaña (rama
`feat/issue-47-pestana-videojuegos`) se publicó a revisión (PR #166). Antes
de fusionarse, el usuario reportó (comentario en la issue #47) que **RAWG
ha dejado de dar soporte y está caída**: no se puede obtener la API key. Se
verifica de forma independiente: monitorización pública de rawg.io con
**0 % de disponibilidad en los últimos 30 días** (incidencias constantes
de julio y agosto de 2026, respuestas por tiempo agotado), imposibilidad de
registrarse para obtener la clave y testimonios de cierre de la API. La
implementación **se reconsidera y migra** a IGDB con un proxy Cloudflare
Worker, según el estudio actualizado que se documenta en este ADR.

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47

## Decisión

**Adoptar IGDB (Twitch) como única fuente del catálogo de videojuegos**,
consultado a través de un **Cloudflare Worker propio** que actúa de proxy
seguro: guarda el Client ID y el Client Secret como secretos cifrados de
Cloudflare, obtiene el token OAuth en servidor y reenvía las peticiones a
`https://api.igdb.com/v4/*` añadiendo CORS. La web solo conoce la **URL
pública del Worker** (`IGDB_PROXY_URL` en `js/config.js`), nunca los
secretos.

### Estudio comparativo de candidatas (revisado)

#### RAWG — descartada (caída)

- Fue la elección inicial (v1 de este ADR): REST GET con clave en query
  string, CORS habilitado, catálogo de ~500 000 juegos con Metacritic,
  ESRB, desarrolladores y nota de la comunidad 0–5.
- **Estado actual (verificado 2026-08-10)**: la API **ya no está
  operativa** — no responde (timeouts), lleva **semanas con incidencias
  continuas** (0 % de disponibilidad en 30 días según monitorización
  pública) y **no se puede obtener una clave** (el registro no funciona).
  El usuario no pudo obtener la API key y confirma la caída.
- Consecuencia: no es viable como dependencia de la app.

#### TheGamesDB (TGDB) — descartada

- Gratuita y con clave API accesible (registro en su foro).
- **CORS: NO** (verificado empíricamente el 2026-08-10): las respuestas de
  `api.thegamesdb.net` no incluyen `Access-Control-Allow-Origin` (ni en el
  preflight OPTIONS ni en las GET). **Requiere un proxy igualmente**, así
  que no ofrece la ventaja de «sin infraestructura» que se le suponía.
- **Sin valoraciones de la comunidad**: el modelo de datos no expone
  puntuaciones de usuarios ni de crítica (solo clasificación por edades
  tipo «E - Everyone»). El usuario lo confirma y lo echa en falta.
- Metadatos limitados: sin Metacritic, sin nota de comunidad, sin
  duración, portadas vía CDN propia.
- Al necesitar proxy de todos modos (CORS) y ofrecer **menos datos que
  IGDB**, no aporta ninguna ventaja frente a la opción elegida.

#### IGDB (Twitch) — seleccionada

- **Base de datos de videojuegos más completa**: nota de la comunidad
  (`total_rating` / `aggregated_rating`, escala 0–100 normalizada a 0–10
  en la app), géneros, plataformas, desarrolladores y editores (vía
  `involved_companies`), clasificación por edades ESRB/PEGI, portadas en
  CDN (`images.igdb.com`), sinopsis, fechas, etc.
- **Gratuita para uso no comercial** (acuerdo de desarrollador de Twitch);
  límite de **4 peticiones por segundo**, más que suficiente para uso
  personal.
- **Exige servidor**: no tiene CORS y el Client Secret es una credencial
  tipo contraseña que **no puede exponerse en una SPA** (además de violar
  el acuerdo de Twitch). La solución estándar es un **proxy mínimo** que
  custodie los secretos — aquí un **Cloudflare Worker** (plan gratuito,
  sin servidor que mantener, con secretos cifrados).

#### Otras candidatas evaluadas brevemente — descartadas

- **GiantBomb**: requiere API key, CORS limitado desde el navegador y
  menos datos que IGDB.
- **FreeToGame**: solo juegos *free-to-play*; no sirve como catálogo
  general.
- **Steam Web API**: solo el catálogo de Steam, requiere clave y datos
  limitados (sin portadas normalizadas ni nota de comunidad).
- **CheapShark**: solo ofertas/precios; no es un catálogo.

### Patrón de integración

- **Cloudflare Worker** en `cloudflare/igdb-proxy/` (`worker.js` +
  `wrangler.toml` + `README.md` con el paso a paso): obtiene el token
  OAuth de Twitch (flujo `client_credentials`), lo cachea con su
  caducidad y reenvía `POST /v4/*` a `api.igdb.com` con las cabeceras
  `Client-ID` y `Authorization: Bearer`, añadiendo CORS. El origen
  permitido se restringe opcionalmente con el secreto `ALLOWED_ORIGIN`.
- La URL del Worker se configura en **`js/config.js`** como
  `IGDB_PROXY_URL` (placeholder vacío por defecto; el usuario la obtiene
  al desplegar el Worker). Los secretos (`TWITCH_CLIENT_ID`,
  `TWITCH_CLIENT_SECRET`) viven solo en Cloudflare (`wrangler secret put`),
  nunca en el repositorio ni en el navegador.
- Búsqueda y datos ampliados en **`js/api-games.js`** (`searchGames` con
  paginación por `limit`/`offset` y `getGameDetails`), usando el lenguaje
  de consulta Apicalypse de IGDB.
- Service worker: **`cacheFirst` para `images.igdb.com`** (portadas); la
  API de IGDB va por el proxy con POST y no se cachea.
- Si falta la URL del proxy, la búsqueda **falla con un aviso claro**
  («Falta IGDB_PROXY_URL en js/config.js (ver
  cloudflare/igdb-proxy/README.md)»), y un **HTTP 401/403 se distingue**
  del resto de errores de red («IGDB rechazó la petición. Revisa las
  credenciales del proxy…»).

## Consecuencias

### Positivas

- **Catálogo de mayor calidad disponible**: IGDB tiene nota de la
  comunidad (0–10, igual que TMDB), géneros, plataformas,
  desarrolladores/ editores, ESRB y portadas — todo lo que RAWG ofrecía
  salvo Metacritic y duración media.
- **Secretos a salvo**: el Client Secret de Twitch nunca llega al
  navegador; el Worker los guarda cifrados (secretos de Cloudflare).
- **Proxy mínimo y gratuito**: Cloudflare Workers tiene plan gratuito; no
  hay servidor que mantener ni coste recurrente; la app sigue siendo
  estática.
- **Manejo de errores explícito**: proxy no configurado, credenciales
  rechazadas y error de red se distinguen (igual que con RAWG).

### Negativas / Riesgos

- **Infraestructura mínima nueva**: quien administre la web debe
  desplegar el Worker y configurar los secretos una vez (pasos en
  `cloudflare/igdb-proxy/README.md`). Sin ese despliegue, la búsqueda de
  videojuegos no funciona (con aviso claro).
- **Cuenta de Twitch necesaria**: IGDB se gestiona a través de
  dev.twitch.tv (gratis, requiere cuenta).
- **Sin Metacritic ni duración media**: IGDB no expone esos campos; la
  ficha muestra plataformas, desarrolladores, editores, ESRB, sinopsis y
  nota de la comunidad.
- **Límite de peticiones**: 4 req/s (uso no comercial); suficiente para
  uso personal.
- **Dependencia del Worker**: si el Worker falla (secretos, límites de
  Cloudflare), la búsqueda se degrada; el resto de la app no se ve
  afectada.

### Neutras

- **Atribución**: se mantiene el crédito «Datos de videojuegos vía IGDB
  (igdb.com)» en el footer de `index.html` y en `ocio/videojuegos.html`.
- **Colección Firestore nueva**: los juegos se guardan en
  `users/{uid}/games` (cubierta por `firestore.rules`) y se incluyen en la
  copia de seguridad, como el resto de tipos.
- **Sin migración de datos**: no había datos previos de videojuegos en
  producción (la PR aún no se había fusionado cuando se revisó la
  decisión); el campo `externalId` de IGDB es el que se guarda.
- **Escala de nota**: IGDB puntúa 0–100; la app la normaliza a **0–10**
  (igual que TMDB) y así queda documentado en el manual de usuario (§10).

## Trabajo futuro (fuera del alcance de la v1 de la issue #47)

Quedan **explícitamente fuera del alcance** de esta primera versión y se
plantearán como issues independientes si se desean:

- Pestaña de videojuegos en la **vista de amigos** (`js/profile.js`).
- **Actividad / feed** de videojuegos.
- **Stats del perfil** (horas jugadas, géneros, plataformas…).
- **Daily-check / notificaciones** de videojuegos.
- **Exportación ICS** de fechas de lanzamiento jugadas, etc.

## Alternativas descartadas

- **RAWG**: descartada — API caída y sin soporte (verificado 2026-08-10);
  no se puede obtener clave.
- **TheGamesDB**: descartada — sin CORS (requiere proxy igualmente) y sin
  valoraciones de la comunidad; menos datos que IGDB.
- **GiantBomb**: descartada — CORS limitado y menos metadatos que IGDB.
- **FreeToGame**: descartada — solo free-to-play.
- **Steam Web API**: descartada — solo el catálogo de Steam y datos
  limitados.
- **CheapShark**: descartada — solo ofertas, no catálogo.
- **Proxy/backend propio alojado (VPS, función cloud genérica)**: se
  prefiere el **Cloudflare Worker** por su plan gratuito, despliegue
  mínimo y secretos cifrados integrados.

## Configuración necesaria (quien administra la web)

Pasos completos en `cloudflare/igdb-proxy/README.md`. Resumen:

1. **Twitch**: crear aplicación en dev.twitch.tv/console/apps (tipo
   *Application Integration*), anotar **Client ID** y generar **Client
   Secret** (se muestra una sola vez).
2. **Cloudflare**: cuenta gratuita; `wrangler login`; `wrangler deploy`
   en `cloudflare/igdb-proxy/`.
3. **Secretos**: `wrangler secret put TWITCH_CLIENT_ID`,
   `wrangler secret put TWITCH_CLIENT_SECRET` y (recomendado)
   `wrangler secret put ALLOWED_ORIGIN` con el dominio de la web.
4. **App**: poner la URL del Worker en `IGDB_PROXY_URL` de `js/config.js`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `docs/adr-066-estudio-apis-videojuegos.md` | **Nuevo**: este documento (revisado: RAWG → IGDB + proxy) |
| `cloudflare/igdb-proxy/worker.js`, `wrangler.toml`, `README.md` | **Nuevos**: proxy de IGDB (Cloudflare Worker) con instrucciones de despliegue y configuración |
| `js/api-games.js`, `js/config.js`, `service-worker.js`, `js/search.js`, `js/ui.js`, `js/modal-handlers.js`, `js/quick-actions.js`, `index.html`, `ocio/videojuegos.html`, `ocio/ocio.css` | **Existentes**: migración de RAWG a IGDB (rama `feat/issue-47-pestana-videojuegos`) |
| `docs/manual-de-usuario.md` | **Existente**: §7.2, §8.1, §10, §16 y §19 actualizados (IGDB, escala 0–10, avisos del proxy) |
| `tasks/task-issue-47.json` | **Existente**: definición de done (criterio «ADR documentado con 'Related issue: #47'») que este ADR cumple |

Relacionado con: tasks/task-issue-47.json

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47
