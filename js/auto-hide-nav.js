// =============================================================
// Auto-ocultar navegación al desplazar (issue #137)
//
// Al hacer scroll hacia abajo en las listas de ocio (series,
// películas, libros — y cualquier pestaña futura) se ocultan la
// cabecera (barra de búsqueda superior) y la barra de pestañas;
// al desplazar hacia arriba reaparecen. La animación es un simple
// translateY que las hace "surgir del borde de la pantalla"
// (definido en css/styles.css, bloque "Ocultar navegación al
// desplazar").
//
// Añadido: cuando los filtros de la lista (.library-controls del
// panel activo) quedan totalmente fuera de vista y la navegación
// está oculta, se muestra el botón flotante #btn-back-to-top,
// centrado arriba, para volver al principio de la lista.
//
// Reglas de diseño:
// - La navegación NUNCA se oculta mientras el usuario interactúa
//   con ella (foco en la búsqueda, dropdown abierto, modal, drawer)
//   ni en pantallas que no son listas (acceso, perfil/ajustes).
// - Se respeta prefers-reduced-motion: el scroll al pulsar "Volver
//   arriba" es instantáneo (auto) en vez de suave.
// - El estado se refleja en clases de <body> (is-nav-hidden e
//   is-back-to-top-visible); el CSS hace el resto, sin tocar el
//   flujo del documento (solo transforms de elementos fixed).
// =============================================================

// Umbrales de comportamiento. hideThreshold: distancia desde el
// tope de la página por debajo de la cual la navegación nunca se
// oculta (para no esconderla nada más empezar a desplazarse).
// deltaThreshold: incremento de scroll (px) necesario para decidir
// la dirección; por debajo de él se conserva el estado anterior
// (evita parpadeos con movimientos mínimos o inercia).
const CONFIG = { hideThreshold: 80, deltaThreshold: 8 };

let navHidden = false;
let lastY = window.scrollY;

// Panel de lista activo: la sección de ocio visible dentro de la
// app. Devuelve null si no hay ninguna (pantalla de acceso o
// perfil/ajustes, donde no aplica la ocultación por scroll).
function activePanel() {
  return document.querySelector("#app:not(.hidden) .panel:not(.hidden)");
}

// ¿El usuario está interactuando con algo que exige mantener la
// navegación visible? Si es así, la ocultación queda desactivada.
function isInteracting() {
  // Foco dentro de la cabecera o de la barra de pestañas (p. ej.
  // escribiendo en la búsqueda global): ocultarlas mientras se
  // usa el teclado rompería la interacción.
  const focus = document.activeElement;
  if (focus && focus.closest(".app-header, .tabs--bar")) return true;

  // Dropdowns anclados a la cabecera abiertos (notificaciones,
  // menú de perfil y resultados de búsqueda): al ocultar la
  // cabecera se descolgarían de su ancla.
  if (
    document.querySelector("#notif-dropdown:not(.hidden)") ||
    document.querySelector("#profile-dropdown:not(.hidden)") ||
    document.querySelector(".global-search__results:not(.hidden)")
  ) {
    return true;
  }

  // Drawer lateral (hamburguesa) abierto.
  if (document.querySelector(".app-sidebar.is-open")) return true;

  // Modal abierto (ficha de ítem, valoración, etc.).
  if (document.querySelector(".modal:not(.hidden)")) return true;

  // Pantalla de acceso (la app entera está oculta) o sin panel de
  // lista visible (perfil/ajustes): la ocultación por scroll solo
  // tiene sentido sobre las listas de ocio.
  if (document.getElementById("app")?.classList.contains("hidden")) return true;
  if (!activePanel()) return true;

  return false;
}

// Aplica el estado de navegación oculta solo si cambia (evita
// trabajos y reflows innecesarios) y mantiene el botón flotante
// sincronizado.
function setNavHidden(hidden) {
  if (hidden === navHidden) return;
  navHidden = hidden;
  document.body.classList.toggle("is-nav-hidden", hidden);
  updateBackToTop();
}

// El botón "Volver arriba" solo se muestra cuando la navegación
// está oculta Y los filtros de la lista activa han quedado
// totalmente fuera de vista (borde inferior del .library-controls
// por encima del viewport: getBoundingClientRect().bottom <= 0).
function updateBackToTop() {
  const panel = activePanel();
  const controls = panel ? panel.querySelector(".library-controls") : null;
  const visible =
    navHidden && controls !== null && controls.getBoundingClientRect().bottom <= 0;
  document.body.classList.toggle("is-back-to-top-visible", visible);
}

// Decide el estado de la navegación según la dirección del scroll
// y las interacciones en curso. El delta lo calcula el listener de
// scroll (ver initAutoHideNav): en el rAF window.scrollY ya coincide
// con lastY y el delta sería siempre 0 (issue #137, revisión QA).
// Si el delta no supera el umbral se conserva el estado anterior,
// para que la inercia o un trackpad lento no hagan parpadear la
// navegación.
function evaluate(delta = 0) {
  let hidden = navHidden;
  if (isInteracting() || window.scrollY < CONFIG.hideThreshold) {
    hidden = false;
  } else if (delta > CONFIG.deltaThreshold) {
    hidden = true;
  } else if (delta < -CONFIG.deltaThreshold) {
    hidden = false;
  }
  setNavHidden(hidden);
  // El botón "Volver arriba" se reevalúa en cada frame de scroll:
  // depende de la posición de los filtros, que cambia en el mismo
  // descenso en el que la navegación se oculta (no solo cuando el
  // estado de la navegación cambia o en resize).
  updateBackToTop();
}

export function initAutoHideNav() {
  const body = document.body;

  // Scroll: calcular el delta AQUÍ, en el listener, y reevaluar una
  // vez por frame (throttle con rAF). El delta no puede calcularse
  // dentro del rAF: el evento scroll se despacha antes que el rAF
  // del mismo frame, así que allí window.scrollY ya coincide con
  // lastY y el delta sería siempre 0 (revisión QA, issue #137).
  let scrollTicking = false;
  window.addEventListener(
    "scroll",
    () => {
      const delta = window.scrollY - lastY;
      lastY = window.scrollY;
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        evaluate(delta);
      });
    },
    { passive: true }
  );

  // Foco que entra en la navegación (p. ej. Tab hacia la búsqueda):
  // reevaluar para mostrarla de inmediato.
  document.addEventListener("focusin", (e) => {
    if (e.target.closest?.(".app-header, .tabs--bar")) evaluate();
  });

  // Aperturas de dropdown por clic y búsqueda global: reevaluar al
  // abrirlos (el dropdown anclado exige la cabecera visible). Los
  // listeners se envuelven para no pasar el Event como primer
  // argumento (delta): evaluate(Event) coaccionaría a NaN y
  // conservaría el estado por accidente (revisión QA, issue #137).
  document.getElementById("btn-notifications")?.addEventListener("click", () => evaluate());
  document.getElementById("btn-open-profile")?.addEventListener("click", () => evaluate());
  document.getElementById("global-search-input")?.addEventListener("focus", () => evaluate());

  // Observar cambios de clase en los elementos que condicionan el
  // estado (cambio de pestaña/panel, apertura de modales y
  // dropdowns, visibilidad de la app, drawer...). Si el propio
  // <body> cambia (nuestras clases) la reevaluación es inofensiva:
  // setNavHidden no hace nada si el estado no cambia.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.target.matches?.(
          ".panel, .modal, .app-sidebar, #notif-dropdown, #profile-dropdown, .global-search__results, #app, body"
        )
      ) {
        evaluate();
        return;
      }
    }
  });
  observer.observe(body, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  // Cambios de tamaño del viewport (rotación, zoom, barra del
  // navegador): la posición de los filtros cambia, hay que
  // redecidir navegación y botón flotante.
  window.addEventListener("resize", () => {
    evaluate();
  });

  // "Volver arriba": mostrar la navegación y subir al principio de
  // la lista. Con prefers-reduced-motion el salto es instantáneo.
  document.getElementById("btn-back-to-top")?.addEventListener("click", () => {
    setNavHidden(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  // Estado inicial (carga con la página arriba del todo).
  evaluate();
}
