// =============================================================
// CONFIGURACIÓN — rellena estos valores con los tuyos.
// Ninguno de estos valores es "secreto" en el sentido tradicional:
// la protección real de tus datos la dan las reglas de seguridad
// de Firestore (ver firestore.rules) y el inicio de sesión, no el
// hecho de que estas claves estén ocultas. Aun así, ver el README
// para restringir por dominio la clave de Google Books.
// =============================================================

// Versión de despliegue/caché. Se incrementa con scripts/bump-version.sh
// y se usa para versionar las URLs de los assets (?v=...) de modo que
// cada deploy invalide las cachés del service worker y del navegador.
export const APP_VERSION = '20260912';

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

  // La lista de quién puede entrar vive ÚNICAMENTE en la regla
  // isAllowedUser() de firestore.rules (issue #195): se eliminó
  // js/allowed-emails.js, que la duplicaba.

  // Clave de la API de TMDB (gratuita, no comercial)
// Consíguela en https://www.themoviedb.org/settings/api
export const TMDB_API_KEY = "f23a198de513705e5970b196de181edb";

// Clave de la API de Google Books (opcional).
// Sin clave funciona igual, con un límite de peticiones más bajo.
// Si la usas, restríngela por referrer HTTP a tu dominio de GitHub Pages
// desde Google Cloud Console → Credenciales.
export const GOOGLE_BOOKS_API_KEY = "AIzaSyAQ0NCW84ldhfmUboMo3ErylgkqexygYZM";

// URL pública de tu Cloudflare Worker, proxy de IGDB (Twitch).
// IGDB no tiene CORS y su Client Secret no puede exponerse en una SPA:
// el Worker guarda los secretos y reenvía las peticiones a IGDB.
// IMPORTANTE: pon aquí la URL EXACTA que imprime `wrangler deploy`
// (formato https://igdb-proxy.<tu-subdominio>.workers.dev). Si pones
// una URL que no existe, la búsqueda de videojuegos fallará.
// Despliega el Worker y configura los secretos siguiendo
// cloudflare/igdb-proxy/README.md, y pon aquí su URL.
// Sin valor (""), la búsqueda de videojuegos muestra un aviso claro
// («Falta IGDB_PROXY_URL…») y el resto de la app funciona igual.
export const IGDB_PROXY_URL = "https://igdb-proxy.gonzalojh596.workers.dev";
