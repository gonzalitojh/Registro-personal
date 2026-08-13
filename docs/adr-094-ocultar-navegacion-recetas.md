# ADR-094: Auto-ocultado de cabecera y pestañas en la sección de Recetas (issue #256)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #256 (type: style) pide que, en la sección de **Recetas**, al
desplazarse **hacia abajo** se oculten las **pestañas** y la **barra
superior**, y aparezca un botón de **volver arriba**; al desplazarse
**hacia arriba**, reaparecen. El comportamiento ya existe en la sección
de **Ocio** (issue #137, ADR-060) y debe estar en **todas las
secciones de la web**; por ahora solo Ocio y Recetas.

Estado previo:

- **Ocio** (issue #137, ADR-060): `js/auto-hide-nav.js` oculta la
  cabecera global (`body.is-nav-hidden .app-header`) y la barra de
  pestañas (`body.is-nav-hidden .tabs--bar`) al bajar por las listas,
  y muestra el botón flotante «Volver arriba»
  (`body.is-back-to-top-visible .back-to-top`) cuando los filtros
  (`.library-controls` del panel activo) quedan fuera de vista. El
  CSS usa **selectores genéricos sobre `body`**, sin distinguir
  sección.
- **Recetas** tiene, desde ADR-078 (issue #208), su **propia
  `nav.tabs--bar`** como primer hijo de `#recipes-view`, con la misma
  clase que la de Ocio. `#recipes-view` es una vista de primer nivel
  **hermana de `profile-view` y fuera de `#app`** (issue #64,
  ADR-076); cuando está visible, **`#app` está oculta** (es el estado
  normal en Recetas).
- ADR-077 (issue #206) documentó que el auto-ocultado quedaba
  **restringido a las listas de Ocio** («en Recetas la cabecera es
  fija»); el manual de usuario (§3.2) decía lo mismo.
- **Por qué no funcionaba en Recetas**: el guard `activePanel()` solo
  resolvía `#app:not(.hidden) .panel:not(.hidden)`, que en Recetas es
  `null` (porque `#app` está oculta); además, `isInteracting()`
  devolvía `true` siempre que `#app` tuviese `.hidden` — condición
  **permanente** en la vista de Recetas —, así que la navegación
  nunca se ocultaba. El `MutationObserver` tampoco vigilaba
  `#recipes-view` ni sus secciones, y `updateBackToTop()` solo
  buscaba `.library-controls`.

La implementación está validada (QA PASS) y escaneada (seguridad
PASS, 0 hallazgos); el manual de usuario se actualizó en la misma
tarea (regla 3 de AGENTS.md, commits de docs de esta rama). Este ADR
documenta la decisión a posteriori, como los recientes (ADR-093).

Related issue: #256 — https://github.com/gonzalitojh/Registro-personal/issues/256

## Decisión

Extender **`js/auto-hide-nav.js`** (la única fuente de verdad del
auto-ocultado) para que resuelva también el panel activo de Recetas,
**sin tocar CSS**: los selectores de ocultación (`body.is-nav-hidden
.app-header`, `body.is-nav-hidden .tabs--bar`,
`body.is-back-to-top-visible .back-to-top`) son genéricos y la barra
de Recetas usa la misma clase `tabs--bar` (ADR-078), por lo que las
reglas existentes aplican automáticamente.

### 1. `activePanel()`: resolución en dos vistas

- Si `#app` está visible → panel de ocio activo
  (`#app .panel:not(.hidden)`), como hasta ahora.
- Si `#app` está oculta pero `#recipes-view` está visible → la
  **sección activa de Recetas** (`#recipes-view .recipes-view__body
  section:not(.hidden)`); las pestañas de Recetas son `<section>`
  hermanas dentro de `.recipes-view__body` y la activa es la única
  sin `.hidden`.
- En cualquier otro caso (pantalla de acceso, perfil/ajustes) →
  `null`: allí la ocultación por scroll no aplica.

### 2. `isInteracting()`: el guard de `#app` oculta desaparece

- Se **elimina** el bloqueo «`#app` oculta → interactuando». En
  Recetas `#app` oculta es el caso normal; basta el guard
  `!activePanel()` (que devuelve `null` en acceso y perfil/ajustes,
  y también cuando `#recipes-view` está oculta).
- **Nuevo guard** para los paneles de filtros de Recetas
  (`.recipes-filter__panel:not(.hidden)`,
  `.ingredients-filter__panel:not(.hidden)`): en móvil se anclan al
  viewport **bajo la cabecera** (`top: var(--header-h)`), así que
  ocultarla los dejaría descolgados — mismo patrón que los dropdowns
  de la cabecera.

### 3. `updateBackToTop()`: `CONTROLS_SELECTOR` unificado

- Nueva constante `CONTROLS_SELECTOR = ".library-controls,
  .recipes-toolbar, .ingredients-toolbar, .menu-toolbar,
  .shopping-toolbar"`: cubre los filtros de Ocio y las **barras de
  herramientas de las 4 pestañas de Recetas** (Recetas, Ingredientes,
  Menú y Compra).
- El botón «Volver arriba» sigue mostrándose solo si la navegación
  está oculta Y los controles del panel activo quedaron totalmente
  fuera de vista (`getBoundingClientRect().bottom <= 0`); si el panel
  no tiene controles, el botón no aparece.

### 4. `MutationObserver` ampliado

- Nuevos objetivos observados: `#recipes-view` (se oculta/muestra al
  entrar/salir de la sección), `.recipes-view__body section`
  (cambio de pestaña de Recetas), `.recipes-filter__panel` y
  `.ingredients-filter__panel` (apertura/cierre de filtros).

### 5. Manual de usuario (ya hecho en esta rama)

- §3: la cabecera «se oculta al bajar por las listas de Ocio **o de
  Recetas**» y la barra de pestañas de Recetas «se oculta al bajar
  por la lista como la de Ocio».
- §3.2: el auto-ocultado aplica también a Recetas (Recetas,
  Ingredientes, Menú o Compra); el botón «Volver arriba» aparece
  cuando quedan fuera los controles de la lista (filtros de Ocio o la
  barra de herramientas de la pestaña de Recetas activa); el perfil
  sigue con su cabecera propia (flecha de volver + pestañas en la
  misma fila).

## Alternativas descartadas

- **Módulo JS separado para Recetas** (p. ej.
  `js/auto-hide-nav-recetas.js`): descartado — duplicaría estado y
  lógica (umbrales, guards, botón) y rompería la única fuente de
  verdad de `auto-hide-nav.js`.
- **CSS específico por sección** (selectores
  `#recipes-view .tabs--bar`, etc.): descartado — innecesario: la
  unificación de ADR-078 (`tabs--bar` común) hace que los selectores
  genéricos de ADR-060 cubran ambas secciones sin cambios.
- **Extender la ocultación al perfil**: descartado — excepción
  confirmada en ADR-077: el perfil no muestra la cabecera global
  (tiene la suya propia con flecha de volver) y no hay listas largas
  con barra de búsqueda.

## Consecuencias

### Positivas

- **Consistencia Ocio/Recetas**: el comportamiento pedido por la
  issue (ocultar al bajar, reaparecer al subir, botón «Volver
  arriba») es idéntico en ambas secciones; la barra de pestañas de
  Recetas (ADR-078) se comporta como la de Ocio (ADR-060).
- **Una sola fuente de verdad**: todo el auto-ocultado sigue viviendo
  en `js/auto-hide-nav.js`; ninguna regla CSS nueva ni duplicación de
  lógica.
- **Guards por propósito, no por suposición**: `isInteracting()` ya no
  depende de la visibilidad de `#app` (que nada tiene que ver con la
  interacción en Recetas), y los paneles de filtros de Recetas nunca
  quedan descolgados al ocultar la cabecera en móvil.
- **Manual al día**: regla 3 de AGENTS.md cumplida en la misma tarea
  (§3 y §3.2), corrigiendo la contradicción previa («en Recetas se
  queda fija»).

### Neutras

- **El perfil queda excluido por diseño**: excepción confirmada de
  ADR-077 (cabecera propia con flecha de volver); no aplica el
  auto-ocultado.
- **ADR-060 y ADR-077/ADR-078 siguen vigentes como registro
  histórico**: documentaban el estado previo (auto-ocultado solo en
  Ocio); este ADR describe su evolución, no los modifica.
- **Con los paneles de filtros de Recetas abiertos la navegación
  permanece visible**: comportamiento deliberado (mismo criterio que
  los dropdowns de la cabecera).

### Negativas / Riesgos

- **Ninguna conocida.** Validado: QA PASS del flujo completo (scroll
  en las 4 pestañas de Recetas, botón «Volver arriba», filtros
  abiertos, entrada/salida de la sección) y seguridad PASS (0
  hallazgos; los cambios no interpolan datos de usuario). Los
  selectores CSS no cambiaron, por lo que no hay riesgo de regresión
  visual en Ocio ni en los cuatro modos de tema (ADR-009/ADR-064/
  ADR-066).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/auto-hide-nav.js` | **Modificado**: `activePanel()` resuelve también `#recipes-view .recipes-view__body section:not(.hidden)` cuando `#app` está oculta; `isInteracting()` elimina el bloqueo por `#app.hidden` (basta `!activePanel()`) y añade el guard de `.recipes-filter__panel`/`.ingredients-filter__panel`; `updateBackToTop()` usa `CONTROLS_SELECTOR` (`.library-controls` + las 4 barras de herramientas de Recetas); `MutationObserver` vigila `#recipes-view`, `.recipes-view__body section`, `.recipes-filter__panel`, `.ingredients-filter__panel` |
| `css/styles.css` | **Sin cambios**: los selectores de ocultación (ADR-060) son genéricos y la barra de Recetas usa la misma clase `tabs--bar` (ADR-078) |
| `docs/manual-de-usuario.md` | **Modificado**: §3 (la cabecera y la barra de pestañas se ocultan al bajar en Ocio **y en Recetas**) y §3.2 (auto-ocultado en las 4 pestañas de Recetas; botón «Volver arriba» con la barra de herramientas de la pestaña activa; el perfil conserva su cabecera propia) — regla 3 de AGENTS.md |
| `docs/adr-094-ocultar-navegacion-recetas.md` | **Nuevo**: este documento |

Related issue: #256 — https://github.com/gonzalitojh/Registro-personal/issues/256
