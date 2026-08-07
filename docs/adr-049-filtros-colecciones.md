# ADR-049: Filtros colecciones (issue #118)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

La issue #118 (`type: style`) pide reorganizar la barra de controles de
las tres colecciones (Series, Películas, Libros). Texto original:

> No debe aparecer el texto "Mis series", "Mis películas" o "Mi
> biblioteca", ya que con el sistema de pestañas, se ve perfectamente
> claro donde está el usuario.
>
> Los filtros de estado deben estar todos en una misma línea, si no cabe
> por ancho (por ejemplo en móvil) debe poderse desplazar en horizontal
> sobre ese listado de filtros.
>
> El selector de orden y el de vista (cuadrícula o lista) deben estar en
> la misma línea y, siempre que se pueda, en la misma línea que los
> filtros. En móvil no es posible, así que mantener en dos líneas.
> Ademas, el selector de orden debe tener el mismo tamaño y tamaño de
> fuente que los filtros.
>
> Eliminar el margen superior de los filtros. El espacio que se encuentra
> entre las pestañas (o la barra de búsqueda en caso de móviles) y los
> filtros.

Estado previo del código:

- Cada colección (`ocio/series.html`, `ocio/peliculas.html`,
  `ocio/libros.html`) empezaba con un `<div class="library-head">` que
  contenía un `<h2>` («Mis series», «Mis películas», «Mi biblioteca») y,
  dentro, `.library-controls` con los chips de filtro (`.filter-chips` +
  `.chip`), el selector de orden (`.sort-select`) y el alternador de
  vista (`.view-toggle`).
- `.library-head` tenía `margin-top: 2.2rem` (el «espacio entre pestañas
  y filtros» que la issue pide eliminar).
- `.filter-chips` usaba `flex-wrap: wrap`, por lo que los chips saltaban
  de línea en móvil en vez de deslizarse.
- El orden y la vista ya estaban en la misma línea, pero no se garantizaba
  que compartieran línea con los filtros, y `.sort-select` tenía un
  padding (`0.3rem 0.65rem`) distinto del de `.chip` (`0.3rem 0.75rem`).
- El foco al cambiar de pestaña aterrizaba en el `h2` del panel
  (`js/app.js`, guard `if (heading)`), y `css/styles.css` daba
  `scroll-margin-top` a `#main-content` y a `.panel h2` (issue #79).
- `font-size` mínimo de 16px en selects garantizado por el ADR-042
  (issue #92): el `.sort-select` ya estaba en `1rem`.

Related issue: #118 — https://github.com/gonzalitojh/Registro-personal/issues/118

## Decisión

### 1. HTML: se eliminan los títulos de las tres colecciones

`ocio/series.html`, `ocio/peliculas.html` y `ocio/libros.html`:

- Se **elimina** el `<div class="library-head">` y su `<h2>` («Mis
  series», «Mis películas», «Mi biblioteca») en cada fichero (precedente
  ADR-046: eliminar por completo, no ocultar).
- `.library-controls` pasa a ser el **elemento raíz** de cada fichero.
- El bloque formado por `.sort-select` + `.view-toggle` se envuelve en un
  nuevo contenedor `<div class="library-controls__aux">` (el orden y la
  vista quedan como unidad).

### 2. HTML: ARIA de los paneles (compensación por quitar los h2)

`index.html`:

- Los tres paneles (`#panel-tv`, `#panel-movies`, `#panel-books`) ganan
  `role="tabpanel"` y `aria-labelledby="tab-tv"` /
  `aria-labelledby="tab-movies"` / `aria-labelledby="tab-books"` (patrón
  APG de tabs: los botones de pestaña ya tenían `role="tab"`,
  `aria-controls` y `aria-selected`).
- Se conservan `aria-live="polite"` y `aria-atomic="true"` de cada panel.

### 3. CSS: filtros en una sola línea con scroll horizontal confinado

`ocio/ocio.css`, `.filter-chips`:

- `flex-wrap: nowrap` (todos los chips en una línea).
- `overflow-x: auto` + `-webkit-overflow-scrolling: touch` (si no
  caben, la línea se desliza en horizontal).
- `scrollbar-width: none` + `.filter-chips::-webkit-scrollbar {
  display: none; }` — la barra de desplazamiento no se muestra
  (comentario del usuario en la issue: «En el móvil, no debe aparecer
  la barra de desplazamiento horizontal»), pero el deslizamiento
  táctil sigue funcionando.
- `flex: 1 1 auto` + `min-width: 0` (la línea de filtros ocupa el ancho
  disponible y puede encogerse).

`.chip`:

- `flex: 0 0 auto` + `white-space: nowrap` (los chips no se comprimen ni
  parten su texto al deslizar).

El scroll horizontal queda **confinado al listado de filtros**, que es un
contenedor diseñado para ello (permitido por la regla 2 de AGENTS.md; el
scroll horizontal a nivel de página sigue prohibido).

### 4. CSS: orden y vista como unidad, en la misma línea que los filtros

`ocio/ocio.css`:

- **Nuevo** `.library-controls__aux`: `display: flex; align-items:
  center; gap: 0.7rem; flex-shrink: 0;` — envuelve `.sort-select` +
  `.view-toggle` y no se encoge ni se separa.
- `.library-controls` (flex con `flex-wrap: wrap`) coloca en la **misma
  línea** los filtros y el bloque auxiliar cuando el ancho lo permite
  (≥769 px).
- `@media (max-width: 768px) { .library-controls__aux { flex-basis: 100%;
  } }` → en móvil el bloque auxiliar salta a una **segunda línea**,
  manteniendo orden y vista juntos (dos líneas en total: filtros, y
  orden+vista), como pide la issue.

### 5. CSS: mismo tamaño y fuente para orden y filtros

`ocio/ocio.css`:

- `.sort-select`: `padding` pasa de `0.3rem 0.65rem` a `0.3rem 0.75rem`
  (idéntico al de `.chip`); `font-size: 1rem` se conserva (ya lo
  exigía el ADR-042: ningún select con `font-size` < 16px por el zoom
  automático de iOS).
- Los chips de la biblioteca se escalan **solo** con la regla scoped
  `.library-controls .chip { font-size: 1rem; }`: el `.chip` base de
  `ocio/ocio.css` se mantiene en `0.78rem` para no afectar al chip del
  buscador global (`.global-search__item-status.chip` en
  `css/styles.css`, que depende por cascada del `font-size` base).

### 6. CSS: sin margen superior entre pestañas/búsqueda y filtros

`ocio/ocio.css`:

- Se **eliminan** las reglas `.library-head` y `.library-head h2`
  (incluido su `margin-top: 2.2rem`, que era el espacio entre las
  pestañas —o la barra de búsqueda en móvil— y los filtros).
- El aire base de 1rem lo aporta el `padding` de `.app` (ADR-040,
  intacto).
- `.library-controls` conserva `margin-bottom: 0.8rem` y añade
  `max-width: 100%`.

### 7. CSS: limpieza de reglas huérfanas

`css/styles.css`:

- Se **elimina** `.panel h2` de las reglas `scroll-margin-top` (base y
  `@media (min-width: 768px)`); queda solo `#main-content`, destino del
  enlace «Saltar al contenido» y del foco al cambiar de pestaña (issue
  #79).
- Se **actualiza** el comentario que explicaba esas reglas (ya no hay
  `h2` en los paneles).

### 8. Manual de usuario actualizado

`docs/manual-de-usuario.md` (obligación de AGENTS.md: cambio visible
para el usuario):

- Sección 3: la pestaña activa indica siempre en qué colección estás;
  cada colección no repite un título como «Mis series» y nada más entrar
  se ve directamente su barra de herramientas.
- Sección 8: los chips de filtro están todos en una línea y, si no caben
  (móvil), la línea se desliza en horizontal (sin barra de desplazamiento
  visible; se desliza con el dedo); el selector de orden y el de vista
  van siempre juntos (misma línea que los filtros en pantallas anchas,
  segunda línea en móvil); el selector de orden tiene el mismo tamaño y
  la misma fuente que los chips.

### 9. Bump de versión PWA

`index.html` (`?v=` en `css/styles.css`, `ocio/ocio.css` y `js/app.js`,
×3), `js/config.js` (`APP_VERSION`) y `service-worker.js`
(`STATIC_ASSETS`, ×6): `20260817` → `20260818`, para invalidar las
cachés del service worker y del navegador con los nuevos estilos y
marcado.

## Alternativas descartadas

- **Bajar `.sort-select` a `font-size: 0.78rem`** para igualarlo a los
  chips: descartado — viola el ADR-042 (issue #92): un select con
  `font-size` calculado < 16px provoca el zoom automático de iOS al
  enfocarlo. Se sube el chip de la biblioteca a `1rem` en su lugar.
- **Subir el `.chip` base de `ocio/ocio.css` a `1rem`** (afectar a todos
  los chips a la vez): descartado — inflaría la etiqueta de estado del
  buscador global (`.global-search__item-status.chip` en
  `css/styles.css`), que comparte la clase `.chip` y depende por cascada
  de su `font-size` base de `0.78rem`. Por eso el escalado es scoped:
  `.library-controls .chip`.
- **Ocultar los `h2` con `display: none`** manteniendo el marcado:
  descartado — precedente ADR-046: eliminar por completo, no ocultar; un
  `h2` que no se renderiza no aporta nada al DOM y obliga a conservar
  CSS y texto inútil.
- **`overflow-x: hidden` en `body`/`html`** para contener el desborde de
  los chips: descartado — prohibido por la regla 2 de AGENTS.md
  (enmascara desbordamientos y puede cortar contenido). El scroll
  horizontal se confina a `.filter-chips`, contenedor diseñado para ello.
- **Mantener `scrollbar-width: thin`** (barra visible): descartado tras
  el comentario del usuario — en móvil no debe aparecer la barra de
  desplazamiento horizontal. Se opta por ocultarla (`scrollbar-width:
  none` + `::-webkit-scrollbar { display: none }`) conservando el
  desplazamiento táctil.

## Consecuencias

### Positivas

- La pestaña activa es la única indicación de colección; cada vista
  aterriza directamente en su barra de herramientas, sin título
  redundante.
- Los filtros se deslizan en horizontal en móvil sin ocupar más espacio
  ni desbordar la página (`document.documentElement.scrollWidth <=
  window.innerWidth` verificado por QA en 360/768/1280 px), y sin
  mostrar la barra de desplazamiento (comentario del usuario en la
  issue).
- Orden y vista quedan siempre juntos y comparten línea con los filtros
  en pantallas anchas; dos líneas en móvil, tal y como pide la issue.
- Selector de orden y chips con el mismo padding y la misma fuente
  (1rem), respetando el ADR-042.
- Sin espacio extra entre pestañas (o barra de búsqueda en móvil) y los
  filtros; el aire base lo aporta el `padding` de `.app` (ADR-040).
- ARIA completo: paneles con `role="tabpanel"` + `aria-labelledby`
  (patrón APG) sin tocar `aria-live`/`aria-atomic` ni los atributos de
  las pestañas.
- CSS huérfano eliminado (`.panel h2` en `scroll-margin-top`) y
  comentario de `ocio/ocio.css` documentando la dependencia scoped del
  chip del buscador global.
- Bump PWA coherente (3 referencias `?v=` en `index.html` + `APP_VERSION`
  + 6 en `STATIC_ASSETS`).
- `js/app.js` sin cambios (selectores `.filter-chips`, `.sort-select` y
  `.view-toggle` intactos) y vista de amigos (`.friend-filters` /
  `.friend-chip`) sin tocar (fuera de alcance de la issue).

### Negativas / Riesgos

- **Residuo aceptado en `js/app.js`**: el guard `if (heading)` que movía
  el foco al cambiar de pestaña queda inofensivo (nunca hay `h2` en los
  paneles). Se conserva por no tocar JS fuera de alcance; limpiable en un
  refactor futuro.
- **A 768 px exactos** la media query `max-width: 768px` fuerza la
  segunda línea también para películas (3 chips), donde quizá cabría todo
  en una línea: comportamiento aceptado — punto de corte único y
  coherente con el resto de la app.
- **Sin `h2`, el foco al cambiar de pestaña no aterriza en un
  encabezado**: se compensa con `role="tabpanel"` + `aria-labelledby`
  (los paneles quedan correctamente etiquetados por su pestaña).
- **Dependencia frágil por cascada** del chip del buscador global con el
  `.chip` base: un cambio futuro en `0.78rem` lo afectaría; mitigado con
  la regla scoped `.library-controls .chip` y su comentario.

### Neutras

- **Sin tests automatizados**: el cambio es CSS/HTML puro; la verificación
  se hace por análisis de cascada (specificity y orden de carga) y
  revisión manual en tres anchos (QA: 7/7 criterios de aceptación
  cumplidos; seguridad: 0 hallazgos HIGH). La iteración (barra de
  desplazamiento oculta) se verificó con Chromium headless en
  320/360/768/1280 px: `scrollbar-width: none`, scroll funcional a
  360 px y sin scroll horizontal de página.
- **`docs/manual-de-usuario.md` actualizado** (regla 3 de AGENTS.md):
  secciones 3 y 8 reflejan la nueva disposición de la barra de
  herramientas.
- **Bump PWA aplicado en la misma tarea** (a diferencia de ADR-046, que
  lo dejaba para el release): cada PR que toca assets versiona sus URLs
  para invalidar cachés.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `ocio/series.html` | **Modificado**: eliminado `<div class="library-head">` con `<h2>Mis series</h2>`; `.library-controls` pasa a ser el elemento raíz; el bloque `.sort-select` + `.view-toggle` se envuelve en `<div class="library-controls__aux">` |
| `ocio/peliculas.html` | **Modificado**: eliminado `<div class="library-head">` con `<h2>Mis películas</h2>`; misma reestructuración que series (`.library-controls` raíz + `.library-controls__aux`) |
| `ocio/libros.html` | **Modificado**: eliminado `<div class="library-head">` con `<h2>Mi biblioteca</h2>`; misma reestructuración que series (`.library-controls` raíz + `.library-controls__aux`) |
| `ocio/ocio.css` | **Modificado**: eliminadas `.library-head`/`.library-head h2` (incluido `margin-top: 2.2rem`); `.filter-chips` → `flex-wrap: nowrap; overflow-x: auto; flex: 1 1 auto; min-width: 0; -webkit-overflow-scrolling: touch; scrollbar-width: none` + `.filter-chips::-webkit-scrollbar { display: none; }` (iteración: barra oculta en móvil); `.chip` → `flex: 0 0 auto; white-space: nowrap`; nueva regla scoped `.library-controls .chip { font-size: 1rem; }` con comentario; `.library-controls` conserva `margin-bottom: 0.8rem` y añade `max-width: 100%`; nueva `.library-controls__aux`; `.sort-select` padding → `0.3rem 0.75rem`; `@media (max-width: 768px)` añade `.library-controls__aux { flex-basis: 100%; }` |
| `index.html` | **Modificado**: los 3 paneles (`#panel-tv`, `#panel-movies`, `#panel-books`) ganan `role="tabpanel"` + `aria-labelledby="tab-tv"/"tab-movies"/"tab-books"` (se conservan `aria-live`/`aria-atomic`); bump `?v=20260818` (×3: `css/styles.css`, `ocio/ocio.css`, `js/app.js`) |
| `css/styles.css` | **Modificado**: eliminado `.panel h2` de las reglas `scroll-margin-top` (base y media query 768px; queda solo `#main-content`) y comentario actualizado |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260817` → `20260818` |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` — 6 URLs con `?v=` pasan de `20260817` a `20260818` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 3 (la pestaña activa indica la colección; no se repite título) y sección 8 (chips en una línea que se deslizan en horizontal en móvil; orden+vista juntos — segunda línea en móvil; mismo tamaño de fuente) |
| `js/app.js` | **Sin cambios**: selectores `.filter-chips`/`.sort-select`/`.view-toggle` intactos; el guard `if (heading)` del foco al cambiar de pestaña queda inofensivo sin `h2` (residuo aceptado) |
| `docs/adr-049-filtros-colecciones.md` | **Nuevo**: este documento |

Related issue: #118 — https://github.com/gonzalitojh/Registro-personal/issues/118
