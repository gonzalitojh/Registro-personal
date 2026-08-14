# ADR-096: Otras películas de la saga (issue #280)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #280 (tipo content) pide que, en la ficha de una película que
pertenece a una saga, se muestren **el resto de películas de la saga**
de forma similar a como se ven **las recomendaciones**: petición
textual del usuario: «Quiero que, además, se muestren el resto de
películas de la saga de forma similar a como se ven en las
recomendaciones justo debajo».

Estado actual del código antes del cambio:

- La sección de saga del modal de película (`openMovieModal` en
  `js/ui.js`) mostraba solo el banner «Saga: …» con el botón **«Añadir
  resto de la saga»**, que abre el selector con checklist
  (`openSagaSelector` → `addSagaMovie`). No había ninguna vista
  directa de las películas de la colección.
- `getCollectionDetails` (`js/api-movies.js`) recuperaba los `parts` de
  la colección de TMDB **sin caché** y solo se usaba desde ese selector.
- El re-render interno del modal (`rerender` en `openMovieModal`)
  llamaba a `openMovieModal(item, callbacks)` **solo con el ítem y los
  callbacks**: tras marcar un visionado, las recomendaciones (y
  cualquier otra sección derivada de argumentos extra) desaparecían.
- Al añadir una recomendación (`onAddRecommendation` →
  `addFromRecommendation`), el `Set existingIds` compartido con el
  render **no se actualizaba**: tras un re-render el botón volvía a
  «Añadir» y permitía crear duplicados (hallazgo de QA).

## Decisión

Añadir la sección **«Otras películas de la saga»** en la ficha de
película, justo debajo del banner de saga, con tarjetas que reutilizan
el aspecto y el comportamiento de las recomendaciones:

1. **Tarjetas con el aspecto de las recomendaciones**: la nueva función
   `renderSagaMovies(sagaParts, existingIds, interactive)` en
   `js/ui.js` pinta cada película de la colección como una tarjeta
   `.rec-card.saga-card` (portada, título y año) dentro de un contenedor
   `.recommendations__scroll` (desplazamiento horizontal contenido,
   responsive), con el título `.saga-movies__title` que replica el
   estilo de `.recommendations__title` con variables de tema (`--ink-soft`).
2. **Alta por tarjeta con el flujo existente del selector**: el botón
   `.saga-card__add` de cada tarjeta reutiliza la misma función
   `addSagaMovie(movie, ctx)` que usa el selector con checklist
   (mismo alta, mismos duplicados y toasts). Mientras se añade, el
   botón pasa a `disabled` con «Añadiendo…»; al terminar, «Añadida»
   (deshabilitado); si falla, vuelve a «Añadir» y se muestra toast de
   error.
3. **Caché en memoria de 24 h para la colección**:
   `getCollectionDetails` guarda el resultado en la caché compartida
   `providersCache` (`getCached`/`setCache`, TTL 24 h, la misma que
   usan `getMovieDetails` y los watch providers) con clave
   `collection_<id>`. Solo se cachean las respuestas correctas: un
   fallo transitorio de red devuelve `null` y no oculta la sección
   durante 24 h.
4. **Set `existingIds` compartido para persistir «Añadida»**: al
   añadir una película de la saga desde su tarjeta, `onAddSagaMovie`
   actualiza el `Set existingIds` que comparte con el render, de modo
   que los re-renders posteriores del modal sigan mostrando el estado
   «Añadida» y no permitan duplicados.
5. **Clase propia `.saga-card__add`**: el botón de las tarjetas de saga
   tiene una clase distinta de `.rec-card__add` (aunque comparten reglas
   CSS agrupadas en `ocio/ocio.css`) para no interferir con el wiring de
   eventos de las recomendaciones en los modales.
6. **Re-render con todos los argumentos**:
   `openMovieModal(item, callbacks, recommendations, existingIds,
   sagaParts)` propaga ahora **todos** los argumentos en el re-render
   (`rerender`), no solo `(item, callbacks)`. Cambio de comportamiento
   intencionado y positivo: los re-renders ya no se «tragan» secciones,
   y las recomendaciones persisten tras marcar como vista.
7. **Fix de QA en `onAddRecommendation`**: al añadir una recomendación
   (película o serie), el callback actualiza `existingIds` (gracias al
   retorno booleano de `addFromRecommendation`), evitando que tras un
   re-render el botón quede obsoleto («Añadir» sobre algo ya añadido) y
   que se creen duplicados.

Carga de datos con **degradación elegante**: `openMovieItem` carga
`sagaParts` (solo si `item.collectionId`) en un `try/catch`; si la
consulta falla, `sagaParts` es `null`, la sección se oculta y el banner
de saga (y el resto de la ficha) sigue visible.

Alternativas descartadas:

- **Reutilizar `.rec-card__add` directamente en las tarjetas de saga**:
  habría interferido con el wiring de eventos de las recomendaciones en
  el mismo modal; una clase propia con selectores CSS agrupados da el
  mismo estilo sin acoplarse.
- **Sin caché (pedir TMDB en cada apertura de ficha)**: más llamadas
  repetidas contra TMDB para la misma colección; la caché compartida de
  24 h es la política ya establecida para `getMovieDetails` y los watch
  providers (ADR-009).
- **Extender el selector con checklist con las tarjetas dentro**:
  cambiaría una interacción ya documentada y aceptada en el manual; la
  tarjeta es una vía de alta directa complementaria, no sustitutiva.

## Consecuencias

**Positivas:**

- El usuario ve de un vistazo el resto de la saga (portada, título, año)
  y añade cualquiera de sus películas con un clic, sin abrir el selector.
- Reutilización máxima: la tarjeta hereda estilos, `loading="lazy"`,
  responsive (`recommendations__scroll`) y comportamiento de alta del
  flujo existente; solo se añade la capa de render y wiring.
- Menos llamadas a TMDB: una colección ya consultada (por el selector o
  por la sección nueva) no se vuelve a pedir en 24 h.
- El estado «Añadida» persiste en los re-renders del modal (Set
  compartido), tanto en las tarjetas de saga como en las
  recomendaciones (fix de QA).
- Los re-renders ya no pierden las recomendaciones (cambio de
  comportamiento positivo, documentado en este ADR).
- Degradación elegante: si TMDB falla, la ficha sigue completa y el
  banner de saga visible; la sección solo se oculta.

**Negativas:**

- Una llamada más a la API por cada ficha de saga abierta la primera
  vez (mitigada por la caché de 24 h, que comparte con el selector).

**Neutras:**

- Sin cambios en el modelo de datos, exportaciones (ICS, backup) ni en
  el flujo del selector «Añadir resto de la saga» (se mantiene tal
  cual, ahora con una vía de alta directa adicional).
- La sección se muestra también en la ficha de solo lectura
  (read-only), sin botones (`interactive` false) cuando no procede
  añadir.
- Responsividad cubierta por el patrón existente de las
  recomendaciones (scroll horizontal contenido); los cuatro modos de
  tema (Oscuro, Negro puro, Claro y Blanco puro) usan variables de
  tema (`--ink-soft`, clases `btn--accent-media` existentes) y han sido
  verificados, según las reglas 2 y 4 de AGENTS.md.

## Iteración 2026-08-13: vista previa al pulsar una tarjeta de saga

### Contexto

El usuario amplió el alcance de la issue #280 con un comentario: «En
esas otras películas de la saga, además de las recomendaciones, se debe
poder pulsar sobre las películas antes de añadirlas para ver su
información». Las tarjetas de la sección «Otras películas de la saga»
debían dejar de ser un atajo de alta directa y convertirse también en
un punto de entrada a la información de la película, con el mismo
comportamiento que la vista previa de búsqueda (issue #22, ADR-030).

### Decisión

Hacer **pulsables** las tarjetas de la sección: pulsar una tarjeta abre
la **vista previa de esa película**, reutilizando
`openSearchPreviewModal` (el patrón de la issue #22) en lugar de
construir un modal nuevo:

1. **Tarjeta pulsable** (`renderSagaMovies` en `js/ui.js`): cuando se
   pasa el nuevo argumento `onOpen`, la portada, el título y el año
   quedan envueltos en un botón `.saga-card__open` (con `aria-label`
   «Ver información de …», porque el cuerpo pasa a ser *phrasing
   content*: `.rec-card__body` se emite como `span`), con el hint
   **«Ver información»** (`.saga-card__hint`). El botón «Añadir»
   (`.saga-card__add`) se mantiene como hermano, anclado abajo por el
   `flex: 1` del botón open.
2. **Vista previa con `openSearchPreviewModal`**
   (`openSagaMoviePreview` en `js/modal-handlers.js`): construye un
   ítem ligero con los datos de la parte de la saga (`externalId`,
   `title`, `year`, `posterUrl`, `overview`) y abre la preview con la
   cabecera (portada, título y año) y los **detalles enriquecidos** vía
   `onEnrich` → `getMovieDetails` (duración, género, director, reparto,
   sinopsis, rating comunitario y tráiler si aplica). El callback
   **`onClose`** —nuevo en `openSearchPreviewModal` (issue #22), sin
   cambios de comportamiento para la búsqueda— cierra la preview y
   restaura la ficha original con `reopen`. El **`onAdd`** reutiliza
   `addSagaMovie` (el mismo flujo de alta que la tarjeta):
   «Añadiendo…» → toast → cerrar la preview → restaurar la ficha, con el
   Set `existingIds` actualizado para que la tarjeta vuelva como
   «Añadida».
3. **Restauración también por ✕, backdrop y Escape**: `openSearchPreviewModal`
   guarda el cierre personalizado en `modal._onClose`; el nuevo
   `closeActiveModal` de `setupModalCloseListeners`
   (`js/modal-handlers.js`) lo respeta y consume antes de cerrar, y
   `closeModal` (`js/ui.js`) lo limpia (`modal._onClose = null`) para
   que el cierre interno de la preview no re-dispare la restauración en
   cascada (fix de QA).
4. **Películas ya añadidas**: la preview se abre con `added: true`
   según el Set `existingIds`, mostrando **«Ya añadido»** con el botón
   deshabilitado (estado que `openSearchPreviewModal` ya soportaba del
   ADR-030; se reutiliza tal cual).
5. **Estilos** (`ocio/ocio.css`): `.saga-card__open` (reset de botón,
   `display: flex; flex-direction: column; flex: 1`, `focus-visible`
   con `--teal-reel`), `.saga-card .rec-card__cover` con
   `display: block` (evita el gap de baseline de la `img` inline dentro
   del `button`) y `.saga-card__hint` con **contraste AA en los cuatro
   temas**: hex `#5f5849` (~5.1:1) por defecto en la familia oscura y
   override agrupado (selectores por comas `[data-theme="black"]
   .saga-card__hint, [data-theme="light"] .saga-card__hint,
   [data-theme="white"] .saga-card__hint`) que restaura `--ink-soft`,
   siguiendo el patrón de selectores agrupados (regla 4 de AGENTS.md).

### Alternativas descartadas

- **Abrir la ficha completa del ítem no registrado**: el flujo de ficha
  (`openMovieItem`) opera sobre ítems ya registrados; habría que
  fabricar un draft temporal y no existe un recorrido de «no añadido»
  con ese aspecto. La preview de la issue #22 ya es el patrón del
  proyecto para «ver antes de añadir».
- **No hacer nada (dejar solo el botón «Añadir» de la tarjeta)**: no
  responde al comentario del usuario; sin la vista previa no hay forma
  de ver la información de la película antes de decidir añadirla.

### Consecuencias

**Positivas:**

- El usuario puede **explorar la información** de una película de la
  saga (portada, duración, reparto, sinopsis, rating comunitario,
  tráiler) antes de añadirla, respondiendo al comentario de la issue.
- **Flujo restaurable**: cerrar la preview por cualquiera de las cuatro
  vías («Cerrar», ✕, backdrop o Escape) o añadir la película devuelve a
  la ficha que se estaba viendo, sin perder el contexto ni el estado
  («Añadida» persistido en `existingIds`).
- **Reutilización total**: `openSearchPreviewModal` (issue #22),
  `onEnrich`/`getMovieDetails` y `addSagaMovie` se reutilizan sin
  duplicar lógica de render ni de alta; la vista previa de búsqueda no
  cambia de comportamiento (`onClose` es opcional y `_onClose` se
  limpia en `closeModal`).
- Accesibilidad: la tarjeta es un botón real con `aria-label`, hint
  visible, `focus-visible` y contraste AA en los cuatro temas.

**Negativas / neutras:**

- Al restaurar la ficha se produce una **reConsulta ligera a TMDB**
  (`getCollectionDetails` al re-render de la ficha, cubierta por la
  caché compartida de 24 h; los detalles de la ficha no se re-piden,
  `reopen` es un re-render con `isRerender`).
- La preview muestra la información del patrón ADR-030 (sin «Dónde
  verla», que es exclusivo de la ficha de un ítem registrado).
- En la ficha de solo lectura (read-only) las tarjetas no son pulsables
  (`onOpen` solo se pasa cuando procede la interacción).

## Iteración 2026-08-14: vista previa ampliada al pulsar una tarjeta de recomendación

### Contexto

El usuario amplió de nuevo el alcance de la issue #280 con un comentario
del 2026-08-14: «En las películas de las recomendaciones también se debe
poder pulsar para ampliar la información». Tras la iteración anterior
(tarjetas de saga pulsables), las tarjetas de «Si te gustó esto, quizá
te guste...» de la ficha de película **y** de la ficha de serie debían
comportarse igual: al pulsarlas, abrir la vista previa ampliada con la
información antes de añadir la recomendación.

### Decisión

Hacer **pulsables** las tarjetas de recomendaciones con el **mismo
patrón que las de saga** (y que la vista previa de búsqueda de la issue
#22), factorizando en un helper compartido la mecánica de preview:

1. **Tarjeta pulsable** (`renderRecommendations` en `js/ui.js`): nuevo
   parámetro opcional `onOpen`; cuando es función, cada tarjeta se
   renderiza como `.rec-card.rec-card--openable` con un botón
   `.rec-card__open` (con `aria-label` «Ver información de …») que
   envuelve `img.rec-card__cover` + `span.rec-card__body` (título, año y
   hint `.rec-card__hint` «Ver información»), y el botón `.rec-card__add`
   queda como hermano, anclado abajo por el `flex: 1` del botón open
   (misma mecánica que `.saga-card__open`).
2. **Helper compartido `openExternalPreview`** (`js/modal-handlers.js`):
   centraliza la mecánica común de la preview (cerrar la ficha antes de
   abrir, `openSearchPreviewModal` con `added` según el Set `existingIds`,
   `onClose` → `closeModal` + restaurar la ficha, `onAdd` → alta +
   `existingIds.add` + toast + cierre + restauración) y la comparten
   `openSagaMoviePreview` (saga, refactorizada) y la nueva
   `openRecommendationPreview` (recomendaciones, tipo `movie`/`tv`).
3. **Enriquecimiento por tipo** (`enrichExternalPreview`): las películas
   se enriquecen con `getMovieDetails`; las series con `getTvExtraDetails`
   + `getTvSeasonsMeta` (no bloqueante). Nunca lanza: si falla devuelve
   `{}` y la preview mantiene los datos de la tarjeta.
4. **Refactor `addFromRecommendation` → `addRecommendationItem`**: el
   núcleo de alta (sin estado de botón) se extrae para reutilizarlo como
   `performAdd` desde `openExternalPreview`; el wrapper conserva el
   estado «Añadiendo…»/«Añadido» del botón de la tarjeta.
5. **Wiring**: `onOpenRecommendation` se añade a los callbacks de
   `openMovieItem` y `openTvItem` (usa `reopen` + el Set `existingIds`
   compartido → la tarjeta vuelve «Añadida» al restaurar la ficha, y la
   preview abre «Ya añadido» deshabilitado si ya está en el registro).
6. **Estilos** (`ocio/ocio.css`): los selectores de la iteración de saga
   se agrupan por comas (`.saga-card__open, .rec-card__open`,
   `.saga-card .rec-card__cover, .rec-card--openable .rec-card__cover`
   y `.saga-card__hint, .rec-card__hint`, incluidos `:focus-visible` y
   el override de temas), una sola fuente de verdad por regla (regla 4
   de AGENTS.md); el hint mantiene el contraste AA (base `#5f5849` en la
   familia oscura, `--ink-soft` en negro puro, claro y blanco puro).

### Alternativas descartadas

- **Duplicar el helper de preview en cada sección** (una copia para la
  saga y otra para las recomendaciones): dos flujos casi idénticos que
  habría que mantener sincronizados; `openExternalPreview` centraliza la
  mecánica de la issue #22 y cada sección solo aporta el ítem ligero, el
  enriquecimiento y la función de alta.
- **Reutilizar `.saga-card__open` también en las recomendaciones**:
  interferiría con el wiring de eventos, que en las recomendaciones usa
  `data-rec-index` y en la saga `data-saga-index` (clases e índices
  distintos evitan colisiones en el mismo modal); por eso la tarjeta de
  recomendación usa su propia clase `.rec-card__open`, compartiendo las
  reglas CSS por selectores agrupados.

### Consecuencias

**Positivas:**

- El usuario puede **explorar la información ampliada** de cualquier
  recomendación —película o serie— antes de añadirla, con el mismo
  flujo restaurable que las tarjetas de saga: cerrar por cualquiera de
  las vías o añadir devuelve a la ficha que se estaba viendo.
- Las series muestran además sus **temporadas** en la preview
  (enriquecimiento específico por tipo).
- **Reutilización**: el refactor a `addRecommendationItem` y
  `openExternalPreview` elimina la duplicación de lógica de alta y de
  preview sin cambiar el comportamiento del botón «Añadir» original de
  la tarjeta.
- El modal de película **convive con las dos secciones pulsables**
  (saga y recomendaciones) sin interferencia: clases
  (`.saga-card__open`/`.rec-card__open`) e índices
  (`data-saga-index`/`data-rec-index`) distintos.

**Negativas / neutras:**

- Cada tarjeta pulsada añade una **llamada a la API** de TMDB para el
  enriquecimiento (`getMovieDetails`/`getTvExtraDetails`), con
  **degradación elegante**: si falla, la preview mantiene los datos de
  la tarjeta y no bloquea el alta (el propio `addRecommendationItem`
  tampoco se bloquea si falla la consulta de detalles extra).
- El **manual de usuario** se ha actualizado en la misma PR (regla 3 de
  AGENTS.md): el bullet «Recomendaciones» de la ficha explica las
  tarjetas pulsables, la ventana con «Añadir»/«Cerrar», la vuelta a la
  ficha, el «Ya añadido» deshabilitado y las temporadas en las series.
- La PR es la **misma #281** (rama `feature/issue-280-otras-peliculas-saga`);
  no se abre una PR nueva para esta iteración.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: `getCollectionDetails` con caché en memoria de 24 h compartida (`providersCache`, clave `collection_<id>`); solo se cachean respuestas correctas |
| `js/modal-handlers.js` | **Modificado**: `openMovieItem` carga `sagaParts` (try/catch, degradación elegante); nuevo callback `onAddSagaMovie` (reutiliza `addSagaMovie` + actualiza `existingIds`); `addFromRecommendation` devuelve boolean; `onAddRecommendation` actualiza `existingIds` (fix QA, también en `openTvItem`). **Iteración**: `openSagaMoviePreview` (preview con `openSearchPreviewModal`, `onClose` restaura la ficha, `onAdd` reutiliza `addSagaMovie`), `onOpenSagaMovie` en `openMovieItem` y `closeActiveModal` en `setupModalCloseListeners` (✕, backdrop y Escape respetan `modal._onClose`). **Iteración 2026-08-14**: helper compartido `openExternalPreview` (mecánica issue #22: onClose restaura la ficha, onAdd añade + `existingIds.add` + toast + cierre + restauración), `openRecommendationPreview` (movie/tv) y `openSagaMoviePreview` refactorizada sobre el helper; `enrichExternalPreview` por tipo (movie → `getMovieDetails`; tv → `getTvExtraDetails` + `getTvSeasonsMeta` no bloqueante; nunca lanza); extracción `addRecommendationItem` desde `addFromRecommendation` (núcleo sin estado de botón); `onOpenRecommendation` en `openMovieItem` y `openTvItem` |
| `js/ui.js` | **Modificado**: nueva `renderSagaMovies` (sección «Otras películas de la saga» con `.rec-card`/`.recommendations__scroll` y botón `.saga-card__add`); `openMovieModal` acepta `sagaParts` y propaga todos los argumentos en el re-render; wiring de `.saga-card__add`. **Iteración**: `renderSagaMovies` con tarjeta pulsable `.saga-card__open` + hint «Ver información»; `onClose` (nuevo) en `openSearchPreviewModal` guardado en `modal._onClose`; `closeModal` consume `modal._onClose`. **Iteración 2026-08-14**: `renderRecommendations` con parámetro opcional `onOpen` (tarjeta `.rec-card--openable` con `.rec-card__open` + hint «Ver información» y `.rec-card__add` como hermano); `onOpenRecommendation` en `openMovieModal` y `openTvModal` (render con el quinto argumento y wiring de `.rec-card__open` → `recommendations[index]`) |
| `ocio/ocio.css` | **Modificado**: `.saga-movies`, `.saga-movies__title` (estilo de `.recommendations__title` con variables de tema) y regla agrupada `.rec-card .rec-card__add, .saga-card .saga-card__add`. **Iteración**: `.saga-card__open` (reset de botón, `flex: 1`, `focus-visible`), `.saga-card .rec-card__cover` con `display: block` y `.saga-card__hint` con contraste AA en los 4 temas (override agrupado por temas). **Iteración 2026-08-14**: selectores agrupados `.saga-card__open, .rec-card__open`, `.saga-card .rec-card__cover, .rec-card--openable .rec-card__cover` y `.saga-card__hint, .rec-card__hint` (una sola fuente de verdad por regla, contraste AA del hint y `:focus-visible` agrupados) |
| `docs/manual-de-usuario.md` | **Modificado**: sección 11, bullet «Sagas» ampliado con las tarjetas «Otras películas de la saga» y sus botones «Añadir»/«Añadida». **Iteración**: el bullet explica que se puede pulsar la tarjeta para ver la información antes de añadirla (botones «Añadir»/«Cerrar», vuelta a la ficha, «Ya añadido» deshabilitado). **Iteración 2026-08-14**: el bullet «Recomendaciones» explica las tarjetas pulsables con vista previa ampliada (portada, duración, género, reparto, sinopsis, puntuación y tráiler; temporadas en las series), los botones «Añadir»/«Cerrar», la vuelta a la ficha y el «Ya añadido» deshabilitado |
| `docs/adr-096-otras-peliculas-saga.md` | **Nuevo**: este documento |
| `tasks/task-issue-280.json` | Task file de la tarea |

Related issue: #280