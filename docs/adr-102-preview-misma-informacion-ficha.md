# ADR-102: Vista previa con la misma información del título que la ficha (issue #290)

## Estado

Aceptado

## Fecha

2026-08-16

## Contexto

Desde la issue #285, al pulsar una **película o serie** la app abre la
**página de detalle** (`#/ocio/peliculas/<id>` o `#/ocio/series/<id>`,
ADR-100) con dos modos según el ítem esté o no en el registro del
usuario:

- **Ficha completa** (ítem en el registro): cabecera, distintivo de «sin
  estrenar» (si aplica), puntuación de la comunidad, tráiler, dónde
  verla (watch providers), información ampliada (duración, géneros,
  director/creadores, reparto, sinopsis), temporadas interactivas,
  saga y recomendaciones, más las acciones personales del registro
  (visionados, valoración, notas, editar, eliminar).
- **Vista previa** (ítem NO en el registro): cabecera, un aviso «aún no
  añadido» y solo sinopsis, géneros, duración, número de temporadas
  (cuenta simple), reparto y nota de comunidad como línea de texto.

La issue #290 pedía: «Actualmente se muestra diferente información en
base a si la película/serie está añadida o no cuando se pulsa sobre
ella. Quiero que siempre se muestre la misma información». El usuario
quería que la información del TÍTULO sea idéntica en ambos modos; las
acciones del registro (visionados, valoración personal, notas, editar,
eliminar) no son información del título y no aplican sin ítem en el
registro.

## Decisión

La vista previa muestra **la misma información del título que la ficha**,
reutilizando los **mismos helpers HTML** de la ficha (cero duplicación
de markup):

1. **`js/ui.js`**: se exportan 8 helpers que eran privados —
   `upcomingBadge`, `communityRatingDisplay`, `trailerButtonHtml`,
   `watchProvidersHtml`, `extraInfoHtml`, `previewSeasonsHtml`,
   `renderSagaMovies`, `renderRecommendations`. Son funciones puras de
   HTML; los llamadores existentes (ficha, preview de búsqueda) no
   cambian de comportamiento.

2. **`js/modal-handlers.js`**: se exportan `addSagaMovie`,
   `addFromRecommendation` y `openSagaSelector` para que la preview
   pueda wirear los botones «Añadir» de saga y recomendaciones con el
   mismo patrón que la ficha (el callback `onAddSagaMovie` /
   `onAddRecommendation` de `openMovieItem`/`openTvItem`).

3. **`js/api-movies.js`**: `getUserCountry` (país del usuario para los
   watch providers) se mueve aquí desde modal-handlers.js y se exporta;
   así la página de ítem y la ficha comparten la misma fuente de verdad
   (modal-handlers pasa a importarla).

4. **`js/item-page.js`**:
   - `buildPreviewItem` copia ahora TODOS los campos del título que
     consume la ficha: para películas `director`, `releaseDate`,
     `collectionId`, `collectionName`, `collectionPoster`; para series
     `episodeRuntime`, `creators`, `firstAirDate`, `seasonAirDates`,
     `tmdbStatus`. Además modela el ítem «como recién añadido»
     (`manual: false`, `nextEpisode = { season: 1, episode: 1 }`,
     `awaitingRelease = isUnreleasedDate(firstAirDate)`, replicando lo
     que fija `handleAdd` en search.js al dar de alta) para que
     `upcomingBadge` muestre el distintivo de «sin estrenar» de forma
     idéntica a como lo muestra la ficha de un ítem recién añadido.
   - Nueva `loadPreviewExtras(token, item)`: carga en **paralelo** con
     `Promise.allSettled` los bloques no críticos — watch providers,
     recomendaciones (similares), ids ya añadidos (`existingIds`) y
     películas de la saga (si `collectionId`). Un fallo degrada el
     bloque correspondiente sin romper la preview (misma política de
     degradación elegante que la ficha).
   - `paintPreview` rediseñada: compone el mismo orden de bloques que la
     ficha — cabecera, aviso «aún no añadido» (se conserva), badge de
     no estrenado, nota de comunidad, tráiler, dónde verla,
     información ampliada, temporadas detalladas (solo lectura,
     `previewSeasonsHtml`), banner y tarjetas de saga, recomendaciones —
     y wirea los botones: «Añadir resto de la saga» →
     `openSagaSelector`; `.saga-card__add` → `addSagaMovie` (con
     `existingIds` compartido y toast); `.rec-card__add` →
     `addFromRecommendation`; `.saga-card__open` / `.rec-card__open` →
     `navigate()` a la página de ese ítem. El aviso «Este título aún no
     está en tu registro» y el botón «Añadir» principales se mantienen
     (el alta sigue pasando a la ficha vía `refreshAfterAdd`).
   - `renderPreview` reordenada: pintado inmediato con spinner cuando no
     hay dato optimista (antes la tarjeta quedaba vacía), carga de
     detalles, carga de extras en paralelo, chequeo anti-race
     (`isCurrent(token)`), chequeo de alta mientras cargaba
     (`findInCollection` → ficha) y **un único repintado completo**
     con detalles + extras.

## Alternativas descartadas

- **Duplicar el markup de los bloques en item-page.js**: divergencia
  futura con la ficha; se descarta en favor de reutilizar los helpers.
- **Reutilizar `openMovieModal`/`openTvModal` con callbacks «fantasma»**:
  esas funciones renderizan también las acciones del registro
  (visionados, rating picker, notas, eliminar/guardar) que no aplican
  sin ítem en el registro; el resultado sería un formulario roto en
  lugar de una vista previa informativa.
- **Repintado incremental por bloques** al llegar cada extra: parpadeo
  y más awaits; los extras están cacheados 24 h en api-movies, así que
  un único repintado no añade latencia real perceptible.
- **Replicar el badge de «próximo episodio sin estrenar» en preview**:
  ese badge depende del progreso del usuario (siguiente episodio que le
  toca ver), estado inexistente en una vista previa; se modela el ítem
  como recién añadido, que es el estado factual equivalente.

## Consecuencias

- La preview de películas y series muestra desde ahora la misma
  información del título que la ficha, esté o no añadido el ítem, en
  cualquier punto de entrada (catálogo, colección, saga, recomendación,
  URL directa).
- Requiere 4 llamadas TMDB extra en paralelo por preview (providers,
  similares, saga, y la lectura local del grupo); todas con caché de
  24 h compartida y `Promise.allSettled` — los fallos degradan el
  bloque sin romper la vista.
- Los helpers exportados de ui.js/modal-handlers.js amplían la
  superficie pública de esos módulos; no cambian el comportamiento de
  los llamadores existentes.
- Actualización del manual de usuario (secciones 10.1 y 12) y bump de
  versión PWA.

## Archivos modificados

- `js/ui.js` (8 exports)
- `js/modal-handlers.js` (3 exports + import de `getUserCountry`)
- `js/api-movies.js` (mover/exportar `getUserCountry`)
- `js/item-page.js` (preview unificada)
- `docs/manual-de-usuario.md` (10.1 y 12)
- `index.html` / `service-worker.js` (bump `?v=`)

Related issue: #290