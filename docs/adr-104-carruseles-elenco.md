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

## Iteración (2026-08-18): scroll suave y buscador en la ventana de detalle

Tras la revisión del usuario (comentario en la issue #294) se aplican
dos ajustes de experiencia:

1. **Scroll de los carruseles más suave y rápido**: el
   `scroll-snap-type: x mandatory` original encajaba el carrusel en
   cada tarjeta al soltar el gesto, haciendo que un arrastre rápido se
   quedase «pegado» a la tarjeta siguiente (avance lento y a tirones).
   Se cambia a **`x proximity`**: el carrusel solo encaja cuando el
   gesto termina cerca del borde de una tarjeta, de modo que el
   impulso del arrastre/rueda recorre varias tarjetas y el avance es
   más fluido. Se añade además `overscroll-behavior-x: contain` para
   que el rebote del gesto no arrastre la página. Decisión estética de
   producto, sin impacto en el render ni en la accesibilidad (el
   carrusel sigue siendo un `overflow-x: auto` con teclado).

2. **Buscador (lupa) en la ventana «Ver en más detalle»**: un input
   con icono de lupa en la parte superior de `#cast-modal` filtra la
   lista **al teclear** (sin recargar la ventana) por el **nombre** de
   la persona y por su **personaje** (en el reparto) o su **función**
   —`job` y área/departamento— (en la producción). El filtro se aplica
   sobre las entradas sin agrupar y el crew se reagrupa por áreas tras
   filtrar, reutilizando `groupCrewByDepartment`; si no hay
   coincidencias se muestra «No hay resultados para «…»». La tecla
   **Esc** con texto en el campo **limpia la búsqueda** (sin propagar
   al handler global que cerraría la ventana); con el campo vacío, Esc
   cierra la ventana como siempre. El input sigue el patrón visual de
   `.global-search__input` (`--ink-raised`/`--paper`) con el mismo
   override de tinta para la familia clara
   (`[data-theme="light"/"white"] .cast-modal__search-input { color: var(--ink) }`,
   ver `css/styles.css` para `.global-search__input`).

No cambia el modelo de datos ni las llamadas a TMDB: todo es
transformación local de los datos ya cargados. La versión PWA sube a
`20261007` para invalidar las cachés del precache.

## Iteración 2 (2026-08-18): desplazamiento inercial en los carruseles

El usuario vuelve a reportar que el scroll «sigue atascándose»: pese a
`x proximity`, el carrusel se seguía encajando en las tarjetas al
terminar el gesto (el snap es la causa del «atascado» percibido) y con
la rueda del ratón el scroll nativo avanza a saltos, sin inercia.

1. **Se elimina el `scroll-snap-type`** de `.cast-crew__scroll` (y el
   `scroll-snap-align: start` de `.cast-card`): nada de encaje de
   tarjetas. En **táctil**, el impulso nativo del navegador
   (`-webkit-overflow-scrolling: touch` se mantiene) desliza y frena
   solo, que es el desplazamiento inercial que se pide.
2. **Inercia propia para la rueda del ratón** (`wireCastCrewInertialScroll`
   en `js/ui.js`, cableado desde `wireCastCrewClicks`): el gesto de
   rueda se normaliza a píxeles (líneas → 16 px, páginas → ancho del
   carrusel) y se **amplifica ×1.7** (un gesto recorre varias tarjetas);
   un bucle `requestAnimationFrame` continúa el deslizamiento con
   **fricción** (`×0.93` por frame, corta en seco al llegar a un borde)
   hasta frenar. La velocidad del impulso se mezcla con la anterior
   (`45 %`) para suavizar las ráfagas del trackpad.
3. **El gesto no se traga el scroll de la página**: el `wheel` solo se
   consume cuando el carrusel tiene recorrido en la dirección del gesto;
   en un borde, el evento pasa y la página hace su scroll vertical
   natural (`overscroll-behavior-x: contain` sigue evitando el rebote
   horizontal).

Accesibilidad intacta: el carrusel sigue siendo un `overflow-x: auto`
(navegable igual que antes de esta iteración: el snap no aportaba
teclado) y el scroll inercial es una mejora progresiva que no interfiere
con táctil. La versión PWA sube a `20261008` para invalidar las cachés
del precache.

## Iteración 3 (2026-08-19): rueda del ratón proporcionada en PC (issue #305)

El usuario reporta que en PC «al mover ligeramente la rueda del ratón [el
carrusel] desplaza media lista de un golpe» (móvil/tablet siguen
perfectos con la inercia nativa del navegador). La causa: la iteración 2
amplificaba **todos** los deltas de rueda ×1.7 y arrancaba el bucle de
inercia rAF (fricción ×0.93/frame). Para una muesca típica de
Windows/Chrome (deltaY ≈ 100 px, deltaMode 0) esto suponía:

1. Avance inmediato = 100 × 1.7 = **170 px**.
2. Inercia posterior ≈ 170 × 0.55 / (1 − 0.93) ≈ **1335 px** (la
   velocidad inicial se mezcla al 55 % y el bucle la añade cada frame
   con fricción 0.93).
3. Total ≈ **1500 px ≈ media lista** del modal ancho en un solo toque.

Solución — dos regímenes según el emisor del gesto, sin tocar el CSS:

1. **Muesca de ratón** (deltaMode 1 (líneas) o 2 (páginas), o deltaMode 0
   con magnitud ≥ 40 px): avance **proporcionado y sin inercia**. El
   delta se aplica 1:1 acotado a `NOTCH_MAX = 120 px` (≈ 1 tarjeta de
   96 px + gap 0.6rem) y **antes** se ejecuta `stop()` para cortar
   cualquier inercia previa de trackpad (la muesca aterriza en una
   posición limpia). En modo página (deltaMode 2) avanza un
   `clientWidth` completo, como haría el navegador. `velocity` no se
   toca y el rAF no arranca: cada toque de rueda mueve ~1 tarjeta y se
   detiene.
2. **Trackpad** (deltaMode 0 con deltas pequeños y continuos < 40 px):
   comportamiento idéntico a la iteración 2 — impulso amplificado ×1.7,
   mezcla de velocidades y bucle rAF con fricción — para conservar el
   deslizamiento suave con frenado progresivo que pedía la propia issue
   #294.

El resto del manejo no cambia: la selección de eje dominante
(|deltaX| > |deltaY|), el cortocircuito `|raw| < 0.5`, el retorno si el
carrusel no tiene recorrido (`max <= 0`) y la no-consumición del gesto en
un borde (la página hace su scroll vertical) se mantienen en ambos
regímenes. Accesibilidad intacta: `overflow-x: auto` sigue dejando el
carrusel navegable por teclado, y el táctil no pasa por este manejador
(`wheel` es de ratón/trackpad), por lo que C2 queda garantizada sin
tocar CSS. En macOS, una ráfaga de momentum del trackpad con deltas ≥
40 px se trata como muesca (corta el glide): aceptado; si resultara
brusco en una prueba real, el ajuste es de una constante
(`NOTCH_MIN` → 60). La versión PWA sube a `20260825` para invalidar las
cachés del precache (20260824 lo usa la rama de la issue #304).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/cast-modal.js` | **Nuevo**: ventana «Ver en más detalle» de producción/reparto (`.modal--top` + `.modal__card--wide`, patrón ADR-022): focus trap, cierre ✕/backdrop/Escape con restauración de foco; reparto en lista (foto, nombre, personaje); producción agrupada por áreas (departamentos traducidos al español, `DEPARTMENT_ORDER` estable, puestos fusionados «Director, Guionista»); `safePhotoUrl` (solo `https:`/`data:image/*`) y silueta SVG de fallback; `openCastModal`/`closeCastModal`. **Iteración**: buscador con lupa (`filterPeopleByQuery` por nombre + personaje/función/departamento, re-render local del listado, Esc limpia el filtro) |
| `js/api-movies.js` | **Modificado**: `mapCastPerson`/`mapCrewPerson` (`{id, name, character\|job, department, profileUrl, order}`) y `mergeCreatorsIntoCrew` (creadores de series como área «Creadores», `order: -1`, sin duplicar); `getMovieDetails`/`getTvExtraDetails` mapean **cast y crew completos** en vez de 5 strings; `IMG_PERSON` (w185) — sin llamadas API nuevas, caché de 24 h intacta |
| `js/ui.js` | **Modificado**: `castCrewHtml`/`castCrewSectionHtml` (carruseles «Producción» y «Reparto» con tarjeta `.cast-card`: foto, nombre, personaje/puesto; botón `.cast-crew__more` «Ver en más detalle»), normalización del cast legacy (strings), `wireCastCrewClicks` (cableado de los botones a `openCastModal`) y render en modal clásico, página de ítem, preview de búsqueda y ficha de amigo. **Iteración 2**: `wireCastCrewInertialScroll` (inercia para la rueda: delta normalizado a px y amplificado ×1.7, bucle rAF con fricción ×0.93/frame, consumo del gesto solo si el carrusel tiene recorrido) cableado desde `wireCastCrewClicks`. **Iteración 3**: dos regímenes en `wireCastCrewInertialScroll` — muesca de ratón (deltaMode ≠ 0 o magnitud ≥ 40 px): avance 1:1 acotado a 120 px (~1 tarjeta) con `stop()` previo y sin inercia; trackpad (deltas < 40 px): amplificación ×1.7 + inercia como antes |
| `js/item-page.js` | **Modificado**: `crew` en `buildPreviewItem` y `wireCastCrewClicks` en `paintPreview` (carruseles en la preview de la página de ítem, render inicial y tras enrich) |
| `js/modal-handlers.js` | **Modificado**: cierre de la ventana de elenco integrado en `setupModalCloseListeners` (✕, backdrop y Escape, patrón `closeActiveModal` del ADR-096) |
| `js/constants.js` | **Modificado**: `"crew"` añadido a `ON_DEMAND_DETAIL_FIELDS` (la migración existente lo poda de documentos viejos) |
| `index.html` | **Modificado**: marcado de la ventana `#cast-modal` y bump PWA a `20261006` (iteración: `20261007`; iteración 2: `20261008`). **Iteración 3**: bump PWA a `20260825` |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261006` (iteración: `20261007`; iteración 2: `20261008`). **Iteración 3**: `APP_VERSION` a `20260825` |
| `service-worker.js` | **Modificado**: `js/cast-modal.js` en `STATIC_ASSETS` y bump PWA a `20261006` (iteración: `20261007`; iteración 2: `20261008`). **Iteración 3**: bump PWA a `20260825` |
| `css/styles.css` | **Modificado**: `.cast-card` incluida en el override oscuro de `--ink` de `.item-view` |
| `ocio/ocio.css` | **Modificado**: carruseles `.cast-crew`/`.cast-card` (tarjetas flex 96 px, 84 px ≤400 px, scroll horizontal solo en `.cast-crew__scroll`, `overflow-wrap`), ventana `.cast-modal`, hint/personaje con contraste AA (base `#5f5849` en familia oscura, `--ink-soft` restaurado en negro puro/claro/blanco puro con selectores agrupados). **Iteración**: `scroll-snap-type: x proximity` + `overscroll-behavior-x: contain` en `.cast-crew__scroll` (scroll suave y rápido) y buscador `.cast-modal__search` (lupa SVG + input, patrón `.global-search__input`, con override de tinta `--ink` para la familia clara). **Iteración 2**: sin `scroll-snap-type` ni `scroll-snap-align` (desplazamiento inercial, nada de encaje) manteniendo `-webkit-overflow-scrolling: touch` y `overscroll-behavior-x: contain` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 12, bullet «Información ampliada» con los carruseles y la ventana de detalle; términos «director/reparto» adecuados en los bullets «Sagas», «Recomendaciones» y en la vista previa del catálogo (sección 10). **Iteración**: scroll suave y buscador (lupa) de la ventana de detalle. **Iteración 2**: el bullet describe el desplazamiento inercial de los carruseles (continúan deslizándose y frenan poco a poco, sin encaje en tarjetas). **Iteración 3**: el bullet diferencia el gesto — dedo (inercia nativa), trackpad (frenado suave) y rueda del ratón en PC (una tarjeta o menos por toque, sin saltarse medio listado) |
| `docs/adr-104-carruseles-elenco.md` | **Nuevo**: este documento |
| `tasks/task-issue-294.json` | Task file de la tarea |
| `tasks/task-issue-305.json` | Task file de la iteración 3 |

Related issue: #294 — https://github.com/gonzalitojh/Registro-personal/issues/294
Related issue (iteración 3): #305 — https://github.com/gonzalitojh/Registro-personal/issues/305