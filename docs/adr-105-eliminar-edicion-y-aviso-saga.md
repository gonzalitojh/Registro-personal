# ADR-105: Eliminar la edición de información y el aviso de saga en películas y series (issue #296)

## Estado

Aceptado

## Fecha

2026-08-18

## Contexto

La issue #296 (tipo content) pide eliminar de la ficha de **películas y
series** dos elementos, conservando el carrusel de saga: «En la ficha de
películas y series se debe eliminar el botón de editar información
(✎ Editar información) y la sección/botón de añadir resto de la saga,
manteniendo el carrusel de otras películas de la saga».

La issue incluye además una **instrucción explícita del usuario sobre la
rama base**: el trabajo debe partir de la rama `feat/issue-201` y la PR
debe hacerse contra esa rama (no contra `dev`), como excepción puntual a
la regla general de integración (ADR-029).

Estado actual del código antes del cambio:

- El botón **«✎ Editar información»** (`editButtonHtml` /
  `#btn-edit-item`) se mostraba en las **cuatro** fichas de ocio
  (película, serie, libro y videojuego), tanto en el modal clásico
  (`openMovieModal`/`openTvModal`/`openBookModal`/`openGameModal` en
  `js/ui.js`) como en la página de detalle (`#/ocio/...`, ADR-100), vía
  el callback `onEdit` → `editHandlerFor` (`js/modal-handlers.js`).
- La ficha de **película** mostraba el banner **«Saga: …»** con el botón
  **«Añadir resto de la saga»** (`#btn-add-saga`, `.saga-banner` en
  `openMovieModal`, `js/ui.js`), que abría el **selector con checklist**
  (`openSagaSelector` en `js/modal-handlers.js` →
  `openSagaSelectionModal` en `js/ui.js`, ADR-006), con su CSS propio
  (`.saga-banner`, `.saga-row*`, `.saga-list`, `.saga-subtitle`,
  `.saga-count` y los overrides `[data-theme="black"]` en
  `ocio/ocio.css`). El mismo banner con su botón se mostraba en la
  **vista previa de la página de ítem** (`paintPreview` en
  `js/item-page.js`, ADR-100/ADR-102).
- Justo debajo del banner coexistía el **carrusel «Otras películas de la
  saga»** (`renderSagaMovies`, ADR-096, issue #280): tarjetas con
  botones **«Añadir»/«Añadida»** por tarjeta (`onAddSagaMovie` →
  `addSagaMovie`) y **navegación a la página de la película** al pulsar
  la tarjeta (`onOpenSagaMovie`, issue #285). La carga de `sagaParts` se
  hacía con `getCollectionDetails` (caché compartida de 24 h, ADR-096)
  con degradación elegante.
- La versión PWA era `20261008` (ADR-104, iteración 2).

Related issue: #296 — https://github.com/gonzalitojh/Registro-personal/issues/296

## Decisión

Eliminar el botón «✎ Editar información» y el aviso de saga (banner +
selector) en **películas y series**, conservando el carrusel «Otras
películas de la saga» como única vía de gestión de sagas:

1. **Quitar «✎ Editar información» solo en películas y series**:
   `openMovieModal` y `openTvModal` (`js/ui.js`) dejan de renderizar
   `editButtonHtml()` y de wirear `#btn-edit-item`; `openMovieItem` y
   `openTvItem` (`js/modal-handlers.js`) dejan de pasar `onEdit` a los
   callbacks. **Libros y videojuegos conservan la edición** sin cambios:
   `openBookModal`/`openGameModal` siguen usando `editButtonHtml()` y
   `onEdit: editHandlerFor(...)`.
2. **Quitar el banner «Saga: …»** con el botón «Añadir resto de la saga»
   de la ficha de película (`openMovieModal`) y de la vista previa de la
   página de ítem (`paintPreview`): con `collectionId`, la ficha
   renderiza directamente el carrusel `renderSagaMovies(...)`, sin banner
   previo.
3. **Eliminar el selector de saga con checklist y su wiring**: se
   eliminan `openSagaSelector` (`js/modal-handlers.js`) y
   `openSagaSelectionModal` (`js/ui.js`), el callback `onAddSaga` de
   `openMovieModal`/`openMovieItem` y los listeners de `#btn-add-saga`
   en `js/ui.js` y `js/item-page.js`.
4. **Eliminar el CSS muerto** del banner y del selector en
   `ocio/ocio.css` (`.saga-banner`, `.saga-banner__label`, `.saga-list`,
   `.saga-row` y su `:focus-within`, `.saga-row__cover/__title/__year`,
   `.saga-subtitle`, `.saga-count` y los overrides `[data-theme="black"]`
   que les afectaban) y actualizar el **comentario de `css/styles.css`**
   que referenciaba `.saga-row` como patrón de accent-color (los
   checkboxes de la lista de la compra quedan autónomos, sin referencia
   a CSS eliminado).
5. **Conservar el carrusel «Otras películas de la saga»**
   (`renderSagaMovies`) íntegro: botones «Añadir»/«Añadida» por tarjeta
   (`onAddSagaMovie` → `addSagaMovie`) y navegación a la página de la
   película al pulsar la tarjeta (`onOpenSagaMovie`); la carga de
   `sagaParts` con `getCollectionDetails` (caché de 24 h, degradación
   elegante si falla) se mantiene tal cual.
6. **Comentarios alineados**: en `js/item-page.js` se eliminan las
   menciones a «editar» de la cabecera y de las acciones de la preview, y
   el jsdoc de `renderSagaMovies` (`js/ui.js`) describe `onOpen` como
   apertura de la **página de detalle** (issue #285).
7. **Manual de usuario actualizado** en la misma tarea (regla 3 de
   AGENTS.md): la sección 4.7 pasa de «Editar y eliminar» a **«Eliminar»**
   (sin «✎ Editar información» en series) y el bullet **«Sagas»** de la
   sección 12 describe solo el carrusel «Otras películas de la saga» con
   sus botones y la navegación por tarjeta — sin aviso «Saga: …», sin
   «Añadir resto de la saga» y sin selector.
8. **PWA**: bump de versión `20261008` → `20261009` (`js/config.js`,
   `index.html`, `service-worker.js`) para invalidar las cachés del
   precache.

## Alternativas descartadas

- **Mantener el banner «Saga: …» sin botón (solo informativo)**: seguir
  ocupando espacio en la ficha para un dato (el nombre de la saga) que el
  usuario no pidió conservar y que no aporta acción alguna; la issue pide
  eliminar el aviso, no reducirlo.
- **Eliminar también el carrusel «Otras películas de la saga»**: la issue
  pide expresamente **mantenerlo** («manteniendo el carrusel de otras
  películas de la saga»); además es la vía de alta directa del ADR-096 y
  eliminar la gestión de sagas dejaría sin recorrido la caché de
  `getCollectionDetails`.
- **Quitar la edición también en libros y videojuegos (uniformidad)**: la
  issue acota la eliminación a películas y series; en libros y
  videojuegos la edición (título, año, portada, etc.) sigue siendo la
  única vía de corregir datos introducidos en el alta manual.

## Consecuencias

**Positivas:**

- **Ficha de películas y series más limpia**: desaparecen el botón
  «✎ Editar información», el banner «Saga: …» y el botón «Añadir resto de
  la saga»; el alta de sagas queda en el carrusel, una sola vía
  coherente con las tarjetas de recomendaciones.
- **Menos código muerto**: ~280 líneas de JS y CSS eliminadas
  (`openSagaSelector`, `openSagaSelectionModal`, banner, selector y sus
  estilos; balance neto de ~270 líneas menos entre los 5 archivos
  tocados), menos mantenimiento y menos superficies por tema que
  verificar (regla 4 de AGENTS.md).
- **Menos superficies de tema**: los overrides `[data-theme="black"]`
  del banner y del selector se eliminan con su CSS; el carrusel ya
  cubierto desde el ADR-096 queda como única superficie de saga.
- El manual de usuario queda alineado con el comportamiento real
  (regla 3 de AGENTS.md).

**Negativas / neutras:**

- **Se pierde la edición de datos básicos en películas y series**
  (título, año, portada...): es exactamente lo que pide la issue; los
  datos quedan a cargo del refresco diario con TMDB (ADR-021) y de la
  re-consulta de detalles al abrir la ficha.
- **El carrusel «Otras películas de la saga» sigue siendo superficie con
  botones por tarjeta**: requiere mantener la cobertura de los cuatro
  modos de tema y el wiring `onAddSagaMovie`/`onOpenSagaMovie` (ya
  resuelto desde ADR-096, se conserva).
- **PWA bump a `20261009`**: un precache/recarga adicional para los
  usuarios al desplegar.
- **PR contra `feat/issue-201`** (no contra `dev`): excepción puntual a
  la regla general de integración (ADR-029) por instrucción explícita
  del usuario en la issue #296; la promoción posterior a `dev` queda
  fuera de esta tarea.
- Los ADR que documentaban las funcionalidades eliminadas (ADR-006,
  ADR-016, ADR-084) quedan como **registro histórico**: el
  comportamiento vigente es el descrito en este ADR.

## Iteración: separadores horizontales entre secciones de la ficha (2026-08-18)

La issue #296 añadió un comentario de seguimiento pidiendo una **barra
horizontal** encima de las secciones «Producción», «Reparto» y «Otras
películas de la saga», igual que la que ya existía encima de «Si te
gustó esto, quizá te guste...». Aplica a **películas y series** (las
series no tienen sección de saga, así que solo reciben la barra los
carruseles de elenco).

**Decisión**: CSS puro en `ocio/ocio.css`, sin tocar JS ni markup:
`.cast-crew` (carruseles de elenco, Producción y Reparto) y
`.saga-movies` (carrusel de saga) adoptan el mismo patrón de separación
que `.recommendations`: `padding-top: 0.8rem` + `border-top: 1px solid
var(--paper-line)`. Al ser una variable de tema (dos familias, regla 4
de AGENTS.md), la línea se ve correcta en los cuatro modos sin
overrides adicionales. El margen superior de `.saga-movies` pasa de
`0.4rem` a `1.2rem` para mantener el mismo aire que el resto de
secciones con barra.

**Alternativa descartada**: añadir un elemento HTML de separación por
cada sección — más superficie que mantener y sin ventaja visual; el
borde superior del contenedor ya existente da exactamente la misma
línea que la de recomendaciones.

**Consecuencias**: las secciones de elenco y saga de la ficha quedan
visualmente delimitadas como las recomendaciones; el manual de usuario
se actualiza con una mención breve («Cada sección de la ficha va
separada por una línea horizontal»). Sin cambios de comportamiento ni
de accesibilidad (el separador es decorativo, `border` no se anuncia a
lectores de pantalla).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | **Modificado**: `openMovieModal` y `openTvModal` sin `editButtonHtml()` ni wiring de `#btn-edit-item` (la edición queda solo en `openBookModal`/`openGameModal`); eliminado el banner `.saga-banner` con `#btn-add-saga` de la ficha de película (ahora `collectionId` renderiza directamente `renderSagaMovies`); eliminada `openSagaSelectionModal` y el callback `onAddSaga`; jsdoc de `renderSagaMovies` actualizado (onOpen abre la página de detalle, issue #285) |
| `js/modal-handlers.js` | **Modificado**: eliminada `openSagaSelector`; `openMovieItem` y `openTvItem` sin `onEdit` (libros y videojuegos conservan `editHandlerFor`) y `openMovieItem` sin `onAddSaga`; comentario de carga de `sagaParts` actualizado (el carrusel no se renderiza si falla, sin banner que conservar) |
| `js/item-page.js` | **Modificado**: `paintPreview` sin banner `.saga-banner` ni listener de `#btn-add-saga` (solo `renderSagaMovies` con su wiring `.saga-card__add`); comentarios de cabecera y de acciones de la preview sin «editar» |
| `ocio/ocio.css` | **Modificado**: eliminados los estilos del banner (`.saga-banner`, `.saga-banner__label`) y del selector (`.saga-subtitle`, `.saga-list`, `.saga-row`, `.saga-row__cover/__title/__year`, `.saga-count`, `.saga-row:focus-within`) y los overrides `[data-theme="black"]` asociados (`.saga-list`, `.saga-banner__label`); **iteración**: `.cast-crew` y `.saga-movies` con `padding-top: 0.8rem` + `border-top: 1px solid var(--paper-line)` (barra horizontal como la de recomendaciones) y `.saga-movies` con margen superior de `1.2rem` |
| `css/styles.css` | **Modificado**: comentario de los checkboxes de la lista de la compra sin referencia a `.saga-row` (patrón ya eliminado de Ocio) |
| `index.html` | **Modificado**: bump PWA a `20261009` en las URLs versionadas de estilos y `js/app.js` |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261009` |
| `service-worker.js` | **Modificado**: bump PWA a `20261009` en `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 4.7 renombrada «Editar y eliminar» → **«Eliminar»** (sin «✎ Editar información»); bullet «Sagas» de la sección 12 sin aviso «Saga: …», sin «Añadir resto de la saga» ni selector (solo el carrusel con sus botones y la navegación por tarjeta); **iteración**: mención breve en la sección 12 de que cada sección de la ficha va separada por una línea horizontal |
| `docs/adr-105-eliminar-edicion-y-aviso-saga.md` | **Nuevo**: este documento |
| `tasks/task-issue-296.json` | Task file de la tarea |

Related issue: #296 — https://github.com/gonzalitojh/Registro-personal/issues/296
