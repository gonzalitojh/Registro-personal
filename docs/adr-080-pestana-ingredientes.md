# ADR-080: Pestaña propia de Ingredientes, extraída de la pestaña de Recetas (issue #209)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #209 pide **sacar el catálogo de ingredientes de la pestaña
«Recetas»** (donde convivía con la lista de recetas, un toggle
«Ingredientes» y una barra de búsqueda local) y **darle una pestaña
propia** en la barra de pestañas de la sección de Recetas. La pestaña
«Recetas» debe quedar **únicamente con el botón «+ Nueva receta»**: sin
barra de búsqueda local, sin toggle y sin catálogo. La búsqueda de
recetas pasa a vivir solo en la búsqueda global de la cabecera (issue
#206).

Estado previo (construido en ADR-076, ADR-077 y ADR-078):

- La sección de Recetas tiene desde la issue #208 una barra de pestañas
  uniforme `tabs--bar` (mismo componente que Ocio): pestañas
  Recetas/Menú/Lista de la compra con acentos ocre/verde/rojo,
  ocultables desde Ajustes (issue #97, `SECTION_REGISTRY` en
  `js/settings.js` y `applyTabVisibility` en `js/app.js`).
- En la pestaña «Recetas» (`panel-recipes-tab`) convivían: el input de
  búsqueda local `#recipes-search-input` (que alimentaba `activeFilter`
  en `js/recipes.js`), el toggle «Ingredientes»
  (`#btn-toggle-ingredients`, estado `showingIngredients`) que
  mostraba/ocultaba el catálogo `#ingredients-catalog`, y el botón
  «+ Nueva receta». El catálogo lo renderiza `js/recipes.js`
  (`renderIngredientsCatalog`) y permite asignar categorías
  (`ctx.updateIngredientCategory`); además muestra en qué recetas se usa
  cada ingrediente.
- La búsqueda global de cabecera (issue #206) usa
  `searchRecipes`/`filterRecipes` y es independiente del input local de
  la pestaña.

## Decisión

1. **Nueva pestaña «Ingredientes»** en la barra de Recetas, entre
   «Recetas» y «Menú»: botón `.tab--ingredients` con
   `data-recipes-tab="ingredientes"`, `aria-controls="panel-ingredients-tab"`
   e icono de hoja. Su panel es una nueva
   `<section id="panel-ingredients-tab" class="hidden">` que contiene el
   `#ingredients-catalog` (sin la clase `hidden`: la visibilidad la
   controla el toggle de paneles de `openRecipes`, igual que Menú y
   Lista de la compra).
2. **Pestaña «Recetas» limpia**: se eliminan el input de búsqueda local,
   el toggle «Ingredientes» y el catálogo; queda el botón
   «+ Nueva receta» (se conserva `#recipe-ingredients-datalist`, que usa
   el modal de receta). En `js/recipes.js` se eliminan `activeFilter`,
   `showingIngredients`, `toggleIngredientsCatalog` y los listeners del
   input y del toggle. `renderRecipesList` deja de filtrar por
   `activeFilter` (muestra todas las recetas); `searchRecipes` y
   `filterRecipes` **se conservan intactos** para la búsqueda global.
3. **Render por pestaña activa**: `openRecipes` rastrea la pestaña
   activa en `currentTab` y renderiza el catálogo al abrir
   `tab === "ingredientes"`; las suscripciones en tiempo real de recetas
   e ingredientes re-renderizan el catálogo solo si la pestaña está
   visible (`currentTab === "ingredientes"`), para que «Usada en: …»
   y las categorías estén siempre al día sin trabajo innecesario.
   `resetRecipesData` resetea `currentTab` (el toggle de paneles de
   `openRecipes` ya garantiza que el panel quede oculto).
4. **Router**: `RECIPES_TAB_TO_PANEL` gana
   `ingredientes: "panel-ingredients-tab"`, con lo que `#/recetas/ingredientes`
   funciona igual que las demás pestañas (canónico, memoria de última
   pestaña, atrás/adelante).
5. **Ajustes (issue #97)**: `visibleTabs` por defecto gana
   `ingredientes: true` y `SECTION_REGISTRY.recetas.tabs` la entrada
   `ingredientes: { label: "Ingredientes", panelId: "panel-ingredients-tab" }`.
   `applyTabVisibility` y `normalizeTabKey` la tratan automáticamente al
   derivar de `SECTION_REGISTRY`: ocultable en Ajustes y normalización de
   la pestaña activa si se oculta (misma mecánica que el resto).
6. **Acento violeta**: `.tab--ingredients` usa `--tab-accent: var(--games)`
   (el único acento libre de la paleta, el de Videojuegos) con el
   override de negro puro `[data-theme="black"] .tab--ingredients.is-active`
   con `--games-dark`, mismo patrón que `.tab--games` (ADR-009/064/066).
   Se elimina el CSS muerto de `.recipes-search-input` y
   `.recipes-toolbar__actions`.
7. **Manual de usuario y PWA**: se actualiza el manual (secciones 3,
   3.2, 8, 8.1, nueva 8.5 y 16) y se hace bump de versión de la PWA
   (20260909 → 20260910) para refrescar la caché.

## Consecuencias

- **Positivas**: la pestaña «Recetas» queda limpia (solo «+ Nueva
  receta»); el catálogo de ingredientes gana presencia y URL propia
  (`#/recetas/ingredientes`); la búsqueda de recetas tiene una única
  vía (la cabecera global), sin el input local que se mantenía por
  costumbre (issue #206); sin estado `showingIngredients` que mantener,
  el render del catálogo queda ligado a la pestaña visible.
- **Neutras**: el catálogo se renderiza al abrir la pestaña (y se
  actualiza en vivo solo si está visible); los usuarios que ocultaban
  la pestaña guardada en `localStorage` siguen con ella oculta por
  defecto hasta que la activen (tolerancia de `sanitizeVisibility`).
- **Negativas**: ninguna conocida. El cambio reutiliza el componente de
  pestañas y los mecanismos de visibilidad ya validados en los cuatro
  temas; el único color nuevo es el acento violeta, ya usado por
  Videojuegos con sus overrides de negro puro verificados.

Related issue: #209
