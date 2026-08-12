# ADR-086: Mejoras en la lista de la compra — multi-semana, paquetes y eliminar con swipe (issue #225)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #225 pide tres mejoras para la pestaña **«Lista de la compra»**
de la sección de Recetas (issue #64), construida en ADR-076/ADR-080/
ADR-082 y con su estética de píldoras en ADR-084:

1. **Selección de varias semanas** a la vez, sumando los ingredientes
   totales de las seleccionadas (antes solo calculaba la semana activa
   del menú).
2. **Cantidad en paquetes**: si el ingrediente del catálogo
   (`users/{uid}/ingredients`) tiene almacenada cantidad y unidad de
   paquete (campos `paqueteCantidad`/`paqueteUnidad` de la issue #224,
   PR #227 **aún sin fusionar**), comparar y mostrar la cantidad en
   paquetes redondeada al alza — 550 g con paquete de 1 Kg → 1 paquete;
   2,5 Kg → 3 —, y permitir al usuario **ajustar esa cantidad** (p. ej.
   ahorrarse un paquete o comprar de más) con persistencia.
3. **Eliminar un ítem desplazándolo hacia la izquierda** (swipe), con
   deshacer.

Estado previo: la lista se calculaba a partir de la semana activa del
menú (cada ingrediente escalaba por comensales y aplicaba las
exclusiones `recetasExcluidasCompra`), siempre mostraba la cantidad
necesaria en unidades, y los ítems no se podían eliminar (solo marcar
como comprados). Los ítems extra ya vivían en el documento del menú de
la semana (`itemsExtra`).

Flujo de trabajo: la rama de trabajo se crea desde
`content/issue-64-seccion-recetas` y la PR va **también a esa rama, no
a `dev`** — excepción puntual a la regla de PRs contra `dev` de
AGENTS.md §1, pedida explícitamente por el usuario, igual que en las
issues anteriores de la sección.

Numeración: en la rama base los ADR llegan a 083; el 084 lo usa la PR
de la issue #221 (estética de la lista de la compra) y el 085 la PR de
la issue #224 (mejoras de la pestaña Ingredientes, que introduce los
campos de paquete), por lo que este ADR es el **086**.

## Decisión

### 1. Selección multi-semana con chips

- Nueva barra de chips `.shopping-week-chips` bajo la toolbar: cada
  chip (`.shopping-week-chip`, patrón visual de `recipe-form__chip`)
  es una semana con checkbox oculto y muestra la fecha abreviada. La
  ventana visible es de **5 semanas** alrededor de un offset
  (`chipOffset − 2 … chipOffset + 2`), navegable con las flechas
  ←/→ (`shopping-prev-week`/`shopping-next-week`).
- La selección es un `Set` de `semanaInicio` ISO (`selectedWeeks`).
  Mientras el usuario **no toca los chips** (flag `userTouchedChips`),
  la selección sigue a la semana activa del menú
  (`syncSelectionWithMenu` usa `getActiveWeekOffset()` de
  `js/menu.js`); en cuanto toca un chip o una flecha, la selección
  pasa a ser del usuario y deja de seguir al menú.
- El cálculo (`computeLines`) suma los ingredientes de todas las
  semanas seleccionadas agregando por clave normalizada
  `«nombre|unidad»` (nombre y unidad normalizados). Cada semana
  escala con **sus propios comensales** y aplica **sus propias
  exclusiones** (`recetasExcluidasCompra`) y sus ítems eliminados
  (`itemsEliminados`). Las semanas sin documento guardado aportan 0
  (menú en memoria sin id). No se permite desmarcar la única semana
  seleccionada (toast «Selecciona al menos una semana»).
- El título de la pestaña indica «Lista de la semana del …» o
  «Lista de la compra · N semanas».

### 2. Cantidad en paquetes (cálculo automático)

- `pkgInfo(line)` busca el ingrediente en el catálogo
  (`getIngredients()` de `js/recipes.js`, que pasa a exportarse).
  Si tiene `paqueteCantidad` y `paqueteUnidad`, compara unidades
  **por familias** (`unitFamily`): masa (g base 1 / Kg base 1000),
  volumen (mL base 1 / L base 1000) y unidades (base 1).
- Solo se comparan cantidades de la **misma familia**; en caso
  contrario —o si el ingrediente no tiene dato de paquete— se devuelve
  `null` y la línea muestra la **cantidad necesaria** (comportamiento
  previo).
- Redondeo al alza con tolerancia de coma flotante
  (`Math.ceil(neededBase / pkgBase − 1e-9)`): 550 g con paquete de
  1 Kg → 1 paquete; 2,5 Kg → 3. El `null`-safe de `Number()` y el
  chequeo `pkgCant > 0` / `pkgBase > 0` hacen la **lectura defensiva**
  de los campos de la issue #224: si la PR #227 aún no se ha fusionado
  y los campos no existen, el cálculo de paquetes queda inactivo sin
  errores.

### 3. Stepper −/+ con persistencia local

- Cada línea con paquete muestra el stepper −/+ (`.shopping-line__stepper`)
  con el conteo «N paquetes» y la cantidad necesaria al lado
  («· 550 g»). El stepper mide **1.5rem (24 px)** de área táctil
  (WCAG 2.2 AA, criterio 2.5.8 Tamaño mínimo del objetivo).
- El ajuste manual persiste en **localStorage por usuario**
  (clave `compraPaquetes:<uid>`, JSON `{clave: nº}`), solo en el
  dispositivo — trade-off aceptado: no se sincroniza entre
  dispositivos, a cambio de cero cambios de esquema de datos.
- El botón **↺** (`.shopping-line__pkgreset`) borra el ajuste y vuelve
  al cálculo automático.

### 4. Eliminar por swipe hacia la izquierda

- Patrón de **axis lock del ADR-028**: `touchstart`/`touchmove`/
  `touchend` con slop de 10 px; al cruzar el umbral se decide el eje
  (empate → vertical, manda el scroll) y no se vuelve atrás.
- El swipe a la izquierda **revela** un botón «Eliminar»
  (`.shopping-line__del` sobre el fondo rojo `.shopping-line__swipe-bg`):
  **no borra al soltar**, hay que pulsar el botón (evita borrados
  accidentales). Deslizar a la derecha cierra la revelación. La
  posición la aplica el CSS: transform inline durante el arrastre y
  clase `.is-revealed` → `translateX(-88px)` al soltar.
- En escritorio también se revela con **hover** (dentro de
  `@media (hover: hover)`) y es accesible por **teclado**: al enfocar
  el botón se añade `.is-revealed` y al salir del foco se cierra.
- **Supresión del click sintetizado**: tras un gesto horizontal el
  navegador sintetiza un `click` al soltar el dedo que caería sobre el
  checkbox/stepper de la fila desplazada; se suprime con
  `preventDefault()` en el `touchend` **no-pasivo** (solo cuando el
  lock fue horizontal y el desplazamiento superó el umbral, para no
  afectar a los toques deliberados).

### 5. Persistencia de la eliminación y deshacer

- **Ítems de recetas**: se marcan en `itemsEliminados` (array de
  claves normalizadas «nombre|unidad») del documento de menú de
  **cada semana seleccionada que realmente contenga el ítem** (se
  comprueba antes de escribir y se omite si ya estaba). Las escrituras
  usan `updateMenuWeek(weekStart, changes, { create: false })`: **nunca
  se crean documentos de semanas vacías**.
- **Ítems extra**: se quitan de `itemsExtra` de las semanas donde
  están.
- **Escrituras serializadas** con una cola de promesas
  (`enqueueMutation`) para evitar carreras entre eliminaciones,
  restauraciones y añadidos casi simultáneos (dos lecturas previas
  podían pisarse).
- **Deshacer** con `showUndoToast` (patrón ADR-004): restaura el
  `itemsEliminados` anterior de cada semana tocada o vuelve a añadir
  el ítem extra.
- Nota **«Quitados de la lista»** (`.shopping-deleted`) al pie de la
  lista con los nombres de los ítems eliminados en las semanas
  seleccionadas; pulsar uno lo vuelve a incluir (lo quita de
  `itemsEliminados` en todas las semanas que lo tengan).

### 6. Refactor de `js/menu.js` y exports nuevos

- `activeMenu` se generaliza en **`menuForWeek(weekStart)`** (menú de
  una semana concreta; si no hay documento devuelve uno en memoria sin
  id, con comensales 2 y listas vacías).
- Nuevo export **`getMenuDataByWeek(weekStart)`** con shape
  `{ semanaInicio, comensales, dias, recetasPorSemana,
  recetasExcluidasCompra, itemsExtra, itemsEliminados, hasDoc }`.
- Nuevo export **`updateMenuWeek(weekStart, changes, { create = true })`**:
  actualiza una semana concreta con fuego-y-olvido y estado local
  optimista; con `create: false` solo actualiza si el documento ya
  existe.
- Nuevo export **`getActiveWeekOffset()`**: offset de la semana activa
  del menú, que la lista de la compra usa para arrancar su selección.
- `menuDataOf` persiste también `itemsEliminados`.
- `js/recipes.js`: `getIngredients()` pasa a ser exportada.
- `js/app.js`: `resetShoppingListState()` (resetea chips, selección y
  ajustes de paquetes en memoria) se invoca en el logout para que los
  datos del usuario anterior no se muestren al siguiente.

### 7. CSS y cuatro modos de tema

- `.shopping-week-chips` / `.shopping-week-chip` (con estado
  `.is-checked` y `:focus-within` con outline visible, ya que el input
  está oculto), `.shopping-line-wrap` (fondo rojo del swipe) /
  `__swipe-bg` / `__del` / `__content` (superficie que se desplaza),
  `.shopping-line__stepper` (1.5rem), `__pkgcount`, `__detail`,
  `__pkgreset`, `.shopping-deleted` y el estado revelado
  (`.is-revealed` + hover en `@media (hover: hover)`).
- Overrides **agrupados** de las 4 familias de tema
  (`[data-theme="light"/"white"]` y `[data-theme="black"]`) siguiendo
  el patrón de selectores agrupados de AGENTS.md §4: el fondo del
  swipe usa `--stamp` (y `--stamp-dark` en negro puro), los chips
  marcados usan `--teal-reel` (`--teal-reel-dark` en negro puro), etc.
- El rojo claro `#d16a59` del botón ↺ y de los botones de la nota
  «Quitados de la lista» está **hardcodeado con comentario**: `--stamp`
  (#a63b2e ≈ 2,6:1) no llega a AA 4,5:1 sobre oscuro, mientras que
  `#d16a59` ≈ 4,7:1 sobre `--ink-raised`; en la familia clara se usa
  `var(--stamp)` (≈ 6,4:1 sobre blanco).

### 8. Dependencia de merge con la PR #227 (issue #224)

Los campos `paqueteCantidad`/`paqueteUnidad` del catálogo de
ingredientes los introduce la PR #227 (issue #224), aún sin fusionar.
Hasta que llegue, el cálculo de paquetes queda **inactivo** (los
campos no existen → lectura defensiva → se muestra la cantidad
necesaria); no se bloquea ninguna otra mejora de esta issue.

## Alternativas descartadas

- **Sincronizar los ajustes de paquetes entre dispositivos**
  (Firestore): descartada — exigía cambios de esquema de datos y
  lógica de resolución de conflictos; localStorage por uid (solo
  dispositivo) es suficiente para el caso de uso y el trade-off se
  documenta en el manual.
- **Borrar el ítem al soltar el swipe**: descartada — provoca borrados
  accidentales; se exige pulsar «Eliminar» tras revelarlo (y el hover
  en escritorio no borra al pasar por encima).
- **Persistir la eliminación en un documento propio de la lista de la
  compra**: descartada — la lista se calcula del menú y no tiene
  documento propio; `itemsEliminados` en el documento de menú de cada
  semana es coherente con `itemsExtra` y con la semántica de
  «esta semana no necesito este ingrediente».
- **Crear documentos de semanas vacías al eliminar**: descartada —
  `updateMenuWeek` con `create: false` evita ensuciar Firestore con
  documentos sin menú.
- **Ventana infinita o lista completa de chips**: descartada — la
  ventana de 5 con flechas mantiene la toolbar compacta en móvil y la
  responsividad (sin scroll horizontal).
- **Guardar la revelación del swipe en estado**: descartada — la
  revelación es efímera por gesto/foco y se cierra al re-render, igual
  que en ADR-028.

## Consecuencias

- **Positivas**: la lista de la compra cubre varias semanas de una
  vez (compras reales de un periodo); los ingredientes con dato de
  paquete muestran una cantidad útil para el supermercado (y ajustable
  a la realidad de la despensa, con deshacer del ajuste vía ↺); los
  ítems se pueden quitar con un gesto natural en móvil, hover en
  escritorio y teclado, siempre con deshacer y con una vía visible
  para volver a incluirlos; `menuForWeek`/`getMenuDataByWeek`/
  `updateMenuWeek`/`getActiveWeekOffset` quedan como API reutilizable
  de `js/menu.js`.
- **Neutras**: los ajustes de paquetes no se sincronizan entre
  dispositivos (trade-off aceptado y documentado); la eliminación de
  un ítem de receta es **por semana** (quitar el arroz de la semana A
  no lo quita de la B — el manual lo explica); bump de versión PWA
  (`20260912 → 20260913`) para propagar el nuevo CSS/JS a los clientes
  con caché; el cálculo de paquetes queda dormido hasta que se fusione
  la PR #227.
- **Negativas**: ninguna conocida. QA PASS: multi-semana, paquetes con
  redondeo al alza (casos 550 g/1 Kg → 1 y 2,5 Kg → 3), stepper con
  persistencia y ↺, swipe con axis lock sin click fantasma, deshacer,
  nota «Quitados de la lista», cuatro modos de tema con contraste WCAG
  AA y responsividad en 360 / 768 / 1280 px sin scroll horizontal a
  nivel de página. Seguridad PASS: sin hallazgos (el localStorage por
  uid no guarda datos sensibles y la cola de mutaciones no cambia la
  superficie de ataque de Firestore). Manual de usuario actualizado
  (sección 8.4).

## Iteración (2026-08-12): refinamientos de paquetes y de la eliminación

Comentario nuevo del usuario en la issue #225 con cuatro peticiones:

> 1. Si aparece el número de paquetes, no debería aparecer el peso.
>    Tampoco la palabra «paquetes», simplemente el número.
> 2. Para eliminar un ítem, añadir a la derecha del todo una X roja
>    con la que eliminarlo (sobre todo desde PC).
> 3. Al presionar sobre un item se marca en rojo como para eliminar y
>    aparece «Eliminar» superponiéndose al peso. Esto no debería
>    pasar, solo cuando se desplaza, no al pulsar, en cuyo caso
>    estaría marcando el item, no eliminándolo.
> 4. Cuando se desplaza el item para eliminarlo, hacer un pequeño
>    desplazamiento extra para eliminarlo sin necesidad de pulsar
>    sobre eliminar que se mostraría ahora.

### Decisiones de la iteración

1. **Paquetes: solo el número** — `qtyHtml` muestra únicamente la
   cifra de paquetes (con `aria-label` «N paquetes» para lectores de
   pantalla) y elimina el span `.shopping-line__detail` («· 550 g»):
   ya no se ve el peso ni la palabra «paquetes». Se retira también su
   CSS (`.shopping-line__detail` y sus overrides) y su referencia en
   el estado `is-bought`.
2. **✕ roja siempre visible a la derecha** — cada línea incluye un
   botón `.shopping-line__remove` (✕) al final del contenido, con
   área táctil de 1.75rem (≥ 24 px, WCAG 2.2 AA 2.5.8) y el rojo
   claro `#d16a59` (AA sobre oscuro, patrón del ↺; en la familia
   clara se oscurece a `--stamp`). Reutiliza el delegado de
   `data-del-key` existente, así que elimina con el mismo flujo y
   deshacer.
3. **El hover ya no revela el estado de eliminar** — se elimina el
   bloque `@media (hover: hover)` que desplazaba el contenido al
   pasar el ratón (causa del «marcado en rojo» y del «Eliminar»
   superpuesto al peso al pulsar). Ahora el hover solo marca la
   línea (fondo suave `--paper-alpha-10`/`--ink-alpha-10`), igual
   que antes se marcaba al pulsar. El teclado queda cubierto por la
   ✕ (botón real, enfocable y activable).
4. **Swipe con desplazamiento extra elimina directamente** — se
   añade la constante `SWIPE_DELETE = -112` (24 px más allá del
   revelado a -88): durante el arrastre el contenido puede llegar a
   -112 y la clase `.is-deleting` oscurece el fondo rojo
   (`filter: brightness(0.85)`) para comunicar el umbral; al soltar
   con `offset <= SWIPE_DELETE` se elimina el ítem directamente (con
   deshacer), sin botón que pulsar. El botón «Eliminar» del fondo del
   swipe desaparece (`.shopping-line__del` → icono decorativo
   `.shopping-line__swipe-icon` con `pointer-events: none`).
5. **Manual y hint** — sección 8.4 del manual y el hint al pie de la
   lista se actualizan: número de paquetes sin peso, ✕ de la derecha
   y swipe con desplazamiento extra.
6. **PWA**: bump de versión `20260914 → 20260915`.

### Consecuencias de la iteración

- **Positivas**: la cantidad con paquete queda limpia (solo el
  número, sin duplicar peso); la ✕ roja da un camino de borrado
  evidente y accesible en escritorio; el hover deja de sugerir un
  borrado que no ocurre; el swipe gana el patrón estándar «desliza
  hasta el fondo para borrar» con feedback visual del umbral.
- **Neutras**: el borrado por swipe sigue pidiendo un gesto completo
  (revelado + desplazamiento extra), lo que conserva la protección
  frente a borrados accidentales de la decisión original; la
  accesibilidad por teclado pasa del botón revelado al botón ✕
  siempre visible.
- **Negativas**: ninguna conocida. QA PASS: paquete muestra solo el
  número y sin peso, ✕ elimina con deshacer, el hover no revela el
  borrado (solo marca), el swipe con desplazamiento extra elimina al
  soltar sin pulsar, los cuatro modos de tema con contraste WCAG AA
  y responsividad en 360 / 768 / 1280 px sin scroll horizontal.
  Seguridad PASS: sin hallazgos (cambios 100 % presentacionales y de
  interacción; sin tocar datos).

Related issue: #225 (https://github.com/gonzalitojh/Registro-personal/issues/225)
