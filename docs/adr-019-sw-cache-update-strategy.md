# ADR-019: Estrategia de actualización de caché del service worker (fix issue #25)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La PWA instalada en móvil **no reflejaba los nuevos cambios tras cada deploy**: la interfaz seguía mostrando la versión antigua indefinidamente, incluso forzando recargas. El análisis de la causa raíz (issue #25) identificó cuatro problemas combinados:

1. **El registro del SW era código muerto**: `index.html` no importaba `js/sw-register.js`. El commit de accesibilidad `240d1b5` eliminó el bloque inline de registro y el import del módulo nunca se restauró, por lo que en los despliegues recientes el service worker ni siquiera se registraba.
2. **`service-worker.js` servía TODO lo propio con cache-first**, incluida la navegación: una vez que `index.html` quedaba en caché, se servía de ella para siempre, sin comprobar nunca la red.
3. **Assets sin versionado**: un deploy no invalidaba la caché del SW existente, porque las URLs de los recursos no cambiaban entre versiones.
4. **`STATIC_ASSETS` desactualizado**: faltaban 6 módulos JS (`activity-feed`, `export-backup`, `export-ics`, `focus-utils`, `global-search`, `settings`), por lo que se precacheados con los recursos antiguos o no se precacheados en absoluto.

El objetivo era que la PWA instalada recibiera los cambios de cada deploy de forma fiable y automática, sin exigir al usuario interacción manual (el antiguo toast de actualización) ni desinstalar/reinstalar la app.

Related issue: #25 — https://github.com/gonzalitojh/Registro-personal/issues/25

## Decisión

Adoptar una estrategia de actualización de caché del service worker basada en **versionado explícito de assets + auto-aplicación de actualizaciones + navegación network-first con timeout**, con los siguientes componentes:

### 1. `service-worker.js`: cachés v2, navegación network-first y assets versionados

- **Cachés bumped**: `mi-registro-v2-static` / `mi-registro-v2-dynamic`. El evento `activate` borra cualquier caché que no esté en la lista permitida (las v1 quedan eliminadas automáticamente en el primer activate de la v2).
- **`fetchWithTimeout(request, ms = 3000)`**: helper que rechaza la petición si tarda más de 3 s. Se usa **SOLO para navegación**.
- **`networkFirst(request, timeoutMs = null)`**: ahora recibe `timeoutMs` opcional (`null` para APIs → sin timeout, evitando falsos "offline" en redes lentas) y devuelve `{ response, fromNetwork }` para que el llamador sepa el origen de la respuesta. Mantiene el límite de 50 entradas en la caché dinámica y los fallbacks (caché → app shell para navegación → `503` JSON para APIs).
- **Fetch handler reordenado**: primero las excepciones network-only (escrituras Firestore y endpoints de auth), luego el **bloque `navigate` con network-first + timeout (3000 ms) ANTES del own-path cache-first**, y después el resto de estrategias (cache-first para propios/estáticos/CDNs/posters, network-first para APIs). El bloque `navigate` viejo del final del handler fue eliminado.
- **Refresco de la entrada canónica**: cuando una navegación responde `fromNetwork === true`, se reescribe `/Registro-personal/index.html` en `CACHE_STATIC` con la respuesta fresca, de modo que el fallback offline nunca quede desfasado respecto al último deploy. Si la respuesta vino de caché (timeout/offline), no se toca.
- **`STATIC_ASSETS` actualizado**: se añadieron los 6 módulos faltantes (`activity-feed.js`, `export-backup.js`, `export-ics.js`, `focus-utils.js`, `global-search.js`, `settings.js`) y se versionaron las URLs de los assets con `?v=20260803` (`styles.css`, `ocio.css`, `app.js` y los fragmentos `ocio/*.html`).

### 2. `js/sw-register.js`: registro fiable y auto-aplicación de actualizaciones

- `register()` registra el SW con **`updateViaCache: 'none'`**, para que el navegador compruebe siempre si hay una versión nueva del SW (la comprobación HTTP del SW nunca queda servida por la caché HTTP).
- **Auto-aplicación del update sin toast**: se envía `postMessage({ type: 'SKIP_WAITING' })` si `registration.waiting` existe (actualización pendiente de un registro anterior) o cuando un nuevo worker pasa a estado `installed` con `navigator.serviceWorker.controller` presente.
- El **guard `refreshing`** se mantiene intacto: la recarga en `controllerchange` se ejecuta una sola vez, evitando recargas dobles.
- `notifyUpdateReady()` (y `applySWUpdate()`) se mantienen exportadas **por compatibilidad** con código existente; el registro ya no las usa.
- Se elimina la dependencia del toast de "Nueva versión disponible" documentado en ADR-007.

### 3. `index.html`: registro del SW restaurado y metas iOS

- **Bloque de registro restaurado** al final del body: import de `./js/sw-register.js` + llamada a `registerSW()` cuando el navegador soporta service workers.
- **3 refs versionadas** con `?v=20260803` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).
- **Metas iOS restauradas** (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`), eliminadas por la regresión del commit de accesibilidad `240d1b5`.

### 4. `js/config.js`: versión de la app centralizada

- Nuevo `export const APP_VERSION = '20260803'`, única fuente de verdad del número de versión de deploy/caché.

### 5. `js/app.js`: fragmentos ocio versionados

- Import de `APP_VERSION` desde `./config.js` y fetch de los fragmentos `ocio/*.html` con `'?v=' + APP_VERSION`, para que los cambios en esos parciales invaliden la caché en el cliente.

### 6. `scripts/bump-version.sh` (nuevo): bump de versión coherente

Script bash que centraliza el versionado de cada deploy:

- Sustituye `?v=<vieja>` → `?v=<nueva>` en `index.html` y `service-worker.js` (STATIC_ASSETS), y `APP_VERSION = '<vieja>'` → `APP_VERSION = '<nueva>'` en `js/config.js`.
- **Valida el argumento** (exactamente uno, solo `[0-9A-Za-z]+`, y modo `help`).
- **Verifica la coherencia** final de los tres archivos (aviso + salida `3` si algo no quedó coherente), de modo que olvidar el bump sea detectable y no se despliegue con versiones inconsistentes.

## Alternativas descartadas

- **`stale-while-revalidate` para los assets sin hashes**: descartado porque, sin versionado en las URLs, la estrategia devuelve al usuario la versión en caché (vieja) y solo actualiza en segundo plano, de modo que el cambio no se ve en la primera carga tras el deploy; no resuelve la percepción de "no se actualiza". La opción elegida (network-first en navegación + versionado) garantiza que el documento y los assets nuevos lleguen en la misma visita.
- **Solo bump del nombre de caché sin versionar los assets**: descartado porque, aunque el SW nuevo se instale, las URLs de los recursos no cambian y las entradas de la caché v2 se rellenarían con los mismos recursos viejos; además, no cubría el caso del registro roto (issue #25, punto 1).
- **Mantener el toast manual de actualización en lugar del auto-apply**: descartado porque el toast dependía de `notifyUpdateReady` que la página ya no disparaba tras la regresión, exigía interacción del usuario en cada deploy (fricción en móvil) y el problema de fondo era la estrategia de navegación, no la notificación. Se mantienen los exports por compatibilidad, pero el flujo activo es auto-aplicado.

## Consecuencias

### Positivas
- **La PWA instalada recibe los cambios de cada deploy**: con el registro restaurado y la navegación network-first, la entrada canónica de `index.html` se refresca en la caché estática y el usuario ve la nueva versión en su siguiente apertura, sin re-instalar la app.
- **Sin falsos "offline" en APIs**: el timeout solo aplica a navegación; las llamadas a APIs/Firestore mantienen network-first sin límite de tiempo y solo caen a caché o `503` ante fallos reales.
- **Navegación resiliente**: una red lenta o colgada ya no bloquea la carga del documento; a los 3 s se sirve el app shell en caché.
- **Auto-update sin fricción**: el usuario no tiene que pulsar ningún botón de "Actualizar" tras cada deploy.
- **Versionado centralizado y verificable**: `bump-version.sh` sincroniza los tres archivos y detecta incoherencias antes de desplegar.
- **Precacheo completo**: los 6 módulos que faltaban ya se incluyen en `STATIC_ASSETS`.

### Negativas
- **Latencia potencial en la navegación**: con red colgada, la primera carga espera hasta 3 s antes de servir la caché.
- **Doble fuente de versionado**: las refs `?v=` y `APP_VERSION` deben mantenerse sincronizadas en cada deploy; la omisión del `bump-version.sh` reintroduciría cachés desactualizadas (mitigado por la verificación de coherencia del script).
- **Recarga inesperada**: la auto-aplicación recarga la página cuando el SW nuevo toma control, lo que puede interrumpir al usuario en medio de una acción (recarga de una sola vez gracias al guard `refreshing`).
- **Coste de red por `updateViaCache: 'none'`**: el navegador comprueba el SW en cada carga, aunque sea una petición condicional (304) en la mayoría de casos.

### Neutras
- **Las cachés pasan a v2**: los usuarios con cachés v1 reciben la v2 en el primer `activate` del nuevo SW (las v1 se eliminan automáticamente).
- **Nuevo número de versión por deploy**: `20260803` es la versión inicial; cada deploy posterior debería incrementarla (día o secuencia) con `bump-version.sh`.
- **ADR-007 queda parcialmente superado**: la estrategia de navegación y el flujo de actualización descritos allí (toast de actualización) quedan reemplazados por este ADR; el resto de estrategias de caché siguen vigentes.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `service-worker.js` | Cachés `mi-registro-v2-*`, `fetchWithTimeout` (3 s solo navegación), `networkFirst` con `timeoutMs` opcional y `{ response, fromNetwork }`, fetch handler reordenado (navigate antes del own-path), refresco de la entrada canónica de `index.html` solo cuando `fromNetwork`, `STATIC_ASSETS` con los 6 módulos faltantes y URLs `?v=20260803` |
| `js/sw-register.js` | `register()` con `updateViaCache: 'none'`, auto-aplicación del update (`SKIP_WAITING`) sin toast, guard `refreshing` intacto, `notifyUpdateReady`/`applySWUpdate` exportadas por compatibilidad |
| `index.html` | Bloque de registro del SW restaurado al final del body (import `./js/sw-register.js` + `registerSW()`), 3 refs `?v=20260803`, metas iOS restauradas |
| `js/config.js` | Nuevo `export const APP_VERSION = '20260803'` |
| `js/app.js` | Import de `APP_VERSION` desde `./config.js` y fetch de fragmentos `ocio/*.html` con `?v=APP_VERSION` |
| `scripts/bump-version.sh` | **Nuevo**: sincroniza `?v=` y `APP_VERSION` entre `index.html`, `js/config.js` y `service-worker.js`; valida el argumento y verifica la coherencia final |
| `docs/adr-007-pwa-service-worker.md` | Nota inicial indicando que la estrategia de navegación y el flujo de actualización quedan superados por este ADR |
