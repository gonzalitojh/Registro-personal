# ADR-006: Colecciones y sagas de películas desde TMDB

## Estado
Aceptado

## Contexto
TMDB proporciona en sus respuestas de detalle de película el campo `belongs_to_collection`, que indica si una película pertenece a una colección o saga (Marvel, Harry Potter, El Señor de los Anillos, Indiana Jones, etc.). Este campo incluye el identificador de la colección, su nombre y una URL de póster.

Además, TMDB dispone de un endpoint específico `GET /3/collection/{collection_id}` que devuelve todas las películas que componen una colección, ordenadas cronológicamente.

Hasta ahora, la aplicación obtenía detalles de TMDB al añadir una película (duración, sinopsis, género, reparto, director) pero ignoraba por completo el campo `belongs_to_collection`. Como resultado, el usuario no tenía forma de saber si una película pertenecía a una saga más grande ni podía añadir fácilmente el resto de películas de esa saga.

## Decisión
Implementar la funcionalidad completa de colecciones/sagas de TMDB, que incluye:

1. Capturar los datos de colección al obtener detalles de una película.
2. Mostrar un banner con el nombre de la saga en el modal de detalle.
3. Ofrecer un botón "Añadir resto de la saga" que consulta el endpoint de colecciones.
4. Presentar un selector con checkboxes para que el usuario elija qué películas añadir.

### Obtención de datos
El campo `belongs_to_collection` ya viene incluido en la respuesta de `GET /movie/{id}` de TMDB. Se extraen tres campos:

```javascript
collectionId: data.belongs_to_collection ? String(data.belongs_to_collection.id) : null,
collectionName: data.belongs_to_collection ? data.belongs_to_collection.name : null,
collectionPoster: data.belongs_to_collection?.poster_path
  ? "https://image.tmdb.org/t/p/w92..." : null,
```

Para obtener las películas de una colección se usa el endpoint:

```javascript
GET /3/collection/{collectionId}?language=es-ES
```

Que devuelve un array `parts` con todas las películas de la saga.

### Flujo de datos
```
TMDB /movie/{id} → getMovieDetails()
  └─ Añade collectionId, collectionName, collectionPoster al draft
  └─ Se guardan en Firestore (users/{uid}/movies/{id})

Modal de detalle → openMovieModal()
  └─ Si collectionId existe → muestra saga-banner con botón
  └─ Botón → openSagaSelector()
       ├─ getCollectionDetails(collectionId) → array parts
       ├─ Filtra contra existingIds (ctx.getItemsByGroup("movies"))
       ├─ openSagaSelectionModal() con checkboxes
       └─ Por cada seleccionada → addSagaMovie() → getMovieDetails() + addItem()
```

### Visualización

#### Banner de saga en modal de película
Se inserta un banner entre la información ampliada de TMDB (`extraInfoHtml`) y la sección de visionados. El banner muestra:
- **Texto**: "Saga: [nombre de la colección]"
- **Botón**: "Añadir resto de la saga" con estilo `btn--accent-media` (verde petróleo)

Si la película no pertenece a ninguna colección (`collectionId` es `null`), no se renderiza nada.

#### Modal selector de saga
Cuando el usuario pulsa "Añadir resto de la saga":
1. Se cierra el modal de detalle.
2. Se abre un nuevo modal con:
   - Título con el nombre de la saga.
   - Lista de películas no registradas, cada una con:
     - Checkbox (marcado por defecto).
     - Miniatura de portada (36x54px).
     - Título y año.
   - Contador dinámico de películas seleccionadas.
   - Botones "Cancelar" y "Añadir seleccionadas".

### Lógica de filtrado
Al abrir el selector, se comparan los `externalId` de las películas de la colección contra los `externalId` de todas las películas del usuario (`ctx.getItemsByGroup("movies")`). Solo se muestran las que el usuario no tiene registradas.

Casos cubiertos:
- **Todas añadidas**: toast "Ya tienes todas las películas de esta saga."
- **Ninguna seleccionada**: toast "Selecciona al menos una película."
- **Error de red**: toast con mensaje de error. El botón sigue disponible para reintentar.

### Implementación técnica

- **`js/api-movies.js`**:
  - `getMovieDetails()`: Se añadieron `collectionId`, `collectionName`, `collectionPoster` al objeto de retorno.
  - Nueva función `getCollectionDetails(collectionId)`: llama a `/collection/{id}` y devuelve `{ id, name, posterPath, parts }` con las películas mapeadas.

- **`js/ui.js`**:
  - `openMovieModal()`: Se añadió el parámetro `onAddSaga` a los callbacks. Se inserta un bloque condicional `saga-banner` cuando `item.collectionId` existe. Se añadió event listener para `#btn-add-saga`.
  - Nueva función `openSagaSelectionModal(collectionName, movies, { onConfirm, onCancel })`: renderiza un modal con lista de checkboxes, contador de selección y botones de acción.

- **`js/modal-handlers.js`**:
  - Se importaron `getCollectionDetails`, `getMovieDetails` de `api-movies.js` y `addItem` de `db.js`.
  - `openMovieItem()`: Se añadió `onAddSaga` a los callbacks pasados a `ui.openMovieModal()`, conectado a la nueva función `openSagaSelector`.
  - Nueva función `addSagaMovie(movie, ctx)`: obtiene detalles TMDB de la película y la añade a Firestore.
  - Nueva función `openSagaSelector(item, ctx)`: orquesta todo el flujo (consulta colección, filtra, abre selector, procesa confirmación).

- **`ocio/ocio.css`**: Se añadieron clases CSS:
  - `.saga-banner`, `.saga-banner__label` — para el banner en el modal de detalle.
  - `.saga-subtitle`, `.saga-list`, `.saga-row`, `.saga-row__cover`, `.saga-row__title`, `.saga-row__year`, `.saga-count` — para el modal selector.

### Alternativas descartadas
- **Selector sin checkboxes (añadir todo directamente)**: Se descartó porque el usuario puede no querer añadir ciertas películas (ej. spin-offs no canónicos). Los checkboxes dan control granular.
- **Mostrar la saga en los resultados de búsqueda**: Se descartó porque los resultados de búsqueda no incluyen `belongs_to_collection` (usan el endpoint `/search/movie`, no `/movie/{id}`). Solo se muestra en el modal de detalle.
- **Persistir la lista de películas de la colección**: Se descartó porque la información se consulta siempre en vivo desde TMDB, garantizando que refleje cambios (nuevas películas añadidas a la saga).

## Consecuencias

### Positivas
- El usuario descubre fácilmente a qué saga pertenece una película y puede añadir el resto con unos pocos clics.
- La funcionalidad es no intrusiva: solo aparece cuando la película tiene `collectionId`.
- El filtro contra la biblioteca existente evita duplicados.
- Las películas añadidas desde la saga reciben todos los detalles de TMDB (duración, reparto, sinopsis, etc.) igual que si se hubieran añadido desde la búsqueda.

### Negativas
- Las películas añadidas manualmente (sin `externalId` de TMDB) nunca tendrán datos de colección.
- Al añadir sagas grandes (ej. Marvel: ~30 películas), las peticiones a TMDB se hacen secuencialmente, lo que puede ser lento. Se manejan errores individuales para no bloquear todo el lote.
- La información de colección es estática desde el momento en que se añade la película. Si TMDB cambia la colección (nombre, películas incluidas), no se reflejará hasta que se vuelva a obtener la película.

### Neutras
- Los campos `collectionId`, `collectionName`, `collectionPoster` se almacenan en Firestore como parte del documento de la película.
- No se requiere ninguna suscripción o callback adicional en tiempo real.
- La funcionalidad solo aplica a películas; series y libros no se ven afectados.

## Archivos modificados
- `js/api-movies.js` — Añadidos `collectionId`, `collectionName`, `collectionPoster` a `getMovieDetails()`; nueva función `getCollectionDetails(collectionId)`.
- `js/ui.js` — Modificada `openMovieModal()` con saga-banner y callback `onAddSaga`; nueva función `openSagaSelectionModal()`.
- `js/modal-handlers.js` — Modificada `openMovieItem()` con `onAddSaga`; nuevas funciones `addSagaMovie()` y `openSagaSelector()`.
- `ocio/ocio.css` — Nuevas clases CSS para saga-banner, saga-list, saga-row y relacionados.