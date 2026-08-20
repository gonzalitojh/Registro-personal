# ADR-113: Unificación de la página de títulos no añadidos con la ficha (issue #317)

## Estado

Aceptado

## Fecha

2026-08-20

## Contexto

La issue #317 pide que la **página de detalle** (`#item-view`, issue
#285) de una película o serie **NO añadida al registro** sea **igual a
la de un título añadido** «en cuanto a secciones, botones y
organización». La base de la PR es `feat/issue-201` (igual que
#290-#311).

Desde la issue #285 la página tiene **dos rutas de render** para el
mismo contenedor:

1. **Ficha** (ítem EN el registro): `renderFicha` (js/item-page.js)
   delega en `openMovieItem`/`openTvItem` (js/modal-handlers.js), que
   en modo página (con `target`) llaman a
   `openMovieModal`/`openTvModal` (js/ui.js). Organización de la ficha
   en modo página: hero (`itemHeroHtml` con `showUserRating: true`) →
   distintivo de no estrenado → dónde verla → premios → carruseles de
   producción/reparto → saga (películas) → recomendaciones → [series:
   banner de progreso, banners de estado (standby/completado/rewatch)
   y temporadas desplegables interactivas].
2. **Vista previa** (ítem NO en el registro): `renderPreview` →
   `paintPreview` (js/item-page.js), que construía su propio
   documento con **diferencias estructurales** respecto a la ficha:
   - Hero sin la valoración propia (`itemHeroHtml` con
     `showUserRating: false` — el ítem no tiene `item.rating`, pero el
     hero trataba la preview como un caso distinto en vez de como un
     ítem añadido sin valorar).
   - Aviso «Este título aún no está en tu registro» **al principio**,
     justo bajo el hero.
   - Bloque `#preview-details` con `extraInfoHtml` + la lista plana
     `previewSeasonsHtml` (series) en lugar de los **carruseles de
     Producción/Reparto** (`castCrewHtml`) y de las **temporadas
     desplegables** de la ficha.
   - Sin banner de progreso en series.
   - Pie con **dos botones**: «Volver» (`#btn-preview-back` →
     `goBack`) y «Añadir».

Related issue: #317 — https://github.com/gonzalitojh/Registro-personal/issues/317

## Decisión

Reescribir **`paintPreview`** (js/item-page.js) para que **espeje la
estructura de la ficha** (misma fuente de verdad que
`openMovieModal`/`openTvModal` en modo página), reutilizando los
**mismos helpers compartidos** — la práctica de ADR-102, sin
duplicación de HTML:

### 1. Misma organización de secciones que la ficha

Orden del render: hero → distintivo de no estrenado (`upcomingBadge`)
→ línea de carga (solo render optimista) → `watchProvidersHtml` →
`awardsHtml` → `castCrewHtml` (carruseles de producción/reparto, que
antes faltaban) → `renderSagaMovies` (películas con `collectionId`) →
`renderRecommendations`.

- **Hero con `showUserRating: true`**: el ítem de preview no tiene
  `rating`, así que el hero se comporta exactamente como el de un
  título añadido **sin valorar**: valoración de la comunidad + tráiler,
  sin estrellas propias ni chip de media de episodios (ambos se omiten
  por datos ausentes, no por una rama de preview).
- `extraInfoHtml` y `previewSeasonsHtml` dejan de importarse en
  js/item-page.js.

### 2. CTA único «Añadir» al final; el «Volver» del pie desaparece

El pie `.modal-actions` queda con **un solo botón**,
`#btn-preview-add` (añade mediante `addFromPreview` y pasa a la ficha,
comportamiento intacto). El botón `#btn-preview-back` se elimina: la
navegación de vuelta ya la cubren la **cabecera ←** (`#btn-item-back`),
la tecla **Esc** (`handleEscape`) y el fallback de `goBack`
(`history.back()` o navegación a la última pestaña de Ocio). Nueva
regla única de CSS para anclar el CTA a la derecha (`.modal-actions`
reparte con `space-between`):

```css
#item-view #btn-preview-add { margin-inline-start: auto; }
```

### 3. Aviso «aún no está en tu registro» en la zona de banners

El aviso `item-preview__hint` se **reposiciona al final**: después de
las recomendaciones y del banner de progreso de la serie (la zona que
en la ficha ocupan los banners de estado), justo encima de las
temporadas (series) y del CTA «Añadir». Ocupa así el lugar natural del
«equivalente vacío» de los banners de registro (standby, completado,
rewatch), que no aplican sin ítem.

### 4. Series: banner de progreso «recién añadida» y temporadas de solo lectura

- **Banner de progreso**: réplica del de la ficha calculado como una
  serie **recién añadida** — `computeProgress(seasonsMeta, {})`:
  «Siguiente: T1E1», barra al **0 %** y `0/N episodios`. Solo cuando
  TMDB trae temporadas (`item.seasonsMeta` no vacío): sin ellas no hay
  banner ni lista (degradación elegante, como en la ficha).
- **Temporadas desplegables de SOLO LECTURA**: nuevos exports en
  js/ui.js:
  - `renderSeasonBlockReadOnly(s)`: misma estructura que
    `renderSeasonBlock` (cabecera con chevron ▸/▾, `aria-expanded`,
    nombre y contador) pero **sin la casilla circular de «Marcar
    todo»** y con contador `0/N` (el equivalente vacío de una serie
    recién añadida).
  - `renderEpisodeRowsReadOnly(episodes)`: mismas filas que
    `renderEpisodeRows` (nº `E#`, nombre, aviso **«sin estrenar ·
    fecha»** vía `isUnreleasedDate`/`formatDateEs` y **nota de la
    comunidad TMDB** del episodio con `communityRatingValueHtml`) pero
    **sin casilla de marcado, sin valoración personal y sin
    «Visionados anteriores»**: no hay nada que marcar sin ítem en el
    registro.
- Episodios **bajo demanda**: al desplegar una temporada por primera
  vez se piden a `pageCtx.getSeasonEpisodes(item.externalId, n)`. El
  botón se **deshabilita durante la carga** (evita dobles fetch) y el
  guard **anti-race** `isCurrent(currentToken) && block.isConnected`
  evita pintar en un bloque huérfano si la ruta cambió durante el
  `await` (patrón de la página). Fallo de red → mensaje «No se pudieron
  cargar los episodios.» en el bloque.

### 5. Equivalentes vacíos coherentes (datos solo del registro)

Todo lo que vive del registro queda **ausente por datos, no por rama**:
valoración personal (hero de ítem añadido sin valorar: comunidad +
tráiler), sección de visionados (`watchLog` — igual que una película
añadida sin ver), banners de standby/completado/rewatch, casilla «Marcar
todo» por temporada y casillas/valoraciones de episodio. El FAB de la
preview no cambia (modo `preview`, solo «Añadir», issue #298).

## Alternativas descartadas

- **Reutilizar `openMovieItem`/`openTvItem` con un flag «no añadido»**:
  rechazada. Esas rutas **persisten por `item.id`** (Firestore), y el
  ítem de preview **no tiene `id`** (solo `externalId`); cablear el modo
  «sin registro» dentro de `openMovieModal`/`openTvModal` (≈600 líneas
  con sus callbacks de persistencia, watched, rewatch y expansión de
  temporadas) exigiría **callbacks fantasma** condicionados al flag y
  **duplicaría la orquestación asíncrona** (carga de providers,
  premios, recomendaciones, saga) que la preview ya resuelve con
  `loadPreviewExtras`. `paintPreview` es la ruta barata y aislada.
- **Conservar la lista plana `previewSeasonsHtml` como temporadas de
  la preview**: rechazada. Es una lista de solo lectura con otra
  **organización** que la ficha (bloques desplegables por temporada, no
  una lista única); la issue pide secciones, botones y organización
  idénticos. (La lista sigue viviendo en ui.js para la preview de
  búsqueda por modal, que no se toca.)
- **Temporadas interactivas con controles falsos** (casillas «Marcar
  todo», checkbox y valoraciones de episodio deshabilitados/no-op):
  rechazada. Controles que parecen pulsables **sin efecto real** se ven
  rotos; la versión de solo lectura muestra la información sin
  prometer acciones del registro.

## Consecuencias

**Positivas:**

- La página de un título NO añadido es **idéntica a la ficha** en
  secciones, botones y organización (el objetivo de #317): misma
  cabecera, premios, carruseles de producción/reparto, saga,
  recomendaciones y, en series, banner de progreso y temporadas
  desplegables.
- **Cero duplicación de markup**: todos los bloques salen de los
  helpers compartidos de la ficha (práctica ADR-102); cualquier cambio
  futuro en una sección queda en sincronía entre ficha y preview.
- Las temporadas de solo lectura aportan **paridad de información**
  (fecha de estreno por episodio, nota de la comunidad TMDB) sin
  controles que no puedan funcionar.
- Guards anti-race (`isCurrent` + `isConnected`) y botón deshabilitado
  durante la carga: sin pintados huérfanos ni dobles fetch.

**Negativas / neutras:**

- La preview **no tiene datos del registro**: valoración personal,
  visionados, banners de estado y controles de temporada son los
  **equivalentes vacíos** descritos (hero de añadido sin valorar, 0/N,
  sin checkboxes) — coherente con el estado «no añadido», nunca
  secciones fantasma.
- **Una llamada TMDB extra por temporada desplegada** en la preview de
  serie (mismo patrón bajo demanda que la ficha para ítems añadidos);
  solo la primera expansión, luego se cachea en el DOM
  (`block.dataset.loaded`).
- El **pie ya no tiene «Volver»**: la navegación de vuelta queda en la
  cabecera ←, Esc y el fallback de `goBack` (documentado en el manual).
- La **preview de búsqueda por modal** (libros, videojuegos y series
  vía `openSearchPreviewModal` + `previewSeasonsHtml`) **no se toca**.
- Regla CSS única para el CTA (`#item-view #btn-preview-add`); el botón
  queda anclado a la derecha en los cuatro modos de tema sin overrides
  adicionales.
- Handbooks: el manual de usuario se actualiza en §10.1 (vista previa
  del catálogo = ficha) y §12 (página de título no añadido idéntica a
  la ficha; aviso y «Añadir» al final; sin botón «Volver» — ← o Esc;
  temporadas en solo lectura con nota de la comunidad por episodio).
- Versión PWA bumped a `20261011` (js/config.js, index.html,
  service-worker.js): un precache adicional para los usuarios al
  desplegar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/item-page.js` | **Modificado**: `paintPreview` reescrita para espejar la ficha — hero con `showUserRating: true`, `castCrewHtml` (carruseles de producción/reparto), misma organización de secciones, aviso `item-preview__hint` reposicionado a la zona de banners, CTA único `#btn-preview-add` (eliminado `#btn-preview-back`/`Volver`), banner de progreso de serie (`computeProgress(seasonsMeta, {})` → «Siguiente: T1E1», 0 %, `0/N`) y temporadas desplegables de solo lectura con carga bajo demanda de episodios (`pageCtx.getSeasonEpisodes`) con guards anti-race (`isCurrent` + `isConnected`) y botón deshabilitado durante la carga; imports actualizados (salen `extraInfoHtml` y `previewSeasonsHtml`; entran `castCrewHtml`, `renderSeasonBlockReadOnly`, `renderEpisodeRowsReadOnly`) |
| `js/ui.js` | **Modificado**: nuevos exports `renderSeasonBlockReadOnly` (cabecera con chevron/aria-expanded y contador `0/N`, sin «Marcar todo») y `renderEpisodeRowsReadOnly` (filas `E#` + nombre + «sin estrenar · fecha» + nota de la comunidad TMDB, sin casillas ni valoración personal) |
| `css/styles.css` | **Modificado**: regla única `#item-view #btn-preview-add { margin-inline-start: auto; }` (ancla el CTA único a la derecha de `.modal-actions` en la página) |
| `docs/manual-de-usuario.md` | **Modificado**: §10.1 (la vista previa del catálogo es igual a la ficha: banner de progreso y temporadas en solo lectura con nota de la comunidad por episodio; aviso y «Añadir» al final) y §12 (página de título no añadido = ficha completa; sin botón «Volver» — ← o Esc; temporadas de solo lectura con fecha de estreno y nota TMDB por episodio) |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261011` |
| `index.html` | **Modificado**: 3 referencias `?v=` a `20261011` |
| `service-worker.js` | **Modificado**: 11 referencias `?v=` de `STATIC_ASSETS` a `20261011` |
| `docs/adr-113-unificacion-ficha-preview.md` | **Nuevo**: este documento |
| `tasks/task-issue-317.json` | Task file de la tarea |

Related issue: #317 — https://github.com/gonzalitojh/Registro-personal/issues/317