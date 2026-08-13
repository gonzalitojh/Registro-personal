# ADR-096: Icono de la sección Gimnasio: mancuerna horizontal clásica (issue #263)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #263 pide un **nuevo icono para la sección Gimnasio**: el
actual no convence al usuario. Es un cambio puramente cosmético de la
issue de la sección (#62, ADR-095) y se ciñe al **aspecto del icono**
en los únicos dos sitios donde aparece: la entrada **«Gimnasio»** de
la barra lateral (`js/sidebar.js`, array `SECTIONS`) y la pestaña
**«Entrenos»** de la barra de pestañas del `gym-view` (`index.html`).

El icono sustituido era la **mancuerna diagonal de Feather** (7
`<path>`: la barra diagonal `M6.5 6.5 17.5 17.5`, los dos ganchos
`M21 17 17 21` / `M3 7 7 3`, los dos trazos de los discos
`m2.5 12.5 9-9` / `m12.5 2.5 9 9` y los dos puntos `M6 21h.01` /
`M18 3h.01`). Con los trazos sueltos y la diagonal, resultaba difícil
de leer a tamaño de icono pequeño y rompía la coherencia con el resto
de secciones.

Encaje con las reglas del proyecto:

- **Convención de iconos** (ADR-009, ADR-064, ADR-066 y manual de
  estilo de las secciones existentes): `viewBox 0 0 24 24`,
  `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"`,
  `stroke-linecap/linejoin="round"` y `aria-hidden="true"`. El icono
  hereda el color del contenedor (`.icon-btn` en la cabecera,
  `.tab` en la barra de pestañas), así que **no necesita overrides
  por modo de tema** (regla 4 de AGENTS.md): correcto en Oscuro,
  Negro puro, Claro y Blanco puro sin tocar `css/styles.css`.
- **Regla 3 de AGENTS.md (manual de usuario)**: el manual no describe
  la forma del icono de la sección; un cambio cosmético de este tipo
  no requiere actualización.
- **Ramificación**: la tarea nace de `feat/issue-62-seccion-gimnasio`
  (el ADR-095 y la sección aún no están en `dev`; PR #262 pendiente de
  integración). La rama de la #263 se fusionará en esa rama
  intermedia, de modo que este ADR llegará a `dev` junto con la
  sección completa. Por eso el número de serie continúa tras ADR-095
  aunque la sección no esté publicada.

La implementación está validada (QA PASS: simetría verificada por
rasterización — 0.00 % de píxeles distintos entre las mitades, sin
restos del path antiguo `M6.5 6.5 17.5 17.5`, comprobados los cuatro
modos de tema y sin impacto de layout/responsividad) y escaneada
(seguridad PASS, 0 hallazgos). Este ADR documenta la decisión a
posteriori, como los recientes (ADR-093, ADR-094, ADR-095).

Related issue: #263 — https://github.com/gonzalitojh/Registro-personal/issues/263

## Decisión

### 1. Nueva forma: mancuerna horizontal clásica

Sustituir el SVG diagonal de Feather por una **mancuerna horizontal
clásica** — barra + cuatro discos simétricos — con un único shape por
elemento (`<line>` + 4 `<rect>`, frente a los 7 `<path>` anteriores,
tres de ellos solo decorativos):

- **Barra**: `<line x1="8" y1="12" x2="16" y2="12" />` — centrada en
  el viewBox (x=8→16, y=12).
- **Discos exteriores** (los más alejados del centro):
  `<rect x="2.5" y="9" width="3" height="6" rx="1" />` y su espejo
  `<rect x="18.5" y="9" width="3" height="6" rx="1" />`
  (18.5 = 24 − 2.5 − 3).
- **Discos interiores** (pegados al centro):
  `<rect x="6.5" y="7.5" width="2" height="9" rx="0.7" />` y su espejo
  `<rect x="15.5" y="7.5" width="2" height="9" rx="0.7" />`
  (15.5 = 24 − 6.5 − 2).

**Simetría verificada**:

- **Vertical (eje x = 12)**: cada rect tiene su espejo a la misma
  distancia: exteriores 2.5↔18.5 (centros x=4 y x=20, a 8 px del
  centro), interiores 6.5↔15.5 (centros x=7.5 y x=16.5, a 4.5 px del
  centro); la barra 8→16 está centrada en 12.
- **Horizontal (eje y = 12)**: todos los elementos están centrados en
  y=12 — la barra en y=12; los exteriores en y=9 con h=6
  (centro 12); los interiores en y=7.5 con h=9 (centro 12).

Los `rx` redondean las esquinas de los discos (1 px los exteriores,
0.7 px los interiores) para mantener el estilo redondeado del resto de
iconos del proyecto.

### 2. Sustitución en los dos únicos puntos de uso

1. `js/sidebar.js` — entrada «Gimnasio» del array `SECTIONS`
   (propiedad `icon`): se reemplaza el contenido del `<svg>`; el
   contenedor y el `onClick` no cambian.
2. `index.html` — pestaña «Entrenos» de la barra del `gym-view`
   (`nav.tabs--bar`, `data-gym-tab="entrenos"`): se reemplaza el
   contenido del `<svg>`; nada más del markup cambia.

La pestaña **«Ejercicios» no se toca**: mantiene su icono de check
(`<polyline points="9 11 12 14 22 4">` + `<path>` del marco), que ya
cumple la convención y no era objeto de la issue.

### 3. Fuera de alcance deliberado

- **`css/styles.css`**: sin cambios — `currentColor` ya hereda el
  color correcto en los cuatro modos de tema (sin overrides nuevos).
- **`docs/manual-de-usuario.md`**: sin cambios (regla 3 de AGENTS.md;
  el manual no describe la forma del icono).
- **ADR-095**: sigue vigente; este ADR solo documenta el aspecto del
  icono de la sección.

## Alternativas descartadas

- **Mantener el icono actual**: descartado — es la propia petición de
  la issue #263; la mancuerna diagonal con trazos sueltos se lee mal a
  tamaño pequeño.
- **Usar la mancuerna diagonal pero rediseñada (más paths gruesos)**:
  descartado — la forma diagonal se cruza con los límites del viewBox
  (los ganchos salen por las esquinas) y seguiría necesitando elementos
  decorativos; la horizontal clásica es más legible y más simple
  (5 shapes frente a 7 paths).
- **Añadir overrides de tema o colores propios del icono**:
  descartado — el icono usa `currentColor` exactamente como el resto
  de secciones; cualquier color hardcodeado habría requerido overrides
  por familia de tema (regla 4 de AGENTS.md) sin beneficio visual.
- **Añadir el icono a `css/styles.css` vía máscara/fuente**:
  descartado — rompería la convención de SVGs inline `currentColor`
  del proyecto y añadiría CSS innecesario sin cambiar el resultado.

## Consecuencias

### Positivas

- **Icono legible y coherente** con el estilo del resto de secciones
  (películas, series, libros, ocio): trazo 1.8, esquinas redondeadas,
  formas cerradas y simétricas a tamaño pequeño (~1.15–1.5 rem).
- **Simetría garantizada y verificada**: QA PASS por rasterización
  (0.00 % de píxeles distintos entre las dos mitades), sin restos del
  path antiguo en los dos archivos.
- **Cero cambios de tema**: `currentColor` + `stroke-width` heredados
  → correcto en Oscuro, Negro puro, Claro y Blanco puro (ADR-009,
  ADR-064, ADR-066) sin una sola línea de CSS.
- **Menos DOM**: 5 shapes frente a 7 paths en los dos puntos de uso.

### Neutras

- **La sección Gimnasio aún no está en `dev`**: el icono (y este ADR)
  viven en la cadena de ramas `feat/issue-62-seccion-gimnasio` →
  `style/issue-263-icono-seccion`; llegarán a `dev` cuando se integre
  la PR #262 con la sección completa. El número ADR-096 ya queda
  reservado en esa línea.
- **La pestaña «Ejercicios» sigue con su icono de check**: deliberado,
  la issue solo afecta al icono de la sección.
- **Manual de usuario sin cambios**: el manual no describe la forma
  del icono (regla 3 de AGENTS.md).
- **Sin impacto de layout ni responsividad**: el SVG ocupa el mismo
  espacio que el anterior (los archivos `js/sidebar.js` e `index.html`
  solo cambian el contenido del `<svg>`).

### Negativas / Riesgos

- **Ninguna conocida.** Validado: QA PASS (simetría por
  rasterización, cuatro modos de tema, sin scroll horizontal en
  360/768/1280 px — el icono no altera el layout) y seguridad PASS
  (0 hallazgos HIGH/MEDIUM/LOW; SVG 100 % estático, sin interpolación
  de datos ni handlers).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/sidebar.js` | **Modificado**: icono de la entrada «Gimnasio» de `SECTIONS` — mancuerna diagonal de Feather (7 paths) → mancuerna horizontal clásica (line + 4 rects simétricos) |
| `index.html` | **Modificado**: SVG de la pestaña «Entrenos» del `gym-view` — mismo reemplazo; la pestaña «Ejercicios» (check) no se toca |
| `tasks/task-issue-263.json` | Task file de la tarea (title/description con la base `feat/issue-62-seccion-gimnasio`, criterios de aceptación AC1–AC4, DoD y bloque `issue` con la #263 — https://github.com/gonzalitojh/Registro-personal/issues/263) |
| `docs/adr-096-icono-seccion-gimnasio.md` | **Nuevo**: este documento |

Related issue: #263 — https://github.com/gonzalitojh/Registro-personal/issues/263