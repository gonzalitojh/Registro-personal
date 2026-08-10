// =============================================================
// Service Worker — Mi Registro (PWA offline support)
// Estrategias: Cache First para recursos estáticos,
// Network First para APIs externas, Network Only para
// escrituras y endpoints de autenticación.
// =============================================================

// -------------------------------------------------------------
// Base dinámica: cada rama se despliega en su propio
// subdirectorio (p. ej. …/<rama>/), así que
// todas las rutas se resuelven RELATIVAS al scope del propio SW
// (self.registration.scope). El mismo fichero sirve para la
// raíz (main) y para cada preview de rama, sin nada hardcodeado.
// -------------------------------------------------------------
const scopeURL = new URL(self.registration.scope);
const scopePath = scopeURL.pathname;
const resolved = (p) => new URL(p, scopeURL).toString();

const CACHE_STATIC = 'mi-registro-v4-static';
const CACHE_DYNAMIC = 'mi-registro-v4-dynamic';
const DYNAMIC_MAX_ENTRIES = 50;

// -------------------------------------------------------------
// Recursos precargados durante el evento "install".
// Rutas relativas al scope: se resuelven con `resolved()` en el
// install, así que valen igual en la raíz y en subdirectorios.
// -------------------------------------------------------------
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=20260902',
  './css/ocio.css?v=20260902',
  './js/app.js?v=20260902',
  './js/router.js',
  './js/ui.js',
  './js/db.js',
  './js/firebase.js',
  './js/config.js',
  './js/constants.js',
  './js/dates.js',
  './js/http.js',
  './js/retry.js',
  './js/release.js',
  './js/modal-handlers.js',
  './js/notifications-setup.js',
  './js/profile.js',
  './js/quick-actions.js',
  './js/rating-modal.js',
  './js/reading-log.js',
  './js/search.js',
  './js/sorting.js',
  './js/tv-progress.js',
  './js/watch-log.js',
  './js/daily-check.js',
  './js/undo-delete.js',
  './js/allowed-emails.js',
  './js/api-books.js',
  './js/api-movies.js',
  './js/api-games.js',
  './js/game-log.js',
  './js/sw-register.js',
  './js/activity-feed.js',
  './js/export-backup.js',
  './js/export-ics.js',
  './js/episode-actions-modal.js',
  './js/focus-utils.js',
  './js/global-search.js',
  './js/settings.js',
  './js/sidebar.js',
  './js/auto-hide-nav.js',
  './js/push.js',
  './resources/icon.png',
  './ocio/series.html?v=20260902',
  './ocio/peliculas.html?v=20260902',
  './ocio/libros.html?v=20260902',
  './ocio/videojuegos.html?v=20260902',
];

// -------------------------------------------------------------
// Install: precargar todos los recursos estáticos
// -------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // Usamos cache.addAll pero con manejo de errores individual
      // para que un recurso que falle no bloquee el resto
      return Promise.allSettled(
        STATIC_ASSETS.map((path) => {
          const url = resolved(path);
          return cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo precachear:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// -------------------------------------------------------------
// Activate: limpiar caches antiguas y tomar control
// -------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const allowedCaches = [CACHE_STATIC, CACHE_DYNAMIC];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !allowedCaches.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// -------------------------------------------------------------
// Helpers de caching
// -------------------------------------------------------------

/**
 * Cache First: responde desde la caché si existe; si no,
 * hace fetch, almacena en caché estática y responde.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Fallback offline: para navegación, devolver el app shell
    if (request.mode === 'navigate') {
      return caches.match(resolved('./index.html'));
    }
    throw err;
  }
}

/**
 * Fetch con timeout: evita que una red lenta o colgada bloquee
 * la navegación. Rechaza si la respuesta tarda más de `ms` ms,
 * lo que deja que el fallback de caché de networkFirst actúe.
 */
function fetchWithTimeout(request, ms = 3000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[SW] Timeout: la petición tardó más de ${ms}ms`)), ms)
  );
  return Promise.race([fetch(request), timeout]);
}

/**
 * Network First: intenta la red primero; si falla, busca en la
 * caché dinámica. Limita el número de entradas en caché.
 *
 * `timeoutMs` es opcional y SOLO debe usarse para navegación: evita
 * que una red lenta o colgada bloquee la carga del documento. Las
 * APIs externas y Firestore no llevan timeout para no provocar
 * falsos "offline" en redes lentas.
 *
 * Devuelve `{ response, fromNetwork }` para que el llamador sepa si
 * la respuesta vino de la red (y pueda refrescar caches canónicas).
 */
async function networkFirst(request, timeoutMs = null) {
  let fromNetwork = false;
  try {
    const response = timeoutMs
      ? await fetchWithTimeout(request, timeoutMs)
      : await fetch(request);
    if (response && response.ok) {
      fromNetwork = true;
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
      // Limitar tamaño de la caché dinámica
      trimCache(CACHE_DYNAMIC, DYNAMIC_MAX_ENTRIES);
    }
    return { response, fromNetwork };
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return { response: cached, fromNetwork: false };
    // Fallback para navegación
    if (request.mode === 'navigate') {
      return { response: await caches.match(resolved('./index.html')), fromNetwork: false };
    }
    // Para APIs, devolver un 503 amigable
    return {
      response: new Response(JSON.stringify({ error: 'offline', message: 'No hay conexión' }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }),
      fromNetwork: false,
    };
  }
}

/**
 * Limita la caché dinámica a un número máximo de entradas.
 * Elimina las más antiguas cuando se supera el límite.
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Eliminar las entradas más antiguas (las primeras de la lista)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

// -------------------------------------------------------------
// Fetch: enrutamiento de estrategias según el tipo de recurso
// -------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ---- Network Only: operaciones de escritura y auth ----
  if (
    url.hostname === 'firestore.googleapis.com' &&
    event.request.method !== 'GET'
  ) {
    return; // Pasan sin intervención del SW
  }

  if (
    url.hostname === 'identitytoolkit.googleapis.com' ||
    url.hostname === 'securetoken.googleapis.com'
  ) {
    return; // Pasan sin intervención del SW
  }

  // ---- Navegación: Network First (con timeout) y fallback al app shell ----
  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request, 3000).then(({ response, fromNetwork }) => {
        // Solo si vino de la red, refrescar la entrada canónica del
        // app shell en la caché estática, para que el fallback offline
        // nunca quede desfasado respecto al último deploy. Si la
        // respuesta vino de la caché (timeout/offline), no se toca.
        if (fromNetwork && response && response.ok) {
          caches
            .open(CACHE_STATIC)
            .then((cache) => cache.put(resolved('./index.html'), response.clone()))
            .catch((err) =>
              console.warn('[SW] No se pudo refrescar el app shell en caché:', err)
            );
        }
        return response;
      })
    );
    return;
  }

  // ---- Cache First: recursos estáticos propios ----
  if (url.pathname.startsWith(scopePath)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Firebase SDK (CDN) ----
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Google Fonts ----
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Chart.js ----
  if (
    url.hostname === 'cdnjs.cloudflare.com' &&
    url.pathname.includes('/Chart.js/')
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: imágenes de TMDB (posters) ----
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: portadas de Open Library ----
  if (url.hostname === 'covers.openlibrary.org') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: imágenes de IGDB (portadas) ----
  if (url.hostname === 'images.igdb.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Network First: APIs externas (TMDB, Google Books, Open Library) ----
  if (
    url.hostname === 'api.themoviedb.org' ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'openlibrary.org'
  ) {
    event.respondWith(networkFirst(event.request).then(({ response }) => response));
    return;
  }

  // ---- Network First: lecturas de Firestore (GET) ----
  if (
    url.hostname === 'firestore.googleapis.com' &&
    event.request.method === 'GET'
  ) {
    event.respondWith(networkFirst(event.request).then(({ response }) => response));
    return;
  }

  // ---- Todo lo demás: pasar sin intervención ----
});

// -------------------------------------------------------------
// Mensajes desde la página (ej: SKIP_WAITING para actualizar)
// -------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Notificación del sistema: la página (js/push.js) reenvía aquí
  // las notificaciones internas de la campana cuando la app está en
  // segundo plano y el usuario tiene activado el push de dispositivo.
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { id, message } = event.data || {};
    if (!id || typeof message !== 'string' || !message) return;
    event.waitUntil(
      self.registration.showNotification('Mi Registro', {
        body: message,
        icon: resolved('./resources/icon.png'),
        badge: resolved('./resources/icon.png'),
        tag: 'notif-' + id,
        data: { url: './index.html' },
      }).catch((err) => console.warn('[SW] showNotification falló:', err))
    );
  }
});

// -------------------------------------------------------------
// Clic en una notificación del sistema: llevar el foco a la ventana
// existente de la app o abrirla si no hay ninguna.
// -------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolved((event.notification.data && event.notification.data.url) || './index.html');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => client.url.startsWith(scopePath));
      if (existing) {
        return existing.focus();
      }
      return clients.openWindow(url);
    })
  );
});
