# ADR-010: Recomendaciones de contenido similar desde TMDB

## Estado
Aceptado

## Contexto
La aplicación permite al usuario registrar películas, series y libros, y
ver detalles de cada título (sinopsis, reparto, puntuación, plataformas de
streaming, etc.). Sin embargo, una vez que el usuario explora la ficha de
un título, no tenía forma de descubrir contenido relacionado sin volver a
la búsqueda.

TMDB proporciona endpoints de contenido similar (`/movie/{id}/similar` y
`/tv/{id}/similar`) que devuelven una lista de títulos relacionados según
el algoritmo de recomendaciones de TMDB. Estos datos ya están disponibles
sin coste adicional en el plan gratuito de TMDB.

Se necesitaba una sección de recomendaciones en la ficha de detalle que
permitiera al usuario descubrir contenido similar y añadirlo directamente
a su registro personal.

## Decisión
Implementar una sección de recomendaciones en los modales de detalle de
películas y series, usando los endpoints `/similar` de TMDB. La sección
se titula "Si te gustó esto, quizá te guste..." y muestra una lista
horizontal desplazable con carátula, título y año de cada recomendación,
junto con un botón "Añadir" para incorporarla directamente al registro.

### Obtención de datos
Se añadieron dos nuevas funciones exportadas en `api-movies.js`:

```
getSimilarMovies(id) → GET /movie/{id}/similar?language=es-ES&page=1
getSimilarTv(id)    → GET /tv/{id}/similar?language=es-ES&page=1
```

Ambas funciones:
- Reutilizan los mapeadores existentes `mapMovieResult` / `mapTvResult`,
  por lo que devuelven objetos con la misma forma que los resultados de
  búsqueda: `{ externalId, type, title, year, coverUrl, overview }`.
- Devuelven siempre un array (vacío si hay error), nunca lanzan
  excepciones, por lo que no bloquean la apertura del modal.
- Se limitan a la primera página (hasta 20 resultados), de los cuales
  se toman los primeros 10.

### Flujo de datos
```
TMDB /similar → api-movies.js (getSimilarMovies / getSimilarTv)
  → modal-handlers.js (openMovieItem / openTvItem)
    → Filtra items ya registrados (existingIds)
    → slice(0, 10) para limitar cantidad
    → ui.js (openMovieModal / openTvModal)
      → renderRecommendations() genera HTML
      → Botón "Añadir" → addFromRecommendation()
        → getMovieDetails / getTvExtraDetails (opcional)
        → addItem() a Firestore
```

### Visualización
Las recomendaciones se muestran como una sección horizontal desplazable
dentro del modal de detalle:

- **Películas**: después del banner de saga (si existe) y antes de la
  sección de visionados.
- **Series**: después de la información ampliada de TMDB y antes del
  banner de progreso.

Cada tarjeta de recomendación (`rec-card`) contiene:
- Carátula (con placeholder si no hay imagen).
- Título (truncado a 2 líneas con `-webkit-line-clamp`).
- Año (monospace, color secundario).
- Botón "Añadir" (o "Añadido" deshabilitado si ya está registrado).

Las tarjetas miden 110px de ancho, con scroll horizontal nativo
personalizado (scrollbar sutil). En hover (escritorio) las tarjetas
elevan su sombra.

### Comportamiento del botón "Añadir"
Al hacer clic en "Añadir":
1. El botón se deshabilita y muestra "Añadiendo…"
2. Se construye un objeto `draft` con los datos básicos del título
3. Se intentan obtener los detalles ampliados de TMDB
   (`getMovieDetails` / `getTvExtraDetails`) para enriquecer la ficha
   (sinopsis, reparto, duración, etc.). Si falla, se añade igualmente
   con los datos básicos.
4. Se persiste en Firestore mediante `addItem()`
5. El botón muestra "Añadido" permanentemente (no se re-renderiza el
   modal, pero en la próxima apertura aparecerá como "Añadido" gracias
   al filtro por `existingIds`).

### Items ya registrados
Antes de abrir el modal, se calcula un `Set` de `externalId` de todos
los items del mismo tipo que ya tiene el usuario. Las tarjetas cuyos
`externalId` están en ese conjunto muestran el botón "Añadido"
deshabilitado.

### Casos borde
- **Sin conexión o error de TMDB**: La sección simplemente no se muestra
  (no hay errores visibles).
- **Sin recomendaciones**: TMDB puede devolver array vacío para títulos
  muy nicho. La sección no se renderiza.
- **Items manuales**: No tienen `externalId`, por lo que nunca aparecen
  en recomendaciones (no hay correspondencia en TMDB). Es correcto.
- **Modo solo lectura (amigos)**: No se muestran recomendaciones. Las
  funciones de apertura de modal de solo lectura no reciben estos datos.

## Consecuencias

### Positivas
- El usuario descubre contenido relacionado sin salir de la ficha.
- La incorporación es inmediata: un clic añade la recomendación al
  registro con todos los metadatos de TMDB.
- El filtrado de items ya registrados evita duplicados.
- La sección es no intrusiva: si no hay datos, no ocupa espacio.
- Todas las llamadas a TMDB son fallibles sin bloquear la interfaz.

### Negativas
- Las recomendaciones son estáticas en el momento de abrir el modal.
  Si el usuario añade una recomendación, el resto de tarjetas no se
  actualizan (el botón de la añadida queda en "Añadido", pero otra
  recomendación que coincida con un item recién añadido no se
  deshabilitará hasta la próxima apertura del modal).
- Las recomendaciones no están disponibles en el modal de solo lectura
  (amigos), aunque técnicamente podrían mostrarse sin botón "Añadir".
- Dependencia del algoritmo de TMDB: no controlamos qué considera TMDB
  como "similar". Para algunos títulos las recomendaciones pueden no
  ser relevantes.

### Neutras
- No se añaden nuevas dependencias externas.
- No se modifican las reglas de Firestore ni el modelo de datos.
- Las funciones de API usan el mismo patrón de caching que las
  existentes (sin caché en esta implementación inicial, ya que las
  recomendaciones se piden una vez por apertura de modal).

## Archivos modificados
- `js/api-movies.js` — Nuevas funciones `getSimilarMovies()` y
  `getSimilarTv()`.
- `js/modal-handlers.js` — Nueva función `addFromRecommendation()`;
  modificadas `openMovieItem()` y `openTvItem()` para cargar y pasar
  recomendaciones.
- `js/ui.js` — Nueva función `renderRecommendations()`; modificadas
  `openMovieModal()` y `openTvModal()` para aceptar y renderizar
  recomendaciones.
- `ocio/ocio.css` — Nuevas clases CSS para la sección de
  recomendaciones: `.recommendations`, `.recommendations__title`,
  `.recommendations__scroll`, `.rec-card`, `.rec-card__cover`,
  `.rec-card__body`, `.rec-card__title`, `.rec-card__year`,
  `.rec-card__add`.
