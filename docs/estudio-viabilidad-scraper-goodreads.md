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
---

## 4. Análisis legal y de conformidad

### 4.1 Términos de Uso de GoodReads (ToS)

Fuente: `https://www.goodreads.com/about/terms`, consultada el 2026-08-09.
El propio documento indica que «This Agreement was last revised on April 28,
2021». GoodReads es una subsidiaria de Amazon («Goodreads LLC ... is a
subsidiary of Amazon.com, Inc.», según su Política de privacidad, sección
4.2). Los ToS incorporan por remisión la Política de privacidad de GoodReads,
las Condiciones de uso de Amazon.com y demás normas publicadas en el sitio.

Cláusulas relevantes para un scraper, **citadas textualmente**:

1. **Prohibición expresa de scraping/extracción automatizada** (sección 1,
   «Use of Our Service»):

   > Subject to your compliance with this Agreement and your payment of any
   > applicable fees, we grant you a limited, non-exclusive, non-transferable,
   > non-sublicensable license to access and make personal and non-commercial
   > use of the Service. This license does not include any resale or
   > commercial use of any part of the Service, or its contents; **any
   > collection and use of any book listings, descriptions, reviews or other
   > material included in the Service**; any derivative use of any part of the
   > Service or its contents; any downloading, copying, or other use of
   > account information for the benefit of any third party; **or any use of
   > data mining, robots, or similar data gathering and extraction tools**.

2. **Prohibición de explotación sin consentimiento escrito** (sección 1):

   > No part of the Service may be reproduced, duplicated, copied, sold,
   > resold, visited, or otherwise exploited for any commercial purpose
   > without our express written consent.

3. **Extinción de la licencia y terminación unilateral** (sección 1):

   > The licenses granted by us terminate if you do not comply with this
   > Agreement. [...] Goodreads may permanently or temporarily terminate,
   > suspend, or otherwise refuse to permit your access to the Service without
   > notice and liability for any reason, including if in Goodreads' sole
   > determination you violate any provision of this Agreement, or for no
   > reason.

4. **Derechos de propiedad sobre el contenido** (sección 4, «Our Proprietary
   Rights»):

   > Use of the Goodreads Content or materials on the Service for any purpose
   > not expressly permitted by this Agreement is strictly prohibited.

5. **Contenido generado por usuarios** (sección 2, «User Content»): las
   reseñas y demás contenidos publicados por los miembros son contenidos de
   usuario; al publicarlos otorgan una licencia **a GoodReads** (sección 3),
   no a terceros. Una sinopsis publicada por una editorial también es
   contenido de terceros distribuido por GoodReads: su extracción y reuso
   automatizado no está autorizado por estos términos.

**Lectura aplicada al proyecto**: la búsqueda en GoodReads por título/autor y
la extracción de fichas (título, autor, año, páginas, portadas, sinopsis) para
alimentar el catálogo de la app constituye, en los propios términos del
documento, «collection and use of book listings, descriptions, reviews or
other material», precisamente lo que la licencia **no** incluye, y encaja en
la definición de «data mining, robots, or similar data gathering and
extraction tools». Ningún uso de la app (personal, sin ánimo de lucro) tiene
consentimiento escrito de GoodReads.

### 4.2 Política de privacidad

Fuente: `https://www.goodreads.com/about/privacy`, consultada el 2026-08-09.
Última actualización: 27 de junio de 2023.

> «Goodreads LLC (together with its affiliates, "Goodreads," "we," or "us")
> knows that you care how information about you is used and shared [...]
> Goodreads LLC is a subsidiary of Amazon.com, Inc. ("Amazon"). The
> information we collect is subject to the Amazon Privacy Notice, except as
> otherwise stated in this notice.»

La política regula los datos personales de los usuarios del servicio, no el
acceso automatizado al catálogo. A efectos de este estudio no añade
restricciones específicas sobre scraping más allá de las ya contenidas en los
ToS; sí confirma dos hechos relevantes:

- GoodReads es de Amazon, y su sitio está servido a través de
  **CloudFront/AWS WAF** (evidencia técnica en 5.2), lo que explica el
  comportamiento anti-bot observado.
- El contenido publicado (reseñas, comentarios) se hace público a través del
  servicio, pero la extracción automatizada del mismo sigue sujeta a los ToS
  (4.1).

### 4.3 robots.txt (consultado en vivo el 2026-08-09)

Fuente: `https://www.goodreads.com/robots.txt` (texto íntegro en el anexo).
El archivo lista agentes específicos (bingbot, GPTBot, CCBot, EtaoSpider,
AmazonAdBot, facebookexternalhit, Mediapartners-Google) y un grupo genérico
`User-agent: *`. Solo **bingbot** tiene `Crawl-delay: 5`; el grupo genérico no
declara ningún crawl-delay. GPTBot y CCBot están bloqueados por completo
(`Disallow: /`). Hay 28 sitemaps publicados (sección Referencias).

Rutas relevantes para el caso de uso de la app:

| Ruta | Uso para esta app | robots.txt (`User-agent: *`) | Línea textual (verbatim) |
|---|---|---|---|
| `/search` | **Búsqueda por título/autor — el caso de uso principal del buscador** | **PROHIBIDA** | `Disallow: /search` |
| `/book/show/` | Ficha de un libro (título, autor, año, páginas, sinopsis, portada) | Permitida (no aparece ninguna regla) | — |
| `/author/show/` | Ficha de autor | Permitida (no aparece ninguna regla) | — |
| `/work/editions` | Todas las ediciones de una obra (equivalente a `groupBooksByWork`: varias portadas/sinopsis) | Permitida (regla explícita) | `Allow: /work/editions` |
| `/work/quotes` | Citas de la obra | Permitida (regla explícita) | `Allow: /work/quotes` |
| `/work` | Cualquier otra ruta bajo `/work` | PROHIBIDA | `Disallow: /work` |
| `/api` | API oficial (extinta; ver 4.4 y 7.a) | PROHIBIDA | `Disallow: /api` |
| `/book/reviews/` | Reseñas de un libro | PROHIBIDA | `Disallow: /book/reviews/` |
| `/review/show` | Reseña individual | PROHIBIDA | `Disallow: /review/show` |
| `/review/list*` | Listados de reseñas | PROHIBIDA | `Disallow: /review/list`, `Disallow: /review/list_rss` |
| `/shelf/user_shelves` | Estanterías de un usuario | PROHIBIDA | `Disallow: /shelf/user_shelves` |
| `/user/year_in_books` | Resumen anual de usuario | PROHIBIDA | `Disallow: /user/year_in_books` |
| `/ebooks`, `/videos/`, `/tooltips`, `/track`, `/admin` | Otras zonas | PROHIBIDA | `Disallow: /ebooks` etc. |
| `/book/auto_complete` (JSON de autocompletado) | Sugerencia de títulos | Permitida (no aparece ninguna regla) | — |
| `/` (raíz, navegación general) | — | Permitida (no bloqueada; no hay `Disallow: /` para `*`) | — |

Nota sobre precedencia: en robots.txt, cuando coexisten reglas, se aplica la
más específica (la de mayor longitud de prefijo). Por eso `Allow: /work/editions`
prevalece sobre `Disallow: /work` solo para esa subruta concreta.

**Conclusión del robots.txt**: la búsqueda (`/search`) —que es justo lo que
la issue plantea sustituir— está **expresamente prohibida** para cualquier
rastreador. El resto del catálogo (fichas de libro, autor, ediciones) no está
bloqueado por robots.txt, pero sigue sujeto a los ToS (4.1): robots.txt y ToS
son dos capas independientes (ver 4.5).

### 4.4 Contexto legal general (sin asesoramiento jurídico)

El precedente más relevante en EE. UU. para el scraping de webs públicas es
**hiQ Labs, Inc. v. LinkedIn Corp.**:

- **CFAA**: el 9.º Circuito (en tres ocasiones, 2017, 2019 y 2022) sostuvo que
  acceder a datos **públicos** de un sitio web no es «acceso sin autorización»
  a efectos de la Computer Fraud and Abuse Act: la doctrina de Van Buren es de
  «puerta abierta o cerrada» y, si el sitio no exige credenciales, la puerta
  está abierta. Además, el propio 9.º Circuito (Facebook v. Power Ventures)
  señaló que «una violación de los términos de uso, por sí sola, no establece
  responsabilidad bajo la CFAA».
- **Vías que sí prosperaron**: LinkedIn ganó en primera instancia (noviembre
  2022) la reclamación por **incumplimiento de contrato** (su User Agreement
  prohibía el scraping automatizado), y en diciembre de 2022 las partes
  llegaron a un acuerdo confidencial: hiQ se comprometió a dejar de hacer
  scraping, pagó 500.000 $ y aceptó la responsabilidad por allanamiento
  (trespass to chattels) y apropiación indebida. El acuerdo no tiene valor de
  precedente, pero sí de señal: **violar los términos de un sitio al scrapear
  es una vía de reclamación viable** (incumplimiento contractual, agravios
  civiles), más allá de que la CFAA no aplique a datos públicos.
- **Derechos de autor**: las sinopsis de editoriales y las reseñas de
  usuarios son obras protegidas. Los ToS de GoodReads no transfieren a
  terceros ninguna licencia sobre ese contenido (sección 4.1, punto 5).
- **Jurisdicción**: GoodReads es una empresa de EE. UU. (San Francisco, CA) y
  sus términos se rigen por las leyes aplicables a Amazon; la app tiene
  usuarios en España, por lo que podrían concurrir normas de la UE (p. ej.
  protección de bases de datos en determinados casos). Esto se ofrece solo a
  nivel informativo: **este documento no es asesoría legal**.

### 4.5 Conclusión: robots.txt ≠ ToS

- **robots.txt** es una señal técnica (protocolo informal de cortesía para
  rastreadores) que el servidor publica; GoodReads la respeta además con
  medidas técnicas reales (AWS WAF, sección 5.2). Cumplirlo es buena práctica
  pero no otorga ningún derecho: es una directiva, no un contrato.
- **Los ToS** son un contrato (de adhesión) que se acepta al acceder o usar el
  servicio, con o sin cuenta, y que **prohíben** expresamente la extracción
  automatizada de datos (4.1).
- Por tanto: aunque una ruta esté «permitida» en robots.txt (p. ej.
  `/book/show/`), scrapearla incumple igualmente los ToS; y aunque una ruta
  esté prohibida en robots.txt pero sin respaldo técnico (no es el caso de
  `/search`, que sí tiene respaldo técnico), su crawleo también incumpliría
  los ToS. **El cumplimiento de robots.txt es condición necesaria pero no
  suficiente para un scraper «legal» en el sentido contractual.**
