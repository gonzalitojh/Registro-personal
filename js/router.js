// =============================================================
// Router por hash de la aplicación (issue #59).
// Da a cada vista una URL propia y compartible que funciona igual
// desplegado en la raíz que en subdirectorios por rama
// (_site/dev/<rama>/), porque solo mira el fragmento
// (location.hash) y nunca location.pathname.
//
// Dos grandes «secciones» de la web:
//   - Ocio: las cuatro pestañas de la biblioteca
//     (#/ocio/series, #/ocio/peliculas, #/ocio/libros,
//     #/ocio/videojuegos).
//   - Perfil: Estadísticas, Amigos (con id por amigo), Actividad y
//     Ajustes (#/perfil/...). El antiguo token «datos» sobrevive
//     como alias de Ajustes (issue #135).
//   - Recetas (issue #64): Recetas, Menú y Lista de la compra
//     (#/recetas, #/recetas/menu, #/recetas/compra).
//   - Gimnasio (issue #62): Resumen, Entrenos y Ejercicios
//     (#/gimnasio, #/gimnasio/resumen).
//
// Además de las memorias por sección (lastOcioKey, lastRecipesTab,
// lastGymTab), el router guarda la última sección de primer nivel
// visitada (lastSection, issue #213): es la que usa la flecha de
// volver del perfil para regresar a Ocio, Recetas o Gimnasio según
// de dónde viniera el usuario, no siempre a Ocio.
//
// El resto de hashes (p. ej. #main-content del skip-link) se
// considera ajeno al router y se ignora sin tocar el estado.
// =============================================================

// Mapa clave de ruta de Ocio → id del panel en index.html. Es la
// única fuente de verdad: añadir una pestaña futura solo requiere
// una entrada aquí.
export const KEY_TO_PANEL = {
  series: "panel-tv",
  peliculas: "panel-movies",
  libros: "panel-books",
  videojuegos: "panel-games",
};

// Ruta por defecto de Ocio: la primera pestaña (Series).
export const DEFAULT_KEY = "series";

// Mapa token de ruta de Recetas → id del panel en index.html.
export const RECIPES_TAB_TO_PANEL = {
  recetas: "panel-recipes-tab",
  ingredientes: "panel-ingredients-tab",
  menu: "panel-menu-tab",
  compra: "panel-shopping-tab",
};

// Pestaña por defecto de Recetas (#/recetas).
export const RECIPES_DEFAULT_TAB = "recetas";

// Mapa token de ruta de Gimnasio → id del panel en index.html
// (issue #62; #/gimnasio/resumen añadido en #269). Solo la primera
// pestaña «Resumen» (por defecto) se canoniza sin segmento:
// #/gimnasio.
export const GYM_TAB_TO_PANEL = {
  resumen: "panel-gym-summary-tab",
  entrenos: "panel-gym-workouts-tab",
  ejercicios: "panel-gym-exercises-tab",
};

// Pestaña por defecto de Gimnasio (#/gimnasio): la primera (Resumen).
export const GYM_DEFAULT_TAB = "resumen";

// Prefijos de las secciones de primer nivel. Todo lo que no
// empiece por uno de ellos se considera ajeno al router.
const ROUTE_PREFIX = "/ocio";
const PROFILE_PREFIX = "/perfil";
const RECIPES_PREFIX = "/recetas";
const GYM_PREFIX = "/gimnasio";

// Mapa token de URL (castellano) → id interno de la sección del
// perfil. El token público es humano y consistente con las claves
// de Ocio; el id interno alimenta js/profile.js.
const PROFILE_KEY_TO_SECTION = {
  estadisticas: "stats",
  amigos: "friends",
  actividad: "activity",
  // Legado (issue #135): la pestaña «Datos» se unificó en Ajustes,
  // pero #/perfil/datos sigue funcionando como alias y abre Ajustes.
  // NO reordenar: el inverso (Object.fromEntries) deja ganar a la
  // última clave, y «ajustes» debe quedar después de «datos» para
  // que el canónico siga siendo #/perfil/ajustes.
  datos: "settings",
  ajustes: "settings",
};

// Inverso del mapa anterior: id interno → token de URL.
const PROFILE_SECTION_TO_KEY = Object.fromEntries(
  Object.entries(PROFILE_KEY_TO_SECTION).map(([k, v]) => [v, k])
);

// Sección por defecto del perfil (Estadísticas) para sus aliases.
const PROFILE_DEFAULT_KEY = "estadisticas";

// Los uid de Firebase solo admiten [A-Za-z0-9._-] y acotan el
// segmento de amigo en la URL (#/perfil/amigos/<uid>).
const FIREBASE_UID_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Ruta de detalle de un ítem de Ocio (issue #285): segmento conocido
// de Ocio (series|peliculas) + id del ítem → página de ficha en vez
// de modal. El mapa relaciona el token de URL público (castellano,
// consistente con las claves de Ocio) con el tipo interno de ítem.
// LIBROS y VIDEOJUEGOS no tienen ruta de ítem: siguen abriendo su
// modal (la issue #285 solo cubre series y películas).
const ITEM_KEY_TO_KIND = {
  series: "tv",
  peliculas: "movie",
};

// Los externalId admitidos son los de TMDB (numéricos) y los
// sintéticos de alta manual ("manual-…"): el mismo alfabeto que los
// uid de Firebase, con un tope de longitud cómodo.
const ITEM_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

// Ruta de detalle de una PERSONA (issue #321): el token público
// "personas" (plural, consistente con "series"/"peliculas") + el id
// de TMDB de la persona → página de la persona (foto, biografía,
// créditos y premios), con el mismo patrón de página nueva que el
// ítem (ADR-100). No es una pestaña de Ocio: no tiene entrada en la
// barra lateral ni actualiza las memorias del router.
const PERSON_KEY = "personas";

// Id de persona en la URL: mismos ids de TMDB (numéricos) — el mismo
// alfabeto de ITEM_ID_RE; la persona nunca es "manual-…" (los datos
// vienen siempre de TMDB).
const PERSON_ID_RE = ITEM_ID_RE;

// Devuelve la clave de ruta de Ocio para un id de panel, o null si
// no existe ninguna (data-human desconocido).
export function keyForPanel(panelId) {
  const entry = Object.entries(KEY_TO_PANEL).find(([, id]) => id === panelId);
  return entry ? entry[0] : null;
}

// Hash canónico de Ocio para una clave: #/ocio/<clave>. Si la clave
// no es válida, saneamos a la clave por defecto.
export function hashForKey(key = DEFAULT_KEY) {
  return `#${ROUTE_PREFIX}/${KEY_TO_PANEL[key] ? key : DEFAULT_KEY}`;
}

// Hash canónico de Ocio para un id de panel (p. ej. "panel-movies").
export function hashForPanel(panelId) {
  return hashForKey(keyForPanel(panelId) || DEFAULT_KEY);
}

// Hash canónico de Recetas para una pestaña: #/recetas/<tab>. Si la
// pestaña no es válida, saneamos a la pestaña por defecto.
export function recipesHashFor(tab = RECIPES_DEFAULT_TAB) {
  const safe = RECIPES_TAB_TO_PANEL[tab] ? tab : RECIPES_DEFAULT_TAB;
  // La pestaña por defecto se canoniza como #/recetas (sin segmento).
  return safe === RECIPES_DEFAULT_TAB ? `#${RECIPES_PREFIX}` : `#${RECIPES_PREFIX}/${safe}`;
}

// Hash canónico de Gimnasio para una pestaña: #/gimnasio/<tab>. Si la
// pestaña no es válida, saneamos a la pestaña por defecto.
export function gymHashFor(tab = GYM_DEFAULT_TAB) {
  const safe = GYM_TAB_TO_PANEL[tab] ? tab : GYM_DEFAULT_TAB;
  // La pestaña por defecto se canoniza como #/gimnasio (sin segmento).
  return safe === GYM_DEFAULT_TAB ? `#${GYM_PREFIX}` : `#${GYM_PREFIX}/${safe}`;
}

// Hash canónico de Perfil para una sección (id interno) y, si es la
// sección de amigos, opcionalmente el uid. Un id desconocido cae a
// la sección por defecto (Estadísticas).
export function profileHashKey(profileSection, uid) {
  const token = PROFILE_SECTION_TO_KEY[profileSection] || PROFILE_DEFAULT_KEY;
  if (token === "amigos" && uid) {
    return `#${PROFILE_PREFIX}/amigos/${encodeURIComponent(uid)}`;
  }
  return `#${PROFILE_PREFIX}/${token}`;
}

// Hash canónico de la página de detalle de un ítem de Ocio (issue
// #285): #/ocio/series/<externalId> o #/ocio/peliculas/<externalId>.
// kind: "tv" | "movie"; un kind desconocido cae a películas.
export function itemHashFor(kind, externalId) {
  const token = Object.entries(ITEM_KEY_TO_KIND).find(([, k]) => k === kind)?.[0] || "peliculas";
  return `#${ROUTE_PREFIX}/${token}/${encodeURIComponent(externalId)}`;
}

// Hash canónico de la página de una persona (issue #321):
// #/ocio/personas/<personId> (id de TMDB de la persona).
export function personHashFor(personId) {
  return `#${ROUTE_PREFIX}/${PERSON_KEY}/${encodeURIComponent(personId)}`;
}

// Interpreta un fragmento (location.hash por defecto). Contrato:
// - Ocio    → { section:"ocio", key, panelId } (+ default/invalid).
// - Ítem    → { section:"item", kind:"tv"|"movie", externalId }.
// - Persona → { section:"person", personId } (issue #321).
// - Perfil  → { section:"perfil", profileSection, uid? } (+default/invalid).
// - Recetas → { section:"recetas", tab, panelId } (+ default/invalid).
// - Gimnasio→ { section:"gimnasio", tab, panelId } (+ default/invalid).
// - Vacío   → ruta por defecto global (Ocio Series).
// - Ajeno   → { section:null } (se ignora en runtime).
export function parseHash(hash = location.hash) {
  const fragment = (hash || "").replace(/^#/, "");

  // Sin hash, "#" o "#/": caer al estado por defecto global.
  if (fragment === "" || fragment === "/") {
    return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true };
  }

  const segments = fragment.split("/").filter(Boolean);
  const first = segments[0];

  // Hashes ajenos a las secciones: no son rutas de la web.
  if (first !== "ocio" && first !== "perfil" && first !== "recetas" && first !== "gimnasio") {
    return { section: null };
  }

  // ---------- RECETAS ----------
  // #/recetas y #/recetas/ son alias de la primera pestaña.
  if (first === "recetas") {
    if (segments.length === 1) {
      return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true };
    }
    // #/recetas/<tab>: solo valen las pestañas conocidas.
    if (segments.length === 2 && RECIPES_TAB_TO_PANEL[segments[1]]) {
      if (segments[1] === RECIPES_DEFAULT_TAB) {
        // #/recetas/recetas no es canónico: se normaliza a #/recetas.
        return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true, invalid: true };
      }
      return { section: "recetas", tab: segments[1], panelId: RECIPES_TAB_TO_PANEL[segments[1]] };
    }
    // Dentro del prefijo pero con segmento desconocido (o de más).
    return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true, invalid: true };
  }

  // ---------- GIMNASIO ----------
  // #/gimnasio y #/gimnasio/ son alias de la primera pestaña.
  if (first === "gimnasio") {
    if (segments.length === 1) {
      return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true };
    }
    // #/gimnasio/<tab>: solo valen las pestañas conocidas.
    if (segments.length === 2 && GYM_TAB_TO_PANEL[segments[1]]) {
      if (segments[1] === GYM_DEFAULT_TAB) {
        // #/gimnasio/resumen no es canónico: se normaliza a #/gimnasio.
        return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true, invalid: true };
      }
      return { section: "gimnasio", tab: segments[1], panelId: GYM_TAB_TO_PANEL[segments[1]] };
    }
    // Dentro del prefijo pero con segmento desconocido (o de más).
    return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true, invalid: true };
  }

  // ---------- PERFIL ----------
  if (first === "perfil") {
    // #/perfil y #/perfil/ son aliases de Estadísticas.
    if (segments.length === 1) {
      return { section: "perfil", profileSection: "stats", default: true };
    }
    const profileSection = PROFILE_KEY_TO_SECTION[segments[1]];
    // Token de sección desconocido → saneado a la sección por defecto.
    if (!profileSection) {
      return { section: "perfil", profileSection: "stats", default: true, invalid: true };
    }
    // #/perfil/amigos/<uid>: tercer segmento con el uid del amigo.
    if (profileSection === "friends" && segments.length === 3) {
      let uid = segments[2];
      try {
        uid = decodeURIComponent(uid);
      } catch {
        uid = "";
      }
      if (!FIREBASE_UID_RE.test(uid)) {
        return { section: "perfil", profileSection: "friends", default: true, invalid: true };
      }
      return { section: "perfil", profileSection: "friends", uid };
    }
    // Demasiados segmentos (o amigos sin uid) → lista de amigos.
    if (segments.length > 2) {
      return { section: "perfil", profileSection, default: true, invalid: true };
    }
    return { section: "perfil", profileSection };
  }

  // ---------- OCIO ----------
  // #/ocio y #/ocio/ son alias de la primera pestaña.
  if (segments.length === 1) {
    return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true };
  }
  // #/ocio/<clave>/<id>: página de detalle de un ítem (issue #285)
  // o de una persona (issue #321). El id se valida (alfabeto acotado)
  // tras decodeURIComponent, como el uid de amigo.
  if (segments.length === 3) {
    // Persona: #/ocio/personas/<personId> (issue #321).
    if (segments[1] === PERSON_KEY) {
      let personId = segments[2];
      try {
        personId = decodeURIComponent(personId);
      } catch {
        personId = "";
      }
      if (PERSON_ID_RE.test(personId)) {
        return { section: "person", personId };
      }
      // Id inválido → saneado a la pestaña por defecto (URL canónica).
      return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true, invalid: true };
    }
    // Ítem: solo series y películas tienen ruta de ítem.
    if (Object.prototype.hasOwnProperty.call(ITEM_KEY_TO_KIND, segments[1])) {
      let externalId = segments[2];
      try {
        externalId = decodeURIComponent(externalId);
      } catch {
        externalId = "";
      }
      if (ITEM_ID_RE.test(externalId)) {
        return { section: "item", kind: ITEM_KEY_TO_KIND[segments[1]], externalId };
      }
      // Id inválido → saneado a la pestaña por defecto (URL canónica).
      return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true, invalid: true };
    }
  }
  // #/ocio/<clave>: solo valen las cuatro claves conocidas.
  if (segments.length === 2 && KEY_TO_PANEL[segments[1]]) {
    return { section: "ocio", key: segments[1], panelId: KEY_TO_PANEL[segments[1]] };
  }
  // Dentro del prefijo pero con segmento desconocido (o de más).
  return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true, invalid: true };
}

// Hash canónico para una ruta (ocio, perfil, recetas, gimnasio,
// detalle de ítem o detalle de persona) según su forma. Usada por
// navigate() para normalizar.
function canonicalHashFor(route) {
  if (route?.section === "perfil") {
    return profileHashKey(route.profileSection, route.uid);
  }
  if (route?.section === "recetas") {
    return recipesHashFor(route.tab);
  }
  if (route?.section === "gimnasio") {
    return gymHashFor(route.tab);
  }
  if (route?.section === "item") {
    return itemHashFor(route.kind, route.externalId);
  }
  if (route?.section === "person") {
    return personHashFor(route.personId);
  }
  return hashForKey(route?.key || DEFAULT_KEY);
}

// Memoria de la última clave de Ocio de la sesión: «Volver» desde el
// perfil y la entrada «Ocio» de la sidebar vuelven a esa pestaña.
let lastOcioKey = DEFAULT_KEY;

export function getLastOcioKey() {
  return lastOcioKey || DEFAULT_KEY;
}

// Memoria de la última pestaña de Recetas de la sesión: la entrada
// «Recetas» de la sidebar vuelve a esa pestaña (issue #64).
let lastRecipesTab = RECIPES_DEFAULT_TAB;

export function getLastRecipesTab() {
  return RECIPES_TAB_TO_PANEL[lastRecipesTab] ? lastRecipesTab : RECIPES_DEFAULT_TAB;
}

// Memoria de la última pestaña de Gimnasio de la sesión: la entrada
// «Gimnasio» de la sidebar vuelve a esa pestaña (issue #62).
let lastGymTab = GYM_DEFAULT_TAB;

export function getLastGymTab() {
  return GYM_TAB_TO_PANEL[lastGymTab] ? lastGymTab : GYM_DEFAULT_TAB;
}

// Memoria de la última sección de primer nivel (ocio | recetas |
// gimnasio) de la sesión: la flecha de volver del perfil regresa a
// esa sección (issue #213). Las rutas de perfil NO la actualizan a
// propósito: solo las secciones de contenido dejan rastro al entrar
// en el perfil.
let lastSection = "ocio";

export function getLastSection() {
  return lastSection || "ocio";
}

// Cambia al hash de un objetivo. target puede ser:
//   - string: clave de Ocio (retrocompatibilidad, "series").
//   - objeto { section:"perfil", profileSection, uid? } (o de Ocio).
// Con replace:true se sustituye la entrada actual del historial
// (normalización de URLs no canónicas) en vez de añadir una. Si el
// hash ya es el objetivo, no hace nada (evita hashchange redundante).
export function navigate(routeOrKey, { replace = false } = {}) {
  const target = canonicalHashFor(
    typeof routeOrKey === "string" ? { key: routeOrKey } : routeOrKey
  );
  if (location.hash === target) return;
  if (replace) {
    history.replaceState(null, "", target);
  } else {
    location.hash = target;
  }
}

// Arranca el router: aplica el hash de la carga inicial, registra el
// listener de hashchange (atrás/adelante y navegación) y devuelve la
// API. onRoute recibe la ruta interpretada (ver parseHash).
export function initRouter({ onRoute }) {
  // Aplica una ruta: normaliza con replaceState si no es canónica y
  // notifica al consumidor (que decide cómo pintar). Sin argumentos
  // re-lee location.hash (p. ej. tras el login, para retomar la ruta
  // de perfil que pedía la recarga).
  function applyRoute(route = parseHash()) {
    if (!route?.section) return; // ajenos: no tocar el estado
    if (route.section === "ocio") {
      lastSection = "ocio";
      lastOcioKey = route.key || DEFAULT_KEY;
    } else if (route.section === "recetas") {
      lastSection = "recetas";
      lastRecipesTab = route.tab || RECIPES_DEFAULT_TAB;
    } else if (route.section === "gimnasio") {
      lastSection = "gimnasio";
      lastGymTab = route.tab || GYM_DEFAULT_TAB;
    }
    if (route.default || route.invalid) {
      history.replaceState(null, "", canonicalHashFor(route));
    }
    onRoute(route);
  }

  // Carga inicial: el hash de la URL decide el primer estado.
  applyRoute(parseHash());

  // Runtime: atrás/adelante y navegación manual del usuario.
  const handleHashChange = () => applyRoute(parseHash());

  window.addEventListener("hashchange", handleHashChange);

  return {
    // Clave de Ocio actual (o la por defecto si el hash es ajeno).
    getCurrentKey: () => {
      const s = parseHash();
      return s.section === "ocio" || !s.section ? (s.key || lastOcioKey || DEFAULT_KEY) : lastOcioKey;
    },
    // Sección de primer nivel de la ruta actual: "ocio" | "perfil" |
    // "recetas" | "gimnasio" | null (ajena / no aplicable). Los
    // hashes ajenos devuelven null.
    getCurrentSection: () => {
      const s = parseHash();
      return s.section === null ? null : s.section;
    },
    // Re-sincroniza el estado con el hash de la URL (p. ej. tras el
    // login, para abrir la ruta de perfil que pedía la recarga).
    applyRoute,
    parseHash,
    hashForKey,
    hashForPanel,
    keyForPanel,
    profileHashKey,
    recipesHashFor,
    gymHashFor,
    getLastOcioKey,
    getLastRecipesTab,
    getLastGymTab,
    getLastSection,
    navigate,
    destroy: () => window.removeEventListener("hashchange", handleHashChange),
  };
}