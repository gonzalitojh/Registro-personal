# ADR-078: Barra de pestañas uniforme para todas las secciones (issue #208)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #208 pide que **las pestañas de la sección de Recetas
(Recetas, Menú y Lista de la compra) se vean igual que las pestañas
de la sección de Ocio** y que, de hecho, **la estructura de
navegación (barra lateral, barra de búsqueda y perfil) y las pestañas
sean iguales en todas las secciones**, las actuales y las que se
añadan en el futuro, incluidas sus características de ser fijas. La
issue también reporta una **regresión: las pestañas vuelven a verse
en la pantalla de inicio de sesión**.

Estado previo (construido en ADR-076 y ADR-077):

- **Ocio** usa desde la issue #79 una barra de pestañas fija
  (`nav.tabs--bar` con botones `.tab` de icono + texto y color de
  acento): anclada al borde inferior en móvil (con margen seguro) y
  bajo la cabecera global en ≥768px; ocultable por usuario desde
  Ajustes (issue #97) y con auto-ocultado por scroll en sus listas
  (issue #137).
- **Recetas** (ADR-076, issue #64) usaba en cambio las **subtabs del
  perfil** (`.profile-subtabs` / `.profile-subtab`, píldoras) dentro
  de un `.recipes-view__header` sticky bajo la cabecera global
  (ADR-077), con `data-recipes-tab` y `aria-controls` como contrato
  con `js/recipes.js`. Las pestañas de Recetas eran ocultables en
  Ajustes (registradas en `SECTION_REGISTRY`) pero **no salían de la
  barra** al ocultarlas (solo el router normalizaba la ruta).
- **Regresión del login**: `js/app.js` (ruta de Ocio del `onRoute`)
  destapaba `#app` con un `classList.remove("hidden")`
  **incondicional** que la fusión de la rama
  `content/issue-64-seccion-recetas` re-introdujo; la issue #178 lo
  había hecho **condicional a `currentUser`**. Con esa línea, al
  cargar o recargar sin sesión con la ruta de Ocio (por defecto al
  abrir), `#app` quedaba visible y la barra de pestañas (que vive
  dentro de `#app`) aparecía sobre la pantalla de acceso hasta que
  Firebase resolvía la sesión y `ui.showAuthScreen()` volvía a
  ocultarla.

## Decisión

1. **Componente único de pestañas**: todas las secciones con pestañas
   usan la misma `nav.tabs--bar` (`.tabs` → `.tab` con icono + texto y
   `--tab-accent`). **Ocio** la conserva; **Recetas** sustituye
   `.recipes-view__header` + `.profile-subtabs` por esa misma barra,
   como primer hijo de `#recipes-view` (se oculta con la vista, igual
   que Ocio con `#app`). Se mantienen intactos `data-recipes-tab`
   (`recetas|menu|compra`) y `aria-controls`
   (`panel-recipes-tab|panel-menu-tab|panel-shopping-tab`): son el
   contrato con `js/recipes.js` (wiring en `setupRecipes` y toggle en
   `openRecipes`), que **no cambia**.
2. **Acentos**: `.tab--recipes` (ocre), `.tab--menu` (verde) y
   `.tab--shopping` (rojo) reutilizan la paleta existente
   (`--ochre-spine`, `--teal-reel`, `--stamp`) con sus overrides de
   negro puro (`[data-theme="black"] .tab--X.is-active` usa la
   variante `-dark`), mismo patrón que los acentos de Ocio
   (ADR-009/ADR-064/ADR-066).
3. **Huecos de barra**: `.recipes-view` reserva el espacio de la barra
   fija como `.app`: en móvil `padding-bottom` con
   `--tabs-bar-h` + margen seguro; en ≥768px `padding-top` acumula
   cabecera + barra. El ancho de la vista se alinea con `#app`
   (980px) para que contenido, cabecera y barra compartan columna.
4. **Visibilidad (Ajustes)**: `applyTabVisibility()` de `js/app.js`
   (issue #97) se extiende a `SECTION_REGISTRY.recetas.tabs`: los
   botones `.tab[data-recipes-tab="..."]` salen de la barra al
   ocultarse, igual que los de Ocio. No hace falta guard de pestaña
   activa: los cambios de visibilidad solo se disparan desde Ajustes
   y al (re)entrar en Recetas `openRecipes` re-renderiza con
   `normalizeTabKey` (primera visible si la pedida está oculta).
5. **Fix regresión login**: se elimina el `classList.remove("hidden")`
   incondicional de la ruta de Ocio en `js/app.js`; la única vía de
   destapar `#app` pasa a ser `ui.showApp()` tras el login (el remove
   condicional a `currentUser` de la issue #178 queda como único).
6. **Perfil: excepción confirmada**. El perfil conserva su cabecera
   propia con flecha de volver y pestañas en fila (decisión del
   usuario en la iteración de la issue #206, ADR-077): la barra
   `tabs--bar` no aplica allí. Sus `.profile-subtabs` se mantienen.

## Consecuencias

- **Positivas**: consistencia visual y de comportamiento entre Ocio y
  Recetas (barra fija, iconos, acentos, ocultación en Ajustes); una
  sola fuente de verdad para el componente (cualquier sección futura
  con pestañas reutiliza `tabs--bar`); la pantalla de acceso vuelve a
  estar limpia.
- **Neutras**: en Recetas la barra de pestañas no se auto-oculta por
  scroll (el auto-ocultado de la issue #137 queda acotado a las
  listas de Ocio, donde `activePanel()` es no nulo); la etiqueta
  «Lista de la compra» puede envolver a dos líneas en móvil (nunca se
  trunca, AGENTS.md).
- **Negativas**: ninguna conocida. El cambio es de estructura del
  mismo componente ya validado en los cuatro temas (mismo mecanismo
  de variables y overrides), sin colores ni superficies nuevas.

Related issue: #208