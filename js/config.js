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
    apiKey: "AIzaSyCVA1d9FH26eOJcJ30y--9H_2gAzlZ8RGc",
    authDomain: "registro-personal-gjh.firebaseapp.com",
    projectId: "registro-personal-gjh",
    storageBucket: "registro-personal-gjh.firebasestorage.app",
    messagingSenderId: "797249707218",
    appId: "1:797249707218:web:4053d75f5a0c17029e610b",
    measurementId: "G-HH7JJYF8SR"
  };

  // La lista de quién puede entrar vive en su propio archivo:
// ver js/allowed-emails.js

// Clave de la API de TMDB (gratuita, no comercial)
// Consíguela en https://www.themoviedb.org/settings/api
export const TMDB_API_KEY = "f23a198de513705e5970b196de181edb";

// Clave de la API de Google Books (opcional).
// Sin clave funciona igual, con un límite de peticiones más bajo.
// Si la usas, restríngela por referrer HTTP a tu dominio de GitHub Pages
// desde Google Cloud Console → Credenciales.
export const GOOGLE_BOOKS_API_KEY = "AIzaSyAQ0NCW84ldhfmUboMo3ErylgkqexygYZM";
