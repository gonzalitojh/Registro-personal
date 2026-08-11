# ADR-075: Portadas no cargan tras valorar (issue #191)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

Tras **valorar una película**, las portadas de la biblioteca dejan de
cargarse; en series y libros las portadas **parpadean** (se recargan una y
otra vez). En ambos casos la biblioteca solo se recupera al **cerrar y
reabrir** la web.

Causa raíz: cada snapshot de Firestore de `subscribeToItems`
(`js/app.js`) se dispara con **cualquier escritura** en la colección del
usuario — una valoración, la pasada diaria de metadatos de
`daily-check.js`, la actualización de `updatedAt` — y volcaba el
`innerHTML` del grid/lista completo (`renderLibraryFor` →
`js/ui.js` `renderGrid`/`renderList`). Cada volcado destruye los
`<img loading="lazy">` existentes y el navegador **cancela las cargas en
vuelo** de sus portadas. Con ráfagas de snapshots (guardado de la
valoración + ack del servidor + refresco diario concurrente, con
`REFRESH_CONCURRENCY=4`) las portadas se cancelan repetidamente y **nunca
completan** (de ahí el parpadeo) hasta reiniciar.

Además, las portadas de la biblioteca y los modales **no tenían fallback**
al placeholder: solo la búsqueda global lo tenía (issue #149), así que un
error real de carga (403/404 de hotlinking, red caída) dejaba la imagen
rota sin sustituir.

Related issue: #191 — https://github.com/gonzalitojh/Registro-personal/issues/191

## Decisión

Evitar los re-renders innecesarios (no volcar el DOM cuando el snapshot
no cambia nada de lo que se ve) y garantizar un fallback al placeholder
para todas las portadas.

### 1. Guarda de re-render por snapshot (`js/render-guard.js`)

Nuevo módulo `js/render-guard.js`:

- `createRenderGuard()` → `{ changed(group, items), reset() }`, con estado
  por grupo (`movies`/`tv`/`books`/`games`).
- `renderSignature(items)` serializa **solo** `RENDERED_FIELDS`: los
  **21+2 campos** que pintan `renderGrid`/`renderList`,
  `progressLine`, `upcomingBadge`, `quickActionLabel` e
  `isItemUnreleased` (21), más `releasedNoticedAt` y `addedAt` porque no
  se pintan pero **sí afectan al orden visible** (`sorting.js`
  `getSortDate`/`getActivityOrAddedTime`). Los metadatos no renderizados
  (`updatedAt`, `overview`, `cast`, `runtime`, géneros…) quedan **fuera**
  de la firma a propósito: su escritura (p. ej. la pasada diaria) no debe
  re-renderizar nada.
- `changed(group, items)` devuelve `true` solo si la firma del grupo
  cambió respecto a la última llamada (y la actualiza); `reset()` limpia
  todas las firmas.

Integración en `js/app.js`:

- Los **4 `onChange`** de `subscribeToItems` (movie, tv, book, game)
  llaman a `syncGroup(group, items)`, que solo invoca
  `renderLibraryFor(group)` **y** `refreshExternalResults(createCtx())`
  cuando `changed()` devuelve `true`. La búsqueda global se refresca
  también solo entonces: su estado «Añadir/Añadido» depende de los ids de
  la colección, que forman parte de la firma.
- `groupChanged.reset()` al **cerrar sesión**: el siguiente login debe
  re-renderizar su biblioteca sin comparar contra la firma de otro
  usuario.

### 2. Fallback de portadas al placeholder (`js/ui.js`)

`setupCoverErrorFallback()`: un listener en **fase de captura** en
`document` para el evento `"error"` — que **no burbujea**, pero la captura
sí lo recibe de cualquier `<img>` descendiente, incluidas las que se
re-renderizan con `innerHTML` (mismo patrón que la issue #149). Sustituye
por `PLACEHOLDER_COVER` las `<img>` con las clases:

`item-card__cover`, `list-row__cover`, `modal-detail__cover`,
`rating-modal__cover`, `rec-card__cover`, `saga-row__cover`,
`activity-event__cover` y `cover-picker__item-cover` (miniaturas del
selector de portadas de ediciones de libro, `openBookConfirmModal`).

- **Guarda de bucle**: si `img.src` empieza por `"data:"` (ya es el
  placeholder) no se reasigna.
- **No toca** `global-search__item-cover` ni `global-search__friend-avatar`:
  los gestiona `global-search.js` con su propio listener (issue #149).
- Se instala **una sola vez** en `app.js` `init()`; al vivir en
  `document`, sobrevive a todos los renders.

### 3. Service worker y bump de versión

- `service-worker.js`: `'./js/render-guard.js'` añadido a `STATIC_ASSETS`.
- **Bump de versión de despliegue 20260904 → 20260905** (convención
  ADR-019; `scripts/bump-version.sh`) en `index.html` (`?v=` de
  `css/styles.css`, `ocio/ocio.css` y `js/app.js`), `js/config.js`
  (`APP_VERSION`) y `service-worker.js` (`STATIC_ASSETS`), para invalidar
  las cachés del service worker.

## Alternativas descartadas

- **Debounce/agrupar los renders tras el snapshot (esperar N ms antes de
  volcar)**: descartado — reduce pero no elimina la cancelación de cargas
  en vuelo (el volcado de `innerHTML` se seguiría produciendo) y añade
  latencia perceptible al aplicar valoraciones, que es justo la acción
  del bug.
- **Reconciliación de nodos (diff del DOM en lugar de volcar
  `innerHTML`)**: descartado — es un refactor de gran superficie en
  `renderGrid`/`renderList` para las cuatro categorías, con alto riesgo de
  regresiones; la guarda consigue el mismo resultado (no re-renderizar lo
  que no cambia) con un cambio mínimo y localizado.
- **Firmar el snapshot completo (comparar todo el ítem o `updatedAt`)**:
  descartado — `updatedAt` cambia en cada pasada diaria de metadatos, así
  que la firma «cambiaría siempre» y la guarda sería inútil; comparar
  solo los campos que se pintan es la firma mínima correcta.
- **Quitar `loading="lazy"` de las portadas (carga ansiosa)**: descartado
  — degrada el rendimiento en bibliotecas grandes, no evita la
  cancelación en los volcados y no da fallback ante errores reales; ataca
  el síntoma, no la causa.
- **`onerror` inline en cada plantilla de `<img>`**: descartado — habría
  que tocar cada plantilla (muchos puntos, propenso a olvidos) y mezcla
  lógica en el marcado; el listener único en captura cubre todas las
  imágenes actuales y futuras con un solo punto de definición.
- **Ampliar el fallback de la issue #149 a la biblioteca**: descartado —
  el listener de `global-search.js` es específico de sus propias clases;
  `setupCoverErrorFallback()` es el mecanismo general para el resto de
  portadas, dejando intacta la búsqueda global.

## Consecuencias

### Positivas

- Las **portadas dejan de cancelarse** tras valorar: los snapshots que no
  cambian nada visible no re-renderizan, y los bursts de escrituras
  (valoración + ack + pasada diaria) dejan de producir parpadeo.
- La guarda es **declarativa y extensible**: añadir un campo que se pinte
  en el futuro solo requiere añadirlo a `RENDERED_FIELDS` (sincronía
  documentada en la cabecera del módulo con `ui.js`/`sorting.js`).
- El **fallback al placeholder** cubre biblioteca, modales, recomendaciones,
  sagas y feed de actividad — incluidos errores reales de carga (403/404
  de hotlinking, red caída), no solo el bug de los snapshots.
- La **búsqueda global queda intacta**: su fallback propio (issue #149)
  sigue gestionando sus imágenes sin doble listener.
- `reset()` al cerrar sesión evita mostrar bibliotecas de otro usuario
  con datos no re-renderizados.

### Negativas / Riesgos

- Si un campo que afecta a lo pintado (o al orden) se queda fuera de
  `RENDERED_FIELDS`, el grupo podría no re-renderizar cuando debería
  (UI desactualizada). Riesgo mitigado por el comentario de sincronía del
  módulo y por el QA que verifica los campos contra `ui.js`/`sorting.js`;
  el error de diseño es «no re-renderizar», que nunca vuelve a romper las
  portadas.
- Un error de carga que el navegador no reporte como evento `"error"` (p.
  ej. una carga cancelada que no dispare el evento en algún navegador
  concreto) no recibiría el fallback hasta el siguiente render; caso
  límite aceptado (la causa principal, la cancelación por volcados, queda
  eliminada por la guarda).

### Neutras

- Bump de versión de despliegue **20260904 → 20260905** (convención
  ADR-019; `scripts/bump-version.sh` coherente): `index.html` (`?v=` ×3),
  `js/config.js` (`APP_VERSION`) y `service-worker.js` (`STATIC_ASSETS`).
- **Sin CSS nuevo ni cambios de layout/colores** (reglas 2 y 4 de
  AGENTS.md); `PLACEHOLDER_COVER` es un asset ya existente.
- **Manual de usuario sin cambios** (regla 3 de AGENTS.md): es un bug de
  comportamiento interno que no altera ninguna función visible; la
  explicación para el usuario final se publicará como comentario en la
  issue #191.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/render-guard.js` | **Nuevo**: `RENDERED_FIELDS` (21+2 campos), `renderSignature()`, `createRenderGuard()` → `{ changed(group, items), reset() }` |
| `js/app.js` | **Modificado**: `createRenderGuard` importado; `syncGroup(group, items)` que solo llama `renderLibraryFor` + `refreshExternalResults` cuando `changed()` es `true`; los 4 `onChange` de `subscribeToItems` pasan por `syncGroup`; `groupChanged.reset()` al cerrar sesión; `ui.setupCoverErrorFallback()` en `init()` |
| `js/ui.js` | **Modificado**: `COVER_IMG_CLASSES` (8 clases, incluye `cover-picker__item-cover` del selector de ediciones) y `setupCoverErrorFallback()` (listener de captura de `"error"` en `document`, guarda de bucle `data:`) |
| `service-worker.js` | **Modificado**: `'./js/render-guard.js'` en `STATIC_ASSETS`; bump `?v=20260904` → `?v=20260905` |
| `index.html` | **Modificado**: bump `?v=20260904` → `?v=20260905` (×3) |
| `js/config.js` | **Modificado**: `APP_VERSION` `'20260904'` → `'20260905'` |
| `docs/adr-075-portadas-no-cargan-tras-valorar.md` | **Nuevo**: este documento |

## Verificación

- Harness funcional (en `/tmp/opencode/qa-191`, fuera del repo):
  **render-guard 22/22 PASS**, **cover-fallback (jsdom) 12/12 PASS**,
  **simulate-churn 5/5 PASS** (escenario reportado: 13 renders sin
  guarda → 2 con guarda).
- Revisión QA: PASS — todos los campos renderizados verificados contra
  `ui.js`/`sorting.js`; sin cambios de layout ni colores (reglas 2 y 4 de
  AGENTS.md); manual de usuario sin cambios (bug de comportamiento
  interno, regla 3).
- Escaneo de seguridad: PASS **sin hallazgos HIGH/MEDIUM**.
- Sin CSS nuevo; `PLACEHOLDER_COVER` es un asset existente.
- **Iteración (comentario de 2026-08-11)**: re-validación completa —
  QA 19/19 + 16/16 PASS (render-guard y fallback con harness propio),
  escaneo de seguridad PASS sin hallazgos, y cobertura del fallback
  ampliada a las miniaturas del selector de portadas de ediciones de
  libro (`cover-picker__item-cover`), que el primer QA detectó sin
  clase (hallazgo de severidad baja, preexistente en `dev`).

Related issue: #191 — https://github.com/gonzalitojh/Registro-personal/issues/191
