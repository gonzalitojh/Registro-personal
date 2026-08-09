# ADR-056: Re-búsqueda automática en el catálogo activo y fallback de portadas en el buscador global (issue #149)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #149 («Múltiple búsqueda en catálogo») reporta dos bugs en el
buscador global (`js/global-search.js`):

1. **Bug 1 — catálogo «pegado»**: al buscar en el catálogo (p. ej.
   películas), borrar el texto para buscar otra cosa y escribir una
   query nueva, la sección del catálogo se queda **colgada en
   «Buscando en el catálogo…»** y el botón de tipo (Serie/Película/
   Libro) sigue marcado, aunque ya no se esté buscando nada. Diagnóstico
   de la issue: `performSearch()` no resetea `activeGroup` cuando la
   query queda vacía o < 2 caracteres, y al escribir una query nueva con
   un grupo activo, `renderResults()` muestra el estado de carga sin
   volver a llamar a `runExternalSearch()` para la nueva query (la caché
   `externalCache[group].query` no coincide con la query nueva). La
   issue proponía dos opciones: desmarcar el catálogo al borrar, o
   esperar 1-2 segundos sin input (debounce) y re-buscar en el mismo
   catálogo ya seleccionado.
2. **Bug 2 — errores 403 en consola**: las portadas de la colección
   guardadas con `coverUrl` (p. ej. URLs de CDNs que bloquean
   hotlinking, como `fbcdn.net`) fallan al cargar con 403 (Forbidden) y
   no hay ningún fallback que sustituya la imagen por el placeholder,
   generando errores en la consola del navegador. Lo mismo puede
   ocurrir con los avatares de amigos.

Related issue: #149 — https://github.com/gonzalitojh/Registro-personal/issues/149

## Decisión

### 1. Bug 1 — desmarcar al borrar + re-búsqueda automática en el catálogo activo

En `performSearch()` (el punto de entrada con debounce de 200 ms para
los cambios del input) se hacen dos cambios:

- **Al borrar el texto (query vacía o < 2 caracteres)**: se asigna
  `activeGroup = null` **antes** de llamar a `renderHint()`. Es
  suficiente para desmarcar visualmente el botón de tipo porque
  `renderTypeButtons()` marca la clase `is-active` comparando cada
  grupo con `activeGroup`; al re-renderizar el hint, los tres botones
  vuelven a quedar sin pulsar y el usuario elige de nuevo el tipo de
  catálogo.
- **Al escribir una query nueva (>= 2 caracteres) con un catálogo
  activo**: si la query actual **no tiene estado** en ese grupo, se
  relanza automáticamente `runExternalSearch(group, trimmed)` y se hace
  `return` explícito. `runExternalSearch()` ya hace su propio
  `renderResults()` (primero muestra «Buscando en el catálogo…» vía
  `externalSectionLoadingHtml()` y luego el resultado); el `return`
  evita que se ejecute el `renderResults(collectionResults(trimmed),
  trimmed)` final de `performSearch()` y se renderice dos veces.

Se combinan así **las dos opciones que proponía la issue** (desmarcar
al borrar + re-buscar automáticamente al seguir escribiendo), en lugar
de añadir un debounce de 1-2 segundos: el debounce existente de 200 ms
es suficiente y no retrasa la respuesta del catálogo.

**Por qué en `performSearch()` y no en `renderResults()`**:
`renderResults()` es una función de render puro con varios llamadores
(`runExternalSearch`, `refreshExternalResults`, `handleTypeClick`,
`performSearch`); poner ahí la lógica de relanzamiento crearía
recursión (`runExternalSearch` → `renderResults` → `runExternalSearch`
→ …) y dispararía búsquedas en flujos que no son entrada del usuario.
En cambio, `performSearch()` es el único punto de entrada de los
cambios de texto (debounced), ya invalida búsquedas en curso
(`searchSeq++`) y conoce el valor actual del input.

**Por qué las tres guardas** (solo se relanza si ninguna se cumple):

- `sameQueryInFlight` (`inFlight[group] && externalQuery[group] ===
  trimmed`): si ya hay una búsqueda en vuelo para esa query exacta,
  relanzar duplicaría la llamada a la API (el mecanismo `searchSeq` la
  descartaría, pero sería trabajo desperdiciado).
- `cachedForQuery` (`externalCache[group] && externalCache[group].query
  === trimmed`): si hay caché válida para esa query exacta, la sección
  ya se renderiza desde caché en `renderResults()`; relanzar golpearía
  la API innecesariamente.
- `erroredForQuery` (`externalError[group] && externalError[group].query
  === trimmed`): si la última búsqueda de esa query falló, el
  relanzamiento automático en cada tecla spamearía la API con
  reintentos; la sección de error se muestra igualmente (la renderiza
  `renderResults()`) y el usuario puede reintentar explícitamente
  volviendo a pulsar el botón de tipo (`handleTypeClick()` relanza
  cuando no hay caché válida).

Se respeta la **selección única de la issue #82**: solo se muestra la
sección del catálogo del grupo pulsado, y el estado (carga/error/caché)
se conserva por grupo para poder volver sin re-buscar.

### 2. Bug 2 — fallback de portadas y avatares con listener de «error» en fase de captura

Se registra una vez, en `setupGlobalSearch()`, un listener del evento
`error` en **fase de CAPTURA** sobre `#global-search-results` (el
contenedor persistente del dropdown):

- Cuando cualquier `<img>` descendiente falla al cargar (403/404 por
  hotlinking bloqueado, red…), se sustituye su `src` por
  `ui.PLACEHOLDER_COVER` (data URI fijo «Sin imagen» de `ui.js`) si la
  imagen es un `HTMLImageElement` y tiene la clase
  `.global-search__item-cover` (portadas de la colección) o
  `.global-search__friend-avatar` (avatares de amigos) — las únicas dos
  clases de imagen que renderiza el dropdown.
- **Guard anti-bucle**: si `img.src` ya es `ui.PLACEHOLDER_COVER`, no se
  reasigna (`return`). Reasignar `src` dispara una nueva carga; sin la
  guarda, un fallo repetido entraría en un bucle infinito de
  error → reasignación → error.

**Por qué `capture: true`**: el evento `error` de los elementos media
(`<img>`, `<video>`…) **no burbujea**, así que un listener en fase de
burbuja sobre el contenedor nunca se dispararía. En fase de captura, el
evento sí atraviesa el contenedor en su camino de la raíz al objetivo,
con lo que se capturan los errores de **cualquier** imagen descendiente,
**incluidas las de los renders futuros** que se inyectan con `innerHTML`
(el contenedor persiste y el listener no se re-registra por render — el
mismo patrón de delegación que ya usa el click de los botones de tipo).

## Consideraciones

- **El fallback sustituye la imagen, no borra el histórico de la
  consola**: los errores 403 ya impresos antes de la sustitución no
  desaparecen del log; los nuevos sí se evitan (el navegador no loguea
  el error de la data URI del placeholder, que siempre carga).
- **Cobertura acotada al dropdown**: el listener solo actúa sobre las
  dos clases de `#global-search-results`. Portadas con 403 fuera del
  dropdown (p. ej. el modal de detalle) quedan fuera del alcance de la
  issue #149 (ya muestran placeholder solo si la URL falta en origen,
  vía `safeCoverUrl()`/`coverUrl || PLACEHOLDER_COVER`).
- **Más llamadas a la API al seguir escribiendo con catálogo activo**:
  cada query nueva (debounced 200 ms) dispara una búsqueda externa.
  Antes el flujo quedaba colgado; ahora consulta de verdad — es el
  comportamiento pedido por la issue, y las guardas lo acotan a queries
  realmente nuevas.
- **Cambio visible para el usuario**: sí aplica la regla 3 de AGENTS.md —
  `docs/manual-de-usuario.md` se actualiza en la misma tarea (sección
  7.1), a diferencia de los ADR-054/055 (cambios internos de CI).

## Alternativas descartadas

- **Debounce de 1-2 segundos para re-buscar en el catálogo activo**
  (opción 2 de la issue): descartada como sustituto — el debounce de
  200 ms existente ya agrupa la escritura; un debounce largo retrasaría
  la respuesta del catálogo sin aportar nada, y no resuelve el bug del
  botón marcado al borrar. Se mantiene la opción 1 (desmarcar al
  borrar) y se añade la re-búsqueda inmediata con el debounce actual.
- **Listener de `error` en fase de burbuja sobre el contenedor**:
  descartado — inviable: `error` no burbujea, nunca se dispararía.
- **Atributo `onerror` inline por imagen o listener por render**:
  descartado — obligaría a re-registrar listeners en cada
  `innerHTML`/re-render (coste y riesgo de fugas) o a mezclar lógica en
  las plantillas; la delegación en captura con un único listener
  persistente cubre también los renders futuros.

## Consecuencias

### Positivas

- **Fin del catálogo «pegado»**: al borrar el texto, el botón de tipo
  se desmarca y los tres vuelven a quedar sin pulsar; al seguir
  escribiendo con un catálogo activo, la búsqueda se relanza
  automáticamente en ese mismo catálogo (nunca más colgada en
  «Buscando…»).
- **Sin errores 403 en consola**: las portadas de la colección y los
  avatares de amigos que fallen (hotlinking bloqueado, p. ej.
  `fbcdn.net`) se sustituyen por la imagen «Sin imagen», y el resultado
  sigue siendo funcional (navegación, «Añadir», vista previa).
- **Un único listener permanente**: la delegación en captura cubre
  todos los renders futuros con coste cero por render.
- **Guardas anti-duplicado**: no se llama a la API para queries ya en
  vuelo, cacheadas o con error; tampoco hay reintentos automáticos en
  bucle sobre una query fallida.
- **Issue #82 intacta**: selección única del catálogo del grupo pulsado
  y estado (carga/error/caché) conservado por grupo.
- **Manual de usuario al día**: sección 7.1 documenta el nuevo
  comportamiento (desmarcado al borrar, re-búsqueda automática y
  sustitución de portadas rotas) — regla 3 de AGENTS.md cumplida en la
  misma tarea.

### Negativas / Riesgos

- **Más tráfico a la API del catálogo**: al seguir escribiendo con un
  catálogo activo, cada query nueva dispara una búsqueda externa (el
  flujo anterior ni siquiera buscaba). Aceptado: es el comportamiento
  pedido por la issue; las guardas evitan duplicados para la misma
  query.
- **Sin reintento automático sobre una query con error**: si la última
  búsqueda de una query falló, volver a escribir esa misma query no
  relanza la búsqueda (guarda `erroredForQuery`). Mitigación: el
  usuario puede reintentar pulsando de nuevo el botón de tipo, que
  siempre relanza cuando no hay caché válida.
- **Cobertura del fallback limitada al dropdown**: imágenes con 403
  fuera de `#global-search-results` siguen sin sustitución (fuera del
  alcance de #149).

### Neutras

- **Sin cambios en la interacción existente**: navegación por teclado,
  botones de tipo, paginación (cap 5), vista previa y alta manual no se
  tocan (AC4 de la issue).
- **Estado por grupo sin cambios**: cerrar el dropdown sigue limpiando
  todo el estado externo (`closeGlobalSearch()`); la caché por grupo
  sigue permitiendo volver a un catálogo sin re-buscar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/global-search.js` | **Modificado**: `performSearch()` — `activeGroup = null` al borrar la query (< 2 caracteres) antes de `renderHint()`; relanzamiento automático de `runExternalSearch(group, trimmed)` con `return` explícito si la query (>= 2 caracteres) no tiene estado en el grupo activo (guardas `sameQueryInFlight` / `cachedForQuery` / `erroredForQuery`); nuevo listener del evento `error` en fase de captura sobre `#global-search-results` que sustituye por `ui.PLACEHOLDER_COVER` las imágenes `.global-search__item-cover` y `.global-search__friend-avatar` fallidas, con guard anti-bucle (`img.src === ui.PLACEHOLDER_COVER` → `return`) |
| `docs/manual-de-usuario.md` | **Modificado**: sección 7.1 — al borrar lo escrito el catálogo elegido se desmarca y hay que volver a pulsar el botón de tipo; al seguir escribiendo con un catálogo ya elegido la búsqueda se repite automáticamente en ese mismo catálogo; las portadas que no se pueden cargar se sustituyen automáticamente por la imagen «Sin imagen» (regla 3 de AGENTS.md) |
| `docs/adr-056-buscador-catalogo-rebusqueda-y-fallback-portadas.md` | **Nuevo**: este documento |

Related issue: #149 — https://github.com/gonzalitojh/Registro-personal/issues/149
