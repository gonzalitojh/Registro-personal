# ADR-042: No zoom automático en campos de entrada: font-size >= 16px en todos los inputs (issue #92)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

La issue #92 reportaba que la web hacía **zoom automático en móvil** al
pulsar sobre los campos de escritura: la barra de búsqueda superior, el
formulario de añadir un ítem manualmente y otros inputs/selects/textarea
de la aplicación (fechas de historial, fechas por episodio, selects de
ordenación, etc.) ampliaban la página al recibir el foco, obligando al
usuario a hacer zoom-out para recuperar la vista.

**Causa raíz**: iOS Safari y Android Chrome aplican un zoom automático
de la página al enfocar un `input`, `textarea` o `select` cuyo
`font-size` calculado es **menor de 16px**. El proyecto usaba fuentes
pequeñas (0.72rem–0.95rem) en la mayoría de los campos para compactar
las barras de búsqueda, formularios y filas de fechas, lo que disparaba
el comportamiento en prácticamente todos los campos del sitio.

**Restricción de accesibilidad**: no se contempló deshabilitar el zoom
manual con `user-scalable=no` / `maximum-scale=1` en el meta viewport,
porque rompe la accesibilidad (usuarios con baja visión que necesitan
ampliar la página). La solución tenía que eliminar el zoom **automático**
manteniendo intacto el zoom **manual**.

Related issue: #92 — https://github.com/gonzalitojh/Registro-personal/issues/92

## Decisión

**Política permanente: ningún campo de entrada (input, textarea, select)
puede tener un `font-size` calculado menor de 16px (1rem) en ningún
ancho de pantalla. Queda prohibido deshabilitar el zoom manual
(`user-scalable=no` / `maximum-scale=1`).**

La implementación se hizo con una doble capa en CSS:

### 1. Regla global de red de seguridad (ambas hojas)

- `css/styles.css`: `input, textarea, select { font-size: 16px; }`
  añadida justo **tras el reset** (`* { box-sizing: border-box }`), con
  comentario que referencia la issue #92 y explica la causa raíz.
- `ocio/ocio.css`: la **misma regla global** al inicio del fichero,
  también con el comentario de la issue #92.

La regla global garantiza que **cualquier** campo nuevo o regla
específica que se añada en el futuro nunca pueda quedar por debajo del
mínimo: aunque un selector específico defina un tamaño menor, la regla
de red de seguridad no queda invalidada en los casos reportados, y
cualquier campo **sin** regla específica nace ya con 16px.

### 2. Subida a 1rem de los selectores específicos con font-size < 16px

Se subieron a `font-size: 1rem` (16px) los ~12 selectores específicos
que declaraban tamaños menores (0.72rem–0.95rem), cubriendo los
siguientes grupos:

- Barra de búsqueda superior (`#global-search-input`, `.search-bar-wrap`)
  y búsquedas de catálogo/lista (`search-slip input`,
  `.library-search-input`).
- Formulario de alta manual (`manual-form input`, `.field-group
  input/select/textarea`).
- Estadísticas y ajustes (settings).
- Fechas de historial (`log-row input[type="date"]`,
  `log-add-row input[type="date"]`) y fechas por episodio
  (`.episode-row input.episode-date`).
- Selects de ordenación (`.sort-select`) y demás campos restantes.

### 3. Ajustes de ancho para acomodar la fuente mayor

- `.episode-row input.episode-date`: `width: min(150px, 100%)` — se
  mantiene compacta en escritorio y no desborda en móvil.
- `.library-search-input`: `width: clamp(150px, 30vw, 200px)` con
  `max-width: 100%` — escala con el viewport sin romper la barra de
  búsqueda.

### 4. Media query parcial eliminado

Se eliminó el `@media (max-width: 768px)` **parcial** previo de
`css/styles.css` que solo forzaba 16px en los campos de estadísticas: la
regla global lo hace innecesario y dejaba el resto de campos descubiertos
en móvil. En `ocio/ocio.css` se mantiene un media query equivalente que
refuerza los 16px en los campos propios de ocio en pantallas ≤768px.

### 5. Bump de versión de la PWA

`20260815` → `20260816` en `index.html` (`?v=` de `css/styles.css`,
`ocio/ocio.css` y `js/app.js`), `js/config.js` (`APP_VERSION`) y
`service-worker.js` (`STATIC_ASSETS`), para invalidar la caché del
service worker y forzar la entrega de los nuevos CSS.

### 6. No deshabilitar el zoom manual

No se añadió `user-scalable=no` ni `maximum-scale=1` al meta viewport:
el zoom manual del usuario se conserva íntegro (verificado: ninguna
ocurrencia en `index.html`).

## Alternativas descartadas

- **Deshabilitar el zoom en el meta viewport** (`user-scalable=no`,
  `maximum-scale=1`): descartado — es la solución más simple pero rompe
  la accesibilidad (WCAG 1.4.4: redimensionado de texto sin pérdida de
  contenido); además, el propio ADR-016 (revisión de accesibilidad) ya
  fijó el compromiso de no limitar el zoom del usuario.
- **Solo subir los selectores específicos, sin regla global**:
  descartado — cualquier campo nuevo con font-size < 16px reintroduciría
  el bug silenciosamente; la regla global es la red de seguridad que
  hace la política sostenible a futuro.
- **Capturar el foco y hacer `scrollIntoView`/ajustes por JS**:
  descartado — el zoom automático es comportamiento nativo del
  navegador, no cancelable de forma fiable desde JS; la solución en CSS
  es la vía estándar y sin coste de mantenimiento.
- **Solo el media query móvil (≤768px) con 16px**: descartado — era el
  enfoque parcial previo; dejaba campos descubiertos y duplicaba lógica
  en vez de fijar la política en una única regla base.

## Consecuencias

### Positivas

- **Sin zoom automático en móvil**: enfocar cualquier campo de la web
  (búsqueda, formularios, fechas, selects) ya no amplía la página en iOS
  Safari ni Android Chrome; UX móvil correcta en el flujo completo de
  escritura.
- **Zoom manual intacto**: los usuarios con baja visión pueden seguir
  ampliando la página; se respeta el compromiso de accesibilidad del
  ADR-016.
- **Política a prueba de futuro**: la regla global `input, textarea,
  select { font-size: 16px }` en ambas hojas garantiza que ningún campo
  nuevo pueda quedar por debajo del mínimo sin revisión explícita
  (cualquier rebaja futura requiere vencer la regla base a propósito).
- **Una sola causa raíz, una solución en CSS**: sin cambios de HTML ni
  de JS; el bump de versión asegura que la caché del service worker no
  sirva los CSS antiguos.

### Negativas / Consideraciones

- **Campos ligeramente más grandes en escritorio**: los inputs/selects
  pasan de ~0.72–0.95rem a 1rem, por lo que ocupan algo más de espacio
  vertical en barras compactas (búsquedas, filas de fechas, selects de
  ordenación). Es el coste asumido del mínimo de 16px.
- **Vigilar anchos fijos en futuros desarrollos**: al crecer la fuente,
  cualquier ancho fijo en píxeles de un campo (o de su contenedor) puede
  desbordar en móvil; los desarrollos futuros deben usar unidades
  relativas o `min()/clamp()`/`max-width: 100%` como en los ajustes de
  este ADR (ver regla de responsividad de AGENTS.md).
- **La regla global puede sorprender a quien declare font-size < 16px en
  un campo nuevo**: el resultado será el esperado por la política
  (16px), pero quien lo escriba debe saber que la regla de red de
  seguridad lo neutraliza por diseño.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: el cambio es puramente
  visual/ergonómico (el texto en los campos es ahora 16px y no hay zoom
  automático); no altera ninguna función, estado, ajuste ni
  comportamiento visible que el manual deba describir.
- **Sin cambios de contrato en JS**: ninguna función de `js/ui.js` ni
  `js/app.js` se ve afectada; solo cambian CSS y versionado.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | **Modificado**: regla global `input, textarea, select { font-size: 16px; }` tras el reset con comentario de la issue #92; eliminado el `@media (max-width: 768px)` parcial que solo cubría los campos de estadísticas; selectores específicos subidos a 1rem |
| `ocio/ocio.css` | **Modificado**: regla global `input, textarea, select { font-size: 16px; }` al inicio con comentario de la issue #92; selectores específicos subidos a 1rem; `.episode-row input.episode-date` → `width: min(150px, 100%)`; `.library-search-input` → `width: clamp(150px, 30vw, 200px)` (+ `max-width: 100%`); media query ≤768px de refuerzo en campos de ocio |
| `index.html` | **Modificado**: `?v=20260815` → `?v=20260816` en `css/styles.css`, `ocio/ocio.css` y `js/app.js` (sin `user-scalable=no` / `maximum-scale=1` en el meta viewport) |
| `js/config.js` | **Modificado**: `APP_VERSION` de `20260815` a `20260816` |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` con `?v=20260816` (invalida las cachés de `20260815` y anteriores) |
| `docs/adr-042-no-zoom-inputs-16px.md` | **Nuevo**: este documento |

Related issue: #92 — https://github.com/gonzalitojh/Registro-personal/issues/92
