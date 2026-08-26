# ADR-117: Búsqueda global en Ocio y por actores (issue #328)

## Estado

Aceptado

## Fecha

2026-08-26

## Contexto

La issue #328 pide dos mejoras sobre la barra de búsqueda global (`js/global-search.js`, `index.html` + `js/ui.js`):

1. **Búsqueda global dentro de Ocio**: «debo poder buscar en todo momento en todas mis colecciones, no únicamente en la que me encuentro. Si estoy en series y busco "El señor de los anillos" me deberían salir tanto las series, películas, libros y juegos de mi colección que coincidan». Desde la issue #206 la búsqueda se acota a la **sección** activa (Ocio → colección, Perfil → amigos, Recetas → recetas). Dentro de Ocio ya se hacía `collectionResults` sobre `allItems.movies/tv/books/games` sin filtrar por la pestaña activa (`parseHash().section` es `ocio` para `#{/ocio/series}` y el resto) y sin usar `activeGroup`. La issue pide blindarlo y documentarlo: eliminar cualquier atajo que en el futuro volviera a acotar por pestaña.
2. **Buscar por actores**: «en la barra de búsqueda se deben poder buscar actores». Hasta ahora `getSearchableText` era `title + author` y `relevanceScore` solo ponderaba título/autor. El reparto (`cast`), director y creadores vienen de TMDB (`getMovieDetails` / `getTvExtraDetails`) pero con el almacenamiento mínimo A2 (issue #200) esos tres campos estaban en `ON_DEMAND_DETAIL_FIELDS` y `minimalStoredFields` no los guardaba — por tanto la búsqueda nunca podía encontrar nada por actor, porque los documentos de Firestore no tenían esa información y la carga bajo demanda (`loadItemDetails` + `loadDetailsForModal`) solo revalidaba `coverUrl`/`communityRating`.

Diagnóstico y alternativas:

- **Global en Ocio sin tocar perfil/recetas**: alternativa A — hacer `collectionResults` totalmente global entre secciones (Ocio + amigos + recetas mezclados) se descartó: rompería la separación intencionada de #206 (un usuario en Recetas no espera ver películas). Alternativa B — mantener el scope por sección, pero dentro de Ocio siempre las 4 colecciones, sin distinción de pestaña. Se elige B: respeta #206 y cumple el ejemplo de la issue.
- **Persistir reparto para buscar**: tres opciones. (a) Mantener `cast` on-demand y hacer la búsqueda consultando la API por título+actor bajo demanda — muy costoso (N peticiones) y frágil sin red. (b) Cargar `cast` en el cliente al abrir cada ficha y mantenerlo solo en memoria — el buscador solo encontraría lo ya abierto en esa sesión. (c) Añadir `cast`/`director`/`creators` al almacenamiento mínimo: son 5–8 cadenas cortas por ítem, payload despreciable frente a `overview`/`genres` y estables en el tiempo, y el estudio A2 permitía excepciones para datos pequeños buscables (como `description` en libros). Se elige (c) con `slice(0,5)` / `slice(0,3)` para no crecer el documento.
- **Dónde guardar**: `minimalStoredFields` ya es el punto único de construcción del draft al alta (normal, vista/leída y saga/recomendación) y es lo que comparten `search.js` y `modal-handlers.js` (`addSagaMovie`). Añadir allí `cast`/`director`/`creators` cubre todas las vías sin duplicar. Para fichas antiguas sin esos campos, `loadDetailsForModal` pasa a revalidar `cast`/`director`/`creators` (mismo patrón que `coverUrl`/`communityRating`).

## Decisión

1. **Búsqueda global en Ocio (issue #328)**: `js/global-search.js` documenta que `collectionResults` es global dentro de Ocio y nunca se acota por la pestaña activa. No cambia el algoritmo (ya era global), solo se blinda el comentario y el test manual de la issue.
2. **Texto buscable y scoring por actores**: `getSearchableText(item)` pasa a `title + author + cast.join(" ") + director + creators.join(" ")` (todo en minúsculas). `relevanceScore` mantiene `title` 100/50/10 y añade `author` 5, `cast` 5, `director` 4, `creators` 4, de modo que una coincidencia por título sigue por encima de una por actor.
3. **Almacenamiento mínimo**: `js/constants.js` saca `cast`/`director`/`creators` de `ON_DEMAND_DETAIL_FIELDS`. `js/search.js` incluye en `minimalStoredFields` para `movie` (`cast` 5, `director`) y para `tv` (`cast` 5, `creators` 3, `director` si lo hubiera). Los borradores de alta (normal, `handleAddSeen` y `addSagaMovie`) heredan esos campos sin cambiar firmas.
4. **Revalidación progresiva**: `js/modal-handlers.js:loadDetailsForModal` guarda `prevCast/prevDirector/prevCreators` y, al llegar `details`, persiste `cast`/`director`/`creators` si cambiaron (igual que `coverUrl`/`communityRating`). Así las colecciones antiguas ganan el dato de reparto la primera vez que se abre su ficha (best-effort, sin reintentos).
5. **UI**: `js/ui.js` y `index.html` cambian el placeholder de Ocio a `Buscar películas, series, libros, videojuegos y actores…` y el `aria-label` a `Buscar en tu registro de ocio (título, autor o actor)`. `js/global-search.js:sectionHintText` añade «y actores» al hint de Ocio.
6. **Manual**: `docs/manual-de-usuario.md` §§3 y 10.2 documentan que la búsqueda en Ocio es global entre las 4 colecciones y que también busca por reparto/director/creadores (ejemplo `Tom Hanks`).
7. **Versión PWA**: `APP_VERSION` sube a `20261019` + `?v=20261019` en `index.html` y `service-worker.js` (misma disciplina que ADR-116). Iteración 2026-08-26 corrige el `ReferenceError: itemApi is not defined` moviendo `itemApi`/`personApi`/`profileApi`/`recipesApi`/`gymApi` a nivel de módulo en `js/app.js` (antes solo estaban dentro de `init()` y `subscribeGroup.onChange` fallaba).

## Consecuencias

- Buscar «El señor de los anillos» desde cualquier pestaña de Ocio muestra a la vez películas, series, libros y juegos coincidentes (5 por grupo, ordenados por relevancia y alfabético).
- Buscar «Tom Hanks», «Bryan Cranston» o «Vince Gilligan» encuentra las películas/series donde participan, incluso con coincidencias parciales e insensibles a mayúsculas.
- Los nuevos títulos guardan `cast`/`director`/`creators`; los antiguos los obtienen al abrir la ficha una vez (revalidación bajo demanda). No se requiere migración masiva.
- Sin regresiones de responsividad ni de contraste en los 4 temas: los cambios tocan solo lógica de filtrado y textos de placeholder/hint.
- La PWA invalida cachés anteriores al subir la versión (20261019 tras el fix de `itemApi`).

Related issue: #328
