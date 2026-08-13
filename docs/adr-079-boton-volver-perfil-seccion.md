# ADR-079: El botón volver del perfil regresa a la sección previa (Ocio o Recetas) (issue #213)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #213 (type: bug, priority: high) detecta que **el botón de
volver del perfil siempre llevaba a la sección de Ocio**, aunque el
usuario hubiera entrado al perfil desde la sección de **Recetas**.
Con la llegada de Recetas (issue #64, ADR-076) la web tiene dos
secciones de primer nivel de contenido (Ocio y Recetas), y el patrón
«volver siempre a Ocio» ya no reflejaba la intención del usuario.

Estado previo (construido en ADR-061, ADR-077 y ADR-078):

- El perfil tiene su propia cabecera (`#profile-view__header`) con la
  **flecha de volver** (`#btn-close-profile`, `.icon-btn` con SVG
  `arrow-left`, ADR-061) y las pestañas (Estadísticas/Amigos/
  Actividad/Ajustes) en la misma fila; la **cabecera global no
  aparece** en el perfil (ADR-077, issue #206). Es una excepción al
  componente único de pestañas `tabs--bar` (ADR-078).
- El handler de `#btn-close-profile` en `js/profile.js` cerraba la
  vista con un toggle manual y **siempre** hacía
  `navigate(normalizeTabKey("ocio", getLastOcioKey()))`: volvía a la
  última pestaña de Ocio activa (normalizada a la primera visible si
  quedó oculta, issue #97), ignorando que el usuario podía venir de
  Recetas.
- El router (`js/router.js`) ya mantenía memorias por sección
  (`lastOcioKey` y `lastRecipesTab`, actualizadas en `applyRoute`),
  pero **no recordaba cuál había sido la última sección de primer
  nivel** (ocio o recetas) antes de entrar al perfil.

## Decisión

1. **Memoria de última sección en el router** (`js/router.js`): nueva
   variable `lastSection` (valor inicial `"ocio"`) que se actualiza en
   `applyRoute()` **solo** cuando la ruta es de `ocio` o `recetas`
   (las rutas de `perfil`, deliberadamente, NO la actualizan: al
   entrar en el perfil queda a salvo la sección de contenido desde la
   que se vino). Se exporta `getLastSection()` y se añade al API
   devuelto por `initRouter`.
2. **El handler de volver decide por sección** (`js/profile.js`):
   - Si `getLastSection() === "recetas"` → navega a
     `{ section: "recetas", tab: normalizeTabKey("recetas",
     getLastRecipesTab()) }`. El cambio de hash dispara `onRoute` →
     `openRecipes({ fromRouter: true })` (js/recipes.js), que cierra
     `#app` y `#profile-view`, destapa `#recipes-view` con su pestaña
     y repinta la cabecera global: **no hace falta tocar `#app`** en
     esta rama.
   - Si no (Ocio o valor por defecto) → comportamiento previo:
     cerrar `#profile-view`, mostrar `#app` y navegar a
     `normalizeTabKey("ocio", getLastOcioKey())` (última pestaña de
     Ocio, normalizada a la primera visible si quedó oculta, #97).
   - El toggle manual de cierre de la vista se conserva (cubre el caso
     de navegar sin cambiar el hash).
3. **Sin cambios de CSS**: no hay cambios visuales; solo lógica de
   navegación.
4. **Bump PWA** `20260908` → `20260909` (`scripts/bump-version.sh`,
   toca `js/config.js`, `index.html`, `service-worker.js`), práctica
   de un bump por PR (ADR-049/059).
5. **Manual de usuario actualizado** (§3.2 y §15): la flecha de volver
   del perfil regresa a la sección (Ocio o Recetas) desde la que se
   entró, con la pestaña que se tenía activa (regla 3 de AGENTS.md).

### Toggles de vistas (verificado sobre el código real)

- **Rama Recetas**: `navigate({ section: "recetas", ... })` cambia el
  hash (`#/perfil/...` → `#/recetas/...`) y dispara `onRoute` rama
  `recetas` (js/app.js) → `recipesApi.openRecipes({ tab, fromRouter:
  true })` (js/recipes.js `openRecipes`), que hace exactamente:
  `#app.hidden`, `#profile-view.hidden`, `#recipes-view` visible y
  alterna barra/paneles por pestaña. El propio onRoute re-normaliza la
  pestaña con `normalizeTabKey` y reescribe la URL si quedó oculta
  (#97). No hace falta mostrar `#app` ni tocar `#recipes-view` en el
  handler.
- **Rama Ocio**: se conserva el toggle manual actual (cerrar
  `#profile-view` + mostrar `#app`) y el onRoute de Ocio re-oculta
  `#profile-view` y `#recipes-view`, activa el panel y muestra `#app`
  (condicional a `currentUser`) — sin regresiones respecto al
  comportamiento previo.

## Alternativas descartadas

- **Trazar el historial del navegador (history.back)**: descartado —
  las memorias de sesión del router son la fuente de verdad existente
  y evitan dependencias del historial (recarga, deep-link directo).
- **Guard en el router para secciones ocultas en Ajustes**: descartado
  — fuera de alcance de #213 y consistente con el comportamiento
  preexistente de Ocio (el router no bloquea navegar a una sección
  oculta por URL).

## Consecuencias

- **Positivas**: el volver del perfil refleja la intención real del
  usuario (Ocio o Recetas) con su última pestaña activa; cero cambios
  visuales; los edge cases quedan cubiertos (deep-link directo a
  `#/perfil` sin sección visitada cae a Ocio por defecto; entrada
  desde sidebar «Ajustes» o menú de perfil respeta la sección de
  origen).
- **Neutras**: las memorias `lastSection`/`lastOcioKey`/`lastRecipesTab`
  son de sesión y no interfieren con el histórico atrás/adelante del
  navegador (que sigue su propio historial de hash).
- **Negativas**: ninguna conocida.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/router.js` | **Modificado**: nueva memoria `lastSection` (default `"ocio"`) actualizada en `applyRoute()` solo para ocio/recetas; exportado `getLastSection()` y añadido al API de `initRouter`; comentario de cabecera ampliado |
| `js/profile.js` | **Modificado**: import de `getLastRecipesTab`/`getLastSection`; handler de `#btn-close-profile` decide destino por `getLastSection()` (Recetas → última pestaña de Recetas normalizada; si no → Ocio) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260908` → `20260909` |
| `index.html` | **Modificado**: refs `?v=20260908` → `?v=20260909` |
| `service-worker.js` | **Modificado**: 7 entradas versionadas `?v=20260908` → `?v=20260909` |
| `docs/manual-de-usuario.md` | **Modificado**: §3.2 y §15 — la flecha de volver del perfil regresa a la sección (Ocio o Recetas) desde la que se entró, con su pestaña activa |
| `docs/adr-079-boton-volver-perfil-seccion.md` | **Nuevo**: este documento |

Related issue: #213
