# ADR-067: Ocultar secciones y pestañas desde Ajustes (issue #97)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

La issue #97 pide poder **ocultar secciones** (y pestañas de cada
sección) desde **Ajustes**. Hoy existe una sola sección —«Ocio», con
las pestañas Series/Películas/Libros— pero el diseño debe ser
**extensible a secciones futuras**. Cuando solo queda **una sección
visible**, la barra lateral de navegación (drawer ☰) pierde sentido y
se sustituye por un **botón engranaje en la cabecera** que abre
Ajustes; al volver a haber más de una sección visible, la barra
lateral reaparece.

Criterios de aceptación clave: tarjeta «Secciones y pestañas» en
Ajustes con un interruptor por sección y por pestaña, generados desde
un registro central; ocultar una pestaña la retira de la barra de
pestañas y de la vista (la activa cae a la primera visible y las URLs
que apunten a una oculta se normalizan); guardas (no se puede ocultar
la última sección ni la última pestaña visible de una sección);
persistencia en localStorage (`mi-registro-settings`) y sincronización
con Firestore (preferences) con debounce; correcta visualización en
los cuatro modos de tema y sin scroll horizontal; manual de usuario
actualizado.

## Decisión

Registro central de secciones/pestañas en `js/settings.js`
(`SECTION_REGISTRY`) como **única fuente de verdad**: añadir una
sección futura solo requiere añadir una entrada
(`{ id: { label, tabs } }`, con `panelId` por pestaña). Los estados
viven en `DEFAULT_SETTINGS.visibleSections` / `visibleTabs` y se
sanean al cargar con `sanitizeVisibility` (invariantes: nunca 0
secciones ni 0 pestañas de una sección; claves fuera del registro se
ignoran). El resto de módulos consume helpers de solo lectura
(`isSectionVisible`, `countVisibleSections`, `normalizeTabKey`, …)
que leen `loadSettings()` fresco en cada llamada.

### 1. Registro central y helpers (`js/settings.js`)

- `SECTION_REGISTRY` exportado, con el orden de claves = orden de la
  barra lateral y de la «primera visible».
- Helpers exportados: `isSectionVisible(id)`,
  `getVisibleSectionIds()`, `countVisibleSections()`,
  `isTabVisible(key)`, `getFirstVisibleTabKey(sectionId)`,
  `getFirstVisibleTabPanel(sectionId)` y
  `normalizeTabKey(sectionId, key)` (clave → primera visible si la
  pedida está oculta).
- `sanitizeVisibility(settings)` al final de `loadSettings()`: si
  ninguna sección está visible se activan todas; si una sección se
  quedó sin pestañas visibles se activan todas sus pestañas; las
  claves no registradas se descartan (tolerante). Se aplica también
  en el retorno sin localStorage.
- `scheduleFirestoreSync` guarda `preferences` con
  `notifications` + `visibleSections` + `visibleTabs`.

### 2. Card «Secciones y pestañas» en Ajustes

- `renderSettings(ctx)` llama a `renderSectionsCard(settings)`, que
  pinta en `#sections-visibility-list` (HTML estático en index.html,
  entre las cards «Apariencia» y «Notificaciones») una fila por
  sección (`.settings-row` con `label.settings-row__text` + switch
  `data-vis-section`) y sus pestañas anidadas en `.settings-group`
  (switch `data-vis-tab` + id
  `tab-visible-<sectionId>-<tabKey>`).
- **Guardas**: el switch de la única sección visible queda
  `disabled` con la nota «No puedes ocultar la última sección
  visible.»; el de la última pestaña visible de una sección, con
  «No puedes ocultar la última pestaña visible de <Label>.». La
  defensa en profundidad en el handler (`wireVisibilityToggles`)
  revierte el cambio si, aun así, quedaran 0 secciones o 0 pestañas
  de la sección afectada.
- El wiring es **delegación de `change`** sobre el contenedor: los
  checks se re-renderizan tras cada cambio pero el listener se
  registra una sola vez.
- CSS mínimo con variables existentes: `opacity` + `cursor` para
  switches deshabilitados y sangría con borde `--paper-line` para el
  grupo de pestañas (válido en los cuatro temas sin overrides).

### 3. Retirada de pestañas de la barra y de la vista (`js/app.js`)

- `applyTabVisibility()`: añade/retira `hidden` a las pestañas
  (`.tab[data-panel=…]`) y a los paneles según `isTabVisible`. Las
  suscripciones y cargas de datos siguen activas.
- Guard al inicio de `activatePanel`: si la pestaña pedida está
  oculta, cae a `getFirstVisibleTabPanel("ocio")` y **normaliza el
  hash in-place con `history.replaceState`** (sin `router.navigate`
  ni `location.hash`: no dispara hashchange y evita bucles). No usa
  `router` a propósito: en la carga inicial `onRoute` se ejecuta
  dentro de `initRouter()`, antes de que la `const router` esté
  asignada (TDZ), así que la normalización es directa sobre la URL.
- Consumidores que navegan a una pestaña usan `normalizeTabKey`:
  entrada «Ocio» de la sidebar (`onGoOcio`) y vuelta del perfil
  (`btn-close-profile` en profile.js).

### 4. Barra lateral ☰ ↔ engranaje ⚙ (`js/sidebar.js` + index.html)

- `setupSidebar` recibe el predicado `isSectionVisible` por
  **inyección** (sidebar.js no importa settings.js: sin ciclos);
  registra el clic del nuevo `#btn-header-settings` (HTML estático en
  `.app-header__top`, junto al toggle ☰, con la clase `hidden` por
  defecto) que abre Ajustes (mismo callback que la entrada pinned).
- Nuevo export `renderSidebar()`: re-render de nav (solo secciones
  visibles) y footer (pinned, sin filtro) más
  `updateHeaderNavButtons()`, que muestra ☰ o ⚙ según
  `countVisibleSections() <= 1`. Si el drawer está abierto y se queda
  sin secciones, se cierra antes. `setupSidebar` llama a
  `renderSidebar()` al final (estado inicial).
- `app.js` conecta el refresco: `setupSettings(ctx,
  { onVisibilityChange: refreshNavigation })` →
  `applyTabVisibility()` + `renderSidebar()`, y llama
  `applyTabVisibility()` una vez tras el arranque.

## Alternativas descartadas

- **Guardar el estado de visibilidad por separado (otra clave de
  localStorage o campo Firestore distinto)**: se descarta por
  coherencia con las notificaciones (todo en `preferences`) y para
  que el backup/restore existente lo incluya sin cambios.
- **Ocultar secciones/pestañas solo en memoria (sin persistencia)**:
  la preferencia se perdería en cada recarga; el criterio de
  aceptación exige persistencia y sincronización.
- **Reutilizar `router.navigate` en el guard de `activatePanel`**:
  descartado por el TDZ de la carga inicial (ver decisión 3); además
  dispararía `hashchange` y recompondría la ruta.
- **Filtering por sección en el footer del drawer**: «Ajustes» es
  pinned y siempre necesaria (sobre todo con el ⚙ solo visible cuando
  hay una única sección), así que el filtro de visibilidad solo se
  aplica a las entradas no pinned del nav.

## Consecuencias

- La web permite ocultar secciones y pestañas desde Ajustes; la
  barra lateral se sustituye por el engranaje de la cabecera con una
  sola sección visible y reaparece al tener más de una.
- Añadir una sección futura es solo registrar una entrada en
  `SECTION_REGISTRY` (y su panel/tabs en HTML): barra lateral,
  tarjeta de Ajustes, guardas y normalización de URL se adaptan solos.
- `sidebar.js` sigue sin importar settings.js (predicado inyectado);
  `settings.js` sigue sin importar sidebar/app/router.
- El manual de usuario documenta la nueva funcionalidad (secciones 3
  y 14). Versión PWA incrementada a `20260839`
  (scripts/bump-version.sh).

## Archivos creados/modificados

- `js/settings.js`: registro, helpers, sanitización, card de Ajustes,
  wire de toggles y sync Firestore extendida.
- `js/sidebar.js`: predicado inyectado, `renderSidebar`,
  `#btn-header-settings` wiring.
- `js/app.js`: `applyTabVisibility`, guard de `activatePanel`,
  `refreshNavigation`, imports y wiring.
- `js/profile.js`: `normalizeTabKey` en la vuelta del perfil.
- `index.html`: botón ⚙ en la cabecera y card «Secciones y pestañas».
- `css/styles.css`: guardas y `.settings-group`.
- `js/config.js`, `service-worker.js`, `index.html`: bump a 20260839.
- `docs/manual-de-usuario.md`: secciones 3 y 14.

Related issue: #97 — https://github.com/gonzalitojh/Registro-personal/issues/97