# ADR-048: Espacio bajo las pestañas en iPhone (viewport-fit=cover) (issue #116)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

La issue #116 reporta que en iPhone la **barra de inicio del sistema**
(home indicator, la barra que permite cambiar de aplicación) **se monta
sobre la barra de pestañas** fija inferior (`.tabs--bar`, creada en
ADR-040 a partir de la issue #79): las pestañas quedan parcialmente
tapadas por el home indicator y la última fila de la lista también se ve
afectada. El reporte exige que la corrección **no afecte a Android**
(único SO donde no ocurre).

**Causa raíz** (detectada en el análisis inicial): el meta viewport de
`index.html` era `content="width=device-width, initial-scale=1.0"` **SIN
`viewport-fit=cover`**. Sin esa declaración, iOS Safari no extiende el
layout viewport a las **zonas inseguras** (los márgenes que ocupan el
home indicator y el notch) y, en consecuencia, `env(safe-area-inset-
bottom)` devuelve **siempre 0**, aunque el CSS ya la usaba — con fallback
`0px` — en los tres sitios donde se necesita el margen seguro:

1. `css/styles.css` línea ~509: `padding` inferior de `.app` (hueco del
   contenido para que la última fila y el pie no queden tapados por la
   barra inferior).
2. `css/styles.css` línea ~765: `padding-bottom: env(safe-area-inset-
   bottom, 0px)` de `.tabs--bar` (el cascarón fijo `bottom: 0`).
3. `css/styles.css` línea ~938: `bottom` del `.toast`.

Estos tres usos se introdujeron en ADR-040 («iOS PWA contemplada»:
margen seguro en la barra, el hueco de contenido y el toast), pero eran
**inertes**: sin `viewport-fit=cover` iOS siempre reporta 0. En Android
`env(safe-area-inset-bottom)` vale 0 por definición, así que activar el
margen seguro en iOS no altera ese SO.

Related issue: #116 — https://github.com/gonzalitojh/Registro-personal/issues/116

## Decisión

Corrección de **causa raíz en un solo atributo**, sin tocar CSS ni
lógica JS:

### 1. `viewport-fit=cover` en el meta viewport

`index.html` línea 5:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Con `viewport-fit=cover`, iOS Safari extiende el layout viewport a las
zonas inseguras y `env(safe-area-inset-bottom)` devuelve el **margen
real del dispositivo** (p. ej. ~34px en un iPhone con home indicator).
Los tres usos de `env()` que ya existían en `css/styles.css` se activan
**sin ningún cambio de CSS**:

- `.tabs--bar` (línea ~765): se añade el margen seguro bajo las pestañas
  → el home indicator deja de montarse sobre la barra; el espacio extra
  hereda el fondo de la barra (`var(--ink)` en el tema papel,
  `var(--paper-dim)` en el claro, integrados con la web desde ADR-040
  iteración 4) → visualmente integrado.
- `.app` (línea ~509): el hueco inferior del contenido crece el mismo
  margen → la última fila de la lista y el pie nunca quedan tapados por
  la barra ni por el home indicator.
- `.toast` (línea ~938): el aviso flotante se reposiciona por encima de
  la barra + margen seguro → no queda oculto tras el home indicator.

### 2. Android, escritorio e iPad no se ven afectados

En esos entornos `env(safe-area-inset-bottom)` vale 0 y el fallback
`0px` de las tres declaraciones cubre cualquier navegador sin soporte:
el layout es **idéntico al anterior**. En ≥768 px además el
`padding-bottom: 0` de `.tabs--bar` (ADR-040 iteración 4) anula el
margen seguro donde no hay barra inferior, por lo que el iPad no gana
ningún espacio extra. Se cumple el requisito explícito de la issue #116
de no afectar a Android.

### 3. Bump de versión PWA `20260816` → `20260817`

Vía `scripts/bump-version.sh`, en los tres archivos de versionado
(patrón estándar del proyecto, ver ADR-040/ADR-042):

- `index.html`: `?v=20260817` en `css/styles.css`, `ocio/ocio.css` y
  `js/app.js`.
- `js/config.js`: `APP_VERSION` de `20260816` a `20260817`.
- `service-worker.js`: `STATIC_ASSETS` con `?v=20260817` (6 entradas:
  styles, ocio.css, app.js y los tres `ocio/*.html`); invalida las
  cachés de `20260816` y anteriores y fuerza la entrega del `index.html`
  con el nuevo meta viewport.

### 4. Sin cambios de CSS ni de lógica JS; manual de usuario intacto

No se toca `css/styles.css`, `ocio/ocio.css` ni `js/app.js`: el CSS ya
contenía los usos correctos de `env()` y solo faltaba activarlos desde
el viewport. `docs/manual-de-usuario.md` tampoco requiere cambios: la
sección 3 ya describe la barra de pestañas inferior y el margen seguro
es un detalle de dispositivo (mismo precedente que ADR-040 iteración 4,
que no tocó el manual por un cambio equivalente, y ADR-042).

## Alternativas descartadas

- **Añadir `padding-bottom` fijo en px al CSS**: descartado — un valor
  fijo (p. ej. 34px) también añadiría espacio en Android y en iPhones
  sin home indicator, donde el home indicator no existe, incumpliendo el
  requisito de la issue; además no escala entre dispositivos (el margen
  seguro varía) y choca con la regla de responsividad de AGENTS.md de
  evitar `px` fijos en contenedores.
- **Detectar iOS vía JS (`navigator.userAgent`) y aplicar una clase
  condicional**: descartado — frágil (userAgent espolvable y cambiante,
  iPadOS, futuros dispositivos), añade lógica y estado donde el estándar
  `env()` + `viewport-fit=cover` lo resuelve de forma declarativa y sin
  mantenimiento; además sería un workaround de una causa raíz que se
  corrige en un atributo.
- **Tocar el CSS para añadir más usos de `env()`**: descartado — los
  tres usos necesarios (pestañas, hueco de contenido y toast) **ya
  existían** con su fallback; el problema era que iOS los anulaba por la
  ausencia de `viewport-fit=cover`. Añadir más declaraciones no habría
  cambiado nada sin corregir el viewport.

## Consecuencias

### Positivas

- **En iPhone con home indicator la barra del sistema deja de montarse
  sobre las pestañas**: hay un espacio bajo la barra igual al margen
  seguro real del dispositivo (~34px), con el mismo fondo de la web
  (`var(--ink)` / `var(--paper-dim)`) → integrado visualmente, sin
  franjas de otro color.
- **Cero impacto en Android, escritorio e iPad**: `env()` = 0 (y
  fallback `0px`) en esos entornos y anulación en ≥768 px → layout
  idéntico al anterior; se cumple el requisito de la issue #116.
- **Las tres zonas quedan cubiertas con un solo cambio**: la misma
  declaración activa el margen en la barra de pestañas (`.tabs--bar`),
  en el hueco del contenido (`.app`) y en el toast.
- **Corrección de causa raíz mínima**: un atributo en el meta viewport,
  sin cambios de CSS ni de lógica JS → riesgo de regresión casi nulo,
  coherente con el precedente de ADR-042 (fix de causa raíz sin tocar
  la capa equivocada).
- **Los usos de `env()` de ADR-040 dejan de ser inertes**: el diseño
  original («iOS PWA contemplada») se cumple de verdad a partir de esta
  versión.

### Negativas / Riesgos

- **Validación física necesaria en iPhone con home indicator**: el
  efecto no es reproducible en un entorno headless ni en la emulación de
  DevTools (el `env()` real depende del contexto del dispositivo), por
  lo que la comprobación definitiva del criterio de aceptación debe
  hacerse en un iPhone físico con home indicator.
- **Comportamiento distinto entre iPhones**: en modelos sin home
  indicator (botón físico) el margen es 0 y el aspecto no cambia — es el
  comportamiento correcto, pero el espacio solo aparece donde el
  dispositivo lo necesita.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: la sección 3 ya describe
  la barra de pestañas inferior; el margen seguro es un detalle de
  dispositivo (precedente: ADR-040 iteración 4 y ADR-042).
- **PWA versionada a `20260817`**: `APP_VERSION`, `?v=` en `index.html`
  y `STATIC_ASSETS` invalidan las cachés de `20260816` y anteriores.
- **Sin cambios de contrato en JS**: ninguna función de `js/app.js` ni
  de los módulos se ve afectada.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: meta viewport (línea 5) → `width=device-width, initial-scale=1.0, viewport-fit=cover`; `?v=20260816` → `?v=20260817` en `css/styles.css`, `ocio/ocio.css` y `js/app.js` |
| `js/config.js` | **Modificado**: `APP_VERSION` de `20260816` a `20260817` |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` con `?v=20260817` (6 entradas: styles, ocio.css, app.js, series/peliculas/libros.html); invalida las cachés de `20260816` y anteriores |
| `css/styles.css` | **Sin cambios**: ya contenía `env(safe-area-inset-bottom, 0px)` en `.app` (línea ~509), `.tabs--bar` (línea ~765) y `.toast` (línea ~938); solo faltaba activarlos desde el viewport |
| `docs/manual-de-usuario.md` | **Sin cambios**: la sección 3 ya describe la barra de pestañas; el margen seguro es un detalle de dispositivo |
| `docs/adr-048-viewport-fit-home-indicator.md` | **Nuevo**: este documento |

Related issue: #116 — https://github.com/gonzalitojh/Registro-personal/issues/116
