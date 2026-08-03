# ADR-022: Ventana de valoración emergente (rating modal)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

Al marcar como visto/leído un episodio de serie, una película o un libro,
el usuario tenía que esperar a abrir la ficha del ítem para poder asignar
su valoración personal (1 a 5 estrellas). En series, la valoración por
episodio solo era editable desde el propio episodio expandido, y no existía
ningún recordatorio que invitara a valorar en el momento del marcado.

La issue #21 pedía una **ventana de valoración emergente**: al marcar como
visto/leído un ítem, se despliega una ventana flotante que muestra la
valoración de la comunidad y permite guardar la valoración personal sin
salir del contexto actual. Requisitos de comportamiento:

- La ventana se abre al marcar como visto/leído un episodio de serie, una
  película o un libro.
- Para series, la nota de comunidad mostrada debe ser **la del episodio**
  (vía TMDB), no la de la serie.
- Marcar una **temporada entera** NO abre la ventana (acción masiva, no
  individual).
- El usuario puede guardar su valoración de 1 a 5 estrellas, o descartar
  la ventana sin guardar.

Además, la ventana debe funcionar tanto desde el modal de detalle (que
queda abierto debajo) como desde las acciones rápidas (botón de lista y
swipe), donde no hay ningún modal detrás.

Related issue: #21 — https://github.com/gonzalitojh/Registro-personal/issues/21

## Decisión

Implementar la ventana de valoración como un **segundo modal superpuesto**
con un módulo nuevo (`js/rating-modal.js`) y puntos de enganche en la capa
de persistencia (`modal-handlers.js` y `quick-actions.js`), sin tocar
`ui.js`.

### 1. Segundo modal superpuesto, no reemplazo de contenido

Se añadió un armazón estático `#rating-modal` en `index.html`, hermano del
modal de detalle existente `#item-modal`:

- `#item-modal` mantiene `z-index: 50` (clase `.modal`).
- `#rating-modal` usa la clase nueva `.modal--top` con `z-index: 70`, de
  modo que se superpone al modal de detalle sin reemplazar su contenido:
  al cerrar la ventana de valoración, la ficha del ítem sigue abierta y
  conserva su estado (sin re-renderizado).
- El armazón reutiliza el patrón existente de modal: backdrop, botón de
  cierre (✕), `role="dialog" aria-modal="true"`, foco atrapado
  (`trapFocus` de `focus-utils.js`) y restauración del foco al elemento
  previo tras cerrar.
- La tarjeta usa `.modal__card--small` (más estrecha) y se marca
  `aria-label="Valorar ítem"`.

### 2. Módulo nuevo `js/rating-modal.js`

La API del módulo es una única función de apertura basada en promesas:

```
openRatingModal({ type, title, coverUrl, episodeLabel, communityRating,
                  communityLabel, initialRating, onSave })
  => Promise<number|null>
```

- La promesa se **resuelve con el rating guardado (1-5)** o con `null` si
  la ventana se descartó (✕, backdrop o "Ahora no").
- **Nunca rechaza**: los errores de `onSave` se notifican con un toast
  ("No se pudo guardar la valoración: …") y la ventana permanece abierta
  para reintentar; el botón "Guardar valoración" se deshabilita durante el
  guardado y se rehabilita al fallar.
- Los listeners de cierre (✕ y backdrop) se registran **una sola vez a
  nivel de módulo** (el armazón es estático en `index.html`), no por cada
  apertura; `closeRatingModal()` es exportado para que el handler global
  de Escape (en `modal-handlers.js`) pueda cerrarla con prioridad. El
  cierre es idempotente (`currentClose` único + guarda `settled`).
- El contenido se renderiza dentro de `#rating-modal-content` en cada
  apertura: cabecera con portada/título/línea de episodio
  (`episodeLabel`, p. ej. `T1E3 · Piloto`), línea de puntuación de
  comunidad (mismo estilo `.modal-detail__ratings` / `.community-rating`
  que ADR-005) y el picker de estrellas.

### 3. Puntos de enganche en la capa de persistencia

La ventana se abre desde los handlers que ya persisten el marcado, en
`modal-handlers.js` (modal de detalle) y `quick-actions.js` (botón de
lista y swipe), **no desde `ui.js`** (que sigue sin conocer la ventana):

- **Película** (`onAddWatch`): `maybeOpenItemRatingWindow(item, ctx, "movie")`
  tras persistir el visionado.
- **Libro** (`onFinishReading`): `maybeOpenItemRatingWindow(item, ctx, "book")`
  **solo al terminar** la lectura (no al empezarla); en acciones rápidas,
  `quickMarkBook` aplica la misma regla (`isReading`).
- **Serie, episodio** (`onSetEpisodeDate`): `maybeOpenEpisodeRatingWindow`
  solo en la transición **no-visto → visto** (`!wasWatched && dateOrNull`);
  desmarcar un episodio o re-marcarlo no reabre la ventana. En acciones
  rápidas, `quickMarkTv` hace lo equivalente tras `saveTvProgress`.
- **Temporada entera** (`onToggleSeason`): **NO abre la ventana**; es una
  acción masiva y la valoración individual no tiene sentido en ese
  contexto.
- Todos los wrappers van en `try/catch` y nunca lanzan: si algo falla, el
  marcado ya persistido queda intacto.

### 4. Rating de comunidad del episodio (TMDB)

`getSeasonEpisodes` (`js/api-movies.js`) ahora mapea cada episodio con:

```
episodeRating: e.vote_count > 0 ? e.vote_average : null
```

(misma semántica `vote_count > 0` que ADR-005, para no tratar un 0 sin
votos como valoración real), y los resultados se cachean en memoria con
TTL de 24 h bajo la clave `season_{tvId}_{seasonNumber}` (misma caché
compartida que los watch providers).

La consulta del episodio se hace **bajo demanda** en el momento de abrir
la ventana (`getSeasonEpisodes` + `find` por `episodeNumber`). Si no hay
datos —serie manual (sin `externalId`), episodio sin votos o fetch
fallido— la ventana se abre igualmente mostrando **"Sin puntuaciones"**
(semántica idéntica a ADR-005), con `communityLabel` "TMDB · episodio"
cuando sí hay nota.

### 5. Persistencia de la valoración del usuario

- **Película / libro**: `updateItem({ rating })` sobre el documento del
  ítem — reutiliza el campo `rating` existente del modelo (1-5), sin
  cambios de esquema.
- **Serie**: `watched[season][ep].rating` vía `setEpisodeRating` +
  `persistWatched` (modal de detalle) o el payload completo de progreso
  (`saveTvProgress` en acciones rápidas), igual que el marcado de
  episodios.
- El picker reutiliza `ratingPickerHtml` / `wireRatingAndGetValue` de
  `ui.js` con `idPrefix: "rm-rating"` para **evitar ids duplicados** con
  el modal de detalle (`#item-modal` queda abierto debajo, con su propio
  picker de estrellas).
- En series, `initialRating` se lee con `normalizeEntry` sobre la entrada
  de `watched`; en películas/libros, de `item.rating`.

### 6. Libros sin comunidad

Los libros no tienen `communityRating` en el modelo (no hay TMDB para
libros), así que la ventana muestra **"Sin puntuaciones"** con la misma
semántica que ADR-005. No se añade el rating de Google Books a la ventana
ni al modelo: queda **fuera de scope** de la issue #21.

### 7. Seguridad: `safeCoverUrl` y `escapeHtml`

`js/rating-modal.js` incorpora un helper `safeCoverUrl(url)` que solo
acepta esquemas `https:` o `data:image/` (patrón del repo para
placeholders, p. ej. `PLACEHOLDER_COVER`); cualquier otro esquema
(`javascript:`, `data:text/html`, …) o URL inválida cae al placeholder.
Todas las interpolaciones nuevas (`src`, título, subtítulo, labels) se
escapan con `escapeHtml` como defensa en profundidad.

Esto **no perpetúa el patrón preexistente** de `coverUrl` sin sanitizar en
otras interpolaciones (hallazgo MEDIUM del security scan); el arreglo
global de las interpolaciones preexistentes queda como ticket aparte, fuera
de esta issue.

### 8. Toast por encima de la ventana

El toast subió de `z-index: 60` a `z-index: 80` en `css/styles.css`, para
que los errores de guardado (y el aviso "Elige una valoración…") sean
visibles sobre el modal de valoración (z-index 70), que a su vez cubre el
modal de detalle (z-index 50).

## Alternativas descartadas

- **Reemplazar el contenido del modal de detalle** (`#modal-content`):
  descartado: al cerrar la valoración habría que re-renderizar la ficha
  completa, perdiendo estado (pestaña expandida, scroll) y mezclando dos
  responsabilidades en un solo modal. El segundo modal superpuesto deja
  el detalle intacto debajo.
- **Enganchar la apertura en `ui.js`** (donde se renderiza el marcado):
  descartado: `ui.js` es renderizado puro y no conoce la persistencia; los
  wrappers viven en la capa que ya persiste (`modal-handlers.js` y
  `quick-actions.js`), donde se dispone de `ctx` y del estado tras
  persistir.
- **Abrir la ventana también al marcar una temporada entera**:
  descartado: es una acción masiva; abrir una ventana de valoración por
  cada episodio sería molesto y sin sentido.
- **Mostrar la nota de comunidad de la serie en episodios**: descartado:
  el requisito de la issue es explícito — la nota debe ser **del
  episodio** vía TMDB.
- **Añadir rating de Google Books para libros**: descartado por scope: el
  modelo de libros no tiene `communityRating` y la issue #21 no lo pide;
  mostrar "Sin puntuaciones" es coherente con ADR-005.
- **Quitar la ventana en acciones rápidas**: descartado: el botón de
  lista y el swipe son la vía principal de marcado en móvil; omitir la
  ventana allí la haría invisible para el uso más habitual.
- **Usar `innerHTML` sin sanitizar la portada (patrón preexistente)**:
  descartado para las interpolaciones nuevas: se añadieron `safeCoverUrl`
  + `escapeHtml` (defensa en profundidad) sin esperar al arreglo global
  del hallazgo MEDIUM del security scan.

## Consecuencias

### Positivas
- El usuario valora en el momento del marcado, sin pasos extra; el
  contexto (ficha o lista) queda intacto debajo de la ventana.
- Las series muestran la nota de comunidad **del episodio**, que es la
  información relevante al marcar un episodio concreto.
- La ventana nunca bloquea el flujo: descartable con ✕, backdrop o Escape
  (con prioridad sobre el modal de detalle), y los fallos de guardado no
  pierden el marcado ya persistido.
- Sin cambios de esquema: películas/libros reutilizan `rating`; series
  reutilizan `watched[season][ep].rating`; libros sin comunidad muestran
  "Sin puntuaciones" sin tocar el modelo.
- Las nuevas interpolaciones están saneadas (`safeCoverUrl` + `escapeHtml`),
  cerrando la vía del hallazgo MEDIUM para este componente.

### Negativas
- Una petición adicional a TMDB por episodio marcado en series (solo la
  primera vez por temporada y día, gracias a la caché `season_*` de 24 h);
  en series manuales o ante fallos no se hace ninguna.
- El usuario puede sentirse interrumpido si marca varios ítems seguidos;
  mitigado porque la ventana es descartable en un gesto y "Ahora no" la
  cierra sin guardar.
- Cierre del flujo con doble modal: el Escape y el foco requieren
  coordinación (resuelta con `closeRatingModal()` exportado y la
  prioridad del handler global en `modal-handlers.js`).

### Neutras
- `getSeasonEpisodes` pasa a incluir `episodeRating` y a usar la caché
  compartida con TTL 24 h; el resto de consumidores de la función
  (expansión de temporada) ignoran el campo nuevo.
- El toast sube de `z-index` 60 a 80: afecta a la superposición global,
  no solo a esta ventana (los toasts ya eran el elemento más alto excepto
  los modales; ahora también lo son por encima de la ventana de
  valoración).
- `ui.js` queda intacto: el picker se reutiliza con `idPrefix`
  ("rm-rating") en lugar de duplicarlo.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Nuevo armazón** `#rating-modal` (`.modal--top`, `.modal__card--small`, backdrop, ✕, `#rating-modal-content`) junto a `#item-modal` |
| `js/rating-modal.js` | **Nuevo**: `openRatingModal()` (Promise), `closeRatingModal()`, `safeCoverUrl`, `escapeHtml`, listeners de cierre únicos, foco atrapado/restaurado |
| `js/modal-handlers.js` | Wrappers `maybeOpenItemRatingWindow` (onAddWatch película, onFinishReading libro) y `maybeOpenEpisodeRatingWindow` (onSetEpisodeDate con `!wasWatched && dateOrNull`); `onToggleSeason` sin ventana; Escape con prioridad para `closeRatingModal()` |
| `js/quick-actions.js` | Wrappers equivalentes para acciones rápidas (`quickMarkMovie`, `quickMarkBook` solo al terminar, `quickMarkTv` con `getSeasonEpisodes` bajo demanda) |
| `js/api-movies.js` | `getSeasonEpisodes`: nuevo `episodeRating` (`vote_count > 0 ? vote_average : null`) y caché en memoria `season_{tvId}_{seasonNumber}` TTL 24 h |
| `css/styles.css` | `.modal--top` (z-index 70); `.toast` sube a z-index 80 (comentario actualizado) |
| `service-worker.js` | `js/rating-modal.js` añadido a `STATIC_ASSETS` |

Related issue: #21 — https://github.com/gonzalitojh/Registro-personal/issues/21
