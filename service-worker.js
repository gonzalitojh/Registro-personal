// =============================================================
// Service Worker — Mi Registro (PWA offline support)
// Estrategias: Cache First para recursos estáticos,
// Network First para APIs externas, Network Only para
// escrituras y endpoints de autenticación.
// =============================================================

const CACHE_STATIC = 'mi-registro-v1-static';
const CACHE_DYNAMIC = 'mi-registro-v1-dynamic';
const DYNAMIC_MAX_ENTRIES = 50;

// -------------------------------------------------------------
// Recursos precargados durante el evento "install"
// -------------------------------------------------------------
const STATIC_ASSETS = [
  '/Registro-personal/',
  '/Registro-personal/index.html',
  '/Registro-personal/manifest.json',
  '/Registro-personal/css/styles.css',
  '/Registro-personal/ocio/ocio.css',
  '/Registro-personal/js/app.js',
  '/Registro-personal/js/ui.js',
  '/Registro-personal/js/db.js',
  '/Registro-personal/js/firebase.js',
  '/Registro-personal/js/config.js',
  '/Registro-personal/js/constants.js',
  '/Registro-personal/js/dates.js',
  '/Registro-personal/js/http.js',
  '/Registro-personal/js/modal-handlers.js',
  '/Registro-personal/js/notifications-setup.js',
  '/Registro-personal/js/profile.js',
  '/Registro-personal/js/quick-actions.js',
  '/Registro-personal/js/reading-log.js',
  '/Registro-personal/js/search.js',
  '/Registro-personal/js/sorting.js',
  '/Registro-personal/js/tv-progress.js',
  '/Registro-personal/js/watch-log.js',
  '/Registro-personal/js/daily-check.js',
  '/Registro-personal/js/undo-delete.js',
  '/Registro-personal/js/allowed-emails.js',
  '/Registro-personal/js/api-books.js',
  '/Registro-personal/js/api-movies.js',
  '/Registro-personal/js/sw-register.js',
  '/Registro-personal/resources/icon.png',
  '/Registro-personal/ocio/series.html',
  '/Registro-personal/ocio/peliculas.html',
  '/Registro-personal/ocio/libros.html',
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
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo precachear:', url, err);
          })
        )
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
      return caches.match('/Registro-personal/index.html');
    }
    throw err;
  }
}

/**
 * Network First: intenta la red primero; si falla, busca en
 * la caché dinámica. Limita el número de entradas en caché.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
      // Limitar tamaño de la caché dinámica
      trimCache(CACHE_DYNAMIC, DYNAMIC_MAX_ENTRIES);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback para navegación
    if (request.mode === 'navigate') {
      return caches.match('/Registro-personal/index.html');
    }
    // Para APIs, devolver un 503 amigable
    return new Response(JSON.stringify({ error: 'offline', message: 'No hay conexión' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
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

  // ---- Cache First: recursos estáticos propios ----
  if (url.pathname.startsWith('/Registro-personal/')) {
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

  // ---- Network First: APIs externas (TMDB, Google Books, Open Library) ----
  if (
    url.hostname === 'api.themoviedb.org' ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'openlibrary.org'
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ---- Network First: lecturas de Firestore (GET) ----
  if (
    url.hostname === 'firestore.googleapis.com' &&
    event.request.method === 'GET'
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ---- Navegación: intentar red, fallback a app shell ----
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/Registro-personal/index.html')
      )
    );
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
});
