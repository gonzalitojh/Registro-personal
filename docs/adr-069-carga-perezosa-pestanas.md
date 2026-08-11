# ADR-069: Carga perezosa por pestaña e indicador de carga (issue #178)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #178 denuncia varios problemas de **carga de la página** en la
web (SPA estática con 4 pestañas de Ocio: Series, Películas, Libros y
Videojuegos):

1. En la **pantalla de inicio de sesión** se ven la barra de búsqueda,
   las pestañas y los filtros (flash que luego se oculta): el router
   destapaba `#app` sin comprobar la sesión.
2. Tras iniciar sesión, mientras cargan los datos, se ven **los filtros
   de las 4 pestañas juntos** (y al recargar, las pestañas superpuestas):
   `applyTabVisibility` hacía `classList.toggle("hidden", false)` sobre
   todos los paneles con pestaña visible, deshaciendo el trabajo de
   `activatePanel` (que solo muestra uno).
3. **No había indicador de carga**: entre «partial inyectado» y «primer
   snapshot de Firestore» el usuario veía filtros con la cuadrícula
   vacía.
4. Todo se cargaba a la vez: los 4 partials HTML (fetch en `init()`) y
   las 4 suscripciones Firestore se lanzaban simultáneamente al entrar,
   aunque el usuario solo va a mirar una pestaña.

Además, `SECTION_REGISTRY.ocio.tabs` (el registro central de pestañas,
issue #97) no incluía `videojuegos`, con lo que la pestaña de
Videojuegos no participaba en la lógica de visibilidad ni aparecía en
Ajustes.

## Decisión

Rediseñar la carga para que **cada pestaña sea independiente** y solo
cargue lo suyo al activarse por primera vez, con un indicador de carga
mientras llegan los datos:

1. **`#app` solo se muestra con sesión**: el `onRoute` del router
   activa la pestaña (estado interno) pero ya no destapa `#app` sin
   usuario; `ui.showApp()` la muestra al entrar (y `showAuthScreen()` la
   oculta al salir). Con esto desaparece el flash de la pantalla de
   login.
2. **`applyTabVisibility` solo oculta, nunca destapa**: para los
   paneles solo añade `hidden` cuando su pestaña está oculta (nunca lo
   quita); el panel visible lo controla en exclusiva `activatePanel`. Si
   la pestaña activa se oculta desde Ajustes, se cae a la primera
   visible (mismo guard de `activatePanel`). Se añade `videojuegos` a
   `SECTION_REGISTRY` y a `DEFAULT_SETTINGS.visibleTabs` para que las 4
   pestañas participen por igual (los ajustes antiguos se sanean solos
   vía `sanitizeVisibility`: las claves ausentes quedan visibles).
3. **Lazy loading de los partials** (`loadOcioPartial`): el HTML de una
   pestaña (`ocio/*.html`) se descarga solo la primera vez que se
   activa (caché en `loadedPartials`); los controles del partial
   (filtros, orden, vista) se wirean al inyectarlo (`wirePanelControls`),
   sustituyendo al `querySelectorAll` global que solo cubría partials ya
   inyectados. `renderLibraryFor` hace *early return* si la cuadrícula
   aún no existe y repinta al terminar la carga si el snapshot ya llegó.
4. **Lazy loading de las suscripciones Firestore**: las 4
   suscripciones se refactorizan en `subscribeGroup` (config en
   `GROUP_CONFIG`) y se arrancan con `ensureGroupSubscribed` solo para
   el grupo de la pestaña activa (en `activatePanel` cuando hay sesión y
   tras el login en `watchAuthState`). Se mantiene `subscribeWithRetry`
   (issue #147).
5. **Indicador de carga**: nuevo componente `.panel-loading` + `.spinner`
   (CSS con variables de tema `--ink-soft`/`--ink-alpha-15`, contrastes
   AA en los 4 modos y cubierto por el `prefers-reduced-motion` global),
   `role="status"` para accesibilidad. Cada panel arranca con él en
   `index.html`; `loadOcioPartial` lo antepone al inyectar el partial y
   `renderLibraryFor` lo retira al pintar datos (o el estado vacío). Al
   cerrar sesión se restaura en los paneles ya cargados para que
   reaparezca al volver a entrar.
6. **La comprobación diaria deja de depender del estado en memoria**:
   `checkForUpdates` lee los datos con `getItemsOnce` (lectura puntual
   de Firestore) en lugar de `getItemsByGroup`, de modo que ya no exige
   que las 4 pestañas estén cargadas; `maybeTriggerDailyCheck` se llama
   una vez por sesión tras el login. Lo mismo aplica a la exportación
   ICS (`export-ics.js`).
7. **Defensa en profundidad contra duplicados**: los checks de «ya
   añadido» (alta desde la búsqueda global, recomendaciones/sagas en el
   modal) usan el nuevo `ctx.getGroupItemsResolved(group)`, que devuelve
   el estado en memoria si el grupo ya tiene snapshot y cae a
   `getItemsOnce` si no — así una pestaña no visitada no se trata como
   vacía al añadir.

El perfil (estadísticas, amigos, actividad, ajustes) ya era perezoso
(issue anterior) y no se modifica.

## Consecuencias

**Positivas**:

- La pantalla de login queda limpia (sin búsqueda, pestañas ni filtros).
- Solo la pestaña activa muestra contenido y su indicador «Cargando…»
  mientras llegan los datos; al recargar no hay superposición.
- Menos carga inicial: 1 partial + 1 suscripción al entrar en lugar de
  4 + 4. El resto se solicita al activar cada pestaña.
- La pestaña de Videojuegos entra en la lógica de visibilidad de Ajustes
  (issue #97) de forma coherente con las otras tres.

**Negativas / a vigilar**:

- La comprobación diaria y la exportación ICS hacen una lectura extra de
  Firestore por grupo (coste de lecturas algo mayor, despreciable frente
  a las peticiones de API que ya hace la pasada diaria).
- Los checks de duplicados del dropdown de búsqueda global siguen
  leyendo memoria para el render del botón (pueden mostrar «Añadir» en
  un ítem ya añadido hasta visitar la pestaña); el alta real está
  protegido por `getGroupItemsResolved` en `handleAdd`/`handleAddSeen`.

## Issues relacionadas

- Related issue: #178 (carga de página)
- Se apoya en: #59 (router), #97 (visibilidad de secciones/pestañas),
  #147 (retry de suscripciones), #145 (flujo SDD)