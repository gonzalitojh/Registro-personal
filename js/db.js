// =============================================================
// Acceso a datos: cada usuario lee y escribe solo en
// users/{uid}/items/{itemId}. Las reglas de Firestore (ver
// firestore.rules) impiden que nadie más pueda leer o escribir ahí,
// aunque el código fuente sea público.
// =============================================================

import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase.js";

function itemsRef(uid) {
  return collection(db, "users", uid, "items");
}

// Se suscribe en tiempo real a los items del usuario.
// Devuelve una función para cancelar la suscripción.
export function subscribeToItems(uid, onChange, onError) {
  const q = query(itemsRef(uid), orderBy("updatedAt", "desc"));
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

export async function addItem(uid, item) {
  return addDoc(itemsRef(uid), {
    ...item,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateItem(uid, itemId, changes) {
  return updateDoc(doc(db, "users", uid, "items", itemId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteItem(uid, itemId) {
  return deleteDoc(doc(db, "users", uid, "items", itemId));
}
