// =============================================================
// Utilidades de fecha. Todas las fechas se guardan como string
// "YYYY-MM-DD" (el mismo formato que produce <input type="date">),
// así que se pueden ordenar como texto sin conversiones.
// =============================================================

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateEs(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Resta días a una fecha "YYYY-MM-DD" y devuelve otra fecha en el mismo
// formato canónico. Se usa para calcular umbrales de actividad (p. ej.
// "hace un año") comparables como texto.
export function subtractDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
