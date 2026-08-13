# ADR-093: Botón hamburguesa ☰ como cierre de la búsqueda global (issue #253)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #253 pide que, al pulsar la **barra de búsqueda global** de la
cabecera (en cualquier sección de la web), el **botón hamburguesa ☰**
(`#btn-sidebar-toggle`, que despliega la barra lateral de navegación)
se transforme en una **«X» con una animación** que, al pulsarse,
**cierre la búsqueda**.

Estado previo:

- La búsqueda global (`js/global-search.js`) es un dropdown anclado a
  la barra de la cabecera con estado `isOpen` module-level. Se abre al
  hacer focus/click en el input, con `Ctrl+K`/`Cmd+K` o con `/`, y se
  cierra (único punto de salida `closeGlobalSearch()`) con `Esc`, clic
  fuera, la ✕ interna `#global-search-clear`, `Ctrl+K`, al navegar a un
  resultado o al abrir la barra lateral (`openSidebar()` de
  `js/sidebar.js`). Al cerrar NO se limpia el texto ni se mueve el
  foco (patrón Gmail).
- El botón hamburguesa vive en la cabecera de `index.html`, tiene un
  SVG con **tres `<line>`** (viewBox 24×24, y=6/12/18, x=3→21) y su
  handler en `js/sidebar.js` alterna `openSidebar()`/`closeSidebar()`.
- `openGlobalSearch()` marca `isOpen = true` y, si el drawer lateral
  está abierto, dispara `toggle.click()` para cerrarlo (su backdrop,
  z-index 55, taparía el dropdown, z-index 40). Eso hace crítico el
  **orden de comprobaciones** del handler del toggle.
- `js/sidebar.js` ya importa de `js/global-search.js` (import
  unidireccional, sin ciclos); `global-search.js` no puede importar de
  `sidebar.js`.
- `css/styles.css` anula globalmente animaciones y transiciones con
  `@media (prefers-reduced-motion: reduce)`; los iconos de cabecera
  usan `currentColor` vía `.icon-btn` (`var(--paper)`, con override a
  `var(--ink)` en Claro/Blanco puro).

## Decisión

1. **El estado de «modo ✕» vive en `js/global-search.js`** (única
   fuente de verdad): una clase `is-search-open` en el toggle y su
   `aria-label` dinámico («Cerrar búsqueda» / «Abrir menú de
   navegación»). `openGlobalSearch()` la añade (ANTES del
   `toggle.click()` interno, para que el icono quede en ✕ aunque se
   cierre un drawer abierto) y `closeGlobalSearch()` la retira. Como
   todo cierre pasa por `closeGlobalSearch()`, la restauración queda
   centralizada en un solo punto.
2. **Nuevo export `isGlobalSearchOpen()`** consultable por otros
   módulos sin romper el import unidireccional.
3. **Handler del toggle en `js/sidebar.js` con orden deliberado**:
   primero `sidebar.classList.contains("is-open")` → `closeSidebar()`;
   luego `isGlobalSearchOpen()` → `closeGlobalSearch()` (modo ✕); si
   no, `openSidebar()`. Este orden evita la regresión crítica: al
   abrir la búsqueda con el drawer abierto, `isOpen` ya vale `true`
   cuando llega el `toggle.click()` interno, así que el check del
   drawer debe ir primero para que ese click cierre la barra lateral
   (y no la búsqueda).
4. **Animación ☰ → ✕ en `css/styles.css`** transformando las tres
   `<line>` existentes del SVG (sin tocar el HTML):
   `transform-box: fill-box; transform-origin: center` sobre cada
   línea; la 1: `translateY(6px) rotate(45deg)`, la 2: `opacity: 0`,
   la 3: `translateY(-6px) rotate(-45deg)`, con transición de
   `transform 0.25s ease, opacity 0.25s ease`. Las líneas 1 y 3 rotan
   sobre su propio centro (12,6) y (12,18) y se trasladan 6px para
   cruzarse exactamente en (12,12) del viewBox, formando la ✕. Con
   `prefers-reduced-motion` el cambio es instantáneo (regla global ya
   existente). La ✕ hereda `currentColor` de `.icon-btn`: **sin
   overrides de tema** (correcta en Oscuro, Negro puro, Claro y Blanco
   puro).
5. **Manual de usuario** (sección 9.2): se documenta la nueva forma de
   cerrar el panel (la ☰ se convierte en ✕ mientras la búsqueda está
   abierta).

## Alternativas descartadas

- **CSS-only con `:focus-within` en `.search-bar-wrap`**: descartado —
  al navegar los resultados con teclado el foco sale del input pero el
  dropdown sigue abierto (la ✕ se revertiría), y el estado ya vive en
  JS (apertura por `Ctrl+K`/`/`), duplicando fuentes de verdad.
- **Dos botones (☰ y ✕) con show/hide**: descartado — más DOM, sin
  animación continua entre estados y peor accesibilidad que un único
  botón con `aria-label` dinámico.
- **Animar el `d` de un `<path>` o cruzar dos SVGs**: descartado —
  más complejo; transformar las tres `<line>` existentes con
  `transform-box: fill-box` es mínimo y perfectamente animable.

## Consecuencias

- **Positivas**: la búsqueda abierta se puede cerrar desde el extremo
  izquierdo de la cabecera, con realimentación visual animada y texto
  de accesibilidad dinámico (`aria-label`); un único punto de
  restauración (`closeGlobalSearch()`) cubre todos los caminos de
  cierre existentes (Esc, clic fuera, ✕ interna, Ctrl+K, navegar a un
  resultado); cero regresiones del drawer gracias al orden de
  comprobaciones; sin cambios de tema ni de responsividad (la ✕ tiene
  el tamaño del icono ☰ original, ~1.15rem).
- **Neutras**: con la búsqueda abierta el botón ya no abre el menú
  lateral (comportamiento deliberado de la issue); si el usuario
  pulsa de nuevo tras cerrar la búsqueda, el botón ya es ☰ y abre la
  barra lateral. Si solo hay una sección visible (issue #97) el toggle
  está oculto (sustituido por ⚙) y no se muestra la ✕: la búsqueda se
  sigue cerrando por las vías existentes.
- **Negativas**: ninguna conocida. Validado: sintaxis JS (`node
  --check`), animación verificada en Chromium headless (píxeles: ☰ en
  reposo y ✕ centrada en (12,12) con la clase puesta), simulación de
  los 6 flujos de interacción del toggle (abrir/cerrar drawer, abrir
  búsqueda con drawer abierto, cierre por ✕, por Esc, doble click) y
  escaneo de seguridad sin hallazgos (los cambios no interpolan datos
  de usuario; clase y aria-label son literales controlados).

Related issue: #253
