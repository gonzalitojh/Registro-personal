# ADR-098: Pestaña «Resumen» de la sección de Gimnasio (issue #269)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #269 pide una **pestaña «Resumen»** como **PRIMERA pestaña de
la sección de Gimnasio** (issue #62, ADR-095): un resumen de los
ejercicios hechos en un periodo elegido, con tres opciones — **semana
en curso** (de lunes a hoy), **mes en curso** (del día 1 del mes a
hoy) y **rango libre** (fechas desde/hasta).

Contexto de ramificación: igual que ADR-096 y ADR-097, esta tarea nace
de `feat/issue-62-seccion-gimnasio` (la sección y el ADR-095 aún no
están en `dev`; PR #262 pendiente de integración). La rama de la #269
se fusionará en esa rama intermedia, de modo que este ADR llegará a
`dev` junto con la sección completa; por eso el número de serie
continúa tras ADR-097 (en el repo existen duplicados históricos de
ADR, por eso el siguiente número se calcula como el máximo existente
+ 1).

La implementación está validada (**QA PASS**: sandbox 20/20 de lógica
y 11/11 de router; revisión estática de las reglas 2 y 4 de
AGENTS.md) con **una iteración de QA** que detectó dos defectos,
corregidos en el commit `7d2982b`:

1. **Inputs de fecha del selector invisibles en Negro puro**: el
   patrón de tema dejaba los `input[type="date"]` del rango libre sin
   contraste sobre el fondo negro; fix con el override agrupado
   `[data-theme="black"] .gym-summary-selector input[type="date"]`.
2. **Guard de series sin ejercicio**: una entrada de entreno sin
   `ejercicioId` ni nombre (datos corruptos/legacy extremos) contaba
   sus series en el total sin haber ejercicio al que atribuirlas; fix
   con el guard de agrupación (la entrada se ignora).

Escaneo de seguridad sin hallazgos. El manual de usuario se actualiza
en esta misma tarea (regla 3 de AGENTS.md, §9.1). Este ADR documenta
la decisión a posteriori, como los recientes (ADR-093, ADR-094,
ADR-095, ADR-096, ADR-097).

Related issue: #269 — https://github.com/gonzalitojh/Registro-personal/issues/269

## Decisión

### 1. «Resumen» como primera pestaña y default de la sección

- Token de ruta **`resumen`**, panel **`#panel-gym-summary-tab`**
  (primer panel de `#gym-view`, con su `h2` oculto, el selector de
  periodo y el contenedor `#gym-summary-data` con `aria-live`).
- Al ser la **primera pestaña** pasa a ser el **default** de la
  sección: `GYM_DEFAULT_TAB = "resumen"`, coherente con la convención
  del repo (**primera pestaña = default**): `#/gimnasio` canoniza sin
  segmento y **`#/gimnasio/resumen` no es canónico** — el router lo
  normaliza a `#/gimnasio` (`invalid: true`), mismo patrón que ya
  aplicaba con la primera pestaña en Ocio y Recetas.
- `lastGymTab` y `openGym()` arrancan en `"resumen"`; el dispatch de
  renders por pestaña añade `resumen: renderSummary` (mismo patrón
  que `entrenos`/`ejercicios`).

### 2. Registro en `SECTION_REGISTRY` y ocultación desde Ajustes

- `resumen` se registra como **primera clave** de
  `SECTION_REGISTRY.gimnasio.tabs` y se añade
  `visibleTabs.resumen: true` a `DEFAULT_SETTINGS`: la pestaña se
  puede **ocultar desde Ajustes como las demás** (issues #97/#208,
  ADR-067, ADR-095).
- **`sanitizeVisibility()` cubre a usuarios con ajustes antiguos**:
  las claves que no están en el registro se ignoran y las válidas se
  rellenan con `true`, así que los ajustes guardados antes de la #269
  (sin `resumen`) muestran la pestaña visible sin intervención del
  usuario.

### 3. Acento violeta de la paleta existente

- La pestaña usa el acento **`--games`** (violeta, ya existente en la
  paleta — es el color de Videojuegos — y que Gimnasio no usaba
  hasta ahora), con **`--games-dark`** para el sello de la pestaña
  activa en Negro puro (`[data-theme="black"]
  .tab--gym-summary.is-active`), siguiendo el patrón de selectores
  agrupados con una sola fuente de verdad por regla (regla 4 de
  AGENTS.md).

### 4. Cálculo en cliente, sin queries nuevas a Firestore

El resumen se calcula **íntegramente en el cliente** con los datos ya
suscritos (patrón del pre-relleno de ADR-097: sin coste de lectura ni
latencia):

- **Fuentes**: `workouts` (ya ordenado desc por `fechaISO` de la
  suscripción de `db.js`, ADR-095) y `exercises` (catálogo, para
  resolver el nombre y el grupo muscular al pintar).
- **Filtro por rango**: comparación **lexicográfica** de `fechaISO`
  (`YYYY-MM-DD`); `from`/`to` nulos = límite abierto.
- **Agregación por ejercicio**: la clave es el **`ejercicioId` si
  sigue en el catálogo**; si no — ejercicio borrado del catálogo o
  datos legacy sin id — se agrupa por el **nombre snapshot
  normalizado** (trim + minúsculas). Los ejercicios borrados del
  catálogo conservan así su nombre en el resumen.
- **Volumen SIEMPRE acumulado en kg** (`pesoKg × reps`), convertido
  con `kgToDisplay` **solo al pintar** (1 decimal, mismo helper del
  resto de la sección): nunca se convierte por serie, así que
  alternar kg/lbs no introduce deriva de redondeo en los acumulados.
- **Las series con reps ≤ 0 no suman** reps ni volumen; el peso no
  numérico cuenta como 0; una entrada sin id ni nombre no agrupa ni
  cuenta sus series en el total (guard del fix de QA).
- **Salida**: tarjetas con los totales del periodo (entrenos, series,
  repeticiones y volumen total) y una tabla por ejercicio — veces
  (entrenos distintos en que aparece), series, reps, volumen y peso
  máximo — **ordenada por volumen desc** (tie-break por nombre).

### 5. Selector de periodo con el DOM como fuente de verdad

- Tres chips (**«Semana en curso»**, **«Mes en curso»**, **«Rango»**)
  con `aria-pressed` y los dos inputs `date` (desde/hasta) **siempre
  presentes** en el DOM: **sin estado de módulo ni persistencia** — el
  periodo activo se lee del DOM en cada render
  (`summaryPeriodRange()`: chip `.is-active` + valores de los
  inputs), con el patrón UTC de `ctx.todayISO()`.
- El rango libre es **inclusivo**, **intercambia `from > to`** y
  trata los **extremos vacíos como límite abierto**.
- El click en un chip sincroniza la UI (`is-active`/`aria-pressed`) y
  re-renderiza solo si el periodo cambió; los inputs re-renderizan al
  emitir `change` y solo cuando el chip activo es «Rango».

### 6. Re-render en tiempo real y seguridad de salida

- **`subscribeGymData` repinta el resumen** al llegar snapshots de
  `workouts` Y de `exercises` (el catálogo afecta a los nombres y
  grupos musculares de la tabla), siempre que la pestaña activa sea
  `resumen`.
- **`renderAllWithUnit` repinta el resumen al cambiar kg/lbs**: los
  pesos y volúmenes se convierten al momento sin re-calcular la
  agregación (el acumulado sigue canónico en kg).
- **Todos los valores pintados pasan por `escapeHtml`** (nombres,
  fechas, unidades y cifras), patrón del resto de la sección; el
  contenedor del resumen usa `aria-live="polite"`.

## Alternativas descartadas

- **Consulta nueva a Firestore por rango de fechas**: descartado —
  `workouts` ya está suscrito y ordenado desc por `fechaISO`; filtrar
  y agregar en memoria es instantáneo y no añade lecturas ni estado
  asíncrono (mismo criterio que el pre-relleno de ADR-097).
- **Persistir el periodo elegido** (estado de módulo o
  localStorage): descartado — el resumen es una vista de consulta; el
  DOM (chip activo + inputs) ya contiene el periodo en cada momento,
  y sin persistencia no hay estado que sincronizar entre dispositivos
  ni que limpiar al salir de la sección.
- **Añadir «Resumen» como tercera pestaña manteniendo Entrenos como
  default**: descartado — la issue pide el Resumen como PRIMERA
  pestaña; la convención del repo (primera pestaña = default) lo
  convierte automáticamente en la vista de entrada, que además es la
  más informativa de la sección.
- **Acumular el volumen convertido por serie en la unidad de
  presentación**: descartado — alternar kg/lbs re-calcularía los
  acumulados con redondeos intermedios; acumular en kg (canónico) y
  convertir solo al pintar es la misma garantía del resto de la
  sección (ADR-095).
- **Tratar el rango `from > to` como inválido (error)**: descartado —
  pedir al usuario que corrija el orden añade fricción sin beneficio;
  intercambiar los límites devuelve exactamente el mismo rango
  (inclusivo), como hace cualquier hoja de cálculo.

## Consecuencias

### Positivas

- **La sección gana una vista de síntesis**: «¿qué he entrenado esta
  semana/mes/rango?» se responde sin abrir entreno por entreno, con
  la misma calidad de datos (pesos canónicos en kg).
- **Default coherente con la convención del repo**: `#/gimnasio`
  aterriza en el Resumen y las rutas compartidas
  (`#/gimnasio/entrenos`, `#/gimnasio/ejercicios`) siguen
  funcionando; `#/gimnasio/resumen` se normaliza, sin rutas
  duplicadas ni ambigüedad.
- **Cero coste de datos y offline-first**: sin queries nuevas; el
  resumen vive de las suscripciones existentes y se actualiza en
  tiempo real al añadir, editar o borrar entrenos o ejercicios.
- **Sin deriva de conversión**: la agregación en kg con conversión
  solo al pintar garantiza totales estables al alternar la unidad.

### Neutras

- **Los ejercicios borrados del catálogo agrupan por nombre
  snapshot**: si un ejercicio se renombró tras guardarse entrenos, el
  resumen puede mostrar dos filas (canónica + legacy) para lo que en
  realidad es el mismo ejercicio; comportamiento degradado, no
  erróneo — el catálogo es la referencia (ADR-095).
- **El periodo no se recuerda entre visitas**: cada apertura de la
  sección empieza en «Semana en curso»; el usuario vuelve a elegir si
  quiere otro periodo.
- **Revalidado en iteración** (reanudación de la sesión): QA PASS —
  sandbox 20/20 de lógica (selector de periodo, rangos, agregación,
  unidades) y 11/11 de router (canonización y normalización de
  `#/gimnasio/resumen`), revisión estática de las reglas 2 y 4 de
  AGENTS.md (360/768/1280 px sin scroll horizontal y cuatro modos de
  tema) y escaneo de seguridad sin hallazgos. La iteración corrigió
  los inputs de fecha invisibles en Negro puro y el guard de series
  sin ejercicio, y este ADR se actualizó en consecuencia.
- **Manual de usuario actualizado** (§9.1 «Tu resumen», regla 3 de
  AGENTS.md): selector de periodo, tarjetas y tabla del resumen,
  unidad activa y aviso de periodo vacío documentados en lenguaje no
  técnico.

### Negativas / Riesgos

- **La agregación recorre todos los entrenos en memoria en cada
  render del resumen**: con los volúmenes reales de uso es
  instantánea (las mismas cargas que el resto de vistas de la
  sección); si el histórico creciera mucho cabría cachear por
  periodo, pero no hace falta en v1.
- **Ninguna otra conocida.** Validado: QA PASS (sandbox 20/20 lógica
  + 11/11 router; revisión estática reglas 2 y 4 de AGENTS.md) y
  escaneo de seguridad sin hallazgos; todos los valores pintados
  pasan por `escapeHtml`, continuando el patrón de validación y
  seguridad del resto de la sección (ADR-095, ADR-097).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: panel `#panel-gym-summary-tab` como primer panel de `#gym-view` (pestaña `tab--gym-summary` como primera, selector de periodo con chips e inputs date, tarjetas de totales y tabla por ejercicio) |
| `js/gym.js` | **Modificado**: `renderSummary()` / `summarizeWorkouts()` / `summaryPeriodRange()` / `summaryExerciseKey()` / `summaryGroupFor()` (agregación en cliente, filtro lexicográfico por `fechaISO`, volumen canónico en kg, clave por `ejercicioId` o nombre snapshot, tabla ordenada por volumen desc), selector de periodo con el DOM como fuente de verdad (`syncSummaryPeriodUI`), dispatch de renders por pestaña con `resumen`, re-render desde `subscribeGymData` y `renderAllWithUnit`, `escapeHtml` en todos los valores pintados; **iteración**: guard de series sin ejercicio (entrada sin id ni nombre excluida) |
| `js/router.js` | **Modificado**: `GYM_TAB_TO_PANEL` con `resumen` como primera clave, `GYM_DEFAULT_TAB = "resumen"`, canonización de `#/gimnasio` (normaliza `#/gimnasio/resumen` con `invalid: true`), `lastGymTab` arranca en `"resumen"` |
| `js/settings.js` | **Modificado**: `visibleTabs.resumen: true` en `DEFAULT_SETTINGS` y `resumen` como primera clave de `SECTION_REGISTRY.gimnasio.tabs` (ocultable desde Ajustes; `sanitizeVisibility` cubre a usuarios con ajustes antiguos) |
| `css/styles.css` | **Modificado**: estilos del resumen (`.gym-summary-selector`, chips `.gym-summary-chip`, `.gym-summary-grid`/`.gym-summary-card`, `.gym-summary-table` con `overflow-x: auto`), `.tab--gym-summary` con acento `--games` y overrides agrupados de las cuatro familias; **iteración**: override `[data-theme="black"] .gym-summary-selector input[type="date"]` (inputs invisibles en Negro puro) |
| `tasks/task-issue-269.json` | **Nuevo**: task file de la issue #269 |
| `docs/manual-de-usuario.md` | **Modificado**: §3 y §9 con la tercera pestaña de Gimnasio; nueva subsección **§9.1 «Tu resumen»** (renumeradas 9.2, 9.3 y 9.4); §17 Ajustes con las tres pestañas |
| `docs/adr-098-pestana-resumen-gimnasio.md` | **Nuevo**: este documento |

Related issue: #269 — https://github.com/gonzalitojh/Registro-personal/issues/269
