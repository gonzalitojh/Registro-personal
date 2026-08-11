# ADR-068: Consistencia en la información de videojuegos — valoración, tráiler y plataformas en la ficha (issue #171)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La issue #171 detecta que la **ficha (ventana de información) de los
videojuegos** no ofrece la misma información que las de películas y series
(teniendo en cuenta que son productos distintos). Concretamente:

1. **No muestra la valoración de la comunidad** IGDB: solo aparece en la
   tarjeta reducida del grid y en la vista previa de búsqueda, no en el
   modal de detalle (`openGameModal`).
2. **No muestra enlace al tráiler**: ni películas ni series se quedan sin
   él cuando la API lo proporciona; los videojuegos no consultaban ningún
   endpoint de vídeos.
3. **Las plataformas jugables se muestran como texto plano** dentro de
   `extraInfoHtml`, mientras que películas y series muestran sus
   plataformas de streaming de forma visual (badges/chips).

El catálogo de videojuegos se alimenta de **IGDB** a través del proxy
Cloudflare Worker (ADR-067). IGDB expone el endpoint **`game_videos`**
(campos `game`, `name`, `video_id` — el `video_id` es el ID de YouTube),
que el proxy ya reenvía (`POST /v4/*` es pass-through), y las plataformas
ya llegan como `platforms.name` en búsqueda y detalle (guardadas en
Firestore como `string[]`).

## Decisión

Alinear la ficha de videojuegos con las de películas/series en tres
puntos, reutilizando los componentes existentes:

1. **Valoración de la comunidad**: el modal de videojuegos
   (`openGameModal` en `js/ui.js`) pasa a renderizar
   `communityRatingDisplay(item)` — el mismo componente que usan
   películas/series y la tarjeta reducida, con el label «IGDB». El dato ya
   estaba disponible (`total_rating` / `aggregated_rating` normalizados a
   0–10); no se añade ninguna consulta.
2. **Tráiler de YouTube** cuando IGDB lo proporciona:
   - Nueva consulta `getGameTrailerUrl(id)` en `js/api-games.js` que hace
     `igdbPost("game_videos", 'fields video_id, name; where game = <id>;
     limit 5;')` a través del proxy existente, con **try/catch interno que
     devuelve `null`** (el tráiler es un extra no crítico: si falla, la
     ficha no se rompe).
   - `extractTrailerUrl(videos)` replica el patrón de
     `_extractTrailerUrl` de `api-movies.js` (prioriza el vídeo cuyo
     nombre contenga «trailer», si no usa el primero con `video_id`, y
     construye `https://www.youtube.com/watch?v=<video_id>`).
   - `getGameDetails` devuelve el nuevo campo opcional **`trailerUrl`**.
   - El modal renderiza `trailerButtonHtml(item)` (componente existente);
     sin `trailerUrl` no se pinta nada, sin huecos.
   - **Fetch perezoso para juegos ya guardados** (`openGameItem` en
     `js/modal-handlers.js`): si el juego tiene `externalId` pero aún no
     tiene `trailerUrl`, al abrir su ficha se consulta IGDB y, si hay
     tráiler, se persiste con `ctx.updateItem` (mismo patrón que el fetch
     de watchProviders de películas). Todo en try/catch no-bloqueante: el
     modal **siempre** se abre aunque falle la consulta. Los videojuegos
     **siguen sin actualizarse solos** (no se toca `daily-check.js`): el
     fetch se dispara por una acción del usuario (abrir la ficha).
3. **Plataformas jugables como chips visuales**:
   - Nueva función `gamePlatformsHtml(item)` en `js/ui.js` que renderiza
     `<div class="game-platforms">` con título «Plataformas:» y una lista
     de chips `<li class="game-platform">` por plataforma (escapada con
     `escapeHtml`); devuelve `""` si no hay plataformas.
   - Se **elimina la rama de plataformas en texto plano** de
     `extraInfoHtml` (developers, editores, Metacritic/duración y ESRB se
     conservan).
   - Los chips también se muestran en la **vista previa de búsqueda**
     (`openSearchPreviewModal`, render inicial y re-render del enrich) y
     en el **modal de solo lectura** (`openReadOnlyModal`, fichas de
     amigos).
   - CSS en `ocio/ocio.css` siguiendo el patrón visual de
     `.watch-providers` pero con **tokens de tema** (`--paper-dim`,
     `--ink-soft`, `--paper`, `--ink`, `--radius`), sin hex hardcodeados,
     con `flex-wrap` + `overflow-wrap: break-word` + `min-width: 0`
     (prohibido `white-space: nowrap`: nombres largos como «PC (Microsoft
     Windows)» deben poder partirse) y override de negro puro integrado en
     el **selector agrupado** existente de `.watch-provider` (una sola
     fuente de verdad, AGENTS.md regla 4).

### Por qué no logos de plataformas (IGDB `platform_logo`)

IGDB ofrece `platform_logo`, pero su uso obligaría a cambiar el shape de
`platforms` guardado en Firestore (hoy `string[]`) y a **migrar los datos
existentes**. Los chips de texto cumplen el criterio de la issue («más
visual, parecido a las plataformas de streaming») con cero migración y
mantienen el shape actual.

### Por qué el endpoint dedicado `game_videos` y no expandir `DETAIL_FIELDS`

La alternativa de expandir la consulta de detalle con
`game_videos.video_id` es viable (el código ya expande
`involved_companies.company.name`), pero el endpoint dedicado es el
documentado por IGDB, sin ambigüedad, y solo se invoca cuando hace falta
(detalle de la ficha), no en cada resultado de búsqueda.

## Consecuencias

### Positivas

- **Coherencia entre fichas**: videojuegos, películas y series muestran
  valoración de la comunidad, tráiler y plataformas en el mismo formato.
- **Sin migración de datos**: `platforms` sigue siendo `string[]`;
  `trailerUrl` es un campo nuevo opcional (Firestore no valida campos).
- **Sin tocar el proxy ni los secretos**: el endpoint `game_videos` pasa
  por el proxy IGDB existente; no se despliega nada nuevo.
- **Degradación elegante**: sin tráiler en IGDB (o con el proxy caído) la
  ficha se abre igualmente, sin botón ni huecos raros.
- **Componentes reutilizados**: `communityRatingDisplay`,
  `trailerButtonHtml` y `escapeHtml` ya existían y estaban validados en
  los cuatro modos de tema; el único CSS nuevo (`.game-platform*`) usa
  tokens de tema con su override de negro puro.

### Negativas / Riesgos

- **Coste de peticiones**: abrir una ficha de juego hace 2 consultas a
  IGDB (detalle + `game_videos`), dentro del límite de 4 req/s del plan
  no comercial; volumen ínfimo para uso personal.
- **Latencia puntual en la apertura**: el fetch perezoso de `openGameItem`
  espera a IGDB antes de abrir el modal (2 consultas con reintento en
  `igdbPost`); es el mismo comportamiento que ya tiene la ficha de
  películas con los watchProviders, y el try/catch garantiza que el modal
  siempre se abre.
- **Sin caché negativa**: un juego sin tráiler vuelve a consultar IGDB en
  cada apertura (los juegos con tráiler quedan persistidos). Mejora
  posible en el futuro.
- **Contraste del título «Plataformas:» en modo Oscuro**: `--ink-soft`
  sobre `--paper-dim` queda por debajo del AA 4.5:1, igual que el patrón
  existente `.watch-providers__title` (deuda del patrón, no nueva); el
  resto de modos cumple AA.

### Neutras

- **`trailerUrl` en copias de seguridad**: se guarda con el resto del
  registro del juego (`users/{uid}/games`), igual que el resto de campos.
- **`.wrangler/` ignorado**: el security-champion detectó que la caché
  local de wrangler contiene el account ID de Cloudflare y el email
  (PII); se añade `.wrangler/` al `.gitignore` para que nunca pueda
  commitearse por error.

## Alternativas descartadas

- **Logos de plataformas de IGDB** (`platform_logo`): descartados —
  requiere cambiar el shape de `platforms` y migrar los datos existentes;
  los chips de texto cumplen el objetivo con cero migración.
- **Expandir `DETAIL_FIELDS` con `game_videos.video_id`**: descartada —
  el endpoint dedicado `game_videos` es el documentado, sin ambigüedad, y
  solo se consulta en la ficha.
- **Variante de color violeta (`--games`) para la valoración**: descartada
  — se mantiene el teal del componente existente (idéntico a tarjetas y a
  películas/series, con contraste ya validado).
- **Actualización automática del tráiler (daily-check)**: descartada —
  el manual §16 promete que los videojuegos no se actualizan solos; el
  fetch perezoso al abrir la ficha es una acción del usuario.
- **Persistir el tráiler solo en memoria** (sin `ctx.updateItem`):
  descartada — persistiendo, la segunda apertura es instantánea y las
  fichas de solo lectura (amigos) muestran el tráiler guardado.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-games.js` | **Existente**: `GAME_VIDEO_FIELDS`, `extractTrailerUrl`, `getGameTrailerUrl` (endpoint `game_videos`, try/catch → null) y campo `trailerUrl` en `getGameDetails` |
| `js/ui.js` | **Existente**: `gamePlatformsHtml`; `openGameModal` con `communityRatingDisplay` + `trailerButtonHtml` + `gamePlatformsHtml`; plataformas en texto plano eliminadas de `extraInfoHtml`; chips en la vista previa de búsqueda y en `openReadOnlyModal` |
| `js/modal-handlers.js` | **Existente**: `openGameItem` async con fetch perezoso del tráiler (try/catch no-bloqueante + persistencia `ctx.updateItem`) |
| `ocio/ocio.css` | **Existente**: bloque `.game-platforms*` / `.game-platform` (tokens de tema, sin nowrap) y override de negro puro en el selector agrupado de `.watch-provider` |
| `docs/manual-de-usuario.md` | **Existente**: §10 (tráiler de videojuegos cuando IGDB lo tiene; plataformas como etiquetas) y §16 (tráiler guardado al abrir la ficha) |
| `.gitignore` | **Existente**: `.wrangler/` añadido (PII: account ID + email) |

Relacionado con: tasks/task-issue-171.json

Related issue: #171 — https://github.com/gonzalitojh/Registro-personal/issues/171
