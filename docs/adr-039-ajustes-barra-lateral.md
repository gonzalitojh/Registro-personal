# ADR-039: Ajustes en la barra lateral y cabecera sin ⚙️/☀️🌙 (issue #75)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

Tras ADR-038 (issue #46), la cabecera quedó estilo Gmail —hamburguesa,
barra de búsqueda, campana, ⚙️, ☀️/🌙 y avatar— y el drawer lateral solo
contenía la entrada **«Ocio»**. En ese estado:

1. **Accesos duplicados**: el botón ⚙️ `#btn-settings` de la cabecera y el
   menú del avatar (ADR-035) llevaban al mismo destino (perfil → sección
   Ajustes); el toggle ☀️/🌙 `#btn-theme-toggle` duplicaba el selector de
   tema de Ajustes (`#settings-theme-select`). Dos botones de cabecera que
   repiten funcionalidad ya cubierta.
2. **Drawer con una única entrada**: la barra lateral no ofrecía la
   navegación de «fondo» típica de las apps (ajustes abajo, separados del
   resto), y la issue #75 pide añadir **«Ajustes» en la parte inferior**,
   visualmente separada de «Ocio».
3. **Código muerto**: `syncThemeSelect()` de `js/settings.js` existía solo
   para mantener el select sincronizado con el toggle de cabecera; si se
   elimina el toggle, la función queda sin consumidores.

La issue #75 pide, además, **eliminar los botones ⚙️ y ☀️/🌙 de la cabecera**
y dejar el tema como opción exclusiva de la sección Ajustes.

Related issue: #75 — https://github.com/gonzalitojh/Registro-personal/issues/75

**Nota histórica**: este ADR documenta la supresión de los accesos directos
de cabecera a Ajustes (⚙️) y al tema (☀️/🌙) que documentaron los ADR-009,
ADR-012 y ADR-035, y su sustitución por una entrada «Ajustes» fijada al
footer del drawer lateral de ADR-038.

## Decisión

### 1. Entrada «Ajustes» `pinned` en el footer del drawer

Se mantiene el **patrón declarativo `SECTIONS`** de ADR-038, añadiendo una
propiedad `pinned` a las entradas:

- `index.html`: nuevo `<div class="app-sidebar__footer"
  id="app-sidebar-footer">` dentro del `aside#app-sidebar`, inmediatamente
  después del `nav`.
- `js/sidebar.js`: nueva entrada en `SECTIONS`:
  `{ id: "settings", label: "Ajustes", pinned: true, icon: SVG engranaje
  inline (trazo currentColor), onClick }`. El render se divide:
  `#app-sidebar-nav` recibe `SECTIONS.filter((s) => !s.pinned)` y el footer
  `SECTIONS.filter((s) => s.pinned)` (si el footer no existe —HTML
  antiguo— no se hace nada: defensivo).
- `css/styles.css`: `.app-sidebar__footer` con `margin-top: auto`
  (empuja el bloque al borde inferior del drawer) y
  `border-top: 1px solid var(--paper-line)` (separador visual con el token
  existente).
- La **delegación de clics se movió del `nav` al `aside`** (el sidebar
  completo): sigue usando `closest(".app-sidebar__link")` +
  `SECTIONS.find()`, cerrando el drawer y ejecutando `section.onClick()`.
  El botón ✕ usa la clase `app-sidebar__close`, así que no interfiere con
  el delegado.

### 2. Callback `onOpenSettings` inyectado desde `app.js`

- `setupSidebar(opts)` acepta ahora un objeto de opciones; el callback se
  guarda en una variable de módulo (`let openSettings = null`), que el
  `onClick` de «Ajustes» invoca si existe. El módulo del drawer no sabe
  nada del perfil: solo dispara un callback.
- `js/app.js`: `setupSidebar({ onOpenSettings: () =>
  profileApi.openProfileSection("settings", ctx) })`.
- **Reorden del `init()`**: `setupProfile(ctx)` (que devuelve `profileApi`)
  y `setupSettings(ctx)` se ejecutan **antes** de `setupSidebar(...)` para
  que el callback esté disponible. Antes, `setupSidebar()` se llamaba sin
  argumentos y antes de `setupProfile`.

### 3. Eliminación de ⚙️ y ☀️/🌙 de la cabecera

- `index.html`: eliminados `#btn-settings` (⚙️) y `#btn-theme-toggle` (con
  `#theme-toggle-icon`, `role="switch"` y `aria-checked`).
- `js/app.js`: eliminados sus handlers; el import de `syncThemeSelect` se
  retira de `settings.js`.
- `css/styles.css`: eliminados los estilos `.theme-toggle` y `#btn-settings`.
- `js/settings.js`: eliminada la función exportada `syncThemeSelect()`
  (código muerto); se conservan `wireThemeSelect` (privada; conecta
  `#settings-theme-select` → `saveSettings()` + `ctx.setTheme()`) y
  `syncThemeToSettings()` (ver punto 4).

### 4. `setTheme()` simplificado y tema solo desde Ajustes

- `setTheme(theme)` ya no referencia al toggle ni a su icono: conserva
  `document.documentElement.dataset.theme`, `localStorage` (clave
  `mi-registro-theme`) y el `meta[name="theme-color"]` (`#f5f0e8` claro /
  `#171512` oscuro). El tema ahora se cambia **solo** desde el selector de
  Ajustes.
- `syncThemeToSettings(getSavedTheme())` se mantiene en el `init()` para
  mantener coherentes las claves `mi-registro-theme` y
  `mi-registro-settings`.

### 5. PWA

- `js/config.js`: `APP_VERSION` de `20260810` a **`20260811`**.
- `index.html`: `?v=20260811` en `css/styles.css`, `ocio/ocio.css` y
  `js/app.js`.
- `service-worker.js`: `STATIC_ASSETS` actualizado a `?v=20260811`
  (estilos, app.js y `ocio/*.html`). Invalida las cachés previas.

### 6. Manual de usuario

- Secciones **3** (pantalla principal) y **14** (Ajustes): eliminados los
  botones ⚙️ y ☀️/🌙 de la cabecera; «Ajustes» en la parte inferior de la
  barra lateral como nueva vía de acceso (junto al menú de la foto);
  el tema se elige solo en Ajustes.

## Alternativas descartadas

- **`margin-top: auto` en el `nav` único con CSS atado al último hijo**
  (p. ej. `:last-child` sobre «Ocio»): descartado — acopla el estilo al
  orden del array y se rompe al añadir más entradas; se prefirió mantener
  el patrón declarativo de `SECTIONS` con una propiedad `pinned` y un
  contenedor footer propio.
- **Estado global mutable en `sidebar.js`** (p. ej. exportar un setter o
  registro de callbacks): descartado — la convención del repo es la
  inyección vía funciones `setup*` con opciones desde `app.js`; el
  parámetro `onOpenSettings` mantiene el módulo autocontenido y
  testable.
- **Import cruzado de `profile.js` en `sidebar.js`** (llamar directamente a
  `openProfileSection`): descartado — crearía un acoplamiento drawer →
  perfil y el módulo dejaría de ser reutilizable; el drawer solo necesita
  saber que «Ajustes» dispara un callback que alguien inyecta.
- **Mantener el toggle ☀️/🌙 en la cabecera**: descartado — la issue pide
  eliminarlo; el selector de tema de Ajustes ya existía (ADR-012) y pasa a
  ser la única vía, eliminando la doble fuente de cambio y su código de
  sincronización.

## Consecuencias

### Positivas

- **Cabecera más limpia**: quedan hamburguesa, barra de búsqueda, campana y
  avatar; el acceso a Ajustes vive en el drawer y en el menú del avatar
  (sin duplicados).
- **Una sola vía de cambio de tema**: se elimina la sincronización
  bidireccional del toggle (incluida `syncThemeSelect`, código muerto) y
  sus estilos.
- **Patrón `SECTIONS` intacto**: añadir secciones futuras (series,
  películas, libros) o entradas pinned sigue siendo declarativo, con
  separación footer sin CSS frágil atado a posiciones del array.
- **Menos elementos en la fila de iconos de la cabecera**, también en el
  modo compacto ≤480 px (se aligera el `user-badge`).

### Negativas / Riesgos

- **Cambio de hábitos del usuario**: cambiar el tema requiere ahora dos
  pasos (abrir el drawer y pulsar «Ajustes», o menú de la foto → Ajustes)
  en lugar de un clic en la cabecera. Se mitiga con la entrada permanente
  del footer del drawer y el manual actualizado.
- **`setTheme()` ya no actualiza estado ARIA de ningún botón de cabecera**:
  el único punto de cambio es el select de Ajustes, que no necesita esa
  sincronización.

### Neutras

- **PWA versionada a `20260811`**: `APP_VERSION`, `?v=` en `index.html` y
  `STATIC_ASSETS` del service worker invalidan las cachés previas.
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambios visibles al usuario): secciones **3** y **14**.
- **ADRs históricos superados en lo relativo a los botones de cabecera**:
  ADR-009 (documentaba `#btn-theme-toggle` y los estilos `.theme-toggle`),
  ADR-012 (documentaba `#btn-settings`, `syncThemeSelect` y
  `syncThemeToSettings`) y ADR-035 (documentaba la duplicación ⚙️ vs. menú
  del avatar) quedan parcialmente superados en esos puntos concretos; el
  resto de sus decisiones (variables de tema, página de ajustes, dropdown
  de perfil) siguen vigentes.
- Deuda menor de documentación: el comentario interno de
  `syncThemeToSettings()` en `js/settings.js` aún menciona «el toggle del
  header» eliminado; no afecta al comportamiento.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/sidebar.js` | Entrada **«Ajustes»** con `pinned: true` en `SECTIONS` (icono SVG engranaje inline, `onClick` → callback de módulo); `setupSidebar(opts)` con `onOpenSettings` inyectable; render dividido `nav`/`footer` (`filter(!pinned)` / `filter(pinned)`, defensivo); delegación de clics movida del `nav` al `aside` |
| `index.html` | Nuevo `#app-sidebar-footer` tras el `nav` del drawer (comentario del aside actualizado); **eliminados** `#btn-settings` (⚙️) y `#btn-theme-toggle`/`#theme-toggle-icon`; versionado `?v=20260811` |
| `js/app.js` | Eliminados los handlers de `#btn-theme-toggle` y `#btn-settings` y el import de `syncThemeSelect`; `setTheme()` simplificado (data-theme + `mi-registro-theme` + meta theme-color); `init()` reordenado: `setupProfile`/`setupSettings` antes de `setupSidebar({ onOpenSettings: () => profileApi.openProfileSection("settings", ctx) })`; `syncThemeToSettings(getSavedTheme())` conservado |
| `js/settings.js` | Eliminada la función exportada `syncThemeSelect` (código muerto); conservados `wireThemeSelect` (selector de tema de Ajustes) y `syncThemeToSettings` |
| `css/styles.css` | Nuevo `.app-sidebar__footer` (`margin-top: auto`, `border-top: 1px solid var(--paper-line)`, `gap`, `padding-top`); **eliminados** los estilos `.theme-toggle` y `#btn-settings` |
| `js/config.js` | `APP_VERSION` de `20260810` a `20260811` |
| `service-worker.js` | `STATIC_ASSETS` con `?v=20260811` (styles, ocio.css, app.js, `ocio/*.html`) |
| `docs/manual-de-usuario.md` | Secciones 3 y 14: eliminados ⚙️ y ☀️/🌙 de la cabecera; «Ajustes» en la parte inferior de la barra lateral como nueva vía de acceso; tema solo desde Ajustes |
| `docs/adr-039-ajustes-barra-lateral.md` | **Nuevo**: este documento |

Related issue: #75 — https://github.com/gonzalitojh/Registro-personal/issues/75
