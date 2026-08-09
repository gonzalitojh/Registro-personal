# ADR-066: Estudio de APIs de videojuegos — se adopta RAWG como catálogo (issue #47)

## Estado
Aceptado

## Fecha
2026-08-09

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
consultarse directamente desde el navegador (CORS habilitado) y encajar en
el patrón ya consolidado de las otras pestañas. Películas y series usan
**TMDB** (clave en query string, `networkFirst` para `api.themoviedb.org` y
`cacheFirst` para `image.tmdb.org` en el service worker, ADR-006 y ADR-007);
libros usan **Google Books + Open Library** (ADR-002, ADR-045, ADR-056 y
ADR-065). El punto de partida de la issue eran **RAWG e IGDB** como
candidatas principales, con otras alternativas menores a evaluar.

El estudio ya está **realizado y validado (QA PASS)**: la implementación de
la pestaña (rama `feat/issue-47-pestana-videojuegos`) usa RAWG, y el manual
de usuario se actualizó en la misma tarea (`docs/manual-de-usuario.md` §7,
regla 3 de AGENTS.md). Este ADR documenta el estudio y la decisión a
posteriori, como los ADR recientes (ADR-059 a ADR-065), y cumple la
definición de done de `tasks/task-issue-47.json` («ADR documentado con
'Related issue: #47'»).

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47

## Decisión

**Adoptar RAWG como única fuente del catálogo de videojuegos** (búsqueda en
el buscador global + datos ampliados al añadir), replicando el patrón de
integración de TMDB. No se adopta ningún proxy ni backend intermedio.

### Estudio comparativo de candidatas

#### IGDB (Twitch) — descartada

Catalogada como la **base de datos de videojuegos más completa** del
mercado, pero incompatible con la arquitectura de la app por tres motivos
bloqueantes:

- Exige **Client ID + Client Secret**: el secreto es una credencial tipo
  contraseña que **no puede exponerse en una SPA** (quedaría visible en el
  código que se sirve al navegador) y cuyo uso en cliente **viola el acuerdo
  de desarrollador de Twitch**.
- **No permite CORS** desde el navegador: las peticiones requieren un
  **proxy/backend** que firme el token OAuth en servidor, infraestructura de
  la que el proyecto carece por diseño.
- El **token OAuth en servidor obligatorio** arrastra el mismo problema de
  infraestructura y añade gestión de caducidad/renovación.

#### RAWG — seleccionada

- **REST GET simple** con la clave en query string (`?key=`), **CORS
  habilitado**: funciona desde el navegador sin backend, como TMDB.
- Clave **gratuita para uso personal** (≈ **20 000 peticiones/mes**),
  tratada como **no secreta** igual que TMDB/Google Books: la protección
  real la dan las reglas de Firestore, no la ocultación de la clave.
- Catálogo de **~500 000 juegos** con metadatos ricos: **Metacritic, ESRB,
  desarrolladores, editores, plataformas, duración media (playtime), nota de
  la comunidad (escala 0–5) y portada** (`background_image`).
- **Atribución requerida**: se cumple con el crédito en el footer
  (`index.html`) y en el propio panel (`ocio/videojuegos.html`).

#### Otras candidatas evaluadas brevemente — descartadas

- **GiantBomb**: requiere API key, tiene CORS limitado desde el navegador y
  ofrece menos datos que RAWG.
- **TheGamesDB**: datos pobres (sin Metacritic ni ESRB) y CORS dudoso.
- **FreeToGame**: solo juegos *free-to-play*; no sirve como catálogo
  general.
- **Steam Web API**: solo el catálogo de Steam, requiere clave y datos
  limitados (sin portadas normalizadas ni nota de comunidad).
- **CheapShark**: solo ofertas/precios; no es un catálogo.

### Patrón de integración (idéntico al de TMDB)

- La clave se deja en **`js/config.js`** como `RAWG_API_KEY` (placeholder
  vacío por defecto; el usuario la obtiene gratis en `rawg.io/apidocs`).
- Búsqueda y datos ampliados en **`js/api-games.js`** (`searchGames` con
  paginación y `getGameDetails`), con la clave en query string.
- Service worker: **`networkFirst` para `api.rawg.io`** (API, junto a TMDB,
  Google Books y Open Library) y **`cacheFirst` para `media.rawg.io`**
  (portadas), en `service-worker.js`.
- Si falta la clave, la búsqueda **falla con un aviso claro** («Falta la
  clave de RAWG en js/config.js (gratis en rawg.io/apidocs)»), y un **HTTP
  401/403 se distingue** del resto de errores de red («RAWG rechazó la
  petición. Revisa tu clave de API en js/config.js»).

## Consecuencias

### Positivas

- **Cero backend**: RAWG funciona desde el navegador con CORS habilitado;
  se conserva la arquitectura 100 % cliente de Firebase Hosting y el
  service worker.
- **Mismas garantías que TMDB**: patrón de integración probado (query
  string, networkFirst/cacheFirst), clave no secreta protegida por las
  reglas de Firestore, y manejo de errores explícito (clave ausente,
  clave rechazada y error de red).
- **Metadatos ricos**: Metacritic, ESRB, desarrolladores, plataformas,
  duración y portada en el mismo flujo que películas/series/libros.

### Negativas / Riesgos

- **Clave necesaria para buscar**: sin `RAWG_API_KEY` en `js/config.js` la
  búsqueda no funciona; se mitiga con un aviso claro en el flujo de
  búsqueda.
- **Cuota mensual**: ≈ 20 000 peticiones/mes en el plan gratuito personal;
  suficiente para uso individual pero no ilimitada.
- **Escala de nota distinta**: la nota de comunidad de RAWG es **0–5**,
  frente al **0–10** de TMDB; la diferencia queda documentada en el manual
  de usuario (`docs/manual-de-usuario.md` §10).
- **Datos en inglés**: RAWG no ofrece localización completa; títulos,
  géneros y sinopsis se muestran tal como los sirve la API.

### Neutras

- **Atribución obligatoria**: se añade el crédito «Datos de videojuegos vía
  RAWG (rawg.io)» en el footer de `index.html` y en `ocio/videojuegos.html`.
- **Colección Firestore nueva**: los juegos se guardan en
  `users/{uid}/games` (cubierta por `firestore.rules`) y se incluyen en la
  copia de seguridad, como el resto de tipos.
- **Sin migración de datos**: no había datos previos de videojuegos.

## Trabajo futuro (fuera del alcance de la v1 de la issue #47)

Quedan **explícitamente fuera del alcance** de esta primera versión y se
plantearán como issues independientes si se desean:

- Pestaña de videojuegos en la **vista de amigos** (`js/profile.js`).
- **Actividad / feed** de videojuegos.
- **Stats del perfil** (horas jugadas, géneros, plataformas…).
- **Daily-check / notificaciones** de videojuegos.
- **Exportación ICS** de fechas de lanzamiento jugadas, etc.

## Alternativas descartadas

- **IGDB (Twitch)**: descartada — Client Secret inexponible en una SPA, sin
  CORS y token OAuth en servidor obligatorio (requiere backend).
- **GiantBomb**: descartada — CORS limitado y menos metadatos que RAWG.
- **TheGamesDB**: descartada — datos pobres y CORS dudoso.
- **FreeToGame**: descartada — solo free-to-play.
- **Steam Web API**: descartada — solo el catálogo de Steam y datos
  limitados.
- **CheapShark**: descartada — solo ofertas, no catálogo.
- **Proxy/backend propio (p. ej. para poder usar IGDB)**: descartado —
  rompe la arquitectura 100 % cliente de la app y añade coste recurrente.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `docs/adr-066-estudio-apis-videojuegos.md` | **Nuevo**: este documento |
| `js/api-games.js`, `js/config.js`, `service-worker.js`, `js/search.js`, `js/global-search.js`, `js/ui.js`, `js/modal-handlers.js`, `js/quick-actions.js`, `js/game-log.js`, `js/app.js`, `js/db.js`, `js/constants.js`, `js/sorting.js`, `js/router.js`, `js/export-backup.js`, `index.html`, `ocio/videojuegos.html`, `ocio/ocio.css`, `css/styles.css`, `firestore.rules` | **Existentes**: implementación de la pestaña de videojuegos (rama `feat/issue-47-pestana-videojuegos`, QA PASS) — no se modifican con este ADR |
| `docs/manual-de-usuario.md` | **Existente**: §7 «Videojuegos» actualizado en la implementación — no se modifica con este ADR |
| `tasks/task-issue-47.json` | **Existente**: definición de done (criterio «ADR documentado con 'Related issue: #47'») que este ADR cumple — no se modifica |

Relacionado con: tasks/task-issue-47.json

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47
