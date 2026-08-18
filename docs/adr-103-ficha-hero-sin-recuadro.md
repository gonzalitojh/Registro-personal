# ADR-103: Ficha y preview de películas/series sin recuadro con cabecera hero (issue #292)

## Estado

Aceptado

## Fecha

2026-08-17

## Contexto

La issue #292 pedía cambiar la **visualización de las ventanas de
series y películas**: «Las nuevas ventanas de series y películas, no
deben estar en un recuadro, sino directamente sobre el fondo. Además,
ampliar el tamaño de la portada y poner a la derecha el título en
grande, debajo la fecha de estreno, duración y géneros como pequeñas
etiquetas. Debajo la valoración de la comunidad y la mía y el botón
para ver el tráiler. Bajo ello la sinopsis».

Hasta ahora, la página de detalle de películas y series (ADR-100,
`#/ocio/peliculas/<id>` y `#/ocio/series/<id>`) renderizaba la ficha y
la vista previa dentro de la superficie «tarjeta» `.item-view__card`
(misma superficie que `.modal__card`: `--paper`/`--ink`, `--radius`,
`--shadow-pop`), reutilizando el layout del modal clásico:
`.modal-detail__header` con la portada pequeña de siempre (92×138 px,
la de `.modal-detail__cover`), título y año, y a continuación los
bloques de nota de comunidad, tráiler, dónde verla e información
ampliada (duración · géneros · director/creadores · reparto · sinopsis)
como líneas de texto.

Contexto de ramificación: la decisión se implementa sobre la línea de
`feat/issue-201` (que ya contiene el ADR-102) en la rama
`style/issue-292-visualizacion-ventanas`, y la PR se dirige a
`feat/issue-201` (no a `dev`), según el propio enunciado de la issue
#292.

Related issue: #292 — https://github.com/gonzalitojh/Registro-personal/issues/292

## Decisión

La ficha y la preview de películas/series dejan de pintarse dentro de
un recuadro: el contenido va **directo sobre el fondo de la página** y
ambos modos comparten una nueva cabecera «hero»:

1. **Fuente única de verdad: `itemHeroHtml(item, { showUserRating =
   true, seasonsMeta = null } = {})`**, exportado desde `js/ui.js`.
   Devuelve un `<section class="item-hero">` con:
   - **Portada grande a la izquierda** (`.item-hero__cover`): 150 px de
     ancho con `aspect-ratio: 2/3` (antes 92×138); 128 px en pantallas
     de ≤420 px para que el bloque de texto de la derecha conserve un
     ancho legible.
   - **A la derecha, el título en grande** (`.item-hero__title`, fuente
     display, `overflow-wrap: anywhere`).
   - Debajo del título, una **línea de meta en texto normal**
     (`.item-hero__meta`, iteración issue #292): fecha de estreno
     formateada (o el año como fallback) y duración — en **películas**,
     `runtime` min; en **series**, el **nº de temporadas y episodios**
     calculado de `seasonsMeta` (parámetro en la ficha, `item.seasonsMeta`
     en la preview) en lugar de la duración; si no hay temporadas
     (render optimista sin detalles), degradación a `~episodeRuntime`
     min por episodio como texto.
   - Debajo, **pequeñas etiquetas** (`.item-hero__tags`) **solo con los
     géneros** (un tag por género). Si faltan datos (p. ej. render
     optimista de búsqueda sin detalles), la línea de meta o la lista
     se omiten enteras.
   - Debajo, una **fila de valoraciones** (`.item-hero__ratings`) con
     la nota de la comunidad (TMDB), las **estrellas de la valoración
     propia** (solo con `showUserRating` y solo si el ítem está
     valorado, normalizada con `normalizeRating`) y el **botón de
     tráiler**.
   - **Debajo del hero, la sinopsis** (`.item-hero__synopsis`); si aún
     no hay sinopsis (almacenamiento mínimo, issue #200), el hueco se
     cubre con la línea de estado de `detailStatusHtml` («Cargando
     detalles…» o el aviso de error de conexión), sin duplicarla.

2. **Compartido por ficha y preview**: en modo página
   (`openMovieModal`/`openTvModal` con `target`) la ficha usa
   `itemHeroHtml(item)` con `showUserRating: true` (en series se pasa
   además `seasonsMeta`, consultada aparte —issue #290—, para mostrar
   temporadas y episodios); la preview (`paintPreview` en item-page.js)
   usa `itemHeroHtml(item, { showUserRating: false })` — la valoración
   propia no aplica sin ítem en el registro y las temporadas llegan en
   `item.seasonsMeta` —. El **modal clásico** (sin `target`: libros,
   videojuegos, preview de búsqueda y ficha de amigo en solo lectura)
   conserva su cabecera `.modal-detail__header` y sus bloques propios:
   sin cambios.

3. **`extraInfoHtml` con opciones**: `{ skipMetaBits, skipOverview,
   skipStatusFallback }`. En la página (ficha y preview) la duración,
   los géneros y la sinopsis ya viven en el hero, así que se pasan
   `skipMetaBits` y `skipOverview` y el bloque «información ampliada»
   queda con director/creadores/reparto (y los campos propios de
   videojuegos); `skipStatusFallback` evita duplicar la línea de
   carga/error que ya pinta el hero. Los llamadores clásicos no pasan
   opciones: comportamiento idéntico.

4. **`renderItemContent` sin tarjeta** (item-page.js): el contenedor
   de la ficha/preview se pinta directo sobre el fondo de la página. La
   superficie `.item-view__card` se conserva **solo para los estados
   transitorios** (`renderLoading`/`renderMessage`: cargando, sin
   sesión, error, ítem borrado desde otro dispositivo).

5. **CSS por tokens, no por modo**: el hero hereda el color del fondo
   de la página — texto `--paper` sobre `--ink` en la familia oscura,
   texto `--ink` sobre `--paper-dim` en la clara (patrón de
   `.item-view` del ADR-100) —, lo que cumple **AAA en los cuatro
   modos** sin overrides. Las etiquetas usan el tinte de doble
   propósito `--paper-alpha-14` (claro sobre fondo oscuro, oscuro
   sobre fondo claro) y la sinopsis `--ink-soft` (AA en los 4 modos;
   ratios comentados en el CSS). Se añaden overrides **acotados a la
   página** (`[data-theme="dark"] .item-view …`) para los paneles
   interiores que conservan su propia superficie clara (banner de
   progreso, banner de standby, episodios de temporada, tarjetas de
   recomendaciones y de saga → `color: var(--ink)`) y para los acentos
   que asumían la superficie clara de la tarjeta (valor de la nota de
   comunidad `#4f9c8e`, badge «sin estrenar» `#cf6655`, botones
   outline/danger, media de episodios, resumen de rewatch history).
   Los hex se documentan con un comentario que explica por qué no usan
   variable (regla 4 de AGENTS.md).

6. **Foco**: en modo página el foco va a `.item-hero__title`
   (`tabindex="-1"`, `focus({ preventScroll: true })`), tanto en la
   ficha (ui.js) como en la preview (item-page.js).

## Alternativas descartadas

- **Mantener el recuadro y solo agrandar la portada**: la issue pide
  explícitamente que las ventanas vayan «directamente sobre el fondo»;
  conservar `.item-view__card` para la ficha/preview contradice el
  criterio de aceptación.
- **Cabecera hero duplicada en ficha y preview**: se descarta en favor
  de un único helper exportado (misma política anti-duplicación que el
  ADR-102).
- **Colores del hero por familia de tema con overrides**: se descarta —
  los tokens del fondo de la página ya cumplen AAA en los cuatro modos;
  los overrides solo cubren los paneles interiores que conservan su
  superficie clara.

## Consecuencias

- La ficha y la preview de películas/series se ven ahora **directas
  sobre el fondo de la página**, sin recuadro, con la cabecera hero:
  portada grande, título en grande, línea de meta en texto normal
  (fecha y duración; en series, temporadas y episodios), etiquetas
  solo de géneros, fila de valoraciones (comunidad + propia + tráiler)
  y sinopsis debajo.
- La **fecha y la duración** ya no son etiquetas sino **texto normal**
  (iteración issue #292); en las **series** se muestra el **nº de
  temporadas y episodios** en lugar de la duración, calculado de
  `seasonsMeta` (ficha: parámetro de `openTvModal`; preview:
  `item.seasonsMeta`). Solo los **géneros** siguen como pequeñas
  etiquetas.
- La **nota de la comunidad y el botón de tráiler** pasan a la cabecera
  (antes eran bloques propios bajo el título); la **duración, los
  géneros y la sinopsis** salen de la «información ampliada», que en la
  página queda con director/creadores/reparto.
- Los ítems sin sinopsis aún cargada (almacenamiento mínimo) muestran
  la línea «Cargando detalles…» (o el aviso de error de conexión) en el
  hueco de la sinopsis del hero; en la preview optimista de búsqueda la
  línea de carga aparece además bajo la información ampliada mientras
  llegan los detalles de TMDB.
- Los modales clásicos (libros, videojuegos, preview de búsqueda, ficha
  de amigo en solo lectura) no cambian.
- Responsividad (regla 2 de AGENTS.md): el hero usa `flex` con
  `min-width: 0`, `overflow-wrap: anywhere` y unidades relativas; sin
  scroll horizontal en 360/768/1280 px.
- Contraste (regla 4 de AGENTS.md): verificado en los cuatro modos —
  texto del hero AAA, sinopsis AA, etiquetas y paneles interiores con
  sus overrides acotados a la página.

## Archivos modificados

- `js/ui.js`: nuevo `itemHeroHtml` exportado; `extraInfoHtml` con las
  opciones `skipMetaBits`/`skipOverview`/`skipStatusFallback`; modo
  página de `openMovieModal`/`openTvModal` con hero y foco al título;
  `detailStatusHtml` exportado para el hueco de sinopsis del hero.
- `js/item-page.js`: `renderItemContent` sin la tarjeta; `paintPreview`
  con `itemHeroHtml(item, { showUserRating: false })` y opciones de
  `extraInfoHtml`; foco al `.item-hero__title` en la preview.
- `css/styles.css`: bloque `.item-hero` (portada, título, línea de
  meta, tags, valoraciones, sinopsis), media query de ≤420 px y
  overrides de familia oscura acotados a `.item-view`.
- `index.html` / `service-worker.js` / `js/config.js`: bump de versión
  PWA a `20261005`.
- `docs/manual-de-usuario.md`: sección 12.
- `docs/adr-103-ficha-hero-sin-recuadro.md`: este documento.

Related issue: #292 — https://github.com/gonzalitojh/Registro-personal/issues/292
