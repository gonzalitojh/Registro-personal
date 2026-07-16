// =============================================================
// Acceso a datos. Cada tipo vive en su propia colección, para que
// sea fácil inspeccionarlas por separado en la consola de Firebase:
//   users/{uid}/movies/{id}
//   users/{uid}/series/{id}
//   users/{uid}/books/{id}
//   users/{uid}/notifications/{id}
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

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
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
