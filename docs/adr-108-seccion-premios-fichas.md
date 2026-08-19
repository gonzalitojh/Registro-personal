# ADR-108: Sección de premios editable en las fichas de películas y series (issue #302)

## Estado

Aceptado

## Fecha

2026-08-19

## Contexto

La issue #302 pide una **nueva sección «Premios»** en la ficha de
películas y series, ubicada **entre la producción y las plataformas** en
las que está disponible el ítem (las dos secciones que ya existen en la
ficha: los carruseles de elenco «Producción»/«Reparto» de la issue #294 y
el bloque «Dónde verla» de watch providers). La issue indica además que
el trabajo parte de la rama `feat/issue-201` y que la PR irá a **esa
misma rama** (no a `dev`), igual que las issues #290-#298/#300.

Estado actual del código antes del cambio:

- La ficha de película/serie se renderiza en
  `openMovieModal`/`openTvModal` de `js/ui.js` (ADR-100/ADR-102/ADR-103),
  llamados desde `openMovieItem`/`openTvItem` de `js/modal-handlers.js`
  (con `isRerender` para no re-pedir detalles en los re-renders). El
  orden de bloques era: cabecera `hero` → badge → valoraciones →
  **`watchProvidersHtml`** («Dónde verla») → **`extraInfoHtml`** (con los
  carruseles «Producción» y «Reparto» de `castCrewHtml`, issue #294) →
  saga → recomendaciones → visionados/temporadas. La vista previa de la
  página de ítem (`paintPreview` de `js/item-page.js`) seguía el mismo
  orden (ADR-102: la preview muestra la misma información del título que
  la ficha).
- **TMDB no expone premios en su API pública** (los premios existen solo
  en su web; el equipo de TMDB confirma que el endpoint de premios no
  tiene fecha de salida). Otras fuentes (OMDb) requieren una clave API
  nueva y no están disponibles en este proyecto (js/config.js solo tiene
  claves de Firebase, TMDB, Google Books e IGDB vía proxy).
- La app es un **registro personal**: el usuario persiste sus propios
  datos (historial de visionados, valoración, notas, estados) en su
  documento de Firestore, con `ctx.updateItem` (`updateDoc` parcial,
  `js/db.js`) y reglas `firestore.rules` que permiten escribir solo al
  dueño sin validar campos concretos.
- La ficha de solo lectura de un amigo (`openReadOnlyModal`, `js/ui.js`)
  muestra también la ficha con el orden de secciones clásico.
- La versión PWA era `20261016` (último bump de la issue #298).

## Decisión

Añadir la sección **«Premios»** como **dato editable por el usuario**
(campo `awards` en el documento del ítem de película/serie), colocada
**entre la producción y las plataformas** reordenando los bloques de la
ficha. La decisión se organiza en seis puntos.

### 1. Datos: campo `awards` por ítem, editado por el usuario

Cada ítem de película o serie puede llevar un array `awards` con
entradas `{ name, year?, detail? }`:

- `name` (obligatorio, hasta 120 caracteres): nombre del premio
  (p. ej. «Óscar»).
- `year` (opcional, hasta 4 caracteres): año del premio.
- `detail` (opcional, hasta 240 caracteres): p. ej. «Mejor actriz».

Se persiste con `ctx.updateItem(uid, "movie"|"tv", item.id, { awards })`
(escritura parcial; las reglas de Firestore no cambian: solo el dueño
escribe). En memoria, `item.awards` se muta **solo tras persistir**
(patrón `onRewatch`). Los ítems legacy sin el campo se tratan como lista
vacía (`Array.isArray` guard). Las claves vacías se omiten al guardar
(Firestore no admite `undefined`).

### 2. Render: `awardsHtml` en `js/ui.js`, con dos modos

Nueva función exportada `awardsHtml(item, { onAddAward, onRemoveAward }
= {})`:

- **Ficha (con callbacks)**: la sección se muestra **siempre** — título
  «Premios», contador, lista de premios con su botón **«Quitar»**, pista
  «Aún no has anotado premios…» cuando está vacía, y formulario para
  añadir (nombre obligatorio + año/detalle opcionales, botón «Añadir
  premio»). Todo el contenido de usuario se escapa con `escapeHtml`.
- **Vista previa y ficha de amigo (sin callbacks)**: render **solo
  lectura** y únicamente si `item.awards` tiene elementos (los títulos
  del catálogo nunca traen premios, así que no ocupa espacio).

El cableado (`wireAwards`) gestiona el submit del formulario (trim,
validación nativa de `required`, deshabilitar el botón mientras
persiste) y los botones «Quitar» por índice, delegando la persistencia
y el re-render a los callbacks.

### 3. Orden de secciones: producción → premios → plataformas

En `openMovieModal`, `openTvModal` y `paintPreview` (y en
`openReadOnlyModal` por consistencia, manteniendo las plataformas de
videojuego en su sitio) se reordena el template:

`hero → badge → valoraciones → infoHtml (carruseles Producción/Reparto)
→ Premios → Dónde verla (watch providers) → saga → recomendaciones →
resto`

Interpretación literal de la petición «entre la producción y las
plataformas»: el usuario menciona primero la producción, así que el
orden final deja producción → premios → plataformas. La preview de la
página de ítem aplica el mismo orden (ADR-102: misma información y misma
disposición).

### 4. Persistencia: callbacks `onAddAward`/`onRemoveAward`

En `js/modal-handlers.js`, tanto `openMovieItem` como `openTvItem`
definen `saveAwards(awards)` y pasan a la UI:

- `onAddAward(award, btn)`: persiste `[...(item.awards ?? []), award]`,
  muta en memoria y hace `reopen()` (re-render con `isRerender`, sin
  re-pedir detalles).
- `onRemoveAward(index)`: persiste la lista sin ese índice y hace
  `reopen()`.
- En fallo: toast de error, botón restaurado y **sin** mutación en
  memoria. No hay confirmación de borrado (dato pequeño y recuperable,
  mismo patrón que quitar un visionado).

### 5. Estilos: cuatro temas y responsividad (reglas 2 y 4 de AGENTS.md)

Bloque `.awards*` en `ocio/ocio.css` siguiendo el patrón de sección de
`.cast-crew` (línea de separación con `--paper-line`):

- Título/cuentas con `--ink-soft` y el override documentado
  `[data-theme="dark"] .modal__card … { color: #5f5849 }` (mismo caso
  de contraste AA que `.cast-crew__title`, QA #294); el nombre del
  premio usa `color: inherit` porque el fondo difiere entre la página de
  ítem (`--ink` en familia oscura) y el modal clásico (`--paper`).
- Inputs con `font-size: 16px` (ADR-042), fondo `--white`, override
  `[data-theme="black"] .awards__input { color: var(--paper) }` (patrón
  `.field-group`).
- Responsivo sin scroll horizontal: filas y formulario con `flex-wrap`,
  `min-width: 0` y `overflow-wrap: anywhere` en los textos; el año tiene
  `flex-shrink: 0` pero está acotado.

### 6. Bump PWA

Cambian assets estáticos (CSS y JS): bump de la versión de despliegue a
`20261017` con `scripts/bump-version.sh` (ADR-019), coherente en
`js/config.js`, `index.html` y `service-worker.js`.

Related issue: #302 — https://github.com/gonzalitojh/Registro-personal/issues/302

## Alternativas consideradas

- **Premios automáticos desde TMDB**: descartada — TMDB no expone
  premios en su API pública (solo en su web, sin endpoint planificado).
  Añadir la sección dependiendo de un endpoint inexistente habría dejado
  la sección siempre vacía.
- **OMDb u otra API de premios**: descartada — requiere una clave API
  nueva (no disponible en el proyecto), cobertura desigual (OMDb solo
  tiene un resumen de texto de premios para películas, prácticamente
  nada para series) y un servicio externo más que mantener.
- **Scraping de Wikipedia/Wikidata**: descartado — frágil (cambios de
  estructura, bloqueos, CORS), fuera del modelo de la app y con
  resultados no fiables para series.
- **Sección de solo lectura sin edición**: descartada — sin fuente de
  datos no habría nada que mostrar; el modelo de registro personal
  (como notas o historial) encaja con que el usuario anote sus premios.
- **No reordenar la ficha** (insertar premios después de plataformas):
  descartada — la issue pide explícitamente la posición «entre la
  producción y las plataformas», que con el reorden queda producción →
  premios → plataformas.

## Consecuencias

**Positivas:**

- La ficha de película/serie adquiere la sección pedida, **sin depender
  de ninguna API nueva**: los premios son un dato del registro personal
  (mismo modelo que notas/visionados) y la sección siempre tiene
  contenido editable.
- Orden de secciones más «de ficha de cine» (producción → premios →
  dónde verla), alineado con la dirección IMDB-like de la rama
  `feat/issue-201` (issue #201).
- Un solo punto de render (`awardsHtml`) para ficha en página, modal
  clásico, preview y ficha de amigo; persistencia única por tipo
  (`saveAwards` + dos callbacks) con re-render sin re-pedir detalles.
- Todos los textos de usuario se escapan (`escapeHtml`), los cuatro
  modos de tema quedan cubiertos con el patrón de overrides agrupados y
  la responsividad sigue las reglas 2 y 4 de AGENTS.md.
- El manual de usuario queda alineado con el comportamiento real
  (regla 3 de AGENTS.md).

**Negativas / neutras:**

- **El mantenimiento es manual**: los premios no llegan solos de TMDB;
  el usuario debe anotarlos (es la naturaleza de un registro personal).
- **Reorden de la ficha**: «Dónde verla» baja de posición (pasa a
  aparecer tras producción/reparto y premios). Es el orden pedido por la
  issue, pero cambia la disposición que el usuario conocía.
- **Los ítems legacy** no tienen `awards`: la ficha los muestra con la
  sección vacía y el formulario (sin errores ni migración necesaria).
- **Sin validación de forma en Firestore**: el campo `awards` se escribe
  sin validación en las reglas, igual que el resto de campos del
  documento (watchLog, notas…); la UI construye siempre la forma
  esperada y sin claves controladas por el usuario (sin vector de
  prototype pollution).
- **La ficha de solo lectura del amigo muestra los premios del amigo**:
  coherente con el modelo de amistad del repo (la ficha del amigo ya
  muestra valoraciones, progreso e historial; cualquier usuario
  autorizado puede leer los documentos).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/ui.js` | **Modificado**: nuevo `awardsHtml(item, { onAddAward, onRemoveAward })` (sección «Premios»: cabecera con contador, lista con «Quitar», hint de vacío, formulario añadir con `escapeHtml` en todas las salidas; solo lectura y solo si hay premios sin callbacks) y `wireAwards(root, callbacks)` (submit con trim/validación/disable, botones Quitar por índice); reorden de `openMovieModal`/`openTvModal` a `infoHtml → awardsHtml → watchProvidersHtml` (desestructuración de `onAddAward`/`onRemoveAward`) y de `openReadOnlyModal` (premios solo lectura, plataformas tras la información ampliada, `gamePlatformsHtml` conservado antes de la info) |
| `js/modal-handlers.js` | **Modificado**: `saveAwards(awards)` en `openMovieItem` y `openTvItem` (persiste `{ awards }` y muta en memoria tras el await) + callbacks `onAddAward` (appenda y `reopen()`) y `onRemoveAward` (filtra por índice y `reopen()`), con toast de error y botón restaurado en fallo |
| `js/item-page.js` | **Modificado**: `paintPreview` con el mismo orden (watch providers después del bloque de detalles) y `awardsHtml(item)` solo lectura entre la información ampliada y «Dónde verla»; import de `awardsHtml` |
| `ocio/ocio.css` | **Modificado**: bloque `.awards` (título/contador/lista/filas/hint/formulario/inputs 16px con focus-visible); overrides documentados: `[data-theme="dark"] .modal__card .awards__title/year/detail/hint { color: #5f5849 }` (contraste AA, patrón QA #294) y `[data-theme="black"] .awards__input { color: var(--paper) }` (patrón `.field-group`); `.awards__name` con `color: inherit` documentado |
| `js/config.js`, `index.html`, `service-worker.js` | **Modificado**: bump PWA a `20261017` vía `scripts/bump-version.sh` (ADR-019) |
| `docs/manual-de-usuario.md` | **Modificado**: §12 — bullet «Premios» nuevo entre «Información ampliada» y «Dónde verla» (anotación personal, campos opcionales, botón Quitar; válido para películas y series) y «Dónde verla» actualizado con su nueva posición |
| `tasks/task-issue-302.json` | **Nuevo**: task file de la issue #302 |
| `docs/adr-108-seccion-premios-fichas.md` | **Nuevo**: este documento |