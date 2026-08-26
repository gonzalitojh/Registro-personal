# ADR-101: Carga de datos robusta con watchdog y timeout de Firestore (issue #286)

## Estado
Aceptado

## Fecha
2026-08-15

## Contexto

La issue #286 («Carga de datos», type: bug) reporta que en ocasiones
no cargan los datos al entrar en la web: a veces se queda
indefinidamente el indicador **«Cargando…»**, otras veces no aparece
nada, y no hay más remedio que recargar la página.

El ADR-057 ya cubre los errores transitorios de las suscripciones
(`subscribeWithRetry` con backoff 1 s/2 s/4 s y espera del evento
«online»), pero solo reacciona ante `onError`: falta el caso de una
suscripción **colgada** —ni error ni datos—, que deja el «Cargando…»
eterno sin posibilidad de reintento.

Causas raíz identificadas:

1. **El service worker cacheaba las lecturas GET de Firestore** con
   `networkFirst` sin timeout y con `cache.put` en la caché dinámica.
   Una respuesta de Firestore es un stream de long-polling: el
   `cache.put` de un stream abierto **no resuelve jamás**, así que la
   petición queda colgada para siempre → en el SDK no llega ni
   `onChange` ni `onError` → el wrapper de ADR-057 nunca se entera →
   spinner eterno. Además, los protobufs de Firestore no deberían
   servirse nunca desde la caché dinámica (stale).
2. **`subscribeWithRetry` solo reaccionaba a errores** del listener;
   una suscripción que ni falla ni entrega datos no disparaba ningún
   reintento.
3. **Tras agotar los reintentos** (el `onError` final que muestra el
   toast), el marcador `.panel-loading` permanecía para siempre.
4. **El fetch del partial de cada pestaña** (`loadOcioPartial`) tampoco
   tenía timeout: una red colgada dejaba el panel sin contenido
   («no aparece nada»).

Related issue: #286 — https://github.com/gonzalitojh/Registro-personal/issues/286

## Decisión

### 1. Watchdog de primer snapshot en `subscribeWithRetry` (`js/retry.js`)

Cada intento de suscripción se vigila con un timer: si no llega ningún
snapshot con éxito en `initialTimeoutMs` (nuevo parámetro opcional,
default **12000 ms**, `0` lo desactiva), el intento se trata como
**fallo transitorio** y entra en el flujo de reintento existente
(backoff 1/2/4 s o espera del evento «online»). El timer se arma en
cada `start()` y solo vigila el primer snapshot de ese intento, con 5
puntos de limpieza: armado con limpieza previa en `start()`, y limpieza
en el `onChange` de éxito, en `handleError` (el error real llega antes
que el watchdog — no hay error final doble), en `retry()` (el timer del
intento N no debe disparar a mitad del intento N+1) y en `cancel()`.

Además, `handleError` hace ahora `clearOnlineHandler()` **antes** de
registrar el listener «online»: dos `handleError` seguidos estando
offline (p. ej. watchdog + error real del stream) ya no apilan dos
listeners «online» idénticos que re-suscribirían dos veces por cada
reconexión.

### 2. Estado final de error en los paneles de Ocio (`js/app.js`)

- `showPanelLoadError(groupKey, message, { force = false })`: estado
  final de error que retira el `.panel-loading`, respeta el guard
  `groupReady[groupKey]` (si el snapshot llegó tarde, los datos ya se
  pintan y el error de la suscripción no tiene sentido) salvo `force`
  (vía del partial: sin el HTML del panel no hay nada que pintar), e
  inserta un `.panel-error` con el mensaje y un botón **«Reintentar»**
  (reutiliza `.btn--small`). Es idempotente (limpia errores previos
  antes de pintar).
- `retryPanelLoad(groupKey)`: re-arranca la carga desde el estado de
  error. Cancela y anula `unsubscribeItems[groupKey]` (**requerido**:
  si no, el guard de `subscribeGroup` ignora la nueva suscripción),
  borra el id del panel de `loadedPartials` (**requerido**: si no,
  `loadOcioPartial` no re-fetcha el HTML), restaura el marcador de
  carga y lanza de nuevo el fetch del partial + `ensureGroupSubscribed`.
- El `onError` **final** de `subscribeGroup` conserva el toast
  existente y añade `showPanelLoadError`. `renderLibraryFor` y el bucle
  de logout retiran también el `.panel-error` (el logout restaura el
  marcador de carga al volver a entrar).

### 3. Timeout con `AbortController` en `loadOcioPartial` (`js/app.js`)

`PARTIAL_FETCH_TIMEOUT_MS = 8000`: el fetch del partial usa un
`AbortController`; si la red se cuelga, se aborta y cae en el estado de
error del panel con mensaje distinto según la causa: **«Esta sección
tardó demasiado en cargarse.»** (`AbortError`) vs **«No se pudo cargar
esta sección.»** (cualquier otro fallo). El id se retira de
`loadedPartials` en ambos casos (reintentable con el botón o en la
siguiente activación) y el timer se limpia en un `finally`.

### 4. Service worker: Firestore en network-only con timeout (`service-worker.js`)

- `offlineApiResponse()`: **fuente única** del 503 amigable
  (`{ error: 'offline', message: 'No hay conexión' }`); lo usan
  `networkFirst` (fallback de APIs) y `networkOnlyWithTimeout`.
- `networkOnlyWithTimeout(request, ms = 8000)`: para las lecturas GET
  de Firestore. `fetchWithTimeout` **sin** `cache.put` ni `cache.match`
  (un stream abierto haría colgar el `put`, y los protobufs no se
  sirven stale) y `catch` que devuelve el 503 **sin propagar el
  rechazo**. El 503 sigue siendo el camino probado que dispara el
  `onError` del SDK → reintentos del wrapper (ADR-057).
- Cachés `mi-registro-v4-*` → `mi-registro-v5-*`.

### 5. Versionado

`APP_VERSION` `20260929` → **`20261001`** en `js/config.js`, `index.html`
(3 referencias `?v=`) y `service-worker.js` (7 referencias `?v=`).
Nota: `20260930` **no** se usa porque la PR #284 (abierta) ya lo tomó.

### Relación con ADR-057

Modifica su **decisión 3** en la parte del service worker: las lecturas
GET de Firestore pasan de `networkFirst` (con timeout opcional solo
para navegación, sin timeout para APIs) a **network-only con timeout**
y sin cachear. El resto del ADR-057 queda intacto: wrapper, backoff,
espera del evento «online», toasts y versionado del propio ADR-057. El
503 sigue siendo el camino que dispara el `onError` del SDK, ahora
también para el colgado.

## Consideraciones

- **El watchdog es el backstop para los clientes con SW viejo (v4)**:
  con el SW nuevo el colgado se convierte en 503 a los 8 s (timeout del
  SW), antes que el watchdog (12 s); con un SW viejo la petición se
  cuelga sin llegar a fallar y solo el watchdog la detecta.
- **El watchdog solo vigila el primer snapshot del intento**: un stream
  ya entregando datos en vivo no se corta (su `onChange` lo retira).
- **Cambio visible para el usuario**: sí aplica la regla 3 de AGENTS.md
  — `docs/manual-de-usuario.md` se actualiza en la misma tarea
  (secciones 3, 18 y 21).
- **Alcance**: el `.panel-error` con botón «Reintentar» es de los 4
  paneles de Ocio (series, películas, libros, videojuegos); el resto de
  suscripciones heredan solo el watchdog (ver Consecuencias neutras).

## Alternativas descartadas

- **Cachear las lecturas de Firestore con TTL (stale + streams)**:
  descartado — las respuestas de Firestore son protobufs que no deben
  servirse stale, y un stream de long-polling es imposible de guardar
  en caché (el `cache.put` no resuelve).
- **Reintento infinito**: descartado — temporizadores acumulados sin
  salida clara para el usuario; el tope de reintentos con backoff y el
  estado de error final siguen siendo la salida (ADR-057).
- **Watchdog fuera del wrapper, en `app.js`**: descartado — duplicaría
  la lógica por cada suscripción y no cubriría las que no pasan por
  `app.js` (notificaciones, recetas, menú, gimnasio).
- **Estado de error sin botón «Reintentar»**: descartado — obligaría a
  recargar la página, que es exactamente el síntoma que reporta la
  issue #286.
- **Solo watchdog en el cliente, sin timeout en el SW**: descartado —
  el colgado del `cache.put` deja la petición de red viva e imposible
  de reintentar; el timeout del SW es la cura de la causa raíz y el
  watchdog queda como backstop para clientes con SW viejo.

## Consecuencias

### Positivas

- **Fin del «Cargando…» eterno (issue #286)**: una suscripción colgada
  se detecta (SW: 8 s; watchdog: 12 s) y se trata como fallo
  transitorio con reintento automático.
- **Recuperación automática**: con el SW nuevo, el colgado se convierte
  en 503 → `onError` del SDK → reintentos del wrapper → los datos
  cargan sin recargar la página.
- **Botón «Reintentar»**: si se agotan los reintentos, hay una vía
  manual inmediata sin recargar la página (y el panel queda en un
  estado final claro en vez del spinner eterno).
- **Backstop para SW viejos**: los clientes que aún corran la caché v4
  se recuperan igualmente gracias al watchdog del wrapper.

### Negativas / Riesgos

- **Espera hasta el estado final de error**: en el peor caso ~43 s con
  SW viejo (4 intentos cortados por el watchdog de 12 s más los
  backoffs) y ~16 s con SW nuevo (timeout del SW de 8 s + backoffs)
  hasta mostrar el `.panel-error`. Aceptado: es el coste de agotar los
  reintentos antes de rendirse.
- **Toast final a veces con datos visibles**: si el snapshot tardío
  llega justo antes del `onError` final, el guard `groupReady` evita el
  `.panel-error` pero el toast («No se pudieron cargar…») se muestra
  igual, aunque la biblioteca ya tenga contenido. Aviso cosmético,
  aceptado.

### Neutras

- **Las demás suscripciones heredan el watchdog sin cambios**: el
  parámetro `initialTimeoutMs` tiene default; notificaciones, recetas,
  menú y gimnasio se benefician de él sin tocar su código.
- **Recetas, menú y gimnasio siguen toast-only**: el `.panel-error`
  con botón «Reintentar» solo se añade a los 4 paneles de Ocio.
- **Las notificaciones siguen reintentando en silencio** (`onError:
  () => {}`), también cuando el watchdog corta un intento.
- **Cachés del SW v4 → v5**: los navegadores con la v4 la purgan en el
  siguiente `activate` (mecanismo ya existente del SW).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/retry.js` | **Modificado**: watchdog de primer snapshot `initialTimeoutMs` (default 12000 ms, `0` lo desactiva) en `subscribeWithRetry` — timer por intento que trata como fallo transitorio una suscripción que no entrega ningún snapshot con éxito en ese tiempo, con 5 puntos de limpieza (armado en `start()`; limpieza en `onChange` de éxito, `handleError`, `retry()` y `cancel()`); `clearOnlineHandler()` antes de registrar el listener «online» en `handleError` (evita listeners duplicados estando offline) |
| `js/app.js` | **Modificado**: `showPanelLoadError(groupKey, message, {force})` — estado final de error de los paneles de Ocio (retira `.panel-loading`, guard `groupReady` salvo `force`, inserta `.panel-error` con mensaje y botón «Reintentar», idempotente); `retryPanelLoad(groupKey)` — cancela y anula `unsubscribeItems[groupKey]` (guard de `subscribeGroup`), borra de `loadedPartials` (guard de `loadOcioPartial`), restaura el marcador de carga y re-lanza partial + suscripción; `onError` final de `subscribeGroup` conserva el toast y añade el error de panel; `renderLibraryFor` y el bucle de logout retiran `.panel-error`; `loadOcioPartial` con `AbortController` (`PARTIAL_FETCH_TIMEOUT_MS = 8000`) y mensajes distintos para `AbortError` vs resto; nuevo mapa `GROUP_TO_PANEL` |
| `css/styles.css` | **Modificado**: `.panel-error` y `.panel-error__message` — mismo patrón que `.panel-loading`, solo con variables de tema (`--ink-soft`), `overflow-wrap: break-word`; botón «Reintentar» reutiliza `.btn--small` |
| `service-worker.js` | **Modificado**: `offlineApiResponse()` como fuente única del 503 amigable; `networkOnlyWithTimeout(request, ms = 8000)` para las lecturas GET de Firestore — `fetchWithTimeout` sin `cache.put` ni `cache.match`, `catch` → 503 sin propagar el rechazo; cachés `mi-registro-v4-*` → `mi-registro-v5-*` |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260929` → `20261001` (20260930 no se usa: la PR #284 ya lo tomó) |
| `index.html` | **Modificado**: `?v=20260929` → `?v=20261001` en `css/styles.css`, `ocio/ocio.css` y `js/app.js` |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 3, 18 y 21 — si los datos no llegan en unos segundos la web ya lo ha intentado varias veces y muestra un aviso con botón «Reintentar»; también reintenta si la conexión se queda «colgada» (regla 3 de AGENTS.md) |

Related issue: #286 — https://github.com/gonzalitojh/Registro-personal/issues/286
