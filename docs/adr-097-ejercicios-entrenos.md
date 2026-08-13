# ADR-097: Definir ejercicios de entrenos

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #265 pide **cuatro mejoras en la sección Gimnasio** (issue
#62, ADR-095), todas centradas en cómo se definen los ejercicios
dentro del constructor de entrenos:

1. Un botón **«Nuevo ejercicio»** junto a «+ Añadir ejercicio» que
   abra la misma ventana de creación de ejercicio de la pestaña
   Ejercicios.
2. **Eliminar la opción «Otro (escribir nombre)…»** del desplegable de
   ejercicios del constructor.
3. Un botón **«Duplicar serie»** junto a «+ Añadir serie» en cada
   bloque de ejercicio.
4. Que al añadir un ejercicio **ya trabajado previamente**, las series
   se rellenen por defecto con las de la **última vez** que se trabajó.

Contexto de ramificación: igual que ADR-096, esta tarea nace de
`feat/issue-62-seccion-gimnasio` (la sección y el ADR-095 aún no están
en `dev`; PR #262 pendiente de integración). La rama de la #265 se
fusionará en esa rama intermedia, de modo que este ADR llegará a `dev`
junto con la sección completa; por eso el número de serie continúa
tras ADR-096 (en el repo existen duplicados históricos de ADR, ej.
dos `adr-094`, por eso el siguiente número se calcula como el máximo
existente + 1).

La implementación está validada (QA PASS contra los criterios de
aceptación del task file: botones y pre-relleno verificados,
responsividad 360/768/1280 px y cuatro modos de tema según las reglas
2 y 4 de AGENTS.md) y el manual de usuario se actualiza en esta misma
tarea (regla 3 de AGENTS.md, §9.1). Este ADR documenta la decisión a
posteriori, como los recientes (ADR-093, ADR-094, ADR-095, ADR-096).

Related issue: #265 — https://github.com/gonzalitojh/Registro-personal/issues/265

## Decisión

### 1. Botón «Nuevo ejercicio»: reutiliza el modal de la pestaña Ejercicios

Junto a «+ Añadir ejercicio» se añade **«Nuevo ejercicio»** en la
misma fila (`.gym-block-button-row`, con salto de línea en pantallas
estrechas). Al pulsarlo se abre **`openExerciseModal()`, el MISMO
modal de alta de ejercicio que la pestaña Ejercicios**, sin cerrar el
modal de entreno: al guardar el ejercicio nuevo, el catálogo se
actualiza (suscripción en vivo de `db.js`) y el usuario lo selecciona
en el desplegable del constructor. Mismo patrón que el hint «Ver
catálogo de ejercicios» del catálogo vacío: una sola fuente de verdad
para la creación de ejercicios (ADR-095, `js/gym.js`).

### 2. Eliminación de «Otro (escribir nombre)…» con compatibilidad legacy

Se elimina la opción **`value="__custom__"`** del desplegable de
ejercicios del constructor (y con ella el input de nombre libre y la
rama `customSelected` de la lógica de sync). El catálogo pasa a ser la
**única vía** para definir ejercicios de un entreno, cerrando la doble
representación de datos (`ejercicioId` vs `null` + nombre) que
ADR-095 había previsto.

**Compatibilidad con datos antiguos** (entrenos guardados antes con
`ejercicioId: null` y nombre snapshot):

- El bloque muestra el **nombre snapshot como placeholder** del select
  (en vez de «Elige un ejercicio…») para no perder la referencia.
- `syncWorkoutDraftFromDom` **mantiene el fallback al nombre del
  borrador** (`workoutDraft.ejercicios[idx]?.nombre`) cuando el select
  no encuentra el ejercicio en el catálogo; al guardar, el entreno
  legacy conserva su nombre sin alteraciones.

### 3. Botón «Duplicar serie»

En cada bloque de ejercicio, junto a «+ Añadir serie», se añade
**«Duplicar serie»**: clona la **última serie del bloque** (peso en kg
y repeticiones) añadiéndola al final y devuelve el foco a la fila
nueva. Si el bloque no tiene ninguna serie, muestra un
**`showToast`** de aviso («No hay ninguna serie que duplicar.») sin
crear filas vacías. Caso de uso real: series progresivas donde la
siguiente serie parte de la anterior con un ajuste mínimo.

### 4. Pre-relleno de series de la última vez

Al **seleccionar en el constructor un ejercicio del catálogo que ya se
trabajó antes**, sus series se siembran con las de la **última vez**
(entreno más reciente por `fechaISO`), de modo que solo haya que
ajustarlas. Reglas de la implementación:

- **Fuente de datos sin consulta extra**: `workouts` ya llega ordenado
  desc por `fechaISO` de la suscripción `orderBy("fechaISO","desc")`
  de `db.js` (ADR-095); `lastWorkoutSeriesForExercise()` recorre el
  array en memoria y devuelve una copia `{pesoKg, reps}` de la primera
  ocurrencia con series.
- **Match canónico por `ejercicioId` con prioridad estricta**; para
  datos legacy sin id (entrenos pre-eliminación de «Otro…») hay
  **fallback por nombre snapshot normalizado** (trim + minúsculas),
  usado solo si ningún entreno tiene una entrada canónica de ese
  ejercicio (así una entrada legacy del mismo nombre en el entreno
  más reciente nunca gana al canónico).
- **Solo si el bloque aún no tiene series** (`entry.series.length === 0`):
  no pisa nada ya escrito ni las series de un entreno en edición; si
  no hay series previas o no hay match, no hace nada.
- **Los datos siguen canónicos en kg**: el borrador guarda SIEMPRE
  `pesoKg`; la unidad de presentación (kg/lbs) convierte solo en el
  render (ADR-095), así que el pre-relleno es agnóstico a la unidad
  activa.

## Alternativas descartadas

- **Modal de ejercicio duplicado/embebido dentro del constructor**:
  descartado — duplicaría el markup y la lógica del modal de la
  pestaña Ejercicios, creando dos fuentes de verdad para la creación;
  reutilizar `openExerciseModal()` (patrón ya usado por el hint de
  catálogo vacío) es coherente y sin coste, y el modal de entreno
  permanece abierto con el borrador intacto.
- **Mantener «Otro…» oculto (pero presente en el código)** o
  **sustituirlo por un campo de texto libre**: descartado — la issue
  pide eliminarlo; con «Nuevo ejercicio» el caso de uso queda cubierto
  y se acaba la dualidad de modelos (`ejercicioId` vs `null`+nombre),
  simplificando la lógica de sync y el pre-relleno.
- **Pre-relleno con una consulta extra a Firestore** (p. ej. por
  ejercicio): descartado — `workouts` ya está suscrito y ordenado desc
  por `fechaISO`; una consulta adicional añadiría latencia, estado
  asíncrono y costes de lectura sin beneficio (la suscripción ya tiene
  todo el histórico en memoria).
- **Pre-relleno incondicional al seleccionar un ejercicio** (pisar lo
  escrito): descartado — sobrescribiría series ya introducidas y las
  de un entreno en edición; el guard `entry.series.length === 0` solo
  siembra bloques vacíos, que es el caso que la issue pide cubrir.
- **Duplicar por índice fijo o con selector de serie**: descartado —
  la «serie inmediatamente superior» es la última del bloque (la que
  se acaba de rellenar), no hace falta selección; un selector
  añadiría UI sin valor y el duplicado de la última cubre las series
  progresivas.

## Consecuencias

### Positivas

- **Crear un ejercicio sin abandonar el entreno**: una sola fuente de
  verdad (el modal de Ejercicios) y cero riesgo de perder el borrador
  del entreno abierto.
- **Modelo de datos simplificado**: el catálogo es la única vía para
  definir ejercicios; los datos legacy (id `null` + nombre snapshot)
  se conservan y siguen editables sin pérdida de referencia.
- **Menos escritura y menos errores de transcripción**: series
  duplicadas y pre-relleno de la última sesión con pesos reales
  guardados (canónicos en kg, sin redondeos de conversión).
- **Offline-first y sin coste adicional**: el pre-relleno usa los
  datos ya suscritos en memoria; no hay consultas ni latencia nueva.

### Neutras

- **El pre-relleno solo aplica al seleccionar un ejercicio por primera
  vez en el bloque**: al editar un entreno existente (series ya
  presentes) o tras escribir manualmente, no interfiere.
- **El match legacy por nombre normalizado puede no acertar** si el
  ejercicio se renombró tras guardarse el entreno: en ese caso
  simplemente no pre-rellena (comportamiento degradado, no erróneo).
- **Revalidado en iteración** (reanudación de la sesión): QA PASS y
  escaneo de seguridad sin hallazgos. Se aplicó una mejora sobre el
  match del pre-relleno — prioridad estricta del `ejercicioId`
  canónico frente al fallback por nombre — y se actualizó este ADR en
  consecuencia (antes el fallback podía ganar dentro de un mismo
  entreno si la entrada legacy aparecía antes en el array; impacto
  mínimo, corregido en la revisión).
- **Manual de usuario actualizado** (§9.1): botones «Nuevo ejercicio»
  y «Duplicar serie» y comportamiento del pre-relleno documentados
  (regla 3 de AGENTS.md).

### Negativas / Riesgos

- **Empates de `fechaISO` entre entrenos**: si hay varios entrenos con
  la misma fecha, el orden entre ellos no está garantizado por la
  suscripción (solo el criterio `fechaISO` desc); el pre-relleno podría
  tomar un entreno distinto del realmente último. Impacto bajo: mismo
  día, resultados similares y siempre revisables, y el guard por
  `ejercicioId` es estable para el resto de casos.
- **Los pesos pre-rellenos son orientativos**: si ese día el usuario
  cambió la carga, debe ajustarla; el pre-relleno nunca pisa series ya
  escritas, así que el riesgo de pérdida de datos es nulo.
- **Ninguna otra conocida.** Validado: QA PASS (AC1–AC4 del task file,
  responsividad y cuatro modos de tema) y el código continúa el patrón
  de validación y seguridad del resto de la sección (ADR-095).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/gym.js` | **Modificado**: botón «Nuevo ejercicio» (abre `openExerciseModal()` sin cerrar el modal de entreno), eliminación de «Otro…» (`__custom__`) con placeholder del nombre legacy, botón «Duplicar serie» (última serie, `showToast` si no hay), pre-relleno de series (`lastWorkoutSeriesForExercise()` / `maybePrefillSeriesFromLastWorkout()`) con match por `ejercicioId` y fallback por nombre |
| `css/styles.css` | **Modificado**: `.gym-block-button-row` (fila de botones «añadir/nuevo» y «añadir/duplicar» con salto en pantallas estrechas; sin overrides de tema: reutiliza `.btn` y `.gym-add-series-btn`, ya cubiertos en las cuatro familias) |
| `docs/manual-de-usuario.md` | **Modificado**: §9.1 — botones «Nuevo ejercicio» y «Duplicar serie» y pre-relleno de series de la última vez |
| `docs/adr-097-ejercicios-entrenos.md` | **Nuevo**: este documento |

Related issue: #265 — https://github.com/gonzalitojh/Registro-personal/issues/265