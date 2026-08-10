# ADR-062: Marcar ítems como vistos al buscar en el catálogo (issue #115)

## Estado
Aceptado (parcialmente revisado por la issue #177 — ver «Revisión: textos por tipo»)

## Fecha
2026-08-09

## Contexto

La issue #115 pide poder **marcar un ítem como visto directamente al
buscarlo** en el catálogo del buscador global: «Marcar ítems vistos al
buscar». Hasta ahora, añadir un resultado del catálogo (serie,
película o libro) implicaba **dos pasos**:

1. Pulsar **«Añadir»** en la fila del resultado (`handleAdd`, en
   `js/search.js`), que da de alta el ítem en estado pendiente
   (sin ver/leer).
2. Marcar el ítem como visto/leído a posteriori desde las **acciones
   rápidas** de la fila (`js/quick-actions.js`:
   `quickMarkMovie` / `quickMarkBook` / `quickMarkSeries`, patrón de
   deshacer de la issue #136) o abriendo su ficha.

El paso intermedio añadir→marcar es lo que la issue pide eliminar: un
botón en cada fila de resultados del catálogo que haga el alta **ya
como visto** y abra la valoración al momento.

La implementación está **validada (QA PASS)** en esta rama
(`feature/issue-115-marcar-visto-al-buscar`), con un fix posterior de
robustez (portada TMDB `null` y estado final del botón en libros
multi-portada); el manual de usuario se actualizó en la misma tarea
(`docs/manual-de-usuario.md` §7.1, regla 3 de AGENTS.md). Este ADR
documenta la decisión a posteriori, como los recientes
(ADR-059, ADR-060, ADR-061).

Related issue: #115 — https://github.com/gonzalitojh/Registro-personal/issues/115

## Decisión

Añadir el botón **«Marcar visto»** junto a **«Añadir»** en cada fila de
resultado del catálogo del buscador global. El botón da de alta el ítem
directamente con estado **completado** (visto/leído hoy) y abre la
**valoración al momento**, con **«Deshacer»** que elimina el ítem
recién creado. El botón **no** se añade al modal de vista previa.

### 1. Botón en la fila del dropdown (`js/global-search.js`)

En `renderExternalSection()` se renderiza junto a «Añadir»:

```html
<button type="button" class="global-search__item-seen btn btn--small" data-seen-index="${index}">Marcar visto</button>
```

- **Solo si `!added`** (mismo predicado que «Añadir»: `ids.has(externalId)`
  para películas/series y `isBookAlreadyAdded` para libros): un ítem que
  ya está en el registro no ofrece el botón.
- El listener usa `e.stopPropagation()` (no abre la vista previa),
  lee `data-seen-index` y, durante el flujo, **deshabilita ambos botones
  de la fila** (`btn` y el «Añadir» de `btn.closest(".global-search__item")`)
  con el texto «Marcando…» para evitar dobles altas. Al resolver la
  promesa: si `ok` → `disabled` + «Visto»; si no → restaura «Marcar
  visto» y vuelve a habilitar «Añadir» (con guard `!btn.isConnected` para
  el caso en que el snapshot de Firestore ya re-renderizó la fila).
- **Mejora de teclado**: en el `keydown` de la fila se añade la guarda
  `if (e.target !== el) return;` — con el foco en un botón, Enter/Space
  ya no activa `navigateTo` (la preview), sino que el botón recibe su
  propia activación nativa.

### 2. `handleAddSeen` en `js/search.js`: un flujo por tipo

Nueva exportación `handleAddSeen(item, btn, ctx)` → `Promise<boolean>`
(`true` = añadido y flujo completado; `false` = abortado, error o
deshecho), con helpers internos privados:

- **Películas**: `getMovieDetails` para `communityRating` y
  `releaseDate` (no bloqueante: un fallo no aborta el alta), draft con
  `status: "completado"`, `watchLog: [todayISO()]` y
  `awaitingRelease: false`, y **fallback de portada**
  (`draft.coverUrl = draft.coverUrl || item.coverUrl`) porque TMDB puede
  devolver `poster_path` `null` (fix del review de QA).
- **Libros** (`doAddBookSeen`): mismo esqueleto que `doAddBook` pero con
  `status: "completado"` y `readLog: [{ startedAt: todayISO(), finishedAt: todayISO() }]`
  (leído hoy); conserva el **backfill de sinopsis** de Open Library
  (`getOpenLibraryDescription` para IDs `"/works/..."`) y, en libros con
  **multi-portada o multi-sinopsis**, conserva el modal
  `ui.openBookConfirmModal` con `onConfirm: doAddBookSeen` (mismo
  predicado que `handleAdd`). En esa ruta la promesa no se espera: el
  **estado final del botón lo fija `doAddBookSeen`** («Visto» si `ok`,
  `restoreSeenBtn` si no), porque el listener del dropdown no consume la
  promesa.
- **Series**: ver punto 3.

### 3. Series: todas las temporadas y valoración del conjunto

- **Gate fail-closed**: `getTvSeasonsMeta(item.externalId)` en
  `try/catch`; si no devuelve temporadas, se muestra el toast
  «No se pudo marcar «…»: no se pudieron obtener sus temporadas.» y se
  devuelve `false` **sin alta a medias**.
- Con temporadas: `watched = markAllSeasonsWatched({}, seasonsMeta, todayISO())`
  y `progress = computeProgress(seasonsMeta, watched)`; el draft lleva
  `watched` completo, `status: "completado"`, `nextEpisode: null`,
  `firstWatchedAt`/`lastWatchedAt` tomados de `progress`,
  `timesCompleted: 0`, `history: []` y `awaitingRelease: false`.
- `getTvExtraDetails` (no bloqueante) aporta `communityRating` y
  `seasonAirDates`.
- **Valoración de la serie EN SU CONJUNTO**: `openSeenRating` se llama
  sin `episodeLabel` (a diferencia del modal de valoración de episodio),
  y usa `communityRating` de `getTvExtraDetails`.

### 4. Undo: `deleteItem` sobre el `DocumentReference` de `addItem`

`openSeenRating(uid, type, ref, opts)` reutiliza el patrón
`maybeQuickItemRating` de `js/quick-actions.js` (issue #21): abre
`openRatingModal` con `communityLabel: "TMDB"` e `initialRating: null`,
`onSave: updateItem(uid, type, ref.id, { rating })` y
`onUndo: deleteItem(uid, type, ref.id)`.

Como `addItem` (`js/db.js`) devuelve el `DocumentReference` de
`addDoc`, el **onUndo puede eliminar el ítem recién creado**: si el
usuario pulsa «Deshacer» en la ventana de estrellas, el resultado es
`RATING_MODAL_UNDONE` y `openSeenRating` muestra el toast
«Marcado deshecho.» y devuelve `false` (el botón se restaura). Patrón
de deshacer de la issue #136 (en quick-actions se restaura el estado
previo; aquí, al ser alta nueva, el undo es un borrado completo).
`openSeenRating` nunca lanza: si la ventana no puede abrirse, el alta
ya persistida queda intacta.

### 5. Confirmaciones de no estrenado

- **Películas**: los resultados de búsqueda no traen `releaseDate`, así
  que se usa el de `getMovieDetails` (con fallback `null`, que el
  mensaje trata como «sin fecha oficial») vía
  `unreleasedConfirmMessage({ type: "movie", manual: false, releaseDate, title })`
  y `window.confirm`.
- **Series**: `seasonsMeta.filter((s) => isUnreleasedDate(s.airDate))`
  (fecha por temporada, ADR-025); si hay temporadas sin estrenar se
  pregunta: ««…» · N de M temporadas aún no están estrenadas. ¿Marcarlas
  todas igualmente como vistas?». Cancelar restaura el botón y no añade
  nada.

### 6. `markAllSeasonsWatched` en `js/tv-progress.js`

Helper **puro** nuevo junto a `setSeasonWatched`:

```js
export function markAllSeasonsWatched(watched, seasonsMeta, date) {
  return seasonsMeta.reduce(
    (acc, s) => setSeasonWatched(acc, s.seasonNumber, s.episodeCount, true, date),
    watched || {}
  );
}
```

Marca como vistas TODAS las temporadas aplicando `setSeasonWatched`
con `allWatched: true` por temporada, sin mutar el estado.

### 7. CSS (`css/styles.css`)

`.global-search__item-seen`: mismo esqueleto compacto que «Añadir»
(`font-size: 0.72rem`, `padding: 3px 10px`, `white-space: nowrap`,
`flex-shrink: 0`, `border-radius: 999px`, `font-weight: 600`) pero en
estilo **outline teal** (`background: transparent`,
`border: 1px solid var(--teal-reel)`, `color: var(--teal-reel)`) para
diferenciarlo del «Añadir» sólido; `:hover` invertido (fondo
`--teal-reel`, texto `--paper`) y `:disabled` con `opacity: 0.55` y
`cursor: default`. Sin cambio de layout: convive con el botón «Añadir»
de la misma fila.

### 8. Manual de usuario (§7.1)

`docs/manual-de-usuario.md` §7.1 (Buscar en el catálogo) documenta el
botón: las películas quedan vistas con la fecha de hoy, las series con
todos los episodios de todas sus temporadas y los libros como leídos;
se abre la valoración al momento (una sola para la serie, en su
conjunto); «Deshacer» elimina el título del registro; y la web pregunta
antes de continuar si la película no está estrenada o la serie tiene
temporadas sin estrenar — regla 3 de AGENTS.md.

### 9. Bump PWA `20260834` → `20260835`

La PR toca assets versionados, así que se aplica la práctica de **un
bump por PR** (ADR-049/059/061) vía `scripts/bump-version.sh`:
`js/config.js` (`APP_VERSION = '20260835'`), `index.html` (`?v=` ×3:
`styles.css`, `ocio.css`, `app.js`) y `service-worker.js` (`?v=` ×6 en
`STATIC_ASSETS`: `styles.css`, `ocio.css`, `app.js`, `series.html`,
`peliculas.html`, `libros.html`).

## Alternativas descartadas

- **Botón «Marcar visto» también en el modal de vista previa**:
  descartado — el modal es de solo lectura (ADR-030) y duplicaría la
  acción sin necesidad; la issue pide el acceso directo en la lista de
  resultados, y el alta con valoración ya cubre el resto.
- **Variantes de texto por género** («Marcar vista» para películas,
  «Marcar leído» para libros): descartado en origen — texto uniforme
  «Marcar visto» para los tres tipos. **Revisado por la issue #177**:
  el texto del botón y sus estados pasan a depender del tipo de ítem
  (`SEEN_ACTION_LABELS` en `js/constants.js`): «Marcar visto»/«Visto»
  para películas y series, «Marcar leído»/«Leído» para libros y
  «Marcar jugado»/«Jugado» para videojuegos. El género (vista vs.
  visto) sigue sin distinguirse; el término sí.
- **Confirmación a nivel de episodio para series**: descartado — el
  objetivo es marcar la serie entera de una vez; preguntar episodio a
  episodio contradice el flujo de un clic y el manual lo explicaría
  como un caso especial. La confirmación existe, pero a nivel de
  temporadas sin estrenar.
- **Permitir la alta a medias si falla `getTvSeasonsMeta`** (dar de
  alta la serie y marcar las temporadas después): descartado — el gate
  fail-closed evita series con `watched` incoherente y el botón se
  restaura dejando el estado limpio; el usuario puede reintentar.
- **`timesCompleted: 1` en el alta de series**: descartado — es el
  primer visionado; `timesCompleted: 0` + `history: []` con
  `firstWatchedAt`/`lastWatchedAt` reales dejan el historial correcto
  para el patrón de recompletado existente (ADR-015).

## Consecuencias

### Positivas

- **Un clic en vez de dos pasos**: alta + marcado como visto/leído +
  valoración al momento, exactamente lo que pide la issue #115.
- **Deshacer sin restos**: al ser alta nueva, «Deshacer» borra el ítem
  completo vía el `DocumentReference` de `addItem` (patrón issue #136);
  no queda un alta pendiente ni un estado a medio restaurar.
- **Series con estado coherente**: `watched` completo, `nextEpisode:
  null`, `awaitingRelease: false`, `timesCompleted: 0`, `history: []` —
  la serie entra «terminada» con el historial listo para recompletados.
- **Consistencia visual**: mismo esqueleto que «Añadir», diferenciado
  con outline teal; el hover invertido y el `:disabled` con opacidad
  comunican el estado del botón.
- **Accesibilidad de teclado**: la guarda `e.target !== el` hace que
  Enter/Space sobre el botón active el botón (antes abría la preview
  siempre); los estados `disabled` durante el flujo evitan dobles
  acciones.
- **Toasts informativos por tipo**: «añadida y marcada como vista»
  (película/serie), «añadido y marcado como leído» (libro), «Marcado
  deshecho.» (undo).
- **Manual al día** (§7.1) y sin cambios en el modelo de datos:
  reutiliza `watchLog`/`readLog`/`watched`/`status` existentes.

### Negativas / Riesgos

- **Marcado masivo de series**: el usuario puede marcar como vista una
  serie que no ha visto (todas las temporadas de golpe); mitigado por
  la confirmación de temporadas sin estrenar y, sobre todo, por el undo
  inmediato («Deshacer» elimina el ítem). Aceptado por diseño de la
  issue.
- **`window.confirm` nativo** para las confirmaciones de no estrenado:
  mismo patrón que el resto de la app (quick-actions), con su look
  ajeno a la interfaz. No se introduce un diálogo propio.
- **Dependencia de TMDB para series**: si `getTvSeasonsMeta` falla la
  acción se aborta con toast (fail-closed) y no hay camino alternativo
  de un clic; el usuario puede añadir normal y marcar después.
- **Pasos extra en libros multi-portada**: el modal de selección de
  portada/sinopsis interrumpe la fluidez del «un clic»; necesario para
  no perder el flujo de elección heredado de `handleAdd`.
- **Asimetría en la ruta multi-portada de libros**: `handleAddSeen`
  devuelve `undefined` ahí (la promesa no se espera y el estado final
  del botón lo fija `doAddBookSeen`); documentada en el código y en
  este ADR.

### Neutras

- **Bump PWA de rutina**: `20260834` → `20260835`, un bump por PR
  (ADR-049/059/061), aplicado con `scripts/bump-version.sh`.
- **`handleAddSeen` no toca el estado pendiente de `handleAdd`**: ambos
  flujos coexisten; «Añadir» sigue siendo la vía de alta normal y el
  botón «Marcar visto» solo aparece en ítems no añadidos.
- **Modelo de datos intacto**: no hay campos ni colecciones nuevos en
  Firestore; solo se reutilizan los existentes con valores concretos.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/search.js` | **Modificado**: nueva sección «Alta directa como visto desde el catálogo (issue #115)» con `handleAddSeen(item, btn, ctx)` (export, `Promise<boolean>`) y helpers privados `openSeenRating(uid, type, ref, opts)` (openRatingModal con onSave `updateItem({rating})` y onUndo `deleteItem(ref.id)`, toasts por tipo y «Marcado deshecho.» sobre `RATING_MODAL_UNDONE`) y `doAddBookSeen(item, btn, ctx, choices)` (libro completado con `readLog` de hoy, backfill Open Library, estado final del botón en multi-portada); importa `getTvSeasonsMeta`, `markAllSeasonsWatched`, `computeProgress` y `openRatingModal`/`RATING_MODAL_UNDONE` |
| `js/global-search.js` | **Modificado**: render del botón `.global-search__item-seen btn btn--small` con `data-seen-index` solo si `!added`; listener con `e.stopPropagation()` que deshabilita ambos botones de la fila durante el flujo («Marcando…») y los restaura si `!ok` («Visto» si ok); guarda `if (e.target !== el) return;` en el `keydown` de la fila para que Enter/Space active los botones (issue #115); import de `handleAddSeen` |
| `js/tv-progress.js` | **Modificado**: nuevo helper puro `markAllSeasonsWatched(watched, seasonsMeta, date)` (reduce de `setSeasonWatched` con `allWatched: true` por temporada) |
| `css/styles.css` | **Modificado**: reglas de `.global-search__item-seen` (outline teal: fondo transparente, borde 1px y texto `--teal-reel`, peso 600, radio 999px; `:hover` invertido; `:disabled` opacidad 0.55 y `cursor: default`) |
| `docs/manual-de-usuario.md` | **Modificado**: §7.1 (Buscar en el catálogo) añadido el bullet de «Marcar visto» (alta como visto con fecha de hoy, series completas, valoración al momento, deshacer que elimina, confirmaciones de no estrenado) — regla 3 de AGENTS.md |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260834` → `20260835` |
| `index.html` | **Modificado**: bump `?v=20260834` → `?v=20260835` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `service-worker.js` | **Modificado**: bump `?v=20260834` → `?v=20260835` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/adr-062-marcar-visto-al-buscar.md` | **Nuevo**: este documento |

Related issue: #115 — https://github.com/gonzalitojh/Registro-personal/issues/115

## Revisión: textos por tipo (issue #177)

La issue #177 pide que cada tipo de ítem use su propio término para el
estado de «completado»: los videojuegos deben decir **«jugado»** y nunca
«visto» ni otra variante. Se revisa la decisión del texto uniforme del
botón del catálogo:

- **`js/constants.js`**: nuevos `SEEN_ACTION_LABELS` y
  `seenActionLabels(type)` con `action` («Marcar visto»/«Marcar
  leído»/«Marcar jugado») y `done` («Visto»/«Leído»/«Jugado») por
  alcance (`media`/`book`/`game`).
- **`js/global-search.js`**: el botón `.global-search__item-seen` del
  catálogo se renderiza con `seenActionLabels(item.type).action` y el
  estado final/restauración del flujo usa `labels.done` / `labels.action`.
- **`js/search.js`**: `restoreSeenBtn(btn, type)` usa
  `seenActionLabels(type).action`; la ruta multi-portada de libros fija
  `seenActionLabels("book").done`.
- **Manual**: §7.2 y §8.1 documentan el término por tipo.
- **Bump PWA** `20260902` → `20260903`.

Los toasts de éxito ya eran por tipo («añadido y marcado como jugado»,
«añadida y marcada como vista», «añadido y marcado como leído») y no se
tocan. Los estados de la colección (`STATUS_LABELS`) ya distinguían por
tipo y tampoco se ven afectados.

Related issue: #177 — https://github.com/gonzalitojh/Registro-personal/issues/177