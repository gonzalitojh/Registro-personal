// =============================================================
// Datos de recetas (issue #64): etiquetas predefinidas de
// categorías de ingrediente, alérgenos y tipos de comida, más
// helpers de normalización y mezcla con las etiquetas
// personalizadas del usuario (users/{uid}/tags).
// =============================================================

// Categorías de ingrediente (predefinidas para todos). La issue
// pedía revisar las 9 iniciales y ampliarlas: se añaden
// «Bebidas y cafés», «Congelados» y «Otros». Cada categoría lleva su
// icono (emoji, con precedente en la UI: 👤 en sidebar/global-search)
// que se muestra junto al título de su grupo en el catálogo (issue
// #224).
export const INGREDIENT_CATEGORIES = [
  { id: "frutas_verduras", label: "Frutas, verduras y hortalizas", icon: "🍎" },
  { id: "carnes_aves", label: "Carnes y aves", icon: "🥩" },
  { id: "pescado_mariscos", label: "Pescado y mariscos", icon: "🐟" },
  { id: "lacteos_huevos", label: "Lácteos y huevos", icon: "🥛" },
  { id: "legumbres_cereales", label: "Legumbres, cereales y harinas", icon: "🌾" },
  { id: "despensa_basicos", label: "Despensa y básicos", icon: "🧂" },
  { id: "especias_hierbas", label: "Especias, hierbas y condimentos", icon: "🌿" },
  { id: "aperitivos_dulces", label: "Aperitivos y dulces", icon: "🍿" },
  { id: "hogar", label: "Artículos del hogar", icon: "🧼" },
  { id: "bebidas_cafes", label: "Bebidas y cafés", icon: "☕" },
  { id: "congelados", label: "Congelados", icon: "❄️" },
  { id: "otros", label: "Otros", icon: "🗂️" },
];

// Icono de las categorías personalizadas del usuario (issue #224).
export const CUSTOM_CATEGORY_ICON = "🏷️";

// Icono del grupo «Sin categoría» (issue #224).
export const UNCATEGORIZED_ICON = "🧺";

// Supermercados para la ficha del ingrediente (issue #224): etiquetas
// opcionales de dónde se puede comprar cada ingrediente. Los colores
// de marca viven en el CSS (css/styles.css), no aquí: este archivo
// solo define los ids y las etiquetas.
export const SUPERMARKETS = [
  { id: "lidl", label: "Lidl" },
  { id: "aldi", label: "Aldi" },
  { id: "mercadona", label: "Mercadona" },
  { id: "dia", label: "Día" },
  { id: "carrefour", label: "Carrefour" },
  { id: "el_corte_ingles", label: "El Corte Inglés" },
];

// Alérgenos / etiquetas dietéticas (predefinidas). Se añaden
// «Sin frutos secos» y «Sin huevo» a las cuatro de la issue.
export const ALERGEN_TAGS = [
  { id: "sin_gluten", label: "Sin gluten" },
  { id: "vegetariano", label: "Vegetariano" },
  { id: "vegano", label: "Vegano" },
  { id: "sin_lactosa", label: "Sin lactosa" },
  { id: "sin_frutos_secos", label: "Sin frutos secos" },
  { id: "sin_huevo", label: "Sin huevo" },
];

// Tipos de comida (predefinidos). Se añaden «Salsas y
// guarniciones», «Desayunos» y «Bebidas» a los cinco de la issue.
export const MEAL_TYPES = [
  { id: "entrante", label: "Entrante" },
  { id: "cuchara", label: "Plato de cuchara" },
  { id: "principal", label: "Plato principal" },
  { id: "masas_panes", label: "Masas y panes" },
  { id: "postres", label: "Postres y dulces" },
  { id: "salsas_guarniciones", label: "Salsas y guarniciones" },
  { id: "desayunos", label: "Desayunos" },
  { id: "bebidas", label: "Bebidas" },
];

// Agrupación por tipo de etiqueta (el valor de `tipo` en la
// colección users/{uid}/tags y en los selectores de la UI).
export const TAGS_BY_TYPE = {
  ingrediente: INGREDIENT_CATEGORIES,
  alergeno: ALERGEN_TAGS,
  tipo: MEAL_TYPES,
};

// Días de la semana y comidas del menú (fijos, no configurables). El
// desayuno se eliminó en la issue #242: el menú cubre almuerzo y cena.
export const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
export const DAY_LABELS = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};
export const MEAL_KEYS = ["almuerzo", "cena"];
export const MEAL_LABELS = { almuerzo: "Almuerzo", cena: "Cena" };

// Normalización a slug para claves de etiqueta e ingrediente:
// quita tildes, pasa a minúsculas y sustituye separadores por "_".
export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Nombre de ingrediente normalizado (para agregar cantidades en la
// lista de la compra y para el catálogo de ingredientes).
export function normalizeIngredientName(name) {
  return slugify(name).replace(/_+/g, " ");
}

// Unidad normalizada (string libre: g, kg, ml, unidades...).
export function normalizeUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

// Combina las etiquetas predefinidas con las personalizadas del
// usuario (docs de users/{uid}/tags con { nombre, tipo }). Las
// personalizadas llevan custom: true para la UI de selección.
export function mergeTags(predefined, customTags) {
  const out = (predefined || []).map((t) => ({ id: t.id, label: t.label, custom: false }));
  (customTags || []).forEach((t) => out.push({ id: t.id, label: t.nombre, custom: true }));
  return out;
}

// Devuelve las etiquetas (predefinidas + personalizadas) cuyos ids
// estén en `ids`, conservando el orden del array de ids.
export function tagsByIds(predefined, customTags, ids) {
  const byId = new Map(mergeTags(predefined, customTags).map((t) => [t.id, t]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}

// Escapa texto para inyectarlo con seguridad en innerHTML.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// Formatea una cantidad: la redondea a 2 decimales y quita ceros
// finales ("1.5", "2", "0.33").
export function formatCantidad(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

// Fecha ISO (YYYY-MM-DD) del lunes de la semana actual desplazada
// `offset` semanas (0 = esta semana, -1 = anterior, 1 = siguiente).
// El menú semanal se guarda anclado al lunes de la semana ISO.
export function mondayISO(offset = 0) {
  const now = new Date();
  const daysFromMonday = (now.getDay() + 6) % 7; // 0 = lunes
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday + offset * 7);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Añade `days` días a una fecha ISO y la devuelve en el mismo
// formato. Se usa para etiquetar los días de la semana del menú.
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Fecha legible a partir de una ISO ("2026-08-10" → "10/08/2026").
export function formatDateEs(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}