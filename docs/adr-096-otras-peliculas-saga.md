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

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: `getCollectionDetails` con caché en memoria de 24 h compartida (`providersCache`, clave `collection_<id>`); solo se cachean respuestas correctas |
| `js/modal-handlers.js` | **Modificado**: `openMovieItem` carga `sagaParts` (try/catch, degradación elegante); nuevo callback `onAddSagaMovie` (reutiliza `addSagaMovie` + actualiza `existingIds`); `addFromRecommendation` devuelve boolean; `onAddRecommendation` actualiza `existingIds` (fix QA, también en `openTvItem`) |
| `js/ui.js` | **Modificado**: nueva `renderSagaMovies` (sección «Otras películas de la saga» con `.rec-card`/`.recommendations__scroll` y botón `.saga-card__add`); `openMovieModal` acepta `sagaParts` y propaga todos los argumentos en el re-render; wiring de `.saga-card__add` |
| `ocio/ocio.css` | **Modificado**: `.saga-movies`, `.saga-movies__title` (estilo de `.recommendations__title` con variables de tema) y regla agrupada `.rec-card .rec-card__add, .saga-card .saga-card__add` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 11, bullet «Sagas» ampliado con las tarjetas «Otras películas de la saga» y sus botones «Añadir»/«Añadida» |
| `docs/adr-096-otras-peliculas-saga.md` | **Nuevo**: este documento |
| `tasks/task-issue-280.json` | Task file de la tarea |

Related issue: #280