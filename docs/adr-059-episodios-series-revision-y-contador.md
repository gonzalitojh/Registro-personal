# ADR-059: Episodios de series: layout a 2 líneas, re-visionado y contador de visualizaciones (issue #133)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La issue #133 («Arreglo de los episodios de las series») reporta dos
problemas en la ficha de una serie, en la lista desplegable de episodios
de cada temporada:

1. **El título del episodio se muestra «vertical»** en anchos pequeños:
   con `flex-wrap: wrap` activo en `.episode-row__main` (que además
   contenía el input de fecha), el título —con `min-width: 0` y
   `overflow-wrap: anywhere`— quedaba aplastado y su texto se apilaba
   línea a línea dentro de la fila, descentrándose del resto de la
   línea.
2. **No hay forma de registrar un re-visionado**: pulsar la casilla de
   un episodio ya visto solo permitía desmarcarlo; no existía un
   contador de visualizaciones por episodio ni una acción «lo he visto
   de nuevo».

Estado anterior:

- El layout de cada fila era **una sola línea** (`episode-row__main` con
  `flex-wrap: wrap`) con: checkbox, nº, título, badge de comunidad y el
  input de fecha; la valoración con estrellas iba en una segunda línea
  aparte (`.episode-rating` con `padding-left: 30px`).
- El modelo de datos por episodio era `{ date, rating }` (y las
  entradas más antiguas solo `"YYYY-MM-DD"` como string); `normalizeEntry`
  normalizaba string → `{ date, rating: null }`.
- Pulsar la casilla de un episodio **ya visto** lo desmarcaba
  directamente, sin preguntar.

La implementación está validada (QA PASS) y escaneada (seguridad PASS);
el manual de usuario se actualizó en la misma tarea (regla 3 de
AGENTS.md). Este ADR documenta la decisión a posteriori.

Related issue: #133 — https://github.com/gonzalitojh/Registro-personal/issues/133

## Decisión

### 1. UI: layout del episodio a 2 líneas en todos los anchos

Cada fila de episodio pasa a tener **dos líneas** fijas en cualquier
ancho de pantalla:

- **Línea 1** (`episode-row__main`): checkbox + nº (`E1`) + título
  multilínea centrado vertical + badge de comunidad (TMDB).
- **Línea 2** (`episode-row__meta`, nueva): estrellas de valoración +
  input de fecha, con `padding-left: 30px` para alinearse con el
  checkbox (el sangrado que antes llevaba `.episode-rating`, que pierde
  su `padding-left`).

**Causa raíz corregida en CSS, sin parches**: se elimina
`flex-wrap: wrap` de `.episode-row__main` —el título ya no puede saltar
a líneas propias apiladas— y el título multilínea se ajusta con
`flex: 1; min-width: 0; overflow-wrap: anywhere` en
`.episode-row__name` y `align-items: center` en el contenedor (centrado
vertical). **No se usa `overflow-x: hidden` en `body`/`html`** ni ningún
parche que enmascare el desbordamiento (regla 2 de AGENTS.md): se
corrige la causa raíz. `overflow-wrap: anywhere` en `.episode-row__meta`
(`flex-wrap: wrap` aquí sí permitido, segunda línea) evita que la fecha
se salga en anchos mínimos.

### 2. Modelo de datos: campo `times` (nº de visualizaciones)

La entrada de episodio pasa de `{ date, rating }` a
`{ date, rating, times }`, donde `times` es el nº de veces que se ha
visto el episodio:

```js
// temporada -> episodio -> { fecha de la última vez visto, valoración 1-5 o null, veces visto }
{ "1": { "1": { date: "2026-01-05", rating: 4, times: 2 } } }
```

- **`normalizeEntry()`** (en lectura, no en escritura) normaliza los
  datos legacy sin mutar el original: un string (`"2026-01-05"`) →
  `{ date, rating: null, times: 1 }`, y un objeto con `date` pero sin
  `times` → `{ ...entry, times: 1 }`. Los objetos que ya tienen `times`
  se devuelven tal cual.
- **Sin migración de datos ni bump de versión de backup**: los datos en
  Firebase conservan el formato que tengan; `export-backup` serializa
  `watched` tal cual (las entradas sin `times` se exportan sin él) y
  **la importación de backups antiguos queda cubierta por
  `normalizeEntry`** en el punto de lectura. Cero riesgo de pérdida o
  reescritura de datos.

### 3. Lógica de progreso (`js/tv-progress.js`)

- **`markEpisodeSeenAgain(watched, season, ep, date)`** (nueva): marca
  un episodio YA visto como visto de nuevo — pone la fecha en hoy (la
  pasa el llamador), **conserva la valoración** (`existing.rating`) y
  **suma 1 a `times`** (`(existing.times || 1) + 1`).
- **`setEpisodeDate`** conserva `times` al cambiar la fecha
  (`existing.times || 1`); **`setEpisodeRating`** conserva `times` al
  re-valorar; **`setSeasonWatched`** (marcar toda la temporada)
  conserva `rating` y `times` de los episodios que ya estaban vistos
  (y pone `times: 1` a los nuevos).
- **`computeProgress` NO cambia**: cuenta episodios con fecha, no
  visualizaciones. Consecuencia deliberada: un re-visionado **no
  dispara el estado «completado»** de la serie (ni lo desactiva) y
  **los contadores por temporada no se inflan** (siguen contando
  episodios distintos vistos, no veces).
- **`startRewatch()`** sigue reseteando `watched = {}` (y archivando el
  ciclo en `history`): **decisión de diseño — los contadores `times`
  son por ciclo de visionado**, se reinician al empezar un rewatch. El
  historial de ciclos anteriores sigue en `item.history`/`timesCompleted`.

### 4. Nuevo diálogo de acciones de episodio ya visto

En `index.html` se añade el armazón `#episode-actions-modal`
(`modal modal--top hidden`, con `#episode-actions-modal-backdrop`,
`#episode-actions-modal-close` y `#episode-actions-modal-content`), y el
módulo `js/episode-actions-modal.js` (patrón `rating-modal.js`):

- `openEpisodeActionsModal({ title, subtitle, times })` devuelve una
  **promesa que se resuelve con `"seen_again"`, `"unmarked"` o `null`**
  (descartado); nunca rechaza. Es PURO: no persiste nada, el repintado
  lo decide el llamador.
- Usa `trapFocus` en `.modal__card` (mismo `focus-utils` que el modal de
  valoración) y guarda `_previousActiveElement` para **restaurar el foco
  a la casilla del episodio** al cerrar.
- Los listeners de ✕ y backdrop se registran UNA vez al cargar el
  módulo (armazón estático) y delegan en `closeEpisodeActionsModal()`
  (idempotente: resuelve con `null` y no hace nada sin modal abierto).
- **Prioridad de la tecla Escape** (handler global en
  `modal-handlers.js`): `episode-actions > rating > item > notifs`. El
  nuevo modal es el primero que se comprueba, antes que la ventana de
  valoración.

### 5. Comportamiento de la casilla (`js/ui.js`)

- **Nuevo estado visual centralizado en `applyEpisodeRowState(row,
  entry)`**: sincroniza checkbox, clase `is-watched`, fecha, fila 2
  (`hidden` si no visto), contador y estrellas a partir de la entrada
  real normalizada de `item.watched` (patrón issue #136: el repintado
  SIEMPRE deriva de `item.watched`). Se usa en los tres puntos: cambio
  de casilla, «Desmarcar todo» (que ahora repinta cada fila a su estado
  real en lugar de vaciarla a mano) y el handler de la casilla.
- **Rama `wasWatched` en el handler `change` del checkbox**: si el
  episodio ya estaba visto, se restaura el check al instante (sin
  parpadeo, checkbox `disabled` mientras dura el diálogo), se abre
  `#episode-actions-modal` y según la elección: `"seen_again"` →
  `onSetEpisodeSeenAgain` (que llama a `markEpisodeSeenAgain` con la
  fecha de hoy), `"unmarked"` → `onSetEpisodeDate(..., null)`,
  `null` → nada (la fila vuelve a su estado real). El foco se restaura a
  la casilla en `finally` (se guarda `document.activeElement` antes de
  abrir el diálogo, porque el navegador mueve el foco a `body` al
  deshabilitar el checkbox). Si el episodio NO estaba visto, se mantiene
  el flujo actual (confirmación de «sin estrenar» y ventana de
  valoración posterior del lado de `modal-handlers`).
- **`aria-label` dinámico**: con `times > 1` la casilla pasa a decir
  «E3 — Título: visto N veces. Pulsa para verlo de nuevo o desmarcarlo».

### 6. Checkbox visual con contador

Con `times > 1` el círculo del checkbox muestra el **nº de veces en
lugar del tick ✓**: `renderEpisodeRows` añade `data-count="${times}"` a
`.episode-checkbox-visual` (y `applyEpisodeRowState` lo añade/elimina al
repintar), y la regla CSS
`.episode-checkbox:checked ~ .episode-checkbox-visual[data-count]::after`
sustituye el tick por `content: attr(data-count)` (tipografía mono,
centrado, sin borde). Con `times === 1` se mantiene el tick clásico.

### 7. PWA y documentación

- **Bump PWA** `20260831` → `20260901` (un bump por PR que toca
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260901` ×3) y `service-worker.js` (`?v=20260901` ×6), y el
  módulo **`js/episode-actions-modal.js` se añade a `STATIC_ASSETS`**
  (es un módulo nuevo que el SW debe cachear).
- **Manual de usuario** (`docs/manual-de-usuario.md`): nuevo bullet
  «Volver a ver un episodio» en §4.3 «Ver y marcar episodios» explicando
  el diálogo, la actualización de fecha, el +1 del contador y que la
  casilla muestra el nº de veces en lugar de la marca ✓ (regla 3 de
  AGENTS.md).

## Alternativas descartadas

- **Usar `window.confirm` encadenado** para preguntar «¿Lo has visto de
  nuevo o lo desmarcas?»: descartado — los `confirm` nativos son
  modales del navegador sin estilo, rompen el patrón visual de la app y
  no permiten `trapFocus` ni restaurar el foco a la casilla; el diálogo
  propio reutiliza el armazón y los estilos de modal existentes.
- **Marcar la serie completa automáticamente con re-visionados**
  (p. ej. re-visionar el último episodio vuelve a «completado»):
  descartado — `computeProgress` cuenta episodios distintos, no
  visualizaciones; inflaría el progreso, dispararía estados
  «completado» espurios y contaminaría los contadores por temporada.
  El re-visionado solo actualiza `date` y `times` del episodio.
- **Contar los re-visionados en el progreso** (sumar `times` en
  `computeProgress`): descartado — el % de una serie es de episodios
  distintos vistos; sumar veces rompería el progreso, «Siguiente:
  T2E5» y el estado de la lista. El contador es informativo del
  episodio, no métrica de progreso.
- **Migración de datos / bump de versión de backup** para añadir
  `times` a todas las entradas existentes: descartado — innecesario:
  `normalizeEntry` cubre la lectura de datos legacy (string u objeto
  sin `times` → `times: 1`) y `export-backup`/`import-backup` no
  necesitan tocar el formato; migrar añadía riesgo de pérdida de datos
  sin ningún beneficio funcional.

## Consecuencias

### Positivas

- **Layout estable a 2 líneas**: título multilínea centrado vertical,
  fecha y estrellas en su propia línea, en cualquier ancho; se corrige
  la causa raíz sin parches de desbordamiento (regla 2 de AGENTS.md).
- **Re-visionados registrables**: el usuario puede indicar que ha
  vuelto a ver un episodio sin perder la valoración ni tener que
  desmarcarlo; el contador `times` queda visible en la casilla.
- **Datos legacy protegidos**: `normalizeEntry` sin mutación +
  exportación tal cual = importación de backups antiguos compatible sin
  migración ni reescritura de datos.
- **Progreso intacto**: `computeProgress` sin cambios — ni «completado»
  espurio por re-visionados ni contadores por temporada inflados.
- **Accesibilidad**: diálogo con `trapFocus`, Escape con prioridad,
  `aria-label` informativo («visto N veces…») y foco restaurado a la
  casilla.
- **Manual al día**: regla 3 de AGENTS.md cumplida en la misma tarea
  (bullet «Volver a ver un episodio» en §4.3).
- **QA y seguridad PASS** antes de documentar: la decisión está
  validada en la práctica.

### Negativas / Riesgos

- **Cambio visible para el usuario**: la fila de episodio ocupa ahora
  dos líneas (más espacio vertical en temporadas largas) y el checkbox
  muestra un número en vez del tick para re-visionados; puede requerir
  un momento de adaptación. Mitigado con la actualización del manual.
- **Dos puntos de verdad para el estado visual de la fila**: el
  render inicial (template en `renderEpisodeRows`) y el repintado
  (`applyEpisodeRowState`) deben mantenerse en sincronía; un cambio en
  uno sin el otro produciría estados visuales inconsistentes.
- **Complejidad del handler de casilla**: la rama `wasWatched`
  (restaurar check, abrir diálogo, repintar y restaurar foco) es el
  camino más delicado del wiring; cualquier futura edición debe
  conservar el patrón «repintado siempre derivado de `item.watched`».
- **`times` no visible para series manuales antiguas**: los episodios
  sin `times` en datos se leen como `times: 1` (normalización en
  lectura); el contador solo es significativo para episodios vistos
  más de una vez tras esta versión.

### Neutras

- **Contadores por ciclo de visionado**: `startRewatch()` resetea
  `watched = {}` y con ello los `times`; el historial de ciclos se
  conserva en `item.history`/`timesCompleted` (comportamiento previo,
  sin cambios en esta tarea).
- **Bump PWA de rutina**: `20260831` → `20260901` siguiendo la práctica
  de un bump por PR (ADR-049); los navegadores purgan las cachés
  anteriores en el siguiente `activate`. `js/episode-actions-modal.js`
  entra en `STATIC_ASSETS` para quedar precacheado.
- **Sin cambios en `export-backup.js` / `import-backup.js`**: el
  formato de `watched` sigue siendo el mismo con el campo añadido; la
  compatibilidad la da `normalizeEntry` en lectura.
- **ADR históricos intactos**: los ADRs que describen el layout o el
  modelo previos (p. ej. ADR-022, modal de valoración) son registro
  histórico y **no se modifican**.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: añadido el armazón del diálogo `#episode-actions-modal` (`modal--top`, backdrop, botón ✕ y contenedor de contenido); bump `?v=20260831` → `?v=20260901` (×3) |
| `js/episode-actions-modal.js` | **Nuevo**: `openEpisodeActionsModal()` (patrón rating-modal) — promesa que resuelve `"seen_again"`\|`"unmarked"`\|`null`, `trapFocus`, foco restaurado a `_previousActiveElement`, `closeEpisodeActionsModal()` idempotente usada por ✕, backdrop y Escape |
| `js/tv-progress.js` | **Modificado**: `normalizeEntry` añade `times: 1` a strings y objetos legacy sin mutar (y devuelve tal cual los que ya tienen `times`); nueva `markEpisodeSeenAgain` (+1 a `times`, fecha hoy, conserva `rating`); `setEpisodeDate`, `setEpisodeRating` y `setSeasonWatched` conservan `times`; comentario de cabecera del módulo actualizado. `computeProgress` y `startRewatch` sin cambios |
| `js/ui.js` | **Modificado**: `renderEpisodeRows` — layout a 2 líneas (estrellas + fecha en `.episode-row__meta`), `data-count` y `aria-label` dinámico («visto N veces…») en la casilla, `data-episode-name` en la fila; nueva `applyEpisodeRowState(row, entry)` (repintado único derivado de `item.watched`, patrón issue #136) usada también en «Desmarcar todo»; rama `wasWatched` en el handler `change` del checkbox (diálogo de acciones, foco restaurado en `finally`) |
| `js/modal-handlers.js` | **Modificado**: import y callback `onSetEpisodeSeenAgain` (llama a `markEpisodeSeenAgain` con `todayISO()`); prioridad de Escape actualizada: `episode-actions > rating > item > notifs` |
| `ocio/ocio.css` | **Modificado**: eliminado `flex-wrap: wrap` de `.episode-row__main` (causa raíz del título vertical); nueva `.episode-row__meta` (flex, `gap`, `flex-wrap: wrap` permitido, `padding-left: 30px`, `.episode-date { flex-shrink: 0 }`); `.episode-rating` pierde el `padding-left`; regla `.episode-checkbox:checked ~ .episode-checkbox-visual[data-count]::after` con `content: attr(data-count)` (contador en lugar del tick); `.eam-body` para el cuerpo del diálogo (`overflow-wrap: anywhere`) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260831` → `20260901` |
| `service-worker.js` | **Modificado**: bump `?v=20260831` → `?v=20260901` en los 6 assets versionados de `STATIC_ASSETS`; añadido `./js/episode-actions-modal.js` a `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modificado**: nuevo bullet «Volver a ver un episodio» en §4.3 «Ver y marcar episodios» (diálogo, fecha a hoy, +1 al contador, casilla con nº de veces en lugar de ✓) — regla 3 de AGENTS.md |
| `tasks/task-issue-133.json` | Task file de la tarea (title/description, plan de cambios, criterios de aceptación y bloque `issue` con la issue #133) |
| `docs/adr-059-episodios-series-revision-y-contador.md` | **Nuevo**: este documento |

Related issue: #133 — https://github.com/gonzalitojh/Registro-personal/issues/133
