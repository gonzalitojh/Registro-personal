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
   `#app`**, a nivel de `body`, con la clase `hidden` por defecto y el
   **id `app-header`** (requisito del toggle de `ui.js`: sin él,
   `getElementById("app-header")` devuelve `null` y la cabecera
   permanece oculta en todas las páginas; regresión detectada en la
   iteración del 2026-08-11). `ui.showApp()` la muestra al iniciar
   sesión y `ui.showAuthScreen()` la oculta (nunca en la pantalla de
   acceso). El auto-ocultado por scroll (issue #137) queda
   **restringido a las listas de Ocio** (su guard `activePanel()` ya lo
   limitaba); en Recetas la cabecera es fija.
2. **Iteración 2026-08-11 (feedback de la issue): el perfil NO muestra
   la cabecera global.** El usuario prefiere en el perfil el patrón
   anterior: **flecha de volver (`#btn-close-profile`) y las pestañas
   (Estadísticas/Amigos/Actividad/Ajustes) en la misma fila**. Por
   tanto:
   - `#app-header` se oculta cuando `parseHash().section === "perfil"`
     (toggle en el `onRoute` de `app.js`; con sesión solo, porque la
     pantalla de acceso la oculta siempre). En Ocio y Recetas sigue
     visible.
   - Se restaura `#btn-close-profile` en `index.html` (icono flecha
     izquierda, patrón `.icon-btn` de ADR-061) con su handler en
     `js/profile.js`: cierra la vista y vuelve a la última pestaña de
     Ocio (normalizada a la primera visible, issue #97).
   - `.profile-view` recupera su padding superior simple (`1.5rem`):
     ya no hay cabecera fija que reservar hueco.
   - El guard de `openGlobalSearch()` en `js/global-search.js` evita
     que los atajos de teclado (Ctrl+K, "/") abran el dropdown de
     búsqueda en el perfil, donde la cabecera está oculta.
   - **La búsqueda de amigos desde la cabecera deja de estar
     disponible en el perfil** (la barra no existe allí); la sección
     «Amigos» del perfil sigue funcionando con su propia lista.
3. **Marcado de la sección activa en la barra lateral**: antes el
   marcado `.is-active` quedaba **fijo en «Ocio»** (`s.id === "ocio"`
   en `renderSidebar`), así que al navegar a Recetas o Ajustes el
   marcado no cambiaba. Ahora `js/sidebar.js` exporta
   `setActiveSection(sectionId)` (Ocio/Recetas/Ajustes o `null`), que
   el `onRoute` de `app.js` llama en cada cambio de ruta: en el perfil
   solo se marca «Ajustes» (entrada pinned) cuando se está en esa
   subsección; el resto del perfil no tiene entrada propia.
4. **Vistas sin volver ni título (Recetas)**: en **Recetas** se
   mantienen eliminados `#btn-close-recipes` y el `<h1
   class="app-title">`; la clase CSS `.app-title` (y su override móvil)
   desaparece por ser código muerto. Las subtabs de Recetas pasan de
   `margin-left: auto` a la izquierda (ya no hay título que empujarlas).
5. **Búsqueda por sección** (`js/global-search.js`): la sección activa
   se obtiene de `parseHash().section` (Ocio/Recetas; el perfil queda
   excluido en la iteración 2026-08-11 porque no muestra la cabecera).
   - **Ocio**: colección (películas, series, libros, videojuegos) +
     catálogo externo con los botones de tipo (Serie/Película/Libro/
     Videojuego). **Los amigos ya no aparecen** en Ocio.
   - **Recetas**: solo recetas (filtro local `searchRecipes()` de
     `recipes.js`, reutiliza el filtro de nombre/ingrediente/etiqueta
     de la pestaña); pulsar un resultado **abre el modal de la receta
     en modo solo lectura** (`openRecipeModal(recipe, { readOnly:
     true })`).
   - Los botones de tipo y las secciones del catálogo solo se
     renderizan en Ocio; el hint del dropdown y el placeholder de la
     barra se adaptan a la sección (`ui.setSearchSection()` se llama
     desde el `onRoute` de `app.js`).
6. **Foco tras abrir una receta**: al abrir el modal de receta desde el
   dropdown se reenfoca el input de búsqueda con un **contador de focus
   suprimidos** (`suppressFocusCount`, armado con 2): uno para el focus
   programático de la apertura y otro para el reenfoque que hace
   `closeRecipeModal` al cerrar el modal, de modo que el dropdown no se
   reabra solo en ninguno de los dos momentos y la barra recupere su
   comportamiento normal con el siguiente focus manual.
7. **Ajustes CSS**: `padding-top: calc(var(--header-h) + 1rem)` en
   `.recipes-view` (hueco para la cabecera fija global, mismo patrón
   que `.app`); el header pegajoso de Recetas pasa de `top: 0` a
   `top: var(--header-h)` para quedar bajo la cabecera global.
   `.profile-view` usa padding simple (ver punto 2).

## Consecuencias

- **Positivas**: la navegación (barra lateral, búsqueda, perfil) está
  disponible en Ocio y Recetas sin pasar por la pantalla anterior; la
  búsqueda superior gana foco al acotarse a la sección; el perfil
  recupera la cabecera ligera (flecha + pestañas) que pedía el usuario;
  el marcado de la barra lateral refleja la sección activa.
- **Neutras**: la búsqueda de la cabecera en Recetas convive con el
  buscador interno de la pestaña (filtro en vivo); el de la cabecera
  abre el modal en lectura. Ambos se mantienen por tener interacciones
  distintas.
- **Negativas**: los amigos ya no son buscables desde la búsqueda
  superior (dejaron de serlo desde Ocio en la primera iteración y desde
  el perfil en esta segunda, al ocultarse la cabecera allí); los atajos
  Ctrl+K / "/" no abren la búsqueda en el perfil (la cabecera no está).
- El `task file` de la issue y los criterios de responsividad
  (AGENTS.md) se respetan: sin scroll horizontal a 360/768/1280 px y
  contraste verificable en los cuatro temas (la cabecera usa las
  variables de tema existentes, sin colores nuevos).

Related issue: #206
