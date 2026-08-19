# ADR-111: Lista de premios completa y sin punteros basura a listas de Wikipedia (issue #311)

## Estado

Aceptado

## Fecha

2026-08-19

## Contexto

La issue #311 reporta que la lista de premios de la ficha no se muestra
completa: «La lista de premios no se muestra completa, sino que se
muestra una versión reducida». La rama base y el destino de la PR es
`feat/issue-201` (igual que #290-#310), no `dev`.

La sección «Premios» (issue #302, ADR-108) se alimenta de Wikidata:
declaraciones **P166** («award received») y **P1411** («nominated
for») del ítem del título, consultadas con SPARQL
(`wikidataAwardsQuery`/`wikidataAwardsByExternalIdQuery` en
`js/api-movies.js`), mapeadas por `mapAwardsBindings` y pintadas por
`awardsHtml` (`js/ui.js`).

Investigación previa a esta iteración (verificada contra el endpoint
real `query.wikidata.org`):

1. **El pipeline de la app es completo**: para todo título probado
   (Titanic 49 entradas, Breaking Bad 144, Juego de Tronos 13, Los
   Simpson 125, El Padrino 16, Pulp Fiction 68…) la app muestra
   EXACTAMENTE las declaraciones que Wikidata tiene. No hay `.slice()`,
   ni recortes CSS, ni pérdidas en el mapeo: el servicio de etiquetas
   `wikibase:label` conserva las filas sin etiqueta es/en (usa el QID)
   y Blazegraph no descarta filas por `BIND(YEAR(?date))` con fecha
   ausente.
2. **El problema está en la cobertura de Wikidata**: muchas series
   modernas tienen muy pocas declaraciones de premios (Better Call
   Saul: 1 nominación de 60+ reales; Vikings: 1; Sherlock: 4; The
   Walking Dead: 11) porque sus premios solo existen como artículo de
   Wikipedia («List of awards and nominations received by X»), no como
   declaraciones.
3. **Caso basura**: Stranger Things tiene UNA ÚNICA declaración P166
   cuyo valor es el ítem **«List of awards and nominations received by
   Stranger Things»** (P31 = Q13406463 «artículo de lista de
   Wikimedia»). La app la pintaba como un premio: una entrada con el
   nombre del artículo-lista. No es un premio real y nunca debe
   mostrarse como tal.
4. **Caché de fallos**: `getItemAwards` cacheaba `null` (24 h) cuando
   la consulta fallaba (WDQS responde 504 con frecuencia). Un fallo
   transitorio dejaba la sección «sin premios» durante todo el día.

**Verificación del caso Juego de Tronos (comentario 2026-08-19 de la
issue #311**: «Tengo comparando Juego de Tronos con la página de esta
serie en la propia TMDB y aparecen 81 nominaciones y 28 victorias,
mientras que en mi web solo aparecen 13 victorias… los premios Golden
Globe no aparecen»):

- El ítem de la serie (Q23572, `P4983` = TMDB `1399`) tiene **13
  declaraciones P166 y 0 P1411**: la app muestra exactamente «13
  premios» (verificado reproduciendo el pipeline completo
  `wikidataAwardsQuery` → `mapAwardsBindings` → contador de UI contra
  el endpoint real).
- El ítem **«List of awards and nominations received by Game of
  Thrones» (Q6606634) está vacío** (0 declaraciones P166/P1411): no
  hay nada que desreferenciar.
- **Los Globos de Oro no figuran en el ítem de la serie** en Wikidata:
  los ganó el reparto (p. ej. Peter Dinklage), y las declaraciones
  están en los ítems de las personas, no en el de la serie.
- Los «81 nominaciones / 28 victorias» de TMDB provienen de su **base
  de datos editorial** (recogida a mano, con otra granularidad: cuenta
  por persona, por entrega y por episodio) que **no se expone en la
  API pública de TMDB** (solo en su web). La diferencia NO es un fallo
  de la app: es la cobertura de Wikidata, su única fuente accesible.

Related issue: #311 — https://github.com/gonzalitojh/Registro-personal/issues/311

## Decisión

Tres cambios en la capa de datos de `js/api-movies.js` (el render
`awardsHtml` no se toca):

1. **Marcar y filtrar los punteros a listas**: ambas consultas SPARQL
   añaden al SELECT `?award` (QID del valor) y
   `?isList` = `BIND(EXISTS { ?award wdt:P31 wd:Q13406463 } AS ?isList)`.
   Nueva `isListPointerRow(b)` detecta esas filas (por `?isList` y, por
   robustez, por el patrón `/^list of (awards|honors|accolades|prizes)/i`
   del nombre — nunca coincide con los anexos legítimos tipo
   «Anexo:Óscar al mejor actor», cuyo nombre limpio es «Óscar al mejor
   actor»). `mapAwardsBindings` las descarta: **un puntero a lista
   jamás se pinta como premio**.
2. **Desreferencia de ítems de lista**: cuando el título NO tiene
   declaraciones reales (todas sus filas son punteros), `getItemAwards`
   consulta las declaraciones P166/P1411 PROPIAS del ítem de lista
   apuntado (un nivel, con el QID de `?award`, sin recursión) y las
   mapea como si fueran del título. Si el ítem de lista tampoco tiene
   declaraciones (el caso actual de Stranger Things), el resultado es
   `[]` y la sección no se pinta: degradación elegante, sin basura.
3. **La caché solo guarda resultados reales**: `setCache` se llama
   únicamente cuando la consulta SPARQL respondió (`data` no nulo). Un
   fallo transitorio (504, red) devuelve `null` SIN cachear y se
   reintenta en la siguiente apertura de la ficha. `[]` (consultado con
   éxito, sin premios) sí se cachea: es un resultado real.

Se conserva intacto el contrato de salida (`Array<{group, entries}>`
o `null`) que consumen `ui.js`, `modal-handlers.js` e `item-page.js`.

## Alternativas descartadas

- **Usar los premios de la web de TMDB** (81/28 de Juego de Tronos
  frente a los 13 de Wikidata): la API pública de TMDB no tiene
  endpoint de premios — solo su web los muestra, desde una base
  editorial propia y a otra granularidad (por persona, entrega y
  episodio). Raspado de la web de TMDB: descartado (frágil y fuera de
  la filosofía del proyecto). La cobertura sigue dependiendo de
  Wikidata, única fuente estructurada y abierta (ADR-108).
- **Leer los artículos-lista de Wikipedia (wikitext/HTML) para extraer
  los premios**: los premios reales de Better Call Saul, Stranger
  Things, Vikings… solo existen como tablas de esos artículos. Se
  descarta: scraping frágil (el formato de las tablas varía por
  artículo e idioma), fuera de la filosofía del proyecto (datos de
  APIs estructuradas con degradación elegante, no extracción de HTML).
  La cobertura depende de Wikidata, fuente ya documentada en
  ADR-108.
- **No cachear `[]`**: la consulta «sin premios» es un resultado real
  y re-consultarla en cada apertura costaría llamadas a WDQS sin
  beneficio (misma política de caché 24 h que el resto de bloques).
- **Mostrar el puntero a la lista con otro formato (p. ej. enlace)**: la
  sección es de solo lectura sobre premios reales; un enlace a un
  artículo de Wikipedia no es un premio y añadiría un tercer tipo de
  contenido sin pedido. Descartado.
- **Recursión en la desreferencia (lista → lista → …)**: sin casos
  reales conocidos; un nivel cubre el modelo observado y limita el
  coste a un máximo de una consulta extra.

## Consecuencias

**Positivas:**

- **Sin premios basura**: Stranger Things ya no muestra «1 premio:
  list of awards and nominations received by Stranger Things»; sin
  declaraciones reales la sección no aparece (como con cualquier
  título sin premios registrados).
- **Sin regresión**: los títulos con cobertura real (Titanic 49,
  Breaking Bad 144, Los Simpson 125, Pulp Fiction 68…) muestran
  exactamente la misma lista (verificado contra el endpoint real antes
  y después del cambio).
- **Futuro-proof**: si la comunidad de Wikidata registra declaraciones
  en los ítems de lista, la desreferencia las mostrará sin tocar la
  app.
- **Caché robusta**: un 504 transitorio de WDQS ya no deja la sección
  invisible 24 h.

**Negativas / neutras:**

- **Títulos con cobertura mínima en Wikidata** (Better Call Saul: 1
  nominación; Vikings: 1; Sherlock: 4) siguen mostrando pocos premios
  hasta que Wikidata los registre: es una limitación de la FUENTE
  (documentada en el manual), no de la app — el pipeline muestra todo
  lo que Wikidata tiene. **Juego de Tronos es el ejemplo canónico
  (comentario 2026-08-19): Wikidata tiene 13 premios y 0 nominaciones
  en el ítem de la serie, frente a los 28/81 de la web de TMDB; los
  Globos de Oro no aparecen porque Wikidata los tiene en los ítems del
  reparto, no en el de la serie, y el ítem-lista Q6606634 está vacío.**
  Cualquiera puede añadir declaraciones a Wikidata y la app las
  mostrará automáticamente (caché 24 h).
- Una consulta SPARQL extra (desreferencia) solo cuando el título
  apunta a listas y no tiene premios propios; cacheada 24 h.
- Versión PWA bumped a `20261003` (js/config.js, index.html,
  service-worker.js): un precache adicional para los usuarios al
  desplegar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: `wikidataAwardsQuery` y `wikidataAwardsByExternalIdQuery` añaden `?award` y `?isList` (EXISTS de P31=Q13406463) al SELECT; nueva `isListPointerRow` (por `?isList` o patrón «list of awards/honors/accolades/prizes»); `mapAwardsBindings` descarta las filas puntero; `getItemAwards` filtra punteros, desreferencia los ítems de lista cuando no hay premios propios (una consulta por lista, sin recursión) y solo cachea resultados reales de la consulta (los fallos se reintentan) |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261003` |
| `index.html` | **Modificado**: 3 referencias `?v=` a `20261003` |
| `service-worker.js` | **Modificado**: 7 referencias `?v=` de `STATIC_ASSETS` a `20261003` |
| `docs/manual-de-usuario.md` | **Modificado**: §12 bullet «Premios» — la lista muestra los premios registrados en Wikidata; los títulos cuyos premios solo existen como artículo-lista de Wikipedia pueden mostrar pocos premios o ninguno hasta que Wikidata los registre (nunca se muestra la lista como si fuera un premio). Iteración 2026-08-19: se aclara que el contador puede no coincidir con la web de TMDB (base editorial a otra granularidad, no expuesta en su API) con el ejemplo verificado de Juego de Tronos (13 premios en Wikidata frente a 81/28 en TMDB; Globos de Oro en los ítems del reparto) y que cualquiera puede añadir datos a Wikidata |
| `docs/adr-111-lista-premios-completa-wikidata.md` | **Nuevo**: este documento |
| `tasks/task-issue-311.json` | Task file de la tarea |

Related issue: #311 — https://github.com/gonzalitojh/Registro-personal/issues/311
