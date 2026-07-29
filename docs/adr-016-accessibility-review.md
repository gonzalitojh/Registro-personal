# ADR-016: Revisión y mejora de accesibilidad — Navegación por teclado y lectores de pantalla

## Estado
Aceptado

## Fecha
Julio 2026

## Contexto

La aplicación "Mi Registro" había crecido significativamente en funcionalidad (buscador global, feed de actividad, ajustes, exportación, etc.) sin una revisión de accesibilidad dedicada. Esto generaba varias barreras para usuarios con discapacidades visuales o que navegan exclusivamente por teclado:

1. **Falta de skip link**: No existía un enlace para saltar directamente al contenido principal, obligando a usuarios de teclado a tabular por toda la navegación del header en cada carga de página.
2. **Gestión de foco ausente en modales**: Al abrir un modal, el foco permanecía en el elemento que lo activó, y al cerrarlo no se restauraba. No había atrapado de foco (_focus trapping_), por lo que Tab podía llevar el foco detrás del modal.
3. **Falta de roles y landmarks ARIA**: Los paneles de contenido dinámico, las subpestañas del perfil y el dropdown de notificaciones carecían de roles ARIA (`tabpanel`, `tablist`, `dialog`, `alert`) que permitieran a los lectores de pantalla interpretar correctamente la estructura.
4. **Focus visible insuficiente**: Muchos componentes interactivos no mostraban un outline visible al recibir foco, o usaban `outline: none` sin alternativa.
5. **Falta de soporte por teclado en elementos clickables**: Los eventos del feed de actividad y los resultados del buscador global solo respondían a clics de ratón, no a Enter/Space.
6. **Contraste de color incorrecto**: Existía una anulación que empeoraba el contraste en el nombre del usuario en modo claro.
7. **Regiones dinámicas no anunciadas**: Los paneles que se cargan dinámicamente (series, películas, libros) no notificaban a los lectores de pantalla sobre los cambios de contenido.

El objetivo era alcanzar un nivel de cumplimiento **WCAG 2.1 AA** sin introducir regresiones funcionales.

## Decisión

Realizar una revisión integral de accesibilidad que abarca los siguientes ejes:

### 1. Nuevo módulo de utilidades de foco (`js/focus-utils.js`)
Se creó un módulo reutilizable con dos funciones:

- **`getFocusableElements(container)`**: Obtiene todos los elementos enfocables visibles dentro de un contenedor usando `querySelectorAll` con los selectores estándar (`a[href]`, `button:not([disabled])`, `input:not([disabled])`, etc.) y filtra por visibilidad (`offsetParent !== null`).
- **`trapFocus(container)`**: Atrapa el foco dentro de un contenedor modal/dropdown. Escucha eventos `keydown` para interceptar Tab y Shift+Tab, ciclando entre el primer y último elemento enfocable. Enfoca el primer elemento automáticamente tras un `requestAnimationFrame`. Devuelve una función `cleanup` para restaurar el comportamiento normal.

### 2. Skip link (`index.html` + `css/styles.css`)
- Se añadió un enlace `<a href="#main-content" class="skip-link">` como primer elemento del `<body>`.
- El `<main>` ahora tiene `id="main-content"` y `tabindex="-1"` para recibir foco.
- Estilos CSS: el skip link está oculto fuera de pantalla (`top: -100%`) y se vuelve visible al recibir foco (`top: 0`), con un outline grueso de color `--teal-reel`.

### 3. Gestión de foco en todos los modales y paneles dinámicos

Se añadió `trapFocus` y registro de `document.activeElement` en las siguientes funciones de `js/ui.js`:
- `openEditModal`
- `openManualAddModal`
- `openMovieModal`
- `openSagaSelectionModal`
- `openBookModal`
- `openTvModal`
- `openBookConfirmModal`
- `openReadOnlyModal`

La función `closeModal()` fue modificada para:
- Restaurar el foco al elemento `_previousActiveElement` registrado antes de abrir el modal.
- Ejecutar `_focusTrapCleanup()` para eliminar el listener del focus trap.
- Limpiar las propiedades auxiliares del modal.

### 4. Búsqueda global (`js/global-search.js`)
- Se importó `trapFocus` para atrapar el foco dentro del panel de búsqueda al abrir.
- Se registra `document.activeElement` al abrir (`_previousActiveElement`) y se restaura al cerrar.
- Los resultados cambiaron de `tabindex="-1"` a `tabindex="0"`.
- Se añadieron manejadores `keydown` para Enter y Space en cada resultado, activando la navegación.

### 5. Dropdown de notificaciones (`js/notifications-setup.js`)
- Se importó `trapFocus` para atrapar el foco dentro del dropdown al abrir.
- Se registra un manejador de Escape para cerrar el dropdown.
- Al cerrar (tanto por Escape como por click fuera), se restaura el foco al botón de notificaciones.
- Se extrajo la lógica de cierre a una función `closeNotifDropdown()` que también limpia el focus trap.

### 6. Manejador global de Escape (`js/modal-handlers.js`)
Se unificó el manejador de Escape con un sistema de prioridades:
1. **Modal activo**: si `#item-modal` no está oculto, se cierra el modal.
2. **Búsqueda global**: si `#global-search` está abierto, se delega a su manejador interno (no se interfiere).
3. **Notificaciones**: si `#notif-dropdown` está visible, se cierra y se restaura el foco al botón.

### 7. Roles y landmarks ARIA (`index.html`)

| Elemento | Cambio |
|----------|--------|
| `<main>` | `id="main-content"` + `tabindex="-1"` |
| Paneles dinámicos (`#panel-tv`, `#panel-movies`, `#panel-books`) | `aria-live="polite"` + `aria-atomic="true"` |
| `#profile-view` | `role="main"` + `aria-label="Vista de perfil"` |
| `.profile-subtabs` | `role="tablist"` + `aria-label="Secciones del perfil"` |
| Cada `.profile-subtab` | `role="tab"` + `aria-selected="true"/"false"` + `aria-controls="profile-section-{section}"` |
| Secciones del perfil (`#profile-section-*`) | Cambiadas de `<div>` a `<section>` con `role="tabpanel"` + `aria-labelledby` apuntando a un `<h2>` oculto visualmente |
| Periodo de estadísticas `<select>` | `aria-label="Periodo de estadísticas"` |
| Toast (`#toast`) | `role="alert"` + `aria-live="assertive"` |
| Dropdown de notificaciones (`#notif-dropdown`) | `role="dialog"` + `aria-label="Notificaciones"` |
| Switch labels (`.switch`) | Cambiadas de `aria-label` redundante a `aria-hidden="true"` (el `<label>` textual ya existe) |
| Flecha entre fechas (`→`) | `aria-hidden="true"` |

### 8. Foco en cambio de pestañas (`js/app.js`)
Al cambiar de pestaña (Series/Películas/Libros), el foco se mueve al `<h2>` del panel activo, que recibe `tabindex="-1"` para poder recibir foco mediante `focus()`.

### 9. Sincronización de ARIA en subpestañas del perfil (`js/profile.js`)
Al hacer clic en una subpestaña del perfil, además de la clase `is-active`, se actualizan los atributos `aria-selected` (`true` en la activa, `false` en las demás).

### 10. Feed de actividad — soporte por teclado (`js/ui.js`)
Los eventos del feed de actividad ahora tienen:
- `tabindex="0"` y `role="button"` para ser enfocables.
- Manejadores `keydown` para Enter y Space que ejecutan la misma acción que el clic.

### 11. Episodios — etiquetas ARIA (`js/ui.js`)
- Los checkboxes de episodios ahora tienen `aria-label` descriptivo (ej. "Marcar E1 — Nombre del episodio como visto").
- El `<span>` con el número de episodio tiene `aria-hidden="true"` (la información ya está en el `aria-label`).

### 12. Avatares de amigos — texto alternativo (`js/ui.js`)
El `alt` de las imágenes de avatar de amigos pasó de `alt=""` a `alt="Avatar de {nombre}"`.

### 13. Estilos de foco visible (`css/styles.css` y `ocio/ocio.css`)

**Global (`css/styles.css`):**
- El `:focus-visible` global se actualizó con color `--teal-reel`, `outline-offset: 2px` y `border-radius`.
- Se añadieron estilos `:focus-visible` específicos para 13 componentes: `.friend-card`, `.profile-subtab`, `.modal__close`, `.global-search__close`, `.global-search__item`, `.global-search__friend`, `.notif-row__delete`, `.season-toggle`, `.list-row__action`, `.item-card__btn`, `.tab`, `.icon-btn`, `.btn-link`.
- `.global-search__input`: se eliminó `outline: none` y se añadió `:focus-visible` con outline teal.
- Se eliminó un override de contraste incorrecto (comentario: "El `user-badge__name` en modo claro usa el `--ink-soft` ya definido que proporciona contraste suficiente contra fondos oscuros").

**Ocio (`ocio/ocio.css`):**
- El `.library-search-input:focus-visible` reemplazó `outline: none` por `outline: 2px solid var(--teal-reel)`.
- Se añadieron estilos `:focus-visible` para 8 componentes: `.view-toggle__btn`, `.chip`, `.season-mark-all`, `.episode-rating__star`, `.cover-picker__item`, `.desc-picker__item`, `.saga-row` (con `:focus-within`), `.sort-select`.

## Alternativas consideradas

- **Usar una librería externa de focus trapping** (ej. `focus-trap`): Descartado porque el proyecto no tiene build tool ni gestor de dependencias npm. La implementación nativa es simple (63 líneas) y suficiente para los casos de uso.
- **Usar `aria-activedescendant` en la búsqueda global**: Descartado por la complejidad adicional; el enfoque actual con `tabindex="0"` y navegación por flechas funciona correctamente con lectores de pantalla.
- **Mantener los `aria-label` redundantes en los switches**: Se valoró mantenerlos por claridad, pero la práctica recomendada por WCAG es no duplicar información cuando ya existe un `<label>` textual asociado. Se optó por `aria-hidden="true"` para evitar confusión en lectores de pantalla.

## Consecuencias

### Positivas
- **Cumplimiento WCAG 2.1 AA**: Se abordan los principios de Perceptible (ARIA labels, landmarks), Operable (teclado, skip link, focus visible) y Robusto (roles correctos, regiones dinámicas).
- **Navegación por teclado completa**: Todos los elementos interactivos son accesibles mediante Tab, Enter, Space y Escape, con gestión de foco adecuada en modales y dropdowns.
- **Experiencia consistente con lectores de pantalla**: La estructura de landmarks, tabpanels y regiones `aria-live` permite una navegación semántica.
- **Código reutilizable**: `focus-utils.js` puede usarse en cualquier nuevo modal o dropdown sin duplicación.
- **Sin regresiones**: Todos los cambios son aditivos o sustitutivos (no se eliminó funcionalidad existente). La gestión de foco es transparente para usuarios de ratón.
- **Documentación del cambio**: Este ADR sirve como referencia de las mejoras aplicadas y la justificación de cada una.

### Negativas
- **Aumento de complejidad en `closeModal()`**: Ahora debe gestionar `_previousActiveElement` y `_focusTrapCleanup`, lo que añade acoplamiento con el estado interno del modal. Sin embargo, el patrón es consistente en todas las funciones que abren modales.
- **Dependencia de propiedades expandidas en elementos DOM**: `_previousActiveElement` y `_focusTrapCleanup` se almacenan como propiedades directas del DOM. Esto podría colisionar con futuros cambios o con otros scripts, aunque es una práctica común en JS sin framework.
- **El skip link no es visible inicialmente**: Por diseño, solo aparece al recibir foco (primer Tab). Esto es estándar en WCAG, pero requiere que el usuario sepa que debe presionar Tab al cargar la página.

### Neutras
- La función `trapFocus` enfoca siempre el primer elemento enfocable del modal. En algunos modales largos (ej. series con muchas temporadas), el usuario podría querer empezar por otro elemento, pero es el comportamiento esperado.
- El manejo de Escape ahora delega la búsqueda global a su propio manejador. Si en el futuro se añaden más paneles modales, habrá que actualizar la cadena de prioridades en `modal-handlers.js`.
- Los atributos `aria-live="polite"` en los paneles se activarán cada vez que se inyecte contenido HTML en ellos, lo que es correcto. Sin embargo, si se actualiza solo una parte del panel (ej. filtrado), podría no anunciarse; para eso está `aria-atomic="true"`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/focus-utils.js` | **Nuevo**: módulo con `getFocusableElements()` y `trapFocus()` (63 líneas) |
| `index.html` | Skip link, `id="main-content"` + `tabindex="-1"` en `<main>`, roles ARIA en profile view, tablist/tab/tabpanel, `aria-live` en paneles, `aria-label` en select, `role="alert"` en toast, `role="dialog"` en notificaciones, `aria-hidden` en switches y flecha |
| `css/styles.css` | Estilos `.skip-link`, `:focus-visible` mejorado global, estilos de foco para 13 componentes, eliminación de `outline:none` en search input, eliminación de override de contraste |
| `ocio/ocio.css` | Focus visible para 8 componentes de ocio, reemplazo de `outline:none` por outline visible en `.library-search-input` |
| `js/ui.js` | Import de `trapFocus`, focus trap + registro en 8 funciones de apertura, restauración de foco en `closeModal()`, soporte por teclado en actividad, `aria-label` en episodios, `aria-hidden` en números de episodio, `alt` descriptivo en avatares |
| `js/modal-handlers.js` | Escape unificado con prioridad: modal > búsqueda > notificaciones |
| `js/global-search.js` | Focus trap, restauración de foco, `tabindex="0"` en resultados, manejadores Enter/Space |
| `js/notifications-setup.js` | Focus trap en dropdown, Escape para cerrar, restauración de foco al botón |
| `js/app.js` | Foco al `<h2>` del panel activo al cambiar de pestaña |
| `js/profile.js` | Sincronización de `aria-selected` en subpestañas del perfil |
