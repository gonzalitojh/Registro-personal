# ADR-074: Estudio de la información de la API de TMDB — factible montar un "IMDB/TMDB" desde el cliente, con alcance por fases para futuras implementaciones (issue #184)

## Estado
Aceptado (decisión de estudio: define el alcance de futuras issues de
implementación; esta issue no implementa nada).

## Fecha
2026-08-10

## Contexto

La issue #184 pide **realizar un estudio, sin implementar nada**, de toda la
información que se puede extraer de la API de TMDB, organizada por secciones,
para saber hasta dónde puede llegar la idea de montar una especie de _IMDB_ o
_TMDB_ dentro de la web: consultar mucha más información sobre películas,
series, actores, directores, etc. La issue no plantea una implementación
concreta, sino un **catálogo de posibilidades** que permita decidir alcance.

El punto de partida, verificado en el código real y en la documentación
oficial de TMDB (secciones 3 y 4 del estudio):

- **Arquitectura 100 % cliente**: Firebase Hosting, vanilla JS, PWA con
  service worker, sin backend propio salvo el proxy de IGDB (ADR-067). Todo
  acceso a TMDB vive en `js/api-movies.js` con la clave en query string
  (`js/config.js`).
- **Uso actual de TMDB**: 9 llamadas distintas ya en producción (búsqueda de
  películas/series, detalles con `append_to_response=credits,videos`,
  temporadas/episodios, colecciones/sagas ADR-006, watch providers ES,
  similares), con caché 24 h en memoria, `networkFirst` para la API y
  `cacheFirst` para el CDN de imágenes en el service worker
  (`service-worker.js:288` y `:307`) y snapshots Firestore con refresh
  diario (ADR-021). Baseline de consumo: **~410 llamadas a TMDB/día/usuario**
  (estudio de almacenamiento, ADR-073).
- **Atribución ya cumplida**: aviso en el footer de `index.html:222`.
- **Verificación empírica de cortesía (2026-08-10)**: `curl` a
  `api.themoviedb.org` confirma `access-control-allow-origin: *` → la API es
  consultable desde el navegador, como ya hace la app.

**Por qué era necesario el estudio**: la ficha actual muestra solo un
subconjunto de la información de TMDB (datos básicos, reparto de 5,
director, tráiler, plataformas, similares). La issue pregunta **hasta dónde
se puede llegar** sin saber qué ofrece realmente la API; este estudio
cataloga las 21 secciones de la API v3 (endpoints, datos y utilidad), evalúa
la viabilidad en la arquitectura actual y propone un alcance ordenado.

El estudio ya está **realizado y validado (QA PASS)**:
`docs/estudio-informacion-tmdb.md` (775 líneas, fuentes primarias de TMDB
consultadas el 2026-08-10: documentación oficial, OpenAPI v3, términos de
uso v. 20/10/2023 y FAQ; evidencia contrastada con el código real de la
app). Su veredicto: **es factible montar una "especie de IMDB/TMDB" en el
cliente** para la práctica totalidad de la información de TMDB, sin
infraestructura nueva. Este ADR documenta la decisión/conclusión a
posteriori, como hicieron los ADR-065, ADR-067 y ADR-073 para sus estudios,
y cumple la definición de done de `tasks/task-issue-184.json` («ADR
documentando el estudio y su conclusión, con 'Related issue: #184'»).

Related issue: #184 — https://github.com/gonzalitojh/Registro-personal/issues/184

## Decisión

**Se declara factible la idea de la issue y se fija un alcance por fases
para futuras issues de implementación — fuera del alcance de esta issue, que
no implementa nada.** La base de la decisión:

1. **Casi toda la API es de categoría A (usable hoy en cliente)**: las 21
   secciones del catálogo (sección 4 del estudio) salvo cuentas/autenticación
   se consultan con GET público + `api_key` + CORS habilitado. No hay ningún
   cambio arquitectónico necesario: se amplía `js/api-movies.js` siguiendo
   los patrones existentes (caché 24 h + `networkFirst` + bajo demanda).
2. **`append_to_response` hace el enriquecimiento barato**: una ficha
   completa tipo IMDB cuesta 1 llamada por apertura (sección 4.21), no N.
   Las listas editoriales/discover cuestan 1 llamada por sección; el CDN de
   imágenes no tiene rate limit.
3. **Límites asumibles** (sección 6): rate limit blando ~40 req/s **por
   clave** (compartida por todos los usuarios) → se mantiene el modelo de
   bajo volumen + caché + bajo demanda (consumo actual ~0,005 req/s de
   media); caché de datos de la API ≤ 6 meses (los snapshots Firestore son
   coherentes); gratis no comercial con atribución (ya cumplida); prohibido
   el uso ML/AI de los datos; sin SLA.
4. **Infraestructura nueva solo si escala el número de usuarios**: si se
   golpease el rate limit conjunto, se aplicaría el patrón de proxy
   Cloudflare Worker ya probado con IGDB (ADR-067). No es necesario hoy.

### Alcance recomendado (para issues futuras, sección 8 del estudio)

- **Fase 1 — Personas y filmografía** (`person/{id}`, `combined_credits`,
  créditos ya usados): fichas de actor/director con biografía, foto,
  filmografía navegable y «ver más de este actor/director». Máximo
  valor/esfuerzo; el `person_id` ya llega en los créditos de la ficha.
- **Fase 2 — Descubrimiento** (`discover/movie|tv`, `trending/*`,
  `movie/popular|now_playing|upcoming|top_rated`, `tv/*`): secciones de
  tendencias/estrenos/populares y exploración avanzada (género, año,
  plataforma, nota) sin lógica propia.
- **Fase 3 — Riqueza de ficha** (imágenes, vídeos, certificaciones por
  país, release dates por país, ficha de episodio): galerías, tráilers
  adicionales y datos técnicos completos.
- **Fase 4 — Integración externa** (`external_ids`, `find`, `configuration`):
  «ver en IMDb/Wikipedia», importar por ID externo y configuración dinámica
  (tamaños de imagen, traducciones de jobs).
- **Fuera de alcance**: reviews y listas de usuarios de TMDB (la app tiene
  UGC propio), autenticación/cuentas v3 y v4 (duplica el sistema propio y
  exige OAuth), y changes/changelog (solo nota futura para el refresh del
  ADR-021).

## Alternativas descartadas

- **Mantener el statu quo** (9 endpoints): no satisface la idea de la issue;
  el estudio muestra que la ampliación es barata y sin riesgo.
- **Proxy/backend obligatorio desde el inicio**: sobredimensionado; toda la
  categoría A funciona en cliente (CORS verificado). Solo fase de escalado.
- **Migrar a API v4 con Access Token**: no aporta datos nuevos; en un
  cliente público la clave ya es visible, así que v4 no añade seguridad y
  añade gestión de token (sección 4.20).
- **Integrar cuentas/listas/reviews de TMDB**: duplica valoración/listas
  propias y exige OAuth; coste/beneficio negativo (secciones 4.16 y 4.19).

## Consecuencias

**Positivas**:

- La web puede acercarse a una experiencia tipo IMDB/TMDB **sin backend ni
  coste de infraestructura**, reutilizando los patrones ya probados.
- El `append_to_response` y las listas editoriales minimizan las llamadas
  nuevas (+10-30/día estimados, sección 6.4 del estudio).
- Cada fase es una issue independiente, desplegable de forma aislada.

**Negativas**:

- El rate limit por clave es compartido: obliga a mantener disciplina de
  caché y bajo volumen; un pico de usuarios requeriría el proxy (ADR-067).
- La atribución debe mantenerse y, si se amplía el uso, convendría añadir el
  **logo aprobado** en la sección de ajustes/acerca (hoy solo hay el aviso
  textual en el footer).
- TMDB puede cambiar términos/límites sin aviso; los snapshots locales
  mitigan la dependencia.

**Neutras**:

- No cambia el modelo de datos Firestore (los datos siguen siendo
  snapshots + bajo demanda); las fases añaden consumo de red solo al abrir
  cada función.
- El manual de usuario (regla 3 de AGENTS.md) se actualizará en cada fase
  que toque UI; esta issue no cambia nada visible → no procede.

## Archivos creados/modificados

- `docs/estudio-informacion-tmdb.md` | **Nuevo**: estudio completo (775
  líneas, QA PASS) cuya conclusión documenta este ADR.
- `docs/adr-074-estudio-informacion-tmdb.md` | **Nuevo**: este documento.
- `tasks/task-issue-184.json` | **Actualizado**: status y bloque `pr` al
  publicar la PR.

## Verificación

- **QA PASS** contra la aceptación del task file: catálogo por secciones
  (21 secciones + `append_to_response`), endpoints/datos/utilidad por
  sección, viabilidad categorías A/B, límites (rate limits, autenticación,
  CORS, costes, términos), conclusión con recomendación de alcance, ADR con
  `Related issue: #184`, **cero código de app** (`git diff` solo toca
  `docs/*.md` y `tasks/task-issue-184.json`).
- **Escaneo de seguridad**: sin hallazgos HIGH/MEDIUM; no se transcribe
  ninguna clave ni credencial en los documentos.
- **Reglas del proyecto**: regla 2 (responsividad), regla 3 (manual) y
  regla 4 (temas): **N/A** — no hay cambios de UI ni de comportamiento.
