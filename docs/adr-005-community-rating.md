# ADR-005: Puntuación de la comunidad (TMDB) junto a la puntuación personal

## Estado
Aceptado

## Contexto
La aplicación permite al usuario registrar películas, series y libros,
asignándoles una valoración personal de 1 a 5 estrellas. Sin embargo,
no existía ningún punto de referencia externo que ayudara al usuario a
contextualizar su propia puntuación o a descubrir contenido nuevo.

TMDB (The Movie Database) proporciona en sus respuestas de detalle el
campo `vote_average` (media de votos de la comunidad, escala 0-10) y
`vote_count` (número de votos). Estos datos ya se recuperaban al añadir
películas y series (en `getMovieDetails()` y `getTvExtraDetails()`),
pero no se exponían al usuario.

Se necesitaba mostrar esta puntuación comunitaria junto a la valoración
personal, de forma clara y visualmente diferenciada, para que el usuario
pudiera comparar su opinión con la media de la comunidad.

## Decisión
Implementar la visualización de la puntuación media de TMDB
(`vote_average`) como "nota de la comunidad" en la interfaz,
almacenándola en un nuevo campo `communityRating` en Firestore.

### Obtención de datos
El campo `communityRating` se extrae de las respuestas de TMDB usando
la siguiente lógica:

```
communityRating = vote_count > 0 ? vote_average : null
```

Esta comprobación evita tratar un `vote_average: 0` con `vote_count: 0`
como una valoración real. Solo cuando hay al menos un voto se considera
que la puntuación es significativa.

### Flujo de datos
```
TMDB API response → api-movies.js (communityRating)
  ├─ Al añadir item (search.js): Object.assign(draft, details) → Firestore
  └─ En comprobación diaria (daily-check.js): backfill para items existentes
      └─ ui.js: renderiza el campo communityRating del item
```

### Visualización

#### Tarjetas de cuadrícula
Ambas puntuaciones se muestran dentro de un contenedor común
`.item-card__ratings` al final de la tarjeta:

- **Estrellas personales**: Color `--ochre-spine-dark` (dorado/ámbar),
  formato `★★★`.
- **Nota comunidad**: Distintivo `TMDB` con fondo `--teal-reel` (verde
  petróleo) + valor numérico con un decimal (ej. `7.4`), usando la
  variable `--teal-reel-dark` para el número.

Cuando no hay puntuación de TMDB, no se muestra nada en la tarjeta
(para mantener la compacidad de la cuadrícula).

#### Modales de detalle
Se inserta una línea completa entre el sello de "próximo estreno"
(`upcomingBadge`) y la información ampliada de TMDB (`extraInfoHtml`):

- Si hay `communityRating`: distintivo `TMDB` + valor (ej. `7.4`).
- Si no hay datos: texto en cursiva `Sin puntuaciones` con color
  `--ink-soft`.

#### Modal de solo lectura (amigos)
Misma línea de puntuación comunitaria que en los modales de detalle.

### Backfill para datos existentes
El módulo `daily-check.js` se modificó para incluir `communityRating`
en su comprobación diaria. Cuando un item carece de este campo y la
API de TMDB devuelve un valor, se actualiza automáticamente en
Firestore. Esto funciona tanto para películas como para series.

### Implementación técnica

- **`js/api-movies.js`**: Se añadió `communityRating` al objeto
  devuelto por `getMovieDetails()` y `getTvExtraDetails()`.
- **`js/ui.js`**: Se añadieron dos funciones helper:
  - `communityRatingHtml(item)` — para tarjetas: devuelve HTML del
    distintivo o cadena vacía si no hay datos.
  - `communityRatingDisplay(item)` — para modales: devuelve HTML del
    distintivo o "Sin puntuaciones" si no hay datos.
  Se modificaron `renderGrid()`, `openMovieModal()`, `openTvModal()`
  y `openReadOnlyModal()`.
- **`js/daily-check.js`**: Se ampliaron las condiciones `needsCheck`
  y `needsBackfill` para incluir `communityRating == null`, y se
  añadió la asignación del campo cuando el dato fresco está disponible.
- **`ocio/ocio.css`**: Se añadieron clases `.item-card__ratings`,
  `.community-rating`, `.community-rating--empty` y
  `.modal-detail__ratings`. Se eliminó `margin-top: auto` de
  `.item-card__rating` (ahora lo aplica el contenedor padre).

### Alternativas descartadas

- **Mostrar siempre la línea en tarjetas**: Se optó por no mostrar
  "Sin puntuaciones" en la cuadrícula para evitar ruido visual.
  En los modales sí se muestra siempre.
- **Añadir el dato en el modal de búsqueda (resultados)**: Los
  resultados de búsqueda siguen el formato de `mapMovieResult` /
  `mapTvResult` que no incluyen `vote_average`. Se mantiene así para
  no añadir complejidad a la búsqueda.
- **Mostrar el número de votos (`vote_count`)**: Se consideró
  añadirlo pero se descartó por simplicidad; `vote_average` ya
  proporciona el contexto necesario.

## Consecuencias

### Positivas
- El usuario puede comparar su valoración personal con la media de la
  comunidad TMDB, enriqueciendo el contexto de sus propias puntuaciones.
- La información es clara y visualmente diferenciada (dorado para
  personal, verde petróleo para comunidad).
- Los items existentes reciben la puntuación comunitaria de forma
  progresiva mediante la comprobación diaria, sin necesidad de
  migraciones masivas.
- No hay cambios en el modelo de datos existente, solo un campo nuevo
  opcional (`communityRating`).

### Negativas
- Los items añadidos manualmente nunca tendrán `communityRating` (no
  tienen correspondencia en TMDB). La interfaz muestra "Sin
  puntuaciones" en estos casos, lo cual es correcto pero puede ser
  ligeramente confuso si el usuario espera ver datos.
- La puntuación de TMDB es estática desde el momento en que se añade
  el item o se actualiza en la comprobación diaria. Si la puntuación
  cambia significativamente en TMDB, no se reflejará hasta la próxima
  comprobación diaria (una vez al día).

### Neutras
- El campo se almacena como `number` en Firestore (ej. `7.4`), con
  valor `null` cuando no hay votos en TMDB o el item es manual.
- No se requiere ninguna nueva llamada API: los datos ya se obtenían
  en las funciones existentes de detalle de TMDB.

## Archivos modificados
- `js/api-movies.js` — Añadido `communityRating` a `getMovieDetails()`
  y `getTvExtraDetails()`.
- `js/ui.js` — Nuevas funciones `communityRatingHtml()` y
  `communityRatingDisplay()`; modificadas `renderGrid()`,
  `openMovieModal()`, `openTvModal()`, `openReadOnlyModal()`.
- `js/daily-check.js` — Backfill de `communityRating` en la
  comprobación diaria para películas y series.
- `ocio/ocio.css` — Nuevas clases CSS para distintivo de comunidad,
  contenedor de puntuaciones en tarjetas y modales.
