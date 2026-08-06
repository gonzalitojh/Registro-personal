# ADR-040: Barra de pestañas fija inferior (Series/Películas/Libros) (issue #79)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

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

La issue #79 pide mover las pestañas a una **barra fija en la parte
inferior** de la pantalla —en móviles y también en dispositivos más
anchos— con **iconos sencillos además del nombre**, de modo que el scroll
solo desplace la lista de series, películas y libros, y que **cada pestaña
tenga un color diferente** en todos los tipos de dispositivos.

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79

**Nota histórica**: este ADR documenta el traslado de las pestañas de la
cabecera (documentadas como parte de la pantalla principal en ADR-032 y
ADR-038) a una barra fija inferior, y la diferenciación del color de
Películas (antes compartía el verde de Series; ahora usa `--stamp`).

## Decisión

Las pestañas Series/Películas/Libros pasan a una **barra fija inferior**
(`position: fixed; bottom: 0`) visible en **todos los dispositivos** (no
solo móvil), con icono SVG inline + nombre y un **color de acento propio**
por pestaña, reutilizando la paleta existente. El scroll solo desplaza el
contenido de `.app`, que reserva hueco inferior con `calc()`.

### 1. Barra fija inferior `nav.tabs--bar` (todos los dispositivos)

- `index.html`: se **elimina** el `nav.tabs` de la cabecera (dentro de
  `<header>`) y se añade un **nuevo `nav.tabs--bar`** a nivel de body
  (tras `</main>`, antes del footer) con la estructura
  `nav.tabs--bar > div.tabs[role="tablist"] > button.tab` y el mismo
  `aria-label="Secciones"`.
- `css/styles.css`: `.tabs--bar` con `position: fixed; left: 0; right: 0;
  bottom: 0; z-index: 45; background: var(--ink-raised)` (superficie
  válida en ambos temas) y `border-top: 1px solid var(--paper-alpha-20)`
  como separador; el contenedor interior `.tabs` se alinea con `#app`
  (`width: 100%; max-width: 980px; margin: 0 auto`) y su altura se
  centraliza en la variable `--tabs-bar-h`.
- **`--tabs-bar-h`**: `3.75rem` en móvil (icono sobre nombre) y `3rem` en
  escritorio, en `@media (min-width: 769px)`. Una sola variable define la
  altura de la barra y el hueco de contenido (punto 3), evitando duplicar
  el valor en dos sitios.
- **Icono + nombre**: cada pestaña lleva un **SVG inline** (trazo
  `currentColor`, `stroke-width: 1.8`, `aria-hidden="true"`) y un `<span>`
  con el nombre; en ≤768 px el icono va **sobre** el nombre (columna,
  `font-size: 0.72rem`) y en ≥769 px **junto** al nombre (fila,
  `font-size: 0.85rem`, iconos de 1.15rem frente a 1.35rem en móvil).
- `.tab` deja de ser una pestaña «fichero»: sin borde ni `translateY`,
  fondo transparente, `flex: 1; min-width: 0` (reglas de responsividad de
  AGENTS.md) y centrado por `flex` column/row.

### 2. Tres colores de acento con la paleta existente (sin tokens nuevos)

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

### 3. Scroll solo sobre el contenido: hueco con `calc()` + safe-area

- `.app` cambia su padding inferior de `4rem` fijo a
  `calc(var(--tabs-bar-h) + env(safe-area-inset-bottom, 0px) + 1.5rem)`:
  la última fila de la lista y el pie nunca quedan tapados por la barra, y
  el hueco se recalcula solo si cambia `--tabs-bar-h`.
- **`env(safe-area-inset-bottom)`** para PWA en iOS (iPhone con home
  indicator): se aplica tres veces — en el padding inferior de la propia
  barra `.tabs--bar` (el contenido sube por encima del área segura), en el
  hueco de `.app` y en el toast (punto 4).

### 4. Toast reposicionado por encima de la barra

- `.toast` pasa de `bottom: 1.4rem` a
  `bottom: calc(var(--tabs-bar-h) + env(safe-area-inset-bottom, 0px) + 1rem)`
  para que los avisos (toast de guardado, undo, «Próximamente…») aparezcan
  **por encima de la barra de pestañas** y no queden ocultos tras ella.

### 5. Jerarquía z-index: 45 (bajo modales/drawer, sobre dropdowns)

La barra se coloca en `z-index: 45`, entre los escalones existentes:

| Capa | z-index |
|------|---------|
| `.skip-link` | 100 |
| `.toast` | 80 |
| `.modal--top` | 70 |
| `.app-sidebar` (drawer) | 60 |
| `.app-sidebar-backdrop` | 55 |
| `.modal` | 50 |
| **`.tabs--bar` (nueva)** | **45** |
| `.notif-dropdown` / `.profile-dropdown` / `.global-search__results` | 40 |

Así la barra nunca tapa modales de ítem/valoración (50/70), el drawer de
ADR-038 (60) ni su backdrop (55), y queda por encima de los dropdowns (40).
Estos dropdowns se anclan a la parte alta de la pantalla (cabecera y barra
de búsqueda), por lo que no se solapan en la práctica con la barra.

### 6. `js/app.js` sin cambios (selectores preservados)

El JS de pestañas **no se tocó**: la delegación de clics existente sigue
usando la clase `.tab`, `data-panel` y `.is-active` (y los ids
`tab-tv`/`tab-movies`/`tab-books`), que se conservan **idénticos** en el
nuevo marcado; solo cambió la ubicación del `nav` y los estilos. El cambio
es puramente estructural (HTML) + CSS, sin lógica nueva ni refactors.

### 7. PWA y manual de usuario

- `js/config.js`: `APP_VERSION` de `20260811` a **`20260812`**.
- `index.html`: `?v=20260812` en `css/styles.css`, `ocio/ocio.css` y
  `js/app.js`.
- `service-worker.js`: `STATIC_ASSETS` actualizado a `?v=20260812`
  (estilos, app.js y `ocio/*.html`). Invalida las cachés previas.
- `docs/manual-de-usuario.md`: sección **3** (pantalla principal):
  pestañas en una barra fija inferior (móvil y ordenador) con icono y
  color propio (Series verde, Películas rojo, Libros ocre); la activa con
  franja de su color y fondo claro; el scroll solo mueve el contenido.
- Los partials `ocio/*.html` **no se tocaron**: los estilos de pestañas
  viven en `css/styles.css` y el comportamiento en `js/app.js`, así que
  las tres secciones siguen funcionando sin cambios.

## Alternativas descartadas

- **Barra fija solo en móvil**: descartado — la issue pide explícitamente
  pestañas fijas también en dispositivos más anchos que móviles («mantener
  las pestañas fijas», «el scroll debe causar efecto únicamente sobre la
  lista»); la barra es fija en todos los anchos.
- **`position: sticky; bottom: 0` en el nav**: descartado — con `fixed` +
  hueco de `padding-bottom` el espacio reservado es explícito e
  independiente del flujo del documento; con `sticky` el pie de página
  empujaría la barra y el control del hueco quedaría acoplado al orden del
  DOM y al largo del contenido.
- **Tokens de color nuevos** (p. ej. `--tab-tv-color`, `--tab-movies-color`
  con hex nuevos): descartado — la paleta existente ya tiene los tres
  acentos (verde `--teal-reel`, rojo `--stamp`, ocre `--ochre-spine`)
  definidos para ambos temas; `--stamp` resuelve la diferenciación de
  Películas sin añadir variables ni duplicar valores en claro/oscuro.
- **z-index alto (60/70) para la barra**: descartado — taparía el drawer de
  ADR-038 y sus modales; 45 queda por debajo de modal (50), backdrop (55)
  y drawer (60) y por encima de los dropdowns (40).
- **Mantener la metáfora de «separador de fichero»** (pestaña activa
  «levantada» con `translateY`): descartado — el movimiento vertical no
  tiene sentido en una barra fija; se sustituye por fondo `--paper` +
  franja superior de 3px con el acento de la pestaña.
- **Hueco inferior fijo en px** para el contenido: descartado — un valor
  fijo duplicaría la altura de la barra en otro sitio y rompería en iOS;
  `calc(var(--tabs-bar-h) + env(safe-area-inset-bottom) + 1.5rem)`
  mantiene un único punto de ajuste.

## Consecuencias

### Positivas

- **Pestañas siempre visibles**: la navegación entre Series/Películas/
  Libros ya no requiere subir al principio; en móvil la barra inferior es
  además el patrón de navegación habitual de las apps nativas.
- **Tres colores distintos** (verde/rojo/ocre) en todos los dispositivos,
  sin tokens nuevos: Películas pasa de compartir el verde de Series al
  acento rojo `--stamp` ya existente en la paleta.
- **Scroll solo sobre el contenido**: el hueco se calcula con la misma
  variable `--tabs-bar-h` usada por la barra; cambiar la altura de la barra
  recalcula automáticamente el hueco y el toast.
- **Sin cambios en JS**: `js/app.js` intacto (selectores `.tab`,
  `data-panel`, `.is-active` preservados), riesgo de regresión en la lógica
  de pestañas prácticamente nulo.
- **iOS PWA contemplada**: `env(safe-area-inset-bottom)` en la barra, el
  hueco de contenido y el toast evita el solapamiento con el home
  indicator del iPhone.
- **Accesibilidad mejorada**: `aria-controls` añadido a cada pestaña
  (nuevo), manteniendo `role="tablist"`/`role="tab"`/`aria-selected`; los
  iconos SVG son `aria-hidden` y el nombre queda en un `<span>` de texto.
- **Responsividad verificada** según AGENTS.md (360/768/1280 px sin scroll
  horizontal): `flex: 1; min-width: 0` en las pestañas y unidades
  relativas (`rem`, `calc()`), sin `overflow-x: hidden` como parche.

### Negativas / Riesgos

- **Menos área vertical de lectura**: la barra fija consume 3.75rem (móvil)
  o 3rem (escritorio) del viewport; se mitiga con alturas compactas y
  tipografía reducida (0.72rem móvil / 0.85rem escritorio).
- **Nuevo escalón en la jerarquía z-index**: cualquier capa futura con
  z-index entre 40 y 50 deberá convivir con la barra; los dropdowns
  actuales (40) quedan por debajo de la barra, aunque al anclarse arriba
  no se solapan en la práctica.
- **Cambio de costumbre**: los usuarios que buscaban las pestañas en la
  cabecera deberán mirar abajo; se mitiga con el manual de usuario
  actualizado (sección 3).

### Neutras

- **PWA versionada a `20260812`**: `APP_VERSION`, `?v=` en `index.html` y
  `STATIC_ASSETS` del service worker invalidan las cachés previas.
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambios visibles al usuario): sección **3**.
- **ADRs previos no superados**: ADR-032 y ADR-038 describían las pestañas
  en la pantalla principal; su contenido sigue siendo válido salvo la
  ubicación de las pestañas, que ahora es la barra inferior.
- **Partial `ocio/*.html` sin tocar**: los estilos de pestañas viven en
  `css/styles.css` y la lógica en `js/app.js`; no hay duplicación que
  mantener por sección.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Eliminado** `nav.tabs` (estilo separadores de fichero) de la cabecera; **nuevo** `nav.tabs--bar` a nivel de body (tras `</main>`): `div.tabs[role="tablist"]` con 3 botones `.tab--tv`/`.tab--movies`/`.tab--books` (SVG inline `aria-hidden` + `<span>` nombre, `aria-controls` añadido, `data-panel`/`.is-active`/ids conservados); versionado `?v=20260812` |
| `css/styles.css` | Nueva sección «Barra de pestañas fija inferior»: `.tabs--bar` (`position: fixed; bottom: 0; z-index: 45`, `--ink-raised`, `border-top: 1px solid var(--paper-alpha-20)`, `padding-bottom: env(safe-area-inset-bottom)`); `--tabs-bar-h` 3.75rem / 3rem (≥769 px); `.tabs` interior alineado con `#app` (`max-width: 980px`); `.tab` sin estilo fichero (columna ≤768 px / fila ≥769 px, `flex: 1; min-width: 0`); `--tab-accent` por clase (`--teal-reel`/`--stamp`/`--ochre-spine`); activa con `--paper` + `box-shadow: inset 0 3px 0 var(--tab-accent)`; `.app` padding inferior `calc(var(--tabs-bar-h) + env(safe-area-inset-bottom, 0px) + 1.5rem)`; `.toast` sobre la barra (`calc(var(--tabs-bar-h) + env(safe-area-inset-bottom, 0px) + 1rem)`) |
| `docs/manual-de-usuario.md` | Sección 3 (pantalla principal): pestañas en barra fija inferior (móvil y ordenador) con icono y color propio (Series verde, Películas rojo, Libros ocre), franja de color en la activa y scroll solo del contenido |
| `js/config.js` | `APP_VERSION` de `20260811` a `20260812` |
| `service-worker.js` | `STATIC_ASSETS` con `?v=20260812` (styles, ocio.css, app.js, `ocio/*.html`) |
| `docs/adr-040-pestanas-barra-inferior.md` | **Nuevo**: este documento |

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79
