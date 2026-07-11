// =============================================================
// CONFIGURACIÓN — rellena estos valores con los tuyos.
// Ninguno de estos valores es "secreto" en el sentido tradicional:
// la protección real de tus datos la dan las reglas de seguridad
// de Firestore (ver firestore.rules) y el inicio de sesión, no el
// hecho de que estas claves estén ocultas. Aun así, ver el README
// para restringir por dominio la clave de Google Books.
// =============================================================

// Configuración de tu proyecto de Firebase
// (Firebase console → Configuración del proyecto → Tus apps → SDK)
export const firebaseConfig = {
  apiKey: "TU_FIREBASE_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID",
};

// El email con el que vas a iniciar sesión (debe coincidir EXACTAMENTE
// con el que pongas en firestore.rules)
export const AUTHORIZED_EMAIL = "tu-email@gmail.com";

// Clave de la API de TMDB (gratuita, no comercial)
// Consíguela en https://www.themoviedb.org/settings/api
export const TMDB_API_KEY = "TU_TMDB_API_KEY";

// Clave de la API de Google Books (opcional).
// Sin clave funciona igual, con un límite de peticiones más bajo.
// Si la usas, restríngela por referrer HTTP a tu dominio de GitHub Pages
// desde Google Cloud Console → Credenciales.
export const GOOGLE_BOOKS_API_KEY = "";
