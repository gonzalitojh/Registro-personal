# ADR-095: Sección de Gimnasio (issue #62)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #62 pide una **nueva sección de gimnasio** con su propio
endpoint `/gimnasio`, incluida en la barra lateral de navegación
(igual que Ocio y Recetas), para **registrar entrenos**, **registrar
los pesos y repeticiones** de cada ejercicio y **registrar
ejercicios**. Pide además poder **cambiar el peso entre lbs y kg en
todo momento**, investigar si existe alguna API de ejercicios de la
que extraer información, y documentar con detalle cualquier idea útil
adicional. Deben respetarse las convenciones del resto de secciones
(barra superior, pestañas ocultables en Ajustes, responsividad y
cuatro modos de tema).

Precedentes que fijan el patrón de esta sección:

- **Recetas** (issue #64, ADR-076/ADR-078/ADR-087): vista de primer
  nivel **hermana de `profile-view` y fuera de `#app`**, con su
  propia `nav.tabs--bar` (misma clase que la de Ocio) y sin botón de
  volver ni título (issue #206, ADR-077): la navegación vive en la
  cabecera global.
- **Ocultación de secciones y pestañas** (issue #97, ADR-067):
  `SECTION_REGISTRY` en `js/settings.js` es el registro central que
  alimenta los ajustes de visibilidad.
- **Router de hash** (ADR-051) con memorias por sección
  (`lastOcioKey`, `lastRecipesTab`) y de la última sección de primer
  nivel (`lastSection`, issue #213), que usa la flecha de volver del
  perfil.
- **Auto-ocultado de cabecera/pestañas** (ADR-060, ADR-094): una sola
  fuente de verdad en `js/auto-hide-nav.js` con selectores genéricos
  sobre `body` y resolución del panel activo por vista.
- **Unidad de medida desplegable en Recetas** (issue #251, ADR-092):
  precedente de selector de unidad con las mismas reglas de
  conversión y presentación.

La implementación está validada (QA PASS: 2 rondas — la primera
detectó H1 de contraste en negro puro, el nombre snapshot al editar y
el refresco del constructor; todo corregido en el commit
`67b2136`) y escaneada (seguridad PASS, 0 hallazgos HIGH); el manual
de usuario se actualiza en esta misma tarea (regla 3 de AGENTS.md).
Este ADR documenta la decisión a posteriori, como los recientes
(ADR-093, ADR-094).

Related issue: #62 — https://github.com/gonzalitojh/Registro-personal/issues/62

## Decisión

### 1. Sección de primer nivel «Gimnasio», hermana de Recetas

- **Vista propia `#gym-view`** fuera de `#app` (mismo patrón que
  `#recipes-view`): cuando está visible, `#app` queda oculta; no hay
  botón de volver ni título, la navegación vive en la cabecera
  global (issue #206).
- **Barra de pestañas propia estilo Ocio** (`nav.tabs--bar` con la
  misma clase común de ADR-078): **«Entrenos»** (pestaña por defecto,
  acento **teal**) y **«Ejercicios»** (acento **ocre**). Ambas
  ocultables desde Ajustes vía `SECTION_REGISTRY` (issue #97).
- **Entrada «Gimnasio» en la barra lateral** (`js/sidebar.js`) con su
  icono, que abre la sección volviendo a la última pestaña de la
  sesión (`getLastGymTab()`).
- **Router extendido** (`js/router.js`): ruta `#/gimnasio`
  (Entrenos) y `#/gimnasio/ejercicios`; `GYM_TAB_TO_PANEL`,
  `gymHashFor()`, `lastGymTab` y `lastSection = "gimnasio"` (la
  flecha de volver del perfil regresa también a Gimnasio). El wiring
  de pestañas queda acotado a `.tab[data-panel]` en `app.js` y las de
  Gimnasio usan `data-gym-tab` exclusivo (evita la colisión con Ocio
  y Recetas).

### 2. Modelo de datos en Firestore

- **`users/{uid}/gym-workouts/{id}`** (entrenos):
  `fechaISO` (string `YYYY-MM-DD`, orden desc), `nombre?`, `nota?`,
  `ejercicios: [{ ejercicioId|null, nombre (snapshot), series:
  [{pesoKg, reps}] }]`, `addedAt`/`updatedAt` (serverTimestamp).
  El **nombre es snapshot**: si un ejercicio se borra del catálogo,
  los entrenos que lo usan conservan su nombre.
- **`users/{uid}/gym-exercises/{id}`** (catálogo de ejercicios):
  `nombre` (orden asc), `grupoMuscular?` (presets), `notas?`,
  `addedAt`/`updatedAt`.
- **Peso canónico SIEMPRE en kg** (`pesoKg`): la unidad de
  presentación nunca se guarda en los documentos.
- **`firestore.rules`**: mismo patrón estándar que el resto de
  colecciones — lectura para cualquier usuario autorizado
  (`isAllowedUser()`, registros entre amigos), escritura solo del
  dueño (`isOwner`).

### 3. Unidad de peso (kg/lbs) solo de presentación

- Preferencia **`settings.unidadPeso`** (`"kg"` | `"lbs"`) en
  localStorage, con **sync a Firestore** (preferencias del perfil,
  mismo debounce que el resto de ajustes) para que se sincronice
  entre dispositivos.
- Conversión **1 kg = 2.20462 lbs** (`KG_PER_LB`); display con **1
  decimal** y entrada → kg con **2 decimales**. Los valores guardados
  **nunca cambian** al alternar: la conversión ocurre solo en los
  renders (listas, detalle del entreno, formularios y placeholders de
  los inputs de peso).
- **Select `#gym-unit-select`** en `.gym-units`, visible en toda la
  sección (bajo la barra de pestañas). Al cambiar: re-render de la
  pestaña activa y del modal de entreno abierto (lectura o edición,
  desde el borrador en memoria, que siempre está en kg).

### 4. Investigación de APIs de ejercicios y catálogo v1

Hallazgos **reales** de la investigación del plan:

- **wger API v2** — gratuita, sin key para lectura, CORS abierto,
  ~845 ejercicios multilingües (incluye español), open source AGPL
  auto-hostable. **Candidata nº 1 para una iteración futura**.
- **ExerciseDB** (RapidAPI) — requiere key y proxy CORS: **descartada
  en v1**.
- **API Ninjas Exercises** — requiere key: **descartada**.
- **exercise-api** estática de marcmayol.com — JSON estático bilingüe
  ES/EN, sin key, CORS `*`, ~104 ejercicios: **interesante para un
  seed offline** en el futuro.

**Decisión v1**: **catálogo manual propio** (offline-first, sin
dependencias ni rate limits, coherente con el catálogo de
ingredientes y las etiquetas propias de Recetas), con la integración
futura **documentada**: búsqueda en wger con prefill del formulario y
fallback al catálogo propio.

### 5. Alcance v1 (fuera de scope, documentado)

- **Búsqueda global en Gimnasio**: fuera de scope; el guard
  obligatorio de `js/global-search.js` devuelve vacío en la sección
  (no cae a la rama de Ocio ni mezcla colecciones ajenas) y el
  placeholder dice «Buscar en tu gimnasio...».
- **Export/backup sin Gimnasio**: coherente con el resto de la
  familia de registro propio (Recetas tampoco se incluye);
  documentado como mejora futura (ampliar la copia de seguridad).
- **Sin dependencias nuevas** (ni librerías ni APIs).

### 6. Decisiones autónomas (sesión headless)

- Acentos: **Entrenos = teal**, **Ejercicios = ocre** (reutiliza las
  variables de tema existentes, sin colores hardcodeados fuera de los
  sellos documentados).
- Etiqueta «Entrenos» para la pestaña de entrenamientos.
- Grupos musculares: **select con presets** (Pecho, Espalda,
  Hombros, Bíceps, Tríceps, Antebrazos, Piernas, Glúteos, Core,
  Cardio, Cuerpo completo) + **«Otro»** (texto libre).
- **`confirm()` nativo** para los borrados de entrenos y ejercicios
  (coherente con la simplicidad de la sección).
- **Sync de la unidad a Firestore** (preferencias del perfil).
- **Manual de usuario renumerado**: capítulo 9 insertado con
  renumeración del resto (precedente: Recetas se insertó como cap. 8).

### 7. Ideas futuras documentadas

Volumen total por entreno, récords personales/1RM, historial por
ejercicio con gráfica, resumen semanal, plantillas de rutinas,
búsqueda/filtro por grupo muscular, integración wger (búsqueda con
prefill del formulario y fallback al catálogo propio), ampliar la
copia de seguridad a toda la familia de registro propio, temporizador
de descanso y recordatorios de entreno.

## Alternativas descartadas

- **Integrar una API de ejercicios en v1**: descartado — todas las
  opciones investigadas (ExerciseDB, API Ninjas) requieren key y/o
  proxy CORS; wger es la mejor candidata pero añadiría dependencia y
  latencia de red para un catálogo que el usuario va a personalizar.
  El catálogo manual es offline-first, sin rate limits y coherente
  con ingredientes/etiquetas. La integración queda documentada como
  iteración futura (ADR-065 y ADR-074 marcan el precedente de
  «estudio → ADR de decisión»).
- **Guardar el peso en la unidad elegida en cada momento**:
  descartado — rompería el histórico si se alterna la unidad; el kg
  canónico con conversión solo de presentación es el estándar.
- **Select de unidad solo en el formulario de entreno**: descartado —
  la issue pide cambiar «en todo momento»; el select de sección
  (visible siempre) con re-render global lo garantiza.
- **Vista dentro de `#app`** (como una pestaña más de Ocio):
  descartado — la issue pide una sección de primer nivel hermana de
  Ocio/Recetas, con su propia barra de pestañas.
- **Búsqueda global en Gimnasio en v1**: descartado — sin scope de
  búsqueda definido; el guard en `global-search.js` evita caer a la
  rama de Ocio (riesgo clave del wiring).

## Consecuencias

### Positivas

- **Consistencia total con el patrón de secciones**: cabecera global,
  barra de pestañas estilo Ocio (ADR-078), ocultable en Ajustes
  (ADR-067), auto-ocultado por scroll (ADR-060/ADR-094 con
  `.gym-toolbar` en `CONTROLS_SELECTOR`), router de hash con memorias
  (ADR-051), rutas directas compartibles (`#/gimnasio`,
  `#/gimnasio/ejercicios`).
- **Datos robustos**: peso canónico en kg (la unidad es solo
  presentación), nombre snapshot en los entrenos (sobrevive al
  borrado del catálogo), sincronización en tiempo real con reintento
  con backoff (patrón issue #147).
- **Offline-first**: el catálogo manual funciona sin red ni
  dependencias externas.
- **Manual al día** (regla 3 de AGENTS.md): capítulo 9 «Gimnasio»
  insertado y resto de capítulos renumerados.

### Neutras

- **La búsqueda de la cabecera no encuentra nada en Gimnasio en v1**
  (guard en `global-search.js`; placeholder «Buscar en tu gimnasio...»);
  el manual lo indica de forma honesta.
- **El backup no incluye Gimnasio** (ni Recetas): mejora futura
  documentada.
- **ADR-092 queda como precedente complementario** (unidad de medida
  en Recetas); este ADR extiende el concepto al peso de gimnasio.

### Negativas / Riesgos

- **Ninguna conocida.** Validado: QA PASS (2 rondas; AC1–AC9
  cumplidos) y seguridad PASS (0 hallazgos HIGH; 3 LOW informativos
  de patrones preexistentes). Verificados los cuatro modos de tema
  (ADR-009/ADR-064/ADR-066) y la responsividad (360/768/1280 px sin
  scroll horizontal). El wiring de `.tab` acotado a `.tab[data-panel]`
  evita la colisión con Ocio/Recetas; `applyTabVisibility` solo añade
  `hidden` (nunca lo quita) y `gymApi` se crea antes de
  `initRouter` (sin TDZ).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: vista `#gym-view` (barra de pestañas `data-gym-tab`, selector `.gym-units #gym-unit-select`, paneles Entrenos/Ejercicios con sus toolbars), modales `#gym-workout-modal` y `#gym-exercise-modal`; title/description actualizados |
| `js/gym.js` | **Nuevo**: módulo de la sección (pestañas Entrenos/Ejercicios, tarjetas con resumen «N ejercicios · M series», modal de entreno lectura/alta/edición con constructor de ejercicios y series, modal de ejercicio, conversión kg/lbs con re-render global) |
| `js/router.js` | **Modificado**: `GYM_TAB_TO_PANEL`, `GYM_DEFAULT_TAB`, `GYM_PREFIX`, `gymHashFor()`, `getLastGymTab()`, `lastSection = "gimnasio"`, ruta `#/gimnasio` en `parseHash`/`canonicalHashFor` |
| `js/settings.js` | **Modificado**: `unidadPeso` en settings por defecto, `SECTION_REGISTRY.gimnasio` (tabs entrenos/ejercicios), `getUnit()`/`setUnit()` con sync a Firestore |
| `js/sidebar.js` | **Modificado**: entrada «Gimnasio» con icono y vuelta a la última pestaña |
| `js/app.js` | **Modificado**: wiring de `setupGym`/`subscribeGymData`/`resetGymData`, rama `route.section === "gimnasio"` en el router con normalización de pestaña oculta, `.tab[data-panel]` acotado a Ocio |
| `js/db.js` | **Modificado**: `subscribeToGymWorkouts`, `addGymWorkout`, `updateGymWorkout`, `deleteGymWorkout`, `subscribeToGymExercises`, `addGymExercise`, `updateGymExercise`, `deleteGymExercise` |
| `js/ui.js` | **Modificado**: placeholder y aria-label de búsqueda para la sección gimnasio («Buscar en tu gimnasio...») |
| `js/global-search.js` | **Modificado**: guard de la sección gimnasio (sin resultados v1) y hint de búsqueda propio |
| `js/auto-hide-nav.js` | **Modificado**: `activePanel()` resuelve `#gym-view .gym-view__body section:not(.hidden)`; `.gym-toolbar` en `CONTROLS_SELECTOR`; `MutationObserver` vigila `#gym-view` y sus paneles |
| `service-worker.js` | **Modificado**: `js/gym.js` añadido a `STATIC_ASSETS` (precaché) |
| `css/styles.css` | **Modificado**: estilos de la sección (tarjetas, catálogo, constructor, modales, `.gym-units`) con overrides agrupados para las cuatro familias de tema (light/white y black) |
| `firestore.rules` | **Modificado**: `match /gym-workouts/{itemId}` y `match /gym-exercises/{itemId}` con el patrón estándar (read `isAllowedUser`, write `isAllowedUser && isOwner`) |
| `docs/manual-de-usuario.md` | **Modificado**: capítulo 9 «Gimnasio» insertado y renumeración de capítulos (§3, §3.2, §9-§20 → §10-§21, §16 Ajustes con la nueva sección) |
| `docs/adr-095-seccion-gimnasio.md` | **Nuevo**: este documento |

Related issue: #62 — https://github.com/gonzalitojh/Registro-personal/issues/62
