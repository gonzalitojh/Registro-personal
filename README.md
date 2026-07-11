# Mi Registro

Registro personal de películas, series y libros, para sustituir a TV Time.
Web estática (HTML + CSS + JS con módulos nativos, sin build ni frameworks),
pensada para alojarse gratis en GitHub Pages, con Firebase como base de datos.

```
mi-registro/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── config.js       ← claves y configuración (rellenar)
│   ├── firebase.js      inicialización de Firebase
│   ├── api-movies.js    búsqueda en TMDB
│   ├── api-books.js     búsqueda en Google Books / Open Library
│   ├── db.js             lectura/escritura en Firestore
│   ├── ui.js             renderizado del DOM
│   └── app.js            punto de entrada
├── firestore.rules      ← reglas de seguridad (rellenar tu email)
└── README.md
```

## Por qué esta arquitectura

- **GitHub Pages** solo sirve archivos estáticos y, con cuenta gratuita, solo
  desde repositorios públicos. No puede alojar una base de datos.
- Por eso los datos viven en **Firebase** (gratis): el navegador habla
  directamente con Firestore mediante su SDK, sin servidor intermedio.
- El código es público (lo verá cualquiera que abra la página), pero **tus
  datos no**: solo tu cuenta de Google, según las reglas de seguridad, puede
  leerlos o escribirlos. Ocultar las claves no serviría de nada; lo que
  realmente protege tus datos son esas reglas.

## 1. Crear el proyecto en Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y
   crea un proyecto nuevo (gratis, plan "Spark").
2. **Authentication** → pestaña "Sign-in method" → activa **Google**.
3. **Firestore Database** → "Crear base de datos" → modo producción → elige
   una región (por ejemplo `eur3` si estás en España).
4. **Configuración del proyecto** (icono del engranaje) → baja hasta "Tus
   apps" → añade una app **Web** (`</>`) → copia el objeto `firebaseConfig`
   que te muestra.

## 2. Rellenar `js/config.js`

Pega ahí el `firebaseConfig` del paso anterior, tu email en
`AUTHORIZED_EMAIL`, y tu clave de TMDB (paso siguiente).

## 3. Reglas de seguridad de Firestore

En Firebase console → Firestore Database → pestaña "Reglas", pega el
contenido de `firestore.rules` (sustituyendo `tu-email@gmail.com` por el
email con el que vas a iniciar sesión) y publica.

## 4. Clave de la API de TMDB (películas y series)

1. Crea una cuenta gratuita en [themoviedb.org](https://www.themoviedb.org).
2. Configuración de la cuenta → API → solicita una clave de tipo "Developer".
   Es gratis para uso no comercial; solo te pedirán confirmar que es un
   proyecto personal.
3. Copia la "API Key (v3 auth)" en `TMDB_API_KEY` dentro de `js/config.js`.

> Nota: IMDb no ofrece una API pública asequible (su servicio oficial es
> para empresas, vía AWS). TMDB es la alternativa estándar y gratuita, con
> catálogo muy similar. Por eso la usa esta app.

## 5. Clave de Google Books (opcional)

La búsqueda de libros funciona sin clave, con un límite de peticiones más
bajo. Si quieres una propia:

1. Ve a [console.cloud.google.com](https://console.cloud.google.com) →
   crea un proyecto → "Credenciales" → "Crear credenciales" → Clave de API.
2. Restríngela a la **Books API** y, en "Restricciones de aplicación",
   elige "Referentes HTTP" y añade tu dominio de GitHub Pages
   (`https://tu-usuario.github.io/*`).
3. Pega la clave en `GOOGLE_BOOKS_API_KEY`.

(Goodreads no se usa porque su API pública dejó de emitir claves nuevas en
2020 y está en desuso.)

## 6. Subir a GitHub y activar Pages

1. Crea un repositorio nuevo en GitHub (será público, es obligatorio en el
   plan gratuito para poder usar Pages) y sube todo el contenido de esta
   carpeta.
2. Settings → Pages → Source: "Deploy from a branch" → rama `main`,
   carpeta `/ (root)` → Guardar.
3. En un par de minutos tu web estará en
   `https://tu-usuario.github.io/nombre-del-repo/`.

## 7. Autorizar tu dominio en Firebase (paso que se olvida fácil)

Firebase Authentication solo permite el inicio de sesión desde dominios
que tú apruebes. Ve a Authentication → Settings → "Authorized domains" →
añade `tu-usuario.github.io`. Sin este paso, el botón de Google dará un
error de dominio no autorizado.

## 8. Usarla

Abre tu URL de GitHub Pages, entra con Google (con el email que pusiste en
`AUTHORIZED_EMAIL` y en las reglas) y ya puedes buscar títulos y libros,
añadirlos, marcarlos como pendiente / en curso / completado, puntuarlos y
dejar notas.

## Límites a tener en cuenta

- Firebase Spark (gratis): 50.000 lecturas/día y 1 GiB de almacenamiento en
  Firestore — de sobra para un uso personal.
- TMDB: uso gratuito solo no comercial, con atribución (ya incluida en el
  pie de la página).
- Si algún día quieres exportar tus datos, puedes hacerlo desde la propia
  consola de Firestore (exportar colección a JSON).
