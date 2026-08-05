# ADR-027: Revisión general de responsividad — fixes de causa raíz en CSS (issue #41)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #41 pide una **revisión general de responsividad de toda la web**: la aplicación (SPA vanilla JS + Firebase) debe verse correctamente en ordenador, tablet y móvil, en cualquier ancho de pantalla, sin desplazamiento horizontal a nivel de página ni texto fuera de pantalla. El alcance cubre `index.html`, las páginas `ocio/*.html`, `css/styles.css`, `css/ocio.css` y el markup dinámico generado en `js/ui.js`.

El proyecto ya contaba con la regla «Responsividad obligatoria» definida en `AGENTS.md` (ADR-026), con 4 criterios verificables:

1. **Sin scroll horizontal a nivel de página** en ningún ancho; el scroll horizontal solo está permitido dentro de contenedores diseñados para ello (p. ej. tablas con `overflow-x: auto`).
2. **Ningún texto fuera de pantalla**: títulos, fechas, nombres de autores y sinopsis largas deben ajustarse a su contenedor (`overflow-wrap: break-word`, `min-width: 0` en hijos de flex/grid, unidades relativas). No se trunca contenido esencial con ellipsis en móvil.
3. **Unidades relativas** (%, rem, em, fr, vw/vh, `minmax()`) para anchos, columnas y tipografía de cuerpo; evitar `px` fijos en contenedores de ancho completo.
4. **Prohibido `overflow-x: hidden` en `body`/`html` como parche**: enmascara el desbordamiento y puede cortar contenido; siempre se corrige la causa raíz.

La auditoría del arquitecto detectó desbordes reales en varios componentes en viewports móviles (~360 px) y ultrapequeños (< 340 px): el toast (mensajes largos y los de tipo undo), los nombres de episodios, las cuadrículas (biblioteca, estadísticas, amigos), el buscador de la biblioteca, el header del modal de detalle, las filas de notificaciones y ajustes, las 5 subpestañas del perfil y el header de la aplicación. Además, varios textos de tarjetas y resultados usaban `nowrap` + ellipsis, truncando contenido esencial en móvil.

Related issue: #41 — https://github.com/gonzalitojh/Registro-personal/issues/41

## Decisión

Corregir los desbordes en su **causa raíz** (CSS), sustituir el truncado por ellipsis con **line-clamp** en contenido esencial en móvil, compactar los componentes que desbordaban (subpestañas del perfil y header) y **bump de versión PWA** para propagar los cambios a los clientes con caché cache-first. No se usa `overflow-x: hidden` como parche en ningún caso.

### 1. Fixes de causa raíz en CSS (`css/styles.css` y `ocio/ocio.css`)

Se corrigieron los desbordes detectados con `overflow-wrap` y `min-width: 0` (hijos de flex/grid), sin enmascarar el problema:

- **`.toast`**: `max-width: min(480px, calc(100vw - 2rem))` + `overflow-wrap: anywhere`; el texto de los toasts (incluido `.toast--undo span`, que recibe `flex: 1` + `min-width: 0`) envuelve líneas en cualquier palabra, y **solo el botón de deshacer mantiene `nowrap`**.
- **`.episode-row__name`**: `min-width: 0` + `overflow-wrap: anywhere` (nombres de episodios largos sin espacios ya no desbordan la fila).
- **Cuadrículas con `minmax(min(Npx, 100%), 1fr)`** para soportar viewports < 340 px: `.library-grid` (`min(150px, 100%)`), `.stats-grid` (`min(280px, 100%)`), `.friends-list` (`min(120px, 100%)`) y `.cover-picker` (`min(150px, 100%)`).
- **`.search-slip input`**: `min-width: 0` (el input del buscador de la biblioteca ya no empuja al contenedor).
- **Modal de detalle**: `.modal-detail__header > div` con `min-width: 0` y `.modal-detail__title` con `overflow-wrap: anywhere` (títulos largos sin espacios envuelven en lugar de desbordar el modal).
- **`.notif-row__text`** y **`.settings-row label:first-child`**: `min-width: 0` + `overflow-wrap: anywhere` (texto de notificaciones y etiquetas de ajustes largas envuelven; el select/switch permanece intacto).
- **Dropdown de notificaciones (`.notif-dropdown`)**: en móvil el header envuelve en dos filas y el ancla absoluta (`right: 0` respecto a `.user-badge`) quedaba a la izquierda de la pantalla, abriendo el panel fuera del viewport. Fix doble: `.user-badge` con `margin-left: auto` (ancla a la derecha cuando envuelve) y `@media (max-width: 600px)` con `position: fixed; left: 1rem; right: 1rem; top: 4.5rem; width: auto` (el panel se ancla al viewport: por construcción nunca puede desbordar horizontalmente).

### 2. Truncado con line-clamp en vez de nowrap + ellipsis (contenido esencial en móvil)

El contenido esencial (títulos, textos de actividad) pasa de `nowrap` + ellipsis a **line-clamp de 2-3 líneas** en los anchos donde antes se truncaba:

- **`.activity-event__text`**: clamp de 3 líneas en todos los anchos (texto del feed de actividad).
- **`.list-row__title`**: clamp de 2 líneas en todos los anchos.
- **`.friend-card__name`**: clamp de 2 líneas (nombres de amigos largos).
- **`.result-card__title`**: clamp de 2 líneas.
- **`.global-search__item-title` / `.global-search__item-meta`**: clamp de 2 líneas **solo ≤ 600 px**; en desktop conservan `nowrap` + ellipsis + atributo `title`.
- **`.item-card__meta`**: clamp de 2 líneas **solo ≤ 480 px**; en desktop conserva `nowrap` + ellipsis + `title` (decisión del ADR-003).

El atributo `title` se mantiene en el markup dinámico (`js/ui.js`) para recuperar el contenido truncado en desktop (tooltip nativo).

### 3. Subpestañas del perfil (`.profile-subtabs`) — wrap en vez de ocultar

Las 5 pestañas del perfil (Estadísticas, Amigos, …) desbordaban el viewport en móvil. Se corrigió con `flex-wrap: wrap` + media query ≤ 480 px con paddings y `font-size` reducidos (`padding: 0.3rem 0.6rem`, `font-size: 0.78rem`, `justify-content: center`). **Ninguna pestaña se oculta** y el botón de logout nunca se oculta.

### 4. Header compacto en ≤ 480 px

Media query que reduce gaps y paddings de `.app-header__top` (`gap: 0.5rem`, `margin-bottom: 1rem`), `.app-title` (`font-size: 1.45rem`) y `.user-badge` (`gap: 0.4rem`, `.btn--ghost` con `padding: 0.3rem 0.6rem` y `font-size: 0.78rem`). La fila superior ya envuelve en dos líneas (`flex-wrap: wrap`) sin desbordar y **sin ocultar el botón "Salir"**.

### 5. Bump de versión PWA a `20260805`

Se ejecutó `scripts/bump-version.sh` para invalidar la caché del service worker (estrategia cache-first, ADR-019) y propagar los cambios CSS/HTML:

- `js/config.js`: `APP_VERSION` → `'20260805'`.
- `index.html`: refs versionadas `?v=20260805` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).
- `service-worker.js`: `STATIC_ASSETS` actualizados a `?v=20260805` (incluidos los fragmentos `ocio/*.html`).

### 6. Respeto de decisiones previas

La revisión **no** altera decisiones documentadas anteriormente:

- **ADR-003**: `.item-card__meta` conserva ellipsis + `title` en desktop (el clamp solo aplica ≤ 480 px).
- **ADR-016**: no se tocan los patrones de accesibilidad (focus, ARIA, contraste).
- **ADR-017**: `.trailer-btn__label` conserva `white-space: nowrap` intacto.
- Los **scrolls horizontales diseñados** (`.results-strip`, `.cover-picker`, `.recommendations__scroll`) se mantienen: son contenedores pensados para scroll horizontal, permitidos por la regla 1 de `AGENTS.md`.

## Alternativas descartadas

- **`overflow-x: hidden` en `body`/`html` como parche**: descartado por prohibición explícita de `AGENTS.md` (ADR-026): enmascara el desbordamiento y puede cortar contenido. Todos los desbordes se corrigieron en su causa raíz.
- **Ocultar subpestañas del perfil en móvil**: se valoró mostrar solo un subconjunto de las 5 pestañas, pero ocultaría funcionalidad; `flex-wrap: wrap` + compactación conserva el 100 % de las pestañas visibles.
- **Ellipsis (`text-overflow: ellipsis` con `nowrap`) generalizado para títulos**: descartado porque la regla 2 de `AGENTS.md` prohíbe truncar contenido esencial en móvil; el line-clamp envuelve hasta 2-3 líneas conservando la legibilidad.
- **Mantener `px` fijos en contenedores de ancho completo**: descartado por la regla 3; las cuadrículas usan `minmax(min(Npx, 100%), 1fr)` y el toast `calc(100vw - 2rem)` para degradar en viewports pequeños.

## Consecuencias

### Positivas
- **Sin desbordes en ningún ancho**: verificados los 6 criterios de aceptación de la issue — visualización correcta en 360/768/1280 px, `document.documentElement.scrollWidth <= window.innerWidth` en los 3 anchos, `overflow-wrap`/`min-width: 0` aplicados, sin `px` fijos en contenedores de ancho completo, sin `overflow-x: hidden` en `body`/`html`, y scroll horizontal solo en contenedores diseñados (`.results-strip`, `.cover-picker`, `.recommendations__scroll`).
- **Contenido esencial legible en móvil**: line-clamp de 2-3 líneas en vez de ellipsis; el contenido truncado sigue recuperable en desktop vía atributo `title`.
- **Sin pérdida de funcionalidad**: ninguna pestaña del perfil ni el botón de logout se ocultan en móvil.
- **QA y seguridad**: QA validó los 6 criterios de aceptación y el security scan no reportó hallazgos HIGH.
- **Propagación garantizada**: el bump a `20260805` invalida la caché cache-first del service worker, de modo que los clientes reciben los nuevos estilos.

### Negativas
- **Cambios amplios en CSS**: la revisión toca un número alto de selectores en `css/styles.css` y `ocio/ocio.css`, lo que incrementa el riesgo de conflicto con futuras ramas; mitigado por el bump de versión y por la cobertura de QA en los 3 anchos.
- **Line-clamp requiere `display: -webkit-box`**: el soporte del prefijo `-webkit-` es universal en navegadores modernos, pero el clamp no degrada elegantemente si un navegador no lo soporta (el contenido se mostraría completo, sin truncar — degradación aceptable).

### Neutras
- **No se modifica `js/ui.js`**: el atributo `title` ya existía en el markup dinámico; el cambio es puramente CSS + bump de versión.
- **`.item-card__title` ya usaba clamp de 2 líneas**; la revisión lo confirma y extiende el patrón al resto de títulos, unificando el criterio.
- El toast con botón de deshacer (`.toast--undo`) ahora puede ocupar más alto en móvil al envolver el texto, pero el botón permanece en la misma línea (nowrap).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | `.toast` con `max-width: min(480px, calc(100vw - 2rem))` + `overflow-wrap: anywhere` (y `.toast--undo span` con `flex: 1` + `min-width: 0`), `.notif-row__text` y `.settings-row label:first-child` con `min-width: 0` + `overflow-wrap: anywhere`, `.stats-grid`/`.friends-list` con `minmax(min(Npx, 100%), 1fr)`, `.friend-card__name` clamp 2, `.global-search__item-title/meta` clamp 2 ≤ 600 px, `.profile-subtabs` con `flex-wrap: wrap` + compactación ≤ 480 px, header compacto ≤ 480 px (`.app-header__top`, `.app-title`, `.user-badge`), `.user-badge` con `margin-left: auto`, `.notif-dropdown` con `position: fixed` ≤ 600 px |
| `ocio/ocio.css` | `.episode-row__name` con `min-width: 0` + `overflow-wrap: anywhere`, `.library-grid`/`.cover-picker` con `minmax(min(Npx, 100%), 1fr)`, `.search-slip input` con `min-width: 0`, `.modal-detail__header > div` con `min-width: 0` y `.modal-detail__title` con `overflow-wrap: anywhere`, `.activity-event__text` clamp 3, `.list-row__title` clamp 2, `.result-card__title` clamp 2, `.item-card__meta` clamp 2 ≤ 480 px (desktop conserva ellipsis + title del ADR-003); `.trailer-btn__label` nowrap intacto (ADR-017) |
| `js/config.js` | `APP_VERSION` → `'20260805'` |
| `index.html` | Refs versionadas `?v=20260805` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`) |
| `service-worker.js` | `STATIC_ASSETS` actualizados a `?v=20260805` (incluidos fragmentos `ocio/*.html`) |
| `scripts/bump-version.sh` | **Usado** (sin cambios) para ejecutar el bump de versión |
| `docs/adr-027-responsividad-review.md` | **Nuevo**: este documento |

Related issue: #41 — https://github.com/gonzalitojh/Registro-personal/issues/41
