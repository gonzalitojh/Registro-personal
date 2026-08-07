# ADR-048: Visualización de amigos por pestañas y filtros de estado (issue #49)

## Estado
Aceptado (revisado en iteración 2: filtros de películas reducidos)

## Fecha
2026-08-07

## Contexto

El detalle de amigo de la sección **Amigos** del perfil mostraba las tres
categorías (Películas, Series y Libros) apiladas verticalmente en una sola
página de scroll. Con un registro grande, el scroll vertical resultaba muy
largo y poco usable (issue #49, `type: style`).

La issue pide organizar la visualización de otra forma: **por pestañas**
(más similar a la vista del propio perfil) y con **filtros de estado**
(explícitamente sin búsqueda: «no hace falta búsqueda, pero sí filtros de
estados»).

Related issue: #49 — https://github.com/gonzalitojh/Registro-personal/issues/49

## Decisión

### 1. Subpestañas tipo pill (Películas / Series / Libros)

El detalle de amigo pasa a mostrar **una sola categoría a la vez** mediante
subpestañas tipo pill, replicando el patrón visual de `.profile-subtab` del
propio perfil:

- **Clases propias** `.friend-subtabs` / `.friend-subtab` para evitar
  colisiones: reutilizar `.profile-subtab` dentro de `#friend-detail`
  colisionaría con `openProfileSection` (profile.js), que recorre el
  NodeList `profileSubtabs` (profile.js:151) para el toggle de secciones
  (profile.js:263-267) y bindea sobre él los clicks de apertura
  (profile.js:412-416).
- El **CSS de las pills se comparte** con `.profile-subtab` mediante
  selectores en coma (`.profile-subtab, .friend-subtab { ... }`), incluida
  la compactación de la media query `max-width: 480px`.

### 2. Filtros por estado (chips, sin búsqueda)

Bajo cada pestaña hay un grupo de **chips de filtro por estado**. El
conjunto varía por scope y **en películas coincide con la vista personal**
(`ocio/peliculas.html`, que solo ofrece Todos / Pendiente / Vista):

- **Películas**: Todos + Pendiente + Vista (completado). Sin Viendo,
  Standby ni Abandonada — igual que en la vista personal (requisito añadido
  en la iteración 2, comentario de gonzalitojh del 2026-08-07).
- **Series**: Todos + pendiente + en_curso + completado + standby + abandonado.
- **Libros**: Todos + pendiente + en_curso + completado + standby + abandonado.

- Etiquetas según el scope:
  - media (películas/series): Pendiente / Viendo / Vista / Standby / Abandonada.
  - book (libros): Pendiente / Leyendo / Leído / Standby / Abandonado.
- Clases propias `.friend-filters` / `.friend-chip`: no se reutilizan
  `.filter-chips` ni `.chip` porque la lógica global de filtros de las
  bibliotecas los selecciona por clase y les bindea clicks con el scope de
  cada grupo (app.js:218-227).

### 3. Estado en memoria y re-render del grid activo

- El estado vive en el closure de `setupProfile`:
  `friendData {movies, tv, books}`, `friendFilters {movies:"todos", ...}`,
  `friendActiveTab = "movies"` y `currentFriendName`.
- Al abrir cualquier amigo se **resetea** pestaña a `movies` y filtros a
  `todos` (estado y chips del DOM).
- Los datos se cargan **una sola vez** con `Promise.all` de
  `getItemsOnce(uid, "movie"|"tv"|"book")`; al cambiar de pestaña o de chip
  solo se **re-renderiza el grid activo** sin re-consultar Firestore.
- Al cambiar de pestaña se conserva el filtro elegido en memoria hasta que
  se abre otro amigo (entonces se restablece).

### 4. Accesibilidad (ARIA)

- Pills: `role="tablist"` / `role="tab"` / `role="tabpanel"` con
  `aria-selected`, `aria-controls` y `aria-labelledby`.
- Chips: contenedor `role="group"` con `aria-label` descriptivo por panel y
  botones con `aria-pressed`.

### 5. Mensajes de vacío diferenciados

- Categoría sin ítems → «Nada por aquí todavía.»
- Filtro sin resultados → «No hay nada con ese estado.»

### 6. Responsividad

- `flex-wrap` en pills y chips; unidades relativas (rem); sin scroll
  horizontal en 360/768/1280 px (regla 2 de AGENTS.md); sin
  `overflow-x: hidden` en body/html.

## Alternativas descartadas

- **Scroll infinito**: no resuelve el problema de fondo (navegar por el
  registro completo del amigo) y añade complejidad de paginación sin
  necesidad.
- **Acordeón (desplegar/plegar categorías)**: interacción menos directa que
  las pestañas y peor para ver dos categorías seguidas; el perfil propio ya
  establece el patrón de subpestañas.
- **Búsqueda de texto**: la issue la descarta explícitamente («no hace falta
  búsqueda, pero sí filtros de estados»); además los registros de amigos son
  de solo lectura y las tarjetas ya muestran título/autor.
- **Reutilizar `.filter-chips` / `.chip`**: descartado — colisionan con la
  lógica global de filtros de las bibliotecas (app.js:218-227 recorre
  `.filter-chips` y bindea clicks en `.chip`); se usan clases propias
  `.friend-filters` / `.friend-chip`.
- **Reutilizar `.profile-subtab` en el detalle de amigo**: descartado —
  `profileSubtabs` (profile.js:151) recoge TODOS los `.profile-subtab`;
  `openProfileSection` les hace toggle de `is-active`/`aria-selected` por
  `data-section` (profile.js:263-267) y les bindea la apertura de sección
  (profile.js:412-416); inyectar pills de amigo con esa clase rompería el
  toggle de secciones. Por eso las pills de amigo son `.friend-subtab` y
  **comparten CSS** con `.profile-subtab` por selectores en coma (no lógica).

## Consecuencias

### Positivas

- Scroll vertical del detalle de amigo reducido a una categoría.
- Filtros por estado con etiquetas adaptadas al scope (media/book) sin
  búsqueda, tal y como pide la issue.
- En películas solo se ofrecen los filtros **Todos / Pendiente / Vista**,
  igual que en la vista personal del usuario: un amigo no puede filtrar
  películas por «Viendo», «Standby» ni «Abandonada», que son estados
  inexistentes para películas en este producto.
- Cero consultas extra a Firestore al cambiar pestaña/filtro (los datos se
  cargan una vez por amigo abierto).
- Coherencia visual con el perfil propio (mismo estilo de pills) sin
  colisionar con su lógica.
- ARIA completo en pills y chips (tablist/tab/tabpanel, aria-selected,
  aria-pressed).

### Negativas / Riesgos

- El estado de pestaña/filtro es por closure y se pierde al salir del
  detalle (reset al reabrir): comportamiento deseado según la issue, pero
  significa que no hay persistencia de la última vista.
- Las clases `.friend-*` nuevas deben mantenerse ajenas a cualquier selector
  global futuro para no reintroducir colisiones.

### Neutras

- `docs/manual-de-usuario.md` actualizado (sección 13.2 Amigos): la vista
  cambia para el usuario (pestañas y filtros), aplica la regla 3 de
  AGENTS.md.

### Mejora futura

- **Contadores en los chips** (número de ítems por estado): descartado en
  esta iteración por simplicidad, pero el modelo de datos y el re-render por
  grid activo lo permiten sin cambios estructurales.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: `#friend-detail` pasa de 3 secciones apiladas a subpestañas `role="tablist"` (`.friend-subtab` con `data-friend-tab`) + 3 paneles `role="tabpanel"` con chips de filtro por estado (`.friend-chip` con `data-status`) y su grid (`#friend-movies`, `#friend-tv` —antes `#friend-series`—, `#friend-books`). **Iteración 2**: el panel de películas queda con 3 chips (Todos / Pendiente / Vista), alineado con `ocio/peliculas.html` |
| `js/ui.js` | **Modificado**: se eliminan `renderFriendDetail` y `renderReadOnlyGrid` (privada, solo usada por la anterior); se añade `renderFriendTab(tabKey, items, onOpen, emptyMessage)` que renderiza un único grid (`#friend-{tabKey}`) con mensaje de vacío configurable |
| `js/profile.js` | **Modificado**: estado en el closure (`friendData`, `friendFilters`, `friendActiveTab`, `currentFriendName`); `openFriend` resetea pestaña/filtros y carga los datos una vez; nuevas funciones privadas `renderFriendTab`, `setFriendTab`, `setFriendFilter`; listeners únicos en `.friend-subtab` y delegación en `.friend-filters` |
| `css/styles.css` | **Modificado**: `.friend-subtabs`/`.friend-subtab` comparten estilo con `.profile-subtabs`/`.profile-subtab` (selectores en coma, incluida la media query 480px); nuevos `.friend-filters`/`.friend-chip`; eliminado CSS muerto `.friend-detail__section*` (y su variante light) |
| `docs/manual-de-usuario.md` | **Modificado**: sección 13.2 Amigos — pestañas Películas/Series/Libros, filtros por estado por scope (películas: Todos/Pendiente/Vista en la iteración 2), conservación del filtro entre pestañas y restablecimiento al reentrar en un amigo |
| `docs/adr-048-friends-view-tabs-filters.md` | **Nuevo**: este documento |

## Verificación

- Code review manual + DevTools en tres anchos (~360, ~768, ~1280 px):
  `document.documentElement.scrollWidth <= window.innerWidth` debe ser `true`.
- Iteración 2: en `#friend-panel-movies` solo existen 3 `.friend-chip`
  (`todos`, `pendiente`, `completado`); el JS de filtrado es data-driven
  sobre los chips presentes, por lo que no requiere cambios.
- Greps de control: sin `renderFriendDetail`, `renderReadOnlyGrid`,
  `friend-series` ni `.friend-detail__section` en el código (`js/`,
  `index.html`, `css/`); la única mención restante de
  `.friend-detail__section` está en el ADR histórico
  `docs/adr-009-light-mode.md`.

Related issue: #49 — https://github.com/gonzalitojh/Registro-personal/issues/49
