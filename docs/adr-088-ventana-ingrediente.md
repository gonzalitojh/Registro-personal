# ADR-088: Ventana de ingrediente — solo lectura con ✏️ Editar, nombre y foto editables, sin botón «Cerrar» (issue #232)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #232 pide convertir la **ventana de ingrediente** (la que se
abre al pulsar la tarjeta de un ingrediente en la pestaña «Ingredientes»
de la sección de Recetas, issue #64) en una **versión solo lectura con
edición explícita**:

1. **Solo lectura por defecto**, con un botón de **lápiz** para pasar a
   edición.
2. En edición, poder cambiar **también el nombre** y añadir una **foto**.
3. **Sin imagen vacía / placeholder** cuando el ingrediente no tiene
   foto.
4. **Eliminar el botón «Cerrar» inferior** (la ✕ superior cumple esa
   función, mismo criterio que ADR-087 para las recetas).
5. **Eliminar el texto «Categoría actual: X. La lista de la compra se
   agrupa por esta categoría.»** que aparecía al final del detalle.

Estado previo: al pulsar la tarjeta de un ingrediente se abría un modal
con **campos editables directamente** — select de categoría, chips de
supermercados y cantidad del paquete — con **guardado inmediato** al
cambiar cada campo («Categoría actualizada.», «Supermercados
actualizados.», etc.), un botón **«Cerrar» inferior** y el texto
«Categoría actual: …» al final. El nombre no se podía editar desde el
detalle (solo en el alta manual, ADR-085) y no existía la foto de
ingrediente.

Nota del flujo (misma excepción que ADR-083, ADR-085 y ADR-087): la
base de trabajo es la rama `content/issue-64-seccion-recetas`; la rama
`content/issue-232-ventana-ingrediente` se crea desde ahí y la PR va
**también a esa rama, no a `dev`**. El ADR se numera **088** (el 087 ya
lo ocupa la pestaña de Recetas, issue #234).

## Decisión

1. **Vista lectura** (`ingredientDetailHtml`): el **nombre como
   título** (`ingredient-modal__title`); la **foto solo si existe**
   (`ing.fotoUrl` → `<img class="ingredient-modal__photo">`, sin
   placeholder ni «sin imagen» cuando no hay); **categoría** y
   **cantidad del paquete** como texto plano
   (`ingredient-modal__text` con `--ink-soft`); **supermercados** como
   etiquetas **no interactivas** (`supermarket-tag--{id}`, ya existentes
   desde ADR-085 con colores de marca hardcodeados documentados);
   «Usada en N recetas» **sin cambios** (links que abren la receta en
   lectura). **Sin botón «Cerrar» inferior** (solo ✕ superior y
   «Eliminar»/«✏️ Editar» en `.ingredient-modal__actions`) y **sin el
   texto «Categoría actual: …»**, que desaparece de la UI.
2. **Botón «✏️ Editar»** (`data-ing-edit`): re-render **en caliente**
   del mismo modal a modo edición mediante
   `openIngredientModal(id, { edit: true })`, con el patrón de
   `openRecipeModal` de la issue #234: libera el trap de foco previo
   (`ingredientModalCleanup()`), **no vuelve a guardar**
   `_previousActiveElement` si el modal ya estaba visible (`wasHidden`),
   y enfoca el campo nombre en un segundo `requestAnimationFrame`
   (tras el `trapFocus`, que enfoca la ✕) sin romper el trap.
3. **Vista edición** (`#ingredient-edit-form`, `ingredientEditHtml`):
   **nombre** (requerido, `maxlength="200"`), **foto (URL)** (`type="url"`),
   **categoría** (select), **supermercados** (chips con marca visual
   inmediata, sin guardado al momento) y **cantidad del paquete**
   (número + unidad, con la validación `>= 0` / vacío → `null` de
   ADR-085). **«Guardar»** persiste en bloque vía
   `ctx.updateIngredient(currentUser, id, { nombre, fotoUrl, categoriaId,
   supermercados, paqueteCantidad, paqueteUnidad })`, **refresca el
   array local `ingredients`** para que la vista de lectura muestre los
   datos al instante (el snapshot de Firestore llega después) y vuelve a
   lectura con toast «Ingrediente actualizado.». **«Cancelar»**
   (`data-ing-cancel`) vuelve a lectura sin guardar.
4. **El guardado inmediato por campo del detalle se elimina**: en el
   detalle ya no se persiste al cambiar categoría, supermercados o
   cantidad; todo se guarda en bloque con «Guardar» (el alta manual
   «Nuevo ingrediente» conserva su submit único de siempre). El alta no
   cambia salvo que `addIngredient` acepta ahora **`fotoUrl` opcional**
   (se persiste solo si viene definido; **no se expone en el alta**,
   solo en la edición del detalle).
5. **Backdrop y Escape solo cierran en modo lectura**: guard
   `!ingredientEditMode` en ambos listeners; en edición se **bloquean**
   para no perder el progreso del formulario (mismo patrón que la
   ventana de receta, issue #234). En edición las vías de salida son la
   ✕ superior, «Cancelar» y «Guardar».
6. **Estado global `ingredientEditMode`** (bool): se pone a `true` al
   abrir en edición y a `false` al abrir en lectura o al cerrar el
   modal (`closeIngredientModal` lo resetea siempre).
7. **Responsividad** (AGENTS.md §2): los textos nuevos usan
   `overflow-wrap: break-word` + `min-width: 0` (título, texto de
   campos); la foto `width: 100%; max-height: 180px; object-fit: cover`
   (patrón de `.recipe-card__photo`).
8. **Temas** (AGENTS.md §4): los textos de lectura usan `--ink-soft`
   con el override añadido al bloque agrupado `[data-theme="black"]`;
   los supermercados reutilizan los colores de marca hardcodeados
   (documentados con comentario desde ADR-085, idénticos en los 4
   modos).
9. **Manual de usuario**: §8.5 actualizada (ventana en modo lectura con
   ✏️ Editar — nombre y foto incluidos —, «Cancelar»/«Guardar», sin
   «Cerrar» inferior). **PWA**: bump `20260915 → 20260916` en
   `js/config.js` (`APP_VERSION`), `index.html` (`?v=` de estilos y
   `app.js`) y `service-worker.js` (`STATIC_ASSETS`).
10. **Seguridad**: `escapeHtml` en todos los puntos de interpolación
    (incluidos `src` y `value` de la foto); el campo `fotoUrl` se guarda
    tal cual — patrón consistente con las recetas (ADR-087); el
    escaneo de seguridad dejó un **hallazgo MEDIUM informativo** sobre
    unificar a futuro con `safeCoverUrl` (que ya sanitiza la foto de las
    recetas en la búsqueda global).

## Consecuencias

- **Positivas**: la ventana de ingrediente sigue el mismo modelo mental
  que la de recetas (issue #234): lectura limpia, edición explícita con
  lápiz y formulario protegido del cierre accidental; el nombre por fin
  se puede corregir desde el detalle; la foto (opcional, por URL, sin
  infraestructura de subida) enriquece la ficha y el catálogo futuro;
  sin placeholder se evita el ruido visual en ingredientes sin foto; el
  guardado en bloque reduce llamadas a Firestore y toasts frente al
  guardado inmediato por campo; «Cancelar» permite descartar cambios con
  un gesto.
- **Neutras**: la foto se guarda como URL y se muestra tal cual, con
  `escapeHtml` pero sin sanitización de dominios (mismo criterio que las
  recetas; el hallazgo MEDIUM informativo queda anotado para unificar
  con `safeCoverUrl` a futuro); el alta manual sigue sin ofrecer foto
  (solo la edición); bump PWA `20260915 → 20260916` (invalida la caché
  anterior); el ADR se numera 088 porque el 087 ya lo ocupa la pestaña
  de Recetas.
- **Negativas**: en modo edición, pulsar fuera o Escape ya no cierra la
  ventana (comportamiento deliberado para no perder el formulario; la
  salida es ✕ / Cancelar / Guardar); ninguna otra conocida. QA validó
  los criterios de la issue (lectura por defecto, lápiz, nombre y foto
  editables, sin placeholder, sin «Cerrar» inferior, sin «Categoría
  actual»), responsividad en 360 / 768 / 1280 px sin scroll horizontal y
  los cuatro modos de tema sin puntos muertos ni contrastes insuficientes
  (`--ink-soft` AA en todas las familias); el escaneo de seguridad no
  encontró hallazgos nuevos (todo dato de usuario pasa por `escapeHtml`).

Related issue: #232
