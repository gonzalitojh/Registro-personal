// =============================================================
// Utilidades de gestión de foco para accesibilidad.
// Proporciona funciones para atrapar foco en modales/dropdowns
// y obtener elementos enfocables dentro de un contenedor.
// =============================================================

/**
 * Obtiene todos los elementos enfocables dentro de un contenedor.
 * @param {HTMLElement} container - Contenedor a inspeccionar
 * @returns {HTMLElement[]} Array de elementos enfocables visibles
 */
export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null); // solo elementos visibles
}

/**
 * Atrapa el foco dentro de un contenedor modal/dropdown.
 * El foco se mueve al primer elemento enfocable al abrir,
 * y se cicla entre el primero y el último con Tab/Shift+Tab.
 *
 * @param {HTMLElement} container - El elemento contenedor del modal/dropdown
 * @returns {Function} Función cleanup para restaurar el comportamiento normal
 */
export function trapFocus(container) {
  if (!container) return () => {};
  const focusable = getFocusableElements(container);
  if (!focusable.length) return () => {};

  const firstFocusable = focusable[0];
  const lastFocusable = focusable[focusable.length - 1];

  function handleKeydown(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  document.addEventListener('keydown', handleKeydown);

  // Enfocar el primer elemento después de un microtask para
  // permitir que el DOM termine de actualizarse
  requestAnimationFrame(() => {
    firstFocusable.focus();
  });

  return () => {
    document.removeEventListener('keydown', handleKeydown);
  };
}
