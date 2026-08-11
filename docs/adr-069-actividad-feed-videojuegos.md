# ADR-069: Videojuegos en el feed de actividad (issue #173)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

El **feed de actividad** de la sección **Actividad** del perfil (ADR-015,
issue #27) muestra en orden cronológico lo que han hecho los amigos:
películas, series y libros. El feed es **generado 100 % en cliente**
(`js/activity-feed.js`): no existen colecciones de eventos en Firestore;
cada vez que se abre la pestaña Actividad se leen los datos actuales de
todos los amigos (`loadActivityFeed` en `js/profile.js`) y `buildGlobalFeed`
/ `buildFriendFeed` reconstruyen los eventos con `maybePushDateEvent`.

Los **videojuegos** son una categoría propia del producto desde la issue
#47 (colección `games` en Firestore, pestaña en Ocio con
`ocio/videojuegos.html`, estados Pendiente / Jugando / Jugado / Standby /
Abandonado y un `playLog` por juego con `startedAt`/`finishedAt`), y el
detalle de amigo ya los muestra desde la issue #172 (ADR-068, pestaña
«Videojuegos» con `openReadOnlyModal` soportando items de tipo `game`:
`gamePlatformsHtml` y `statusLabel`). Sin embargo, el feed de actividad
aún no generaba eventos de videojuegos: «Está jugando…» y «Terminó de
jugar…» no aparecían entre las actividades de los amigos.

La issue #173 pide incluir la actividad de videojuegos en el feed.

Related issue: #173 — https://github.com/gonzalitojh/Registro-personal/issues/173

## Decisión

Ampliar la generación de eventos del feed para incluir videojuegos,
replicando el patrón del ADR-015 (todo en cliente, sin tocar Firestore ni
CSS):

### 1. Nuevos tipos de evento (activity-feed.js)

Se añaden dos constantes a `EVENT_TYPES`:

| Evento           | Constante        | Label               | Condición de disparo                                   |
|------------------|------------------|---------------------|--------------------------------------------------------|
| Empezó a jugar   | `GAME_STARTED`   | «Está jugando»      | Entrada en `playLog` con `startedAt` y sin `finishedAt` |
| Terminó de jugar | `GAME_FINISHED`  | «Terminó de jugar»  | Entrada en `playLog` con `finishedAt`                  |

### 2. `buildFriendFeed` con 5.º parámetro `games`

- La firma pasa a ser `buildFriendFeed(friendName, movies, series, books,
  games = [])`; el parámetro tiene valor por defecto `[]` para no romper
  llamadas que no pasen la categoría.
- Por cada juego, se recorren las entradas de su `playLog`:
  - Entrada con `startedAt` y sin `finishedAt` → evento `game_started`
    «Está jugando» con la fecha `startedAt`.
  - Entrada con `finishedAt` → evento `game_finished` «Terminó de jugar»
    con la fecha `finishedAt`.
- **Fallback**: juego con `status === "completado"` y sin entradas en
  `playLog` → evento `game_finished` «Terminó de jugar» con `updatedAt`,
  cubriendo juegos completados antes de existir el `playLog` o importados
  sin historial.

### 3. `buildGlobalFeed` reenvía `games`

La desestructuración de cada amigo pasa de `{ profile, movies, series,
books }` a `{ profile, movies, series, books, games }` y reenvía `games`
a `buildFriendFeed`.

### 4. Carga en `loadActivityFeed` (profile.js)

El `Promise.all` por amigo incluye la cuarta categoría:
`ctx.getItemsOnce(profile.uid, "game")` (misma lectura puntual sin
suscripción que las existentes; la lectura de `games` de otros usuarios
ya está permitida por `firestore.rules` desde el ADR-068). El objeto
devuelto por amigo pasa a ser `{ profile, movies, series, books, games }`.

### 5. Iconos de evento (ui.js)

`eventIcon` incorpora `game_started: "🎮"` y `game_finished: "🏆"`;
cualquier evento desconocido sigue cayendo en el fallback `📌`.

### 6. Sin cambios estructurales

No se tocan Firestore ni CSS: el feed sigue generándose 100 % en cliente
(patrón ADR-015) y el modal de solo lectura ya soportaba items `game`
desde el ADR-068 (issue #172).

## Alternativas descartadas

- **Persistir eventos de videojuegos en Firestore**: descartada por el
  principio del ADR-015 — el feed se reconstruye en cliente desde el
  estado actual; persistir eventos añadiría colecciones nuevas sin
  beneficio.
- **Dedup de `startedAt` y `finishedAt` en una sola entrada de
  `playLog`**: una misma partida puede generar ambos eventos (empezó y
  terminó), igual que ocurre con libros (`book_started` + `book_finished`);
  no se introdujo lógica nueva de supresión.
- **Reutilizar el icono genérico 📌**: descartado por consistencia con el
  resto de categorías, que tienen icono propio en `eventIcon`.

## Consecuencias

### Positivas

- El feed de actividad queda completo: además de películas/series/libros,
  muestra «Está jugando…» y «Terminó de jugar…» con los iconos 🎮 y 🏆.
- Cero cambios en Firestore y CSS; una sola lectura puntual más por amigo,
  en paralelo con las existentes.
- La visualización es coherente con el resto del producto: los chips,
  estados y la ficha del juego ya estaban alineados desde el ADR-068.

### Negativas / Riesgos

- La carga de la pestaña Actividad ahora hace 4 lecturas en paralelo por
  amigo en lugar de 3 (mismo coste por lectura puntual que las
  existentes).
- El fallback de `status === "completado"` sin `playLog` usa `updatedAt`,
  que puede no reflejar la fecha real de finalización en juegos antiguos;
  es el único dato disponible en ese caso.

### Neutras

- `docs/manual-de-usuario.md` actualizado (sección 14.3 Actividad): el
  listado de actividades incluye «Está jugando…» y «Terminó de jugar…»
  (regla 3 de AGENTS.md).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/activity-feed.js` | **Modificado**: `EVENT_TYPES` con `game_started`/`game_finished`; `buildFriendFeed` acepta 5.º parámetro `games = []` y genera eventos desde `playLog` (y fallback `completado` sin `playLog` con `updatedAt`); `buildGlobalFeed` desestructura y reenvía `games` |
| `js/profile.js` | **Modificado**: `loadActivityFeed` carga `ctx.getItemsOnce(profile.uid, "game")` en el mismo `Promise.all` y devuelve `{ profile, movies, series, books, games }` |
| `js/ui.js` | **Modificado**: `eventIcon` añade `game_started: "🎮"` y `game_finished: "🏆"` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 14.3 — nuevas actividades «Está jugando…» y «Terminó de jugar…» |
| `docs/adr-069-actividad-feed-videojuegos.md` | **Nuevo**: este documento |

## Verificación

- Revisión QA: PASS — eventos `game_started`/`game_finished` generados
  desde `playLog`, fallback de `completado` sin historial, reenvío en
  `buildGlobalFeed`, carga de la 4.ª categoría en `loadActivityFeed`,
  iconos 🎮/🏆 y manual sección 14.3 actualizado.
- Sin cambios en Firestore ni CSS: el feed sigue el patrón 100 % cliente
  del ADR-015; `openReadOnlyModal` ya soportaba `games` desde el ADR-068
  (issue #172).
- Escaneo de seguridad: PASS sin hallazgos (patrón solo-lectura
  preexistente, sin secretos ni PII).

Related issue: #173 — https://github.com/gonzalitojh/Registro-personal/issues/173