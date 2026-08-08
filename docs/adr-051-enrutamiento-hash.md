# ADR-051: Enrutamiento por hash — URLs compartibles por pestaña y por sección de perfil (issue #59)

## Estado
Aceptado

## Fecha
2026-08-07 (ampliado 2026-08-08)

## Contexto

La app es una SPA estática **sin build** (módulos ES nativos) que se
despliega en GitHub Pages tanto en la raíz como en subdirectorios por
rama (`_site/dev/<rama>/`, ADR-036). Toda la navegación interna se
hacía en `index.html` y la sección Ocio (las tres colecciones Series,
Películas y Libros) usaba pestañas controladas en `js/app.js`:
ninguna de ellas tenía URL propia.

La issue #59 pide que cada pestaña tenga una URL propia y compartible
(el «endpoint /ocio»), que la pestaña activa se conserve al reabrir la
página y que los botones atrás/adelante del navegador cambien de
pestaña como si fueran parte de una misma página. Restricciones de
partida:

- **La ruta de despliegue varía** (raíz o bien `_site/dev/<rama>/`),
  así que un router que lea `location.pathname` daría rutas distintas
  en cada deploy: el router debe depender exclusivamente de
  `location.hash`.
- **El skip-link** de accesibilidad usa el hash `#main-content`
  (`href="#main-content"`): el enrutado no debe interceptarlo ni romper
  el salto de contenido.
- Existe un **service worker con caché de assets versionados**
  (ADR-007): cualquier módulo nuevo debe entrar en `STATIC_ASSETS` y
  los assets tocados deben subir su versión PWA.

Related issue: #59 — https://github.com/gonzalitojh/Registro-personal/issues/59

## Decisión

Implementar un **router por hash para la sección Ocio** con las rutas
`#/ocio` (Series, la pestaña por defecto), `#/ocio/series`,
`#/ocio/peliculas` y `#/ocio/libros`, en un módulo nuevo y sin
dependencias, orquestado por `js/app.js`.

### 1. Nuevo módulo `js/router.js` (sin dependencias, solo `location.hash`)

- **`KEY_TO_PANEL`** es la única fuente de verdad: mapea cada clave de
  ruta (`series`, `peliculas`, `libros`) al id de su panel
  (`panel-tv`, `panel-movies`, `panel-books`). Una pestaña futura solo
  requiere una entrada aquí.
- **`DEFAULT_KEY = "series"`** (primera pestaña) y
  **`ROUTE_PREFIX = "/ocio"`**: el prefijo de sección.
- **`parseHash(hash)`** interpreta el fragmento y devuelve un resultado
  tipado:
  - `{ key }` para rutas canónicas `#/ocio/<clave>` y los alias
    `#/ocio` y `#/ocio/` (→ Series).
  - `{ key, default: true }` para hash vacío, `"#"` o `"#/"` (estado
    por defecto cuya URL debe normalizarse).
  - `{ key: null, invalid: true }` para hashes dentro del prefijo con
    segmento desconocido (p. ej. `#/ocio/otracosa`).
  - `{ key: null }` para hashes **ajenos** al prefijo (p. ej.
    `#main-content` del skip-link): no son rutas de ocio y se ignoran.
- **`hashForKey` / `hashForPanel` / `keyForPanel`** producen los hashes
  canónicos y la clave de un panel, saneando a la clave por defecto.
- **`navigate(key, { replace })`**: apunta a `location.hash` la clave
  deseada (o `history.replaceState` si `replace: true`); si el hash ya
  es el objetivo, no hace nada (evita `hashchange` redundantes).
- **`initRouter({ onRoute })`** arranca el router, devuelve su API y
  `destroy()`:
  - **Carga inicial**: aplica el hash de la URL (carga directa o
    recarga). Los hashes vacíos/no canónicos se normalizan a
    `#/ocio/series` con `history.replaceState` (sin ensuciar el
    historial) y se llama a `onRoute` con la pestaña correspondiente.
  - **Runtime**: listener de `hashchange` (atrás/adelante del navegador
    y cambios manuales de hash). Solo reacciona a hashes de ocio: los
    ajenos al prefijo (`parsed.key === null`) se ignoran por completo,
    de modo que el skip-link (`#main-content`) sigue saltando al
    contenido sin cambiar de pestaña. Los no canónicos dentro del
    prefijo se re-normalizan con `replaceState` y se activa la pestaña.
  - El módulo **nunca lee `location.pathname`**: es la condición crítica
    del despliegue multi-rama (raíz y `_site/dev/<rama>/`).

### 2. `js/app.js`: extracción de `activatePanel(panelId, { moveFocus = false })`

El manejo de pestañas pasa de un listener inline repetido a una función
única que **replica el comportamiento previo**:

- Quita `is-active` a todas las pestañas y degrada `aria-selected` a
  `"false"`.
- Oculta todos los paneles y muestra el objetivo, con defensa ante un
  `data-panel` desactualizado (cae a `panel-tv` en vez de romper).
- La pestaña activa recupera `is-active` + `aria-selected="true"`, así
  que **`aria-selected` siempre refleja la pestaña activa real**.
- **El foco solo se mueve con `moveFocus: true`** (mismo patrón previo:
  `tabindex="-1"` + `focus()` al `h2` del panel, reutilizando el guard
  `if (heading)`).

### 3. Wiring: clic manual vs. activaciones por URL

- **Clic en pestaña** → `activatePanel(panelId, { moveFocus: true })`
  (foco al título del panel, reproduciendo el comportamiento tocado) +
  `router.navigate(keyForPanel(panelId))` para sincronizar la URL.
- **Router** (`initRouter` → `onRoute`) → `activatePanel(panelId)` **sin
  foco**: la activación por URL (carga directa, recarga, atrás/adelante,
  hash compartido) cambia visiblemente de pestaña pero **nunca roba el
  foco** del teclado.

### 4. Sidebar (js/sidebar.js): «Ocio» sincroniza con el router

La entrada «Ocio» de la barra lateral, además de cerrar el drawer y
hacer scroll suave al top, vuelve a la **última pestaña de Ocio** que
estuviera activa en la sesión y **sincroniza la URL** con
`router.navigate(getLastOcioKey())`. Desde la ampliación del perfil
(sección 6), este es también el destino del botón «← Volver» del
perfil: `getLastOcioKey()` recuerda la última pestaña de Ocio, de modo
que la vuelta desde el perfil aterriza donde el usuario estaba. El
callback `onGoOcio` lo inyecta `app.js` vía
`setupSidebar({ onGoOcio: () => router.navigate(getLastOcioKey()) })`,
el mismo patrón de inyección de `onOpenSettings` (ADR-035/ADR-039),
así que `sidebar.js` no importa el router.

### 5. PWA: bump de versión e inclusión del módulo nuevo

Sigue la práctica de los ADRs recientes (un bump por PR que toca
assets, cf. ADR-049):

- **`js/config.js`**: `APP_VERSION` `20260818` → `20260821`.
- **`service-worker.js`**: `STATIC_ASSETS` con `?v=20260821` en las URLs
  tocadas (`css/styles.css`, `ocio/ocio.css`, `js/app.js`,
  `ocio/series.html`, `ocio/peliculas.html`, `ocio/libros.html`) e
  **inclusión de `./js/router.js`** (sin `?v=`, como el resto de
  módulos JS).
- **`index.html`**: `?v=20260821` en las 3 referencias a CSS/JS
  (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).

### 6. Ampliación (comentario del usuario): rutas de Perfil

Tras la primera entrega, el usuario pidió el mismo enrutado para el
resto de la web (comentario en la issue #59): las **cinco secciones del
perfil** y el **detalle de un amigo** deben tener URL propia. Se amplía
el router sobre el mismo diseño (dos secciones de primer nivel bajo
prefijos propios):

- **`PROFILE_PREFIX = "/perfil"`** y mapa token (castellano) → sección
  interna en `js/profile.js`:
  `#/perfil/estadisticas` → `stats`, `#/perfil/amigos` → `friends`,
  `#/perfil/actividad` → `activity`, `#/perfil/datos` → `data` y
  `#/perfil/ajustes` → `settings`.
- **`#/perfil/amigos/<uid>`**: la ficha de un amigo tiene su propia
  URL. El uid se valida con `FIREBASE_UID_RE` (`[A-Za-z0-9._-]{1,128}`)
  tras `decodeURIComponent`; si no es válido o el amigo ya no existe,
  la URL se normaliza a la lista (`#/perfil/amigos`) y se muestra la
  lista.
- **Aliases**: `#/perfil` y `#/perfil/` son aliases de Estadísticas
  (`default: true`, se normalizan con `replaceState`). Los tokens
  desconocidos y los segmentos de más también se normalizan (mismo
  patrón de Ocio: `default: true, invalid: true`).
- **`navigate()` acepta ahora dos formas**: string (clave de Ocio,
  retrocompatibilidad) u objeto `{ section: "perfil", profileSection,
  uid? }` (y de Ocio). `canonicalHashFor()` produce el hash canónico de
  ambas secciones; el no-op si el hash ya es el objetivo se mantiene.
- **`onRoute` en `app.js`** despacha por sección: perfil →
  `profileApi.openProfileSection(section, ctx, { fromRouter: true,
  friendUid })`; ocio → cerrar perfil y activar pestaña.
  `profileApi` se declara antes de `initRouter` (la carga inicial puede
  pedir una ruta de perfil sin sesión: el `onRoute` la ignora y, tras el
  login, `router.applyRoute()` la retoma — guard en
  `watchAuthState`).
- **`js/profile.js`**: la UI ya no abre secciones directamente; **solo
  navega** (`navigate({ section: "perfil", profileSection, uid? })`) y
  el router hace el render vía `openProfileSection` con `fromRouter`,
  evitando dobles fetchs (p. ej. el clic en una tarjeta de amigo navega
  a `#/perfil/amigos/<uid>` y `openFriendByUid` reutiliza la carga de
  la lista). El botón «Volver» del perfil cierra la vista y navega a la
  última pestaña de Ocio activa (`getLastOcioKey()`).
- **`getCurrentSection()`** devuelve `"ocio" | "perfil" | null` (null =
  hash ajeno) y **`getLastOcioKey()`** recuerda la última pestaña de
  Ocio de la sesión para las vueltas desde el perfil.
- **PWA**: la ampliación toca `js/router.js` y `js/profile.js`
  (módulos, sin `?v=`), así que solo se sube `APP_VERSION` de
  `20260821` a `20260823` en `config.js`, `index.html` (×3) y
  `service-worker.js` (×6).

## Alternativas descartadas

- **History API con `location.pathname` (`#/ocio` → `/ocio`)**: descartado
  — el despliegue multi-rama (raíz y `_site/dev/<rama>/`) hace que la
  base cambie por rama; una ruta real exige `<base>` o lógica de puerto
  que rompe el servido estático de Pages. El hash es el único mecanismo
  estable sin build ni configuración de servidor.
- **Router en el switch del click sin módulo aparte**: descartado — el
  parseo del hash, la normalización de URL y el listener de `hashchange`
  son lógica de infraestructura que merece un módulo sin dependencias
  (patrón del resto de `js/`).
- **Router en el switch del click sin módulo aparte**: descartado — el
  parseo del hash, la normalización de URL y el listener de `hashchange`
  son lógica de infraestructura que merece un módulo sin dependencias
  (patrón del resto de `js/`).
- **Rutas de perfil por sección sin uid en la URL**: descartado — el
  detalle de un amigo es un estado navegable; sin su uid en la URL no
  se podría compartir ni volver con atrás/adelante a una ficha concreta.
- **Normalizar también los hashes ajenos (`#main-content`)**: descartado
  — el skip-link requiere que el fragmento `#main-content` aterrice en
  el elemento `id="main-content"`; reescribir la URL o cambiar la pestaña
  rompería el salto de contenido.
- **Mover el foco también en activaciones por URL**: descartado — la
  activación por URL (atrás/adelante, recarga, hash compartido) roba el
  foco del teclado y desorienta a usuarios de lector de pantalla; el
  foco solo se mueve en el clic manual (`moveFocus` exitoso).

## Consecuencias

### Positivas

- **URLs compartibles y favoritos**: cada pestaña tiene una URL estable
  que se puede compartir, marcar o enviar a otro dispositivo; al
  abrirla, la web se muestra directamente en esa pestaña.
- **Historial del navegador útil**: atrás/adelante cambian de pestaña
  mediante `hashchange`, como si fueran parte de la misma página.
- **URL sanitizada sin ensuciar el historial**: hashes vacíos, `"#"`,
  `"#/"` y `#/ocio/<desconocido>` se normalizan con
  `history.replaceState` a `#/ocio/series` (sin entradas extra), o
  sea, sin pila degradada ni ruido en consola.
- **Skip-link intacto**: los hashes ajenos al prefijo se ignoran en
  runtime; el salto de contenido (`#main-content`) sigue funcionando.
- **Sin dependencias y sin `pathname`**: el router funciona igual en la
  raíz que en cualquier subdirectorio de rama, y añadir una pestaña
  futura solo requiere una entrada en `KEY_TO_PANEL`.
- **ARIA correcto**: `aria-selected` siempre refleja la pestaña activa,
  y las activaciones por URL nunca roban el foco (solo el clic manual
  lo mueve, replicando el comportamiento previo).
- **Bono de orquestación**: la lógica de clic de pestañas se extrae a
  `activatePanel` (reutilizable y defensivo) y la sidebar «Ocio» y el
  «← Volver» del perfil vuelven a la última pestaña de Ocio activa
  (`getLastOcioKey()`) sincronizando la URL con un callback inyectado.

### Negativas / Riesgos

- **El hash no es silencioso en pantalla**: la URL se muestra con
  `#/ocio/...` en la barra de direcciones; asumido (es el mecanismo por
  defecto de GitHub Pages en SPA estáticas).
- **`js/router.js` es un asset nuevo del SW**: si se olvida en
  `STATIC_ASSETS` en futuras ediciones, el service worker podría servir
  una versión desactualizada; la inclusión en esta PR es explícita.
- **La normalización de la carga inicial usa `replaceState`**: si el
  usuario abre la app con un hash vacío/no canónico, la URL se reescribe
  a `#/ocio/series` (efecto deseado y reentrante, pero se ve en la barra
  de direcciones).

### Neutras

- **Manual de usuario actualizado** (regla 3 de AGENTS.md — cambio
  visible para el usuario): subsección 3.1 «Compartir direcciones
  y volver a las pestañas» (direcciones `#/ocio/...`) y subsección
  13.0 con las direcciones del perfil (`#/perfil/...`).
- **Carga inicial y recarga**: el hash decide la pestaña/sección en
  ambos casos (la vista se reabre al cargar o recargar).
- **Sin cambios en API/DB/styles**: la PR no afecta a datos ni a la
  maquetación; solo `index.html` (bump `?v=`), `app.js`, `profile.js`,
  `sidebar.js`, `config.js`, `service-worker.js` y el módulo nuevo.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/router.js` | **Nuevo**: módulo de enrutado por hash sin dependencias (`KEY_TO_PANEL`, `DEFAULT_KEY`, `ROUTE_PREFIX`, `PROFILE_PREFIX`, mapas `PROFILE_KEY_TO_SECTION`/`PROFILE_SECTION_TO_KEY`, `FIREBASE_UID_RE`, `parseHash`, `hashForKey`/`hashForPanel`/`keyForPanel`/`profileHashKey`, `navigate`, `initRouter` con `onRoute`/`destroy`, `getCurrentSection`/`getLastOcioKey`). Solo `location.hash`, nunca `location.pathname`; normalización con `history.replaceState`; los hashes ajenos al prefijo se ignoran en runtime |
| `js/app.js` | **Modificado**: import de `initRouter`/`keyForPanel`/`getLastOcioKey`; extracción de `activatePanel(panelId, { moveFocus = false })` (quita `is-active` y degrada `aria-selected` de todas, oculta paneles, muestra el objetivo con defensa cayendo a `panel-tv`, foco al `h2` solo si `moveFocus`); clic de pestaña → `activatePanel(moveFocus: true)` + `router.navigate`; `initRouter({ onRoute })` despacha Ocio/Perfil (`profileApi.openProfileSection(section, ctx, { fromRouter: true, friendUid })`; `let profileApi = null` antes del router y re-aplicación de la ruta tras el login); `setupSidebar` recibe `onOpenSettings` (→ `#/perfil/ajustes`) y `onGoOcio` (→ última pestaña de Ocio) |
| `js/profile.js` | **Modificado**: la UI navega por router (subtabs, dropdown `[data-section]`, tarjetas de amigo, «← Volver» del perfil → `navigate(getLastOcioKey())`, «← Volver a amigos» → `#/perfil/amigos`); `openProfileSection(section, ctx, { fromRouter, friendUid })` respeta el render solo vía router; `openFriendCard` → `navigate({ section: "perfil", profileSection: "friends", uid })`; `openFriendByUid` reutiliza la lista y cae a la lista si el uid no existe |
| `js/sidebar.js` | **Modificado**: entrada «Ocio» añade, tras el scroll suave al top, `if (onGoOcio) onGoOcio()`; variable de módulo `onGoOcio = null` que `setupSidebar` inyecta desde `opts.onGoOcio` (mismo patrón que `onOpenSettings`) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260818` → `20260821` (iteración 1) y `20260823` (ampliación Perfil) |
| `service-worker.js` | **Modificado**: `STATIC_ASSETS` — inclusión de `./js/router.js` y bump `?v=` `20260818` → `20260821` en las 6 URLs de CSS/JS/HTML tocadas; ampliación: bump a `20260823` |
| `index.html` | **Modificado**: bump `?v=20260821` (×3) e iteración 2: `?v=20260823` (×3) |
| `docs/manual-de-usuario.md` | **Modificado**: subsección 3.1 («Compartir y volver a las pestañas») y, con la ampliación, subsección 13.0 «Compartir direcciones de tu perfil» |
| `tasks/task-issue-59.json` | Task file de la tarea (title/description, plan de cambios, criterios de aceptación y bloque `issue` con la issue #59) |
| `docs/adr-051-enrutamiento-hash.md` | **Nuevo**: este documento (sección 6 con la ampliación a Perfil) |

Related issue: #59 — https://github.com/gonzalitojh/Registro-personal/issues/59