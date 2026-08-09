# ADR-064: Modos Negro puro y Blanco puro (issue #43)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #43 pide **ampliar el sistema de temas** con dos modos de
visualización nuevos **sin eliminar los existentes**: un modo de
**negro puro** (fondo `#000000`, pensado para pantallas OLED: los píxeles
apagados consumen menos y el aspecto se ve más profundo) y su
**contrapartida de blanco puro** (fondo `#ffffff`).

Antes de esta decisión la aplicación tenía **dos temas** (ADR-009):
el oscuro por defecto (definido en `:root` de `css/styles.css`) y el
claro (`[data-theme="light"]`), con overrides puntuales por elemento
para los componentes que invierten la semántica de `--ink`/`--paper`.
La selección vivía únicamente en **Ajustes → Apariencia → Tema** (el
botón de alternancia de la cabecera se eliminó en la issue #75); la
preferencia se persiste en `localStorage` (clave `"mi-registro-theme"`)
y se sincroniza con `settings.theme` (`syncThemeToSettings`). Los modos
existentes pasan a llamarse **«Oscuro»** (dark) y **«Claro»** (light),
que ya era su etiqueta actual en el selector.

La implementación está **validada (QA PASS)** y **escaneada por
seguridad (PASS)** en esta rama (`feature/task-issue-43-modos-negro-y-blanco-puro`),
con un fix posterior del review de QA: hover visible del dropdown de
perfil en blanco puro (ver punto 3). El manual de usuario se actualizó
en la misma tarea (`docs/manual-de-usuario.md` §14, regla 3 de
AGENTS.md). Este ADR documenta la decisión a posteriori, como los
recientes (ADR-059, ADR-060, ADR-061, ADR-062, ADR-063).

Related issue: #43 — https://github.com/gonzalitojh/Registro-personal/issues/43

## Decisión

Añadir dos bloques de variables CSS nuevos, `[data-theme="black"]` y
`[data-theme="white"]`, sobre la arquitectura existente de ADR-009
(variables en `:root` + bloque `[data-theme="light"]` + overrides por
elemento), extendiendo los overrides de la familia clara al blanco puro
con selectores agrupados por comas. La decisión se organiza en nueve
puntos: los dos bloques de variables, los overrides, el selector de
Ajustes, el JS de aplicación, la defensa en `settings.js`, la
persistencia, el versionado PWA y la compatibilidad de Chart.js.

### 1. Bloque `[data-theme="black"]` (delta sobre `:root`, `css/styles.css`)

Bloque **delta**: solo redeclara lo que cambia respecto al modo oscuro:

- `--ink: #000000` (fondo general) y `--ink-raised: #0a0a0a`
  (superficies elevadas, casi negro).
- Los cinco tintes `--ink-alpha-*` (`06/08/10/15/20`) pasan a
  `rgba(0, 0, 0, X)` (tintes de hover/foco sobre superficies de papel).

**Todo lo demás hereda de `:root`**: `--paper` (`#f1ead9`, pergamino),
acentos (`--teal-reel`, `--ochre-spine`, `--stamp`), sombras,
`--date-picker-filter: invert(1)` (el date picker sigue siendo oscuro)
y los alfas de papel. Así el modo oscuro se conserva visualmente
íntegro con el fondo puramente negro. **No hacen falta overrides por
elemento**: los componentes que pintan `background: var(--ink)` (body,
cabecera, barra de pestañas, `auth-screen`, `profile-view`,
`settings-select`) se vuelven negros puros automáticamente.

### 2. Bloque `[data-theme="white"]` (familia clara llevada al extremo, `css/styles.css`)

- `--ink: #000000`, `--ink-raised: #ffffff`, `--ink-soft: #6b6355`
  (texto secundario), `--paper: #ffffff`, `--paper-dim: #ffffff`
  (fondo general blanco puro, aquí sí difiere del claro), `--paper-line:
  #d9cfc0` (bordes).
- `--ink-alpha-*`: `rgba(0, 0, 0, X)` (negro puro translúcido).
- `--paper-alpha-14/20/30/35/40`: `rgba(0, 0, 0, X)` (bordes oscuros
  sobre fondo blanco); **`--paper-alpha-10` y `--paper-alpha-92` se
  mantienen blancos** (`rgba(255, 255, 255, X)`): el 92% es el fondo
  translúcido de los sellos de las tarjetas, que debe seguir siendo
  claro.
- `--backdrop: rgba(0, 0, 0, 0.25)` y `--date-picker-filter: none`
  (igual que en claro).
- **Sombras algo más fuertes que en claro** (`--shadow-card:
  0 8px 24px rgba(0,0,0,0.12)` y `--shadow-pop: 0 16px 44px
  rgba(0,0,0,0.18)` frente a `0.08`/`0.12` del claro): en blanco puro
  las tarjetas blancas solo se separan del fondo por la sombra.

Los acentos semánticos (`--teal-reel`, `--ochre-spine`, `--stamp` y
sus variantes) no se redeclaran: son idénticos en `:root` y en claro, y
funcionan sobre cualquier fondo (misma filosofía que ADR-009).

### 3. Overrides por elemento extendidos al modo blanco

Los 19 overrides puntuales del modo claro se extienden a
`[data-theme="white"]` agregando el selector en los grupos de comas ya
existentes: `html`/`body`, `.auth-screen`, `.profile-view`, `.icon-btn`,
`.btn-link`, `.btn--outline-dark` (+ `:hover`), `.app-footer`,
`.profile-view__header select`, `.settings-select`,
`.stats-range-fields` (+ su `input[type="date"]`),
`.global-search__input`, `.activity-event__text`, foco del `.switch`,
`.app-header` y `.tabs--bar`. Dos particularidades:

- **`.app-footer`**: el blanco puro usa `rgba(0, 0, 0, 0.55)` mientras
  que el claro mantiene su `rgba(44, 40, 34, 0.55)` — por eso no se
  agrupa: necesita su propia regla.
- **`[data-theme="white"] .profile-dropdown__item:hover`** (nuevo):
  en blanco puro el dropdown es blanco y su hover usaba `--paper-dim`
  (`#ffffff`), que lo haría invisible; se usa `background:
  var(--ink-alpha-06)`. Fue el fix del review de QA.

En `ocio/ocio.css` se extienden los 2 overrides claros existentes
(`.sort-select` y `.item-card__perforation`) al blanco puro con el
mismo patrón de selectores agrupados.

### 4. Selector de tema en Ajustes (`index.html`)

`#settings-theme-select` pasa de 2 a 4 opciones:

| value | Etiqueta |
|-------|----------|
| `dark` | Oscuro |
| `black` | Negro puro |
| `light` | Claro |
| `white` | Blanco puro |

### 5. `setTheme()` y `getSavedTheme()` (`js/app.js`)

- **`THEME_META_COLORS`**: mapa `{ dark: "#171512", black: "#000000",
  light: "#f5f0e8", white: "#ffffff" }` que `setTheme()` usa para
  actualizar el `<meta name="theme-color">` (color real del fondo de
  cada modo); con `|| THEME_META_COLORS.dark` como guard contra
  valores desconocidos.
- **`getSavedTheme()`**: valida el valor de `localStorage` con
  `Object.prototype.hasOwnProperty.call(THEME_META_COLORS, saved)`;
  cualquier valor legacy o inválido cae a `"dark"`. El uso de
  `hasOwnProperty` llamada sobre `Object.prototype` hace la comprobación
  resistente a _prototype pollution_.

### 6. Defensa en `js/settings.js`

`VALID_THEMES = ["dark", "black", "light", "white"]` (whitelist):
`renderSettings()` solo asigna al select el tema guardado si está en la
lista; si no, cae a `"dark"`. Protege contra valores antiguos o
corruptos en `settings.theme`.

### 7. Persistencia (sin cambios)

La preferencia se sigue guardando en `localStorage` (clave
`"mi-registro-theme"`) y sincronizada con `settings.theme`
(`syncThemeToSettings`), como en ADR-009. No hay ningún campo nuevo en
el modelo de datos.

### 8. Versionado PWA

**Bump `20260836` → `20260837`**: la PR toca `css/styles.css`,
`ocio/ocio.css`, `index.html`, `js/app.js` y `js/settings.js`, todos
precacheados por el service worker (ADR-019), así que se aplica la
práctica de un bump por PR (ADR-049/059/061) vía
`scripts/bump-version.sh`: `js/config.js` (`APP_VERSION = '20260837'`),
`index.html` (`?v=` ×3: `styles.css`, `ocio.css`, `app.js`) y
`service-worker.js` (`?v=` ×6 en `STATIC_ASSETS`).

### 9. Chart.js (sin cambios)

`js/profile.js` ya lee los colores de los gráficos con
`getComputedStyle(...).getPropertyValue(...)` (ADR-009), por lo que se
adaptan a los 4 modos sin tocar una línea de JS.

### Contraste WCAG (verificado)

| Par | Ratio | Nivel |
|-----|-------|-------|
| `#f1ead9` (pergamino) sobre `#000` (negro puro) | 17.5:1 | AAA |
| `#948a76` (`--ink-soft` de negro puro) sobre `#000` | 6.16:1 | AA |
| `#000` sobre `#fff` (blanco puro) | 21:1 | AAA |
| `#6b6355` (`--ink-soft` de blanco puro) sobre `#fff` | 5.93:1 | AA |
| `rgba(0,0,0,0.55)` (footer blanco puro) sobre `#fff` | 4.74:1 | AA |

Los modos existentes no cambian su ratio: oscuro 15.2:1 y claro 12.9:1
(texto principal).

## Alternativas descartadas

- **Duplicar todas las reglas de override por modo** (un bloque
  `[data-theme="white"]` repetiendo el contenido de los de claro):
  descartado — duplicaría ~19 reglas sin necesidad. Se optó por
  **extender los selectores existentes con grupos de comas**
  (`[data-theme="light"] X, [data-theme="white"] X`), una única fuente
  de verdad para cada regla.
- **Usar la pseudo-clase funcional `:is()`** para agrupar los
  selectores (`:is([data-theme="light"], [data-theme="white"]) X`):
  descartado — funciona en navegadores modernos, pero se prefirió un
  grupo de selectores explícito para revisión de mínimo riesgo y máxima
  compatibilidad (GitHub Pages, sin paso de build).
- **Reutilizar los valores del modo claro para el blanco puro**
  (`--paper-dim: #f5f0e8` en vez de `#ffffff`, sombras del claro):
  descartado — el blanco puro exige su propio `--paper-dim` (blanco
  absoluto) y sombras más fuertes; las tarjetas blancas solo se separan
  del fondo por la sombra.
- **Hacer de `[data-theme="black"]` un bloque duplicado completo** de
  `:root` con los cambios: descartado — un **bloque delta** (solo
  `--ink`, `--ink-raised` y los `--ink-alpha-*`) minimiza la superficie
  de cambio y garantiza que negro puro siempre herede el resto de
  variables del modo oscuro (papel, acentos, sombras, filtro del date
  picker) aunque `:root` evolucione.
- **Añadir nombres/etiquetas nuevos para los modos existentes**:
  descartado — «Oscuro» y «Claro» ya eran las etiquetas del selector;
  la issue pide añadir modos sin eliminar ni renombrar los actuales.

## Consecuencias

### Positivas

- **Issue #43 resuelta**: cuatro modos seleccionables en Ajustes →
  Apariencia → Tema (Oscuro, Negro puro, Claro, Blanco puro), sin
  eliminar ninguno de los existentes (criterio de aceptación 1).
- **Ahorro de energía en OLED** con negro puro: los píxeles apagados
  consumen menos y el aspecto se ve más profundo.
- **Contraste WCAG AA/AAA en los dos modos nuevos** (17.5:1, 6.16:1,
  21:1, 5.93:1 y 4.74:1 — tabla arriba), manteniendo los ratios de los
  modos existentes.
- **Sin regresiones**: los bloques `:root` y `[data-theme="light"]` no
  se modifican (quedan byte-idénticos); todo lo nuevo está scoped bajo
  `[data-theme="black"]` y `[data-theme="white"]`.
- **Cero impacto de layout**: los bloques solo cambian colores; no hay
  medidas, posiciones ni unidades nuevas (criterio de responsividad de
  AGENTS.md / ADR-026), verificado en 360/768/1280 px.
- **Defensa en profundidad**: valores inválidos o legacy de
  `localStorage` y de `settings.theme` caen siempre al modo oscuro
  (`getSavedTheme` con `hasOwnProperty` — resistente a prototype
  pollution — y whitelist `VALID_THEMES`).
- **Persistencia intacta**: la preferencia se guarda y restaura como
  hasta ahora; Chart.js se adapta solo (getComputedStyle, ADR-009).
- **El modo negro puro es gratuito en mantenimiento**: al ser un delta,
  cualquier evolución de `:root` (papel, acentos, sombras) se aplica
  automáticamente.

### Negativas / Riesgos

- **Separación solo por sombra en blanco puro**: las tarjetas blancas
  sobre fondo blanco dependen de la sombra (y de algún borde) para
  distinguirse; si un diseño futuro suavizara las sombras, el modo
  perdería profundidad.
- **Perforación decorativa invisible en blanco puro**: la perforación
  tipo «entrada de cine» de las tarjetas (`item-card__perforation`)
  deja ver `--paper-dim`, que en blanco puro es blanco: el efecto
  decorativo no se aprecia (aceptado, es puramente estético).
- **~60 líneas extra de CSS** entre los dos bloques delta y los grupos
  de selectores añadidos; cada componente nuevo de la familia clara
  necesitará también su extensión a blanco.
- **Comentarios a mantener en sincronía**: los bloques documentan sus
  contrastes; si un color cambia, hay que actualizar el comentario y
  verificar el ratio.

### Neutras

- **Sin dependencias nuevas**: misma arquitectura de ADR-009 (CSS
  Custom Properties + `[data-theme]` en `<html>`); GitHub Pages sin
  paso de build.
- **Oscuro y negro puro comparten casi todas las variables**: el delta
  solo toca tinta y tintes; claro y blanco puro comparten la mayoría de
  la paleta (difieren en `--paper-dim`, sombras y alfas de tinta).
- **Bump PWA de rutina** `20260836` → `20260837`, un bump por PR
  (ADR-049/059/061), por tocar assets precacheados (ADR-019).
- **Manual de usuario al día** (§14 Ajustes → Apariencia → Tema: los
  cuatro modos y sus descripciones, la elección se guarda sola) —
  regla 3 de AGENTS.md.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | **Modificado**: bloque delta `[data-theme="black"]` (`--ink #000000`, `--ink-raised #0a0a0a`, tintes `--ink-alpha-*` en `rgba(0,0,0,X)`; el resto hereda de `:root`); bloque `[data-theme="white"]` (familia clara extrema: `--ink #000`, `--paper`/`--paper-dim`/`--ink-raised` `#fff`, `--ink-soft #6b6355`, alfas de papel oscuras salvo 10%/92%, `--backdrop rgba(0,0,0,0.25)`, `--date-picker-filter none`, sombras 0.12/0.18); todos los overrides por elemento de `[data-theme="light"]` extendidos a `[data-theme="white"]` con selectores agrupados; `.app-footer` blanco con `rgba(0,0,0,0.55)` (regla propia, no agrupada); nueva regla `[data-theme="white"] .profile-dropdown__item:hover` con `--ink-alpha-06` (fix QA) |
| `ocio/ocio.css` | **Modificado**: overrides `.sort-select` y `.item-card__perforation` extendidos a `[data-theme="white"]` con selectores agrupados |
| `index.html` | **Modificado**: `#settings-theme-select` con 4 opciones (`dark`/Oscuro, `black`/Negro puro, `light`/Claro, `white`/Blanco puro); bump `?v=20260836` → `?v=20260837` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `js/app.js` | **Modificado**: mapa `THEME_META_COLORS` (`dark #171512`, `black #000000`, `light #f5f0e8`, `white #ffffff`) usado por `setTheme()` para el `meta[name=theme-color]` (fallback a dark); `getSavedTheme()` normaliza valores inválidos/legacy a `"dark"` con `hasOwnProperty` (resistente a prototype pollution) |
| `js/settings.js` | **Modificado**: whitelist `VALID_THEMES = ["dark", "black", "light", "white"]`; `renderSettings()` cae a `"dark"` si el tema guardado no es válido |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260836` → `20260837` |
| `service-worker.js` | **Modificado**: bump `?v=20260836` → `?v=20260837` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modificado**: §14 Apariencia → Tema documenta los 4 modos (Oscuro, Negro puro con ahorro OLED, Claro, Blanco puro) y que la elección se guarda automáticamente — regla 3 de AGENTS.md |
| `tasks/task-issue-43.json` | **Modificado**: estado de la tarea (implementado → validado por QA → escaneado por seguridad) con bloque `pr` e issue #43 |
| `docs/adr-064-modos-negro-puro-y-blanco-puro.md` | **Nuevo**: este documento |

Related issue: #43 — https://github.com/gonzalitojh/Registro-personal/issues/43