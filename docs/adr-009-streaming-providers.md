# ADR-009: Mostrar plataformas de streaming disponibles desde TMDB

## Estado
Implementado

## Contexto
La aplicación obtiene de TMDB datos ampliados de películas y series (sinopsis, reparto, director, tráiler, colecciones, puntuación de la comunidad, etc.) y los muestra en los modales de detalle. Sin embargo, los usuarios no tenían forma de saber en qué plataformas de streaming (Netflix, HBO Max, Disney+, Prime Video, etc.) estaba disponible un título sin salir de la aplicación.

TMDB proporciona los endpoints `/movie/{id}/watch/providers` y `/tv/{id}/watch/providers` que devuelven los proveedores de streaming, alquiler y compra disponibles para cada título, organizados por país. Este dato permite mostrar al usuario «dónde ver» cada película o serie de forma actualizada sin coste adicional de API.

Se necesitaba incorporar esta información para:
- Permitir al usuario saber en qué plataformas de streaming está disponible cada título desde el modal de detalle.
- Distinguir entre streaming (incluido en la suscripción), alquiler y compra.
- Que la información se muestre tanto para títulos propios como para los de amigos (modal de solo lectura).
- Mantener la coherencia con el patrón existente de obtención de datos en el momento de abrir el modal.

## Decisión
Implementar la funcionalidad completa de watch providers desde TMDB, que incluye:

1. Nueva función `getWatchProviders()` en `api-movies.js` para consultar el endpoint de proveedores.
2. Sistema de caché en memoria con TTL de 24 horas para evitar llamadas redundantes.
3. Renderizado de una sección visual con logos y nombres de las plataformas en los modales de detalle.
4. Integración en los tres modales: película, serie y solo lectura (amigos).
5. Enlace opcional «Ver opciones en TMDB» para consultar más detalles.
6. Detección automática del país del usuario (con fallback a España) y posibilidad de cambiarlo manualmente en el futuro mediante `localStorage`.

### Obtención de datos
Se creó la función `getWatchProviders(id, type, countryCode)` en `api-movies.js` que:

1. Verifica la caché en memoria: si existe una entrada válida (menos de 24h), la devuelve sin hacer la llamada.
2. Si no hay caché, construye la URL del endpoint correspondiente según el tipo (`/movie/{id}/watch/providers` o `/tv/{id}/watch/providers`).
3. Realiza la petición con `fetchJson` (con 1 reintento) y manejo de errores silencioso.
4. Si el país solicitado no está disponible en la respuesta, guarda `null` en caché y devuelve `null`.
5. Normaliza los proveedores en tres categorías: `flatrate` (streaming), `rent` (alquiler), `buy` (compra).
6. Guarda el resultado en caché y lo devuelve.

```javascript
export async function getWatchProviders(id, type, countryCode = "ES") {
  const cacheKey = `wp_${type}_${id}_${countryCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const endpoint = type === "tv" ? "tv" : "movie";
  const url = `${BASE_URL}/${endpoint}/${id}/watch/providers?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results || !data.results[countryCode]) {
    setCache(cacheKey, null);
    return null;
  }

  const country = data.results[countryCode];
  const result = {
    flatrate: (country.flatrate || []).map(normalizeProvider),
    rent: (country.rent || []).map(normalizeProvider),
    buy: (country.buy || []).map(normalizeProvider),
    link: country.link || null,
  };

  setCache(cacheKey, result);
  return result;
}
```

### Detección del país
Se creó el helper `getUserCountry()` en `modal-handlers.js` que determina el país del usuario siguiendo este orden de precedencia:

1. `localStorage.getItem("watch-provider-country")` — preferencia guardada por el usuario (para futuro selector de país).
2. `navigator.language.split("-")[1]` — código de región del navegador (ej: "ES" de "es-ES").
3. `"ES"` — fallback a España.

### Visualización
Se añadieron tres funciones en `ui.js`:

- **`providersGroupHtml(providers, label)`**: Renderiza un grupo de proveedores (Streaming, Alquiler o Compra) con sus logos y nombres.
- **`watchProvidersHtml(item)`**: Renderiza la sección completa de watch providers, incluyendo:
  - Título «Disponible en:» si hay al menos un proveedor.
  - Grupos separados para streaming, alquiler y compra.
  - Enlace «Ver opciones en TMDB» si TMDB proporciona URL.
  - Mensaje «Sin info. de streaming para este país» si no hay datos.
  - Cadena vacía si `item.watchProviders` es `null` (sin datos o error).

La sección se inserta en tres modales, en la misma posición (después del tráiler y antes de la información ampliada):

- `openMovieModal()` — modal de detalle de película.
- `openTvModal()` — modal de detalle de serie.
- `openReadOnlyModal()` — modal de solo lectura (amigos).

### Integración en modal-handlers.js
Tanto `openMovieItem()` como `openTvItem()` ahora obtienen los watch providers antes de abrir el modal:

1. Si el item tiene `externalId`, se llama a `getWatchProviders(externalId, type, countryCode)` con `await`.
2. Si la llamada falla (error de red, TMDB no responde, etc.), se asigna `null` silenciosamente.
3. El resultado se asigna a `item.watchProviders` para que el modal lo muestre.

Este enfoque es consistente con el patrón existente de `openTvItem()`, que ya espera a obtener las temporadas antes de abrir el modal.

### Caché
El sistema de caché en memoria (`providersCache`) almacena los resultados de `getWatchProviders()` con un TTL de 24 horas. Esto evita llamadas redundantes a la API de TMDB durante la misma sesión del navegador.

### Estilos CSS
Se añadieron las siguientes clases en `ocio/ocio.css`:

- `.watch-providers` — contenedor principal, con fondo `--paper-dim` y bordes redondeados.
- `.watch-providers__title` — título de la sección «Disponible en:».
- `.watch-providers--empty` — variante para el caso «Sin información».
- `.watch-providers__group` — cada grupo (Streaming, Alquiler, Compra).
- `.watch-providers__type-label` — etiqueta del grupo.
- `.watch-providers__logos` — contenedor flex con los logos.
- `.watch-provider` — cada proveedor individual (flex con logo + nombre).
- `.watch-provider__logo` — imagen del logo (22×22px).
- `.watch-provider__name` — nombre del proveedor.
- `.watch-providers__link` — enlace a TMDB.

Los logos se cargan desde `https://image.tmdb.org/t/p/w92` con lazy loading. Los estilos son coherentes con el sistema de diseño existente (mismos radios, tipografía, paleta de colores).

### Flujo de datos
```
Usuario abre modal de película/serie
  │
  ├─ modal-handlers.js: openMovieItem() / openTvItem()
  │   └─ getUserCountry() → "ES" | "US" | "MX" | ...
  │   └─ getWatchProviders(externalId, type, countryCode)
  │       ├─ ¿En caché? → sí → devuelve datos cacheados
  │       └─ no → fetch TMDB /watch/providers
  │           ├─ ¿Error? → null (no se muestra sección)
  │           └─ OK → guarda en caché y devuelve { flatrate, rent, buy, link }
  │   └─ item.watchProviders = resultado
  │
  └─ ui.js: openMovieModal() / openTvModal() / openReadOnlyModal()
      └─ watchProvidersHtml(item)
          ├─ ¿null? → cadena vacía (no se renderiza nada)
          ├─ ¿vacío? → "Sin info. de streaming para este país"
          └─ con datos → grupos de Streaming, Alquiler, Compra + logos
```

### Alternativas descartadas

- **Carga asíncrona con placeholder «Cargando…»**: Se descartó porque la llamada a TMDB es rápida (<500ms) y añadir un placeholder para luego re-renderizar la sección añade complejidad sin beneficio UX significativo. Se optó por esperar los datos (sync) como hace `openTvItem()` con las temporadas.

- **Selector de país interactivo en el modal**: Se pospuso para una iteración futura. De momento el país se detecta automáticamente. Ya está preparado el mecanismo de persistencia en `localStorage` para cuando se implemente el selector.

- **Almacenar providers en Firestore**: Se descartó porque los proveedores de streaming cambian con frecuencia (acuerdos de licencia, rotación de catálogo). Es mejor obtenerlos en vivo desde TMDB cada vez (con caché en memoria para la sesión). Además, esto evita inflar los documentos de Firestore con datos que pueden quedar obsoletos.

- **Mostrar providers en las tarjetas de la biblioteca**: Se descartó porque el espacio en las tarjetas es limitado y la información de streaming es un complemento útil al abrir el detalle, no un dato crítico que deba verse en la cuadrícula.

- **Persistencia de caché en localStorage**: Se consideró pero se descartó por ahora. La caché en memoria (24h TTL) es suficiente para la misma sesión del navegador. Si se cierra y reabre la aplicación, los datos se vuelven a obtener de TMDB, lo que garantiza que siempre estén actualizados.

- **Filtrado por tipo «free» o «ads»**: TMDB también soporta proveedores gratuitos con publicidad. Se decidió no incluirlos en esta primera iteración para mantener la UI simple, pero el campo `flatrate` de TMDB ya cubre estos casos si se quiere añadir soporte en el futuro.

## Consecuencias

### Positivas
- Los usuarios pueden ver rápidamente dónde está disponible cada título sin salir de la aplicación.
- La información distingue entre streaming, alquiler y compra, ayudando a decidir qué plataforma usar.
- Los logos de las plataformas facilitan la identificación visual.
- El enlace a TMDB permite explorar más opciones si es necesario.
- Funciona igual para películas y series.
- La caché en memoria evita llamadas redundantes a TMDB.
- La detección automática del país evita fricción al usuario.
- No se almacenan datos adicionales en Firestore.

### Negativas
- Los títulos sin `externalId` de TMDB (añadidos manualmente) nunca tendrán información de streaming.
- Si TMDB no tiene proveedores para un título concreto, se muestra un mensaje informativo en lugar de nada.
- La información depende de la cobertura de TMDB, que puede ser incompleta para títulos muy antiguos o de regions específicas.
- Al abrir el modal, hay una espera adicional (mínima) mientras se obtienen los providers de TMDB.

### Neutras
- La información de proveedores se obtiene en vivo al abrir el modal, no se persiste en Firestore.
- La caché en memoria se invalida al recargar la página, garantizando datos frescos en cada sesión.
- El campo `watchProviders` solo existe en el objeto `item` en memoria, no en Firestore.
- La funcionalidad solo aplica a películas y series; libros no se ven afectados.

## Archivos modificados
- `js/api-movies.js` — Nueva función `getWatchProviders()`, sistema de caché (`providersCache`), función `normalizeProvider()`.
- `js/ui.js` — Nuevas funciones `providersGroupHtml()` y `watchProvidersHtml()`; integradas en `openMovieModal()`, `openTvModal()` y `openReadOnlyModal()`.
- `js/modal-handlers.js` — Nueva función `getUserCountry()`; modificadas `openMovieItem()` y `openTvItem()` para obtener watch providers antes de abrir el modal; actualizado import de `api-movies.js`.
- `css/ocio.css` — Nuevas clases CSS para la sección `.watch-providers` y sus elementos internos.
