# ADR-107: Ocultación de visualizaciones, valoración y notas en las fichas de películas y series (issue #300)

## Estado

Aceptado

## Fecha

2026-08-18

## Contexto

La issue #300 pide **ocultar/eliminar las secciones finales** de las
fichas de **películas y series**: al final de la ficha aparecen
visionados, valoración y notas, cuando la valoración ya se hace con el
**botón flotante** (issue #298, ADR-106). Concretamente:

- Eliminar la **sección de valoración** de esa zona (valorar se hace con
  el botón flotante).
- Trasladar las **notas** a la ventana que se despliega para **valorar**
  un ítem, eliminándolas también de la ficha.
- En los **visionados**, quitar el botón de **añadir un nuevo
  visionado** (ya se hace con el botón flotante) y **ocultarlos por
  defecto**, permitiendo al usuario mostrarlos.

La issue indica además que el trabajo parte de la rama
`feat/issue-298-boton-flotante` y que la PR irá a **`feat/issue-201`**
(no a `dev`), igual que las issues #290-#298.

Estado actual del código antes del cambio:

- La ficha de ítem (ADR-100/ADR-102, issue #285) se renderiza en
  `openMovieModal`/`openTvModal` de `js/ui.js`, llamados desde
  `openMovieItem`/`openTvItem` de `js/modal-handlers.js` (con
  `isRerender` para no re-pedir detalles en los re-renders). Al final de
  la ficha de película había: bloque «Visionados» con
  `renderWatchLogRows`, fila de añadir (`#field-new-watch-date` +
  `#btn-add-watch`, con confirmación de fecha no estrenada vía
  `unreleasedConfirmMessage`), `ratingPickerHtml(item.rating)` (ADR-095)
  y `notesFieldHtml(item.notes)`, más los botones «Eliminar» y
  «Guardar» (`onSaveMeta`). En la serie, lo mismo con la media de
  episodios (`episodeAverageHtml`, issue #80/ADR-063) junto al picker.
- Desde el FAB (ADR-106, issue #298) el usuario ya puede **marcar como
  vista**, **añadir otro visionado** y **valorar** en una sola pulsación,
  con los tres estados visuales del botón.
- `openRatingModal` (`js/rating-modal.js`, ADR-005/ADR-052/ADR-095)
  recibía `onSave(rating)` y no tenía campo de notas; los callers de
  ítem (`maybeQuickItemRating` en `js/quick-actions.js`,
  `maybeOpenItemRatingWindow` en `js/modal-handlers.js`, `openSeenRating`
  en `js/search.js`) persistían solo `{rating}`.
- Los callbacks `onAddWatch` y `onSaveMeta` de la ficha de película y
  serie eran los únicos flujos que seguían usando `addWatch` y
  `unreleasedConfirmMessage`.
- La versión PWA era `20261012` (ADR-106).

La implementación está en la rama `style/issue-300-ocultacion-visualizaciones`
con los commits `c15e2a1` (task #300 creada), `c3a2d8e` (ficha de
película/serie sin valoración ni notas), `1cee2e8` (refactor: quitados
los callbacks `onAddWatch`/`onSaveMeta`), `c188a26` (campo de notas en
la ventana de valoración, se guarda junto al rating y se muta el ítem en
memoria), `440a9e3` (visionados en `<details>` oculto por defecto, media
de episodios como línea informativa y notas en la ventana de valoración;
cuatro temas), `310ff0c` (manual actualizado), `e8b2f4b` (notas también
en la ventana de valoración de libros y videojuegos), `0261e1c` (margen
del campo de notas) y `49cb209` (QA + seguridad). El manual de usuario
se actualizó en la misma tarea (`docs/manual-de-usuario.md` §4.6, §5.4,
§12, §12.1 y §13, regla 3 de AGENTS.md).

Related issue: #300 — https://github.com/gonzalitojh/Registro-personal/issues/300

## Decisión

Eliminar las secciones de valoración y notas del final de las fichas de
películas y series, trasladar las notas a la ventana de valoración y
dejar los visionados de película ocultos por defecto en un
`<details>`. La decisión se organiza en seis puntos.

### 1. La ficha de película/serie ya no tiene valoración ni notas

En `openMovieModal` y `openTvModal` (`js/ui.js`):

- Se eliminan `ratingPickerHtml(item.rating)` y `notesFieldHtml(item.notes)`
  del final de ambas fichas, junto con el botón **«Guardar»**
  (`#btn-save-item`) y su listener (`onSaveMeta`). Solo queda el botón
  **«Eliminar»** en `modal-actions`.
- Se eliminan de la desestructuración de callbacks `onAddWatch` y
  `onSaveMeta` (película) y `onSaveMeta` (serie).
- `ratingPickerHtml`/`notesFieldHtml`/`wireRatingAndGetValue` se
  conservan en el módulo: libros (`openBookModal`) y videojuegos
  (`openGameModal`) mantienen su sección de valoración/notas con botón
  «Guardar», y la ventana de valoración reutiliza
  `ratingPickerHtml`/`wireRatingAndGetValue` con el prefijo de ids
  `rm-rating`.

### 2. Visionados de película ocultos por defecto

El bloque «Visionados» de la película pasa a un
`<details class="watch-log-details">` con
`<summary>Visionados (N)</summary>` (N = `item.watchLog.length`),
**colapsado por defecto**, y solo se pinta cuando hay historial
(`item.watchLog && item.watchLog.length`): con un ítem sin ver no hay
historial que mostrar y el FAB ya comunica el estado (ADR-106). Se
elimina la fila de añadir (`#field-new-watch-date` + `#btn-add-watch` y
su listener, incluida la confirmación de fecha no estrenada con
`unreleasedConfirmMessage`): marcar/añadir visionado son acciones del
botón flotante (issue #298). Dentro del `<details>` se conservan la
edición de fechas y el «Quitar» de cada visionado (listeners
`.watch-date` y `.watch-remove` intactos).

### 3. Notas en la ventana de valoración

`openRatingModal` (`js/rating-modal.js`) recibe el nuevo parámetro
**opcional `initialNotes`**:

- Si `initialNotes` está definido y no es `null`, renderiza
  `<div class="field-group rating-modal__notes">` con
  `<label for="rm-notes">Notas</label>` y
  `<textarea id="rm-notes" placeholder="Impresiones...">` (contenido
  con `escapeHtml`); sin `initialNotes` (p. ej. valoración de episodio)
  el campo no se muestra.
- `onSave` pasa a recibir **`(rating, notes)`**: las notas solo viajan
  si el campo existe (`undefined` si no), por lo que un caller que no
  pidió notas no persiste nada de notas.
- `wireRatingAndGetValue` se reutiliza con idPrefix `rm-rating` (media
  estrellas, ADR-095).

Los **callers de ítem** pasan `initialNotes` y persisten las notas junto
al rating con **payload condicional** (para no escribir `undefined`):

- `js/quick-actions.js` `maybeQuickItemRating` (FAB «Valorar», ADR-106) y
  `js/modal-handlers.js` `maybeOpenItemRatingWindow` (libros y
  videojuegos — este commit también cubre «Terminar de leer/finalizar
  partida») pasan `initialNotes: item.notes ?? ""` y, en `onSave`,
  construyen `payload = { rating }` y añaden `payload.notes = notes`
  solo si `notes !== undefined`, mutando luego `item.rating` e
  `item.notes` en memoria (mismo patrón de mutación que `persist()`,
  ADR-100).
- `js/search.js` `openSeenRating` (marcar vista desde la lista, issue
  #136/#62) pasa `initialNotes: ""` para el ítem recién añadido y
  persiste el payload condicional sin mutación (no tiene el objeto en
  memoria).

La **valoración de episodios NO muestra notas**: los callers de
episodio (`maybeQuickEpisodeRating` en `js/quick-actions.js` y el
flujo de episodio en `js/modal-handlers.js`) no pasan `initialNotes`,
así que el campo no se renderiza — las notas son del ítem, no del
episodio.

### 4. Se eliminan los callbacks `onAddWatch`/`onSaveMeta` de las fichas de película y serie

En `js/modal-handlers.js`, `openMovieItem` pierde `onAddWatch` (que en
el modal añadía el visionado con confirmación de fecha y encadenaba la
ventana de valoración con deshacer, issue #136) y `onSaveMeta`; y
`openTvItem` pierde `onSaveMeta` (junto con `saveMeta`). Aprovechando
esa eliminación se retiran los imports que quedaban huérfanos (`addWatch`
en `modal-handlers.js` y `unreleasedConfirmMessage` en `ui.js`). Marcar
como vista y añadir otro visionado quedan cubiertos exclusivamente por
los flujos del FAB (`quickMarkMovie`/`quickMarkTvComplete`/«Añadir otro
visionado», ADR-106), y valorar/notas por la ventana de valoración.

### 5. La media de episodios se conserva como línea informativa

En la ficha de **serie** se conserva
`episodeAverageHtml(item.watched, "field-rating")` (issue #80, ADR-063)
como **línea informativa** junto a las temporadas, para no perder esa
funcionalidad: el `idPrefix` `"field-rating"` se mantiene para no romper
sus selectores. En `ocio/ocio.css`, `.episode-average` pasa a
`margin: 0.6rem 0 1rem` (antes `margin-top: 0.4rem`, pegada al picker
que ya no existe).

### 6. CSS, cuatro temas y manual

- **`.watch-log-details`** (`ocio/ocio.css`): mismo patrón que
  `.rewatch-history` de las series — `margin-bottom: 1rem`,
  `font-size: 0.85rem`, `summary` con `cursor: pointer` y
  `color: var(--ink)`. Overrides de tema con los **selectores agrupados**
  existentes (regla 4 de AGENTS.md): `[data-theme="dark"] .item-view
  .watch-log-details summary { color: var(--paper) }` en
  `css/styles.css` (junto a `.rewatch-history summary`) y
  `[data-theme="black"] .watch-log-details summary` en el grupo de
  negro puro de `ocio/ocio.css`.
- **`.rating-modal__notes`** (`ocio/ocio.css`): `margin-bottom: 0` (el
  margen inferior lo pone `.rating-modal__actions`) y `textarea` con
  `min-height: 56px`; reutiliza `.field-group`, que ya cubre borde,
  fondo y los cuatro temas.
- **Manual de usuario** (regla 3 de AGENTS.md): §4.6 (series:
  «Visionados anteriores» ahora **oculto por defecto**), §5.4
  (película: visionados **ocultos por defecto**, desplegar
  **«Visionados (N)»**; sigue la edición de fechas y el «Quitar»), §12
  (ficha: valoración y notas se gestionan desde el **botón flotante**
  opción «Valorar»; lista de visionados oculta; solo queda «Eliminar»;
  media de episodios junto a las temporadas), §12.1 (FAB «Valorar»: la
  ventana incluye el campo de **notas**, que se guarda junto a la
  valoración) y §13 (desde la ficha de película o serie la ventana de
  valoración incluye el campo de notas; se guarda con
  «Guardar valoración»).
- **PWA**: sin bump — `APP_VERSION` sigue en `20261012` (ADR-106); la
  issue no añade assets estáticos ni cambios que requieran invalidar
  cachés (ADR-019).

## Alternativas descartadas

- **Mantener la sección de notas en la ficha y duplicarla en la ventana
  de valoración**: dos lugares para editar lo mismo, con el riesgo de
  estados divergentes; la issue pide explícitamente trasladar las notas
  a la ventana de valoración.
- **Ocultar los visionados con un botón «Mostrar/ocultar» propio** en
  lugar de `<details>`/`<summary>`: añade JS y estado de toggle
  innecesarios; el `<details>` nativo aporta el pliegue/despliegue con
  accesibilidad y teclado sin código adicional, y sigue el patrón ya
  usado por `rewatch-history` en series.
- **Eliminar también la media de episodios (issue #80)**: rompería una
  funcionalidad que el usuario ya usa (la media solo cuenta episodios
  valorados, §13 del manual); se conservó como línea informativa sin
  picker asociado.
- **Añadir el campo de notas también a la valoración de episodios**:
  las notas de la app son del ítem (la ficha las mostraba a nivel de
  ítem); permitir notas por episodio añadiría un segundo modelo de datos
  que la issue no pide.

## Consecuencias

**Positivas:**

- **Ficha de película/serie más corta y sin duplicidad**: desaparecen
  el picker de valoración, el campo de notas, el botón «Guardar» y la
  fila de añadir visionado; valorar y escribir notas viven en un solo
  lugar (la ventana de valoración, también para libros y videojuegos),
  con un único flujo de persistencia `{rating, notes}`.
- **Sin lógica duplicada**: la edición de rating+notas de un ítem pasa
  a usar siempre `openRatingModal` (ADR-005/ADR-052/ADR-095) con
  deshacer (issue #136); se eliminan los callbacks `onAddWatch`/
  `onSaveMeta` y sus imports huérfanos (`addWatch`,
  `unreleasedConfirmMessage`), y el `<details>` reutiliza el patrón de
  `rewatch-history` sin JS nuevo.
- **Visionados sin ruido visual**: ocultos por defecto en «Visionados
  (N)» (el usuario decide si verlos), manteniendo edición de fechas y
  borrado; en un ítem sin ver no se pinta bloque vacío y el FAB ya
  comunica el estado (ADR-106).
- **Sin regresión de la media de episodios**: la línea informativa de
  issue #80 se conserva y queda integrada junto a las temporadas.
- **Payload condicional defensivo**: `if (notes !== undefined)` evita
  que un caller sin campo de notas sobrescriba unas notas existentes con
  `undefined`.
- El manual de usuario queda alineado con el comportamiento real (regla
  3 de AGENTS.md) y los cuatro modos de tema quedan cubiertos con el
  patrón de selectores agrupados (regla 4 de AGENTS.md).

**Negativas / neutras:**

- **Editar solo las notas exige abrir la ventana de valoración**
  (FAB → «Valorar»): un paso más que el antiguo campo directo de la
  ficha, a cambio de un único punto de edición; las notas se muestran
  precargadas (`initialNotes`) y se guardan con «Guardar valoración».
- **La elección de fecha al añadir un visionado desde la ficha
  desaparece**: el flujo `onAddWatch` (con su confirmación para fechas
  no estrenadas) se elimina; añadir visionado es ahora siempre el
  flujo del FAB con la fecha que él determina (issue #298/ADR-106).
- **Las notas del ítem recién añadido se guardan desde la valoración
  encadenada** (marcar desde la lista, `openSeenRating`, pasa
  `initialNotes: ""`): el usuario debe abrir la valoración para
  escribirlas, comportamiento coherente con el resto.
- **El `<details>` colapsa el historial en móvil** (una pulsación más
  para ver los visionados): es exactamente el comportamiento pedido por
  la issue.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | **Modificado**: `openMovieModal` sin `onAddWatch`/`onSaveMeta`, sin `ratingPickerHtml`/`notesFieldHtml`/botón «Guardar»; bloque de visionados como `<details class="watch-log-details">` con `<summary>Visionados (N)</summary>` (solo si `watchLog.length`, sin fila de añadir ni listeners de `#btn-add-watch`/`#btn-save-item`); `openTvModal` sin `onSaveMeta` y sin picker/notas, conservando `episodeAverageHtml(item.watched, "field-rating")` como línea informativa; import de `unreleasedConfirmMessage` eliminado (`ratingPickerHtml`/`notesFieldHtml`/`wireRatingAndGetValue` se conservan para `openBookModal`/`openGameModal` y la ventana de valoración) |
| `js/rating-modal.js` | **Modificado**: nuevo parámetro opcional `initialNotes` en `openRatingModal` — sin él (null/undefined) no se renderiza el campo; con él, `<div class="field-group rating-modal__notes">` con `<label for="rm-notes">Notas</label>` y `<textarea id="rm-notes" placeholder="Impresiones...">` (contenido `escapeHtml`); `onSave` ahora `(rating, notes)` — las notas solo viajan si el campo existe (`#rm-notes` → `undefined` si no); `wireRatingAndGetValue` con idPrefix `rm-rating` |
| `js/quick-actions.js` | **Modificado**: `maybeQuickItemRating` (FAB «Valorar», ADR-106) pasa `initialNotes: item.notes ?? ""` y su `onSave(rating, notes)` persiste payload condicional (`{rating}` + `notes` solo si `!== undefined`) y muta `item.rating`/`item.notes` en memoria; la valoración de episodio (`maybeQuickEpisodeRating`) no pasa `initialNotes` (sin campo de notas) |
| `js/modal-handlers.js` | **Modificado**: `maybeOpenItemRatingWindow` (libros/videojuegos) con `initialNotes: item.notes ?? ""` y payload condicional + mutación en memoria; `openMovieItem` sin `onAddWatch` (y sin la cadena de deshacer asociada, issue #136) ni `onSaveMeta`; `openTvItem` sin `onSaveMeta`; import de `addWatch` eliminado |
| `js/search.js` | **Modificado**: `openSeenRating` (marcar vista desde la lista) pasa `initialNotes: ""` y persiste payload condicional `{rating}` + `notes` si `!== undefined` |
| `ocio/ocio.css` | **Modificado**: `.watch-log-details` nuevo (patrón de `.rewatch-history`: `margin-bottom: 1rem`, `font-size: 0.85rem`, `summary` con `cursor: pointer`/`var(--ink)`); `.episode-average` a `margin: 0.6rem 0 1rem` (línea informativa junto a temporadas); `.rating-modal__notes` nuevo (`margin-bottom: 0`, textarea `min-height: 56px`, reutiliza `.field-group` y sus 4 temas); `[data-theme="black"] .watch-log-details summary` añadido al selector agrupado de negro puro |
| `css/styles.css` | **Modificado**: `.watch-log-details summary` añadido al selector agrupado `[data-theme="dark"] .item-view` junto a `.rewatch-history summary` (`color: var(--paper)`) |
| `docs/manual-de-usuario.md` | **Modificado**: §4.6 «Historial de visionados» (series: «Visionados anteriores» oculto por defecto), §5.4 (película: visionados ocultos, desplegar «Visionados (N)»), §12 (ficha: valoración y notas desde el botón flotante, visionados ocultos, solo «Eliminar», media de episodios junto a temporadas), §12.1 (FAB «Valorar» incluye campo de notas que se guarda con la valoración) y §13 (desde la ficha de película/serie la ventana de valoración incluye notas; «Guardar valoración») |
| `tasks/task-issue-300.json` | **Nuevo**: task file de la issue #300 (status `validated`, criterios de aceptación y definition of done, bloque `issue` con número 300 y URL) |
| `docs/adr-107-ocultacion-visualizaciones.md` | **Nuevo**: este documento |

Related issue: #300 — https://github.com/gonzalitojh/Registro-personal/issues/300