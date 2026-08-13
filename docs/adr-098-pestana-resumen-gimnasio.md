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

### Iteración (segundo comentario de 2026-08-13)

El usuario dejó un segundo comentario en la issue con tres peticiones
nuevas, incorporadas en la misma PR:

1. **Los selectores de fecha deben estar ocultos salvo con la opción
   «Rango» activa**: en la versión primera los dos `input[type="date"]`
   (desde/hasta) estaban siempre visibles junto a los chips. Ahora
   viven dentro de un **único recuadro** (`<details
   id="gym-summary-range">`) que solo se muestra al activar el chip
   «Rango» (atributo `hidden` controlado por
   `syncSummaryPeriodUI()`); con «Semana en curso» o «Mes en curso»
   el recuadro permanece oculto para no estorbar.
2. **Fusionar las dos fechas en un único recuadro**: el `<details>`
   nace **abierto** al pulsar «Rango» y muestra las dos fechas dentro;
   su cabecera (sin marcador nativo, `list-style: none`) resume el
   rango ya elegido («desde – hasta», o «sin límite» en los extremos
   vacíos) vía `updateSummaryRangeSummary()`, que se repinta también
   al cambiar cualquier fecha.
3. **Cambiar los totales: nada de sumatorios de series,
   repeticiones o volumen**: las tarjetas pasan a **nº de entrenos** y
   **nº de ejercicios distintos** del periodo; se añade un desglose
   **«Por grupos musculares»** (ejercicios distintos y entrenos por
   grupo) y la tabla por ejercicio se simplifica a **ejercicio +
   veces** (entrenos en que aparece). La agregación
   (`summarizeWorkouts()`) ya no acumula reps/volumen ni peso máximo
   (la iteración 3 añadirá después los extremos de peso por
   ejercicio, mín/máx, en la tabla); los grupos se resuelven como
   antes (grupo de la entrada, del catálogo por id o por nombre
   normalizado). Las entradas sin grupo muscular siguen contando en
   los totales pero no en el desglose por grupos.

Revalidado en esta iteración: sandbox de lógica 42/42 (agregación por
ejercicio y por grupos, rangos con límites abiertos e intercambio
`from > to`, cambios del selector con el recuadro oculto/visible y su
resumen de fechas) y revisión estática de las reglas 2 y 4 de
AGENTS.md (360/768/1280 px sin scroll horizontal y cuatro modos de
tema); escaneo de seguridad sin hallazgos.

### Iteración 3 (tercer comentario de 2026-08-13)

El usuario dejó un tercer comentario con dos peticiones, incorporadas
en la misma PR:

1. **El rango en un único recuadro para elegir desde y hasta a la
   vez**: "el rango para elegir sigue separado en dos recuadros en
   lugar de solo uno". Los dos `input[type="date"]` (desde/hasta)
   dentro del `<details>` se sustituyen por un **único recuadro** con
   **calendario propio** (`div#gym-summary-range` + popover con
   rejilla de 42 días, lunes primero): el **primer click fija
   «desde»** y el **segundo «hasta»** (intercambiando los extremos si
   el segundo es anterior al primero); con el rango completo, un
   click empieza otro rango. El calendario navega por meses (‹ ›),
   ofrece **Borrar** (vuelve a los límites abiertos) y **Listo**, y se
   cierra con **Escape** o al hacer click fuera; el trigger lleva
   `aria-expanded`/`aria-controls`, el popover `role="dialog"` y el
   foco vuelve al trigger al cerrar. En pantallas **≤767 px** el
   popover pasa a flujo normal: con el posicionamiento absoluto la
   banda 540–680 px desbordaba el borde derecho de la página
   (medido con Chromium headless).
2. **Aumento de peso por ejercicio**: "añade en el resumen de cada
   ejercicio el aumento de peso que ha habido. El menor registrado en
   el periodo y el mayor". La tabla «Por ejercicio» añade **Peso
   mín**, **Peso máx** y **Aumento** (máx − mín) en la unidad de
   presentación activa. `summarizeWorkouts()` agrega los extremos en
   **kg canónicos** (conversión única al pintar, sin deriva de
   redondeo); las **series sin peso registrado (null o ≤ 0, p. ej. a
   peso corporal) no pueden ser extremos**, y un ejercicio sin ningún
   peso en el periodo muestra «—».

Revalidado en esta iteración: sandbox de lógica **46/46** (grid de 42
celdas y bisiestos, navegación de mes entre años, máquina de estados
del rango, límites abiertos, agregación con extremos de peso,
exclusión de series sin peso, conversión única al pintar, entradas
corruptas y 500 entrenos < 200 ms); **QA PASS** con medición real en
Chromium headless de `scrollWidth <= innerWidth` en
360/500/560/600/620/680/720/768/1280 px y contraste WCAG calculado de
los elementos nuevos en los cuatro modos (la revalidación tras los
fixes encontró y corrigió: weekday y bordes bajo AA en Oscuro, hover
del día seleccionado que tapaba el extremo, y el desborde del popover
citado arriba); escaneo de seguridad sin hallazgos HIGH.

### Iteración 4 (cuarto comentario de 2026-08-13)

El usuario dejó un cuarto comentario con dos peticiones, incorporadas
en la misma PR (que se actualiza, no se crea otra):

1. **El calendario del rango no debe cerrarse al elegir la primera
   fecha**: "cuando seleccionas un rango de fechas, el calendario se
   cierra solo al elegir la primera fecha y no te deja elegir la
   segunda". Causa raíz encontrada con Chromium headless: el primer
   click en un día **cerraba** el popover porque
   `onSummaryRangeDayClick()` re-renderiza la rejilla y **detacha el
   botón pulsado** antes de que el handler de click-outside de
   `document` (fase burbuja) corriera; `e.target.closest("#gym-summary-range")`
   fallaba sobre el nodo descolgado y cerraba el calendario con solo
   «desde» elegido. Fix: un listener en **fase de captura** sobre
   `#gym-summary-range` marca `e.__summaryRangeInside = true`, y el
   handler de click-outside exige `!e.__summaryRangeInside` (además de
   no nacer en `.gym-summary-chip`) para cerrar. El calendario
   permanece abierto **hasta que las dos fechas están elegidas**; el
   cierre al completar el rango lo sigue haciendo
   `onSummaryRangeDayClick()`, y **Esc / «Listo» / click fuera real**
   siguen cerrando igual (revalidado en el sandbox).
2. **La tabla por ejercicio solo con la diferencia de peso**: "no
   muestres el peso mínimo ni el máximo, sino la diferencia: el peso
   más antiguo y el más nuevo. Es decir, aparezca en negativo o en
   positivo según haya habido aumento o disminución". Las columnas
   **Peso mín** y **Peso máx** de la iteración 3 se **eliminan**; la
   columna pasa a llamarse **«Diferencia»** y muestra
   `pesoNuevo − pesoAntiguo` con **signo explícito** (`+` si subió,
   `−` si bajó, `0` sin signo, «—» sin ningún peso en el periodo).
   `summarizeWorkouts()` agrega ahora **extremos cronológicos**, no
   extremos de valor: como la lista llega **desc por `fechaISO`**
   (suscripción de `db.js`, ADR-095), la **primera vez** que se ve un
   ejercicio fija su **peso más nuevo** (última serie con peso del
   entreno más reciente del periodo) y cada entreno posterior
   sobrescribe el **peso más antiguo** hasta quedarse con la primera
   serie con peso del entreno más remoto; dentro de un entreno, la
   **primera serie con peso** es la antigua y la **última** la nueva.
   Se mantienen los kg canónicos con conversión única al pintar y la
   exclusión de series sin peso (null o ≤ 0).

Revalidado en esta iteración: **QA PASS** con el sandbox de
Chromium headless actualizado (el calendario sigue abierto tras el
primer día, se cierra al completar el rango, y Esc/«Listo»/click
fuera siguen cerrando; la tabla por ejercicio muestra solo
«Diferencia» con signo — `+5`, `−2.5`, `0` y «—» — sobre datos con
aumento, disminución, dato único y sin pesos); escaneo de seguridad
sin hallazgos HIGH.

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
- **Pesos SIEMPRE en kg canónicos** (`pesoKg`), convertidos con
  `kgToDisplay` **solo al pintar** (1 decimal, mismo helper del resto
  de la sección): la diferencia por ejercicio (peso más nuevo − peso
  más antiguo) se calcula en kg y se convierte **una sola vez** al
  pintar, así que alternar kg/lbs no introduce deriva de redondeo ni
  cambia lo agregado.
- **Las series sin peso registrado (null o ≤ 0) no participan en los
  extremos cronológicos** (no pueden ser ni el más antiguo ni el más
  nuevo); una entrada sin id ni nombre no agrupa ni cuenta (guard del
  fix de QA).
- **Salida**: ya no hay sumatorios de series, repeticiones ni
  volumen. Las tarjetas son **nº de entrenos** y **nº de ejercicios
  distintos** del periodo; el desglose **«Por grupos musculares»** da
  ejercicios distintos y entrenos por grupo; la tabla **«Por
  ejercicio»** muestra **veces** (entrenos distintos en que aparece),
  ordenada por frecuencia desc (tie-break alfabético) y, desde la
  **iteración 4**, la **diferencia de peso** del periodo por ejercicio
  — **peso más nuevo − peso más antiguo**, con signo (`+` aumento,
  `−` disminución) — en la unidad de presentación activa («—» si no
  hay ningún peso en el periodo). Los grupos se resuelven del mismo
  modo que antes (entrada → catálogo por id → por nombre
  normalizado); sin grupo muscular, la entrada solo cuenta en los
  totales.

### 5. Selector de periodo: chips en el DOM y rango con calendario único

- Tres chips (**«Semana en curso»**, **«Mes en curso»**, **«Rango»**)
  con `aria-pressed`; el **chip activo es la fuente de verdad del
  periodo** en cada render (`summaryPeriodRange()`: semana/mes se
  recalculan con el patrón UTC de `ctx.todayISO()` en cada lectura).
- El **rango libre** se elige en un **único recuadro** (iteración 3):
  `div#gym-summary-range`, oculto salvo con la opción «Rango»
  (`hidden` controlado por `syncSummaryPeriodUI()`, que al activarlo
  abre el calendario y al salir a semana/mes lo cierra). El trigger
  resume el rango ya elegido («desde – hasta», o «sin límite» en los
  extremos vacíos) y abre el popover del **calendario único**: un
  click fija «desde», el segundo «hasta» (intercambio automático si
  es anterior), los días intermedios se marcan, se navega por meses
  y «Borrar»/«Listo» gestionan el estado. El rango
  (`summaryRange {from, to}`, null = límite abierto) es **estado de
  módulo** (el calendario es su interfaz de edición; no hay inputs
  nativos que leer) y `resetGymData()` lo limpia al cerrar sesión.
- El rango es **inclusivo**, **intercambia `from > to`** (defensivo;
  el calendario ya evita el orden inverso al elegir) y trata los
  **extremos vacíos como límite abierto**.
- El click en un chip sincroniza la UI (`is-active`/`aria-pressed`,
  visibilidad y apertura del recuadro) y re-renderiza solo si el
  periodo cambió; los días del calendario re-renderizan el resumen en
  directo (también al fijar solo el «desde», con el «hasta» abierto).

### 6. Re-render en tiempo real y seguridad de salida

- **`subscribeGymData` repinta el resumen** al llegar snapshots de
  `workouts` Y de `exercises` (el catálogo afecta a los nombres y
  grupos musculares de la tabla), siempre que la pestaña activa sea
  `resumen`.
- **`renderAllWithUnit` repinta el resumen al cambiar kg/lbs**: tras
  la iteración del segundo comentario el resumen dejó de mostrar
  volúmenes, pero desde la **iteración 4** vuelve a mostrar pesos
  (diferencia por ejercicio); el repintado refresca las columnas
  a la unidad nueva (la diferencia se calcula en kg, la conversión
  ocurre al pintar).
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
  chip activo vive en el DOM y el rango libre de la iteración 3 (estado
  de módulo volátil, sin persistencia) se descarta al recargar o al
  cerrar sesión, sin estado que sincronizar entre dispositivos.
- **Añadir «Resumen» como tercera pestaña manteniendo Entrenos como
  default**: descartado — la issue pide el Resumen como PRIMERA
  pestaña; la convención del repo (primera pestaña = default) lo
  convierte automáticamente en la vista de entrada, que además es la
  más informativa de la sección.
- **Conservar los sumatorios de series, repeticiones y volumen en el
  resumen**: descartado — el segundo comentario de la issue los pide
  explícitamente fuera («no me sirven de nada») a favor del nº de
  entrenos, ejercicios totales y el desglose por grupos musculares;
  eliminarlos simplifica además la agregación (una pasada sin
  acumulados por serie).
- **Conservar los dos `input[type="date"]` nativos (desde/hasta) en
  el recuadro**: descartado — el tercer comentario lo pide
  explícitamente («sigue separado en dos recuadros en lugar de solo
  uno para elegir fecha de inicio y fin a la vez»); el calendario
  único muestra además el rango de un vistazo (extremos e intermedios
  marcados) y evita abrir el picker nativo dos veces.
- **Picker de rango nativo o librería externa**: descartado — el
  navegador no ofrece un control de rango nativo y la sección no usa
  librerías; el calendario propio (grid 42 celdas, lunes primero,
  sin dependencias) mantiene el proyecto autónomo y offline-first con
  el patrón visual de la sección.
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
- **Resumen centrado en lo que pide el usuario** (iteración del
  segundo comentario): las tarjetas de entrenos y ejercicios totales
  y el desglose por grupos musculares responden «¿cuánto y qué he
  entrenado?» sin ruido de sumatorios que al usuario no le aportan;
  el selector de periodo queda más limpio al ocultar el recuadro del
  rango salvo cuando se usa.
- **El rango se elige en un único recuadro** (iteración 3): el
  calendario propio elimina la fricción de dos pickers nativos
  separados y muestra el rango de un vistazo (extremos e intermedios
  marcados); desde la **iteración 4** además no se cierra al elegir
  solo la primera fecha (se mantiene abierto hasta completar el rango,
  con Esc/«Listo»/click fuera real para cerrar), y la **diferencia de
  peso por ejercicio** (peso más nuevo − más antiguo, con signo `+`/
  `−` en la unidad activa) responde «¿cuánto he subido o bajado de
  peso en el periodo?» directamente desde el resumen.

### Neutras

- **Los ejercicios borrados del catálogo agrupan por nombre
  snapshot**: si un ejercicio se renombró tras guardarse entrenos, el
  resumen puede mostrar dos filas (canónica + legacy) para lo que en
  realidad es el mismo ejercicio; comportamiento degradado, no
  erróneo — el catálogo es la referencia (ADR-095).
- **El periodo no se recuerda entre visitas**: cada apertura de la
  sección empieza en «Semana en curso»; el usuario vuelve a elegir si
  quiere otro periodo (el rango libre tampoco persiste: es estado de
  módulo volátil desde la iteración 3).
- **El rango libre se pierde al salir de la sección**: al ser estado
  de módulo (iteración 3), navegar a otra sección y volver reinicia
  el recuadro en «sin límite – sin límite»; coherente con la política
  de no persistir el periodo.
- **Revalidado en iteración** (tercer comentario de 2026-08-13): QA
  PASS — sandbox 46/46 (grid y navegación del calendario, máquina de
  estados del rango, agregación con extremos de peso y conversión
  única al pintar, exclusión de series sin peso, entradas corruptas,
  rendimiento), `scrollWidth <= innerWidth` medido con Chromium
  headless en 360–1280 px (incluida la banda 540–680 px que
  desbordaba con el popover absoluto y se corrigió con flujo estático
  ≤767 px) y contraste WCAG en los cuatro modos (fixes de Oscuro:
  weekday y bordes de `--today`/trigger abierto pasan a `--games` o
  `--ink`; hover del día seleccionado conserva el extremo); escaneo
  de seguridad sin hallazgos.
- **Revalidado en iteración** (cuarto comentario de 2026-08-13): QA
  PASS — sandbox de Chromium headless (el calendario permanece abierto
  tras el primer día y se cierra al completar el rango; Esc/«Listo»/
  click fuera real siguen cerrando; tabla por ejercicio solo con
  Diferencia con signo — `+5`/`−2.5`/`0`/«—» —, calculada desde pesos
  cronológicos desc), scroll sin desbordes en los anchos de la
  iteración previa y contraste de los elementos nuevos en los cuatro
  modos; escaneo de seguridad sin hallazgos.
- **Manual de usuario actualizado** (§9.1 «Tu resumen», regla 3 de
  AGENTS.md): selector de periodo con el recuadro del rango oculto
  salvo en «Rango» (calendario único: primer click = desde, segundo =
  hasta, permanece abierto hasta elegir las dos fechas, navegación de
  mes, Borrar/Listo, Esc/click fuera), tarjetas de entrenos/
  ejercicios, desgloses por grupos musculares y por ejercicio con la
  diferencia de peso con signo, y aviso de periodo vacío documentados
  en lenguaje no técnico.

### Negativas / Riesgos

- **La agregación recorre todos los entrenos en memoria en cada
  render del resumen**: con los volúmenes reales de uso es
  instantánea (las mismas cargas que el resto de vistas de la
  sección; medido: 500 entrenos × 6 ejercicios en < 200 ms); si el
  histórico creciera mucho cabría cachear por periodo, pero no hace
  falta en v1.
- **El calendario del rango es un componente propio sin librería**:
  asume las convenciones es-ES (semana empezando en lunes, meses en
  español, formato DD/MM/YYYY), igual que el resto del resumen; un
  cambio de idioma futuro tendría que tocar `summaryWeekdayLabelsFn`
  y `summaryRangeMonthLabel`.
- **Ninguna otra conocida.** Validado en las iteraciones del tercer y
  cuarto comentario: QA PASS (sandbox 46/46 de lógica; sandbox de
  Chromium headless del calendario abierto hasta las dos fechas y de
  la tabla con diferencia con signo; medición real de scroll en
  Chromium headless y contraste de los cuatro modos) y escaneo de
  seguridad sin hallazgos HIGH; todos los valores pintados pasan por
  `escapeHtml`, continuando el patrón de validación y seguridad del
  resto de la sección (ADR-095, ADR-097).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: panel `#panel-gym-summary-tab` como primer panel de `#gym-view` (pestaña `tab--gym-summary` como primera, selector de periodo con chips y recuadro del rango, tarjetas de totales y desgloses); **iteración 2**: las dos fechas dentro del `<details id="gym-summary-range">` (única caja, `hidden` salvo con «Rango»); **iteración 3**: el `<details>` se sustituye por el recuadro único con calendario (`#gym-summary-range-trigger` con `aria-expanded`/`aria-controls` + popover `role="dialog"` con navegación de mes, rejilla `#gym-summary-range-days` y footer Borrar/Listo) |
| `js/gym.js` | **Modificado**: `renderSummary()` / `summarizeWorkouts()` / `summaryPeriodRange()` / `summaryExerciseKey()` / `summaryGroupFor()` (agregación en cliente, filtro lexicográfico por `fechaISO`, clave por `ejercicioId` o nombre snapshot, tabla ordenada por frecuencia desc), selector de periodo con el chip en el DOM, dispatch de renders por pestaña con `resumen`, re-render desde `subscribeGymData` y `renderAllWithUnit`, `escapeHtml` en todos los valores pintados; **iteración 1**: guard de series sin ejercicio (entrada sin id ni nombre excluida); **iteración 2**: `summarizeWorkouts()` sin sumatorios (totales entrenos/ejercicios distintos + `perGroup` por grupos musculares), tarjetas y desgloses nuevos, `syncSummaryPeriodUI()` oculta/muestra el recuadro del rango; **iteración 3**: estado `summaryRange`/`summaryRangeMonth` en el módulo, calendario propio (`summaryRangeDayGrid` 42 celdas lunes primero, `summaryWeekdayLabelsFn`, `summaryRangeMonthLabel`, `shiftSummaryRangeMonth`, `onSummaryRangeDayClick`, `renderSummaryRangeCalendar`, `open/closeSummaryRangePopover` con retorno de foco), `summarizeWorkouts()` agrega `pesoMin`/`pesoMax` (kg canónicos, excluye series null/≤0), tabla con columnas Peso mín/Peso máx/Aumento (conversión única al pintar), `resetGymData()` limpia el estado del rango; **iteración 4**: listener en captura que marca `__summaryRangeInside` (el click fuera no cierra el calendario tras el primer día — el re-render detachaba el botón pulsado y `closest()` fallaba —, solo Esc/«Listo»/click fuera real o las dos fechas), `summarizeWorkouts()` agrega `pesoAntiguo`/`pesoNuevo` cronológicos (lista desc: primer entreno fija el nuevo, los posteriores el antiguo; dentro del entreno primera/última serie con peso), tabla solo con columna «Diferencia» con signo (`+`/`−`) y conversión única al pintar |
| `js/router.js` | **Modificado**: `GYM_TAB_TO_PANEL` con `resumen` como primera clave, `GYM_DEFAULT_TAB = "resumen"`, canonización de `#/gimnasio` (normaliza `#/gimnasio/resumen` con `invalid: true`), `lastGymTab` arranca en `"resumen"` |
| `js/settings.js` | **Modificado**: `visibleTabs.resumen: true` en `DEFAULT_SETTINGS` y `resumen` como primera clave de `SECTION_REGISTRY.gimnasio.tabs` (ocultable desde Ajustes; `sanitizeVisibility` cubre a usuarios con ajustes antiguos) |
| `css/styles.css` | **Modificado**: estilos del resumen (`.gym-summary-selector`, chips `.gym-summary-chip`, `.gym-summary-grid`/`.gym-summary-card`, `.gym-summary-table` con `overflow-x: auto`, `.gym-summary-section-title`), `.tab--gym-summary` con acento `--games` y overrides agrupados de las cuatro familias; **iteración 1**: override de los inputs de fecha en Negro puro; **iteración 2**: estilos del recuadro único `.gym-summary-range` (summary sin marcador, campos en fila) y overrides de Negro puro del recuadro y sus textos; **iteración 3**: estilos del trigger y el calendario (`.gym-summary-range__trigger/__popover/__cal-*/__day` con estados `--today`/`--selected`/`--in-range`), flujo estático del popover en ≤767 px, overrides de Negro puro agrupados (superficies invertidas, selección con `--games-dark`, hover que conserva el extremo) y fixes de contraste AA en Oscuro (weekday con `--ink`, bordes con `--games`) |
| `tasks/task-issue-269.json` | **Nuevo**: task file de la issue #269 |
| `docs/manual-de-usuario.md` | **Modificado**: §3 y §9 con la tercera pestaña de Gimnasio; nueva subsección **§9.1 «Tu resumen»** (renumeradas 9.2, 9.3 y 9.4); §17 Ajustes con las tres pestañas; **iteración 2**: §9.1 con el recuadro del rango (oculto salvo «Rango»), tarjetas de entrenos/ejercicios y desgloses por grupos musculares y por ejercicio; **iteración 3**: §9.1 con el calendario único (primer click = desde, segundo = hasta, flechas de mes, Borrar/Listo, Esc/click fuera) y las columnas Peso mín/Peso máx/Aumento con «—» sin peso; **iteración 4**: §9.1 con el calendario que permanece abierto hasta elegir las dos fechas, y la tabla por ejercicio solo con la diferencia de peso con signo (+/−) entre el más antiguo y el más nuevo |
| `docs/adr-098-pestana-resumen-gimnasio.md` | **Nuevo**: este documento (iteraciones 2, 3 y 4 documentadas) |

Related issue: #269 — https://github.com/gonzalitojh/Registro-personal/issues/269
