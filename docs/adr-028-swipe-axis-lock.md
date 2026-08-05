# ADR-028: Axis lock en el swipe de la vista de lista — el scroll vertical deja de desplazar las tarjetas (issue #42)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #42 reporta un problema en la **vista de lista** de la biblioteca: el gesto de swipe horizontal (deslizar un ítem para marcarlo como visto/leído) interfería con el scroll vertical. Cualquier micro-movimiento horizontal del dedo durante un scroll vertical (jitter natural) desplazaba las tarjetas horizontalmente — aunque sin llegar a marcarlas como vistas —, porque `touchmove` aplicaba `translateX` al contenido basándose **solo en deltaX**, sin tener en cuenta el movimiento vertical del dedo.

El gesto está implementado en `attachSwipe(row, content, onTrigger)` en `js/ui.js`: `touchstart` activaba el drag incondicionalmente y `touchmove` traducía la tarjeta con `translateX(clamped)` en cada evento. **No existía axis lock (bloqueo de dirección)**: no había forma de distinguir un gesto de scroll vertical de un swipe horizontal hasta que el gesto terminaba. El CSS ya definía `touch-action: pan-y` en `.list-row`, por lo que el scroll vertical nativo funcionaba; **faltaba el bloqueo de dirección en JS**.

Related issue: #42 — https://github.com/gonzalitojh/Registro-personal/issues/42

## Decisión

Implementar **axis lock** (bloqueo de dirección) en `attachSwipe` (`js/ui.js`, líneas 262-332): al cruzar un slop de 10 px se decide **una única vez** la dirección del gesto y no se vuelve atrás. Si el gesto es vertical, se abandona el manejo del swipe (el scroll nativo manda sin transform ni toggle); si es horizontal, se conserva el comportamiento original.

### 1. `touchstart`: captura de `clientX`, `clientY` e `identifier` del dedo

Se captura `touch = e.changedTouches[0]` y se guardan `startX = touch.clientX`, `startY = touch.clientY` y `startTouchId = touch.identifier`. Se activa `dragging = true` y se añade la clase `is-dragging`. El trackeo por `identifier` garantiza seguir al dedo original aunque haya más dedos sobre la pantalla.

### 2. `touchmove`: cálculo de `deltaX`/`deltaY` y decisión única de dirección (slop de 10 px)

Se localiza el dedo original por `identifier` (`Array.from(e.touches).find(...) ?? e.touches[0]`) y se calculan `deltaX = touch.clientX - startX` y `deltaY = touch.clientY - startY`. Solo cuando `|deltaX| >= 10` **o** `|deltaY| >= 10` (slop `lockThreshold = 10`) y aún no hay lock se decide la dirección:

- `|deltaX| > |deltaY|` → `lock = "horizontal"`.
- En caso contrario (**empate incluido**) → `lock = "vertical"` (el scroll siempre manda).

Una vez decidido, `lock` es **inmutable** durante el resto del gesto (criterio de aceptación 5: la decisión no cambia a mitad de camino).

### 3. `lock === "vertical"`: return temprano sin transform ni toggle

Si el gesto se bloqueó como vertical, `touchmove` hace `return` inmediato: **no** se aplica `translateX`, **no** se alterna `swipe-reveal` ni se pinta el fondo de swipe. El scroll vertical nativo (habilitado por `touch-action: pan-y`) opera sin interferencia. Este es el fix central: el jitter horizontal del scroll deja de desplazar las tarjetas.

### 4. `lock === "horizontal"`: comportamiento original preservado

Si el gesto es horizontal, se conserva la lógica previa:

- `clamped = Math.max(-120, Math.min(120, deltaX))` → `content.style.transform = translateX(clamped)`.
- `row.classList.toggle("swipe-reveal", Math.abs(clamped) > 24)`: el fondo de swipe se revela solo al superar 24 px de desplazamiento horizontal.

### 5. `touchend`: disparo de la acción rápida solo con lock horizontal

Antes de resetear, se evalúa `shouldTrigger = lock !== "vertical" && Math.abs(deltaX) > threshold` (con `threshold = 70`). Solo entonces se invoca `onTrigger()` — la acción rápida (marcar como visto/leído, siguiente episodio). Los gestos bloqueados como verticales nunca disparan la acción, aunque el dedo acabe con `deltaX` alto tras un giro del gesto.

### 6. `touchcancel` y `resetGesture` compartido

Se añade un handler `touchcancel` que comparte el mismo reset que `touchend` (`resetGesture`): restablece `dragging`, elimina `is-dragging` y `swipe-reveal`, limpia `content.style.transform`, y resetea `lock`, `startTouchId` y `deltaX`. Así no queda estado colgado (transform residual o clase `is-dragging`) si el navegador cancela el gesto (p. ej. por un cambio de orientación o una interrupción del sistema).

### 7. Sin cambios en CSS: `passive: true` y `touch-action: pan-y` intactos

- Los listeners siguen siendo `passive: true` (el scroll vertical no se ve afectado, criterio de aceptación 4).
- El CSS **no se toca**: `touch-action: pan-y` ya existía en `.list-row` (`ocio/ocio.css`) y permitía el scroll nativo.
- El cambio es **solo JS** (`js/ui.js`, `attachSwipe`); `renderList` y el resto del flujo no cambian.

## Alternativas descartadas

- **`touch-action: none` sobre `.list-row`**: bloquearía el scroll nativo por completo y obligaría a implementar scroll manual por JS — descartada: rompe el scrolling del navegador y contradice el criterio de aceptación 4.
- **Solo subir el umbral de disparo de la acción rápida** (p. ej. `threshold` mayor): no resuelve el problema: el `translateX` se sigue aplicando durante el gesto y el **jitter visual** (tarjetas que se desplazan y vuelven) persistiría, aunque nunca llegara a dispararse la acción.
- **No hacer nada**: el bug persistía (las tarjetas se desplazaban horizontalmente durante el scroll vertical), que es exactamente lo que reporta la issue.

## Consecuencias

### Positivas
- **Fix central de la issue**: el scroll vertical ya no mueve las tarjetas ni un píxel (criterio de aceptación 1) ni revela el fondo de swipe (criterio 3): cualquier gesto con componente vertical dominante se trata como scroll desde el primer cruce del slop.
- **Swipe horizontal intencional intacto**: deslizar una tarjeta ≥ 70 px y soltarla sigue disparando la acción rápida (criterio 2); el clamp a ±120 px y el reveal > 24 px se conservan.
- **Decisión de dirección inmutable**: el lock se decide una vez y no cambia a mitad de gesto (criterio 5).
- **Cambio aislado y sin riesgo de regresión visual**: solo `js/ui.js` (+42/-7), sin tocar CSS ni `renderList`.
- **QA aprobado**: 5/5 criterios de aceptación verificados por `qa-reviewer` con traces de coordenadas (scroll con jitter → lock vertical sin transform; swipe 71 px+ dispara; reveal solo con lock horizontal; `passive` + `pan-y` intactos; lock inmutable). Seguridad: **SIN HALLAZGOS (PASS)** — único hallazgo LOW pre-existente (API keys de cliente en `js/config.js`, no introducido por este cambio).

### Negativas
- **Los gestos diagonales ambiguos se tratan como scroll**: si un dedo se mueve ~45°, la decisión depende del cruce del slop y puede interpretarse como vertical; es el trade-off aceptado para que el scroll vertical siempre tenga prioridad.

### Neutras
- **El empate gana `vertical`**: `|deltaX| > |deltaY|` (estrictamente mayor) es la única vía a horizontal; en empate manda el scroll — decisión **conservadora** que evita desplazamientos falsos.
- **`touchcancel` deja el estado limpio**: el reset compartido evita transform residual o `is-dragging` colgada tras una cancelación del sistema.
- **Sin cambios de contrato**: `attachSwipe(row, content, onTrigger)` conserva su firma; los consumidores (`renderList`) no cambian.
- **Sin bump de versión PWA**: el cambio toca solo JS ya precacheados; sin embargo, para propagar correctamente a los clientes cache-first, el JS debe servirse bajo una ref versionada o con revalidación (señalado para la revisión del bump al cierre de la issue).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | `attachSwipe` (líneas 262-332): axis lock con slop de 10 px (`lockThreshold`), `lock` inmutable `'vertical'`/`'horizontal'` (empate → vertical), seguimiento del dedo por `identifier` (`changedTouches[0]` en `touchstart`, `e.touches.find(...)` en `touchmove`), return temprano si `lock === 'vertical'`, comportamientos horizontal/touchend/touchcancel documentados, `resetGesture` compartido; listeners `passive: true` |
| `docs/adr-028-swipe-axis-lock.md` | **Nuevo**: este documento |

Related issue: #42 — https://github.com/gonzalitojh/Registro-personal/issues/42