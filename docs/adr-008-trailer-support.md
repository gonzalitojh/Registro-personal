# ADR-008: Añadir soporte de tráilers desde TMDB

## Estado
Implementado

## Contexto
La aplicación obtiene de TMDB datos ampliados de películas y series (duración, sinopsis, reparto, director, colecciones, etc.) y los muestra en los modales de detalle. Sin embargo, no se ofrecía al usuario ninguna forma de ver el tráiler oficial desde la aplicación.

TMDB proporciona un endpoint `/movie/{id}/videos` y `/tv/{id}/videos` que devuelven los vídeos asociados a un título (tráilers, teasers, making-of, etc.), incluyendo enlaces a YouTube. Este dato ya está disponible sin coste adicional de API si se solicita junto con los créditos mediante el parámetro `append_to_response`.

Se necesitaba incorporar esta información para:
- Permitir al usuario acceder al tráiler oficial desde el modal de detalle de cualquier película o serie.
- Que los tráilers estuvieran disponibles tanto para títulos nuevos (al añadirlos) como para los existentes (mediante el mecanismo de actualización diaria).
- Mantener la coherencia con el patrón existente de obtención de datos «una sola vez» en el momento de añadir el título.

## Decisión
Implementar la funcionalidad completa de tráilers desde TMDB, que incluye:

1. Añadir `videos` al parámetro `append_to_response` en las llamadas de detalle.
2. Extraer la mejor URL de tráiler de YouTube desde la respuesta.
3. Renderizar un botón rojo estilo YouTube en los modales de detalle.
4. Backfill de `trailerUrl` para películas y series existentes a través de `daily-check.js`.

### Obtención de datos
El endpoint `/movie/{id}` y `/tv/{id}` ya incluyen el parámetro `append_to_response=credits`. Se añade `videos` a este parámetro para recibir también los vídeos asociados en la misma petición:

```javascript
// Antes
const url = `${BASE_URL}/movie/${id}?api_key=...&language=es-ES&append_to_response=credits`;

// Después
const url = `${BASE_URL}/movie/${id}?api_key=...&language=es-ES&append_to_response=credits,videos`;
```

### Extracción del tráiler
Se creó la función interna `_extractTrailerUrl(videos)` en `api-movies.js` con la siguiente lógica:

1. Si no hay resultados de vídeo, devuelve `null`.
2. Filtra solo vídeos de YouTube (`site === "YouTube"`) que sean «Trailer» o «Teaser».
3. Prioriza «Trailer» sobre «Teaser» (usa el primer «Trailer» si existe; si no, el primer «Teaser»).
4. Construye la URL: `https://www.youtube.com/watch?v={key}`.

Esta función se usa tanto en `getMovieDetails()` como en `getTvExtraDetails()`.

### Visualización
Se añadió la función `trailerButtonHtml(item)` en `ui.js` que genera un enlace `<a>` con:
- Clase `.trailer-btn` con apariencia de botón rojo de YouTube.
- Atributo `target="_blank"` y `rel="noopener noreferrer"`.
- Icono de reproducción (▶) y texto «Tráiler».
- `aria-label` para accesibilidad.

El botón se inserta en tres modales en la misma posición: justo después de la puntuación comunitaria y antes de la información ampliada (`extraInfoHtml`):

- `openMovieModal()` — modal de detalle de película.
- `openTvModal()` — modal de detalle de serie.
- `openReadOnlyModal()` — modal de solo lectura (amigos).

### Backfill para elementos existentes
El sistema de comprobación diaria (`checkForUpdates` en `daily-check.js`) ya rellena metadatos faltantes para películas y series existentes. Se añadió la lógica para backfill de `trailerUrl`:

- **Películas**: si `movie.trailerUrl` no existe y `fresh.trailerUrl` sí, se actualiza.
- **Series**: misma lógica, dentro del bloque `needsBackfill`.

### Estilos CSS
Se añadieron las clases `.trailer-btn`, `.trailer-btn__icon` y `.trailer-btn__label` en `ocio/ocio.css` con:
- Color de fondo rojo (`#ff0000`) típico de YouTube, con hover más oscuro (`#cc0000`).
- `inline-flex` para alinear icono y texto.
- Bordes redondeados y tipografía coherente con el sistema de diseño.

### Importación de dependencias
En `app.js` se corrigió la importación: faltaban `getMovieDetails` y `getTvExtraDetails` en el `import` de `api-movies.js` (solo se importaban `getTvSeasonsMeta` y `getSeasonEpisodes`), y ambas funciones se añadieron al objeto `ctx` para que estén disponibles en `daily-check.js`.

### Flujo de datos
```
TMDB /movie/{id}?append_to_response=credits,videos → getMovieDetails()
  └─ _extractTrailerUrl(data.videos) → trailerUrl
  └─ Se guarda en Firestore (users/{uid}/movies/{id})

TMDB /tv/{id}?append_to_response=credits,videos → getTvExtraDetails()
  └─ _extractTrailerUrl(data.videos) → trailerUrl
  └─ Se guarda en Firestore (users/{uid}/tv/{id})

Modal de detalle → openMovieModal() / openTvModal() / openReadOnlyModal()
  └─ Si item.trailerUrl existe → muestra .trailer-btn

Daily check → checkForUpdates()
  └─ Por cada película/serie sin trailerUrl → getMovieDetails() / getTvExtraDetails()
     └─ Si fresh.trailerUrl existe → updateItem() con trailerUrl
```

### Alternativas descartadas

- **Llamada separada al endpoint /videos**: Se descartó porque TMDB permite incluir `videos` en `append_to_response` sin coste adicional de petición. Hacer una llamada separada doblaría el número de peticiones a TMDB al añadir un título, aumentando la latencia y el riesgo de rate-limiting.

- **Reproducir el vídeo embebido en un modal (iframe)**: Se descartó porque:
  - Requeriría cargar el reproductor de YouTube (iframe + JS), aumentando el peso de la página.
  - YouTube puede mostrar anuncios antes del vídeo, lo que sería disruptivo.
  - El reproductor embebido tiene limitaciones en móviles (reproducción automática, pantalla completa).
  - Abrir en una nueva pestaña (`target="_blank"`) da al usuario la experiencia completa de YouTube (calidad, subtítulos, lista de reproducción, etc.).

- **Carga diferida (lazy) del tráiler solo al abrir el modal**: Se descartó porque `trailerUrl` ya se obtiene en el momento de añadir el título (junto con el resto de metadatos) y se almacena en Firestore. No hay beneficio en diferir la consulta. Para elementos existentes, el backfill diario ya cubre la actualización.

- **Mostrar el tráiler en las tarjetas de la biblioteca**: Se descartó porque el espacio en las tarjetas es limitado y el tráiler es un complemento informativo, no un dato crítico de identificación.

- **Soporte para Vimeo u otras plataformas**: Se descartó porque la abrumadora mayoría de los tráilers oficiales en TMDB están alojados en YouTube. Filtrar solo por `site === "YouTube"` simplifica el código y cubre el 99% de los casos.

- **Múltiples tráilers (selector)**: Se descartó porque el tráiler oficial («Trailer») es el que busca el usuario en la mayoría de los casos. Si no hay «Trailer», se usa el «Teaser». Un selector de múltiples vídeos añadiría complejidad innecesaria a la UI.

## Consecuencias

### Positivas
- Los usuarios pueden acceder al tráiler oficial desde el modal de detalle con un solo clic.
- No se incrementa el número de peticiones a TMDB: `videos` se incluye en la misma llamada que `credits`.
- El botón de tráiler solo aparece cuando hay URL disponible, sin ocupar espacio innecesario.
- El backfill progresivo garantiza que los títulos existentes también tengan tráiler con el tiempo.
- Funciona igual para películas y series.
- El enlace se abre en nueva pestaña, preservando el estado de la aplicación.

### Negativas
- Los títulos añadidos manualmente (sin `externalId` de TMDB) nunca tendrán tráiler.
- Si TMDB no tiene vídeos asociados (títulos muy antiguos, desconocidos o sin cobertura mediática), el botón no se muestra.
- El backfill solo ocurre una vez al día y solo si el título necesita otras actualizaciones (según la lógica de `needsCheck`/`needsBackfill`). Un título que ya tenga todos los metadatos excepto `trailerUrl` no se actualizará hasta que otra condición (ej. `communityRating`) también requiera revisión.

### Neutras
- El campo `trailerUrl` se almacena en Firestore como parte del documento de la película/serie.
- No se requiere ninguna suscripción adicional ni cambio en las reglas de seguridad de Firestore.
- La extracción del tráiler es determinista: siempre se elige el mismo vídeo para un mismo conjunto de datos de TMDB.
- La funcionalidad solo aplica a películas y series; libros no se ven afectados.

## Archivos modificados
- `js/api-movies.js` — Nueva función `_extractTrailerUrl()`; modificadas `getMovieDetails()` y `getTvExtraDetails()` para incluir `videos` en `append_to_response` y devolver `trailerUrl`.
- `js/ui.js` — Nueva función `trailerButtonHtml()`; integrada en `openMovieModal()`, `openTvModal()` y `openReadOnlyModal()`.
- `ocio/ocio.css` — Nuevas clases CSS `.trailer-btn`, `.trailer-btn__icon`, `.trailer-btn__label`.
- `js/daily-check.js` — Backfill de `trailerUrl` para películas (bucle de movies) y series (bloque `needsBackfill`).
- `js/app.js` — Corregida la importación de `getMovieDetails` y `getTvExtraDetails` desde `api-movies.js`; añadidas ambas al objeto `ctx`.
