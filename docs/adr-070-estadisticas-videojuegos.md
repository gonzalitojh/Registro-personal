# ADR-070: Estadísticas de videojuegos en el perfil (issue #174)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La sección **Estadísticas** del perfil (`js/profile.js`) resume el consumo
del usuario y se genera 100 % en cliente a partir del estado actual de sus
colecciones: cubría **películas** (vistas), **series** (episodios y
completadas) y **libros** (leídos). Los **videojuegos** son una categoría
propia del producto desde la issue #47 (colección `games` en Firestore con
un `playLog` por juego —sesiones con `startedAt`/`finishedAt`—,
`genres[]`, `platforms[]` y estados `pendiente`/`en_curso`/`completado`/
`standby`/`abandonado`), pero no tenían estadísticas propias: no aparecían
ni en los tiles de resumen, ni en «Actividad por mes», ni en «Estados
actuales».

El ADR-067 (estudio de APIs de videojuegos, issue #162) dejó
explícitamente «Stats del perfil (horas jugadas, géneros, plataformas…)»
como trabajo futuro. Además, IGDB no expone la duración media de un juego
(`playtime` viene `null`, ver ADR-067), por lo que las horas jugadas solo
pueden venir de un **campo opcional por sesión** introducido por el propio
usuario.

La issue #174 pide añadir estadísticas de videojuegos al perfil.

Related issue: #174 — https://github.com/gonzalitojh/Registro-personal/issues/174

## Decisión

Ampliar `computeStats` (profile.js) con un bloque de videojuegos que
replica el patrón de las demás categorías (todo en cliente, respetando el
filtro de periodo), añadir dos gráficas nuevas de barras horizontales y
exponer el resultado en 8 tiles de resumen:

### 1. Campo `hours` por sesión

Cada entrada del `playLog` admite ahora un campo opcional `hours`:

| Aspecto | Detalle |
|---------|---------|
| Tipo | `number`, mínimo 0, paso 0.5, redondeo a 1 decimal |
| Edición | Input en el modal de juego (`js/ui.js` `renderPlayLogRows` + listener `change` en `openGameModal`) |
| Vacío | Se persiste `null` (nunca `undefined`: `updateDoc` de Firestore lanza si un campo es `undefined`) |
| Sesiones antiguas | Sin `hours` → se tratan como 0 en los cálculos |
| Persistencia | Vía el `onUpdateEntry` existente → `updatePlayEntry` (merge `{...entry, ...changes}`), sin tocar `game-log.js` ni `modal-handlers.js` |

### 2. Cálculo de estadísticas (`computeStats`)

- **Fecha efectiva de una sesión** = `finishedAt ?? startedAt`: una sola
  fecha por sesión, lo que evita doble conteo en «Actividad por mes».
- **Juegos jugados** (`gamesPlayed`): juegos con ≥1 sesión cuya fecha
  efectiva cae en el periodo; fallback: `status === "completado"` y
  `updatedAt` normalizado en el periodo (`toDateStr`, patrón
  `maybePushDateEvent` de activity-feed.js).
- **Juegos completados** (`gamesCompleted`): `status === "completado"` y
  la **última** sesión terminada (mayor `finishedAt`) en el periodo;
  fallback `updatedAt` si no hay sesiones terminadas.
- **Sesiones de juego** (`gameSessions`): número de entradas del `playLog`
  con fecha efectiva en el periodo.
- **Horas jugadas** (`gameHours`): suma de `entry.hours` de las sesiones
  del periodo.
- Todo respeta el filtro de periodo (siempre / año / mes / rango custom)
  mediante `withinPeriod`.

### 3. Gráficas

| Gráfica | Integración |
|---------|-------------|
| «Actividad por mes» | Las sesiones de juego se integran en la gráfica `monthly` existente |
| «Estados actuales» | Los juegos entran en `statusCounts` (los 5 estados ya están en `STATUS_LABELS_NEUTRAL`) |
| «Géneros» (nueva) | Barras horizontales (`indexAxis: "y"`, Chart.js), top 6, juegos jugados en el periodo |
| «Plataformas» (nueva) | Barras horizontales (`indexAxis: "y"`, Chart.js), top 6, juegos jugados en el periodo |

En Géneros y Plataformas cada juego cuenta una sola vez por género /
plataforma (dedupe con `Set`, `trim` y descartando vacíos). La paleta usa
variables de tema (`--teal-reel`, `--ochre-spine`, `--stamp`,
`--ink-soft`, `--ochre-spine-dark`) leídas con `getComputedStyle`, sin hex
hardcodeados (regla 4 de AGENTS.md).

### 4. UI

- **8 tiles** en la cuadrícula de resumen: los 4 existentes (películas,
  series, libros) + juegos jugados, completados, sesiones y horas.
- Las horas se formatean con coma decimal y sufijo "h" (`formatHours`).
- `index.html` añade los canvas `#chart-genres` y `#chart-platforms`
  dentro de `.stats-charts` (grid `auto-fit`, sin cambios de CSS en
  `styles.css`).

### 5. Manual de usuario

Se actualizan las secciones 7.4 (campo horas por sesión) y 14.1 (ocho
cifras, cinco gráficas, semántica de jugado/sesiones/horas) (regla 3 de
AGENTS.md).

## Alternativas descartadas

- **Usar la duración media de IGDB para las horas**: descartada — IGDB no
  expone `playtime` (null, ADR-067); las horas solo pueden ser un dato del
  usuario por sesión.
- **Horas a nivel de juego en lugar de por sesión**: descartado — el
  `playLog` admite varias sesiones por juego y las estadísticas mensuales
  necesitan atribuir horas a la sesión concreta.
- **Persistir las horas en una subcolección nueva**: innecesario — el campo
  opcional por entrada es retrocompatible y no requiere migración.

## Consecuencias

### Positivas

- Estadísticas completas para los 4 tipos de medio en el perfil.
- Las horas jugadas son medibles aunque IGDB no las exponga.
- Sin cambios estructurales ni migraciones: solo un campo opcional
  retrocompatible por sesión.

### Negativas / Riesgos

- `updatedAt` se actualiza con cualquier escritura del juego (incluido el
  fetch de tráiler al abrir la ficha, `js/modal-handlers.js`): el fallback
  de completado con `updatedAt` puede contar juegos completados antes del
  periodo si su ficha se tocó recientemente (aceptado; comportamiento
  literal del criterio).
- El color `--stamp` sobre superficies oscuras está cerca del límite de
  contraste gráfico (3:1) — patrón pre-existente del doughnut de estados.

### Neutras

- El campo `hours` es opcional y retrocompatible con las sesiones
  existentes.
- Duplicación mínima de `toDateStr` con activity-feed.js (un refactor
  compartido queda fuera de alcance).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/profile.js` | **Modificado**: bloque de videojuegos en `computeStats` (`gamesPlayed`, `gamesCompleted`, `gameSessions`, `gameHours`), integración en `monthly`/`statusCounts`, gráficas Géneros y Plataformas, `formatHours` |
| `js/ui.js` | **Modificado**: `renderPlayLogRows` con input `hours` por sesión y listener `change` en `openGameModal` |
| `index.html` | **Modificado**: canvas `#chart-genres` y `#chart-platforms` en `.stats-charts` |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 7.4 (campo horas) y 14.1 (ocho cifras, cinco gráficas) |
| `docs/adr-070-estadisticas-videojuegos.md` | **Nuevo**: este documento |

## Verificación

- Revisión QA: PASS — cálculo de las 4 métricas con fechas efectivas por
  sesión, fallbacks de `completado`/`updatedAt`, filtro de periodo en todos
  los casos, dedupe por Set en Géneros/Plataformas, 8 tiles, 5 gráficas y
  manual (7.4 y 14.1) actualizado.
- Persistencia: PASS — `hours` guardado como `null` cuando está vacío
  (nunca `undefined`), vía `updatePlayEntry` con merge, sin tocar
  `game-log.js` ni `modal-handlers.js`.
- Temas: PASS — paleta de las gráficas nuevas con variables de tema vía
  `getComputedStyle`; `--stamp` cerca del límite de contraste es patrón
  pre-existente.
- Responsividad: PASS — `.stats-charts` con grid `auto-fit` ya existente;
  sin cambios de CSS en `styles.css`.
- Escaneo de seguridad: PASS sin hallazgos (patrón cliente preexistente,
  sin secretos ni PII).

Related issue: #174 — https://github.com/gonzalitojh/Registro-personal/issues/174
