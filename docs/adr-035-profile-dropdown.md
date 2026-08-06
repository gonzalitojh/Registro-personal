# ADR-035: Menú desplegable de perfil y cierre de sesión (issue #76)

## Estado
Aceptado

## Fecha
2026-08-05

## Contexto

En la cabecera existían dos elementos de perfil:

- El **avatar** (`#btn-open-profile`) que, al pulsarlo, abría directamente la
  vista de perfil en la sección **Estadísticas** (subtab `stats` activa).
  Para llegar a las otras cuatro secciones (Amigos, Actividad, Datos,
  Ajustes) había que navegar con las subtabs dentro de la vista.
- Un botón **«Salir»** (`#btn-logout`) junto al nombre de usuario, siempre
  visible en la cabecera.

La issue #76 pedía: al pulsar el avatar, debe desplegarse un menú
(dropdown/popover) **anclado a esa posición** (no en mitad de la pantalla)
con acceso a las cinco secciones del perfil (**Estadísticas, Amigos,
Actividad, Datos y Ajustes**) y a **cerrar sesión**; además, el botón
«Salir» debe eliminarse de la pantalla principal.

Dos problemas de base motivaban el cambio:

1. **Lógica duplicada de apertura**: el handler del avatar (en `profile.js`)
   y el del engranaje ⚙️ `#btn-settings` (en `app.js`) repetían el mismo
   bloque (ocultar `#app`, mostrar `#profile-view`, activar la subtab,
   mostrar/ocultar cada sección). Cualquier cambio de estructura del perfil
   había que aplicarlo en dos sitios.
2. **Descubribilidad**: con el avatar saltando directamente a Estadísticas,
   el acceso a las demás secciones del perfil y al cierre de sesión era
   menos evidente; el botón «Salir» ocupaba sitio permanente en la cabecera.

Como referencia existía el patrón ya probado del dropdown de
notificaciones (`.notif-wrap` > `.notif-dropdown`): panel anclado a su
botón, cierre con Escape, clic fuera y focus trap (`trapFocus` de
`focus-utils.js`), implementado en `notifications-setup.js`.

**Nota histórica**: este ADR documenta la sustitución del comportamiento
anterior, donde el avatar abría directamente Estadísticas y el cierre de
sesión era un botón fijo en la cabecera.

Related issue: #76 — https://github.com/gonzalitojh/Registro-personal/issues/76

## Decisión

Sustituir la apertura directa del perfil por un **menú desplegable anclado
al avatar** que agrupa las cinco secciones del perfil y el cierre de
sesión, eliminando el botón «Salir» del header:

### 1. Dropdown anclado al botón avatar (patrón del dropdown de notificaciones)

- En `index.html`, el botón avatar se envuelve en un contenedor
  `.profile-menu-wrap` con `position: relative`.
- El panel `#profile-dropdown` usa `position: absolute; right: 0;
  top: calc(100% + 10px)`, de modo que se ancla al borde derecho del avatar
  y aparece justo debajo de él — no centrado en pantalla, como pedía la
  issue.
- Contenido del menú: cinco botones con `data-section` (`stats`, `friends`,
  `activity`, `data`, `settings`) etiquetados **Estadísticas, Amigos,
  Actividad, Datos, Ajustes**, un separador y la opción **«Cerrar sesión»**
  (`#btn-profile-logout`).
- El panel es un elemento estático del DOM (no se inyecta por JS) y se
  muestra/oculta con la clase `hidden`; `z-index: 40` y ancho
  `min(240px, calc(100vw - 2rem))`.

### 2. Móvil (≤600px): anclaje al viewport para evitar desbordes

En `@media (max-width: 600px)` el panel pasa a `position: fixed;
left: 1rem; right: 1rem; top: 4.5rem; width: auto`. Si la cabecera envuelve
en dos filas (modo compacto), el ancla `absolute` quedaría desplazada a la
izquierda de la pantalla y el panel desbordaría por la derecha. El anclaje
fijo con márgenes laterales garantiza que el menú **nunca se salga del
ancho visible** (requisito de responsividad de AGENTS.md: sin scroll
horizontal), igual que el dropdown de notificaciones.

### 3. Accesibilidad y gestión de foco

- El botón avatar lleva `aria-haspopup="menu"`, `aria-expanded` (se
  actualiza a `true`/`false` al abrir/cerrar) y `aria-controls="profile-dropdown"`.
- El panel lleva `role="menu"` con `aria-label`; cada opción es
  `role="menuitem"` y el separador `role="separator"`.
- **Focus trap**: al abrir se activa `trapFocus(profileDropdown)` de
  `focus-utils.js` (el mismo helper que usan notificaciones, búsqueda
  global, modales y valoraciones); al cerrar se ejecuta su cleanup.
- **Cierre con Escape**: se registra `escHandler` (keydown) al abrir. El
  cierre está centralizado en `closeProfileDropdown()`, que **des-registra
  el handler en TODAS las vías de cierre** (`document.removeEventListener(
  "keydown", escHandler)`): Escape, clic fuera, seleccionar una opción,
  pulsar «Cerrar sesión» y volver a pulsar el avatar para cerrarlo.
  (Commit `068873f`: el handler se sacó del listener del click y se movió a
  `closeProfileDropdown()` precisamente para garantizar esa limpieza en
  todos los caminos y no dejar listeners colgados.)
- **Foco restaurado al avatar**: `closeProfileDropdown()` termina con
  `btnOpenProfile.focus()`, devolviendo el foco al elemento que abrió el
  menú.
- Cierre con **clic fuera**: listener de click en `document` que cierra si
  el clic cae fuera de `.profile-menu-wrap` y el panel está abierto.

### 4. Función única `openProfileSection(section, ctx)` en `js/profile.js`

Se extrae la lógica de apertura a una única función que: oculta `#app`,
muestra `#profile-view`, activa la subtab correspondiente
(`aria-selected` + clase `is-active`), muestra/oculta las secciones
(`stats`, `friends`, `activity`, `data`, `settings`) y dispara la carga
específica de cada sección (`renderStats`, `loadFriendsList`,
`loadActivityFeed`, `renderSettings`). La usan tres puntos de entrada:

1. Las **subtabs** del perfil (`profile-subtab`).
2. El botón **⚙️ engranaje** de la cabecera: `app.js` ya no repite el
   bloque de apertura, solo llama a `profileApi.openProfileSection("settings", ctx)`.
3. Las **opciones del nuevo menú** del avatar.

`setupProfile(ctx)` retorna `{ openProfileSection }`; `app.js` la recibe
como `const profileApi = setupProfile(ctx)`.

### 5. Eliminación total de `#btn-logout`

- `index.html`: el botón **«Salir»** desaparece del header.
- `css/styles.css`: se eliminan los estilos específicos del botón en la
  cabecera móvil (`.user-badge .btn--ghost`) y se actualiza el comentario
  de la cabecera compacta (el cierre de sesión vive ahora en el menú del
  avatar).
- `js/app.js`: se elimina el listener `#btn-logout` → `logout()`.

### 6. Cierre de sesión desde el menú

La opción `#btn-profile-logout` cierra primero el menú
(`closeProfileDropdown()`) y después llama a `logout()` de `firebase.js`
(la misma función que usaba el botón anterior; `app.js` la conserva solo
para el caso de correo no invitado).

## Alternativas descartadas

- **Mantener el botón «Salir» en la cabecera**: descartado — la issue
  pedía explícitamente eliminarlo de la pantalla principal y centralizar
  el cierre de sesión en el menú del avatar.
- **Mantener el avatar abriendo directamente Estadísticas**: descartado —
  no permitía acceso directo a las cinco secciones desde la cabecera y
  dejaba el perfil como «página» de una sola entrada.
- **Dropdown centrado en pantalla (estilo modal)**: descartado — la issue
  pedía que el menú apareciera desplegado desde la posición del avatar,
  no en mitad de la pantalla.
- **Duplicar la lógica de apertura (patrón anterior, un bloque por
  entrada)**: descartado — la duplicación en `app.js` y `profile.js` era
  el problema de mantenibilidad que este ADR corrige; se unifica en
  `openProfileSection`.
- **Inyectar el menú dinámicamente con JS**: descartado — un elemento
  estático en el DOM es más sencillo de estilizar, auditar y accesibilizar
  (mismo criterio que el dropdown de notificaciones).

## Consecuencias

### Positivas
- **Acceso unificado a la cuenta desde un único punto**: el avatar agrupa
  las cinco secciones del perfil y el cierre de sesión; el botón «Salir»
  deja de ocupar sitio permanente en la cabecera.
- **Lógica de apertura centralizada**: `openProfileSection` elimina la
  duplicación; `app.js` reduce su tamaño y ya no repite el bloque de
  apertura del perfil (un único call site para el ⚙️).
- **Accesibilidad completa**: roles ARIA (`menu`/`menuitem`), estados
  `aria-expanded`/`aria-controls`, focus trap, cierre con Escape y foco
  restaurado al avatar en todas las vías de cierre.
- **Sin riesgo de desborde en móvil**: el anclaje `fixed` ≤600px garantiza
  que el menú quepa en cualquier ancho, cumpliendo las reglas de
  responsividad del proyecto.
- **Reutilización del patrón probado** del dropdown de notificaciones
  (`trapFocus` de `focus-utils.js`), coherente con el resto de la app.

### Negativas
- **El cierre de sesión requiere un paso más**: antes había un botón
  siempre visible; ahora hay que abrir el menú del avatar y elegir
  «Cerrar sesión». El riesgo se mitiga porque al recargar la página la
  sesión se mantiene (persistencia de Firebase Auth), así que el cierre
  no es una acción frecuente.

### Neutras
- **El menú solo existe en el DOM del header**: no afecta a otras vistas;
  la clase `hidden` gestiona su visibilidad.
- **PWA versionada a `20260807`**: `APP_VERSION` en `js/config.js`, el
  service worker (`service-worker.js`) y los `?v=` de `index.html` se
  actualizan para invalidar las cachés con el nuevo CSS/JS.
- **El manual de usuario se actualizó en la misma tarea** (obligación de
  AGENTS.md): secciones 2, 3, 13 y 14 (botón «Salir» sustituido por el
  menú del avatar).
- **`logout()` en `app.js` se conserva** para el caso de correo no
  invitado (listado de invitados), independiente del menú.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | `.profile-menu-wrap` envuelve al avatar; nuevo `#profile-dropdown` con 5 items (`data-section`), separador y `#btn-profile-logout`; atributos ARIA en botón y menú; **eliminado `#btn-logout`**; versionado `?v=20260807` |
| `css/styles.css` | Nuevas clases `.profile-menu-wrap`, `.profile-dropdown` (+ `__item`, `__separator`, `__item--logout`) con anclaje `absolute right:0 top:calc(100%+10px)`; media query ≤600px con anclaje `fixed` al viewport; estilos `focus-visible`; **eliminados los estilos móviles del botón Salir** y actualizado su comentario |
| `js/profile.js` | Nueva función única `openProfileSection(section, ctx)` (subtabs, ⚙️ y menú); lógica del dropdown (abrir/cerrar, Escape centralizado en `closeProfileDropdown`, clic fuera, focus trap, foco al avatar); `#btn-profile-logout` → `closeProfileDropdown()` + `logout()`; retorna `{ openProfileSection }` |
| `js/app.js` | **Eliminado el listener de `#btn-logout`**; `const profileApi = setupProfile(ctx)`; `#btn-settings` ahora llama a `profileApi.openProfileSection("settings", ctx)` (ya no repite la apertura) |
| `js/config.js` | `APP_VERSION` de `20260806` a `20260807` |
| `service-worker.js` | `STATIC_ASSETS` con `?v=20260807` |
| `docs/manual-de-usuario.md` | Botón «Salir» sustituido por el menú del avatar (secciones 2, 3, 13 y 14) |
| `docs/adr-035-profile-dropdown.md` | **Nuevo**: este documento |

Related issue: #76 — https://github.com/gonzalitojh/Registro-personal/issues/76
