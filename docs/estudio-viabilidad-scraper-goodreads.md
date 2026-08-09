# Estudio de viabilidad: sustituir Google Books / Open Library por un scraper de GoodReads (issue #50)

## Fecha

2026-08-09

## Issue

#50 — «Realizar un estudio para comprobar si sería factible sustituir el uso de
la API de Google Books u OpenLibrary por un scraper de la web GoodReads. Este
scraper debe cumplir todos los términos y condiciones de GoodReads y respetar
las reglas indicadas en el archivo robots.txt. Así como no sobrecargar los
servidores objetivos.» —
https://github.com/gonzalitojh/Registro-personal/issues/50

## Estado

Estudio de investigación finalizado. Sin implementación: este documento no
aporta código a la aplicación.

---

## 1. Resumen ejecutivo

**Veredicto: NO es factible** sustituir Google Books / Open Library por un
scraper de GoodReads en esta aplicación, ni como fuente principal ni como
respaldo, en las condiciones en las que la app está construida hoy (web 100 %
estática de cliente, sin backend propio, desplegada en Firebase Hosting).

La evidencia recogida el 2026-08-09 apunta en cuatro direcciones que se
refuerzan entre sí:

1. **Legal y contractual (bloqueante)**: los Términos de Uso de GoodReads
   (revisados el 28/04/2021) prohíben expresamente «cualquier uso de
   herramientas de minería de datos, robots o similares de recopilación y
   extracción» (sección 1), y `robots.txt` **prohíbe `/search`**, que es
   precisamente el caso de uso principal del buscador de la app. Aunque el
   precedente *hiQ v. LinkedIn* (9.º Circuito, 2022) dejó claro que la CFAA no
   ampara a los operadores frente al scraping de datos públicos, el mismo caso
   demostró que **la infracción de los términos de servicio sí da pie a un
   pleito por incumplimiento contractual** (y a acuerdos con indemnizaciones):
   eso es exactamente lo que un scraper de GoodReads haría.

2. **Técnico (bloqueante en la arquitectura actual)**: GoodReads no permite el
   acceso desde el navegador cliente: las respuestas reales **no incluyen
   cabecera CORS** (`Access-Control-Allow-Origin` ausente, verificado con
   curl), la búsqueda `/search` está protegida por un **challenge de AWS WAF**
   que devuelve `HTTP 202` con cuerpo vacío a clientes que no ejecutan su
   JavaScript (verificado por curl y por varias fuentes independientes en
   2026), y el contenido se renderiza con React/JS, por lo que haría falta un
   **servidor con navegador headless** (Playwright/Puppeteer) y una IP con
   buena reputación. La app no tiene backend propio y Firebase Cloud Functions
   usaría rangos de IP de centro de datos compartidos, con riesgo real de
   bloqueo.

3. **Carga y fiabilidad**: un scraper multiplicaría por 2-4× las peticiones
   frente a la vía actual (una petición HTTP por query a Google Books) y
   requeriría medidas de cortesía de 3-8 s entre peticiones; además, el HTML de
   GoodReads cambia sin previo aviso (React con clases ofuscadas; el scraper
   de referencia de la comunidad, `maria-antoniak/goodreads-scraper`, está
   abandonado y no funciona). El mantenimiento sería continuo y el riesgo de
   bloqueo de IP, real.

4. **Valor marginal**: todos los campos que usa la app (título, autor, año,
   páginas, portadas múltiples, sinopsis) ya los aportan Google Books
   (principal) y Open Library (respaldo + sinopsis bajo demanda). GoodReads
   solo añadiría valoraciones comunitarias y reseñas, campos que la app no
   usa ni ha solicitado.

La alternativa recomendada es **mantener el statu quo** (Google Books + Open
Library), que es gratuito, funciona desde el navegador, tiene CORS habilitado
y no requiere infraestructura (sección 8).

---

## 2. Alcance y metodología

**Naturaleza del estudio**: este documento es una investigación de
viabilidad, no una implementación. No se ha escrito ni se escribirá código de
scraper en el contexto de esta issue. Además, **no es asesoría legal**: el
análisis de la sección 4 resume documentos públicos y precedentes judiciales
para informar la decisión del proyecto; ante un uso real de los datos
convendría consultar con un profesional del derecho con competencia en la
jurisdicción aplicable.

**Metodología**:

1. **Fotografía puntual**: toda la evidencia se ha recolectado el
   **2026-08-09**. URLs, fechas de consulta y verificaciones de cada fuente
   están en la sección 9 (Referencias y fuentes). Este estudio describe el
   estado de las cosas en esa fecha; tanto GoodReads como las APIs de terceros
   pueden cambiar después.
2. **Fuentes primarias en vivo** (2026-08-09):
   - `https://www.goodreads.com/robots.txt` — leído textualmente.
   - `https://www.goodreads.com/about/terms` — Términos de Uso, leídos
     textualmente (sección 4.1 con citas).
   - `https://www.goodreads.com/about/privacy` — Política de privacidad
     (sección 4.2).
   - Peticiones HTTP de cortesía con `curl` a `goodreads.com` para verificar
     CORS y anti-bot (sección 5.1 y 5.2, con evidencias verbatim en el anexo y
     en la sección 9). Se realizaron solo unas pocas peticiones espaciadas;
     ninguna fue de scraping masivo.
3. **Investigación documental** (websearch): estado 2026 de la API oficial de
   GoodReads, precedentes legales de scraping (hiQ v. LinkedIn), estabilidad
   del HTML de GoodReads para scraping, y APIs alternativas de metadatos de
   libros activas en 2026.
4. **Contraste con el código de la app**: se leyeron `js/api-books.js`,
   `js/config.js` (la clave de Google Books no se transcribe en ningún
   documento ni commit), `js/global-search.js` (caché externa) y los ADR-002,
   ADR-045 y ADR-056 para describir con precisión el contrato de datos actual
   (sección 3).

**Limitaciones** (detalladas en la sección 9): el volumen de tráfico
(usuarios × búsquedas) no se puede medir desde este entorno y toda cifra al
respecto es una **estimación** marcada como tal; el estado de las cuotas de la
API de Google Books proviene de fuentes de terceros, no verificado en este
estudio; y las experiencias de terceros con el anti-bot de GoodReads son
documentales (ingestas de otras personas entre 2024 y 2026), no pruebas
propias a escala.

---

## 3. Contexto actual de la app

### 3.1 Arquitectura

La app es una **web estática 100 % de cliente**: JavaScript vanilla, datos en
Firestore, alojada en Firebase Hosting, sin backend ni proxy propios. Todo el
consumo de APIs de terceros ocurre desde el navegador del usuario mediante
`fetch()`. Cualquier fuente de datos nueva debe poder responder a peticiones
CORS reales desde un origen ajeno (dominio de Firebase Hosting) o exigiría la
introducción de infraestructura (la app no la tiene; ver sección 5.4).

### 3.2 Búsqueda de libros hoy (`js/api-books.js`)

Flujo documentado en ADR-002 (búsqueda de libros con Google Books), ADR-045
(unificación de buscadores) y ADR-056 (re-búsqueda y fallback de portadas):

1. **Google Books API es la fuente principal**
   (`https://www.googleapis.com/books/v1/volumes`, con `langRestrict=es` y la
   clave de `js/config.js`): `searchGoogleBooksResults()` pide 20 volúmenes
   por página y **agrupa por obra** (título+autor normalizados) en
   `groupBooksByWork()`, fusionando las portadas (`allCovers[]`) y sinopsis
   (`allDescriptions[]`) de todas las ediciones y contando `editionsCount`.
   La recaída sobre 503 usa `fetchWithRetry()` (2 reintentos).
2. **Open Library es el respaldo**
   (`https://openlibrary.org/search.json`, `lang=es`):
   `searchOpenLibrary()` devuelve un resultado por obra con su portada, y
   `getOpenLibraryDescription()` pide la sinopsis **bajo demanda** (solo al
   añadir el libro, no durante la búsqueda).
3. **Entrada unificada**: `searchBooks()` prueba Google Books y solo si falla
   o no encuentra nada intenta Open Library. Desde ADR-045, `searchExternal()`
   de `js/search.js` llama siempre con `spanishOnly = true` y el dropdown
   recorta a 5 resultados por grupo.
4. **Caché**: `json/global-search.js` conserva `externalCache[group] =
   { query, items, source }` en memoria **solo mientras el dropdown está
   abierto**; se invalida al cerrarlo (`closeGlobalSearch()`). No hay caché
   persistente: cada búsqueda nueva implica llamadas reales a las APIs
   (identificado en ADR-045 como coste aceptado).

### 3.3 Campos que la app usa de un libro

| Campo | De dónde sale hoy | Uso en la app |
|---|---|---|
| **Título** (+ subtítulo) | `volumeInfo.title/subtitle` (GB), `title` (OL) | Listas, ficha, agrupación por título |
| **Autor(es)** | `volumeInfo.authors[]` (GB), `author_name[]` (OL) | Listas, ficha, agrupación por título+autor, búsqueda por autor |
| **Año** | `publishedDate` → 4 primeros dígitos (GB), `first_publish_year` (OL) | Metadatos de tarjeta y ficha |
| **Páginas** | `volumeInfo.pageCount` (GB); OL no lo aporta (`null`) | Ficha del libro |
| **Portada(s)** | `volumeInfo.imageLinks.thumbnail` por edición → `allCovers[]` (GB); `cover_i` → URL del servicio de portadas de OL | Tarjeta, ficha, selector de portada al añadir (ADR-002) |
| **Sinopsis** | `volumeInfo.description` → `allDescriptions[]` (GB); `getOpenLibraryDescription()` bajo demanda (OL) | Ficha, selector de sinopsis al añadir (ADR-002) |
| **Id externo** | `id` de GB / `key` (work) de OL | Detección de «ya añadido» por `externalId` |

GoodReads tendría que cubrir **exactamente estos seis campos** (título, autor,
año, páginas, portadas, sinopsis) para sustituir a las fuentes actuales, con
el añadido de que la app valora poder ofrecer **varias portadas y varias
sinopsis por obra** (grupo de ediciones) y el **filtrado de idioma español**
(`langRestrict=es` en GB; `lang=es` + comprobación de idioma de edición en OL).