# ADR-108: Sección de premios en las fichas de películas y series (issue #302)

## Estado

Aceptado (iteración: premios desde la API y plataformas en su sitio)

## Fecha

2026-08-19

## Contexto

La issue #302 pide una **nueva sección «Premios»** en la ficha de
películas y series, y añade (comentario del 2026-08-19) dos
correcciones sobre la primera implementación:

1. **La sección de plataformas debe volver a su sitio**: estaba
   encima de la producción y bajo la sinopsis, y la primera
   implementación la dejó bajo el reparto. El orden correcto es
   `sinopsis → plataformas → premios → producción → reparto`.
2. **Los premios deben extraerse de la API** (no ser un dato que el
   usuario introduce): una sección que muestre los premios de los que
   dispone el ítem, bajo la sección de plataformas.

La issue indica además que el trabajo parte de la rama `feat/issue-201`
y que la PR irá a **esa misma rama** (no a `dev`), igual que las
issues #290-#298/#300.

Estado del código antes de esta iteración:

- La ficha de película/serie se renderiza en
  `openMovieModal`/`openTvModal` de `js/ui.js` (ADR-100/ADR-102/ADR-103),
  llamados desde `openMovieItem`/`openTvItem` de `js/modal-handlers.js`
  (con `isRerender` para no re-pedir detalles en los re-renders). La
  primera iteración de esta issue (PR #303) dejó el orden: cabecera
  `hero` → badge → valoraciones → `extraInfoHtml` (sinopsis / carruseles
  «Producción» y «Reparto» de `castCrewHtml`, issue #294) → premios
  editables (`awardsHtml` con formulario) → «Dónde verla»
  (`watchProvidersHtml`) → saga → recomendaciones → resto.
- **TMDB no expone premios en su API pública** (los premios existen solo
  en su web; el equipo de TMDB confirma que el endpoint de premios no
  tiene fecha de salida). Sin embargo, el endpoint `/external_ids` de
  TMDB sí publica el **identificador de Wikidata** del título
  (`wikidata_id`), y Wikidata (abierto, sin clave y con CORS habilitado
  en `query.wikidata.org/sparql`) modela los premios como declaraciones
  **P166 «award received»** con cualificadores P585 (fecha/ceremonia) y
  P1686 (obra por la que se concedió).
- La app es un registro personal con degradación elegante: los bloques
  no críticos de la ficha (watch providers, recomendaciones, saga) se
  cargan en paralelo y un fallo de red solo oculta su bloque.
- La ficha de solo lectura de un amigo (`openReadOnlyModal`, `js/ui.js`)
  y la vista previa de la página de ítem (`paintPreview`, `js/item-page.js`)
  muestran la misma información del título que la ficha (ADR-102).
- La versión PWA en la rama era `20261017`.

## Decisión

Sustituir la sección de premios **editable** de la primera iteración por
una sección de **solo lectura alimentada por la API de Wikidata**, y
devolver las plataformas a su posición original (bajo la sinopsis,
encima de la producción), colocando los premios justo debajo de las
plataformas. La decisión se organiza en seis puntos.

### 1. Datos: premios extraídos de Wikidata (P166), no del usuario

Nueva función `getItemAwards(type, externalId)` en `js/api-movies.js`
que devuelve `Array<{ name, year?, detail? }>` o `null`:

1. Consulta `/external_ids` de TMDB (cacheado 24 h, misma caché
   compartida de `api-movies.js`) para obtener `wikidata_id`.
2. Consulta el **endpoint SPARQL de Wikidata** (`query.wikidata.org`,
   público, sin clave, CORS abierto) con las declaraciones **P166**
   («award received») del ítem:
   - `name`: etiqueta del premio en español (o inglés si no hay
     traducción), resuelta con `wikibase:label`.
   - `year`: año de la ceremonia (cualificador P585, `YEAR(?date)`).
   - `detail`: obra por la que se concedió (cualificador P1686; se omite
     cuando la obra es el propio ítem, p. ej. el premio a la película
     entera — sí se muestra cuando es distinta, p. ej. el episodio
     premiado de una serie).
3. Fallbacks si `wikidata_id` no viene: la serie se busca por su id de
   TMDB (`wdt:P4983`) y la película por su IMDb id (`wdt:P345`, de
   `/external_ids`).
4. Normalización: deduplicación (mismo premio+año+obra puede repetirse
   con varios cualificadores), orden por año descendente y nombre. Los
   fallos de red, la ausencia de ítem en Wikidata o la ausencia de
   premios devuelven `null`/`[]` y la sección no se pinta (degradación
   elegante, misma política que los watch providers).

No se persiste nada en Firestore: los premios son información pública de
la API, idéntica para todos los usuarios (a diferencia de la primera
iteración, que guardaba un campo `awards` editable por usuario en el
documento del ítem). El campo `awards` del documento (si algún ítem de
la rama lo llegó a guardar) se ignora: la ficha siempre pinta los datos
de la API.

### 2. Render: `awardsHtml` de solo lectura en `js/ui.js`

`awardsHtml(item)` (nueva firma, sin callbacks) pinta la sección
**solo si `item.awards` trae elementos** (la ausencia de premios no
ocupa espacio, mismo criterio que «Dónde verla»): cabecera «Premios»
con contador `(N)`, y una fila por premio con nombre, año (monoespaciada)
y detalle. Sin formulario, sin botones y sin pista de vacío: no hay nada
que el usuario pueda añadir. Todo el contenido se escapa con
`escapeHtml`. Se elimina `wireAwards` (y sus llamadas), ya que no queda
interacción que cablear.

### 3. Orden de secciones: sinopsis → plataformas → premios → producción → reparto

Reorden en `openMovieModal`, `openTvModal`, `paintPreview` y
`openReadOnlyModal`:

`hero → badge → valoraciones → infoHtml (meta + sinopsis; vacío en modo
página, la sinopsis vive en el hero) → Dónde verla (watch providers) →
Premios → carruseles Producción/Reparto (castCrewHtml) → saga →
recomendaciones → resto`

Para separar los carruseles del resto de la información ampliada se
añade la opción `skipCarousels` a `extraInfoHtml`: la función devuelve
solo el bloque `.extra-info` (meta + sinopsis) y los carruseles se
renderizan aparte, `castCrewHtml(item)`, tras los premios. En modo
página `infoHtml` sigue vacío (hero + `skipCarousels` → "") y el orden
visual es: hero (con sinopsis) → plataformas → premios → producción →
reparto, exactamente el pedido. La preview (`paintPreview`) aplica el
mismo orden (ADR-102: misma información y misma disposición).

### 4. Carga: bloque no crítico en la ficha, preview y ficha de amigo

- `openMovieItem`/`openTvItem` (`js/modal-handlers.js`): consulta
  `getItemAwards` con try/catch antes del render (igual que los watch
  providers); `item.awards` queda con la lista o `null`. Se eliminan
  `saveAwards`, `onAddAward` y `onRemoveAward`.
- `loadPreviewExtras` (`js/item-page.js`): la consulta de premios se
  suma al `Promise.allSettled` de los bloques no críticos (dónde verla,
  recomendaciones, saga); un fallo degrada solo la sección.
- `openReadOnlyModal` (`js/ui.js`, ficha del amigo): consulta los
  premios con la clave del LECTOR (mismo patrón que `loadItemDetails`:
  se re-renderiza si la ficha sigue abierta cuando llegan; guardia
  `_awardsFetched` para no repetir la consulta).

### 5. Estilos: cuatro temas y responsividad (reglas 2 y 4 de AGENTS.md)

Bloque `.awards*` en `ocio/ocio.css` (podado de la primera iteración: se
eliminan `.awards__hint`, `.awards__remove`, `.awards__form` y
`.awards__input*`, que ya no existen):

- Título/contador/año/detalle con `--ink-soft` y el override documentado
  `[data-theme="dark"] .modal__card … { color: #5f5849 }` (mismo caso de
  contraste AA que `.cast-crew__title`, QA #294); el nombre del premio
  usa `color: inherit` porque el fondo difiere entre la página de ítem
  (`--ink` en familia oscura) y el modal clásico (`--paper`).
- Responsivo sin scroll horizontal: filas con `flex-wrap`, `min-width: 0`
  y `overflow-wrap: anywhere` en los textos; el año tiene
  `flex-shrink: 0` pero está acotado (mismo patrón que la primera
  iteración, que ya pasó QA en los cuatro temas).

### 6. Bump PWA

Cambian assets estáticos (CSS y JS): bump de la versión de despliegue a
`20260819` con `scripts/bump-version.sh` (ADR-019), coherente en
`js/config.js`, `index.html` y `service-worker.js`.

Related issue: #302 — https://github.com/gonzalitojh/Registro-personal/issues/302

## Alternativas consideradas

- **Mantener los premios editables por el usuario (primera iteración)**:
  descartada — el comentario de la issue pide explícitamente extraer los
  premios **de la API**, no un formulario.
- **Premios desde TMDB**: descartada — TMDB no expone premios en su API
  pública (solo en su web, sin endpoint planificado), pero su endpoint
  `/external_ids` sí publica el `wikidata_id` del título, que es la llave
  para Wikidata.
- **OMDb u otra API de premios**: descartada — requiere una clave API
  nueva (no disponible en el proyecto) y cobertura desigual (OMDb solo
  tiene un resumen de texto de premios para películas, prácticamente
  nada para series). Wikidata es pública, gratuita, sin clave, con CORS
  abierto y con cobertura de premios para películas **y** series.
- **Scraping de la web de TMDB**: descartado — frágil (cambios de
  estructura, bloqueos, CORS), fuera del modelo de la app.
- **Carruseles de producción/reparto antes de las plataformas (orden de
  la primera iteración)**: descartada — el comentario pide devolver las
  plataformas a su posición original (bajo la sinopsis, encima de la
  producción) y colocar los premios bajo ellas.
- **Sección de premios con estado de carga propio**: descartada — como
  los watch providers, la consulta se hace antes del render (ficha) o en
  paralelo (preview/amigo) y la sección aparece cuando los datos llegan;
  un esqueleto de carga no aporta nada con la caché de 24 h.

## Consecuencias

**Positivas:**

- La ficha muestra los premios reales del título **sin ningún esfuerzo
  del usuario** y sin depender de una clave nueva: Wikidata (P166) cubre
  películas y series con etiquetas en español.
- Las plataformas vuelven a su posición original y los premios quedan
  justo debajo (`sinopsis → plataformas → premios → producción →
  reparto`), exactamente como pide el comentario de la issue.
- Bloque no crítico con degradación elegante (fallo de red → la sección
  no se pinta), caché en memoria de 24 h compartida, y cero escrituras
  nuevas en Firestore (sin cambios en `firestore.rules`).
- La ficha, la preview y la ficha del amigo comparten `awardsHtml` y la
  misma consulta (`getItemAwards`), con el orden de secciones idéntico
  (ADR-102).

**Negativas / neutras:**

- **Dependencia externa nueva**: la sección requiere `query.wikidata.org`
  (SPARQL); si Wikidata no está disponible o el título no tiene ítem en
  Wikidata, la sección simplemente no aparece (degradación elegante). La
  cobertura de premios en Wikidata no es exhaustiva (sobre todo en
  títulos poco conocidos).
- **Solo lectura**: el usuario ya no puede anotar premios manualmente (era
  la naturaleza de la primera iteración); es el comportamiento pedido.
- **Los ítems legacy** con un campo `awards` guardado (de la primera
  iteración de esta rama, nunca fusionada) lo ven ignorado en favor de
  los datos de la API.
- **Consultas SPARQL**: la primera apertura de una ficha puede tardar
  algo más (Wikidata responde normalmente en <1-2 s); las siguientes van
  de caché (24 h en memoria por sesión).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: nueva `getItemAwards(type, externalId)` (external_ids de TMDB → SPARQL P166 de Wikidata, con fallbacks P4983/P345, normalización, dedupe, orden y caché 24 h; nunca lanza) |
| `js/ui.js` | **Modificado**: `awardsHtml(item)` ahora solo lectura (sección solo si hay premios; sin formulario ni botones); eliminado `wireAwards`; `extraInfoHtml` con la opción `skipCarousels`; reorden de `openMovieModal`/`openTvModal`/`openReadOnlyModal` a `infoHtml → watchProvidersHtml → awardsHtml → castCrewHtml`; la ficha de amigo consulta `getItemAwards` (patrón `loadItemDetails`, guardia `_awardsFetched`) |
| `js/modal-handlers.js` | **Modificado**: eliminados `saveAwards`/`onAddAward`/`onRemoveAward`; `openMovieItem`/`openTvItem` consultan `getItemAwards` (no crítico, try/catch) antes del render |
| `js/item-page.js` | **Modificado**: `loadPreviewExtras` consulta también `getItemAwards` (allSettled); `paintPreview` reordenada (plataformas y premios antes del bloque de producción/reparto) |
| `ocio/ocio.css` | **Modificado**: bloque `.awards` podado a solo lectura (se eliminan hint/formulario/inputs/«Quitar»); mantiene título/contador/lista/filas con el override documentado `[data-theme="dark"] .modal__card .awards__title/year/detail { color: #5f5849 }` y `.awards__name` con `color: inherit` |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificado**: bump PWA a `20260819` (ADR-019) |
| `docs/manual-de-usuario.md` | **Modificado**: §12 — bullet «Premios» reescrito (sección de solo lectura con premios extraídos de Wikidata: nombre, año y trabajo; si no hay premios la sección no aparece) y «Dónde verla» actualizado con su posición (tras la sinopsis, antes de premios/producción/reparto) |
| `tasks/task-issue-302.json` | **Modificado**: estado y criterios tras la iteración |
| `docs/adr-108-seccion-premios-fichas.md` | **Modificado**: este documento (iteración del ADR de la PR #303) |