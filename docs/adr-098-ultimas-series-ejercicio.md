# ADR-098: Últimas series del ejercicio en el detalle del catálogo

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #270 pide que en la pestaña **«Ejercicios»** se muestren, en
el **detalle (modo lectura) de un ejercicio del catálogo**, las series
que se hicieron la **última vez** que se trabajó ese ejercicio. Hasta
ahora el detalle solo mostraba nombre, grupo muscular y notas: el
usuario que quería retomar un ejercicio con las mismas cargas tenía
que abrir el entreno correspondiente en busca de la sesión más
reciente.

La base ya resolvía la mitad del problema: el pre-relleno del
constructor de entrenos (#265, ADR-097) localiza las series de la
última vez mediante el match por `ejercicioId` con fallback legacy por
nombre; esta issue **lleva esa misma información al detalle del
catálogo**, de modo que el usuario la vea sin abrir ningún entreno.

Contexto de ramificación: igual que ADR-096 y ADR-097, esta tarea nace
de `feat/issue-62-seccion-gimnasio` (la sección y el ADR-095 aún no
están en `dev`; PR #262 pendiente de integración). La rama de la #270
se fusionará en esa rama intermedia, de modo que este ADR llegará a
`dev` junto con la sección completa; por eso el número de serie
continúa tras ADR-097 (en el repo existen duplicados históricos de
ADR, ej. dos `adr-094` y dos `adr-093`, por eso el siguiente número se
calcula como el máximo existente + 1).

La implementación está validada (QA PASS contra los criterios de
aceptación del task file, responsividad 360/768/1280 px y cuatro modos
de tema según las reglas 2 y 4 de AGENTS.md) y el manual de usuario se
actualiza en esta misma tarea (regla 3 de AGENTS.md, §9.2). Este ADR
documenta la decisión a posteriori, como los recientes (ADR-093,
ADR-094, ADR-095, ADR-096, ADR-097).

Related issue: #270 — https://github.com/gonzalitojh/Registro-personal/issues/270

## Decisión

### 1. Sección «Última vez» en el detalle del ejercicio

El modo lectura del ejercicio (`exerciseDetailHtml(ex)`) incorpora una
sección **«Última vez»** que muestra:

- la **fecha** del entreno más reciente donde se trabajó el ejercicio,
  formateada con `ctx.formatDateEs` (con fallback al ISO crudo si el
  formateo no produce texto);
- su **tabla de series** (peso × repeticiones) en la **unidad de
  presentación activa** (kg/lbs): cada fila es un par de `spans` con
  `kgToDisplay(series.pesoKg)` + `unitLabel()` y `reps`, reutilizando
  las clases `.gym-series-table`/`.gym-series-row` ya existentes en la
  sección (ADR-095/097), sin CSS nuevo ni listeners nuevos (están ya
  cubiertas en los cuatro modos de tema).

**Solo se renderiza si hay datos previos**: si el ejercicio nunca se
trabajó (`lastWorkoutForExercise` devuelve `null`), la sección no
aparece en absoluto.

### 2. Refactor del match: `lastWorkoutForExercise()`

La función `lastWorkoutSeriesForExercise()` (#265, pre-relleno del
constructor) se refactoriza a **`lastWorkoutForExercise(exerciseId,
nombre)`**, que ahora devuelve **`{ fechaISO, series } | null`** (con
`series` como copia `{pesoKg, reps}`), manteniendo exactamente la
misma lógica de match:

- recorre `workouts`, que ya llega **ordenado por `fechaISO` desc**
  desde la suscripción `orderBy("fechaISO","desc")` de `db.js`
  (ADR-095);
- **prioridad estricta del match canónico por `ejercicioId`**: la
  primera entrada con series de ese ejercicio gana y retorna;
- **fallback legacy por nombre snapshot normalizado** (trim +
  minúsculas) solo si ningún entreno tiene una entrada canónica de ese
  ejercicio, para datos antiguos sin id.

El call-site del pre-relleno (#265) se adapta al nuevo contrato
(`prev.series` en lugar de la serie directa); el detalle usa la misma
función, de modo que **ambas vistas comparten una sola fuente de
verdad** para «la última vez».

### 3. Sin consultas extra a Firestore

La sección «Última vez» se alimenta del **estado en memoria ya
suscrito** (`workouts` ordenado desc), igual que el pre-relleno
(ADR-097): no hay consultas adicionales, latencia ni coste de lectura
nuevos; el render es sincrónico dentro del modal.

## Alternativas descartadas

- **Epígrafe vacío «Sin registros previos» cuando no hay historial**:
  descartado — añadiría ruido visual en catálogos nuevos, donde casi
  ningún ejercicio se ha trabajado todavía; la ausencia de la sección
  comunica lo mismo sin ruido.
- **Función hermana para el detalle que duplicara el bucle de match**:
  descartado — crearía dos fuentes de verdad para «la última vez» con
  riesgo de divergencia; el refactor de la función existente (#265)
  para devolver también `fechaISO` resuelve ambos usos con una sola
  implementación.
- **Consulta adicional a Firestore** (p. ej. por ejercicio):
  descartado — `workouts` ya está suscrito y ordenado desc por
  `fechaISO`; una consulta extra añadiría latencia, estado asíncrono y
  costes de lectura sin beneficio, el mismo argumento ya documentado
  en ADR-097.

## Consecuencias

### Positivas

- **Ver con qué cargas se acabó la última sesión sin abrir el
  entreno**: el detalle del ejercicio responde la pregunta de la issue
  de un vistazo, con la fecha y la tabla de series en la unidad activa.
- **Una sola fuente de verdad para el match**: pre-relleno del
  constructor (#265) y detalle del catálogo (#270) comparten
  `lastWorkoutForExercise()`; el refactor añade la fecha al contrato
  sin tocar la lógica de emparejamiento ya validada.
- **Offline-first y sin coste adicional**: la sección usa los datos ya
  suscritos en memoria; no hay consultas ni latencia nueva.
- **Sin superficie nueva que mantener**: se reutilizan las clases de
  lectura existentes, ya cubiertas en los cuatro modos de tema, sin
  CSS ni listeners adicionales.

### Neutras

- **El cambio de nombre de un ejercicio no rompe el match canónico**:
  la prioridad estricta por `ejercicioId` prevalece siempre; el
  fallback por nombre solo aplica a datos legacy sin id (y puede no
  acertar si el ejercicio se renombró tras guardarse el entreno:
  comportamiento degradado, no erróneo, ya documentado en ADR-097).
- **El detalle de un ejercicio con muchas series previas crece**: la
  tabla muestra todas las series de la última sesión, pero el modal ya
  es scroll container (`.modal__card` con `max-height: 88vh` y
  `overflow-y: auto`), así que el contenido nunca se corta.
- **La sección solo aparece con historial**: en catálogos nuevos o con
  ejercicios nunca trabajados el detalle queda igual que antes.
- **Manual de usuario actualizado** (§9.2): la sección «Última vez»
  del modo lectura documentada (regla 3 de AGENTS.md).

### Negativas / Riesgos

- **Empates de `fechaISO` entre entrenos**: el mismo riesgo ya
  documentado en ADR-097 para el pre-relleno — si hay varios entrenos
  con la misma fecha, el orden entre ellos no está garantizado por la
  suscripción (solo el criterio `fechaISO` desc) y la sección podría
  mostrar un entreno distinto del realmente último. Impacto bajo:
  mismo día, resultados similares y siempre revisables, y el guard por
  `ejercicioId` es estable para el resto de casos.
- **Ninguna otra conocida.** Validado: QA PASS (criterios del task
  file, responsividad y cuatro modos de tema) y el código continúa el
  patrón de validación y seguridad del resto de la sección (ADR-095).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/gym.js` | **Modificado**: refactor de `lastWorkoutSeriesForExercise()` (#265) a `lastWorkoutForExercise(exerciseId, nombre)` devolviendo `{ fechaISO, series } \| null` (copia `{pesoKg, reps}`) con la misma lógica de match (canónico por `ejercicioId`, fallback legacy por nombre normalizado); call-site del pre-relleno adaptado a `prev.series`; `exerciseDetailHtml()` añade la sección «Última vez» (fecha con `ctx.formatDateEs` y tabla `.gym-series-table`/`.gym-series-row` con `spans` en la unidad activa; solo se renderiza si hay historial) |
| `docs/manual-de-usuario.md` | **Modificado**: §9.2 — sección «Última vez» del modo lectura (fecha y tabla de series del entreno más reciente, en la unidad de peso activa; no aparece en ejercicios nuevos) |
| `docs/adr-098-ultimas-series-ejercicio.md` | **Nuevo**: este documento |

Related issue: #270 — https://github.com/gonzalitojh/Registro-personal/issues/270
