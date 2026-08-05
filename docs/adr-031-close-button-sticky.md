# ADR-031: Botón de cierre fijo (sticky) en los modales — la ✕ siempre visible al hacer scroll (issue #26)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #26 reporta que el botón ✕ del modal de detalle no era visible al hacer scroll: al abrir un modal con contenido largo (p. ej. una sinopsis extensa), el botón de cierre desaparecía junto con el header del modal y el usuario debía volver a scrollear hasta arriba para poder cerrarlo.

**Causa raíz**: `.modal__card` (padre directo del botón) es el scroll container del modal (`overflow-y: auto; max-height: 88vh`). Con `position: absolute`, la ✕ se posicionaba respecto al card completo y, al hacer scroll, se desplazaba junto con el contenido: el botón quedaba fuera del área visible. La regla `.modal__close` es compartida por los dos modales del proyecto, ambos con la estructura `.modal__card > .modal__close`: `#item-modal` (serie, película, libro, edición, alta manual, saga, preview de búsqueda y ficha de amigo) y `#rating-modal` (valoración, issue #21).

La decisión fue tomada siguiendo el plan del task-architect; QA aprobó con 5/5 criterios y la revisión de seguridad quedó limpia. Es un cambio exclusivamente de CSS: sin tocar HTML ni JS.

Related issue: #26 — https://github.com/gonzalitojh/Registro-personal/issues/26

## Decisión

Cambiar la regla `.modal__close` en `css/styles.css` de `position: absolute` a **`position: sticky`**, anclando la ✕ al borde superior del scroll container y convirtiéndola en un **chip** con el color del card:

- `position: sticky; top: 0.7rem; right: 0.7rem` — el botón se mantiene pegado al área visible del scroll container mientras se hace scroll; `top` fija su distancia al borde superior visible y `right` refuerza el anclaje al borde derecho.
- `display: block; width: fit-content; margin-left: auto` — al estar en flujo (ya no es absoluto), el botón ocupa su propia línea y se alinea a la derecha del card.
- `background: var(--paper)` — el mismo color que `.modal__card`: la ✕ actúa como chip que tapa limpio el contenido que pasa por debajo al scrollear, manteniendo la legibilidad del botón.
- `border-radius: var(--radius)` — esquinas redondeadas consistentes con las del card.

El resto de la regla no cambia: `border: none`, tamaño (`font-size: 1.1rem`), color (`var(--ink-soft)`), `line-height: 1`, `padding: 0.3rem` y el hover (`color: var(--ink)`) se mantienen, así como la regla `.modal__close:focus-visible` existente.

Al ser una regla compartida, la solución aplica automáticamente a los dos modales (`#item-modal` y `#rating-modal`) sin cambios en `index.html` ni en `js/ui.js`.

## Alternativas descartadas

- **B1: flex column con scroll interno en `#modal-content`**: descartado — mover el scroll a un contenedor hijo cambia el modelo de caja del armazón compartido de los modales, con riesgo de regresiones en los muchos flujos que re-renderizan `#modal-content` (edición, alta, preview de búsqueda, confirmación multi-portada de libros, etc.).
- **B2: wrapper HTML `.modal__scroll`**: descartado — requiere tocar `index.html` y re-verificar el focus trap de los modales (el wrapper altera el orden de tabulación), para un problema que se resuelve con una única propiedad CSS.

## Consecuencias

### Positivas
- **✕ siempre visible**: al hacer scroll dentro del modal, el botón de cierre permanece anclado al borde superior; ya no hay que volver arriba para cerrar.
- **Chip invisible en reposo**: en reposo el botón no se superpone al contenido — al estar en flujo y con `background: var(--paper)` idéntico al card, el chip queda integrado y se elimina el **solapamiento latente** que existía con títulos largos del header del modal.
- **Un solo cambio, dos modales**: la regla compartida da el mismo comportamiento a `#item-modal` y `#rating-modal` sin tocar HTML ni JS; la valoración (`modal__card--small`) hereda el fix sin ajustes extra.
- **Compatibilidad amplia**: `position: sticky` es universal en navegadores modernos (Chrome 56+, Firefox 59+, Safari 13+ desde ~2020); sin degradación para el público objetivo.

### Negativas
- **El botón ocupa una línea propia en el flujo del card**: añade un pequeño espacio vertical al inicio del modal que antes no existía (la ✕ flotaba sobre el header). Es el coste que elimina el solapamiento y es mínimo (≈1.1rem).

### Neutras
- **Sin cambios de contrato**: ninguna función de `js/ui.js` ni estructura de `index.html` se ve afectada; las propiedades visuales restantes de `.modal__close` (hover, color, foco) no cambian.
- **`right: 0.7rem` con `position: sticky` no desplaza el botón en reposo**: el anclaje efectivo lo dan `top` + `margin-left: auto`; `right` queda como refuerzo declarativo del anclaje derecho.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | `.modal__close`: `position: absolute` → `position: sticky; top: 0.7rem; right: 0.7rem`, con `display: block; width: fit-content; margin-left: auto` (anclado a la derecha), `background: var(--paper)` como chip que tapa el contenido al scrollear y `border-radius: var(--radius)` |
| `docs/adr-031-close-button-sticky.md` | **Nuevo**: este documento |

Related issue: #26 — https://github.com/gonzalitojh/Registro-personal/issues/26
