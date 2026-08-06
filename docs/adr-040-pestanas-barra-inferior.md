# ADR-040: Barra de pestañas fija por dispositivo y cabecera fija (Series/Películas/Libros) (issue #79)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

**Nota de iteración**: este ADR se revisó tras el feedback del usuario en
la issue #79 (iteración 2, 2026-08-06). El diseño inicial que documentaba
—barra de pestañas fija **inferior en todos los dispositivos** (versión
`20260812`)— se descartó para PC y tablet: el usuario pidió que en esos
anchos las pestañas queden **bajo la barra de búsqueda superior**,
ocupando el mismo ancho que esta, y que la **barra superior (menú lateral,
búsqueda, campana, perfil) también sea fija**, siempre visible al hacer
scroll, en todos los dispositivos. La decisión final es la que documenta
este ADR (versión `20260813`); la barra inferior se mantiene solo en móvil.

Las pestañas **Series / Películas / Libros** vivían en la **cabecera**, bajo
la barra de búsqueda, como un `nav.tabs` con estilo de **separadores de
fichero**: pestañas con borde superior redondeado, `translateY(4px)` y la
activa «levantada» con una franja superior de color. Tenían dos problemas
respecto a lo que pide la issue #79:

1. **No eran fijas**: con el scroll desaparecían con la cabecera; cambiar de
   sección (Series ↔ Películas ↔ Libros) exigía volver arriba.
2. **Colores duplicados**: Series y Películas compartían el mismo acento
   verde (`--teal-reel`, clase común `tab--media`) y solo Libros usaba ocre
   (`--ochre-spine`); la issue pide **tres colores distintos entre sí**.

La issue #79 pide que las pestañas vivan en una **barra fija**: en la
**parte inferior** en móviles (≤768 px) y **bajo la barra de búsqueda
superior** en PC y tablet (≥768 px), ocupando el mismo ancho que esta, con
**iconos sencillos además del nombre**. El scroll debe causar efecto
únicamente sobre la lista de series, películas y libros: la barra de
pestañas y la **barra superior (menú lateral, búsqueda, campana, perfil)
permanecen fijas y siempre visibles en todos los dispositivos**, y **cada
pestaña tiene un color diferente** en todos los tipos de dispositivos y en
ambos temas.

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79

**Nota histórica**: este ADR documenta el traslado de las pestañas de la
cabecera (documentadas como parte de la pantalla principal en ADR-032 y
ADR-038) a una barra fija —inferior en móvil, bajo la cabecera en
PC/tablet—, la fijación de la cabecera en todos los dispositivos y la
diferenciación del color de Películas (antes compartía el verde de Series;
ahora usa `--stamp`).

## Decisión

Las pestañas Series/Películas/Libros pasan a una **barra fija**
(`position: fixed`): en la **parte inferior** en móvil (≤768 px) y
**pegada bajo la cabecera fija** en PC/tablet (≥768 px), con icono SVG
inline + nombre y un **color de acento propio** por pestaña, reutilizando
la paleta existente. La **cabecera también es fija en todos los
dispositivos**, de modo que la búsqueda global y el menú quedan siempre
visibles. El scroll solo desplaza el contenido de `.app`, que reserva
huecos con `calc()`.

### 1. Cabecera fija en todos los dispositivos

- `index.html`: el `nav.tabs` de la cabecera (dentro de `<header>`) se
  **elimina** (iteración 1); el resto del header —menú lateral, búsqueda,
  campana, perfil— no cambia de marcado.
- `css/styles.css`: `.app-header` pasa a `position: fixed; top: 0; left:
  0; right: 0; z-index: 46; background: var(--paper); border-bottom: 1px
  solid var(--paper-line)`. El fondo opaco `--paper` funciona en ambos
  temas y tapa el contenido que pasa por debajo al hacer scroll.
- `.app-header__top`: `height: var(--header-h)` (3.5rem), `flex-wrap:
  nowrap` (una sola fila en todos los anchos), `max-width: 980px` centrado
  y `padding: 0 1.25rem` (alineado con `#app`); se elimina el
  `margin-bottom` que separaba el header del contenido (ahora el hueco lo
  da el padding de `.app`, punto 4).
- **Iconos de cabecera en `--ink`**: `.app-header .icon-btn { color:
  var(--ink) }` — `.icon-btn` usa `--paper` por defecto porque estaba
  pensado para fondo oscuro, pero el header tiene fondo de papel en ambos
  temas; los iconos (menú, campana, avatar) pasan a tinta.
- **Nombre de usuario con ellipsis** (≥520 px): `white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: min(12rem, 30vw)`
  — salvaguarda para nombres largos: el header tiene altura fija y no debe
  envolver.
- Nueva variable `--header-h: 3.5rem` en `:root`: un único punto de ajuste
  para la altura de la cabecera, los huecos de `.app` (punto 4) y el
  `scroll-margin-top` (punto 6).

### 2. Barra de pestañas fija por dispositivo

- `index.html`: **nuevo `nav.tabs--bar`** a nivel de body (tras `</main>`,
  antes del footer) con la estructura `nav.tabs--bar > div.tabs[role=
  "tablist"] > button.tab` y `aria-label="Secciones"` (sin cambios de
  marcado respecto a la iteración 1).
- `css/styles.css`: `.tabs--bar` con `position: fixed; left: 0; right: 0;
  bottom: 0; z-index: 45; background: var(--ink-raised)` (superficie
  válida en ambos temas), `border-top: 1px solid var(--paper-alpha-20)`
  como separador y `padding-bottom: env(safe-area-inset-bottom, 0px)`.
- **Móvil (≤768 px)**: barra fija en el borde inferior del viewport (como
  en la iteración 1), con el margen seguro del iPhone.
- **PC/tablet (≥768 px)**: `top: var(--header-h); bottom: auto` — la barra
  se pega **bajo la cabecera fija**; el borde superior existente actúa de
  separador entre cabecera y pestañas.
- **Alineación de ancho**: el contenedor interior `.tabs` se alinea con
  `#app` y con el header — `width: 100%; max-width: 980px; margin: 0 auto;
  padding: 0 1.25rem` — de modo que las pestañas ocupen exactamente el
  mismo ancho que la barra de búsqueda (en todos los dispositivos).
- **`--tabs-bar-h`**: `3.75rem` en móvil (icono sobre nombre) y `3rem` en
  PC/tablet, en `@media (min-width: 768px)`. Una sola variable define la
  altura de la barra y los huecos de contenido (puntos 4 y 6), evitando
  duplicar el valor.
- **Icono + nombre**: cada pestaña lleva un **SVG inline** (trazo
  `currentColor`, `stroke-width: 1.8`, `aria-hidden="true"`) y un `<span>`
  con el nombre; en ≤768 px el icono va **sobre** el nombre (columna,
  `font-size: 0.72rem`) y en ≥768 px **junto** al nombre (fila,
  `font-size: 0.85rem`, iconos de 1.15rem frente a 1.35rem en móvil).
- `.tab` deja de ser una pestaña «fichero»: sin borde ni `translateY`,
  fondo transparente, `flex: 1; min-width: 0` (reglas de responsividad de
  AGENTS.md) y centrado por `flex` column/row.

### 3. Tres colores de acento con la paleta existente (sin tokens nuevos)

- Cada clase de pestaña define su propio acento con una **variable local
  `--tab-accent`** que reutiliza la paleta base del proyecto (definida en
  `:root` para ambos temas, claro y oscuro):

  - `.tab--tv` → `--tab-accent: var(--teal-reel)` (verde, Series).
  - `.tab--movies` → `--tab-accent: var(--stamp)` (rojo, Películas) —
    **cambio clave**: antes compartía verde con Series; `--stamp` es el
    acento rojo ya usado por la app en estados y errores, así que no se
    introduce ningún token nuevo.
  - `.tab--books` → `--tab-accent: var(--ochre-spine)` (ocre, Libros).

- **Pestaña activa**: fondo `var(--paper)` + `box-shadow: inset 0 3px 0
  var(--tab-accent)` (franja superior de 3px del color de la pestaña,
  herencia del estilo anterior pero sin el efecto de «levantamiento»).
- **Iconos**: el SVG usa `color: var(--tab-accent)`; en la pestaña activa
  pasa a `var(--ink)` (coherente con el texto activo).

### 4. Scroll solo sobre el contenido: huecos con `calc()`

- `.app` **padding superior móvil**: `calc(var(--header-h) + 1rem)` — hueco
  para la cabecera fija (3.5rem) + 1rem de aire.
- `.app` **padding superior PC/tablet** (≥768 px): `calc(var(--header-h) +
  var(--tabs-bar-h) + 1rem)` — acumula cabecera (3.5rem) + barra de
  pestañas (3rem) + 1rem de aire.
- `.app` **padding inferior móvil**: `calc(var(--tabs-bar-h) +
  env(safe-area-inset-bottom, 0px) + 1.5rem)` — la última fila de la lista
  y el pie nunca quedan tapados por la barra inferior (igual que en la
  iteración 1).
- `.app` **padding inferior PC/tablet** (≥768 px): vuelve a `4rem` — ya no
  hay barra abajo en esos anchos.
- **`env(safe-area-inset-bottom)`** para PWA en iOS (iPhone con home
  indicator) solo tiene efecto donde hay barra inferior (móvil): en el
  padding de la propia barra `.tabs--bar`, en el hueco de `.app` y en el
  toast (punto 7).

### 5. Breakpoint único a 768 px

El layout de escritorio (pestañas bajo la cabecera, barra en fila con
icono junto al nombre, `--tabs-bar-h: 3rem`, huecos acumulados, toast al
margen inferior) aplica desde `min-width: 768px` — y no `769px` como en la
iteración 1 — para que las **tablets portrait (iPad, 768 px)** vean las
pestañas bajo la cabecera y no la barra inferior.

### 6. `scroll-margin-top` para el foco y el skip-link

`#main-content` (destino del enlace «Saltar al contenido») y `.panel h2`
(recibe el foco al cambiar de pestaña, `js/app.js`) con `scroll-margin-
top: calc(var(--header-h) + 1rem)` en móvil (4.5rem) y `calc(var(--header-
h) + var(--tabs-bar-h) + 1rem)` en ≥768 px (7.5rem): el foco y el ancla no
quedan ocultos bajo la cabecera fija.

### 7. Toast reposicionado según dispositivo

- **Móvil**: `bottom: calc(var(--tabs-bar-h) + env(safe-area-inset-bottom,
  0px) + 1rem)` — los avisos (toast de guardado, undo, «Próximamente…»)
  aparecen **por encima de la barra inferior** y no quedan ocultos tras
  ella.
- **PC/tablet (≥768 px)**: `bottom: 1.4rem` — vuelve al margen inferior
  original, ya que la barra de pestañas está arriba.

### 8. Jerarquía z-index: cabecera 46, barra 45

La cabecera y la barra se colocan en dos escalones nuevos entre los
existentes:

| Capa | z-index |
|------|---------|
| `.skip-link` | 100 |
| `.toast` | 80 |
| `.modal--top` | 70 |
| `.app-sidebar` (drawer) | 60 |
| `.app-sidebar-backdrop` | 55 |
| `.modal` | 50 |
| **`.app-header` (fija)** | **46** |
| **`.tabs--bar`** | **45** |
| `.notif-dropdown` / `.profile-dropdown` / `.global-search__results` | 40 |

La cabecera queda un punto por encima de la barra de pestañas (46 > 45)
para que los **dropdowns anclados a ella** (hijos suyos, z-index 40) se
pinten siempre completos; ambas quedan por debajo de modales de
ítem/valoración (50/70), del backdrop del drawer (55) y del drawer de
ADR-038 (60), que nunca quedan tapados.

### 9. `js/app.js` sin cambios (selectores preservados)

El JS de pestañas **no se tocó** en ninguna de las dos iteraciones: la
delegación de clics existente sigue usando la clase `.tab`, `data-panel` y
`.is-active` (y los ids `tab-tv`/`tab-movies`/`tab-books`), que se
conservan **idénticos** en el nuevo marcado; solo cambió la ubicación del
`nav` y los estilos. El cambio es puramente estructural (HTML) + CSS, sin
lógica nueva ni refactors.

### 10. PWA y manual de usuario

- `js/config.js`: `APP_VERSION` de `20260811` a **`20260812`** (iteración
  1) y de ahí a **`20260813`** (decisión final, feedback del usuario).
- `index.html`: `?v=20260813` en `css/styles.css`, `ocio/ocio.css` y
  `js/app.js`.
- `service-worker.js`: `STATIC_ASSETS` actualizado a `?v=20260813`
  (estilos, app.js y `ocio/*.html`). Invalida las cachés previas
  (`20260812` y anteriores).
- `docs/manual-de-usuario.md`: sección **3** (pantalla principal): la
  cabecera **permanece siempre visible** al hacer scroll, en ningún
  dispositivo; las pestañas están en una **barra fija inferior en el
  móvil** y en una **barra fija justo bajo la barra de búsqueda superior
  en el ordenador y la tablet**, con icono y color propio (Series verde,
  Películas rojo, Libros ocre); la activa con franja de su color y fondo
  claro; el scroll solo mueve el contenido de la lista.
- Los partials `ocio/*.html` **no se tocaron**: los estilos de pestañas
  viven en `css/styles.css` y el comportamiento en `js/app.js`, así que
  las tres secciones siguen funcionando sin cambios.

## Alternativas descartadas

- **Barra fija inferior en todos los dispositivos** (diseño inicial de
  este mismo ADR, versión `20260812`): descartado tras el feedback del
  usuario — para PC y tablet las pestañas deben estar **bajo la barra de
  búsqueda superior**, ocupando el mismo ancho que esta; la barra inferior
  se mantiene solo en móvil (≤768 px).
- **Cabecera no fija** (solo la barra de pestañas fija): descartado — el
  feedback pide explícitamente que la barra superior (menú lateral,
  búsqueda, campana, perfil) sea fija y siempre visible al hacer scroll en
  todos los dispositivos; con cabecera móvil la búsqueda global y el menú
  desaparecerían al bajar por la lista.
- **Breakpoint a 769 px** (mantener el de la iteración 1): descartado —
  una tablet portrait de 768 px (iPad) vería la barra inferior en lugar
  del layout de pestañas bajo la cabecera; el layout desktop aplica desde
  `min-width: 768px`.
- **`position: sticky` para cabecera o barra**: descartado — con `fixed` +
  huecos explícitos (`padding` de `.app` y `scroll-margin-top`) el espacio
  reservado es independiente del flujo del documento; con `sticky` el
  hueco quedaría acoplado al orden del DOM y al largo del contenido.
- **Tokens de color nuevos** (p. ej. `--tab-tv-color`, `--tab-movies-color`
  con hex nuevos): descartado — la paleta existente ya tiene los tres
  acentos (verde `--teal-reel`, rojo `--stamp`, ocre `--ochre-spine`)
  definidos para ambos temas; `--stamp` resuelve la diferenciación de
  Películas sin añadir variables ni duplicar valores en claro/oscuro.
- **z-index alto (60/70) para la cabecera o la barra**: descartado —
  taparía el drawer de ADR-038 y sus modales; 46/45 quedan por debajo de
  modal (50), backdrop (55) y drawer (60) y por encima de los dropdowns
  (40).
- **Mantener la metáfora de «separador de fichero»** (pestaña activa
  «levantada» con `translateY`): descartado — el movimiento vertical no
  tiene sentido en una barra fija; se sustituye por fondo `--paper` +
  franja superior de 3px con el acento de la pestaña.
- **Hueco fijo en px** para el contenido: descartado — un valor fijo
  duplicaría la altura de la cabecera/barra en otro sitio y rompería en
  iOS; `calc(var(--header-h) + var(--tabs-bar-h) + …)` mantiene un único
  punto de ajuste.

## Consecuencias

### Positivas

- **Cabecera y pestañas siempre visibles**: la búsqueda global, el menú
  lateral y la navegación entre Series/Películas/Libros no requieren subir
  al principio, en ningún dispositivo; en móvil la barra inferior es
  además el patrón de navegación habitual de las apps nativas.
- **Pestañas en el sitio que el usuario espera por dispositivo**: inferior
  en móvil, bajo la barra de búsqueda en PC/tablet, con exactamente el
  mismo ancho que esta (alineación con `#app`, max-width 980 px + padding
  1.25rem).
- **Tres colores distintos** (verde/rojo/ocre) en todos los dispositivos,
  sin tokens nuevos: Películas pasa de compartir el verde de Series al
  acento rojo `--stamp` ya existente en la paleta.
- **Huecos calculados con las mismas variables** (`--header-h` y
  `--tabs-bar-h`): cambiar la altura de la cabecera o de la barra
  recalcula automáticamente los padding de `.app`, el `scroll-margin-top`
  y el toast; un único punto de ajuste por variable.
- **Sin cambios en JS**: `js/app.js` intacto (selectores `.tab`,
  `data-panel`, `.is-active` preservados), riesgo de regresión en la lógica
  de pestañas prácticamente nulo.
- **iOS PWA contemplada**: `env(safe-area-inset-bottom)` en la barra, el
  hueco de contenido y el toast evita el solapamiento con el home
  indicator del iPhone en móvil; en PC/tablet no hay barra inferior.
- **Accesibilidad mejorada**: `aria-controls` añadido a cada pestaña
  (nuevo), manteniendo `role="tablist"`/`role="tab"`/`aria-selected`; los
  iconos SVG son `aria-hidden` y el nombre queda en un `<span>` de texto;
  `scroll-margin-top` en `#main-content` y `.panel h2` para que el
  skip-link y el foco al cambiar de pestaña no queden tapados por la
  cabecera fija.
- **Responsividad verificada** según AGENTS.md (360/768/1280 px sin scroll
  horizontal): `flex: 1; min-width: 0` en las pestañas, `nowrap` + ellipsis
  en el header y unidades relativas (`rem`, `calc()`), sin `overflow-x:
  hidden` como parche.

### Negativas / Riesgos

- **Menos área vertical de lectura**: cabecera fija (3.5rem) + barra de
  pestañas (3.75rem en móvil, abajo; 3rem en PC/tablet, bajo la cabecera)
  consumen viewport; se mitiga con alturas compactas y tipografía reducida
  (0.72rem móvil / 0.85rem PC/tablet).
- **Dos escalones nuevos en la jerarquía z-index** (46 cabecera, 45 barra)
  entre 40 y 50: cualquier capa futura en ese rango deberá convivir con
  ellas; los dropdowns (40) son hijos de la cabecera, así que se pintan
  completos dentro de su contexto de apilamiento.
- **Cambio de costumbre**: las pestañas ya no están en la cabecera (móvil:
  abajo; PC/tablet: bajo la búsqueda) y la cabecera ya no se desplaza con
  el scroll; se mitiga con el manual de usuario actualizado (sección 3).

### Neutras

- **PWA versionada a `20260813`**: `APP_VERSION`, `?v=` en `index.html` y
  `STATIC_ASSETS` del service worker invalidan las cachés previas
  (incluida la intermedia `20260812` de la iteración 1).
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambios visibles al usuario): sección **3**.
- **ADRs previos no superados**: ADR-032 y ADR-038 describían las pestañas
  en la pantalla principal; su contenido sigue siendo válido salvo la
  ubicación de las pestañas (ahora barra fija por dispositivo) y de la
  cabecera (ahora fija). El drawer de ADR-038 (z-index 60) sigue por
  encima de la cabecera (46).
- **Partial `ocio/*.html` sin tocar**: los estilos de pestañas viven en
  `css/styles.css` y la lógica en `js/app.js`; no hay duplicación que
  mantener por sección.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | `nav.tabs` (estilo separadores de fichero) **eliminado** de la cabecera; **nuevo** `nav.tabs--bar` a nivel de body (tras `</main>`): `div.tabs[role="tablist"]` con 3 botones `.tab--tv`/`.tab--movies`/`.tab--books` (SVG inline `aria-hidden` + `<span>` nombre, `aria-controls` añadido, `data-panel`/`.is-active`/ids conservados); versionado `?v=20260813` |
| `css/styles.css` | `.app-header` fija (`position: fixed; top:0; left:0; right:0; z-index: 46; background: var(--paper); border-bottom: 1px solid var(--paper-line)`), iconos `.icon-btn` en `--ink`, `.app-header__top` con `height: var(--header-h)` (3.5rem), nowrap, `max-width: 980px` y `padding: 0 1.25rem`; nombre de usuario con ellipsis ≥520 px; `--header-h: 3.5rem` en `:root`; `.tabs--bar` fija (móvil `bottom: 0` / ≥768 px `top: var(--header-h); bottom: auto`, `z-index: 45`); `.tabs` con `padding: 0 1.25rem` (alineado con header y `#app`); breakpoint de escritorio unificado a `min-width: 768px` (también en `--tabs-bar-h` 3rem y `.tab` en fila); `.app` con padding superior `calc(var(--header-h) + 1rem)` móvil / `calc(var(--header-h) + var(--tabs-bar-h) + 1rem)` ≥768 px, padding inferior móvil `calc(var(--tabs-bar-h) + safe-area + 1.5rem)` y `4rem` ≥768 px; `scroll-margin-top` en `#main-content` y `.panel h2` (4.5rem móvil / 7.5rem ≥768 px); toast `bottom: 1.4rem` en ≥768 px; resto de la iteración 1 conservado (colores `--tab-accent`, safe-area, activa con franja) |
| `docs/manual-de-usuario.md` | Sección 3 (pantalla principal): cabecera siempre visible en todos los dispositivos; pestañas fijas por dispositivo (barra inferior en móvil, barra bajo la búsqueda en ordenador/tablet) con icono y color propio (Series verde, Películas rojo, Libros ocre), franja de color en la activa y scroll solo del contenido |
| `js/config.js` | `APP_VERSION` de `20260811` a `20260812` (iteración 1) y finalmente a **`20260813`** |
| `service-worker.js` | `STATIC_ASSETS` con `?v=20260813` (styles, ocio.css, app.js, `ocio/*.html`) |
| `docs/adr-040-pestanas-barra-inferior.md` | **Actualizado**: este documento (decisión final tras el feedback del usuario en la issue) |

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79
