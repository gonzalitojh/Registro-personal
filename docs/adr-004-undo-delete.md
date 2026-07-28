# ADR-004: Sistema de "Deshacer" al borrar elementos

## Estado
Aceptado

## Contexto
Al hacer clic en "Eliminar" en el modal de detalle de una película,
serie o libro, el sistema ejecutaba la eliminación en Firestore
inmediatamente tras una confirmación con `window.confirm()`. Esto
tenía dos problemas:

1. **Falta de seguridad**: El diálogo nativo `window.confirm()` es
   intrusivo y el usuario podía eliminar un elemento accidentalmente
   sin posibilidad de recuperación.
2. **UX pobre**: Una vez confirmado, el elemento desaparecía al
   instante sin margen para rectificar.

Se necesitaba un mecanismo que diera al usuario una segunda
oportunidad antes de la eliminación definitiva, similar al patrón
"Undo" que usan Gmail, Google Drive y la mayoría de las
aplicaciones modernas.

## Decisión
Implementar un sistema de eliminación diferida con opción de
"Deshacer" que reemplaza el flujo anterior. En lugar de borrar
inmediatamente de Firestore, se programa la eliminación con un
temporizador de 6 segundos mientras se muestra un aviso no intrusivo
con un botón de "Deshacer".

### Flujo nuevo
```
Usuario hace clic en "Eliminar"
  → Modal se cierra
  → Aparece toast: "«Inception» se eliminará… [Deshacer]"
  → Durante 6 segundos:
    ├─ Usuario hace clic en "Deshacer" → se cancela la eliminación
    │  y se muestra "Cancelado."
    └─ Temporizador expira → se ejecuta deleteDoc en Firestore
       y se muestra "Eliminado."
```

### Estrategia de aplazamiento
Se optó por **no borrar de Firestore hasta que el temporizador
expira**. Esto evita tener que implementar un mecanismo de
"restauración" (que requeriría guardar los datos eliminados y
reinsertarlos). Al mantener el ítem en Firestore durante la ventana
de deshacer, la cancelación es trivial: simplemente no se hace nada.

### Gestión de cola
Solo un toast de deshacer es visible a la vez. Cuando se programa
una nueva eliminación mientras hay una pendiente:

- **Mismo ítem**: se reinicia el temporizador (útil si el usuario
  cierra y reabre el modal).
- **Ítem diferente**: la eliminación pendiente se ejecuta
  inmediatamente y la nueva toma su lugar en el toast.

### Seguridad ante recarga de página
Al recargar la página (evento `beforeunload`), todas las
eliminaciones pendientes se cancelan automáticamente. Como el ítem
nunca se eliminó de Firestore, no hay pérdida de datos.

### Eliminación del `window.confirm()`
El diálogo de confirmación nativo se eliminó por completo. El toast
de deshacer actúa como la "segunda oportunidad" del usuario, con una
experiencia más fluida y moderna.

### Implementación técnica
Se creó un nuevo módulo `js/undo-delete.js` que expone dos funciones:

- **`scheduleDeletion(item, uid, kind, ctx)`**: Programa la
  eliminación con temporizador y muestra el toast de deshacer.
- **`cancelAllDeletions()`**: Cancela todas las eliminaciones
  pendientes (usado en `beforeunload`).

El módulo mantiene un `Map` interno (`pending`) con las
eliminaciones pendientes. Cada entrada contiene el temporizador,
los identificadores del ítem y una referencia a la función `hide()`
del toast.

En `js/ui.js` se añadió la función `showUndoToast(title, onUndo)`
que renderiza el toast con contenido HTML (escapado) y devuelve un
objeto `{ hide }` para que el llamador controle el ciclo de vida.
La función `showToast()` existente se modificó para limpiar
cualquier toast de deshacer activo antes de mostrar un mensaje
normal.

### Alternativas descartadas

- **Eliminar y restaurar**: Borrar el documento de Firestore
  inmediatamente y conservar sus datos en memoria/localStorage para
  restaurarlo si el usuario hace clic en "Deshacer". Descartado
  porque es más complejo, requiere manejar IDs de documento y no
  funciona si el usuario recarga la página.
- **Soft delete con campo `deletedAt`**: Marcar el ítem como
  eliminado con un timestamp y filtrarlo de las consultas.
  Descartado porque requeriría cambiar el modelo de datos, las
  reglas de seguridad y las suscripciones Firestore.
- **Mantener `window.confirm()` junto al toast**: Añadiría una
  doble confirmación innecesaria que empeora la UX.
- **Diálogo modal personalizado**: Sobrecarga de interacción; el
  toast no intrusivo es el estándar actual para operaciones
  reversibles.

## Consecuencias

### Positivas
- Los usuarios pueden rectificar eliminaciones accidentales durante
  6 segundos.
- La experiencia es más moderna y consistente con otras
  aplicaciones (Gmail, Google Drive, etc.).
- No hay pérdida de datos si el usuario recarga la página durante
  la ventana de deshacer.
- El cambio es transparente para el sistema de datos de Firestore
  (no se modifica el modelo, las reglas de seguridad ni las
  suscripciones).
- Funciona igual para películas, series y libros sin cambios
  adicionales.

### Negativas
- Las eliminaciones no son inmediatas; hay una ventana de 6 segundos
  antes de que el documento se borre realmente de Firestore.
- Si el usuario cierra el navegador antes de que expire el
  temporizador y el evento `beforeunload` no se dispara (ej. en
  móviles), el ítem nunca se elimina. Esto es aceptable (no hay
  pérdida de datos, solo un ítem que el usuario quería borrar y no
  se borró).

### Neutras
- El toast existente (`#toast` en `index.html`) se reutiliza con
  `innerHTML` en lugar de `textContent` para el modo deshacer.
- Se añadieron dos clases CSS (`.toast--undo` y `.toast__btn`) que
  usan variables de diseño existentes (`--teal-reel`, `--paper`).

## Archivos creados/modificados
- `js/undo-delete.js` — Nuevo módulo gestor de eliminaciones con
  deshacer (98 líneas).
- `js/ui.js` — Añadida `showUndoToast()`, modificada `showToast()`
  para limpiar estado de deshacer.
- `js/modal-handlers.js` — `confirmDelete` rewrite usando
  `scheduleDeletion`, eliminado `window.confirm()`.
- `css/styles.css` — Añadidos `.toast--undo` y `.toast__btn`.