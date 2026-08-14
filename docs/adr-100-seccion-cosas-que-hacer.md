# ADR-100: Sección «Cosas que hacer» (issue #283)

## Estado
Aceptado

## Fecha
2026-08-14

## Contexto

La issue #283 pide una **nueva sección de cosas que hacer** con su
propio endpoint (**colección propia en Firestore,
`users/{uid}/todos/{id}`**), incluida en la barra lateral de
navegación igual que el resto de secciones (Ocio, Recetas, Gimnasio).
Debe servir para **marcar cosas que hacer a corto plazo, largo plazo,
diario de la casa, etc.** y, al igual que el resto de secciones,
respetar las características de la barra superior (cabecera global,
búsqueda acotada a la sección), las pestañas (barra de pestañas
propia ocultable en Ajustes, como Recetas/Gimnasio), la
responsividad y los cuatro modos de tema. El task file exige además
**documentar con detalle cualquier idea adicional útil**.

Precedentes que fijan el patrón de esta sección:

- **Gimnasio** (issue #62, ADR-095): sección de primer nivel **hermana
  de `profile-view` y fuera de `#app`**, con su propia
  `nav.tabs--bar` (misma clase que la de Ocio, ADR-078) y sin botón
  de volver ni título (issue #206, ADR-077): la navegación vive en la
  cabecera global.
- **Ocultación de secciones y pestañas** (issue #97, ADR-067):
  `SECTION_REGISTRY` en `js/settings.js` es el registro central que
  alimenta los ajustes de visibilidad.
- **Router de hash** (ADR-051) con memorias por sección
  (`lastOcioKey`, `lastRecipesTab`, `lastGymTab`) y de la última
  sección de primer nivel (`lastSection`, issue #213), que usa la
  flecha de volver del perfil.
- **Auto-ocultado de cabecera/pestañas** (ADR-060, ADR-094): una sola
  fuente de verdad en `js/auto-hide-nav.js` con selectores genéricos
  sobre `body` y resolución del panel activo por vista.
- **Notificaciones** (ADR-037): precedente de colección **privada del
  dueño** en Firestore (`allow read, write: if isAllowedUser() &&
  isOwner(userId)`), patrón que esta sección adopta de forma
  consciente (ver Decisión 2).
- **Búsqueda de Gimnasio en v1** (ADR-095): precedente de guard en
  `js/global-search.js` que devuelve vacío en una sección sin scope
  de búsqueda definido.

La implementación está validada (QA PASS) y escaneada (seguridad
PASS, 0 hallazgos HIGH; la regla de lectura owner-only se añadió en
la iteración de revisión, commit `1345c0b`); el manual de usuario se
actualiza en esta misma tarea (regla 3 de AGENTS.md). Este ADR
documenta la decisión a posteriori, como los recientes (ADR-093,
ADR-094, ADR-095, ADR-096, ADR-097, ADR-098, ADR-099).

Related issue: #283 — https://github.com/gonzalitojh/Registro-personal/issues/283

## Decisión

### 1. Sección de primer nivel «Cosas que hacer», hermana de Gimnasio

- **Vista propia `#todos-view`** fuera de `#app` (mismo patrón que
  `#gym-view`): cuando está visible, `#app` queda oculta; no hay
  botón de volver ni título, la navegación vive en la cabecera global
  (issue #206).
- **Barra de pestañas propia estilo Ocio** (`nav.tabs--bar` con la
  misma clase común de ADR-078): **«Tareas»** (pestaña por defecto,
  acento **teal** `--teal-reel`, con override a `--teal-reel-dark` en
  negro puro) y **«Hechas»** (acento **ocre** `--stamp`, con override
  a `--stamp-dark` en negro puro). Ambas ocultables desde Ajustes vía
  `SECTION_REGISTRY` (issue #97): la sección se registra como
  `todos` con sus dos pestañas (`tareas`, `hechas`) en
  `DEFAULT_SETTINGS.visibleSections` / `visibleTabs`.
- **Entrada «Cosas que hacer» en la barra lateral** (`js/sidebar.js`)
  con el icono de **check-circle** (lista de verificación), **justo
  después de «Gimnasio»**, que abre la sección volviendo a la última
  pestaña de la sesión (`getLastTodosTab()`).
- **Router extendido** (`js/router.js`): rutas `#/tareas` (Tareas, la
  pestaña por defecto se canoniza **sin segmento**) y
  `#/tareas/hechas`; `TODOS_TAB_TO_PANEL`, `TODOS_DEFAULT_TAB`,
  `todosHashFor()`, `lastTodosTab` y `lastSection = "todos"` (la
  flecha de volver del perfil regresa también a Cosas que hacer,
  `js/profile.js`). El **token de URL es «tareas»** (humano) y la
  **sección interna es «todos»**: un bug temprano (`b6d7f80`)
  confundió ambos tokens en `parseHash`; el mapeo queda explícito y
  comentado en el router.
- **Saneo de tokens inválidos**: `#/tareas/<token desconocido>` o con
  más segmentos cae a la pestaña por defecto con `invalid: true` (y
  `history.replaceState` reescribe la URL canónica, mismo guard que
  el resto de secciones); `#/tareas/tareas` no es canónico y se
  normaliza a `#/tareas`. `getLastTodosTab()` saneo igualmente el
  valor memorizado.

### 2. Colección propia en Firestore, privada del dueño (patrón notifications)

- **`users/{uid}/todos/{id}`** con `{ texto, categoria, nota?,
  fechaLimiteISO?, hecha, fechaCompletadaISO, addedAt, updatedAt }`.
  `hecha` nace en `false` y `fechaCompletadaISO` en `null` (nunca
  `deleteField()`: `null` es suficiente para «no completada» y evita
  tocar `firebase.js`).
- **Regla de seguridad** (`firestore.rules`):
  `allow read, write: if isAllowedUser() && isOwner(userId)` — las
  tareas son **privadas del dueño**, mismo patrón que las
  notificaciones. Es una **decisión consciente** (se argumenta en la
  rama `fix` `1345c0b`): las tareas son **datos personales** (textos
  y notas privados) y no hay sección «Amigos» que necesite leerlas de
  otro usuario. Es la única colección de contenido de la web que no
  es legible entre amigos, y así queda comentado en las propias
  reglas.
- **Suscripción en tiempo real** con la query ordenada **solo por
  `addedAt` desc** (un solo campo: evita índices compuestos en
  Firestore); el **orden de dominio lo aplica `js/todos.js`** con un
  comparador determinista sobre copia (ver Decisión 5). Conexión con
  reintento con backoff (patrón issue #147) desde `app.js`.

### 3. Interacciones de la lista: filas (no tarjetas)

- Las tareas se muestran como **filas de checklist** (checkbox +
  texto + nota + chip de categoría + fecha límite + acciones), **no
  tarjetas en rejilla**: es una lista de verificación con una acción
  principal por fila (marcar/desmarcar), y las filas apiladas son el
  patrón natural de una checklist; comentado en CSS como decisión
  ADR-100.
- **Checkbox nativo con `accent-color`** (`--teal-reel`; en negro
  puro `--teal-reel-dark` `#4f9c8e`, umbral gráfico ≈3:1 sobre negro,
  patrón episode-checkbox), con el check blanco ≈6:1 en Oscuro y en
  la familia clara.
- **Toggle de hecha optimista en memoria**: el espejo local se
  invierte antes del round-trip a Firestore (`hecha` +
  `fechaCompletadaISO` = hoy UTC vía `ctx.todayISO()`, o `null` al
  desmarcar). Un **doble clic rápido** lee el estado nuevo del
  documento en memoria (no del DOM) y envía el toggle de vuelta; en
  error se **revierte** el estado a los valores previos y se muestra
  aviso.
- **Borrado con `confirm()` nativo** (mismo criterio de simplicidad
  que Gimnasio, ADR-095) y aviso flotante de confirmación.
- **Modal de alta/edición sin modo lectura**: la fila ya muestra todo
  el contenido (texto, categoría, nota, fecha), por lo que no hay
  ventana de lectura; el modal solo crea/edita. Con `trapFocus` en la
  tarjeta y foco inicial en el campo de texto; cierre por ✕, backdrop
  y Escape.

### 4. Campos y validaciones

- **Texto obligatorio**, máx **200 caracteres** (`TODO_MAX_LENGTH`,
  mismo límite en el `maxlength` del input y en el guard del submit).
- **Categoría**: desplegable con **presets** — corto plazo / largo
  plazo / casa / personal / trabajo / otro. Las tareas guardadas
  conservan la categoría como texto; los ids son canónicos. **Un
  único tono de chip** para todas las categorías (superficie
  `--ink-raised` con texto `--paper`, overrides en claro y negro
  puro): **sin 6 colores × 4 temas** — el coste de mantenimiento y
  contraste de una paleta por categoría no compensa para una
  etiqueta puramente organizativa (comentado en CSS como decisión
  ADR-100).
- **Nota opcional** (textarea, máx 500 caracteres).
- **Fecha límite opcional** (`input type="date"`); vacía → `null` en
  Firestore. La **fecha vencida** (pendiente con fecha anterior a hoy,
  patrón UTC) se muestra en **rojo**: `#d16a59` hardcodeado en las
  familias oscuras (≈4.7:1 AA sobre `--ink` y ~4.9:1 sobre negro,
  patrón `.shopping-deleted__btn`, documentado con comentario según
  AGENTS.md §4) y `--stamp` (≈5.3:1 AA) en la familia clara.

### 5. Orden determinista

- **Pendientes (pestaña «Tareas»)**: `fechaLimiteISO` asc con las **sin
  fecha al final** → `addedAt` desc (lo más nuevo primero) → `id`
  (tie-break final para que el orden sea **SIEMPRE determinista**).
- **Hechas (pestaña «Hechas»)**: `fechaCompletadaISO` desc (las más
  recientes primero, sin fecha al final) → `updatedAt` desc → `id`.
- El sort es **puro sobre copia** (`[...pending].sort(...)`) con
  fallback defensivo para timestamps ausentes (documentos legacy); el
  snapshot de Firestore solo aporta `addedAt` desc.

### 6. Búsqueda global acotada a la sección (v1: vacío)

- `js/ui.js`: placeholder **«Buscar tareas...»** y aria-label
  «Buscar en tus tareas» para la sección.
- `js/global-search.js`: **guard de la sección `todos` que devuelve
  resultados vacíos en v1** (mismo precedente que Gimnasio, ADR-095):
  evita caer a la rama de Ocio y mezclar colecciones ajenas. El hint
  dice «Escribe al menos 2 caracteres para buscar en tus tareas.» La
  búsqueda por texto dentro de la sección queda documentada como
  iteración futura (ver Ideas futuras).

### 7. Responsividad y cuatro modos de tema

- Filas flex con `min-width: 0` + `overflow-wrap: break-word` en
  texto, nota, meta y contenedor: **sin scroll horizontal a 360/768/
  1280 px** con contenido largo realista (verificado con DOM real,
  regla 2 de AGENTS.md).
- **Overrides agrupados por familia** (regla 4 de AGENTS.md): en negro
  puro la fila pasa a `--ink-raised` con borde `--paper-alpha-20`
  (sin esto quedaría tarjeta clara sobre fondo negro, invisible en la
  familia oscura), el checkbox a `--teal-reel-dark`, la fecha vencida
  al rojo `#d16a59` (comentado), los chips a texto `--paper` y los
  inputs del modal a superficie `--ink` con texto `--paper` (el
  `--paper-dim` base sería gris casi igual a la superficie del modal);
  en la familia clara la fecha vencida vuelve a `--stamp` y el chip a
  texto `--ink`. Los botones usan `.btn--danger` cuyo override ya está
  agrupado.

### 8. PWA y versionado

- `service-worker.js`: `js/todos.js` añadido a `STATIC_ASSETS`
  (precaché, junto a la sección de gimnasio).
- **Bump de versión `20260929` → `20260930`** (vía
  `scripts/bump-version.sh`) en `index.html` (`?v=20260930` en
  `css/styles.css`, `ocio/ocio.css` y `js/app.js`), `js/config.js`
  (`APP_VERSION`) y `service-worker.js` (`STATIC_ASSETS`), para
  invalidar las cachés del service worker.

### 9. Ideas futuras documentadas (registradas como posibles issues, no implementadas)

El task file pide documentar con detalle cualquier idea adicional
útil. Ninguna se implementa en v1:

- **Recordatorios y notificaciones de fecha límite**: avisar (campana
  y/o notificación del sistema, patrón ADR-037/ADR-071) cuando una
  tarea vence hoy o está vencida; requiere un mecanismo de
  comprobación diaria similar al de estrenos.
- **Subtareas dentro de una tarea**: desglosar una tarea en pasos más
  pequeños con su propio marcado; afecta al modelo de datos
  (anidar o referenciar) y al orden.
- **Prioridades (con colores) y ordenación manual (arrastrar)**:
  campo de prioridad (alta/media/baja) que influya en el orden de la
  lista, y/o reordenación por arrastre con persistencia del orden;
  choca con el orden determinista actual y exigiría un campo de
  posición explícito (el orden por `fechaLimiteISO` + `addedAt` es el
  default).
- **Múltiples listas/áreas personalizadas** además de los presets:
  p. ej. listas por proyecto o área de la vida, con su propia gestión
  en la sección; exigiría una subcolección de listas o un campo de
  lista por tarea.
- **Etiquetas y búsqueda dentro de la sección**: v1 devuelve vacío en
  la búsqueda global (Decisión 6); una iteración futura puede añadir
  etiquetas libres por tarea y scope de búsqueda propio (texto,
  categoría, etiquetas), reutilizando el patrón de búsqueda de
  Recetas.
- **Resumen semanal de tareas completadas**: estadística de
  completadas por semana/mes (p. ej. en el perfil, patrón de las
  estadísticas del ADR-095).
- **Integración con la lista de la compra**: convertir una tarea
  (p. ej. «comprar harina») en un ítem de la lista de la compra o
  viceversa; conecta dos secciones y requeriría mapear categorías de
  tarea a categorías de ingredientes.

## Alternativas descartadas

- **Tarjetas en rejilla** (como Recetas o los catálogos): descartado —
  una checklist con una acción principal por fila (marcar) y texto
  largo se lee y se opera mejor en filas apiladas; las tarjetas
  añaden ruido visual sin aportar información.
- **Ordenación por creación pura** (solo `addedAt` desc): descartado —
  la fecha límite es el dato de urgencia de una tarea pendiente; el
  orden por urgencia con las sin fecha al final es el más útil como
  default, con `addedAt`/`id` como tie-break determinista.
- **Categorías multicolor** (6 colores × 4 temas): descartado — el
  coste de mantenimiento y de contraste por tema (regla 4 de
  AGENTS.md) no compensa: el chip es organizativo, no informativo;
  un único tono con el nombre de la categoría basta.
- **Toggle sin actualización optimista** (esperar al snapshot):
  descartado — en móvil la latencia haría el marcado lento y el doble
  clic rápido podría enviar dos veces el mismo valor y «perder» el
  desmarcado; el espejo en memoria lo hace instantáneo y seguro, con
  revert en error.
- **Búsqueda por texto dentro de la sección en v1**: descartado — la
  issue no lo pide y no hay scope definido; el guard de vacío evita el
  riesgo de mezclar colecciones (precedente Gimnasio ADR-095). Queda
  documentada como iteración futura.
- **Lectura compartida entre amigos** (patrón estándar del resto de
  colecciones, `allow read: if isAllowedUser()`): **descartado por
  privacidad** — las tareas son datos personales (qué tengo que
  hacer, cuándo, notas privadas) y la sección «Amigos» no las
  mostraría; la regla queda owner-only como las notificaciones, con
  el argumento comentado en `firestore.rules`.

## Consecuencias

### Positivas

- **Consistencia total con el patrón de secciones**: cabecera global,
  barra de pestañas estilo Ocio (ADR-078), ocultable en Ajustes
  (ADR-067), auto-ocultado por scroll (ADR-060/ADR-094 con
  `.todos-toolbar` en `CONTROLS_SELECTOR` y `#todos-view` en el
  `MutationObserver`), router de hash con memorias (ADR-051), rutas
  directas compartibles (`#/tareas`, `#/tareas/hechas`), flecha de
  volver del perfil integrada (`getLastSection() === "todos"`).
- **Privacidad reforzada**: las tareas son las únicas de contenido
  que solo ve su dueño; la regla owner-only se comenta en las propias
  reglas de Firestore para que no se revierta por inercia.
- **Toggle instantáneo y robusto**: la actualización optimista con
  revert hace el marcado inmediato incluso con latencia, y el doble
  clic no pierde estados.
- **Orden predecible**: el comparador determinista (fecha límite →
  alta → id) evita que el orden «baile» entre renders y snapshots.
- **Manual al día** (regla 3 de AGENTS.md): capítulo 10 «Cosas que
  hacer» insertado y resto de capítulos renumerados (10–21 → 11–22),
  con los enlaces internos actualizados.

### Neutras

- **La búsqueda de la cabecera no encuentra nada en Cosas que hacer
  en v1** (guard en `global-search.js`; placeholder «Buscar
  tareas...»); el manual lo indica de forma honesta.
- **El backup no incluye las tareas** (ni Recetas ni Gimnasio):
  mejora futura ya documentada en ADR-095, extensible a esta sección.
- **Las tareas no se ven en el registro de amigos** (por la regla
  owner-only); coherente con la privacidad decidida, y el manual lo
  refleja.

### Negativas / Riesgos

- **La privacidad owner-only rompe la simetría con el resto de
  colecciones**: quien mantenga la web debe recordar que
  `users/{uid}/todos` es la excepción intencionada (comentada en
  `firestore.rules`); si algún día se quisiera compartir tareas, la
  regla habría que revisarla con criterios explícitos.
- **Ninguna otra conocida.** Validado: QA PASS y seguridad PASS
  (0 hallazgos HIGH). Verificados los cuatro modos de tema
  (ADR-009/ADR-064/ADR-066) y la responsividad (360/768/1280 px sin
  scroll horizontal con contenido largo realista). El checkbox
  `accent-color` no es estilable por completo en todos los motores
  (es un compromiso nativo ya asumido por el resto de la app).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: vista `#todos-view` (barra de pestañas `data-todos-tab`, paneles `panel-todos-tab` / `panel-todos-done-tab`, toolbar con «+ Nueva tarea») y modal `#todo-modal` (alta/edición); bump `?v=20260929` → `?v=20260930` |
| `js/todos.js` | **Nuevo**: módulo de la sección (pestañas Tareas/Hechas, orden determinista pendientes/hechas, toggle optimista con revert, borrado con confirm, modal de alta/edición con validación y trapFocus, render por pestaña activa) |
| `js/router.js` | **Modificado**: `TODOS_TAB_TO_PANEL`, `TODOS_DEFAULT_TAB`, `TODOS_PREFIX`, `todosHashFor()`, `getLastTodosTab()`, `lastSection = "todos"`, rutas `#/tareas` y `#/tareas/hechas` con saneo de tokens inválidos |
| `js/settings.js` | **Modificado**: `SECTION_REGISTRY.todos` (pestañas tareas/hechas), `visibleSections.todos` y `visibleTabs.tareas/hechas` en `DEFAULT_SETTINGS` |
| `js/sidebar.js` | **Modificado**: entrada «Cosas que hacer» con icono check-circle tras «Gimnasio», vuelta a la última pestaña |
| `js/app.js` | **Modificado**: wiring `setupTodos`/`subscribeTodosData`/`resetTodosData`, rama `route.section === "todos"` en el router con normalización de pestaña oculta, suscripción con reintento con backoff (issue #147) |
| `js/db.js` | **Modificado**: `subscribeToTodos` (query por `addedAt` desc, sin índices compuestos), `addTodo`, `updateTodo`, `deleteTodo` |
| `js/ui.js` | **Modificado**: placeholder «Buscar tareas...» y aria-label «Buscar en tus tareas» para la sección |
| `js/global-search.js` | **Modificado**: guard de la sección `todos` (sin resultados v1) y hint de búsqueda propio; comentario de iteración futura con referencia ADR-100 |
| `js/auto-hide-nav.js` | **Modificado**: `activePanel()` resuelve `#todos-view .todos-view__body section:not(.hidden)`; `.todos-toolbar` en `CONTROLS_SELECTOR`; `MutationObserver` vigila `#todos-view` y sus paneles |
| `js/profile.js` | **Modificado**: rama `getLastSection() === "todos"` en la flecha de volver del perfil |
| `css/styles.css` | **Modificado**: estilos de la sección (`.todos-view`, `.todos-toolbar`, filas `.todo-item`, checkbox `accent-color`, chip de categoría de tono único, fecha límite con vencida en rojo, pestañas `--tab-accent` teal/stamp, modal) con overrides agrupados para las cuatro familias de tema y comentarios de decisión (ADR-100) y de colores hardcodeados |
| `firestore.rules` | **Modificado**: `match /todos/{itemId}` con `allow read, write: if isAllowedUser() && isOwner(userId)` (privadas del dueño, patrón notifications; comentado el argumento de privacidad) |
| `service-worker.js` | **Modificado**: `js/todos.js` añadido a `STATIC_ASSETS` (precaché); bump `?v=20260929` → `?v=20260930` |
| `js/config.js` | **Modificado**: `APP_VERSION` de `20260929` a `20260930` |
| `tasks/task-issue-283.json` | **Nuevo**: task file de la issue #283 |
| `docs/manual-de-usuario.md` | **Modificado**: capítulo 10 «Cosas que hacer» insertado y renumeración de capítulos 10–21 → 11–22 con enlaces internos actualizados (se incluye en esta misma tarea) |
| `docs/adr-100-seccion-cosas-que-hacer.md` | **Nuevo**: este documento |

Related issue: #283 — https://github.com/gonzalitojh/Registro-personal/issues/283
