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
