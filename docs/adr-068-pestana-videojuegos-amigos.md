# ADR-068: Pestaña de Videojuegos en el detalle de amigo (issue #172)

## Estado
Aceptado

## Fecha
2026-08-10

## Contexto

El detalle de amigo de la sección **Amigos** del perfil muestra el registro
de otro usuario en modo solo lectura, organizado **por pestañas** desde la
issue #49: Películas, Series y Libros (ADR-048), con chips de filtro por
estado y patrón data-driven (los datos se cargan una vez por amigo abierto
con `Promise.all` de `getItemsOnce(uid, type)` y al cambiar de pestaña o
filtro solo se re-renderiza el grid activo).

Los **videojuegos** existen como categoría propia del producto desde la
issue #47 (colección `games` en Firestore, pestaña en Ocio con
`ocio/videojuegos.html`, estados Todos / Pendiente / Jugando / Jugado /
Standby / Abandonado), pero el detalle de amigo aún no los mostraba: el
manual (sección 14.2) documentaba explícitamente que «la pestaña de
Videojuegos aún no está disponible aquí».

La issue #172 pide incluir la pestaña de videojuegos en la vista de amigos,
con sus chips de filtro por estado coherentes con `ocio/videojuegos.html`.

Related issue: #172 — https://github.com/gonzalitojh/Registro-personal/issues/172

## Decisión

Añadir una cuarta subpestaña **«Videojuegos»** al detalle de amigo,
replicando el patrón data-driven del ADR-048 sin introducir lógica nueva:

### 1. Pestaña y panel

- Nuevo botón pill `.friend-subtab` con `data-friend-tab="games"`,
  `role="tab"`, `aria-selected` y `aria-controls="friend-panel-games"`,
  junto a Películas/Series/Libros.
- Nuevo panel `.friend-tabpanel` con `role="tabpanel"` y
  `aria-labelledby="friend-tab-games"`, con su grupo de chips
  (`role="group"`, `aria-label`) y el grid `#friend-games`.

### 2. Chips de filtro por estado

Los estados de videojuego en el producto (issue #47) son
`todos`/`pendiente`/`en_curso`/`completado`/`standby`/`abandonado` con
etiquetas **Todos / Pendiente / Jugando / Jugado / Standby / Abandonado**,
idénticos a `ocio/videojuegos.html`. El grupo de chips del panel de games
replica exactamente esos valores y etiquetas.

### 3. Estado en memoria y carga de datos

- `friendData` y `friendFilters` del closure de `setupProfile` (profile.js)
  incorporan la clave `games` (mismo tratamiento que movies/tv/books).
- `openFriend` carga los 4 tipos con `Promise.all`, incluido
  `ctx.getItemsOnce(profile.uid, "game")` (patrón solo-lectura existente,
  `getDocs` puntual sin suscripción; la lectura de `games` de otros
  usuarios ya está permitida por `firestore.rules`).
- Al cambiar de pestaña o filtro no se re-consulta Firestore: solo se
  re-renderiza el grid activo desde memoria (`setFriendTab` /
  `setFriendFilter` / `renderFriendTab` genéricos).
- Al abrir cualquier amigo se resetean pestaña a `movies` y todos los
  filtros (incluido `games`) a `todos`, y los chips del DOM vuelven al
  estado inicial (aria-pressed incluido).

### 4. Sin cambios estructurales

El render es data-driven: `renderFriendTab` (ui.js) es genérico por
`tabKey`, `renderGrid` y `openReadOnlyModal` ya soportan items de tipo
`game` (scope `game` en `STATUS_LABELS`, `scopeFor(type)`, `metaLineFor`,
`progressLine`, `communityRatingHtml` con etiqueta IGDB). El CSS de
`.friend-subtabs` (flex-wrap) y `.friend-chip` es compartido y ya cubre la
cuarta pestaña en móvil.

## Alternativas descartadas

- **No hacer nada (esperar a otra issue)**: el manual ya prometía la
  categoría de videojuegos en la vista de amigos; dejarla fuera era una
  deuda funcional frente a la categoría propia del producto.
- **Vista específica con lógica propia**: innecesaria — el patrón
  data-driven del ADR-048 absorbe un cuarto tipo sin ramas nuevas.
- **Reutilizar `.filter-chips`/`.chip`**: descartado ya en el ADR-048 por
  colisión con la lógica global de filtros de las bibliotecas
  (app.js); se mantienen `.friend-filters`/`.friend-chip`.

## Consecuencias

### Positivas

- El detalle de amigo queda completo: Películas, Series, Libros y
  Videojuegos, con filtros coherentes con la vista personal de Ocio.
- Cero consultas extra a Firestore al cambiar a Videojuegos o filtrar.
- Sin cambios en `ui.js`, `css/styles.css` ni `db.js`: solo HTML, el
  estado en `profile.js` y el manual.

### Negativas / Riesgos

- La carga inicial del detalle de amigo ahora hace 4 lecturas en paralelo
  en lugar de 3 (mismo coste por lectura puntual que las existentes).
- Los chips de games deben mantenerse alineados con `ocio/videojuegos.html`
  si en el futuro cambian los estados de la categoría.

### Neutras

- `docs/manual-de-usuario.md` actualizado (sección 14.2 Amigos): ya no dice
  que la pestaña de Videojuegos no está disponible y describe sus filtros
  (regla 3 de AGENTS.md).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: botón `#friend-tab-games` (`.friend-subtab`) y panel `#friend-panel-games` con chips (Todos/Pendiente/Jugando/Jugado/Standby/Abandonado) y grid `#friend-games` |
| `js/profile.js` | **Modificado**: `friendData.games`/`friendFilters.games`, `getItemsOnce(profile.uid, "game")` en el `Promise.all` de `openFriend`, reset de games al abrir amigo, loop de paneles con `games` en `setFriendTab` |
| `docs/manual-de-usuario.md` | **Modificado**: sección 14.2 — pestaña Videojuegos disponible con sus filtros |
| `docs/adr-068-pestana-videojuegos-amigos.md` | **Nuevo**: este documento |

## Verificación

- Revisión QA (criterios de aceptación 1-8 y DoD): PASS — los 8 criterios
  de la issue #172 verificados uno a uno (pestaña, chips, carga, patrón
  data-driven, reset, ARIA, responsividad 360/768/1280 con flex-wrap,
  manual actualizado).
- Escaneo de seguridad: PASS sin hallazgos (patrón solo-lectura
  preexistente, sin secretos ni PII).
- Análisis estático de responsividad: `.friend-subtabs` con `flex-wrap:
  wrap` y compactación ≤480px ya existentes; la cuarta pestaña envuelve en
  móvil sin desbordar.

Related issue: #172 — https://github.com/gonzalitojh/Registro-personal/issues/172
