# ADR-065: Estudio de viabilidad del scraper de GoodReads — no factible, se mantiene Google Books + Open Library (issue #50)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #50 pide **evaluar si es factible sustituir la API de Google Books
y/o Open Library por un scraper de la web GoodReads**, con dos restricciones
explícitas: el hipotético scraper debe **cumplir todos los términos y
condiciones de GoodReads y respetar su `robots.txt`**, y **no sobrecargar los
servidores objetivos**.

El punto de partida es una web **100 % estática de cliente** (Firebase
Hosting, sin backend propio): cualquier fuente de datos debe poder
consultarse desde el navegador (CORS habilitado) o exigiría infraestructura
nueva. Hoy la búsqueda de libros usa **Google Books API como fuente
principal** (con agrupación inteligente por título+autor vía
`groupBooksByWork`) y **Open Library como respaldo** (`searchOpenLibrary`) más
sinopsis bajo demanda (`getOpenLibraryDescription`), arquitectura documentada
en ADR-002, ADR-045 y ADR-056.

El estudio ya está **realizado y validado (QA PASS)**:
`docs/estudio-viabilidad-scraper-goodreads.md` (884 líneas, evidencia
recolectada el 2026-08-09: `robots.txt` y ToS leídos textualmente, peticiones
HTTP de cortesía con `curl`, precedentes legales documentales y contraste con
`js/api-books.js`). Su veredicto es **NO factible**, ni como fuente principal
ni como respaldo, en las condiciones actuales de la app. Este ADR documenta
la decisión a posteriori, como los ADR recientes (ADR-059 a ADR-064), y
cumple la definición de done de `tasks/task-issue-50.json` («ADR documentando
la decisión/conclusión del estudio»).

Related issue: #50 — https://github.com/gonzalitojh/Registro-personal/issues/50

## Decisión

**Mantener el statu quo**: Google Books API como fuente principal y Open
Library como respaldo (+ sinopsis bajo demanda), tal como documentan
ADR-002/045/056. **NO se adopta el scraper de GoodReads**, ni como fuente
principal ni como respaldo. El estudio no partía de una conclusión
preconcebida; la evidencia converge en el rechazo desde tres frentes
independientes:

### 1. Legal / contractual (bloqueante)

- Los **ToS de GoodReads** prohíben expresamente el uso de «data mining,
  robots, or similar data gathering and extraction tools» y la recolección
  de «book listings, descriptions, reviews» (sección 1 de los términos,
  revisados el 28/04/2021).
- El **`robots.txt`** de GoodReads tiene `Disallow: /search`, que es
  **precisamente el caso de uso principal** que la issue quería sustituir
  (la búsqueda de libros del buscador global).
- El precedente *hiQ v. LinkedIn* (9.º Circuito, 2022) muestra que, aunque
  la CFAA no ampara a los operadores frente al scraping de datos públicos,
  la vía del **incumplimiento contractual** por violar las condiciones del
  sitio sí da pie a pleitos y acuerdos con indemnización: es exactamente lo
  que un scraper conforme a la letra de GoodReads haría. **No hay forma de
  cumplir la restricción de la issue y scrapear a la vez.**

### 2. Técnico / arquitectura (bloqueante en esta app)

- GoodReads **no permite el acceso desde el navegador cliente**: las
  respuestas reales **no incluyen cabecera CORS** (verificado con `curl`), la
  búsqueda `/search` está protegida por un **challenge de AWS WAF** que
  devuelve `HTTP 202` con cuerpo vacío a clientes que no ejecutan su JS
  (verificado con `curl` y confirmado por terceros), y el contenido se
  renderiza con React, por lo que haría falta un **servidor con navegador
  headless** (Playwright/Puppeteer) e IP con buena reputación o proxies
  residenciales.
- Montar ese servidor proxy (p. ej. Firebase Cloud Functions) **rompe el
  diseño sin backend** de la app, introduce **coste recurrente** (instancias,
  proxies, mantenimiento) y mantiene el **riesgo de bloqueo** (las IPs de
  centro de datos compartidas son sospechosas para el anti-bot).

### 3. Carga desproporcionada y beneficio nulo

- **Carga**: el modelo del estudio estima **~3-5× peticiones por query**
  (challenge WAF de 2-4 intercambios + 1 GET a `/search`) y **~8-15× al
  añadir 5 libros** de una búsqueda (de ~1 a ≈8-15 peticiones) frente a la
  vía actual (una petición HTTP por query a Google Books), con cortesías de
  **3-8 s entre peticiones** y riesgo de 403/bloqueo tras pocas decenas de
  peticiones. Además, el HTML de GoodReads cambia sin previo aviso (el
  scraper de referencia de la comunidad está abandonado): mantenimiento
  continuo.
- **Beneficio**: GoodReads **no cubre ningún campo** de los que la app usa
  (título, autor, año, páginas, portadas múltiples, sinopsis, idioma); todo
  lo aporta ya Google Books (+ Open Library de respaldo). Lo único exclusivo
  de GoodReads (valoraciones, reseñas, géneros) **no lo usa la app** ni está
  solicitado por ninguna issue.

### Seguimiento documentado (sin coste)

- Vigilar el ánimo de Open Library de no ser usada como «data backend»: la
  app ya usa un patrón de respaldo puntual acorde.
- Si en el futuro se quisieran **valoraciones/reseñas comunitarias** (único
  valor exclusivo de GoodReads), plantearlo como **issue nueva** con fuentes
  licenciadas o integración oficial, nunca con scraping.
- Si algún día Google Books dejara de funcionar de forma permanente, la
  migración natural es **Open Library como única fuente** (degradación de UX
  conocida y documentada), no un scraper.

## Alternativas descartadas

- **Scraper de GoodReads como fuente principal**: descartado — bloqueado por
  los tres argumentos anteriores (legal, técnico y carga/beneficio).
- **Scraper de GoodReads como fuente de respaldo**: descartado — hereda el
  mismo bloqueo legal y el mismo coste de infraestructura sin aportar ningún
  campo nuevo.
- **Servidor proxy con navegador headless (Firebase Functions u otro)**:
  descartado — rompe la arquitectura sin backend, coste recurrente, IPs de
  centro de datos con riesgo de bloqueo (sección 5.4 del estudio).
- **Open Library como única fuente ahora**: descartado como cambio
  inmediato — no hay necesidad (Google Books funciona); queda como plan B
  documentado para el caso de caída permanente de Google Books.

## Consecuencias

### Positivas

- **Cero riesgo legal**: no se implementa ningún scraper; no hay exposición
  a demandas por incumplimiento contractual ni violación de `robots.txt`.
- **Sin infraestructura nueva**: nada que desplegar, mantener ni pagar; se
  conserva la arquitectura 100 % cliente de Firebase Hosting.
- **Cero coste recurrente** y sin dependencias nuevas: Google Books y Open
  Library son gratuitos y funcionan desde el navegador con CORS habilitado.
- **Carga de red inalterada**: se mantiene una petición HTTP por query;
  no se multiplica el tráfico hacia terceros.

### Negativas / Riesgos

- **Dependencia continuada de terceros** (Google Books + Open Library), tal
  como documenta ADR-002: sujetos a cuotas, cambios de API o caídas. El plan
  de contingencia ya está escalonado y documentado en el estudio: Open
  Library como respaldo hoy y como única fuente si Google Books cayera de
  forma permanente.

### Neutras

- **Sin impacto en UX**: el usuario no percibe ningún cambio en la búsqueda
  de libros.
- **Sin cambios de código**: la decisión no toca `js/api-books.js` ni ningún
  otro fichero de la app.
- **El estudio queda como referencia**: `docs/estudio-viabilidad-scraper-
  goodreads.md` sirve de evidencia y punto de partida si el tema se
  replanteara en el futuro (fuentes licenciadas, integración oficial).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `docs/adr-065-estudio-viabilidad-scraper-goodreads.md` | **Nuevo**: este documento |
| `docs/estudio-viabilidad-scraper-goodreads.md` | **Existente**: estudio de viabilidad (884 líneas, QA PASS) cuya conclusión documenta este ADR — no se modifica |
| `tasks/task-issue-50.json` | **Existente**: definición de done (criterio «ADR documentando la decisión/conclusión del estudio (con 'Related issue: #50')») que este ADR cumple — no se modifica |

Relacionado con: docs/estudio-viabilidad-scraper-goodreads.md

Related issue: #50 — https://github.com/gonzalitojh/Registro-personal/issues/50