# Mi Registro

Registro personal de películas, series y libros, para sustituir a TV Time.
Web estática (HTML + CSS + JS con módulos nativos, sin build ni frameworks),
pensada para alojarse gratis en GitHub Pages, con Firebase como base de datos.

```
mi-registro/
├── index.html
├── resources/
│   └── icon.png          ← tu icono (ya lo tienes puesto)
├── css/
│   └── styles.css
├── js/
│   ├── config.js         ← claves y configuración (rellenar)
│   ├── firebase.js        inicialización de Firebase
│   ├── http.js             fetch con reintento (TMDB, Open Library)
│   ├── api-movies.js      búsqueda, temporadas/episodios y datos ampliados en TMDB
│   ├── api-books.js       búsqueda en Open Library / Google Books, con reintentos y deduplicado
│   ├── dates.js            utilidades de fecha
│   ├── tv-progress.js     episodios vistos, "siguiente episodio" y revisionados
│   ├── watch-log.js        historial de visionados (películas)
│   ├── reading-log.js      historial de lecturas (libros)
│   ├── db.js               lectura/escritura en Firestore (colecciones separadas, perfil, notificaciones)
│   ├── ui.js                renderizado del DOM
│   └── app.js               punto de entrada
├── firestore.rules        ← reglas de seguridad (rellenar tu email)
└── README.md
```

## Por qué esta arquitectura

- **GitHub Pages** solo sirve archivos estáticos y, con cuenta gratuita, solo
  desde repositorios públicos. No puede alojar una base de datos.
- Por eso los datos viven en **Firebase** (gratis): el navegador habla
  directamente con Firestore mediante su SDK, sin servidor intermedio.
- El código es público (lo verá cualquiera que abra la página), pero **tus
  datos no**: solo tu cuenta de Google, según las reglas de seguridad, puede
  leerlos o escribirlos.
- Cada tipo vive en su propia colección de Firestore:
  `users/{tu-uid}/movies`, `users/{tu-uid}/series`, `users/{tu-uid}/books` y
  `users/{tu-uid}/notifications`. El propio documento `users/{tu-uid}` guarda
  un pequeño perfil (email, nombre, última comprobación de estrenos).
  `firestore.rules` ya cubre todo esto sin cambios, gracias al comodín
  recursivo de las reglas versión 2.
- Los gráficos de estadísticas usan [Chart.js](https://www.chartjs.org/) vía
  CDN (`cdnjs.cloudflare.com`), cargado en el `<head>` de `index.html`.

> **Si ya habías probado la app antes de la versión con colecciones
> separadas:** los datos antiguos vivían en una única colección `items` y no
> se migran solos.

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
> catálogo muy similar. Por eso la usa esta app. Tampoco incluye datos de
> premios (no forman parte de su base de datos gratuita).

## 5. Clave de Google Books (opcional)

Desde esta versión, la búsqueda de libros usa **Open Library como fuente
principal** (no necesita clave) y Google Books solo como respaldo si Open
Library no encuentra nada. Si quieres tu propia clave de Google Books para
ese respaldo:

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
   carpeta, incluido tu `resources/icon.png`.
2. Settings → Pages → Source: "Deploy from a branch" → rama `main`,
   carpeta `/ (root)` → Guardar.
3. En un par de minutos tu web estará en
   `https://tu-usuario.github.io/nombre-del-repo/`.

## 7. Autorizar tu dominio en Firebase (paso que se olvida fácil)

Firebase Authentication solo permite el inicio de sesión desde dominios
que tú apruebes. Ve a Authentication → Settings → "Authorized domains" →
añade `tu-usuario.github.io`. Sin este paso, el botón de Google dará un
error de dominio no autorizado.

## 8. Cómo funciona

Al abrir la app entras directamente en **Series, filtrado por "Viendo", en
vista de lista** — pensado para el uso más habitual: marcar el episodio que
tocaba. Desde ahí puedes cambiar de pestaña, filtro, orden o vista cuando
quieras.

- **Vista cuadrícula / lista**: alternable con los botones ▦ / ☰ de cada
  estantería. En lista, cada fila tiene un botón grande para la acción
  rápida (marcar vista / siguiente episodio / empezar-terminar lectura) y,
  en móvil, puedes deslizar la fila hacia cualquier lado para lo mismo.
- **Películas**: solo Pendiente/Vista. «Añadir otro visionado» registra un
  revisionado sin borrar el historial, y la ficha muestra cuántas veces la
  has visto.
- **Series**: episodio a episodio, con fecha editable por episodio. El
  siguiente pendiente se muestra arriba («Siguiente: T2E5»). Al terminarla,
  «Volver a verla desde el principio» archiva el visionado en un historial
  y empieza uno nuevo sin perder el anterior.
- **Libros**: «Empezar a leer» / «Terminar de leer» con fecha en cada
  acción; volver a leerlo abre una lectura nueva conservando las anteriores.
- **Standby / Abandonado** (series y libros): pausa o abandona sin perder el
  progreso guardado; «Retomar» vuelve al estado normal.
- **Editar información**: cada ficha tiene un botón «✎ Editar información»
  para corregir título, año, portada o (en libros) autor/páginas.
- **Alta manual**: enlace «¿No lo encuentras? Añadir manualmente» en cada
  pestaña, para lo que no aparezca en TMDB/Open Library (por ejemplo, un
  libro autopublicado de un amigo). Para series manuales se asume una sola
  temporada con el número de episodios que indiques.
- **Buscar en tu propia lista**: el icono 🔍 junto a los filtros busca por
  título dentro de lo que ya tienes añadido.
- **Más resultados de búsqueda**: ya no hay límite fijo; el botón «Cargar
  más» va trayendo más páginas, y «Ocultar resultados» los recoge cuando
  quieras. Al cambiar de pestaña, la búsqueda se limpia sola.
- **Información ampliada**: cuando TMDB/Open Library la tienen, se muestra
  duración, género, director o creadores, reparto principal y sinopsis
  (se piden una sola vez, al añadir el título, no en cada búsqueda).
- **Notificaciones**: la campana 🔔 avisa cuando una película pendiente de
  estreno ya se ha estrenado, o cuando hay un episodio nuevo disponible de
  una serie que sigues. Se comprueba una vez al día. Las tarjetas de algo
  aún no estrenado llevan una etiqueta «Aún no estrenada», y si intentas
  marcar como visto un episodio con fecha de emisión futura, te avisa antes
  de dejarte seguir (no lo bloquea del todo, por si TMDB va mal informado).
- **Perfil y estadísticas**: pulsando tu foto se abre un resumen con
  películas vistas, episodios vistos, series completadas y libros leídos,
  con selector Siempre/Este año/Este mes y dos gráficas (actividad por mes
  y reparto de estados).
- **Colores por estado**: cada tarjeta/fila se tiñe muy suavemente según su
  estado (viendo, vista, en pausa, abandonada...) para distinguirlas de un
  vistazo sin que el color destaque en exceso.

### Sobre "Amigos"

No lo he incluido todavía: la app ahora mismo solo deja entrar a **una**
cuenta (la tuya, fijada en `AUTHORIZED_EMAIL` y en las reglas), así que
"amigos" reales con su propia cuenta implicaría rediseñar la autenticación y
las reglas de seguridad para permitir accesos cruzados controlados. Es
totalmente viable, pero prefiero comentarte las opciones antes de
construirlo a ciegas — lo hablamos en el chat.

### Si la búsqueda de libros da un error 503 "Service temporarily unavailable"

Es un fallo puntual del servidor, no de tu configuración. La app reintenta
sola un par de veces; si sigue fallando, espera unos segundos y repite.

### Si la búsqueda de libros da un error 403 "referrer blocked"

Pasa si restringiste la clave de Google Books por dominio y pruebas desde
`file://` en tu disco. Prueba desde tu URL real de GitHub Pages o desde un
servidor local (`python3 -m http.server`), añadiendo
`http://localhost:PUERTO/*` a los referrers permitidos en Google Cloud
Console. Como Open Library es ahora la fuente principal y no necesita
clave, esto ya solo afecta al respaldo.

## Límites a tener en cuenta

- Firebase Spark (gratis): 50.000 lecturas/día y 1 GiB de almacenamiento en
  Firestore — de sobra para un uso personal.
- TMDB: uso gratuito solo no comercial, con atribución (ya incluida en el
  pie de la página).
- La comprobación de estrenos hace una petición a TMDB por cada serie activa
  (no abandonada) una vez al día como máximo, así que no debería notarse en
  la cuota.
- Si algún día quieres exportar tus datos, puedes hacerlo desde la propia
  consola de Firestore (exportar colección a JSON).
