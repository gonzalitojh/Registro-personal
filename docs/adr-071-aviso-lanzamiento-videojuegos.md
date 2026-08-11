# ADR-071: Aviso de lanzamiento de videojuegos (issue #175)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La **comprobación diaria** (`checkForUpdates` en `js/daily-check.js`)
revisa una vez al día, sin red salvo excepciones puntuales, los estrenos
de películas pendientes (`movie_release`), las premieres de series
(`series_premiere`) y los episodios nuevos (`new_episode`), y crea las
notificaciones correspondientes en la campana (ADR-037, ADR-012).

Los **videojuegos** son una categoría propia desde la issue #47
(colección `games` en Firestore, `playLog` por juego, ADR-067 para el
estudio de APIs y ADR-068 para la consistencia de su información), pero
no tenían hueco en la comprobación diaria: al añadirlos se guardaba el
año (`year`) pero **no la fecha de lanzamiento** (`first_release_date` de
IGDB no se mapeaba), y el manual de usuario (§16) decía explícitamente
que «los videojuegos no se actualizan solos… no hay comprobación diaria
de novedades para ellos».

La issue #175 pide incluir los videojuegos en las daily-check y las
notificaciones: avisar cuando un juego pendiente **sale a la venta**.

Restricción de diseño relevante: IGDB se consulta a través de un proxy
Cloudflare Worker con un **rate limit de 4 req/s** (ADR-067); refrescar
diariamente los metadatos de todos los juegos guardados no es viable por
coste del proxy y límite de peticiones.

Related issue: #175 — https://github.com/gonzalitojh/Registro-personal/issues/175

## Decisión

Añadir un aviso de lanzamiento de videojuegos **sin red**: la fecha se
guarda al añadir el juego y la pasada diaria solo la compara con la
fecha actual, siguiendo el patrón fail-open de las series manuales.

### 1. `releaseDate` en api-games.js

Nuevo helper `dateFromTimestamp(ts)`: convierte el timestamp Unix de
IGDB (en **segundos**) a `"YYYY-MM-DD"` usando **partes de fecha
locales** (`getFullYear`/`getMonth`/`getDate`, nunca `toISOString()`,
que usaría UTC y desviaría un día cerca de medianoche — mismo criterio
local que `yearFromTimestamp`). Devuelve `null` si no hay timestamp o es
inválido. `releaseDate` se añade al resultado de `mapGameResult`
(búsqueda) y de `getGameDetails` (detalles al añadir).

### 2. `awaitingRelease` al añadir (search.js)

- **Flujo normal** (`handleAdd`): tras enriquecer el borrador con
  `getGameDetails`, si `details.releaseDate && isUnreleasedDate(details.releaseDate)`
  → `draft.awaitingRelease = true`. La **guarda `releaseDate` truthy es
  obligatoria**: `isUnreleasedDate(null)` devuelve `true` y un juego sin
  fecha quedaría `awaitingRelease` para siempre (no hay refresco diario
  que lo resuelva).
- **Flujo «marcar jugado»** (`handleAddSeen`): el borrador lleva
  `awaitingRelease: false` explícito — un juego que ya se marcó como
  jugado en el momento del alta no espera lanzamiento.

### 3. Pasada diaria sin red (daily-check.js)

Nueva pasada de videojuegos en `checkForUpdates`, tras el bloque de
series manuales. **Sin red**: usa los datos guardados (IGDB no se
consulta en la pasada). **Fail-open** como `manualShows`: un error de
escritura no aborta la pasada ni cuenta como fallo de API. Se revisan
todos los juegos no manuales, con dos fases por juego:

| Fase | Condición | Acción |
|------|-----------|--------|
| **Backfill del flag** | `!g.awaitingRelease && g.releaseDate && isUnreleasedDate(g.releaseDate) && !(g.playLog && g.playLog.length)` | `updates.awaitingRelease = true` |
| **Aviso de lanzamiento** | `prefs.game_release !== false && g.awaitingRelease && g.releaseDate && g.releaseDate <= today && !(g.playLog && g.playLog.length)` | `addNotification` con ««Título» ya está a la venta (dd/mm/aaaa).» (`formatDateEs`), `awaitingRelease = false`, `releasedNoticedAt = today` |

- El **backfill** cubre los juegos guardados antes de la issue #175 que
  ya tengan `releaseDate`; la guarda truthy impide marcar juegos sin
  fecha (sin fecha no hay lanzamiento que esperar).
- La **guarda del `playLog`** en ambas fases es necesaria porque
  `quick-actions.js` y `modal-handlers.js` no limpian `awaitingRelease`
  al marcar un juego como jugado: sin ella se avisaría de juegos ya
  terminados.
- `releasedNoticedAt` se persiste como registro de que el aviso se
  emitió (y evita repetirlo si un futuro refresco de metadatos
  reintroduce el flag).

### 4. Preferencia `game_release` (settings.js + index.html)

- `game_release: true` en `DEFAULT_SETTINGS.notifications` (entre
  `series_premiere` y `friend_activity`).
- Añadida a los **dos mapas** de checkboxes de settings.js: el de
  `renderSettings` y el de `wireNotificationToggles`, ambos con id
  `"notif-game-release": "game_release"`.
- `index.html`: nueva fila de ajustes «Estrenos de videojuegos» con el
  checkbox `notif-game-release` (marcado por defecto), tras «Estrenos de
  series».

## Alternativas descartadas

- **Refresco diario de metadatos de IGDB**: descartado — el coste del
  proxy Cloudflare Worker y el rate limit de IGDB (4 req/s, ADR-067)
  hacen inviable consultar todos los juegos cada día; la información se
  rellena en el momento de añadirlos y la pasada diaria trabaja sin red
  con los datos guardados.
- **Tratar «sin fecha» como `awaitingRelease`**: descartado — sería un
  flag muerto: sin `releaseDate` el aviso nunca podría dispararse y el
  backfill no tendría fecha que comprobar; quedaría `true` para siempre
  (y el manual §16 prometía que los juegos no se actualizan solos, así
  que nada lo resolvería).
- **Migración de juegos existentes con un refresco único**: descartado —
  implicaría una pasada de red masiva puntual (coste del proxy/rate
  limit); el backfill de la pasada diaria consigue gratis el mismo
  resultado para los juegos que ya tengan `releaseDate`.
- **Limpiar `awaitingRelease` en quick-actions.js y modal-handlers.js**:
  descartado — ampliaría la superficie de cambio a todos los flujos de
  «marcar jugado»; la guarda del `playLog` en la pasada diaria logra el
  mismo efecto sin tocar esos flujos.

## Consecuencias

### Positivas

- Los videojuegos con fecha de lanzamiento futura avisan de su salida a
  la venta en la campana, con su preferencia propia desactivable en
  Ajustes.
- La pasada diaria sigue siendo **sin red** para los juegos (mismo
  patrón fail-open que las series manuales).
- El backfill cubre automáticamente los juegos preexistentes que ya
  tengan `releaseDate`, sin migraciones.

### Negativas / Riesgos

- Los juegos guardados **antes** de esta feature y **sin** `releaseDate`
  no recibirán nunca el aviso: sin migración ni refresco de metadatos no
  hay forma de conocer su fecha (aceptado; el backfill solo aplica a los
  que ya tengan fecha).
- Los juegos sin fecha de lanzamiento en IGDB tampoco avisan nunca (ni
  falta que hace: no hay lanzamiento que esperar).
- La guarda del `playLog` depende de que el juego tenga historial: un
  juego marcado jugado por otros caminos sin tocar el `playLog` podría
  recibir el aviso (caso límite aceptado).

### Neutras

- La notificación de videojuegos «escapa» (se muestra) en los **3 sinks
  de render** sin código específico por tipo: la lista de la campana y el
  badge (`renderNotifications`, app.js) y la notificación del sistema
  vía push (js/push.js `handleNotificationsSnapshot` → `SHOW_NOTIFICATION`
  → service-worker.js), porque el mensaje es texto libre y los sinks no
  distinguen tipos.
- `docs/manual-de-usuario.md` actualizado (§13 notificaciones, §15
  ajustes y §16 sincronización — este último ya no promete que los
  videojuegos queden fuera de la comprobación diaria) (regla 3 de
  AGENTS.md).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-games.js` | **Modificado**: `dateFromTimestamp(ts)` (timestamp Unix en segundos → `"YYYY-MM-DD"` con hora local, `null` sin fecha) y `releaseDate` en `mapGameResult` y `getGameDetails` |
| `js/search.js` | **Modificado**: `awaitingRelease: true` al añadir si `releaseDate` truthy y futura (guarda obligatoria); `awaitingRelease: false` explícito en `handleAddSeen` |
| `js/daily-check.js` | **Modificado**: pasada de videojuegos sin red (fail-open): backfill del flag y aviso de lanzamiento con guardas `releaseDate` truthy y `playLog`, `releasedNoticedAt` |
| `js/settings.js` | **Modificado**: `game_release: true` en `DEFAULT_SETTINGS.notifications` y en los dos mapas de checkboxes (`renderSettings` y `wireNotificationToggles`) con id `notif-game-release` |
| `index.html` | **Modificado**: fila de ajustes «Estrenos de videojuegos» (checkbox `notif-game-release`, marcado), tras «Estrenos de series» |
| `docs/manual-de-usuario.md` | **Modificado**: §13 (nuevo tipo de aviso), §15 (nuevo ajuste) y §16 (los juegos ya no quedan fuera de la comprobación diaria de lanzamientos) |
| `docs/adr-071-aviso-lanzamiento-videojuegos.md` | **Nuevo**: este documento |

## Verificación

- Revisión QA: PASS — `releaseDate` guardado al añadir (búsqueda y
  detalles), `awaitingRelease` solo con fecha futura real y sin
  `playLog`, backfill de juegos preexistentes con fecha, aviso con
  mensaje ««Título» ya está a la venta (dd/mm/aaaa).», limpieza del flag
  y `releasedNoticedAt` tras notificar, preferencia `game_release`
  funcional en los dos mapas de settings y checkbox marcado por defecto.
- Sin red en la pasada: PASS — la comprobación diaria de juegos solo lee
  datos guardados; IGDB no se consulta (coste del proxy/rate limit
  respetado).
- Sinks de render: PASS — la notificación aparece en la lista de la
  campana, el badge y la notificación del sistema (push) sin cambios en
  esos flujos.
- Temas: PASS — la fila de ajustes reutiliza el patrón de switch
  existente, sin colores ni superficies nuevas.
- Escaneo de seguridad: PASS sin hallazgos (solo lectura de prefs y
  escritura sobre el propio juego, sin secretos ni PII).

Related issue: #175 — https://github.com/gonzalitojh/Registro-personal/issues/175
