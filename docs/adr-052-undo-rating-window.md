# ADR-052: Botón «Deshacer» en la ventana de valoración

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

Desde ADR-022 (issue #21), al marcar como visto/leído una película, un
libro o un episodio de serie se abre la **ventana de valoración
emergente** y el marcado se persiste **antes** de abrirse la ventana.
Si el usuario había marcado un ítem por error, la vía para revertirlo
pasaba por cerrar la ventana y buscar la opción correspondiente: quitar
el visionado en el historial de la ficha, desmarcar el episodio o
corregir la fecha de fin de la lectura. Eran pasos extra, poco
descubribles y con riesgo de dejar datos incorrectos registrados.

La issue #136 pide un botón **«Deshacer»** dentro de la propia ventana
de valoración: anular el marcado recién hecho **sin salir de ella**.
Requisitos de comportamiento:

- La ventana muestra «Deshacer» al marcar una película, al terminar un
  libro o al marcar un episodio de serie.
- El deshacer restaura el estado previo persistido (watchLog
  /readLog/watched), el `status` previo y el flag `awaitingRelease`
  previo cuando aplique, y deja la UI de debajo coherente sin recargar:
  el modal de ficha, o la fila/banner/contador del episodio en series.
- Los cierres externos (✕, backdrop, Escape, «Ahora no») siguen
  descartando **sin deshacer**.
- Si el deshacer falla (p. ej. sin red), la web avisa con un toast de
  error y la ventana permanece abierta.

Related issue: #136 — https://github.com/gonzalitojh/Registro-personal/issues/136

## Decisión

Implementar el botón «Deshacer» como **primer botón de la fila de
acciones** de la ventana de valoración (estilo `btn--outline`, mismo
idioma visual que «Ahora no») con un **enfoque snapshot**: cada llamador
captura el estado previo del ítem **ANTES** de persistir el marcado y
el `onUndo` lo restaura con `ctx.updateItem` + mutación en memoria.
No se reutilizan los helpers de persistencia del marcado para el undo:
`persist()` de película fuerza `awaitingRelease:false` y el status
recomputado, así que el undo es un `updateItem` directo que restaura
los campos capturados literalmente.

### 1. Contrato ampliado de `openRatingModal`

`js/rating-modal.js` acepta dos opciones nuevas:

```
openRatingModal({ ..., onUndo, undoLabel = "Deshacer" })
  => Promise<number|"undone"|null>
```

- `opts.onUndo` (opcional): `async () => {}` que anula el marcado
  recién hecho. Si está presente, se renderiza el botón `#rm-undo`
  como **primer elemento** de `.rating-modal__actions` (antes de
  «Ahora no» y «Guardar valoración»), con `btn btn--outline` y el
  texto `undoLabel` escapado con `escapeHtml`.
- La promesa ahora se resuelve con el **rating guardado (1-5)**, con
  la constante exportada **`RATING_MODAL_UNDONE` (`"undone")** si el
  usuario deshizo el marcado, o con `null` si se descartó. Sigue sin
  rechazar nunca: los fallos de `onSave` y de `onUndo` se notifican con
  toast robusto (`String(err && err.message ? err.message : err)`, sin
  "undefined") y la ventana queda abierta para reintentar.
- **Guarda `undoInProgress` en el cierre**: mientras el deshacer corre,
  `close()` ignora cualquier cierre externo (✕, backdrop, Escape,
  «Ahora no») para que la promesa no resuelva con `null` a mitad de la
  restauración. El doble clic es imposible: `disabled` en «Deshacer» y
  «Guardar valoración» durante la operación + la guarda `settled` + la
  guarda `undoInProgress`.

### 2. Snapshot previo en los 4 llamadores (modal de detalle)

Las ventanas se abren desde los mismos wrappers de ADR-022, que ahora
aceptan `opts` y devuelven `true` si el resultado fue
`RATING_MODAL_UNDONE`:

`modal-handlers.js`:

- **Película** (`onAddWatch`): captura `prevWatchLog`, `prevStatus` y
  `prevAwaitingRelease` antes de `persist(addWatch(...))`. El
  `onUndo` restaura con `updateItem({ watchLog, status,
  awaitingRelease })` + mutación en memoria. El status se restaura
  **literal** al capturado (no recomputado del log) por si el usuario
  lo tenía en un estado manual (recurso de la QA, hallazgos LOW).
- **Libro** (`onFinishReading`): captura `prevReadLog` y `prevStatus`
  antes del `persist(finishReading(...))`; el `onUndo` restaura
  `readLog` y `status` («Leyendo» vuelve a «Leyendo», una pausa/
  abandono previo se conserva).
- **Serie, episodio** (`onSetEpisodeDate`): captura la entrada previa
  (`prevEntry` via `normalizeEntry`), `wasWatched`,
  `prevAwaitingRelease` y `prevStatus`. Solo abre la ventana en la
  transición no-visto → visto (mismo criterio que ADR-022). El `onUndo`
  **desmarca** con `setEpisodeDate(item.watched, s, e, null)` vía
  `persistWatched` (elimina fecha y valoración puesta en la ventana),
  y restaura después `awaitingRelease` y `status` previos con
  `updateItem`. Si el resultado es undo, `onSetEpisodeDate` devuelve el
  **progreso recomputado del estado revertido**
  (`computeProgress(seasonsMeta, item.watched)`) para que `ui.js`
  pinte el banner con el estado real — sin cambiar la firma.

`quick-actions.js`:

- `maybeQuickItemRating` / `maybeQuickEpisodeRating` equivalentes; el
  resto de snapshots viven en los quick de cada tipo (abajo).

### 3. Undo en acciones rápidas y toasts condicionales

`js/quick-actions.js`:

- **`quickMarkMovie`**: captura `prevWatchLog`, `prevAwaitingRelease`,
  `prevStatus` antes de persistir; mismo `onUndo` de restauración.
- **`quickMarkBook`**: solo ofrece ventana al terminar (`isReading`);
  captura `prevReadLog` y `prevStatus`.
- **`quickMarkTv`**: captura `prevWatched`, `prevAwaitingRelease`,
  `prevStatus` y `prevNextEpisodeAirDate`. El `onUndo` restaura **el
  payload completo** del progreso previo: `watched`, `status` literal,
  `nextEpisode`/`firstWatchedAt`/`lastWatchedAt` recomputados del
  `prevWatched` con `computeProgress`, `awaitingRelease` y
  `nextEpisodeAirDate` previo (o `null` si no existía), de modo que el
  aviso de «no estrenado» del siguiente episodio también vuelve a su
  estado.
- **Toasts condicionales**: cada quick acción muestra el toast de
  marcado solo si **no** hubo undo:
  - Película/libro: `«Marcado deshecho.»` en lugar de ««Título» marcada
    como vista.» / ««Título» terminado.».
  - Episodio: «Desmarcado.» en lugar de «T2E5 marcado como visto.».

### 4. Repintado de la UI sin recargar (`js/ui.js`)

- **Episodio (modal de detalle de serie)**: tras `onSetEpisodeDate`, la
  fila se pinta **derivando de `item.watched`** (entrada normalizada),
  no del checkbox pulsado: estado del checkbox, clase `is-watched`,
  fecha habilitada/valor y estrellas del rating (ocultas si no visto,
  activas según `entry.rating`). Así una «Deshacer» desde la ventana se
  refleja en la casilla, el contador de la temporada
  (`updateSeasonCount`) y el banner (`updateBanner` con el progreso
  revertido devuelto).
- **Película/libro (modal de ficha)**: el `rerender()` ya existente
  (tras `onAddWatch` / `onFinishReading`) se ejecuta después de que la
  ventana se cierre — y como el `onUndo` muta `item` en memoria antes
  de resolver, el modal re-renderizado muestra el estado revertido.

### 5. Responsividad: `flex-wrap` en `.rating-modal__actions`

La fila pasa de 2 a **3 botones** (Deshacer · Ahora no · Guardar
valoración). En `ocio/ocio.css`, `.rating-modal__actions` añade
`flex-wrap: wrap` para que los 3 botones no desborden en móvil
(~360 px), cumpliendo la responsividad obligatoria de AGENTS.md
(sin scroll horizontal).

## Alternativas descartadas

- **Deshacer por índice del `watchLog` (`removeWatch` a ciegas)**:
  descartado — `addWatch` hace `.sort()` sobre el array antes de
  persistir, de modo que la posición de la entrada recién añadida no
  es determinista; el snapshot del log completo restaura exactamente el
  estado previo (incluidos log con fechas idénticas y revisionados
  intermedios).
- **Reutilizar `persist()` para el undo de película**: descartado —
  `persist()` de la película fuerza `awaitingRelease:false` tras
  `statusFromWatchLog`, con lo que un ítem «sin estrenar» deshecho no
  volvería a estar sin estrenar ni se conservarían estados manuales. El
  undo es un `updateItem` directo con los tres/ dos campos capturados.
- **Cambiar la firma de `onSetEpisodeDate` a `{ progress, undone }`**:
  descartado — alteraría el contrato para todos los consumidores del
  callback (casilla, fecha, «Marcar todo»); devolver el progress de la
  rama undo (`computeProgress(seasonsMeta, item.watched)`) mantiene la
  firma `Promise<progress>` y `ui.js` no cambia su manera de pintar.
- **Bloquear el cierre externo deshabilitando ✕/backdrop/elementos**:
  descartado — modificaría la apariencia y el foco del modal durante la
  operación; la guarda `undoInProgress` dentro de `close() resuelve el
  mismo problema (ignorar los cierres externos) sin tocar la UI.
- **Botón «Deshacer» al final de la fila de acciones**: descartado —
  como primer botón de `.rating-modal__actions` queda pegada a «Ahora
  no» (ambos `btn--outline`, familia de "cancelación") y alejado del
  botón primario «Guardar valoración», y se lee como la respuesta a la
  pregunta implícita de la ventana ("¿marcado? ¿lo deshizo?").

## Consecuencias

### Positivas
- El usuario revierte el marcado por error **sin salir del contexto**:
  un gesto dentro de la ventana que ya está abierta, sin buscar en
  historiales.
- La persistencia del revés es un `updateItem` directo que restaura el
  **estado literal previo** (logs, `status` y `awaitingRelease`/
  `nextEpisodeAirDate`), incluidos estados manuales (pausa/abandono).
- La UI queda coherente sin recargar: el modal de ficha re-renderiza de
  la manera existente y la fila del episodio se pinta derivando del
  estado real (casilla, fecha y estrellas incluidas).
- Los cierres externos (✕, backdrop, Escape, «Ahora no») mantienen su
  semántica de descarte; el flujo de guardado de la valoración no se
  ve afectado.
- Sin cambios de esquema ni de reglas de Firebase.

### Negativas
- **Una o dos `updateItem` extra por deshacer** (solo cuando el
  usuario pulsa «Deshacer», no en el flujo normal): en el undo de
  episodio del modal de detalle, el primer `updateItem` desmarca
  (con `awaitingRelease:false` y status recomputado) y el/los
  siguiente(s) restauran el flag/estado previo: **ventana transitoria
  en Firestore** con estado intermedio visible para amigos (sección
  Amigos). Hallazgo **LOW** del security scan, ya documentado en un
  comentario del código: cosmético, idempotente y auto-reparable, no
  bloquea.
- El contrato de la promesa de `openRatingModal` crece a
  `number | "undone" | null`: los consumidores existentes deben
  comparar contra `RATING_MODAL_UNDONE` (los 4 nuevos llamadores ya lo
  hacen; el resto continúa interpretando `null` y el número como
  antes). Documentado en el JSDoc del módulo.

### Neutras
- `ui.js` cambia únicamente el pintado de la fila del episodio
  (derivado de `item.watched` en lugar del checkbox pulsado); el resto
  de renders no se toca.
- `.rating-modal__actions` añade `flex-wrap: wrap`: afecta a la
  superposición de la ventana en pantallas estrechas, no a otros
  componentes.
- Manual de usuario actualizado (regla 3 de AGENTS.md — cambio visible
  para el usuario): botón «Deshacer» documentado en las secciones 4.3,
  5.3, 6.3, 10 y 11, y en Problemas frecuentes.
- Sin cambios de esquema ni de reglas de Firebase Security Rules.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/rating-modal.js` | **Modificado**: constante exportada `RATING_MODAL_UNDONE ("undone")`; `opts.onUndo`/`opts.undoLabel` en `openRatingModal` con botón `#rm-undo` (primer botón, `btn--outline`); promesa `number\|"undone"\|null`; guarda `undoInProgress` en `close()`; toasts robustos para guardar/deshacer; JSDoc del contrato actualizado |
| `js/modal-handlers.js` | **Modificado**: `maybeOpenItemRatingWindow`/`maybeOpenEpisodeRatingWindow` con `opts` (devuelven `result === RATING_MODAL_UNDONE`); snapshots previos en `onAddWatch` (película), `onFinishReading` (libro) y `onSetEpisodeDate` (serie: desmarca con `setEpisodeDate(null)`, restaura `awaitingRelease`/`status`; devuelve `computeProgress` del estado revertido si hubo undo) |
| `js/quick-actions.js` | **Modificado**: snapshots previos en `quickMarkMovie`, `quickMarkBook` y `quickMarkTv` (payload completo: `watched`, `status`, `nextEpisode`, fechas, `awaitingRelease`, `nextEpisodeAirDate` previo o `null`); toasts condicionales («Marcado deshecho.» / «Desmarcado.») según `RATING_MODAL_UNDONE` |
| `js/ui.js` | **Modificado**: fila del episodio pintada derivando de `item.watched` (check/estrellas/fecha) para reflejar el deshacer; contador de temporada y banner actualizados con el progreso (revertido si hubo undo) |
| `ocio/ocio.css` | **Modificado**: `.rating-modal__actions` añade `flex-wrap: wrap` (3 botones sin desborde en ~360 px) |
| `docs/manual-de-usuario.md` | **Modificado**: botón «Deshacer» documentado en 4.3 (episodios), 5.3 (películas), 6.3 (libros), 10 (ventana de valoración), 11 (acciones rápidas, toasts) y en 18 (probl. frecuentes) |
| `docs/adr-052-undo-rating-window.md` | **Nuevo**: este documento |
| `tasks/task-issue-136.json` | Task file de la tarea (plan, validación QA, security scan LOW, criterios de aceptación y bloque `issue` con la issue #136) |

Related issue: #136 — https://github.com/gonzalitojh/Registro-personal/issues/136