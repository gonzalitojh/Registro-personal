# ADR-037: Notificaciones del sistema (dispositivo) para las notificaciones internas (issue #84)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

Las notificaciones internas de la web (campana 🔔) se guardan en
Firestore (`users/{uid}/notifications`) y se muestran **solo dentro de la
web**: si la app está abierta pero no en primer plano (p. ej. PWA
instalada en el móvil en segundo plano, o pestaña de escritorio oculta),
el usuario no se entera de nada hasta que vuelve a mirarla.

La issue #84 pedía que esas notificaciones internas también lleguen al
**móvil** (y al escritorio) cuando la app está instalada como PWA.

Estado detectado en el código:

- **Arquitectura 100 % estática**: la app se sirve desde GitHub Pages y
  usa Firestore directamente; no hay backend ni Cloud Functions.
- Las notificaciones internas **solo se crean con una sesión de cliente
  abierta**: las genera `js/daily-check.js` (comprobación diaria:
  estrenos de películas/series, nuevos episodios, actividad de amigos)
  y las guarda `js/db.js` → `addNotification(uid, ...)`. Nunca se crean
  desde un servidor.
- `js/app.js` ya escucha el snapshot de `users/{uid}/notifications` con
  `subscribeToNotifications(...)` y renderiza la campana con
  `ui.renderNotifications(...)`.
- Ya existe `service-worker.js` con **base dinámica relativa al scope**
  (multi-rama, ADR-036) y `js/sw-register.js`, además de los ajustes de
  notificación por tipo (`settings.js` → `DEFAULT_SETTINGS.notifications`,
  toggles `notif-*` en `index.html`).

Related issue: #84 — https://github.com/gonzalitojh/Registro-personal/issues/84

## Decisión

Mostrar las notificaciones internas como **notificaciones del sistema**
(Notifications API + Service Worker local) cuando la app está abierta
pero **no en primer plano**. Como las notificaciones internas solo se
generan con una sesión abierta, el envío local desde la propia página al
service worker cubre el caso real, sin necesidad de un servidor de push.

### 1. Nuevo módulo `js/push.js` (puente campana → sistema)

- **Detección de notificaciones nuevas por `id`** sobre cada snapshot de
  Firestore: la **primera pasada por sesión se toma como baseline** (se
  registran los ids existentes y NO se notifica nada); en las pasadas
  posteriores solo se reenvían los ids no vistos.
- Los ids vistos se guardan en un `Set` (`seenIds`) con límite
  `MAX_SEEN = 500` (al superarlo se descartan los más antiguos).
- Solo se envía la notificación del sistema si se cumplen **las dos
  condiciones**: la preferencia `device_push` está activa
  (`loadSettings().notifications.device_push === true`) y
  `document.visibilityState !== 'visible'` (la app NO está en primer
  plano). Se usa únicamente `visibilityState`, no `document.hasFocus()`,
  para evitar falsos negativos en iOS standalone.
- El envío es **fire-and-forget**: `navigator.serviceWorker.ready` →
  `postMessage({ type: 'SHOW_NOTIFICATION', id, message })`, con el
  mensaje truncado a 140 caracteres, y errores silenciados (`catch`).
- `resetDevicePush()` limpia `seenIds` y el baseline; se llama en el
  logout para que la siguiente sesión no notifique notificaciones
  antiguas de la sesión anterior.

### 2. `service-worker.js` (mostrar y abrir)

- **Listener `message` → `SHOW_NOTIFICATION`**: valida `id` y `message` y
  llama a `self.registration.showNotification('Mi Registro', {...})` con:
  - `icon` y `badge` relativos al scope: `resolved('./resources/icon.png')`
    (multi-rama, ADR-036).
  - `tag: 'notif-' + id`: **deduplicación multi-pestaña** (dos pestañas
    con la misma notificación nueva no muestran dos avisos).
  - `data.url: './index.html'` (relativo, para abrir la rama correcta).
- **Listener `notificationclick`**: cierra la notificación, busca entre
  `clients.matchAll({ type: 'window', includeUncontrolled: true })` una
  ventana existente del scope (`client.url.startsWith(scopePath)`) y le
  da `focus()`; si no hay ninguna, `clients.openWindow(url)` con la ruta
  relativa.

### 3. Ajuste «Notificaciones en el dispositivo»

- Nuevo toggle en la card **Notificaciones** de Ajustes (`index.html`,
  id `notif-device`) con la hint «Avisos del sistema cuando la web no
  está en primer plano», bajo los toggles de tipo.
- Clave de preferencia: `settings.notifications.device_push` (default
  `false` en `DEFAULT_SETTINGS`), independiente de los toggles de tipo.
- **Permiso pedido en gesto de usuario**: el handler `change` ejecuta
  `Notification.requestPermission()` como **primera instrucción** (así
  el gesto cuenta para la API). Si el resultado no es `granted`, el
  toggle se revierte y se informa con un toast («Permiso denegado.
  Actívalo en los ajustes del navegador.»).
- **Sin soporte o permiso denegado → toggle deshabilitado**: en
  `renderSettings`, si el navegador no soporta `Notification` o el
  permiso está `denied`, el toggle se muestra desmarcado y deshabilitado.
  La preferencia guardada se conserva: si el usuario re-concede el
  permiso en el navegador, el toggle vuelve a aparecer marcado.
- `js/settings.js` importa los helpers de `js/push.js`
  (`isNotificationSupported`, `getPermission`,
  `requestDevicePushPermission`).

### 4. `js/app.js` (integración)

- Import de `handleNotificationsSnapshot` y `resetDevicePush`.
- `handleNotificationsSnapshot(notifications)` se llama **después** de
  `renderNotifications` en el callback de `subscribeToNotifications`.
- `resetDevicePush()` se llama en el logout (junto a `cleanupSettings()`).

### 5. Versionado PWA

`APP_VERSION` en `js/config.js` sube a `20260809` y
`scripts/bump-version.sh` sincroniza los `?v=20260809` de `index.html` y
`service-worker.js` (invalidación de cachés PWA). `js/push.js` se añade a
`STATIC_ASSETS` del service worker. `css/styles.css` añade las clases
`settings-row__text` / `settings-row__hint` para la fila del nuevo toggle.

## Alternativas descartadas

- **Push real con FCM + Cloud Functions** (notificación con la app
  totalmente cerrada): descartado — la arquitectura es 100 % estática
  (GitHub Pages + Firestore, sin backend) y añadir Cloud Functions
  implicaría dejar de ser estático, con costes y mantenimiento de un
  servidor. Además, las notificaciones internas solo se generan con una
  sesión abierta, por lo que el push local del SW cubre el caso real.
  Queda documentado como **evolución futura** si algún día hay backend:
  sería el único modo de notificar con la app cerrada del todo.
- **`new Notification()` desde la página**: descartado — no es fiable
  cuando la pestaña está oculta (los navegadores pueden suprimirlo) y no
  existe el canal del service worker para reutilizar el `notificationclick`
  con focus/abrir ventana.
- **Periodic Background Sync**: descartado — solo permite sincronizar
  datos en segundo plano; no tiene capacidad de mostrar notificaciones
  al usuario, que es justo lo que pide la issue.

## Consecuencias

### Positivas

- **Avisos en el sistema** cuando la app está abierta pero no en primer
  plano: móvil con la PWA instalada y escritorio con la pestaña oculta.
- **Sin spam al abrir**: el baseline por sesión evita notificar lo ya
  existente; solo se avisa de lo nuevo (por `id`).
- **Sin duplicados multi-pestaña**: el `tag` `notif-<id>` hace que el
  navegador deduplique avisos de la misma notificación.
- **Permiso solicitado correctamente**: en gesto de usuario, como exige
  la API; si se deniega, el toggle se revierte con un toast claro.
- **Multirrama**: icono/badge, `data.url` y la búsqueda de ventana del
  `notificationclick` usan rutas relativas al scope (herencia del
  ADR-036), así que funciona igual en la raíz y en cada preview de rama.
- **Ajuste independiente y conservador**: `device_push` es un toggle
  propio, desactivado por defecto, que no interfiere con los toggles de
  tipo de la campana.
- **Seguridad de sesión**: `resetDevicePush()` en el logout evita que la
  sesión siguiente notifique avisos antiguos de la anterior.

### Negativas / Riesgos

- **Sin notificación con la app cerrada del todo**: sin un servidor de
  push (FCM/Cloud Functions), el service worker local solo recibe
  mensajes mientras la página sigue viva (aunque esté en segundo plano);
  si se cierra la app, no hay nadie que detecte las notificaciones
  nuevas. Es una limitación inherente al enfoque, aceptada en la issue
  y documentada en el manual de usuario.
- **iOS**: requiere **16.4+** y que la app esté **instalada** («Añadir a
  pantalla de inicio»); sin instalación, Safari no entrega
  notificaciones web.
- **Firefox Android**: no soporta `showNotification` en service workers,
  por lo que el ajuste no podrá mostrar avisos en ese navegador.
- **Permisos revocables**: el usuario puede denegar el permiso en los
  ajustes del navegador en cualquier momento; el toggle queda
  deshabilitado hasta que lo re-conceda (la preferencia guardada se
  conserva).
- **Ventana de aviso acotada**: si la app está en primer plano cuando
  llega la notificación, no se muestra la del sistema (por diseño: el
  usuario ya está mirando la campana).
- **Memoria acotada**: `MAX_SEEN = 500` descarta los ids más antiguos;
  en la práctica es irrelevante para un uso normal.

### Neutras

- **PWA versionada a `20260809`**: `APP_VERSION`, `?v=` en `index.html`
  y `service-worker.js` invalidan las cachés previas.
- **`docs/manual-de-usuario.md` actualizado**: a diferencia del ADR-036,
  aquí sí hay cambio visible para el usuario (nuevo ajuste, avisos del
  sistema), por lo que aplica la obligación de AGENTS.md de actualizar
  el manual (secciones 12, 14 y 18).

## Nota de implementación

- El callback del snapshot en `app.js` llama primero a
  `renderNotifications` y después a `handleNotificationsSnapshot`; el
  baseline se toma en la **primera invocación** de la sesión, que
  coincide con la carga inicial de la lista.
- El `postMessage` al service worker es fire-and-forget: si el SW aún no
  está activo (`reg.active` null) o falla el envío, se ignora
  silenciosamente; el usuario verá la notificación en la campana igual.
- El handler del toggle hace el `requestPermission` antes de tocar
  `device_push`: así el clic del usuario cuenta como gesto para la API y
  la preferencia solo se guarda si el permiso queda concedido.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/push.js` | **Nuevo**: módulo puente campana → sistema: baseline por sesión, detección por `id` (`seenIds`, `MAX_SEEN`), condiciones `device_push` + `visibilityState`, `postMessage` `SHOW_NOTIFICATION`, helpers de soporte/permiso, `resetDevicePush()` |
| `service-worker.js` | Listener `message` `SHOW_NOTIFICATION` → `showNotification('Mi Registro', ...)` con `tag` de dedup y rutas relativas al scope; listener `notificationclick` → focus de ventana existente o `clients.openWindow`; `js/push.js` en `STATIC_ASSETS`; `?v=20260809` |
| `js/settings.js` | `device_push: false` en `DEFAULT_SETTINGS`; sincronización del toggle `notif-device`; deshabilitado si no hay soporte o permiso `denied`; handler `change` con `requestPermission()` en gesto de usuario, revertido + toast si se deniega |
| `index.html` | Toggle «Notificaciones en el dispositivo» (`id=notif-device`, hint) en la card Notificaciones de Ajustes; versionado `?v=20260809` |
| `js/app.js` | Import de `push.js`; `handleNotificationsSnapshot(notifications)` tras `renderNotifications` en el callback de `subscribeToNotifications`; `resetDevicePush()` en el logout |
| `js/config.js` | `APP_VERSION` de `20260808` a `20260809` |
| `css/styles.css` | Clases `settings-row__text` y `settings-row__hint` para la fila del nuevo toggle (con `min-width: 0` en flex, según reglas de responsividad de AGENTS.md) |
| `docs/adr-037-device-notifications.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | Secciones 12 (Notificaciones), 14 (Ajustes → Notificaciones) y 18 (Problemas frecuentes) actualizadas |

Related issue: #84 — https://github.com/gonzalitojh/Registro-personal/issues/84
