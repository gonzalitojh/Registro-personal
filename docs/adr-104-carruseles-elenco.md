# ADR-104: Carruseles de elenco (producción y reparto) en la ficha de películas y series (issue #294)

## Estado

Aceptado

## Fecha

2026-08-18

## Contexto

La issue #294 pide sustituir el **elenco en líneas de texto** de la
ficha de películas y series por **carruseles con fotos**: «En lugar de
poner el creador y reparto y breve información del elenco de la
película/serie, hacer un carrousel con todos las personas involucradas,
con fotografía, nombre y en el caso de los actores, nombre del
personaje. Debería haber de momento dos carrousel, uno para miembros de
la producción (director, guionista, compositor, etc) y otro para
actores y actrices. En ambos casos debe haber un botón para verlo en más
detalle que despliegue una ventana con todas las personas de esa lista
en particular en forma de lista y mayor detalle de cada una, organizados
además (en el caso de los miembros de la producción) por áreas».

Estado actual del código antes del cambio:

- La ficha de películas y series (modal clásico, página de ítem del
  ADR-100, preview de búsqueda y ficha de amigo) mostraba **director
  (películas), creadores (series) y reparto como líneas de texto
  breves** en la «información ampliada»: «Director: X»,
  «Creadores: Y» y «Reparto: A, B, C, D, E» — **solo 5 nombres**, sin
  fotos, sin personajes y sin el resto del equipo técnico
  (guionistas, compositores, montaje, cámara...).
- `getMovieDetails`/`getTvExtraDetails` ya pedían
  `append_to_response=credits` a TMDB (ADR-009, ADR-074), pero el
  mapeo **descartaba casi toda la respuesta**: del cast solo se
  guardaban `slice(0, 5).map(c => c.name)` (5 strings), del crew nada,
  y el `order` de facturación de TMDB se perdía.
- El cast se persistía como array de strings en los documentos de
  Firestore (`ON_DEMAND_DETAIL_FIELDS`, almacenamiento mínimo del
  ADR-073/ADR-093); no existía campo `crew` en el modelo.

Related issue: #294 — https://github.com/gonzalitojh/Registro-personal/issues/294

## Decisión

Sustituir las líneas de texto de director/creadores/reparto por **dos
carruseles deslizables en horizontal** — «Producción» y «Reparto» — con
**una tarjeta por persona** (foto, nombre y personaje/puesto), y añadir
en cada carrusel el botón **«Ver en más detalle»** que abre una
**ventana modal con la lista completa** de ese carrusel (el reparto en
una sola lista; la producción **agrupada por áreas**):

1. **Dos carruseles por título** (`castCrewHtml` y
   `castCrewSectionHtml` en `js/ui.js`):
   - **«Producción»**: el `crew` completo de TMDB (director, guionista,
     compositor, etc.), ordenado por área y `order` dentro de cada área.
   - **«Reparto»**: los actores/actrices en el **orden de facturación**
     de TMDB (`order`), cada tarjeta con el **personaje**.
   - Cada persona es una tarjeta `.cast-card` con **foto** (w185 de
     TMDB, `IMG_PERSON`, mismo patrón de tamaño alternativo que las
     colecciones), **nombre** y **personaje** (reparto) o **puesto**
     (producción). Sin `profile_path` → **fallback silueta SVG**
     (`PLACEHOLDER_PERSON_COVER`, `data:image/svg+xml`), nunca imagen
     rota.
   - El desplazamiento horizontal es **solo dentro de
     `.cast-crew__scroll`** (regla 2 de AGENTS.md): la página no
     produce scroll horizontal en ningún ancho.

2. **Ventana «Ver en más detalle»** (`js/cast-modal.js`, nueva):
   - Cada carrusel tiene su botón **«Ver en más detalle»**
     (`cast-crew__more`, `data-cast-role="crew"|"cast"`) que abre la
     ventana **con TODAS las personas** de esa lista.
   - La ventana **reutiliza el patrón del modal de valoración**
     (ADR-022): `.modal--top` + `.modal__card--wide`, con **focus
     trap**, cierre por **✕ / backdrop / Escape** y **restauración de
     foco** al botón que la abrió. El cierre por ✕/backdrop/Escape se
     integra en `setupModalCloseListeners` (`js/modal-handlers.js`,
     patrón `closeActiveModal` del ADR-096).
   - **Reparto**: una sola lista con foto, nombre y **personaje**,
     ordenada por facturación.
   - **Producción**: agrupada por **áreas** (traducción de los
     `department` de TMDB al español: Dirección, Guion, Producción,
     Sonido, Cámara, Montaje, Arte, Vestuario y maquillaje, Iluminación,
     Efectos visuales, Efectos especiales, Equipo técnico,
     Interpretación y, en series, Creadores), con **orden estable**
     (`DEPARTMENT_ORDER`; áreas desconocidas van después, alfabéticas)
     y **puestos de una misma persona fusionados** en una sola fila
     («Director, Guionista»), manteniendo `order` de TMDB dentro de
     cada área.

3. **Datos completos de TMDB sin coste extra**: `getMovieDetails` y
   `getTvExtraDetails` ya pedían `append_to_response=credits`; ahora
   mapean el **cast y el crew completos** como objetos
   `{id, name, character|job, department, profileUrl, order}` en lugar
   de 5 strings (`mapCastPerson`/`mapCrewPerson` en `js/api-movies.js`).
   En **series**, los creadores (`created_by`) se incorporan al crew
   como área **«Creadores»** al principio (`mergeCreatorsIntoCrew`,
   `order: -1`, sin duplicar por id; el campo `creators` se conserva
   por compatibilidad). **Cero llamadas API nuevas**; aplica la caché
   en memoria de 24 h existente (la compartida con los watch
   providers, ADR-009). Compatibilidad con documentos previos: el
   **cast legacy** (array de strings) **se normaliza** en el render y
   en la ventana; `crew` se añade a `ON_DEMAND_DETAIL_FIELDS`
   (`js/constants.js`) y **la migración existente lo poda** de los
   documentos viejos que no lo tienen.

4. **Puntos de render**: los carruseles se muestran en **todos** los
   puntos donde se pintaba el elenco: modal clásico
   (`openMovieModal`/`openTvModal`/`openReadOnlyModal`), **página de
   ítem** (ficha y preview, `item-page.js` con `crew` en
   `buildPreviewItem` y `wireCastCrewClicks` en `paintPreview`),
   **preview de búsqueda** (`openSearchPreviewModal`, render inicial y
   tras el enrich) y **ficha de amigo**. **Libros y videojuegos no se
   afectan** (sin carruseles: sus fichas conservan sus campos propios).

5. **Responsividad** (regla 2 de AGENTS.md): tarjetas `flex: 0 0
   96px` (84 px en pantallas ≤400 px), `overflow-wrap: anywhere` en
   los nombres, unidades relativas; el **único** scroll horizontal es
   el de `.cast-crew__scroll`. Verificado en 360/768/1280 px:
   `document.documentElement.scrollWidth <= window.innerWidth`.

6. **Temas: contraste AA en los cuatro modos** (regla 4 de AGENTS.md):
   los textos secundarios de las tarjetas (personaje/puesto) usan el
   **hex `#5f5849` hardcodeado** por defecto (~5.1:1 sobre las
   superficies oscuras), con **comentario que explica por qué no usa
   variable** (mismo patrón que `.rec-card__hint` del ADR-096), y un
   **override agrupado** (selectores por comas `[data-theme="black"]`,
   `[data-theme="light"]`, `[data-theme="white"]`) que restaura
   `var(--ink-soft)` en negro puro, claro y blanco puro. El título de
   la ventana en tema oscuro añade su propio override (`#5f5849` base,
   `--ink-soft` restaurado). La tarjeta `.cast-card` dentro de
   `.item-view` se incluye en el override oscuro existente de `--ink`
   (`css/styles.css`).

7. **Seguridad**: `escapeHtml` en **todos** los datos que entran en el
   DOM (nombres, puestos, personajes, títulos de área); `safePhotoUrl`
   (`js/cast-modal.js`) **sanea el `src` de las fotos** (solo
   `https:` y `data:image/*`; cualquier otra cosa → placeholder
   silueta); sin secrets (escaneo CLEAR sin hallazgos HIGH).

8. **PWA**: `js/cast-modal.js` se añade a los `STATIC_ASSETS` del
   service worker y la **versión se incrementa a `20261006`**
   (`js/config.js`, `index.html` y `service-worker.js`), de modo que
   el precache y las URLs versionadas invalidan las cachés antiguas.

## Alternativas descartadas

- **Listas estáticas ampliadas (mostrar todo el elenco como texto en
  la propia ficha)**: alarga la ficha hasta hacerla inmanejable en
  títulos con mucho reparto, mantiene el problema visual que la issue
  pide resolver y no hay fotos: la petición explícita del usuario es
  el carrusel con fotografía.
- **Enlaces externos a TMDB (ficha de la persona fuera de la web)**:
  saca al usuario de la aplicación, rompe la experiencia de la ficha y
  deja de funcionar con la caché/offline; además TMDB no garantiza
  página propia para todas las personas del crédito. La ventana
  interna con los datos ya disponibles (TMDB devuelve toda la info en
  `credits`) no añade coste ni dependencias externas.
- **Expansión desplegable de la lista en la propia ficha (sin
  ventana)**: inventa una interacción nueva sin patrón de
  accesibilidad probado en el proyecto; en cambio, el modal clásico
  (`.modal--top` + `.modal__card--wide` del rating modal, ADR-022) ya
  tiene focus trap, cierre por ✕/backdrop/Escape y restauración de
  foco implementados y validados — reutilizarlo no añade superficies
  de interacción nuevas.

## Consecuencias

**Positivas:**

- La ficha de películas y series muestra el elenco **de un vistazo y
  con fotos**: producción y reparto en carruseles con tarjeta por
  persona (foto, nombre, personaje/puesto), en lugar de líneas de
  texto con solo 5 nombres.
- **Toda la información disponible**: la ventana «Ver en más detalle»
  lista **todas** las personas; la producción, **agrupada por áreas**
  con nombre en español, orden estable y puestos fusionados por
  persona.
- **Cero coste de API extra**: los `credits` ya se pedían con
  `append_to_response`; solo cambia el mapeo, y la caché de 24 h
  existente se mantiene intacta.
- **Reutilización**: el modal reutiliza el patrón del rating modal
  (focus trap, cierres, restauración de foco) y el hint AA el patrón
  `.rec-card__hint` del ADR-096; no se duplican mecánicas.
- Compatibilidad con el modelo de datos existente: cast legacy
  normalizado, `crew` podado por la migración existente, creadores
  conservados en su campo por compat.

**Negativas / neutras:**

- **Más código en la ficha**: dos secciones nuevas de render (los
  carruseles) más la ventana (`js/cast-modal.js`, ~260 líneas) y su
  wiring en todos los puntos de render.
- **Dos superficies nuevas que mantener en los cuatro modos de tema**
  (carruseles y ventana): cada cambio de tema o de paleta debe
  verificarlas (el contraste AA ya está resuelto, pero es superficie
  adicional bajo la regla 4 de AGENTS.md).
- El array de cast deja de ser `string[]` y pasa a ser objetos: los
  **documentos previos** necesitan la normalización legacy (cubierta) y
  el nuevo campo `crew` solo existe tras la siguiente consulta de
  detalles (la migración lo poda hasta entonces, sin romper nada).
- Versión PWA bumped a `20261006`: un precache/recarga adicional para
  los usuarios al desplegar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/cast-modal.js` | **Nuevo**: ventana «Ver en más detalle» de producción/reparto (`.modal--top` + `.modal__card--wide`, patrón ADR-022): focus trap, cierre ✕/backdrop/Escape con restauración de foco; reparto en lista (foto, nombre, personaje); producción agrupada por áreas (departamentos traducidos al español, `DEPARTMENT_ORDER` estable, puestos fusionados «Director, Guionista»); `safePhotoUrl` (solo `https:`/`data:image/*`) y silueta SVG de fallback; `openCastModal`/`closeCastModal` |
| `js/api-movies.js` | **Modificado**: `mapCastPerson`/`mapCrewPerson` (`{id, name, character\|job, department, profileUrl, order}`) y `mergeCreatorsIntoCrew` (creadores de series como área «Creadores», `order: -1`, sin duplicar); `getMovieDetails`/`getTvExtraDetails` mapean **cast y crew completos** en vez de 5 strings; `IMG_PERSON` (w185) — sin llamadas API nuevas, caché de 24 h intacta |
| `js/ui.js` | **Modificado**: `castCrewHtml`/`castCrewSectionHtml` (carruseles «Producción» y «Reparto» con tarjeta `.cast-card`: foto, nombre, personaje/puesto; botón `.cast-crew__more` «Ver en más detalle»), normalización del cast legacy (strings), `wireCastCrewClicks` (cableado de los botones a `openCastModal`) y render en modal clásico, página de ítem, preview de búsqueda y ficha de amigo |
| `js/item-page.js` | **Modificado**: `crew` en `buildPreviewItem` y `wireCastCrewClicks` en `paintPreview` (carruseles en la preview de la página de ítem, render inicial y tras enrich) |
| `js/modal-handlers.js` | **Modificado**: cierre de la ventana de elenco integrado en `setupModalCloseListeners` (✕, backdrop y Escape, patrón `closeActiveModal` del ADR-096) |
| `js/constants.js` | **Modificado**: `"crew"` añadido a `ON_DEMAND_DETAIL_FIELDS` (la migración existente lo poda de documentos viejos) |
| `index.html` | **Modificado**: marcado de la ventana `#cast-modal` y bump PWA a `20261006` |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261006` |
| `service-worker.js` | **Modificado**: `js/cast-modal.js` en `STATIC_ASSETS` y bump PWA a `20261006` |
| `css/styles.css` | **Modificado**: `.cast-card` incluida en el override oscuro de `--ink` de `.item-view` |
| `ocio/ocio.css` | **Modificado**: carruseles `.cast-crew`/`.cast-card` (tarjetas flex 96 px, 84 px ≤400 px, scroll horizontal solo en `.cast-crew__scroll`, `overflow-wrap`), ventana `.cast-modal`, hint/personaje con contraste AA (base `#5f5849` en familia oscura, `--ink-soft` restaurado en negro puro/claro/blanco puro con selectores agrupados) |
| `docs/manual-de-usuario.md` | **Modificado**: sección 12, bullet «Información ampliada» con los carruseles y la ventana de detalle; términos «director/reparto» adecuados en los bullets «Sagas», «Recomendaciones» y en la vista previa del catálogo (sección 10) |
| `docs/adr-104-carruseles-elenco.md` | **Nuevo**: este documento |
| `tasks/task-issue-294.json` | Task file de la tarea |

Related issue: #294 — https://github.com/gonzalitojh/Registro-personal/issues/294