# ADR-057: Reintento automático en la carga inicial de datos (issue #147)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #147 («Recarga de ítems») reporta un bug de fiabilidad al
entrar en la web: a veces no cargaban los datos (películas, series,
libros y notificaciones) y no había más remedio que cerrar la pestaña
y volver a abrirla.

Causa raíz: las suscripciones en tiempo real `onSnapshot` de Firestore
(`subscribeToItems`/`subscribeToNotifications` en `js/db.js`, usadas en
`js/app.js` dentro de `watchAuthState` → `init()`) fallan por errores
transitorios (red, conexión con Firestore…). El callback `onError` solo
mostraba un toast («No se pudieron cargar tus películas/series/libros»)
y nunca se reintentaba: el stream quedaba muerto y la biblioteca vacía
hasta cerrar y volver a abrir la web.

El escenario se ve además favorecido por el service worker: las
peticiones GET a `firestore.googleapis.com` se atienden con
`networkFirst` y, sin conexión, el SW devuelve un **503 falso** (el
fallback de API). El SDK de Firestore recibe ese 503 como un error de
la suscripción y dispara `onError` — aunque el usuario esté simplemente
sin red en ese momento.

Related issue: #147 — https://github.com/gonzalitojh/Registro-personal/issues/147

## Decisión

### 1. Wrapper genérico `subscribeWithRetry()` en `js/retry.js`

Se crea `js/retry.js` con `subscribeWithRetry({ subscribe, onChange,
onError, onRetrying, maxRetries = 3, baseDelayMs = 1000,
waitForOnline = true })`, un wrapper que envuelve **cualquier**
suscripción y la mantiene viva ante fallos transitorios:

- **Flujo de fallo**: cuando la suscripción dispara `onError`, el
  wrapper cancela la suscripción rota y vuelve a suscribirse con
  **backoff exponencial** (`baseDelayMs * 2^(n-1)` → 1 s, 2 s, 4 s)
  hasta `maxRetries` reintentos (4 intentos en total: el inicial + 3
  reintentos). Al agotarlos, se llama al `onError` **final** (el toast
  original de cada grupo).
- **Espera por el evento «online»**: si `navigator.onLine === false`
  (escenario principal del usuario: el SW devuelve el 503 falso sin
  red), el wrapper **no gasta los reintentos** con temporizadores: se
  registra un listener del evento `online` y se re-suscribe al vuelo en
  cuanto vuelve la conexión.
- **`onRetrying` informativo, una sola vez por episodio**: el flag
  `notifiedRetry` garantiza que el aviso «Hay problemas de conexión.
  Reintentando…» se muestra **1 vez** por episodio de fallo, no en cada
  reintento; se resetea con el primer snapshot con éxito (`attempts =
  0; notifiedRetry = false;` en el `onChange` del wrapper), de modo que
  un fallo futuro vuelve a avisar y a reintentar desde cero.
- **`cancel()` estable**: devuelve una función de cancelación segura de
  llamar varias veces: guard `cancelled` que descarta callbacks
  tardíos, `clearTimeout` del timer de backoff, `removeEventListener`
  del listener `online` y cancelación de la suscripción activa. Es
  compatible con la firma que ya esperaba `stopAllSubscriptions()`.
- **Errores síncronos cubiertos**: `onSnapshot` puede lanzar de forma
  síncrona; el `try/catch` de `start()` trata esa excepción igual que
  un error asíncrono del listener.
- **Nunca dos suscripciones vivas**: `retry()` cancela la suscripción
  rota antes de volver a crear (el unsubscribe de un stream ya muerto
  es inocuo).

### 2. Las 4 suscripciones de `js/app.js` se envuelven

- **Películas, series y libros**: cada `subscribeToItems` se envuelve
  con `subscribeWithRetry`. El `onError` **final conserva los toasts
  originales** («No se pudieron cargar tus películas/series/libros») y
  el `onRetrying` muestra «Hay problemas de conexión. Reintentando…».
- **Notificaciones**: `subscribeToNotifications` usa el mismo wrapper
  pero **reintenta en silencio** (`onError: () => {}`, como su error
  original que no molestaba); el badge se rellena cuando el reintento
  tenga éxito.
- **Sin cambios colaterales**: `stopAllSubscriptions()` no se toca (el
  `cancel()` devuelto es estable) y los cuerpos de los `onChange`
  (flags `ready`, `renderLibraryFor`, `maybeTriggerDailyCheck`, badge)
  quedan intactos — solo cambia el contenedor.

### 3. Service worker y versionado

- `service-worker.js`: `./js/retry.js` se añade a `STATIC_ASSETS`
  (prerequisito: `app.js` lo importa y el SW sirve los módulos en
  modo offline) y `CACHE_STATIC`/`CACHE_DYNAMIC` pasan de
  `mi-registro-v3-*` a `mi-registro-v4-*`.
- Versionado completo del deploy: `APP_VERSION` `20260823` →
  `20260830` en `js/config.js`; `?v=20260830` en `index.html`
  (`css/styles.css`, `ocio/ocio.css`, `js/app.js`) y en las entradas
  versionadas de `STATIC_ASSETS` (`ocio/series.html`,
  `ocio/peliculas.html`, `ocio/libros.html`).

### 4. Fix de la iteración QA: limpieza completa en `retry()` (commit 2f15541)

En la primera iteración, `retry()` re-suscribía sin limpiar el estado
anterior, lo que rompía los reintentos siguientes por dos vías: el id
del timer ya disparado seguía siendo truthy y el guard `retryTimer` de
`handleError` bloqueaba cualquier error posterior; y el listener
`online` quedaba huérfano, disparando re-suscripciones espurias en cada
reconexión. Como parte de la decisión final, `retry()` hace ahora
`clearTimeout(retryTimer); retryTimer = null; clearOnlineHandler();`
**antes** de cancelar la suscripción rota y re-suscribir.

## Consideraciones

- **El 503 falso del SW se convierte en la señal de entrada del
  wrapper**: no se modifica la estrategia `networkFirst` de las APIs;
  cuando el usuario está sin red, el error de la suscripción llega igual
  y el wrapper decide: si `navigator.onLine === false`, espera al evento
  «online» sin gastar reintentos (el escenario principal del bug); si el
  dispositivo cree estar online pero Firestore falla de verdad, usa el
  backoff.
- **Tiempos**: con los valores por defecto, la espera acumulada hasta el
  toast final es de ~7 s (1+2+4). El usuario ve el aviso informativo a
  la primera y el de error solo si se agotan los reintentos.
- **Cambio visible para el usuario**: sí aplica la regla 3 de AGENTS.md
  — `docs/manual-de-usuario.md` se actualiza en la misma tarea
  (secciones 15 y 18).
- **Alcance acotado a suscripciones**: las lecturas puntuales
  (`getDoc`/`getDocs`, p. ej. sincronización manual) quedan fuera del
  mecanismo (ver Alternativas descartadas).

## Alternativas descartadas

- **Reintentar con `getDoc`/`getDocs` en lugar de re-suscribir**:
  descartado — fuera del alcance de la issue. Cambiaría la semántica de
  tiempo real (se perderían las actualizaciones en vivo de `onSnapshot`
  que ya funcionan cuando la primera conexión tiene éxito) y duplicaría
  la lógica de lectura; además, el flujo que fallaba era la suscripción
  inicial, no las lecturas puntuales (que ya tienen su propio manejo de
  errores).
- **Spinner o estado de carga persistente**: descartado — los toasts ya
  informan sin bloquear la interfaz; un cargador fijo ocultaría
  contenido ya cargado y complicaría el estado de la biblioteca, para
  un problema que dura unos segundos.
- **Reintento infinito (sin tope)**: descartado — con la red caída, el
  bucle sería eterno y los temporizadores se acumularían; el tope de 3
  reintentos con backoff y el toast final dan una salida clara al
  usuario.
- **Re-suscribir sin cancelar la suscripción rota**: descartado —
  acumularía streams vivos (fugas); `retry()` cancela la anterior antes
  de volver a crear.
- **Aviso informativo en cada reintento**: descartado — con backoff de
  1/2/4 s serían hasta 3 toasts seguidos por grupo; el flag
  `notifiedRetry` lo reduce a uno por episodio de fallo.

## Consecuencias

### Positivas

- **Fin del bug de la issue #147**: si al entrar falla una suscripción
  por un error transitorio, la web lo reintenta sola (1 s, 2 s, 4 s) y
  los datos cargan sin cerrar y reabrir.
- **Sin conexión, sin gastar reintentos**: al volver la red (evento
  «online») se re-suscribe al momento; el toast de error final no
  aparece por un apagón momentáneo.
- **Una sola pieza reutilizable**: `subscribeWithRetry` es genérico y
  sirve para envolver cualquier suscripción futura, no solo las cuatro
  actuales.
- **Cancelación estable**: `stopAllSubscriptions()` funciona igual y
  llamar a `cancel()` varias veces es seguro (guard `cancelled`).
- **Avisos claros y sin ruido**: 1 toast informativo por episodio de
  fallo + 1 toast final solo si se agotan los reintentos; las
  notificaciones reintentan en silencio como antes.
- **Manual de usuario al día**: secciones 15 y 18 documentan el nuevo
  comportamiento — regla 3 de AGENTS.md cumplida en la misma tarea.

### Negativas / Riesgos

- **Retardo de hasta ~7 s en la carga**: si la primera conexión falla,
  la biblioteca puede tardar los 1+2+4 s del backoff en cargar, con el
  aviso «Hay problemas de conexión. Reintentando…» de por medio.
  Aceptado: es el coste de reintentar en vez de fallar al instante.
- **Sin reintento tras agotar el máximo**: si el problema no es
  transitorio (red caída de verdad, Firestore caído), el usuario ve el
  toast final y el wrapper no vuelve a intentar solo. Mitigación: al
  recuperar la conexión y recargar la web, el ciclo comienza de nuevo.
- **`getDoc`/`getDocs` fuera del alcance**: errores transitorios en
  lecturas puntuales no quedan cubiertos por este mecanismo (pueden
  seguir fallando y pidiendo reintento manual si la API no lo hace
  sola).

### Neutras

- **`stopAllSubscriptions()` sin cambios**: el `cancel()` de
  `subscribeWithRetry` es compatible con la firma existente.
- **Flags `ready` y `maybeTriggerDailyCheck` intactos**: los cuerpos de
  los `onChange` no cambian, solo su contenedor (wrapper).
- **Textos de los toasts finales sin cambios**: «No se pudieron cargar
  tus películas/series/libros» se conservan tal cual.
- **Cachés del SW v3 → v4**: los navegadores con la v3 la purgan en el
  siguiente `activate` (mecanismo ya existente del SW).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/retry.js` | **Nuevo**: `subscribeWithRetry()` — wrapper genérico cancelable con reintento automático (backoff 1 s/2 s/4 s, máx. 3 reintentos = 4 intentos), espera del evento «online» si `navigator.onLine === false` (sin gastar reintentos), `onRetrying` una sola vez por episodio de fallo (flag `notifiedRetry` que se resetea con un snapshot con éxito), `cancel()` estable con guard `cancelled`; `retry()` limpia timer y listener «online» y cancela la suscripción rota antes de re-suscribir (fix QA del commit 2f15541) |
| `js/app.js` | **Modificado**: las 4 suscripciones (películas, series, libros y notificaciones) se envuelven con `subscribeWithRetry`; `onError` final conserva los toasts originales; `onRetrying` muestra «Hay problemas de conexión. Reintentando…» en los 3 grupos; las notificaciones reintentan en silencio; `stopAllSubscriptions()` y los flags `ready`/`maybeTriggerDailyCheck` intactos |
| `service-worker.js` | **Modificado**: `./js/retry.js` añadido a `STATIC_ASSETS`; `CACHE_STATIC`/`CACHE_DYNAMIC` `mi-registro-v3-*` → `mi-registro-v4-*`; entradas de assets con `?v=20260830` |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260823` → `20260830` |
| `index.html` | **Modificado**: `?v=20260823` → `?v=20260830` en `css/styles.css`, `ocio/ocio.css` y `js/app.js` |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 15 y 18 — la web reintenta sola durante unos segundos ante fallos de conexión puntuales al entrar (regla 3 de AGENTS.md) |
| `docs/adr-057-reintento-carga-inicial.md` | **Nuevo**: este documento |

Related issue: #147 — https://github.com/gonzalitojh/Registro-personal/issues/147
