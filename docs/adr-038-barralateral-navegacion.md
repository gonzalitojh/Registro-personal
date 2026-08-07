# ADR-038: Barra lateral de navegación y cabecera estilo Gmail (issue #46)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

La web es **vanilla JS sin framework** (index.html + css/styles.css +
ocio/*.html + js/*.js) y hasta ahora su cabecera era: un `<h1 class="app-title">
Mi Registro</h1>`, el emoji 🔔 como campana de notificaciones y una lupa 🔍
(`#btn-global-search`) que abría el **buscador global en modal** (overlay
centrado con backdrop, documentado en ADR-013).

La issue #46 pide **preparar la navegación para futuras secciones** (series,
películas y libros como secciones propias) con:

- Una **barra lateral tipo Gmail** que se despliegue con un botón
  hamburguesa y que de momento contenga una única entrada: **«Ocio»** (la
  web actual, con sus tres pestañas Series/Películas/Libros).
- Una **cabecera de una sola barra de búsqueda**: el botón 🔍 (que abría el
  buscador global) se sustituye por la propia barra, y el **modal de
  búsqueda global se elimina** (la función de búsqueda global se mantiene en
  la nueva barra: Ctrl+K / Cmd+K / «/» siguen funcionando).
- La campana pasa a ser un **icono plano SVG** (no el emoji 🔔 3D).
- El título **«Mi Registro» se quita de la pantalla principal** y se muestra
  como texto de la barra de búsqueda al entrar, cambiando a los pocos
  segundos al placeholder por defecto.

Related issue: #46 — https://github.com/gonzalitojh/Registro-personal/issues/46

**Nota histórica**: este ADR documenta la sustitución del buscador global en
modal del ADR-013 (botón lupa + overlay `#global-search`) por una barra de
búsqueda en la cabecera con dropdown de resultados.

## Decisión

Nueva **barra lateral (drawer) fija a la izquierda** que se abre con un botón
hamburguesa de la cabecera, y **cabecera de una sola barra de búsqueda**
estilo Gmail. La búsqueda global deja de ser un modal y pasa a ser un
**dropdown anclado bajo la barra** con el patrón del dropdown de
notificaciones.

### 1. Drawer lateral `js/sidebar.js` (nuevo módulo)

- **Drawer fijo**: `aside#app-sidebar` con `position: fixed; left: 0` y ancho
  `min(300px, 85vw)`; sale de pantalla con `translateX(-100%)` +
  `visibility: hidden` y entra con transición de 0.25 s. El backdrop
  (`#app-sidebar-backdrop`) usa `z-index: 55` y el drawer `z-index: 60`.
- **Entradas desde un array exportado**: `SECTIONS` (`js/sidebar.js`,
  exportado) contiene `{ id, label, icon, onClick }`; el `nav` del drawer se
  renderiza a partir de él, con la entrada **«Ocio»** marcada `is-active`.
  Para añadir una sección futura (series, películas, libros) solo hay que
  añadir una entrada al array, sin tocar el resto del módulo.
- **Apertura**: botón hamburguesa `#btn-sidebar-toggle` con
  `aria-expanded`/`aria-controls`. Al abrir se actualiza `aria-hidden` del
  drawer y se activa el **focus trap** (`trapFocus` de `focus-utils.js`, el
  mismo helper del resto de paneles); al cerrar se ejecuta su cleanup y el
  foco vuelve a la hamburguesa.
- **Cierre** por cualquiera de estas vías: tecla **Esc** (listener único
  registrado una vez, sin leaks al abrir/cerrar repetidamente), **clic en el
  backdrop**, botón **✕** (`#btn-sidebar-close`) o **pulsar una entrada**.
- **Acción de «Ocio»**: cierra el drawer y hace **scroll suave al top** de la
  página; con `prefers-reduced-motion: reduce` el scroll es instantáneo.
- **Mutua exclusión con el buscador**: al abrir el drawer se llama a
  `closeGlobalSearch()` de `js/global-search.js` (import cruzado): si el
  dropdown de resultados estuviera abierto, el backdrop del drawer
  (z-index 55) lo taparía (z-index 40). A la inversa, al abrir la búsqueda
  con el drawer abierto, se cierra el drawer primero (ver punto 3).

### 2. Cabecera estilo Gmail (`index.html` + `css/styles.css`)

De izquierda a derecha:

1. **Botón hamburguesa** (`#btn-sidebar-toggle`) con icono SVG inline.
2. **Barra de búsqueda global**: `.search-bar-wrap` con `flex: 1;
   min-width: 0` (reglas de responsividad de AGENTS.md), que contiene el
   input `#global-search-input`, el botón ✕ `#global-search-clear` y el
   contenedor del dropdown `#global-search-results`.
3. **user-badge** a la derecha: **campana SVG plana** (trazo `currentColor`,
   sustituye al emoji 🔔 3D), ⚙️ engranaje, ☀️/🌙 tema y avatar.

**Eliminados**:

- `<h1 class="app-title">Mi Registro</h1>` de la cabecera: el título pasa a
  ser el **placeholder animado** de la barra de búsqueda — al entrar se
  muestra «Mi Registro» y a los **3.5 s** pasa al placeholder por defecto
  «Buscar películas, series, libros o amigos...». La secuencia vive en
  `js/ui.js` (`showApp`/`showAuthScreen`, constantes
  `DEFAULT_SEARCH_PLACEHOLDER`, `SEARCH_BRAND_PLACEHOLDER`,
  `SEARCH_PLACEHOLDER_SWITCH_MS`) y el **timer se limpia en el logout**
  (`showAuthScreen`) para que la sesión siguiente empiece de nuevo.
- El botón `#btn-global-search` (🔍).
- El **modal del buscador global** (`#global-search` con backdrop y panel
  `role="dialog" aria-modal="true"`).

### 3. `js/global-search.js`: de modal a dropdown anclado

Refactor del módulo sin cambiar la función de búsqueda:

- El dropdown `#global-search-results` se ancla bajo la barra
  (`position: absolute; top: calc(100% + 8px); left/right: 0; z-index: 40`)
  y usa la superficie de papel (`--paper`/`--ink`) válida en ambos temas
  (sin overrides de modo claro). `max-height: min(60vh, 480px)` con scroll
  vertical.
- **Sin `trapFocus`**: a diferencia del modal anterior, el dropdown sigue el
  patrón del dropdown de notificaciones (abrir/cerrar, cierre con Escape y
  clic fuera): atrapar el foco en un panel no modal rompería la navegación
  con Tab del documento, que es la metáfora de una barra tipo Gmail.
- **Apertura**: con `focus` o `click` en el input (el click cubre volver a
  pulsar una barra ya enfocada) y con los **atajos Ctrl+K / Cmd+K y «/»**
  (que se mantienen; «/» solo actúa si no hay un input enfocado).
- **Cierre**: tecla **Esc** — dentro del input con `stopPropagation()` solo
  si el dropdown está abierto (si está cerrado, el Escape debe propagar al
  handler global de `modal-handlers.js`, p. ej. para cerrar un modal de
  ítem); con el foco fuera del input, un keydown de documento lo cierra si
  está abierto; **clic fuera** de `.search-bar-wrap`; y el botón **✕**
  (`#global-search-clear`) que además **borra lo escrito** y devuelve el
  foco al input.
- **Resultados**: agrupados (🎬 Películas, 📺 Series, 📚 Libros, 👤 Amigos)
  con límites **5/5/5/3**, mínimo 2 caracteres para buscar y **navegación
  por teclado** (ArrowDown/ArrowUp con highlight, Enter activa, también
  click y Enter/Space en cada resultado).
- **Navegación**: `navigateTo` → `openItem(item, searchCtx)` de
  `modal-handlers.js` con un pequeño delay (150 ms) para que el cierre del
  dropdown no interfiera; pulsar un amigo muestra el toast «Próximamente
  podrás ver el perfil...».
- **Mutua exclusión con el drawer**: `openGlobalSearch()` comprueba si
  `#app-sidebar` está abierto y, en ese caso, dispara el click de la
  hamburguesa para cerrarlo (su backdrop de z-index 55 taparía el dropdown
  de z-index 40).

### 4. `js/modal-handlers.js`: Escape global sin el modal eliminado

El keydown global de Escape elimina la rama de la búsqueda global (el
elemento `#global-search` ya no existe). La prioridad queda:
**ventana de valoración > modal de ítem > dropdown de notificaciones**. El
dropdown de búsqueda gestiona su propio Escape (con `stopPropagation` solo
cuando está abierto), así que nunca llega a este handler.

### 5. Responsive (reglas de AGENTS.md)

- **Cabecera en 2 filas ≤480 px**: fila 1 = hamburguesa + barra de búsqueda
  (`flex: 1`); fila 2 = iconos y avatar alineados a la derecha
  (`.user-badge` con `flex-basis: 100%` y `justify-content: flex-end`).
  Verificado a 360 px sin desborde horizontal.
- **Dropdown `fixed` ≤600 px**: mismo patrón que `.notif-dropdown`
  (`left/right: 1rem; top: 4.5rem; width: auto`) para que el panel nunca se
  salga del ancho visible; en móvil los títulos/metadatos envuelven a 2
  líneas (clamp) en lugar de ellipsis.
- **Drawer** `min(300px, 85vw)`, `overflow-y: auto` y `z-index` escalonados
  (drawer 60 > backdrop 55 > dropdown 40).
- Unidades relativas y `min-width: 0` en los hijos flex (`search-bar-wrap`,
  `.global-search__item-info`), sin `overflow-x: hidden` en `body` como
  parche.

### 6. PWA

- `APP_VERSION` en `js/config.js` sube de `20260809` a **`20260810`** y
  `scripts/bump-version.sh` sincroniza los `?v=20260810` de `index.html` y
  `service-worker.js` (invalidación de cachés PWA).
- `js/sidebar.js` se añade a `STATIC_ASSETS` del service worker.

## Alternativas descartadas

- **Mantener el modal del buscador global** (botón 🔍 + overlay centrado):
  descartado — la issue pide explícitamente eliminar la búsqueda general en
  todas las colecciones (el modal) y dejar **una sola barra de búsqueda** en
  la cabecera.
- **Barra lateral persistente en desktop (estilo Gmail)**: descartado — la
  issue pide un **botón que despliega** la barra lateral (drawer), no una
  columna siempre visible.
- **Integrar el drawer en `app.js`**: descartado — por la convención del
  repo de módulos con `setup*`, se creó el módulo `js/sidebar.js` con
  `setupSidebar()`, registrado en `app.js` como el resto.
- **Campana con fuente de iconos externa**: descartado — el icono se
  incluye como **SVG inline** (trazo `currentColor`), sin dependencias
  nuevas ni peticiones extra (coherente con el icono de la hamburguesa).

## Consecuencias

### Positivas

- **Navegación preparada para el futuro**: `SECTIONS` permite añadir
  secciones propias (series, películas, libros) sin reescribir el módulo del
  drawer.
- **Cabecera limpia tipo Gmail**: una sola barra de búsqueda central
  sustituye al botón 🔍; el título «Mi Registro» se recupera como
  placeholder animado sin ocupar sitio permanente.
- **Metáfora coherente**: la búsqueda global es ahora un dropdown anclado a
  la barra (patrón del dropdown de notificaciones), no un modal; los atajos
  Ctrl+K / Cmd+K y «/» se mantienen.
- **Accesibilidad**: `aria-expanded`/`aria-hidden`/`aria-controls` en la
  hamburguesa y el drawer, focus trap con cleanup, foco restaurado a la
  hamburguesa al cerrar, y `prefers-reduced-motion` respetado en el scroll.
- **Sin dependencias nuevas**: iconos SVG inline (hamburguesa y campana) y
  estilos con variables CSS existentes.
- **Responsividad verificada** según AGENTS.md (360/768/1280 sin scroll
  horizontal, unidades relativas, `min-width: 0`).

### Negativas / Riesgos

- **Cambio de metáfora para el usuario habitual del buscador**: la búsqueda
  global ya no es una ventana centrada; el dropdown anclado es menos
  «modal» y depende de la barra de la cabecera. Se mitiga con la
  descubribilidad de la barra central y los atajos de teclado mantenidos.
- **Solapamiento de z-index gestionado por exclusión mutua**: drawer y
  dropdown nunca están abiertos a la vez; si en el futuro se cambiaran los
  z-index habrá que revisar ese acoplamiento cruzado (import de
  `closeGlobalSearch` en `sidebar.js` y cierre del drawer en
  `global-search.js`).
- **Escape condicional**: el `stopPropagation` del Escape solo actúa con el
  dropdown abierto; es un comportamiento sutil pero necesario para no romper
  la cadena de cierre de `modal-handlers.js`.

### Neutras

- **PWA versionada a `20260810`**: `APP_VERSION`, `?v=` en `index.html` y
  `service-worker.js` invalidan las cachés previas; `js/sidebar.js` entra en
  `STATIC_ASSETS`.
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambios visibles al usuario): secciones **3** (pantalla principal:
  hamburguesa, barra lateral con «Ocio», barra de búsqueda con placeholder
  animado, campana), **7.3** (búsqueda global: panel desplegable, cierre con
  Esc/clic fuera/✕), **12** (notificaciones: campana) y **15** (cuándo se
  actualizan los datos). Eliminadas las menciones a la lupa 🔍 y al modal.
- **El título «Mi Registro» permanece** en la tarjeta de acceso
  (`#auth-screen`) y como título del drawer, además de como placeholder
  animado.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/sidebar.js` | **Nuevo**: drawer lateral con array `SECTIONS` exportado (entrada «Ocio»), `setupSidebar()`, apertura/cierre (Escape con listener único, backdrop, ✕, entrada), focus trap, `aria-expanded`/`aria-hidden`, scroll suave con `prefers-reduced-motion`, `closeGlobalSearch()` al abrir |
| `index.html` | `aside#app-sidebar` + `#app-sidebar-backdrop`; cabecera: `#btn-sidebar-toggle`, `.search-bar-wrap` con `#global-search-input`/`#global-search-clear`/`#global-search-results`, campana SVG plana; **eliminados** `<h1 class="app-title">Mi Registro</h1>` de la cabecera, `#btn-global-search` (🔍) y el modal `#global-search`; versionado `?v=20260810` |
| `css/styles.css` | `.app-sidebar*` (drawer `min(300px, 85vw)`, z-index 60) y `.app-sidebar-backdrop` (z-index 55); `.search-bar-wrap` (`flex: 1; min-width: 0`); `.icon-btn svg`; refactor `.global-search__*` (input en la cabecera, dropdown anclado z-index 40, ✕, grupos, estados sobre papel); media queries: cabecera 2 filas ≤480 px y dropdown `fixed` ≤600 px (patrón `.notif-dropdown`); eliminados los estilos del modal y sus overrides de modo claro |
| `js/global-search.js` | Refactor de modal a **dropdown anclado** (sin `trapFocus`): apertura con focus/click/atajos, cierre con Escape (con `stopPropagation` solo si abierto), clic fuera y ✕; resultados agrupados 5/5/5/3; navegación por teclado; `navigateTo` → `openItem`/toast de amigo; cierre del drawer si está abierto al abrir la búsqueda |
| `js/ui.js` | Placeholder animado de la barra («Mi Registro» → por defecto a los 3.5 s) en `showApp` con timer limpiado en `showAuthScreen` (logout); constantes `DEFAULT_SEARCH_PLACEHOLDER`/`SEARCH_BRAND_PLACEHOLDER`/`SEARCH_PLACEHOLDER_SWITCH_MS` |
| `js/modal-handlers.js` | Escape global sin referencia al modal eliminado; prioridad: valoración > modal de ítem > notificaciones |
| `js/app.js` | Import de `setupSidebar` y llamada en `init()` |
| `js/config.js` | `APP_VERSION` de `20260809` a `20260810` |
| `service-worker.js` | `js/sidebar.js` añadido a `STATIC_ASSETS`; `?v=20260810` |
| `docs/manual-de-usuario.md` | Secciones 3 (pantalla principal), 7.3 (búsqueda global), 12 (notificaciones) y 15 (actualización de datos): hamburguesa + barra lateral con «Ocio», barra de búsqueda con placeholder animado, panel desplegable de resultados, cierre con Esc/clic fuera/✕; eliminadas las menciones a la lupa 🔍 y al modal |
| `docs/adr-038-barralateral-navegacion.md` | **Nuevo**: este documento |

Related issue: #46 — https://github.com/gonzalitojh/Registro-personal/issues/46
