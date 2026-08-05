# ADR-033: Paso automático a standby de series en curso sin actividad en el último año (issue #48)

## Estado
Aceptado

## Fecha
2026-08-05

## Contexto

La web «Mi Registro» guarda en Firestore las series con un campo `status` que puede ser `pendiente`, `en_curso`, `completado`, `standby` o `abandonado`. Hasta ahora, **todos los cambios de estado eran manuales**: pausar (standby), abandonar o retomar una serie requería siempre la acción explícita del usuario. La comprobación diaria (`js/daily-check.js`, función `checkForUpdates`) se limitaba a refrescar los metadatos de TMDB una vez al día (datos faltantes, `nextEpisodeToAir`, `seasonAirDates`, backfill de `nextEpisodeAirDate`, avisos de estrenos) sin modificar jamás el estado de ningún ítem. Se verificó antes de implementar que no existía ningún cambio automático de estado en el código.

La issue #48 pide que las series que se empezaron a ver y se dejaron de lado pasen automáticamente a *Standby* cuando no haya actividad en el último año, con dos reglas explícitas:

1. Si la serie está **esperando nuevos episodios para estrenar**, NO se debe mover (aunque todavía no tenga fecha de estreno).
2. Si ya se han estrenado nuevos episodios, pero estos se estrenaron **hace menos de un año**, NO se debe mover.
3. Criterio de actividad: tomar la fecha **más actual** entre la fecha de estreno del último episodio y la fecha de última visualización para comprobar si hay actividad en el último año.

Related issue: #48 — https://github.com/gonzalitojh/Registro-personal/issues/48

## Decisión

Implementar el auto-standby por inactividad dentro de la comprobación diaria existente, mediante una **función pura** `shouldAutoStandby(show, today)` (exportada, `js/daily-check.js`) que decide si una serie debe pasar a standby, integrada en la misma pasada de `checkForUpdates` sin peticiones extra a la API.

### 1. Función pura `shouldAutoStandby(show, today)` (exportada)

Es la única fuente de verdad de la decisión; recibe la serie y la fecha de hoy (`YYYY-MM-DD`) y devuelve `true` si debe pasar a standby:

1. **Solo status `"en_curso"`**: si `show.status !== "en_curso"` ⇒ `false`. Los estados `pendiente`, `completado`, `standby` y `abandonado` no se tocan (standby ya está pausado; el caso de uso es la serie empezada y abandonada de facto).
2. **Regla 1 de la issue — próximo episodio sin estrenar**: si `isNextEpisodeUnreleased(show)` (fecha futura **o sin fecha**, criterio unificado de ADR-020/ADR-023/ADR-024) ⇒ `false`. La serie está «esperando nuevos episodios» y no debe moverse, aunque no tenga fecha de estreno todavía.
3. **Reglas 2 y 3 de la issue — criterio de actividad**: se calcula `lastAirDate` como `getNextEpisodeAirInfo(show).airDate` **solo cuando ese episodio ya se emitió** (si el próximo episodio estuviera sin estrenar, el paso 2 ya habría devuelto `false`), y `lastWatched` como `show.lastWatchedAt`. La fecha de actividad es la **más actual** de ambas: `activity = max(lastAirDate, lastWatchedAt)`. Si `activity <= subtractDays(today, 365)` (hace más de un año) ⇒ `true` (mover a standby); si está dentro del último año ⇒ `false`.
4. **Sin fechas conocidas — conservador**: si no existe ni `lastAirDate` ni `lastWatchedAt` ⇒ `false` (no se mueve).

Comparaciones de strings `YYYY-MM-DD` (formato canónico del proyecto), sin manipulación de `Date` en la propia función.

### 2. Helper `subtractDays(iso, days)` en `js/dates.js` (nuevo, exportado)

Resta días a una fecha `"YYYY-MM-DD"` y devuelve otra fecha en el mismo formato canónico. Usa **aritmética UTC** (`new Date(iso + "T00:00:00Z")`, `setUTCDate`/`toISOString`) para evitar desfases de zona horaria al cruzar medianoches locales; garantiza que el resultado sea directamente comparable como texto con las fechas almacenadas.

### 3. Integración en `checkForUpdates` (`js/daily-check.js`)

- **Series no manuales**: dentro del bucle principal existente de series con datos TMDB, tras el backfill de `nextEpisodeAirDate`, se construye un `evaluatedShow` con los datos **frescos de la misma pasada** (`nextEpisodeToAir`, `seasonAirDates` y el `nextEpisodeAirDate` recién calculado) y se evalúa `shouldAutoStandby(evaluatedShow, today)`. Si mueve, se persiste `{ status: "standby", autoStandbyAt: today }` en el **mismo `updateItem`** que ya escribía el resto de actualizaciones de la serie (una sola escritura, sin peticiones extra).
- **Series manuales en curso** (sin datos TMDB): un mini-bucle aparte, **sin red**, con los datos guardados en Firestore (la evaluación cae a `lastWatchedAt` si no hay fechas de emisión). Cada escritura va en su propio `try/catch` con **fail-open**: un error de escritura se loguea (`console.error`) y no aborta la pasada ni cuenta como fallo de API.
- **Alcance**: solo series con `status === "en_curso"`. No se tocan `pendiente`/`completado`/`standby`/`abandonado`. **Sin notificaciones**: el cambio es visible en la lista (el filtro «Viendo» lo oculta; el usuario lo ve al filtrar por Standby).
- **Trazabilidad**: el nuevo campo `autoStandbyAt` guarda la fecha (`YYYY-MM-DD`) en la que el sistema movió la serie a standby, distinguiendo pausas automáticas de manuales.

### 4. Decisión notoria: serie sin NINGUNA información de emisión

Una serie sin `nextEpisodeToAir`, sin `seasonAirDates` y sin `nextEpisodeAirDate` (es decir, sin ninguna fecha de emisión conocida) **SÍ se mueve** si `lastWatchedAt` es antiguo: el criterio de la issue cae a la fecha de última visualización, que es la única actividad disponible. Para series **no manuales** este caso es casi imposible en la práctica, porque la pasada diaria rellena `seasonAirDates` con `null` y el backfill aporta `nextEpisodeAirDate`; para series **manuales** es el camino normal (no hay datos de TMDB que respalden «estrenos recientes»). Solo cuando no existe *ninguna* de las dos fechas (`lastAirDate` y `lastWatchedAt`) se aplica el criterio conservador de no mover.

## Alternativas descartadas

- **Evaluar solo con los datos guardados (también para series no manuales)**: descartado — el dato fresco de TMDB de la pasada diaria es la fuente de verdad para detectar «estrenos recientes»; evaluar con datos viejos movería por error series que ya retomaron emisión. Por eso las series no manuales se evalúan con `nextEpisodeToAir`/`seasonAirDates`/`nextEpisodeAirDate` frescos de la misma pasada, y solo las manuales (que no tienen datos TMDB) usan lo guardado.
- **Ampliar el filtro del bucle principal para incluir series manuales**: descartado — meter las manuales en el bucle de series con API ensuciaría el flujo de red (llamaría a TMDB por series que no tienen `externalId`); el mini-bucle separado, sin red, mantiene cada flujo limpio.
- **Año calendario en vez de 365 días**: descartado — «últimos 365 días» es más simple de calcular y de explicar, y el impacto de 1 día (p. ej. un estreno del 1 de enero del año anterior) es irrelevante para la decisión de pausar una serie.
- **Notificar al usuario del cambio de estado**: descartado — la issue #48 no lo pide y el cambio es visible en la lista (la serie sale del filtro «Viendo» y aparece en el filtro «Standby»); además el campo `autoStandbyAt` da trazabilidad para consultas posteriores.

## Consecuencias

### Positivas
- **Issue #48 resuelta**: las series en curso sin actividad en el último año (último estreno emitido o última visualización, la más actual) pasan automáticamente a standby en la comprobación diaria.
- **Sin regresiones en series activas**: las series con próximo episodio sin estrenar (esperando nuevos episodios) y las que estrenaron en el último año no se mueven, según las reglas de la issue.
- **Cero coste de red**: la decisión se calcula con los datos ya obtenidos por la pasada diaria (series no manuales) o con los datos guardados (series manuales, sin red); la escritura se añade al `updateItem` existente.
- **Lógica testable**: `shouldAutoStandby` es una función pura y exportada; 14 casos de borde verificados en validación (fechas recientes no mueven, antiguas mueven, próximos episodios sin estrenar no mueven, umbral exacto de 1 año mueve, manuales funcionan, sin fechas no mueve, etc.). QA aprobado y escaneo de seguridad sin hallazgos (CLEAN).
- **Robustez ante fallos**: los errores de escritura en el mini-bucle de manuales no abortan la pasada (fail-open), preservando el resto de la comprobación diaria.

### Negativas
- **Cambio de estado sin acción del usuario**: una serie puede pasar a standby «sola»; es el comportamiento pedido por la issue, y se mitiga porque no hay borrado de datos ni pérdida de progreso (el historial `watched` se conserva y la serie puede retomarse desde Standby).
- **Dependencia de la exactitud de los datos**: si `lastWatchedAt` o el `airDate` del último episodio estuvieran corruptos o ausentes, la decisión se toma con la fecha disponible; el criterio conservador (sin ninguna fecha ⇒ no mover) limita el riesgo.

### Neutras
- **Nuevo campo `autoStandbyAt`** en las series movidas automáticamente; distingue pausas automáticas de las manuales y da trazabilidad.
- **`subtractDays` pasa a ser utilidad general** de `js/dates.js` (exportada), reutilizable por otras lógicas de umbrales de fechas.
- **Sin cambios en UI**: el estado standby ya existía con su tratamiento visual y de filtros; no hay notificaciones ni textos nuevos (el manual de usuario ya fue actualizado por la implementación).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/daily-check.js` | Nueva función pura exportada `shouldAutoStandby(show, today)` (solo `en_curso`, próximo episodio sin estrenar ⇒ no mueve, `max(airDate del último episodio emitido, lastWatchedAt)` frente al umbral `subtractDays(today, 365)`, sin fechas ⇒ no mueve) y constante `AUTO_STANDBY_DAYS = 365`; integración en `checkForUpdates`: evaluación con datos frescos de la pasada para series no manuales (persistida en el mismo `updateItem` como `{ status: "standby", autoStandbyAt: today }`) y mini-bucle sin red para series manuales con fail-open |
| `js/dates.js` | Nueva función exportada `subtractDays(iso, days)` con aritmética UTC y resultado en formato canónico `YYYY-MM-DD` |
| `docs/adr-033-auto-standby.md` | **Nuevo**: este documento |

Related issue: #48 — https://github.com/gonzalitojh/Registro-personal/issues/48
