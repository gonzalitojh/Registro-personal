# ADR-072: Exportación ICS de videojuegos (issue #176)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La **exportación .ics** (`js/export-ics.js`, ADR-014) genera un archivo
iCalendar (RFC 5545) descargable desde la tarjeta de datos de los
Ajustes (`#btn-export-ics`, ADR-058) con los **próximos episodios de
series** en emisión y los **estrenos pendientes de películas**
(`nextEpisodeToAir` y `releaseDate` futura, UIDs `mi-registro-tv-*` y
`mi-registro-movie-*`).

Los **videojuegos** son una categoría propia desde la issue #47
(colección `games` en Firestore, `playLog` por juego, ADR-067 para el
estudio de APIs y ADR-068 para la consistencia de su información) y, tras
la issue #175 (ADR-071), cuentan con `releaseDate` al añadirlos desde
IGDB y un aviso diario de lanzamiento en la campana. Sin embargo, la
exportación .ics (y el texto de su tarjeta y del manual §15) solo
cubría series y películas: los lanzamientos pendientes de videojuegos no
llegaban al calendario personal del usuario.

La issue #176 pide ampliar la exportación .ics para incluir los
**lanzamientos pendientes de videojuegos**: juegos con `releaseDate`
futura y sin historial de juego.

Restricción de diseño relevante (heredada de ADR-071): `quick-actions.js`
y `modal-handlers.js` no limpian el flag `awaitingRelease` al marcar un
juego como jugado (solo escriben `playLog` + `status`), así que el flag
no es una fuente fiable para saber si un juego sigue pendiente de
lanzamiento; el `playLog` es la fuente de verdad (mismo predicado que la
pasada diaria de la issue #175).

Related issue: #176 — https://github.com/gonzalitojh/Registro-personal/issues/176

## Decisión

Añadir los videojuegos a la exportación .ics con un **criterio directo**
(fecha futura + `playLog` vacío), sin depender del flag `awaitingRelease`,
y activado **por defecto**.

### 1. Nuevo parámetro `includeGames` (default true)

- `collectUpcomingEvents(ctx, includeMovies, includeTv, includeGames)`:
  nuevo cuarto parámetro con el bloque de videojuegos **tras** el de
  películas.
- `downloadIcs(ctx, options)`: nueva opción `includeGames` con el mismo
  patrón que las existentes (`options.includeGames !== false` → default
  `true`).
- `setupExportIcs`: la llamada del botón pasa `includeGames: true`
  explícitamente junto a `includeMovies: true` y `includeTv: true`.

La feature queda incluida por defecto en la exportación completa, y la
API interna permite excluir los juegos (`includeGames: false`) sin
cambios de UI ni de toasts.

### 2. Bloque de videojuegos: criterio directo (no `awaitingRelease`)

Por cada juego de `ctx.getItemsByGroup("games")`:

| Guarda | Efecto |
|--------|--------|
| `!item.releaseDate` → `continue` | Juegos **manuales** (sin fecha de IGDB) y juegos sin fecha quedan fuera: no hay lanzamiento que exportar |
| `item.releaseDate < today` → `continue` | Solo lanzamientos **futuros** (hoy inclusive) |
| `item.playLog && item.playLog.length` → `continue` | Juegos **ya jugados** quedan fuera |

**Por qué no se usa `awaitingRelease`** (justificación): el flag se
escribe al añadir (issue #175), pero `quick-actions.js` y
`modal-handlers.js` **no lo limpian** al marcar un juego como jugado —
solo persisten `playLog` y `status`—; confiar en él exportaría juegos ya
terminados. Además, los juegos guardados antes de la issue #175 no tienen
el flag en absoluto. El **`playLog` es la fuente de verdad**: es el mismo
predicado (fecha + sin historial) que usa la pasada diaria de la issue
#175 (ADR-071), lo que mantiene la coherencia entre la campana y el
calendario.

Guarda defensiva adicional: `formatIcsDate` puede devolver `null` ante
una fecha ISO no parseable, por lo que se añade `if (!dtstart) continue`
antes de crear el evento.

### 3. Formato del evento de videojuego

Sigue el mismo patrón que el resto de eventos (ADR-014: `VALUE=DATE`,
`TRANSP:TRANSPARENT`, sin `DTEND`, UID estable):

- `UID`: `mi-registro-game-{id}@registro-personal`
  (`generateUid("game", item.id)`).
- `DTSTART;VALUE=DATE`: fecha de lanzamiento en `YYYYMMDD` (día completo,
  sin zona horaria).
- `SUMMARY`: `Lanzamiento: {título}`.
- `DESCRIPTION`: `overview` truncada a 250 caracteres si existe, o
  fallback `Lanzamiento del videojuego {título} el {fecha}.`.

La **ordenación global por fecha** (`events.sort(...)`, ya existente) se
aplica también a los eventos de juegos, y los toasts
(«Preparando calendario…», «No hay estrenos próximos que exportar.»,
«Calendario descargado (N eventos).») y el nombre de archivo
(`calendario-estrenos-{fecha}.ics`) no cambian.

### 4. Textos (regla 3 de AGENTS.md) y bump PWA

- `index.html` (~línea 439): el texto de la tarjeta .ics menciona ahora
  «…los estrenos de películas pendientes y los **lanzamientos de tus
  videojuegos**…».
- `docs/manual-de-usuario.md` §15: mismo cambio en la descripción de la
  exportación .ics.
- **Bump de versión de despliegue 20260903 → 20260904** en `index.html`
  (`?v=` de `css/styles.css`, `ocio/ocio.css` y `js/app.js`),
  `js/config.js` (`APP_VERSION`) y `service-worker.js` (`STATIC_ASSETS`),
  para invalidar las cachés del service worker (convención ADR-019;
  `scripts/bump-version.sh` verificado coherente).
- Cambio **solo textual**: sin colores, superficies ni layout nuevos
  (reglas 2 y 4 de AGENTS.md).

## Alternativas descartadas

- **Confiar solo en `awaitingRelease`** (predicado equivalente al de
  películas: `status === "pendiente" || awaitingRelease`): descartado —
  el flag no se limpia al marcar jugado en `quick-actions.js`/
  `modal-handlers.js`, así que los juegos ya terminados seguirían
  exportándose; y los juegos guardados antes de la issue #175 no tienen
  el flag y quedarían fuera aunque estén sin jugar. El criterio directo
  (fecha + `playLog`) es robusto a ambos casos (misma conclusión que la
  pasada diaria del ADR-071).
- **Limpiar `awaitingRelease` en `quick-actions.js` y `modal-handlers.js`
  para poder usarlo**: descartado — ampliaría la superficie de cambio a
  todos los flujos de «marcar jugado» y no resolvería los juegos
  pre-#175 (sin flag); la guarda del `playLog` en el punto de lectura
  logra el mismo resultado sin tocar esos flujos.
- **Condicionar la exportación a que la pasada diaria haya hecho el
  backfill del flag**: descartado — un juego recién añadido con fecha
  futura no aparecería en el calendario hasta la siguiente pasada (hasta
  un día de retraso); el criterio directo funciona al momento con los
  datos guardados.
- **Incluir las plataformas en la `DESCRIPTION`**: descartado — no aporta
  al propósito del evento (saber cuándo sale a la venta) y rompería la
  paridad con los eventos de series y películas (mismo patrón: `overview`
  truncada a 250 o fallback textual, ADR-014).

## Consecuencias

### Positivas

- Los **lanzamientos pendientes de videojuegos** llegan al calendario
  personal con un solo clic, completando la exportación .ics con la
  tercera categoría del registro (ADR-014).
- Criterio **robusto y consistente** con la campana: mismo predicado
  (fecha futura + sin `playLog`) que la pasada diaria de la issue #175
  (ADR-071); el `playLog` es la única fuente de verdad sobre si un juego
  sigue pendiente.
- **Sin regresiones**: los bloques de series y películas no se tocan, y
  `includeGames` por defecto `true` mantiene la feature activa sin cambios
  de UI; la opción `includeGames: false` permite excluir juegos desde la
  API interna.
- Los juegos **manuales** (sin `releaseDate`) y los **ya jugados** quedan
  fuera automáticamente por las guardas.

### Negativas / Riesgos

- Un juego marcado como jugado por vías que no escriban el `playLog`
  podría aparecer en la exportación (caso límite aceptado, el mismo que
  documenta ADR-071 para la campana).
- Los juegos sin fecha de lanzamiento (manuales o sin fecha en IGDB) no
  aparecen nunca en el calendario: no hay fecha que exportar (aceptado).
- Como ya ocurría con series y películas (ADR-014), no hay sincronización
  automática: al añadir juegos nuevos hay que volver a exportar el
  archivo.

### Neutras

- Cambio **solo textual** en la UI: texto de la tarjeta .ics
  (`index.html` ~439) y manual §15 (regla 3 de AGENTS.md); sin colores,
  superficies ni layout nuevos (reglas 2 y 4 de AGENTS.md).
- Bump de versión de despliegue **20260903 → 20260904** (convención
  ADR-019; `scripts/bump-version.sh` coherente): `index.html` (`?v=` ×3),
  `js/config.js` (`APP_VERSION`) y `service-worker.js` (`STATIC_ASSETS`).
- El evento de videojuego reutiliza el formato del resto de eventos
  (`VALUE=DATE`, `TRANSP:TRANSPARENT`, sin `DTEND`, UID estable); solo
  cambian el tipo del UID (`"game"`), el `SUMMARY` y el contenido de la
  `DESCRIPTION`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/export-ics.js` | **Modificado**: parámetro `includeGames` (default `true`) en `collectUpcomingEvents` y `downloadIcs`; bloque de videojuegos tras el de películas (guardas `releaseDate` truthy y ≥ hoy, `playLog` vacío, defensa `!dtstart`); UID tipo `"game"`, `SUMMARY` «Lanzamiento: …», `DESCRIPTION` con `overview` truncada a 250 o fallback; `setupExportIcs` pasa `includeGames: true` |
| `index.html` | **Modificado**: texto de la tarjeta .ics (~línea 439) con «…los lanzamientos de tus videojuegos…»; bump `?v=20260903` → `?v=20260904` (×3) |
| `docs/manual-de-usuario.md` | **Modificado**: §15 (Ajustes → exportación .ics) menciona los lanzamientos pendientes de videojuegos |
| `js/config.js` | **Modificado**: `APP_VERSION` `'20260903'` → `'20260904'` |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` con `?v=20260904` (styles, ocio.css, app.js y `ocio/*.html`) |
| `docs/adr-072-export-ics-videojuegos.md` | **Nuevo**: este documento |

## Verificación

- Revisión QA: PASS — juegos con `releaseDate` futura y sin `playLog`
  exportados con UID `mi-registro-game-*`, DTSTART y SUMMARY
  «Lanzamiento: …» correctos; juegos ya jugados, con fecha pasada o sin
  fecha excluidos; series y películas exportadas igual que antes (sin
  regresiones); toast «No hay estrenos próximos que exportar.» intacto;
  texto de la tarjeta y manual §15 actualizados.
- Harness funcional: **22/22 PASS** — sin regresiones en el resto de
  flujos de la aplicación.
- Escaneo de seguridad: PASS **sin hallazgos HIGH/MEDIUM** — solo
  lectura de datos propios del usuario y generación de texto en el
  cliente (sin red, sin secretos ni PII).
- Temas y responsividad: PASS — cambio puramente textual, sin colores ni
  layout nuevos (reglas 2 y 4 de AGENTS.md).

Related issue: #176 — https://github.com/gonzalitojh/Registro-personal/issues/176