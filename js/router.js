// =============================================================
// Router por hash de la sección «Ocio» (issue #59).
// Da a cada pestaña una URL propia y compartible
// (#/ocio/series, #/ocio/peliculas, #/ocio/libros) que funciona
// igual desplegado en la raíz que en subdirectorios por rama
// (_site/dev/<rama>/), porque solo mira el fragmento
// (location.hash) y nunca location.pathname.
// =============================================================

// Mapa clave de ruta → id del panel en index.html. Es la única
// fuente de verdad: añadir una pestaña futura solo requiere una
// entrada aquí.
export const KEY_TO_PANEL = {
  series: "panel-tv",
  peliculas: "panel-movies",
  libros: "panel-books",
};

// Ruta por defecto: la primera pestaña (Series).
export const DEFAULT_KEY = "series";

// Prefijo de la sección de ocio. Todo lo que no empiece por él se
// considera ajeno al router (p. ej. #main-content del skip-link).
const ROUTE_PREFIX = "/ocio";

// Devuelve la clave de ruta para un id de panel, o null si no
// existe ninguna (data-panel desconocido).
export function keyForPanel(panelId) {
  const entry = Object.entries(KEY_TO_PANEL).find(([, id]) => id === panelId);
  return entry ? entry[0] : null;
}

// Hash canónico para una clave: #/ocio/<clave>. Si la clave no es
// válida, saneamos a la clave por defecto.
export function hashForKey(key = DEFAULT_KEY) {
  return `#${ROUTE_PREFIX}/${KEY_TO_PANEL[key] ? key : DEFAULT_KEY}`;
}

// Hash canónico para un id de panel (p. ej. "panel-movies" → "#/ocio/peliculas").
export function hashForPanel(panelId) {
  return hashForKey(keyForPanel(panelId) || DEFAULT_KEY);
}

// Interpreta un fragmento (location.hash por defecto). Devuelve:
// - { key } para rutas válidas #/ocio[/series|/peliculas|/libros]
//   y los alias #/ocio y #/ocio/ (→ Series).
// - { key, default: true } para hash vacío, "#" o "#/": estado por
//   defecto cuya URL debe normalizarse a #/ocio/series.
// - { key: null, invalid: true } para hashes dentro del prefijo
//   #/ocio/ con segmento desconocido (también se normaliza).
// - { key: null } para hashes fuera del prefijo (p. ej.
//   #main-content del skip-link): no son rutas de ocio y se ignoran
//   en runtime.
export function parseHash(hash = location.hash) {
  const fragment = (hash || "").replace(/^#/, "");

  // Sin hash, "#" o "#/": caer al estado por defecto (Series).
  if (fragment === "" || fragment === "/") {
    return { key: DEFAULT_KEY, default: true };
  }

  // Dividir el fragmento en segmentos, ignorando barras repetidas
  // y la barra final (#/ocio/ → ["ocio"]).
  const segments = fragment.split("/").filter(Boolean);

  // Hashes ajenos al prefijo: no son rutas de la sección de ocio.
  if (segments[0] !== "ocio") {
    return { key: null };
  }

  // #/ocio y #/ocio/ son alias de la primera pestaña.
  if (segments.length === 1) {
    return { key: DEFAULT_KEY };
  }

  // #/ocio/<clave>: solo valen las tres claves conocidas.
  if (segments.length === 2 && KEY_TO_PANEL[segments[1]]) {
    return { key: segments[1] };
  }

  // Dentro del prefijo pero con segmento desconocido (o de más).
  return { key: null, invalid: true };
}

// Cambia al hash de una clave. Con replace: true se reemplaza la
// entrada actual del historial en vez de añadir una nueva. Si el
// hash ya es el objetivo, no hace nada (evita hashchange redundante).
export function navigate(key, { replace = false } = {}) {
  const target = hashForKey(key);
  if (location.hash === target) return;
  if (replace) {
    history.replaceState(null, "", target);
  } else {
    location.hash = target;
  }
}

// Arranca el router: aplica el hash de la carga inicial (carga
// directa o recarga), registra el listener de hashchange para
// atrás/adelante y cambios manuales, y devuelve la API del router.
export function initRouter({ onRoute }) {
  // Carga inicial: el hash decide la pestaña. Las URLs vacías o no
  // canónicas dentro del prefijo se normalizan a #/ocio/series con
  // replaceState (saneo sin ensuciar el historial). Los hashes
  // ajenos (p. ej. #main-content del skip-link) también aterrizan
  // en el estado por defecto, pero sin reescribir la URL.
  const initial = parseHash();
  if (initial.default || initial.invalid) {
    history.replaceState(null, "", hashForKey(DEFAULT_KEY));
  }
  onRoute({
    key: initial.key || DEFAULT_KEY,
    panelId: KEY_TO_PANEL[initial.key || DEFAULT_KEY],
  });

  // Runtime: solo se reacciona a hashes de ocio. Los ajenos al
  // prefijo se ignoran por completo, de modo que el skip-link
  // (#main-content) sigue funcionando sin cambiar de pestaña.
  const handleHashChange = () => {
    const parsed = parseHash();
    if (!parsed.key) return;
    if (parsed.default || parsed.invalid) {
      history.replaceState(null, "", hashForKey(DEFAULT_KEY));
    }
    onRoute({ key: parsed.key, panelId: KEY_TO_PANEL[parsed.key] });
  };

  window.addEventListener("hashchange", handleHashChange);

  return {
    // Clave de la ruta actual (o la por defecto si el hash es ajeno).
    getCurrentKey: () => parseHash().key || DEFAULT_KEY,
    parseHash,
    hashForKey,
    hashForPanel,
    keyForPanel,
    navigate,
    destroy: () => window.removeEventListener("hashchange", handleHashChange),
  };
}
