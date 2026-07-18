# Mi Registro

Registro personal (y ahora también entre amigos) de películas, series y
libros, para sustituir a TV Time. Web estática (HTML + CSS + JS con módulos
nativos, sin build ni frameworks), alojada gratis en GitHub Pages, con
Firebase como base de datos multiusuario.

```
mi-registro/
├── index.html
├── resources/
│   └── icon.png            ← tu icono (ya lo tienes puesto)
├── css/
│   └── styles.css
├── js/
│   ├── config.js           ← claves de Firebase/TMDB/Books (rellenar)
│   ├── allowed-emails.js   ← lista de quién puede registrarse (rellenar)
│   ├── firebase.js          inicialización de Firebase
│   ├── http.js               fetch con reintento (TMDB, Open Library)
│   ├── api-movies.js        búsqueda, temporadas/episodios y datos ampliados en TMDB
│   ├── api-books.js         búsqueda en Open Library / Google Books
│   ├── dates.js              utilidades de fecha
│   ├── tv-progress.js       episodios vistos (con valoración por episodio), revisionados
│   ├── watch-log.js          historial de visionados (películas)
│   ├── reading-log.js        historial de lecturas (libros)
│   ├── db.js                 lectura/escritura en Firestore, perfiles, amigos
│   ├── ui.js                  renderizado del DOM
│   └── app.js                 punto de entrada
├── firestore.rules         ← reglas de seguridad (¡mantener igual que allowed-emails.js!)
└── README.md
```

## Cómo funciona el acceso (léelo con calma, es lo más delicado)

Esto ya no es una app de un único usuario: **cualquier correo de tu lista
de invitados puede registrarse** (entrar por primera vez crea su cuenta
automáticamente) y, una vez dentro, **todos los usuarios registrados se
consideran ya "amigos" entre sí** — cada uno ve y edita solo lo suyo, pero
puede ver (no editar) el registro de cualquier otro desde la sección
"Amigos" del perfil.

Quién puede entrar se controla en **dos sitios que tienen que coincidir**:

1. **`js/allowed-emails.js`** — un array de correos. Controla lo que ve la
   persona en el navegador (si no está en la lista, se le avisa y se le
   cierra la sesión al momento).
2. **`firestore.rules`** — la misma lista, dentro de la función
   `isAllowedUser()`. Esta es la que de verdad protege los datos: aunque
   alguien manipulase el código de la web, sin estar en esta lista de las
   reglas no puede leer ni escribir nada en la base de datos.

**Cada vez que añadas o quites un amigo, cámbialo en los dos archivos**, y
en el caso de `firestore.rules`, vuelve a pegar el archivo completo en
Firebase console → Firestore Database → Reglas → Publicar. Si solo lo
cambias en uno de los dos sitios, o la persona no podrá entrar aunque la
hayas "añadido", o (peor) podrá entrar en la web pero Firestore le seguirá
bloqueando los datos y verá errores.

Dentro de Firestore, cada usuario tiene sus propias colecciones:
`users/{uid}/movies`, `/series`, `/books` (visibles para cualquier otro
usuario autorizado, con permiso de solo lectura) y `/notifications`
(privada, nadie más la ve). El documento `users/{uid}` en sí guarda el
perfil (nombre, foto, email) que se usa para la lista de amigos.

> **Nota de seguridad:** la lista de correos determina quién puede
> registrarse y usar la app, pero técnicamente cualquiera con una cuenta de
> Google puede *intentar* iniciar sesión (eso Firebase no lo puede impedir).
> Lo que de verdad importa es que, si su correo no está en la lista de las
> reglas, no consigue acceso a ningún dato — ni a los suyos propios ni a
> los de nadie.

## 1. Crear el proyecto en Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y
   crea un proyecto nuevo (gratis, plan "Spark").
2. **Authentication** → pestaña "Sign-in method" → activa **Google**.
3. **Firestore Database** → "Crear base de datos" → modo producción → elige
   una región (por ejemplo `eur3` si estás en España).
4. **Configuración del proyecto** (icono del engranaje) → baja hasta "Tus
   apps" → añade una app **Web** (`</>`) → copia el objeto `firebaseConfig`
   que te muestra.

## 2. Rellenar `js/config.js` y `js/allowed-emails.js`

- En `js/config.js`: pega el `firebaseConfig` del paso anterior y tu clave
  de TMDB (paso siguiente).
- En `js/allowed-emails.js`: pon los correos de Gmail de quien pueda
  registrarse (tú incluido). Recuerda que esta lista tiene que coincidir
  con la de `firestore.rules` (paso 3).

## 3. Reglas de seguridad de Firestore

En Firebase console → Firestore Database → pestaña "Reglas", pega el
contenido de `firestore.rules` **sustituyendo los tres correos de ejemplo
dentro de `isAllowedUser()` por los mismos que pusiste en
`allowed-emails.js`** (puedes añadir tantos como quieras, es un array) y
publica.

## 4. Clave de la API de TMDB (películas y series)

1. Crea una cuenta gratuita en [themoviedb.org](https://www.themoviedb.org).
2. Configuración de la cuenta → API → solicita una clave de tipo "Developer".
   Es gratis para uso no comercial.
3. Copia la "API Key (v3 auth)" en `TMDB_API_KEY` dentro de `js/config.js`.

> IMDb no ofrece API pública asequible ni datos de premios; por eso se usa
> TMDB, gratuita y con catálogo muy similar.

## 5. Clave de Google Books (opcional)

La búsqueda de libros usa **Open Library como fuente principal** (agrupa
por libro, no por edición, y no necesita clave) y Google Books solo como
respaldo. Si quieres tu propia clave para ese respaldo, sigue el proceso
de restricción por dominio explicado más abajo en «Solución de problemas».

## 6. Subir a GitHub y activar Pages

1. Crea un repositorio nuevo en GitHub (público, obligatorio en el plan
   gratuito) y sube todo el contenido de esta carpeta, incluido tu
   `resources/icon.png`.
2. Settings → Pages → Source: "Deploy from a branch" → rama `main`,
   carpeta `/ (root)` → Guardar.
3. En un par de minutos tu web estará en
   `https://tu-usuario.github.io/nombre-del-repo/`.

## 7. Autorizar tu dominio en Firebase

Authentication → Settings → "Authorized domains" → añade
`tu-usuario.github.io`. Sin este paso, el login de Google falla con un
error de dominio no autorizado. `localhost` ya viene autorizado por
defecto para cuando pruebes en local.

## 8. Cómo se usa

Al abrir la app entras directamente en **Series, filtrado por "Viendo", en
vista de lista** — pensado para el uso más habitual.

- **Vista cuadrícula / lista**, con acción rápida (botón grande o
  deslizar en móvil) para marcar visto/siguiente episodio/avanzar lectura.
- **Películas**: Pendiente/Vista, con historial de visionados (revisionados
  incluidos) y aviso si intentas marcarla vista antes de su estreno.
- **Series**: episodio a episodio, con fecha editable, y ahora también
  **valoración individual por episodio** (aparece debajo de cada episodio
  ya marcado como visto). "Volver a verla desde el principio" archiva el
  visionado en un historial sin perder el anterior.
- **Libros**: empezar/terminar lectura con fecha, relecturas con historial.
- **Standby / Abandonado** (series y libros), **editar información**, **alta
  manual** (con nº de episodios para series manuales), **buscar en tu
  propia lista**, **más resultados con "Cargar más"**, **colores pastel por
  estado**, **información ampliada** (duración, género, director/creadores,
  reparto, sinopsis), y una casilla **"Solo en español"** en la búsqueda de
  libros (activada por defecto): sin marcarla, los resultados en español
  simplemente aparecen primero; marcándola, se descartan directamente los
  que Open Library confirma en otro idioma (los que no tienen ese dato no
  se descartan, para no perder resultados por falta de metadatos) — todo
  esto ya explicado en versiones anteriores de este README, sigue
  funcionando igual.
- **Notificaciones** (🔔): avisa de estrenos y episodios nuevos, una vez al
  día. Esa misma comprobación diaria **también rellena información que
  faltase** (sinopsis, reparto, director, fecha de estreno...) en cualquier
  ficha que la tuviera incompleta — útil tanto para lo que añadiste antes
  de que la app recogiera esos datos, como para series en producción que
  aún no tienen todo publicado en TMDB: en cuanto TMDB lo actualice, tu
  ficha se completa sola al día siguiente.
- **Perfil**: pulsando tu foto se abre con dos secciones:
  - **Estadísticas**: resumen (pelis vistas, episodios, series completadas,
    libros leídos) con selector Siempre/Año/Mes y dos gráficas.
  - **Amigos**: lista de todos los usuarios registrados; al pulsar uno ves
    su registro completo en modo solo lectura (sin notas personales, esas
    siempre son privadas).

## Solución de problemas

**Error 503 "Service temporarily unavailable" al buscar libros** — fallo
puntual del servidor, no tuyo. La app reintenta sola; si persiste, espera
unos segundos.

**Error 403 "referrer blocked" al buscar libros** — solo afecta al
respaldo de Google Books. Pasa si restringiste esa clave por dominio y
pruebas desde `file://` en tu disco en vez de desde GitHub Pages o un
servidor local (`python3 -m http.server`, añadiendo
`http://localhost:PUERTO/*` a los referrers permitidos en Google Cloud
Console).

**Un amigo no puede entrar aunque lo añadí** — revisa que su correo esté
en los DOS sitios: `js/allowed-emails.js` (y que el cambio esté subido a
GitHub Pages) y `firestore.rules` (y que hayas vuelto a publicar las
reglas en Firebase console; los cambios en el archivo del repositorio no
se aplican solos a la base de datos).

## Límites a tener en cuenta

- Firebase Spark (gratis): 50.000 lecturas/día y 1 GiB de almacenamiento —
  de sobra para un grupo pequeño de amigos.
- TMDB: uso gratuito solo no comercial, con atribución (pie de página).
- La comprobación diaria hace una petición a TMDB por cada película o serie
  activa que aún tenga datos incompletos o esté pendiente de estreno, y una
  a Open Library por cada libro sin sinopsis — una vez rellenos, dejan de
  consultarse, así que el gasto de peticiones baja solo con el tiempo.
