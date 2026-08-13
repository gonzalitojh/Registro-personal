# ADR-099: Nunca zoom en ninguna interacción: touch-action: manipulation y font-size >= 16px en todos los inputs (issue #275)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #275 reportaba **zoom automático en móvil** al pulsar sobre
campos de texto, detectado en la **edición de ejercicios del gimnasio**
(al introducir el nombre del ejercicio), con la exigencia de que la
solución fuese **regla para TODA la web**: nunca zoom en ninguna
interacción.

El ADR-042 (issue #92) ya estableció la política de `font-size >= 16px`
en todos los campos y la regla global `input, textarea, select {
font-size: 16px; }` en `css/styles.css` y `ocio/ocio.css`. **PERO la
regla global es una red de seguridad de baja especificidad**: 7 grupos
de selectores específicos la sobreescribían con `font-size`
0.85–0.9rem (13.6–14.4px), añadidos en desarrollos posteriores al
ADR-042 (recetas, compra, ingredientes y la sección de gimnasio de la
rama de la issue-62), reintroduciendo el zoom en sus campos. Los grupos:

- `.ingredient-modal__field input/select` (0.9rem);
- `.shopping-extra-form__row input/select` + `.ing-combo .ing-nombre`
  (0.85rem);
- `.recipe-form__import-row input` (0.85rem);
- `.recipe-form__field input/textarea` + `.recipe-form__newtag`,
  `.recipe-form__paso` y `.recipe-form__ingrediente input/select`
  (0.88rem);
- `.gym-form__field input/select/textarea` (0.9rem);
- `.gym-exercise-block select/input[type="text"]` (0.9rem);
- `.gym-series-row input` (0.9rem).

Además, el zoom también puede dispararse por **doble toque** sobre
cualquier elemento interactivo (botones, enlaces, campos), con
independencia del `font-size`, vía que el ADR-042 no cubría.

Contexto de ramificación: la decisión se implementa en la rama
`fix/issue-275-evitar-zoom` y se documenta a posteriori, como los ADR
recientes (ADR-093, ADR-094, ADR-095, ADR-096, ADR-097, ADR-098).

Related issue: #275 — https://github.com/gonzalitojh/Registro-personal/issues/275

## Decisión

### 1. Los 7 grupos de selectores específicos suben a 1rem

Se suben los 7 grupos listados en el contexto a `font-size: 1rem`
(16px), **sin tocar colores, paddings ni selectores**, añadiendo en cada
uno el comentario `/* ADR-042: nunca < 16px en inputs */`, siguiendo el
precedente del mismo comentario ya presente en la hoja desde el ADR-042
(líneas 3498/3683 antes del fix; el bloque de `touch-action` de esta
issue las desplaza a ~3503 y ~3688 en el estado final).

### 2. Nueva regla global `touch-action: manipulation` en ambas hojas

Se añade en **ambas** hojas la regla:

```css
button, a, input, select, textarea { touch-action: manipulation; }
```

- en `css/styles.css`, justo **tras la regla global de inputs** del
  ADR-042 (~línea 517);
- en `ocio/ocio.css`, en la **misma posición** al inicio del fichero
  (~línea 17);

ambas con comentario que referencia la issue #275. La regla elimina el
**zoom por doble toque** en cualquier interacción (botones, enlaces,
campos) mientras **mantiene el panning y el pinch zoom**: no deshabilita
el zoom manual, en línea con el ADR-042 y el ADR-016 (sin
`user-scalable=no` ni `maximum-scale=1` en el meta viewport).

### 3. Auditoría sostenible: `scripts/audit-input-font-sizes.py`

Nuevo script que cierra la brecha que dejó la red de seguridad del
ADR-042 (insuficiente contra selectores específicos):

- detecta selectores que declaren `font-size < 16px` sobre
  `input`/`select`/`textarea` en ambas hojas (`css/styles.css` y
  `ocio/ocio.css`), y
- verifica la **presencia de las dos reglas globales** (la de inputs del
  ADR-042 y la de `touch-action` de esta issue).

Devuelve exit 0/1, por lo que es usable en CI y pre-commit como guard
anti-regresión: cualquier campo nuevo por debajo del mínimo o la
eliminación de una regla global falla la auditoría de forma automática.

### 4. Bump de versión de la PWA a `20260929`

Versión `20260928` → `20260929` (vía `scripts/bump-version.sh`) en:

- `index.html`: `?v=20260929` en `css/styles.css`, `ocio/ocio.css` y
  `js/app.js` (sin `user-scalable=no` / `maximum-scale=1` en el meta
  viewport);
- `js/config.js`: `APP_VERSION`;
- `service-worker.js`: `STATIC_ASSETS`.

Para invalidar la caché del service worker y forzar la entrega de los
nuevos CSS.

## Alternativas descartadas

- **Deshabilitar el zoom en el meta viewport** (`user-scalable=no` /
  `maximum-scale=1`): descartado — rompe la accesibilidad (WCAG 1.4.4:
  redimensionado de texto sin pérdida de contenido), el mismo
  razonamiento ya documentado en ADR-042 y ADR-016.
- **Solo subir los campos del gimnasio**: descartado — el reporte venía
  de ahí, pero la regla debe valer para **toda la web**: se auditaron y
  arreglaron los 7 grupos, incluyendo recetas, compra e ingredientes,
  que tenían el mismo defecto latente.
- **Fix por JS** (capturar el foco, `scrollIntoView`, etc.): descartado
  — el zoom por doble toque y al enfocar es comportamiento nativo del
  navegador, no cancelable de forma fiable desde JS; la solución en CSS
  es la vía estándar y sin coste de mantenimiento.

## Consecuencias

### Positivas

- **Sin zoom en toda la web**: ni al enfocar campos (los 7 grupos ya
  cumplen el mínimo de 16px) ni por doble toque en ninguna interacción
  (botones, enlaces, campos), gracias a `touch-action: manipulation`.
- **Pinch zoom manual conservado**: los usuarios con baja visión pueden
  seguir ampliando la página; se mantiene el compromiso de
  accesibilidad del ADR-042/ADR-016.
- **Auditoría automatizada anti-regresión**: el nuevo
  `scripts/audit-input-font-sizes.py` detecta en CI/pre-commit cualquier
  selector que vuelva a bajar de 16px o la pérdida de una regla global;
  la red de seguridad pasiva del ADR-042 queda reforzada con un guard
  activo.

### Neutras

- **Manual de usuario sin cambios**: fix puramente ergonómico, sin
  funciones, estados ni ajustes nuevos; mismo precedente que el ADR-042
  (regla 3 de AGENTS.md no aplica).
- **Sin cambios de contrato en JS**: ninguna función de `js/*.js` se ve
  afectada; solo cambian CSS, versionado y el nuevo script de auditoría.

### Negativas / Riesgos

- **Campos de gym/recetas/compra/ingredientes ligeramente más grandes
  en escritorio**: los inputs/selects de esos formularios pasan de
  0.85–0.9rem a 1rem; es el coste asumido del mínimo de 16px, el mismo
  que ya documentó el ADR-042. Verificar que los anchos flexibles de sus
  contenedores absorben el incremento (ya disponen de `min-width: 0` /
  unidades relativas, por la regla de responsividad de AGENTS.md).
- **Ninguna otra conocida.**

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | **Modificado**: los 7 grupos de selectores específicos (ingredient-modal, shopping-extra-form, recipe-form import/field/newtag/paso/ingrediente, gym-form, gym-exercise-block, gym-series-row) suben de 0.85–0.9rem a `font-size: 1rem` con comentario `/* ADR-042: nunca < 16px en inputs */`; nueva regla global `button, a, input, select, textarea { touch-action: manipulation; }` tras la regla de inputs (~línea 517) con comentario de la issue #275 |
| `ocio/ocio.css` | **Modificado**: nueva regla global `button, a, input, select, textarea { touch-action: manipulation; }` al inicio (~línea 17) con comentario de la issue #275 |
| `index.html` | **Modificado**: `?v=20260928` → `?v=20260929` en `css/styles.css`, `ocio/ocio.css` y `js/app.js` (sin `user-scalable=no` / `maximum-scale=1` en el meta viewport) |
| `js/config.js` | **Modificado**: `APP_VERSION` de `20260928` a `20260929` |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` con `?v=20260929` (invalida las cachés de `20260928` y anteriores) |
| `scripts/audit-input-font-sizes.py` | **Nuevo**: auditoría que detecta selectores `input`/`select`/`textarea` con `font-size < 16px` en ambas hojas y verifica la presencia de las dos reglas globales (inputs del ADR-042 y `touch-action` de la #275); exit 0/1 para CI/pre-commit |
| `docs/adr-099-no-zoom-interacciones-touch-action.md` | **Nuevo**: este documento |

Related issue: #275 — https://github.com/gonzalitojh/Registro-personal/issues/275