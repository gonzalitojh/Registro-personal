// =============================================================
// Acceso a datos. Cada tipo vive en su propia colección, para que
// sea fácil inspeccionarlas por separado en la consola de Firebase:
//   users/{uid}/movies/{id}
//   users/{uid}/series/{id}
//   users/{uid}/books/{id}
//   users/{uid}/games/{id}
//   users/{uid}/notifications/{id}
//   users/{uid}/recipes/{id}         (issue #64)
//   users/{uid}/ingredients/{id}     (catálogo de ingredientes, #64)
//   users/{uid}/menus/{id}           (menús semanales, #64)
//   users/{uid}/tags/{id}            (etiquetas personalizadas, #64)
// Además, users/{uid} (el propio documento, no una subcolección)
// guarda un pequeño perfil con el email y la fecha del último aviso
// de estrenos comprobado.
// Las reglas de Firestore (rules_version '2') con comodín recursivo
// cubren tanto el documento de perfil como las subcolecciones, así
// que no hace falta tocar firestore.rules.
// =============================================================

import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase.js";

const COLLECTION_BY_TYPE = {
  movie: "movies",
  tv: "series",
  book: "books",
  game: "games",
};

function itemsRef(uid, type) {
  return collection(db, "users", uid, COLLECTION_BY_TYPE[type]);
}

export async function upsertUserProfile(uid, data) {
  return setDoc(doc(db, "users", uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Perfiles de todos los usuarios registrados (para la lista de amigos).
// Como todos los que pueden registrarse ya están "autorizados", cualquier
// usuario puede leer los perfiles de los demás (ver firestore.rules).
export async function getAllUserProfiles() {
  const snap = await getDocs(collection(db, "users"));
  const profiles = [];
  snap.forEach((docSnap) => profiles.push({ uid: docSnap.id, ...docSnap.data() }));
  return profiles;
}

// Lectura puntual (sin suscripción en vivo) de los items de OTRO usuario,
// para verlos de solo lectura desde la sección de amigos.
export async function getItemsOnce(uid, type) {
  const snap = await getDocs(itemsRef(uid, type));
  const items = [];
  snap.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
  return items;
}

// Se suscribe en tiempo real a los items de un tipo concreto.
// Se ordena por addedAt (la fecha en la que TÚ lo añadiste, que no
// cambia nunca) y no por updatedAt (que se actualiza con cualquier
// escritura, incluida la revisión diaria en segundo plano que rellena
// metadatos) — así, que se complete información de una ficha no la hace
// saltar al principio de "Añadidas recientemente".
// Devuelve una función para cancelar la suscripción.
export function subscribeToItems(uid, type, onChange, onError) {
  const q = query(itemsRef(uid, type), orderBy("addedAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addItem(uid, type, item) {
  return addDoc(itemsRef(uid, type), {
    ...item,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateItem(uid, type, itemId, changes) {
  return updateDoc(doc(db, "users", uid, COLLECTION_BY_TYPE[type], itemId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteItem(uid, type, itemId) {
  return deleteDoc(doc(db, "users", uid, COLLECTION_BY_TYPE[type], itemId));
}

/* ---------- Notificaciones (estrenos) ---------- */

function notificationsRef(uid) {
  return collection(db, "users", uid, "notifications");
}

export function subscribeToNotifications(uid, onChange, onError) {
  const q = query(notificationsRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addNotification(uid, notification) {
  return addDoc(notificationsRef(uid), {
    ...notification,
    read: false,
    createdAt: serverTimestamp(),
  });
}

export async function markNotificationRead(uid, notificationId) {
  return updateDoc(doc(db, "users", uid, "notifications", notificationId), { read: true });
}

export async function deleteNotification(uid, notificationId) {
  return deleteDoc(doc(db, "users", uid, "notifications", notificationId));
}

/* ---------- Recetas (issue #64) ---------- */

function recipesRef(uid) {
  return collection(db, "users", uid, "recipes");
}

export function subscribeToRecipes(uid, onChange, onError) {
  const q = query(recipesRef(uid), orderBy("addedAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addRecipe(uid, recipe) {
  return addDoc(recipesRef(uid), {
    ...recipe,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateRecipe(uid, recipeId, changes) {
  return updateDoc(doc(db, "users", uid, "recipes", recipeId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteRecipe(uid, recipeId) {
  return deleteDoc(doc(db, "users", uid, "recipes", recipeId));
}

/* ---------- Ingredientes (catálogo, issue #64) ---------- */

function ingredientsRef(uid) {
  return collection(db, "users", uid, "ingredients");
}

export function subscribeToIngredients(uid, onChange, onError) {
  const q = query(ingredientsRef(uid), orderBy("nombre", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addIngredient(uid, ingredient) {
  return addDoc(ingredientsRef(uid), {
    nombre: ingredient.nombre,
    categoriaId: ingredient.categoriaId || "",
    // Campos opcionales de la ficha (issue #224): tiendas donde se
    // puede comprar el ingrediente y cantidad del paquete (número +
    // unidad). La foto (URL, issue #232) sigue el patrón de las recetas.
    // Solo se persisten si vienen definidos en el alta.
    ...(ingredient.supermercados !== undefined && { supermercados: ingredient.supermercados }),
    ...(ingredient.paqueteCantidad !== undefined && { paqueteCantidad: ingredient.paqueteCantidad }),
    ...(ingredient.paqueteUnidad !== undefined && { paqueteUnidad: ingredient.paqueteUnidad }),
    ...(ingredient.fotoUrl !== undefined && { fotoUrl: ingredient.fotoUrl }),
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Actualización parcial de un ingrediente del catálogo (issue #224):
// solo los campos pasados en `fields`. Para supermercados se envía el
// array completo nuevo.
export async function updateIngredient(uid, ingredientId, fields) {
  return updateDoc(doc(db, "users", uid, "ingredients", ingredientId), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteIngredient(uid, ingredientId) {
  return deleteDoc(doc(db, "users", uid, "ingredients", ingredientId));
}

/* ---------- Etiquetas personalizadas (issue #64) ---------- */

function tagsRef(uid) {
  return collection(db, "users", uid, "tags");
}

export function subscribeToTags(uid, onChange, onError) {
  const q = query(tagsRef(uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addTag(uid, tag) {
  return addDoc(tagsRef(uid), {
    ...tag,
    addedAt: serverTimestamp(),
  });
}

export async function deleteTag(uid, tagId) {
  return deleteDoc(doc(db, "users", uid, "tags", tagId));
}

/* ---------- Menús semanales (issue #64) ---------- */

function menusRef(uid) {
  return collection(db, "users", uid, "menus");
}

export function subscribeToMenus(uid, onChange, onError) {
  const q = query(menusRef(uid), orderBy("semanaInicio", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

// Crea un documento de menú y devuelve la referencia (con el id nuevo).
export async function addMenu(uid, menu) {
  return addDoc(menusRef(uid), {
    ...menu,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Sobrescribe los campos del menú (los arrays/días se guardan enteros).
export async function updateMenu(uid, menuId, menu) {
  return updateDoc(doc(db, "users", uid, "menus", menuId), {
    ...menu,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMenu(uid, menuId) {
  return deleteDoc(doc(db, "users", uid, "menus", menuId));
}
