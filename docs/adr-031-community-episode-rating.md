# ADR-031: Puntuación de la comunidad por episodios — badge compacto TMDB en la lista de temporadas del modal de detalle de serie (issue #45)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La issue #45 pide que, en las series, se muestre la puntuación de la comunidad para **cada episodio**. Antes de esta decisión, la nota de comunidad TMDB se mostraba en las tarjetas de ítems (ADR-005, campo persistido `communityRating`), en el modal de detalle (ADR-005) y en la ventana de valoración por episodio (ADR-022, `communityLabel` "TMDB · episodio"), pero la **lista de episodios de cada temporada** dentro del modal de detalle de serie (`renderEpisodeRows` en `js/ui.js`) no exponía ningún dato comunitario por episodio: solo número, nombre, fecha y estado de visionado.

El dato ya existía en la capa de API: `getSeasonEpisodes()` en `js/api-movies.js` devolvía `episodeRating` (`e.vote_count > 0 ? e.vote_average : null` — misma política truthy-only que ADR-005 y ADR-022, para no tratar un `0` sin votos como valoración real), pero no se usaba en el render. Los episodios **no se persisten en Firestore**: se sirven desde TMDB con la caché en memoria compartida de 24 h de `getSeasonEpisodes`, de modo que exponer el dato no requería tocar la capa de datos ni añadir persistencia.

El distintivo comunitario ya tenía un lenguaje visual consolidado (`.community-rating` con label `__label` y valor `__value` en `ocio/ocio.css`), pero su tamaño base estaba pensado para tarjetas, no para filas de episodio densas: se necesitaba una **variante compacta** sin duplicar el HTML del badge.

Related issue: #45 — https://github.com/gonzalitojh/Registro-personal/issues/45

## Decisión

Mostrar un **badge compacto `.community-rating--sm`** con la nota de la comunidad TMDB (`x.x`, un decimal) junto al nombre de cada episodio en la lista de temporadas del modal de detalle de serie, reutilizando el lenguaje visual del distintivo comunitario existente (ADR-005) y la semántica de datos ya definida en ADR-005/ADR-022. La decisión se organiza en cuatro capas: helper de render reutilizable, inserción en `renderEpisodeRows`, variante CSS compacta y fuente del dato sin cambios.

### 1. Nuevo helper `communityRatingValueHtml(value, label = "TMDB")` (`js/ui.js`)

Genera el HTML del badge compacto:

```html
<span class="community-rating community-rating--sm">
  <span class="community-rating__label">TMDB</span>
  <span class="community-rating__value">7.8</span>
</span>
```

- El valor se formatea con `Number(value).toFixed(1)` (un decimal, como el distintivo base).
- El parámetro `label` permite etiquetas distintas de "TMDB" sin duplicar HTML.

**`communityRatingHtml(item)` se refactoriza para delegar en él**: llama a `communityRatingValueHtml(item.communityRating)` y reemplaza `"community-rating community-rating--sm"` → `"community-rating"`. El HTML resultante para las tarjetas es **idéntico al anterior** (solo cambia la clase base, sin `--sm`), y el guard existente se conserva: devuelve cadena vacía si `item.communityRating == null`, para no ocupar espacio en la cuadrícula.

### 2. Inserción en `renderEpisodeRows` (`js/ui.js`)

```js
const communityBadge =
  !manual && e.episodeRating != null
    ? communityRatingValueHtml(e.episodeRating)
    : "";
```

El badge se inserta **tras el nombre del episodio** (después de `.episode-row__name`, incluyendo el `em` de "sin estrenar" cuando aplica). Se muestra **solo** cuando:

- La serie **no es manual** (`!manual`): las series manuales no tienen datos reales de TMDB (misma exclusión histórica que ADR-020/ADR-023/ADR-024).
- El episodio **tiene votos** (`e.episodeRating != null`): `vote_count === 0` ⇒ `episodeRating === null` ⇒ sin badge (semántica truthy-only de ADR-005).

### 3. Variante CSS compacta (`ocio/ocio.css`)

`.community-rating--sm` reutiliza los tokens del distintivo base `.community-rating` (label con `--teal-reel`/`--paper`, valor con `--teal-reel-dark`, fuentes mono) y solo ajusta tamaños:

- `.community-rating--sm`: `gap: 0.25rem`, `flex-shrink: 0`, `font-size: 0.68rem`, `line-height: 1.2`.
- `.community-rating--sm .community-rating__label`: `font-size: 0.5rem`, `padding: 0.05rem 0.25rem`.
- `.community-rating--sm .community-rating__value`: `font-size: 0.7rem`.

Todas las medidas en `rem` (unidades relativas, criterio de responsividad de AGENTS.md / ADR-026) y `flex-shrink: 0` para que el badge nunca se comprima ni desborde la fila en móvil: sin scroll horizontal en ningún ancho.

### 4. Fuente del dato: sin cambios en la capa de datos

`getSeasonEpisodes()` (`js/api-movies.js`) ya devolvía `episodeRating: e.vote_count > 0 ? e.vote_average : null` por episodio — esta decisión **solo lo expone en la UI**. Los episodios siguen sin persistirse en Firestore: se sirven desde TMDB con la caché en memoria de 24 h (misma caché compartida `season_<tvId>_<seasonNumber>` que los watch providers, ver ADR-022). No hay llamadas adicionales a la API ni cambios de contrato.

## Alternativas descartadas

- **Mostrar el badge base `.community-rating` sin variante compacta**: descartado — el label de 0.55rem y el padding base están pensados para tarjetas; en filas de episodio densas (checkbox + `E<n>` + nombre + fecha + estrellas) el badge completo desbordaría la fila en móvil, violando el criterio de responsividad.
- **Reutilizar `communityRatingHtml` directamente con los episodios**: descartado — está acoplado al campo `item.communityRating` y fija la clase base sin `--sm`; el helper nuevo con parámetro `label` y variante `--sm` cubre ambos casos sin duplicar HTML ni cambiar la salida de las tarjetas.
- **Persistir `episodeRating` en Firestore** (p. ej. junto a `nextEpisodeAirDate`): descartado — el dato es "en vivo" de TMDB y los episodios ya se cachean en memoria 24 h; persistirlo añadiría lecturas/escrituras por episodio sin beneficio observable (coherente con ADR-022, que tampoco persiste ratings de episodio).
- **No hacer nada**: la issue pedía explícitamente la puntuación por episodio; el dato ya existía y no mostrarlo dejaba la petición sin resolver.

## Consecuencias

### Positivas
- **Issue #45 resuelta**: cada episodio de una serie automática muestra su nota de comunidad en el contexto adecuado (modal de detalle de serie → temporada → episodio), con estilo consistente con el resto de la aplicación (ADR-005/ADR-022).
- **Cero duplicación de render**: `communityRatingHtml` delega en el helper nuevo y el HTML de las tarjetas es idéntico al anterior — sin riesgo de regresión visual en cuadrícula/lista.
- **Sin coste adicional de API ni persistencia**: `episodeRating` ya existía en `getSeasonEpisodes`; solo se añade render, sin cambios en la capa de datos ni en el contrato de la función.
- **Responsive verificado**: badge con unidades `rem` y `flex-shrink: 0`; la web se ve correctamente en móvil (~360 px), tablet (~768 px) y ordenador (~1280 px) sin scroll horizontal (criterio de aceptación 4 de la issue y regla de AGENTS.md).

### Negativas
- **Episodios sin votos y series manuales sin badge**: `vote_count === 0` y `manual === true` no muestran la nota; es la semántica truthy-only heredada de ADR-005/ADR-022 — un 0 sin votos no es una valoración real, y las series manuales no tienen datos de TMDB.
- **El badge puede quedar desactualizado hasta 24 h**: depende de la caché en memoria de `getSeasonEpisodes`; si TMDB actualiza la nota de un episodio, el dato nuevo no se verá hasta que expire la caché.

### Neutras
- **`communityRatingValueHtml` es reutilizable**: el parámetro `label` permite otros contextos (p. ej. una fuente distinta de TMDB) sin tocar el badge.
- **Sin cambios de contrato**: `communityRatingHtml(item)` conserva firma y salida; `renderEpisodeRows` conserva su API (`{ manual }`); `getSeasonEpisodes` no cambia.
- **Propagación PWA por el flujo habitual**: los archivos tocados (`js/ui.js`, `ocio/ocio.css`) ya están precacheados (ADR-019); el bump de versión sigue el proceso estándar de publicación, sin nada específico en esta decisión.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | Nuevo helper `communityRatingValueHtml(value, label = "TMDB")` que genera el badge `.community-rating community-rating--sm` (valor con `toFixed(1)`); `communityRatingHtml(item)` refactorizado para delegar en él (HTML idéntico para tarjetas, guard `null` conservado); en `renderEpisodeRows`, badge tras `.episode-row__name` cuando `!manual && e.episodeRating != null` |
| `ocio/ocio.css` | Variante compacta `.community-rating--sm` (gap 0.25rem, `flex-shrink: 0`, tamaños en rem: label 0.5rem / value 0.7rem) reutilizando los tokens de `.community-rating` base |
| `docs/adr-031-community-episode-rating.md` | **Nuevo**: este documento |

Related issue: #45 — https://github.com/gonzalitojh/Registro-personal/issues/45
