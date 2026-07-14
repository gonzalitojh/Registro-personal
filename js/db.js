// =============================================================
// Acceso a datos. Cada tipo vive en su propia colección, para que
// sea fácil inspeccionarlas por separado en la consola de Firebase:
//   users/{uid}/movies/{id}
//   users/{uid}/series/{id}
//   users/{uid}/books/{id}
// Además, users/{uid} (el propio documento, no una subcolección)
// guarda un pequeño perfil con el email, para poder identificar la
// cuenta desde la consola de Firebase si hiciera falta.
// Las reglas de Firestore (rules_version '2') con comodín recursivo
// cubren tanto el documento de perfil como las tres subcolecciones,
// así que no hace falta tocar firestore.rules.
// =============================================================

import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
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
};

function itemsRef(uid, type) {
  return collection(db, "users", uid, COLLECTION_BY_TYPE[type]);
}

export async function upsertUserProfile(uid, data) {
  return setDoc(doc(db, "users", uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// Se suscribe en tiempo real a los items de un tipo concreto.
// Devuelve una función para cancelar la suscripción.
export function subscribeToItems(uid, type, onChange, onError) {
  const q = query(itemsRef(uid, type), orderBy("updatedAt", "desc"));
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
