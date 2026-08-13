# ADR-095: Medias estrellas de valoración (issue #276)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #276 pide poder dar **medias estrellas** en las valoraciones
personales (películas, libros, videojuegos, series y episodios). La
propuesta textual del usuario: «al pulsar una vez, sobre el 3 por
ejemplo, se marcarían 3 estrellas, pero si se vuelve a pulsar sobre el
3, se marcaría la mitad y por tanto sería 2.5».

Estado actual del código antes del cambio:

- El picker de valoración (`ratingPickerHtml` y `wireRatingAndGetValue`
  en `js/ui.js`) ofrecía 5 botones numéricos (1-5) con conmutación
  binaria: pulsar el mismo valor quitaba la valoración (pasaba a 0).
- Las estrellas de episodio de serie (`renderEpisodeRows`,
  `applyEpisodeRowState` y el handler de clic en `js/ui.js`) usaban un
  conteo de estrellas activas (`querySelectorAll(".is-active").length`)
  para decidir el desmarcado, lógica frágil que no soporta valores .5.
- Los displays informativos (tarjetas del grid `renderGrid` y ficha de
  solo lectura `openReadOnlyModal`) pintaban `"★".repeat(rating)`, que
  truncaría 2.5 → «★★» perdiendo la media.
- `computeEpisodeAverageRating` (`js/tv-progress.js`) descartaba
  valoraciones < 1.
- El modelo de datos (`item.rating`, `episode.rating`) guarda números;
  Firestore acepta floats sin cambios de esquema.

## Decisión

Permitir valoraciones en pasos de 0.5 en todos los puntos de valoración
personal, centralizando la lógica en `js/ui.js`:

1. **Ciclo de pulsación uniforme** (picker principal y estrellas de
   episodio): sobre el mismo botón N, 1er pulso → N, 2º pulso → N−0.5,
   3er pulso → 0 (quitar, conservando el deshacer previo). El caso N=1
   también produce 0.5 (ciclo uniforme, sin ramas especiales).
2. **Visualización de la media**: el botón afectado (el de valor N
   cuando el rating es N−0.5) se pinta con la clase `is-half`, los
   mismos colores que `is-active` (variables de tema `--ochre-spine` /
   `--ink`, sin overrides extra) y su contenido pasa a «½». En los
   displays informativos se usa el nuevo helper exportado
   `ratingStarsHtml(rating)` que pinta «★★½» (glifo U+00BD, soporte
   universal).
3. **Saneado central**: nuevo helper privado `normalizeRating(v)` =
   `Math.round(v * 2) / 2` con límites [0, 5], aplicado en los puntos
   de entrada (picker y estrellas de episodio) y en los displays.
   `aria-label` dinámico por botón («2,5 estrellas» en la media,
   «N estrellas» en el resto).
4. **Estrellas de episodio**: el handler de clic deja de contar
   estrellas activas y compara contra el rating real de `item.watched`
   (patrón issue #136: derivar del dato, nunca del estado visual).
   `applyEpisodeRowState` también pinta `is-half`.
5. **Media de episodios**: el suelo de `computeEpisodeAverageRating`
   baja de 1 a 0.5 (las medias estrellas cuentan como valoración
   válida); el display con `toFixed(1)` ya era compatible.
6. **Manual de usuario** (`docs/manual-de-usuario.md`, regla 3 de
   AGENTS.md): se actualizan las secciones 5.3, 12 y 13.2 con el nuevo
   ciclo y los ejemplos «★★½» / 2.5.

Alternativas descartadas:

- **Saltar 0.5 en el ciclo para N=1** (1 → 0 directamente): asimetría
  según el botón, más ramas de código y rompe la uniformidad del ciclo.
- **Pseudo-elemento rellenando media estrella**: más CSS y
  posicionamiento, mayor riesgo visual en los cuatro modos de tema; el
  glifo «½» es texto plano con soporte universal.
- **Picker deslizante/continuo** (0.1-5): cambio de interacción mucho
  mayor, fuera del alcance de la issue.

## Consecuencias

**Positivas:**

- El usuario puede expresar valoraciones más matizadas (2.5, 4.5...)
  con el mínimo cambio de interacción: un pulso extra en el mismo botón.
- Cambio centralizado: todos los consumidores del picker (fichas,
  ventana de valoración emergente de la issue #21, acciones rápidas,
  buscador) heredan las medias sin tocarlos.
- El deshacer previo («pulsar otra vez quita») se conserva como tercer
  paso del ciclo; no hay regresión.
- Los displays (grid, ficha de solo lectura) y la media de episodios
  reflejan las medias correctamente.

**Negativas:**

- El ciclo requiere un pulso más para quitar una valoración entera (3
  pulsos en vez de 2); compensado por la uniformidad y documentado en
  el manual.
- El glifo «½» depende de la fuente del sistema; U+00BD tiene soporte
  universal en las fuentes del proyecto (documentado en el ADR).

**Neutras:**

- No cambia el esquema de datos ni las exportaciones (ICS, backup): el
  rating sigue siendo un número.
- El ordenado por valoraciones no existe (`js/sorting.js` no ordena por
  rating), por lo que no hay cambios ahí.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | **Modificado**: `normalizeRating`, `ratingButtonAriaLabel`, `ratingStarsHtml` (nuevos); `ratingPickerHtml` y `wireRatingAndGetValue` con medias y ciclo N → N−0.5 → 0; `renderEpisodeRows`, `applyEpisodeRowState` y handler de estrellas de episodio con `is-half`; `renderGrid` y `openReadOnlyModal` usan `ratingStarsHtml` |
| `js/tv-progress.js` | **Modificado**: suelo de `computeEpisodeAverageRating` 1 → 0.5 |
| `js/rating-modal.js` | **Modificado**: toast «Elige una valoración (de 1 a 5 estrellas, con medias).» |
| `ocio/ocio.css` | **Modificado**: `.rating-picker button.is-half`, `.episode-rating__star.is-half`; selector agrupado `[data-theme="black"]` ampliado con `is-half` |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 5.3, 12 y 13.2 con el ciclo de medias estrellas |
| `docs/adr-095-medias-estrellas-valoracion.md` | **Nuevo**: este documento |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificados**: bump de versión PWA `20260926` → `20260927` |
| `tasks/task-issue-276.json` | Task file de la tarea (status `review` + bloque `pr` al publicar) |

Related issue: #276