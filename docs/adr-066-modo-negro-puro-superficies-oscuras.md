# ADR-066: Modo Negro puro con superficies oscuras (issue #165)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

El modo **«Negro puro»** añadido en ADR-064 (issue #43) solo oscurecía
el **fondo**: el bloque `[data-theme="black"]` redeclaraba únicamente
`--ink: #000000`, `--ink-raised: #0a0a0a` y los cinco tintes
`--ink-alpha-*` como negros translúcidos. Todas las **superficies**
(tarjetas, paneles laterales, dropdowns, modales, ajustes, búsqueda
global, notificaciones, fichas de ocio, filas de lista) seguían
pintadas con `--paper` (`#f1ead9`, pergamino), porque heredaban de
`:root`: en negro puro el fondo era negro pero las superficies seguían
siendo claras, rompiendo la coherencia visual del modo.

La issue #165 pide que en negro puro **todas las superficies queden
oscuras** (negras / near-black), con su texto legible, y además añadir
a AGENTS.md una **regla permanente** que obligue a verificar los
cuatro modos de tema en cualquier elemento nuevo.

La implementación está **validada (QA PASS)** en los 7 criterios de
aceptación y **escaneada por seguridad (PASS, 0 HIGH**; las claves
client-side encontradas son preexistentes en `main`, no nuevas), en la
rama `style/issue-165-modos-visualizacion` con los commits `8fb619d`
(feat), `f79bc42` (fix estados de filas) y `091df30` (fix contraste AA
en hovers con acento y barras gráficas). El manual de usuario se
actualizó en la misma tarea (`docs/manual-de-usuario.md` §14, regla 3
de AGENTS.md). Este ADR documenta la decisión **a posteriori**, como
los recientes (ADR-059 a ADR-065), **extendiendo ADR-064 y ADR-009**.

Related issue: #165 — https://github.com/gonzalitojh/Registro-personal/issues/165

## Decisión

Extender el bloque `[data-theme="black"]` con **variables delta
adicionales** para oscurecer todas las superficies, más una **sección
de overrides por selector agrupado** que sigue el mismo patrón de
selectores agrupados (una sola fuente de verdad por regla) que usan
las familias `[data-theme="light"]`/`[data-theme="white"]` (ADR-064).
La decisión se organiza en seis puntos: las variables delta, los
overrides agrupados, los sellos con hex fijo, la rotación de
variables, el contraste verificado y la nueva regla 4 de AGENTS.md.

### 1. Bloque `[data-theme="black"]` ampliado (delta, `css/styles.css` y `ocio/ocio.css`)

El bloque delta pasa de redeclarar solo la tinta a redeclarar también
las superficies:

- `--paper-dim: #111111` (superficies secundarias).
- `--white: #0f0f0f` (entradas de formulario).
- `--paper-line: rgba(241, 234, 217, 0.28)` (bordes sobre superficies
  oscuras).
- Los cinco tintes `--ink-alpha-*` **se revierten a tintes claros**
  `rgba(241, 234, 217, X)` (en vez de negros): en negro puro actúan
  sobre superficies oscuras, así que el hover/foco se pinta con
  pergamino translúcido.
- Los cuatro estados `--bg-state-*` pasan a oscuros: `#12372f`
  (en_curso), `#33291a` (completado), `#26241e` (standby) y `#3d1f18`
  (abandonado).
- Acentos claros para su uso sobre fondo oscuro: `--teal-reel-dark:
  #4f9c8e`, `--ochre-spine-dark: #c99a4e`, `--stamp-dark: #cf6655`
  (texto/gráficos con tinta negra encima).

**Todo lo demás sigue heredando de `:root`** (como en ADR-064): el
papel base `--paper` se conserva y pasa a ser el **texto** del modo
(ver punto 4).

### 2. Sección de overrides por selector agrupado para negro puro

Se añade una sección de overrides per-elemento scoped bajo
`[data-theme="black"]` con el **mismo patrón de selectores agrupados**
que las familias `[data-theme="light"]`/`[data-theme="white"]`
(ADR-064): una sola fuente de verdad por regla, agrupando selectores
por comas. Cubre todos los componentes con superficie de papel:
tarjetas, paneles laterales, dropdowns, modales, ajustes, búsqueda
global, notificaciones, fichas de ocio (`ocio/ocio.css`) y filas de
lista, incluidos los estados `en_curso`/`completado`/`standby`/
`abandonado` y `unreleased` (fix `f79bc42`), que pasan a usar las
superficies y estados oscuros del punto 1.

### 3. Sellos de tarjetas con hex originales (sin variables)

Los sellos de las tarjetas (`item-card__stamp--*`) **conservan sus
hex originales** (`#7e2c22`, `#1c4a41`, `#8f6522`) en lugar de usar
variables: representan la **realidad física del sello estampado** en
la tarjeta y deben verse **idénticos en los 4 modos**. Cada regla
lleva un comentario que explica por qué no usa variable, siguiendo la
regla 4 de AGENTS.md (punto 6).

### 4. Rotación de variables

En negro puro la rotación de variables gira igual que en oscuro:
`--ink` es **fondo** y `--paper` es **texto**. Los overrides
per-elemento invierten selector/semántica donde hace falta (p. ej.
textos que en `:root` son `--ink` pasan a `--paper` en el override,
y superficies que eran `--paper` pasan a `--ink`/`--ink-raised`/
`--paper-dim`).

### 5. Contraste WCAG AA (verificado)

Ratio mínimo AA: 4.5:1 para texto normal y 3:1 para gráficos. Valores
verificados:

| Par | Ratio | Uso |
|-----|-------|-----|
| `#f1ead9` (papel) sobre `#0a0a0a` (ink-raised) | 16.51:1 | texto sobre superficies elevadas |
| `#000` (tinta) sobre `#4f9c8e` (teal-reel-dark) | 6.48:1 | textos con acento claro |
| `#000` sobre `#c99a4e` (ochre-spine-dark) | 8.22:1 | textos con acento claro |
| `#f1ead9` sobre `#a63b2e` (stamp) | 5.33:1 | `.btn--danger` (base y `:hover`) |
| Estados `#12372f`/`#33291a`/`#26241e`/`#3d1f18` con papel | ≈ 10-12:1 | fondo de estados con texto pergamino |
| Sellos `#7e2c22`/`#1c4a41`/`#8f6522` sobre sello claro | 3.75-7.21:1 | decorativo (sello físico de tarjeta) |

Gráficos (3:1): tabs activos con inset 3 px (6.11/5.36/7.75:1) y
checkbox de episodio (6.11:1). **Hovers de botones con acento**
resuelven **fondo de acento claro con tinta negra** (6.48:1 y 8.22:1,
ver punto 5 de la iteración QA). No aplica: `.btn--danger:hover`
mantiene fondo `--stamp` base con texto papel.

### 6. Regla 4 nueva de AGENTS.md

Se añade a AGENTS.md la regla permanente **«Visualización correcta
en todos los modos de tema»**: todo elemento nuevo debe verificarse
en los **cuatro modos**, con contraste mínimo WCAG AA (4.5:1 texto,
3:1 gráficos); los overrides deben seguir el **patrón de selectores
agrupados** con una sola fuente de verdad por regla; los colores
hardcodeados deben llevar un **comentario justificativo** de por qué
no usan variable.

### Iteración QA (fixes en `091df30`)

El qa-reviewer detectó dos problemas de contraste en la primera
versión, corregidos en `091df30`:

1. **Hovers con acentos claros como fondo y texto papel** → ratio
   insuficiente (2.1-2.7:1). Corregido: **tinta negra sobre acento
   claro** (6.48:1 / 8.22:1).
2. **`.btn--danger:hover`** con `--stamp-dark` sobre `--stamp` →
   1.73:1. Corregido: el hover de danger **se queda sin override**
   (mantiene `--stamp` base con texto papel, 5.33:1).

QA final: **PASS en los 7 criterios de aceptación** de la issue #165.
Escaneo de seguridad: **PASS** (0 HIGH; las claves client-side
detectadas son preexistentes en `main`, no introducidas en esta rama).

## Alternativas descartadas

- **Margarita de variables por modo** (reescribir en negro puro todas
  las variables de `:root` y todos los overrides de la familia oscura
  modo a modo, sin compartir): descartado — duplicaría decenas de
  reglas y crearía dos fuentes de verdad. Se optó por el **bloque
  delta ampliado** + overrides con **selectores agrupados** (mismo
  patrón que ADR-064): una sola fuente de verdad por regla y herencia
  automática del resto de `:root` (papel, acentos, sombras, filtro del
  date picker) aunque evolucione.
- **Introducir variables nuevas para los sellos de las tarjetas**
  (p. ej. `--stamp-*` en cada modo): descartado — los sellos
  representan la realidad física del sello estampado en la tarjeta y
  deben verse idénticos en los 4 modos; se conservan los hex
  originales con comentario justificativo (regla 4 de AGENTS.md).
- **Aplicar los overrides de negro puro duplicando los bloques de la
  familia oscura** en lugar de agrupar selectores: descartado —
  rompería la única fuente de verdad por regla que ya estableció
  ADR-064 para las familias clara/blanca.
- **Mantener los `--ink-alpha-*` como tintes negros** y resolver los
  hovers oscuros con otro mecanismo: descartado — sobre superficies
  oscuras un tinte negro es invisible; la reversión a tintes claros de
  pergamino es la que da hovers legibles en negro puro.
- **Dejar las superficies claras en negro puro** (limitarse al fondo,
  como ADR-064): descartado — es exactamente lo que la issue #165
  pide corregir: el modo debe ser coherente, con fondo Y superficies
  oscuras.

## Consecuencias

### Positivas

- **Issue #165 resuelta**: en negro puro todas las superficies (tarjetas,
  paneles laterales, dropdowns, modales, ajustes, búsqueda global,
  notificaciones, fichas de ocio, filas de lista) quedan oscuras, con
  su texto legible (criterios de aceptación 1-7, QA PASS).
- **Regla permanente en AGENTS.md** (regla 4): cualquier elemento
  nuevo deberá verificarse en los 4 modos con mínimo WCAG AA; evita
  regresiones futuras como la de esta issue.
- **Contraste WCAG AA verificado** en texto (16.51:1, 6.48:1, 8.22:1,
  5.33:1, ≈10-12:1 en estados) y gráficos (3:1 superado: 6.11:1 del
  checkbox de episodio y 5.36-7.75:1 de las tabs activas), incluidos
  los hovers.
- **Patrón de selectores agrupados consolidado**: negro puro usa la
  misma técnica de una sola fuente de verdad por regla que claro y
  blanco puro (ADR-064), con una sección de overrides propia y
  comentada.
- **Sellos físicos intactos**: las tarjetas se ven idénticas en los 4
  modos; cada hex hardcodeado lleva su comentario justificativo.
- **Sin regresiones** en oscuro/claro/blanco puro: diff de estilos
  computados = 0 cambios en los otros tres modos; verificado también
  sin scroll horizontal a 360/768/1280 px (regla 2 de AGENTS.md).
- **Seguridad PASS**: 0 HIGH; sin claves nuevas introducidas.

### Negativas / Riesgos

- **Mayor superficie de CSS**: el bloque delta ampliado y la sección
  de overrides agrupados añaden ~100 líneas entre `css/styles.css` y
  `ocio/ocio.css`; cada componente nuevo con superficie de papel
  necesitará su extensión a negro puro (mitigado por la regla 4 de
  AGENTS.md).
- **Doble papel de los `--ink-alpha-*`**: en la familia oscura son
  tintes claros (sobre superficies oscuras) y en la clara son tintes
  negros; un uso nuevo de estos tintes exige comprobar el par
  fondo/texto de cada familia.
- **Comentarios a mantener en sincronía**: los bloques documentan sus
  contrastes; si un color cambia, hay que actualizar el comentario y
  verificar el ratio (misma deuda asumida en ADR-064).
- **Acentos claros `*-dark` solo válidos con tinta negra encima**:
  usarlos como fondo con texto papel produce 2.1-2.7:1 (el fallo que
  corrigió el QA); el patrón correcto queda documentado en el CSS.

### Neutras

- **Sin dependencias nuevas**: misma arquitectura CSS Custom
  Properties + `[data-theme]` de ADR-009/ADR-064; GitHub Pages sin
  paso de build.
- **`--paper` conserva su papel de texto** en negro puro: la rotación
  ink/papel es la misma que en oscuro, solo que ahora las superficies
  se redeclaran.
- **Bump PWA `20260837` → `20260838`** (ADR-019): un bump por PR
  (ADR-049/059/061/064), vía `scripts/bump-version.sh`, por tocar
  assets precacheados (`css/styles.css`, `ocio/ocio.css`,
  `index.html`, `js/config.js`, `service-worker.js`).
- **Manual de usuario al día**: §14 Apariencia → Tema documenta que
  el modo Negro puro ahora oscurece fondo **y** superficies — regla 3
  de AGENTS.md.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | **Modificado**: bloque delta `[data-theme="black"]` ampliado (`--paper-dim #111111`, `--white #0f0f0f`, `--paper-line rgba(241,234,217,0.28)`, `--ink-alpha-*` revertidos a tintes claros `rgba(241,234,217,X)`, `--bg-state-*` oscuros `#12372f`/`#33291a`/`#26241e`/`#3d1f18`, acentos claros `--teal-reel-dark #4f9c8e`, `--ochre-spine-dark #c99a4e`, `--stamp-dark #cf6655`); nueva sección de overrides por selector agrupado `[data-theme="black"]` (mismo patrón de selectores agrupados que light/white); sellos `item-card__stamp--*` conservan sus hex originales (`#7e2c22`/`#1c4a41`/`#8f6522`) con comentario justificativo en cada regla |
| `ocio/ocio.css` | **Modificado**: bloque delta y overrides agrupados `[data-theme="black"]` para fichas de ocio (mismo patrón que `css/styles.css`) |
| `AGENTS.md` | **Modificado**: nueva regla 4 «Visualización correcta en todos los modos de tema» (verificar los 4 modos, mínimo WCAG AA 4.5:1/3:1, patrón de selectores agrupados con una sola fuente de verdad, colores hardcodeados con comentario justificativo) |
| `docs/manual-de-usuario.md` | **Modificado**: §14 Apariencia → Tema: el modo Negro puro ahora oscurece fondo **y** superficies (no solo el fondo) — regla 3 de AGENTS.md |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260837` → `20260838` |
| `index.html` | **Modificado**: bump `?v=20260837` → `?v=20260838` (×3: `styles.css`, `ocio.css`, `app.js`) vía `scripts/bump-version.sh` |
| `service-worker.js` | **Modificado**: bump `?v=20260837` → `?v=20260838` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `tasks/task-issue-165.json` | **Modificado**: estado de la tarea (implementado → validado por QA PASS en los 7 criterios → escaneado por seguridad PASS) con bloque `pr` e issue #165 |
| `docs/adr-066-modo-negro-puro-superficies-oscuras.md` | **Nuevo**: este documento |

Related issue: #165 — https://github.com/gonzalitojh/Registro-personal/issues/165