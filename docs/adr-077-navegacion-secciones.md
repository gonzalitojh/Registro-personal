# ADR-077: Navegación por secciones — cabecera global y búsqueda acotada (issue #206)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #206 pide que **la navegación de la web se mantenga en todas
las secciones**: la barra lateral de navegación (hamburguesa), la barra
superior de búsqueda y el botón del perfil deben estar disponibles
tanto en Ocio como en Recetas y en el perfil. A cambio, se eliminan el
**botón hacia atrás** y el **título de la sección** que hoy encabezan
las vistas de Perfil y Recetas, y la **búsqueda superior deja de ser
global**: busca únicamente **dentro de la sección activa**.

Estado previo (construido en ADR-051/ADR-059, ADR-064, ADR-066 y
ADR-076):

- La cabecera (`<header class="app-header">` con hamburguesa,
  búsqueda, campana y botón de perfil) vivía **dentro de `#app`**, la
  vista de Ocio; las vistas de primer nivel hermana (Perfil,
  Recetas) eran pantallas completas fuera de `#app` con su propia
  cabecera mínima: botón «volver» (flecha) + título (`<h1
  class="app-title">`), lo que obligaba a volver a Ocio para
  navegar.
- El buscador de la cabecera (`js/global-search.js`, ADR-022/ADR-082)
  buscaba **simultáneamente** en colección, catálogo externo y amigos,
  mostrando un toast «próximamente podrás ver su perfil» al pulsar un
  amigo.
- Las vistas de Perfil y Recetas no reservaban hueco superior para una
  cabecera fija (`.profile-view` y `.recipes-view` empezaban en el
  borde superior; la barra de pestañas de Ocio tampoco existe allí).

## Decisión

1. **Cabecera global**: el `header.app-header` se mueve **fuera de
   `#app`**, a nivel de `body`, con la clase `hidden` por defecto.
   `ui.showApp()` la muestra al iniciar sesión y `ui.showAuthScreen()`
   la oculta (nunca en la pantalla de acceso). El auto-ocultado por
   scroll (issue #137) queda **restringido a las listas de Ocio** (su
   guard `activePanel()` ya lo limitaba); en Perfil y Recetas la
   cabecera es fija.
2. **Vistas sin volver ni título**: se eliminan `#btn-close-profile`,
   `#btn-close-recipes` y los dos `<h1 class="app-title">`; la clase
   CSS `.app-title` (y su override móvil) desaparece por ser código
   muerto. Las subtabs de Recetas pasan de `margin-left: auto` a la
   izquierda (ya no hay título que empujarlas); en el perfil, el
   bloque `stats-period` conserva su `margin-left: auto`.
3. **Búsqueda por sección** (`js/global-search.js`): la sección activa
   se obtiene de `parseHash().section` (Ocio/Perfil/Recetas).
   - **Ocio**: colección (películas, series, libros, videojuegos) +
     catálogo externo con los botones de tipo (Serie/Película/Libro/
     Videojuego). **Los amigos ya no aparecen** en Ocio.
   - **Perfil**: solo amigos (por nombre o correo); pulsar un amigo
     **navega a su registro** (`navigate({ section: "perfil",
     profileSection: "friends", uid })`, la misma ruta que usa la
     lista de amigos), sustituyendo al antiguo toast.
   - **Recetas**: solo recetas (filtro local `searchRecipes()` de
     `recipes.js`, reutiliza el filtro de nombre/ingrediente/etiqueta
     de la pestaña); pulsar un resultado **abre el modal de la receta
     en modo solo lectura** (`openRecipeModal(recipe, { readOnly:
     true })`).
   - Los botones de tipo y las secciones del catálogo solo se
     renderizan en Ocio; el hint del dropdown y el placeholder de la
     barra se adaptan a la sección (`ui.setSearchSection()` se llama
     desde el `onRoute` de `app.js`).
4. **Foco tras abrir una receta**: al abrir el modal de receta desde el
   dropdown se reenfoca el input de búsqueda con un flag de un solo
   uso (`suppressReopenOnFocus`) que el propio `focus` event consume,
   para que al cerrar el modal el dropdown no se reabra solo.
5. **Ajustes CSS**: `padding-top: calc(var(--header-h) + 1rem)` en
   `.profile-view` y `.recipes-view` (hueco para la cabecera fija
   global, mismo patrón que `.app`); el header pegajoso de Recetas
   pasa de `top: 0` a `top: var(--header-h)` para quedar bajo la
   cabecera global.

## Consecuencias

- **Positivas**: la navegación (barra lateral, búsqueda, perfil) está
  disponible en todas las secciones; desaparece el paso obligado por
  Ocio para cambiar de sección; la búsqueda superior gana foco al
  acotarse a la sección; los amigos por fin son accesibles desde la
  búsqueda.
- **Neutras**: la búsqueda de la cabecera en Recetas convive con el
  buscador interno de la pestaña (filtro en vivo); el de la cabecera
  abre el modal en lectura. Ambos se mantienen por tener interacciones
  distintas.
- **Negativas**: los amigos ya no son buscables desde Ocio (comporta­
  miento intencional de la issue: «solo buscaría dentro de la sección»).
- El `task file` de la issue y los criterios de responsividad
  (AGENTS.md) se respetan: sin scroll horizontal a 360/768/1280 px y
  contraste verificable en los cuatro temas (la cabecera usa las
  variables de tema existentes, sin colores nuevos).

Related issue: #206
