# ADR-114: Recomendaciones con el endpoint /recommendations de TMDB y exclusión de títulos ya registrados (issue #319)

## Estado

Aceptado

## Fecha

2026-08-20

## Contexto

La issue #319 reporta que la sección «Si te gustó esto, quizá te
guste...» de las fichas de películas y series hace recomendaciones
«un poco raras» que no se parecen a las que muestra la web de TMDB
para el mismo título, y pide explicar cómo funciona el sistema y
ajustarlo para que las recomendaciones sean mejores,
preferiblemente sin recomendar cosas ya vistas. La base de la PR es
`feat/issue-201` (instrucción explícita de la issue).

### Cómo funciona el sistema (diagnóstico)

1. **Fuente de datos**: desde ADR-010, las recomendaciones se
   obtienen con los endpoints `/movie/{id}/similar` y
   `/tv/{id}/similar` de TMDB (funciones `getSimilarMovies` /
   `getSimilarTv` en `js/api-movies.js`), con
   `language=es-ES&page=1`, mapeadas con `mapMovieResult` /
   `mapTvResult` y limitadas a 10 resultados.
2. **Diferencia clave de TMDB**: según la documentación oficial,
   `/similar` devuelve títulos «similar movies based on keywords and
   genres» y avisa explícitamente de que **no es el mismo sistema que
   las recomendaciones de su web** («This is not the same as the
   "Recommendation" system you see on the website»). La sección
   «Recommendations» que TMDB muestra en las fichas de su web se
   alimenta del endpoint `/movie/{id}/recommendations` (y
   `/tv/{id}/recommendations`). Por eso las recomendaciones de la
   web parecían «de otro sitio»: **se estaba consultando el endpoint
   equivocado**.
3. **Filtrado de ya registrados**: el diagrama del ADR-010 describía
   un «Filtra items ya registrados (existingIds)», pero en el código
   ese filtrado **no existía**: se cargaban hasta 10 recomendaciones
   y el Set `existingIds` solo servía para deshabilitar el botón
   (etiqueta «Añadido») de las tarjetas ya registradas, que **seguían
   apareciendo** en la sección. Además el `slice(0, 10)` se hacía
   **antes** de conocer `existingIds`, con lo que los huecos no se
   rellenaban con títulos nuevos.

Related issue: #319 — https://github.com/gonzalitojh/Registro-personal/issues/319

## Decisión

Cambiar la fuente de datos y el filtrado para que la sección
recomiende contenido relevante y no recomendado ya conocido:

### 1. Endpoint /recommendations en lugar de /similar

Se sustituye el endpoint por el que usa la propia web de TMDB:

```diff
- /movie/{id}/similar  →  /movie/{id}/recommendations
- /tv/{id}/similar     →  /tv/{id}/recommendations
```

Las funciones se renombran para que el nombre refleje la fuente de
verdad (`similar` habría quedado engañoso):

```diff
- getSimilarMovies(id) → getRecommendedMovies(id)
- getSimilarTv(id)     → getRecommendedTv(id)
```

Mismo comportamiento que antes: `language=es-ES&page=1`, mapeos
`mapMovieResult`/`mapTvResult`, nunca lanzan (array vacío ante
error), sin caché (una petición por apertura de ficha).

### 2. Filtrar títulos ya registrados antes del slice

En los dos llamadores (`js/modal-handlers.js` — `openMovieItem` y
`openTvItem` — y `js/item-page.js` — `loadPreviewExtras`) se
reordena la carga: primero se obtiene el Set `existingIds` (todos
los `externalId` del usuario en ese grupo), después se **filtra** la
lista de recomendaciones y **solo entonces** se aplica el
`slice(0, 10)`:

```js
recommendations = recommendations
  .filter(
    (r) =>
      !existingIds.has(String(r.externalId)) &&
      String(r.externalId) !== String(item.externalId)
  )
  .slice(0, 10);
```

El filtro excluye:
- **Títulos ya añadidos al registro** (`existingIds`), que en la
  práctica son también los ya vistos (ver nota en §Consecuencias):
  se cumple el «preferiblemente no recomiendes cosas ya vistas».
- **El propio ítem abierto** (exclusión defensiva; TMDB no suele
  devolverlo, pero si lo hiciera sería absurdo recomendarlo).

Al filtrar antes del `slice`, los huecos que dejan los títulos ya
registrados entre los 20 resultados de la página 1 se rellenan con
los siguientes no registrados, maximizando las 10 tarjetas.

`js/ui.js` **no cambia**: el Set `existingIds` compartido sigue
llegando al render, donde el botón «Añadido» deshabilitado queda
como red de seguridad para el alta en caliente de una recomendación
dentro de la misma sesión (issue #280): tras añadirla, un re-render
muestra la tarjeta como «Añadida».

## Alternativas descartadas

- **Mantener /similar y solo reordenar el filtro**: rechazada. El
  problema de fondo (recomendaciones irrelevantes) es la fuente de
  datos; conservarla no habría resuelto la issue.
- **Filtrar en `renderRecommendations` (ui.js)**: rechazada. El
  render no conoce el «ítem abierto» y el filtrado previo al slice
  permite rellenar huecos; además mantener ui.js intacto reduce el
  riesgo de regresión visual (cuatro modos de tema, tres anchos).
- **Dejar alias `getSimilar*` → `getRecommended*`**: rechazada. El
  nombre `similar` resultaría engañoso tras cambiar el endpoint; el
  árbol se toca entero en un único commit, sin estados intermedios
  rotos.

## Consecuencias

**Positivas:**

- Las recomendaciones son ahora **las mismas que muestra la web de
  TMDB** para cada título (mismo endpoint y algoritmo).
- **No se recomienda contenido ya registrado** (y por tanto ya
  visto): la sección solo descubre títulos nuevos.
- Corrección del registro documental: el ADR-010 describía un
  filtrado por `existingIds` que no existía en el código; ahora sí
  es real (nota añadida al ADR-010).

**Negativas / neutras:**

- Las listas pueden quedar **más cortas o vacías** en títulos nicho
  (tras filtrar los ya registrados de la página 1). Es la
  degradación elegante ya existente: sin recomendaciones, la sección
  no se renderiza.
- Un título en «pendiente» (añadido pero no visto) tampoco se
  recomienda, aunque no esté visto: la exclusión es por registro, no
  por estado de visionado. Es coherente con la petición («no
  recomiendes cosas ya vistas») y evita duplicados, aunque sea algo
  más estricto que el pedido literal.
- Coste de API idéntico (1 petición por apertura de ficha) y sin
  nuevas dependencias; los tiempos de carga no cambian.
- `getGroupItemsResolved` sigue siendo best-effort (issue #178): si
  la lectura de Firestore falla, no se filtra nada y el render
  deshabilita lo que pueda — degradación idéntica a la anterior.
- Versión PWA bumped a `20261013` (js/config.js, index.html,
  service-worker.js): un precache adicional para los usuarios al
  desplegar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: `getSimilarMovies`→`getRecommendedMovies` y `getSimilarTv`→`getRecommendedTv` con los endpoints `/recommendations` (movie/tv) en lugar de `/similar`; comentario de sección actualizado con la referencia a la doc oficial de TMDB |
| `js/modal-handlers.js` | **Modificado**: import actualizado; en `openMovieItem` (movie) y `openTvItem` (tv) se carga `existingIds` antes que la lista, se **filtran** los títulos ya registrados y el propio ítem abierto, y **después** se aplica `slice(0, 10)` |
| `js/item-page.js` | **Modificado**: import actualizado; `loadPreviewExtras` construye el Set `existingIds` y filtra las recomendaciones (mismo criterio, con `token.externalId`) antes del `slice(0, 10)` |
| `docs/manual-de-usuario.md` | **Modificado**: §12 — el bullet de «Recomendaciones» indica que las recomendaciones son las de la web de TMDB y que los títulos ya en el registro se excluyen automáticamente (ya no se muestra «Ya añadido» deshabilitado en la sección) |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261013` |
| `index.html` | **Modificado**: 3 referencias `?v=` a `20261013` |
| `service-worker.js` | **Modificado**: 7 referencias `?v=` de `STATIC_ASSETS` a `20261013` |
| `docs/adr-010-recommendations.md` | **Modificado**: nota al final apuntando al ADR-114 y corrigiendo el registro (el filtrado por existingIds del diagrama era aspiracional hasta #319) |
| `docs/adr-114-recomendaciones-recommendations-tmdb.md` | **Nuevo**: este documento |
| `tasks/task-issue-319.json` | Task file de la tarea |

Related issue: #319 — https://github.com/gonzalitojh/Registro-personal/issues/319