# ADR-063: Valoración media de episodios en la ficha de serie (issue #80)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #80 pide que, en las series, junto a la valoración general que el
usuario da a la serie se muestre la **valoración media de todos los
episodios valorados**, con un decimal (p. ej. «Media episodios: 4.2»).
Los episodios **sin valorar no cuentan**: la valoración de un episodio
nunca puede ser 0, el mínimo es 1. Si no hay ningún episodio valorado, la
media **no se muestra** (ni un 0 ni un texto engañoso).

Antes de esta decisión, el modal de detalle de serie (`openTvModal` en
`js/ui.js`) mostraba el picker de valoración de la serie
(`ratingPickerHtml(item.rating)`) sin ningún dato agregado sobre las
valoraciones de episodios, pese a que el dato ya existía en
`item.watched` (forma `{ "temporada": { "episodio": { date,
rating: 1-5|null } } }`, normalizado con `normalizeEntry` en
`js/tv-progress.js`). Como `persistWatched` (`js/modal-handlers.js`)
muta `item.watched` en memoria, la media podía calcularse y
**actualizarse en vivo** al valorar/desvalorar o marcar/desmarcar
episodios, sin persistir nada nuevo en Firestore.

La implementación está **validada (QA PASS)** y **escaneada por
seguridad (PASS)** en esta rama
(`feature/issue-80-valoracion-media-series`), con un fix posterior que
fuerza el ocultado vía CSS (`[hidden]` respetado, ver punto 4) y corrige
la gramática del tooltip (singular/plural); el manual de usuario se
actualizó en la misma tarea (`docs/manual-de-usuario.md` §9 y §10,
regla 3 de AGENTS.md). Este ADR documenta la decisión a posteriori,
como los recientes (ADR-059, ADR-060, ADR-061, ADR-062).

Related issue: #80 — https://github.com/gonzalitojh/Registro-personal/issues/80

## Decisión

Mostrar «Media episodios: X.X» (un decimal) junto al picker de
valoración de la serie, calculado **solo** sobre los episodios con
valoración válida (1-5), oculto cuando no hay media y actualizado **en
vivo** desde `item.watched` como única fuente de verdad. La decisión se
organiza en cinco capas: función pura de cálculo, render en el modal,
actualización en vivo, CSS y versionado.

### 1. Función pura `computeEpisodeAverageRating(watched)` (`js/tv-progress.js`)

```js
export function computeEpisodeAverageRating(watched) {
  // → null | { count, average } con average SIN redondear (total/count)
}
```

- Recorre `Object.values(watched || {})` (mapas de temporada; los que no
  sean objetos se ignoran) y, dentro, cada episodio normalizado con
  `normalizeEntry` (entradas legacy incluidas).
- **Exclusión estricta**: un episodio solo cuenta si su `rating` es un
  número finito (`Number.isFinite`) **y** está en `1..5`. Un episodio
  visto sin valorar (`rating: null`) nunca entra en la media — no
  penaliza como un 0. La valoración mínima de episodio es 1.
- Devuelve `null` si `count === 0` (ningún episodio valorado) y, si no,
  `{ count, average }` con la media **sin redondear** (el redondeo a un
  decimal es solo de presentación, en `js/ui.js`).

### 2. Render en el modal de serie (`js/ui.js`)

- **`ratingPickerHtml(rating, idPrefix = "field-rating", extraHtml = "")`**:
  nuevo tercer parámetro opcional que se inyecta al final del
  `.field-group` (tras el div de estrellas). Es **retrocompatible**: los
  3 usos previos (ventana de valoración emergente, modal de
  película/libro, etc.) no pasan `extraHtml` y su salida es idéntica.
- **`episodeAverageHtml(watched, idPrefix)`** (helper privado): genera
  el span de la media:
  - Con media: `<span class="episode-average" id="{idPrefix}-episode-average" title="Media de N episodios valorados">Media episodios: <strong>X.X</strong></span>` (tooltip con singular/plural: «1 episodio valorado» / «N episodios valorados»).
  - Sin media: mismo span pero **`hidden`** y vacío (placeholder que la
    closure del punto 3 actualiza).
- En `openTvModal` el picker pasa a `ratingPickerHtml(item.rating, "field-rating", episodeAverageHtml(item.watched, "field-rating"))`. Solo se usa en el modal de **serie**: películas y libros no muestran la media (no tienen episodios).

### 3. Actualización en vivo: closure `updateEpisodeAverage()`

Dentro de `openTvModal`, tras el render, `updateEpisodeAverage()` recalcula
`computeEpisodeAverageRating(item.watched)` y actualiza el span
`#field-rating-episode-average`:

- `el.hidden = !avg` (muestra/oculta).
- Con media: `title` («Media de N episodios valorados», singular/plural)
  e `innerHTML` con `avg.average.toFixed(1)` (un decimal en display).
- Sin media: `title` y `textContent` vacíos — defensa en profundidad: si
  el CSS dejara de respetar el `[hidden]` por cualquier motivo, no queda
  texto obsoleto visible.

Se invoca tras **los tres caminos** que mutan `item.watched`:

1. **Checkbox de episodio** (`onSetEpisodeDate`): el pintado es
   derivado de `item.watched` (no del checkbox pulsado), por lo que
   también refleja un posible «Deshacer» de la ventana de valoración
   emergente (patrón de la issue #136) — desmarcar con deshacer deja
   `rating: null` y la media se recalcula igualmente.
2. **Estrellas de episodio** (`onSetEpisodeRating`): valorar
   (`newValue`) o **quitar la valoración** (`value === currentlyActive →
   null`).
3. **«Marcar todo» / «Desmarcar todo»** de temporada
   (`onToggleSeason`): al desmarcar se limpian las estrellas activas y
   la media se recalcula (los episodios sin valorar no la alteran).

### 4. CSS (`ocio/ocio.css`)

- `.episode-average`: `display: block`, `margin-top: 0.4rem`, fuente
  mono (`var(--font-mono)`), `0.75rem`, color `--ink-soft` y
  `<strong>` en `--ink` — medidas relativas en `rem` (criterio de
  responsividad de AGENTS.md / ADR-026); texto corto que no provoca
  scroll horizontal.
- **`.episode-average[hidden] { display: none; }`**: regla explícita
  necesaria porque el `display: block` de la clase vencería al
  `display: none` del `[hidden]` del navegador (los estilos de autor
  ganan a los del agente de usuario). Sin esta regla, el span oculto
  seguiría visible — fue el fix del review de QA.

### 5. Datos y versionado

- **Sin persistencia nueva**: la media no se guarda en Firestore; se
  deriva siempre de `item.watched` (mutado en memoria por
  `persistWatched` en `js/modal-handlers.js`), la única fuente de
  verdad. No hay campos ni colecciones nuevos en el modelo de datos.
- **Bump PWA `20260835` → `20260836`**: la PR toca `js/ui.js` y
  `js/tv-progress.js`, ambos precacheados por el service worker
  (ADR-019), así que se aplica la práctica de un bump por PR
  (ADR-049/059/061) vía `scripts/bump-version.sh`: `js/config.js`
  (`APP_VERSION = '20260836'`), `index.html` (`?v=` ×3: `styles.css`,
  `ocio.css`, `app.js`) y `service-worker.js` (`?v=` ×6 en
  `STATIC_ASSETS`).

## Alternativas descartadas

- **Mostrar `0` o «—» cuando no hay episodios valorados**: descartado —
  es un criterio de aceptación explícito de la issue: sin episodios
  valorados la media no se muestra. Un «0» sería engañoso y
  contradictorio con la semántica de la valoración de episodio (mínimo
  1, nunca 0).
- **Calcular la media solo de episodios vistos con fecha**: descartado —
  la issue pide la media de los episodios *valorados*; un episodio visto
  sin valorar (`rating: null`) no debe penalizar la media como un 0.
  Excluirlo mantiene la media fiel a las notas del usuario.
- **Reutilizar el estilo `.community-rating` de TMDB (ADR-005/ADR-031)**:
  descartado — ese badge comunica una nota *de la comunidad* con label
  «TMDB»; la media de episodios es una nota *personal* del usuario, con
  semántica distinta. Además la issue pide un texto («Media episodios:
  X.X») junto al picker, no un badge compacto en la lista de episodios.
- **Persistir la media en Firestore** (campo derivado en el documento de
  la serie): descartado — sería un dato redundante y desincronizable:
  `item.watched` ya es la fuente de verdad en memoria y en BD, y cada
  escritura de episodio obligaría a recalcular/validar el campo sin
  beneficio observable.
- **Mostrar la media también en películas y libros**: descartado — la
  issue es exclusiva de series; películas y libros no tienen episodios,
  y su modal no toca `item.watched`.

## Consecuencias

### Positivas

- **Issue #80 resuelta**: la ficha de serie muestra la media de los
  episodios valorados junto a la valoración general, con un decimal
  (criterio de aceptación 1).
- **Precisión en el cálculo, redondeo solo en display**: la media se
  calcula sin redondear (`total/count`) y solo se formatea con
  `toFixed(1)` al pintar; el tooltip informa del número de episodios
  que cuentan.
- **Actualización en vivo sin recarga** por los tres caminos que mutan
  `item.watched` (valorar, quitar valoración, marcar/desmarcar todo),
  **incluido el deshacer** de la ventana emergente (issue #136), porque
  todo el pintado se deriva de `item.watched` — no del evento que lo
  causó.
- **Independiente de temporadas expandidas y de TMDB**: la media se
  calcula directamente sobre `item.watched`; las series manuales
  (sin datos de TMDB) también se benefician, y no depende de qué
  temporadas tenga expandidas el usuario en el modal.
- **Retrocompatibilidad**: `ratingPickerHtml` conserva firma y salida
  para los 3 usos previos; el `extraHtml` vacío por defecto no altera
  ningún render existente.
- **Responsive verificado**: el span usa unidades `rem` y texto corto;
  sin scroll horizontal en móvil (~360 px), tablet (~768 px) y
  ordenador (~1280 px) (criterio de aceptación 6).
- **Sin cambios en el modelo de datos**: no se persiste nada nuevo en
  Firestore.

### Negativas / Riesgos

- **La media puede no coincidir con la valoración general de la serie**:
  un usuario puede valorar la serie con 5 estrellas y sus episodios con
  3; ambas notas conviven con significados distintos. Es el
  comportamiento pedido por la issue, y el tooltip con el conteo ayuda a
  interpretar la media.
- **Media alta con pocos episodios valorados**: al excluir los no
  valorados, un solo episodio con 5 estrellas muestra «Media episodios:
  5.0». El tooltip («Media de 1 episodio valorado») mitiga la
  ambigüedad; es coherente con el criterio de aceptación 2.
- **Formateo singular/plural duplicado**: la cadena «1 episodio
  valorado / N episodios valorados» se genera en dos puntos
  (`episodeAverageHtml` y `updateEpisodeAverage`); es una única cadena
  corta, aceptado por simplicidad (el render inicial no reutiliza la
  closure, que se define después).

### Neutras

- **Bump PWA de rutina**: `20260835` → `20260836`, un bump por PR
  (ADR-049/059/061), aplicado con `scripts/bump-version.sh`, por tocar
  assets precacheados (`js/ui.js`, `js/tv-progress.js`, ADR-019).
- **Regla CSS `[hidden]` explícita**: necesaria por el `display: block`
  de `.episode-average`; documentada en el propio CSS para que no se
  elimine por limpieza.
- **Manual de usuario al día** (§9 y §10: formato «Media episodios:
  4.2», solo cuentan episodios valorados, mínimo 1, oculta sin media,
  se actualiza sola al valorar/quitar/desmarcar) — regla 3 de AGENTS.md.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/tv-progress.js` | **Modificado**: nueva función pura `computeEpisodeAverageRating(watched)` → `null` \| `{ count, average }` (media sin redondear); recorre `item.watched` con `normalizeEntry` y excluye ratings no finitos o fuera de `1..5` |
| `js/ui.js` | **Modificado**: `ratingPickerHtml` con 3er parámetro opcional `extraHtml = ""` (retrocompatible, 3 usos previos intactos); helpers privados `episodeAverageHtml(watched, idPrefix)` (span `#field-rating-episode-average`, `hidden` sin media, tooltip singular/plural) y closure `updateEpisodeAverage()` (hidden/title/innerHTML desde `item.watched`); llamado tras checkbox de episodio (incluye undo issue #136), estrellas de episodio y «Marcar todo/Desmarcar todo»; uso en `openTvModal` (solo series) |
| `ocio/ocio.css` | **Modificado**: clase `.episode-average` (block, mono 0.75rem, `--ink-soft`, `<strong>` en `--ink`, márgenes en `rem`) y `.episode-average[hidden] { display: none; }` (el `display:block` vencería al `[hidden]` del navegador) |
| `docs/manual-de-usuario.md` | **Modificado**: §9 y §10 documentan la «Media episodios: X.X» (solo episodios valorados, mínimo 1, oculta sin media, se actualiza en vivo) — regla 3 de AGENTS.md |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260835` → `20260836` |
| `index.html` | **Modificado**: bump `?v=20260835` → `?v=20260836` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `service-worker.js` | **Modificado**: bump `?v=20260835` → `?v=20260836` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/adr-063-valoracion-media-episodios.md` | **Nuevo**: este documento |

Related issue: #80 — https://github.com/gonzalitojh/Registro-personal/issues/80
