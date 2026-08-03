# ADR-009: Modo claro (alternativa de tema claro/oscuro)

**Fecha:** 2026-07-29
**Estado:** Aceptado
**Última actualización:** 2026-08-03 (redefinición completa de la paleta del modo claro y overrides puntuales — ver sección «Actualización 2026-08-03»)

## Contexto

La aplicación "Mi Registro" se diseñó originalmente con un único tema oscuro
(por defecto), inspirado en una «mesa de lectura» o «cuaderno de biblioteca»
con fondo marrón oscuro (`--ink: #171512`) y texto en tono pergamino
(`--paper: #f1ead9`). Todos los colores estaban hardcodeados en CSS sin
ninguna capa de abstracción, y el CSS de `ocio/ocio.css` contenía valores
literales en hexadecimal repartidos por todo el archivo.

No existía:

- Ninguna forma de cambiar a un tema claro.
- Un sistema de variables CSS que permitiese definir colores una vez y
  reutilizarlos.
- Persistencia de la preferencia del usuario entre sesiones.
- Adaptación de los colores de Chart.js (perfil) al cambiar de tema.
- Actualización del `<meta name="theme-color">` para la barra de
  navegación del navegador.

### Problema detectado en la revisión QA (2026-08-03)

Tras la implementación inicial del sistema de temas, la revisión QA reveló que
el modo claro **apenas se diferenciaba del modo oscuro**:

- La variable `--ink` (usada por `html`/`body` como `background`) seguía siendo
  oscura (`#1e1b16` frente a `#171512` en modo oscuro), por lo que el fondo
  general de la aplicación permanecía prácticamente igual. Los elementos que
  usan `background: var(--ink)` (`.auth-screen`, `.profile-view`, etc.) seguían
  oscuros.
- La causa raíz es un **conflicto semántico** de las variables: el `body` usa
  `--ink` como fondo y `--paper` como texto, mientras que las tarjetas usan
  `--paper` como fondo y `--ink` como texto. Un único par de variables no puede
  servir correctamente a ambos modos con una simple redeclaración de valores:
  el modo claro exige una inversión explícita por elemento.

## Decisión

Implementar un **sistema de temas claro/oscuro** basado en **CSS Custom
Properties (variables CSS)** combinadas con un **atributo `[data-theme]`
en `<html>`**, controlado por JavaScript con persistencia en `localStorage`,
y **redefinir por completo la paleta del modo claro** con overrides puntuales
por elemento (ver «Actualización 2026-08-03»).

### Arquitectura del sistema de temas

1. **Definición de variables en `:root`** — Todas las variables de color
   se definen en `:root` con los valores del tema oscuro (por defecto).
   Esto incluye no solo los colores base (`--ink`, `--paper`, `--teal-reel`,
   etc.), sino también variantes con opacidad (`--ink-alpha-06`,
   `--paper-alpha-20`, etc.) y variables de estado (`--bg-state-en_curso`,
   `--bg-state-completado`, etc.). **Este bloque no se ha modificado** en la
   actualización de 2026-08-03.

2. **Override con `[data-theme="light"]`** — Un bloque `[data-theme="light"]`
   redeclara las mismas variables con valores adaptados al modo claro (ver
   paleta actualizada abajo).

3. **Variables de estado compartidas** — Los colores de estado
   (`--bg-state-en_curso`, `--bg-state-completado`, etc.) y los acentos
   (`--teal-reel`, `--ochre-spine`, `--stamp`, con sus variantes oscuras)
   son los mismos en ambos temas porque son colores semánticos que funcionan
   sobre cualquier fondo.

4. **JavaScript de control (`js/app.js`):**
   - `setTheme(theme)`: asigna `data-theme` al `<html>`, persiste en
     `localStorage`, actualiza el icono del botón (☀️/🌙), la etiqueta
     ARIA, y el `<meta name="theme-color">` (`#171512` oscuro /
     `#f5f0e8` claro).
   - `getSavedTheme()`: lee de `localStorage` con clave
     `"mi-registro-theme"`, devuelve `"dark"` por defecto si no hay
     preferencia guardada.
   - La preferencia se restaura **antes** de pintar cualquier contenido
     (`setTheme(getSavedTheme())` al inicio de `init()`).

5. **Botón de alternancia en la interfaz (`index.html`):**
   - Botón con `role="switch"`, `aria-checked`, `aria-label` dinámico.
   - El icono visual (`#theme-toggle-icon`) tiene `aria-hidden="true"`
     (la info semántica va en `aria-label`).
   - El evento click en `app.js` alterna entre `"dark"` y `"light"`.

6. **Chart.js adaptativo (`js/profile.js`):**
   - Los colores de los gráficos (actividad mensual y distribución por
     estados) se leen mediante
     `getComputedStyle(document.documentElement).getPropertyValue("--teal-reel")`,
     por lo que se actualizan automáticamente al cambiar de tema (tras
     recargar o al reconstruir el perfil).

7. **Refactorización de `ocio/ocio.css`:**
   - Todos los valores de color hardcodeados se sustituyeron por
     referencias a variables CSS (`var(--ink)`, `var(--paper)`,
     `var(--teal-reel)`, etc.), lo que hace que `ocio/ocio.css` sea
     compatible con ambos temas sin duplicar estilos. En la actualización
     de 2026-08-03 se añadió además un pequeño bloque de overrides
     `[data-theme="light"]` para los pocos componentes que no heredan
     correctamente las variables (ver abajo).

### Actualización 2026-08-03: redefinición de la paleta del modo claro

#### Paleta redefinida

El bloque `[data-theme="light"]` de `css/styles.css` fue reescrito por
completo con una paleta genuinamente clara (fondo crema, texto oscuro,
tarjetas blancas):

| Variable | Valor anterior (inválido) | Valor nuevo | Uso |
|----------|---------------------------|-------------|-----|
| `--ink` | `#1e1b16` | `#2c2822` | Texto principal (tinta oscura) |
| `--ink-raised` | `#f2ede6` | `#ffffff` | Superficies elevadas (blanco puro) |
| `--ink-soft` | `#6b6559` | `#6b6355` | Texto secundario / atenuado |
| `--paper` | `#faf6f0` | `#ffffff` | Tarjetas y superficies (blanco puro) |
| `--paper-dim` | `#f0e8dc` | `#f5f0e8` | Fondo general de la app (crema claro) |
| `--paper-line` | `#d4c9b8` | `#d9cfc0` | Líneas y bordes sobre crema |
| `--backdrop` | `rgba(0,0,0,0.35)` | `rgba(0,0,0,0.25)` | Sombras de modales/overlays |

#### Variables alpha invertidas

- **`--ink-alpha-*`** (`06/08/10/15/20`): basadas en `rgba(44, 40, 34, X)`
  (la nueva tinta), usadas como tintes de hover/foco sobre superficies claras.
- **`--paper-alpha-14/20/30/35/40`**: redefinidas como `rgba(44, 40, 34, X)`
  (tinta oscura translúcida) porque se usan como **bordes sobre fondo claro**.
- **`--paper-alpha-10`** y **`--paper-alpha-92`**: se mantienen basadas en
  blanco (`rgba(255, 255, 255, X)`) — el 92% es el fondo translúcido de los
  «sellos» de las tarjetas, que debe seguir siendo claro.

#### Sombras suavizadas

- `--shadow-card`: `0 8px 20px rgba(0, 0, 0, 0.08)`
- `--shadow-pop`: `0 16px 40px rgba(0, 0, 0, 0.12)`

#### Sección de overrides puntuales en `css/styles.css`

Se añadió una nueva sección de reglas `[data-theme="light"]` específicas por
elemento, con el comentario que documenta la razón de ser: los elementos que
usan `--ink` como fondo o `--paper` como color de texto necesitan inversión
explícita porque en modo claro el fondo general es claro y la tinta es oscura.

Elementos cubiertos:

- `html, body` — `background: var(--paper-dim)`; `color: var(--ink)`
- `.auth-screen` — fondo con degradados radiales suaves sobre `--paper-dim`
- `.profile-view` — `background: var(--paper-dim)`; `color: var(--ink)`
- `.icon-btn` — `color: var(--ink)`
- `.btn--ghost` / `.btn--ghost:hover` — tinta oscura, borde alpha oscuro
- `.btn-link` — `color: var(--ink)`
- `.btn--outline-dark` / hover — tinta oscura, borde alpha oscuro, hover con
  `--ink-alpha-10`
- `.app-footer` — `color: rgba(44, 40, 34, 0.55)`
- `.profile-view__header select` — `color: var(--ink)`
- `.settings-select` — fondo blanco, tinta oscura, borde `--paper-alpha-30`
- `.stats-range-fields` y sus `input[type="date"]` — fondo blanco, tinta
  oscura, borde `--paper-line`
- `.friend-detail__section h3` — `color: var(--ink)`
- `.global-search__panel` (fondo blanco + borde), `.global-search__input`,
  `.global-search__item-title`, `.global-search__friend-name`,
  `.global-search__close:hover`
- `.activity-event__text` — `color: var(--ink)`
- `.switch__input:focus-visible + .switch__slider` — outline teñido de tinta

#### Overrides en `ocio/ocio.css`

Se añadió un bloque `[data-theme="light"]` (22 líneas) al final de
`ocio/ocio.css`:

- `.sort-select` y `.library-search-input` — `color: var(--ink)` (usaban
  `--paper` como color de texto).
- `.item-card__perforation` — la perforación tipo «entrada de cine» ahora
  agujerea la tarjeta dejando ver `--paper-dim` (crema, el fondo real de la
  página en modo claro) en lugar de la tinta oscura.

#### Meta theme-color

`js/app.js`: el color del `<meta name="theme-color">` para el modo claro se
actualizó de `#faf6f0` (color antiguo de `--paper`) a `#f5f0e8` (el nuevo
`--paper-dim`, que es el color real del fondo en modo claro). El valor del
modo oscuro se mantiene en `#171512`.

### Alternativas descartadas

| Alternativa | Motivo del descarte |
|-------------|---------------------|
| **Preprocesador CSS (Sass/LESS)** | Añade una dependencia de build innecesaria; el proyecto es HTML+CSS+JS plano alojado en GitHub Pages sin paso de compilación. Las variables CSS nativas resuelven el problema. |
| **`prefers-color-scheme` (media query)** | No da control al usuario para cambiar de tema manualmente. Podría combinarse como valor por defecto, pero el proyecto prioriza la elección explícita del usuario. |
| **Tema vía JavaScript (inyección de estilos)** | Más complejo y menos accesible; las CSS variables son declarativas, más rápidas y funcionan con el DevTools del navegador. |
| **Dos hojas de estilo separadas** | Duplicación masiva de CSS; difícil de mantener. Con variables compartidas un solo conjunto de reglas funciona para ambos temas. |
| **Invertir las variables `--ink`/`--paper` por completo en modo claro** (cambio de rol semántico) | Se descartó en la actualización de 2026-08-03: rompería todos los componentes que asumen `--paper` como color de tarjeta clara y `--ink` como tinta. Se optó por mantener la semántica de las variables y añadir overrides explícitos solo donde hay inversión de rol (fondo vs. texto). |

## Consecuencias

### Positivas

- **El modo claro es ahora genuinamente claro**: fondo crema `#f5f0e8`,
  texto oscuro `#2c2822` y tarjetas blancas `#ffffff`. La diferencia visual
  con el modo oscuro es evidente.
- **Contraste WCAG AA/AAA**: texto principal `#2c2822` sobre fondo `#f5f0e8`
  ≈ 12.7:1 (supera con holgura WCAG AAA de 7:1); texto secundario `--ink-soft`
  `#6b6355` ≈ 5:1 (supera WCAG AA de 4.5:1). Sobre tarjetas blancas el
  contraste es aún mayor (≈14.6:1 y ≈5.9:1 respectivamente).
- **Modo oscuro sin regresiones**: el bloque `:root` no se modificó; los
  overrides añadidos están todos scoped bajo `[data-theme="light"]`, por lo
  que el modo oscuro (por defecto) se comporta exactamente igual que antes.
- Los bordes, hovers y focos en modo claro usan tinta translúcida, legibles
  sobre el fondo crema.
- El `<meta name="theme-color">` coincide con el color real del fondo en cada
  modo (nativo en navegadores móviles).
- Se mantienen las ventajas del sistema original: persistencia de preferencia
  en `localStorage`, Chart.js adaptativo, botón de alternancia accesible
  (`role="switch"`, `aria-checked`, `aria-label` dinámicos) y `ocio/ocio.css`
  compatible con ambos temas.

### Negativas

- El modo claro añade ~100 líneas de CSS de overrides puntuales
  (`[data-theme="light"]` + selectores) repartidas entre `css/styles.css` y
  `ocio/ocio.css`. Cada componente nuevo que use `--ink` como fondo o
  `--paper` como texto necesitará un override adicional.
- El conflicto semántico de `--ink`/`--paper` (fondo vs. tinta según el
  elemento) permanece latente en la arquitectura: los overrides son la forma
  de resolverlo, pero hay que mantenerlos al añadir componentes.
- La lógica JS añade ~30 líneas y un event listener.
- `localStorage` es síncrono y puede no estar disponible en contextos
  de terceros (no aplica en GitHub Pages, pero es una limitación conocida).
- Los gráficos de Chart.js no se repintan automáticamente al cambiar de
  tema en caliente — requieren recargar la vista de perfil o
  reconstruir los charts.

### Neutras

- El número total de variables CSS es de ~45 (compartidas entre ambos temas,
  redefiniendo solo las que cambian).
- El proyecto no incorpora ninguna dependencia nueva.
- `--teal-reel`, `--ochre-spine`, `--stamp` y sus variantes oscuras y alpha
  son idénticas en ambos temas (colores semánticos compartidos).

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | Añadido bloque `:root` con variables de modo oscuro (sin cambios posteriores); bloque `[data-theme="light"]` **completamente reescrito** (2026-08-03) con la nueva paleta, alpha invertidas y sombras suavizadas; añadida sección de overrides `[data-theme="light"]` por elemento (html/body, auth-screen, profile-view, botones, selects, inputs, buscador global, feed de actividad, switch); variable `--date-picker-filter`; estilos `.theme-toggle`. |
| `ocio/ocio.css` | Sustituidos valores de color hardcodeados por variables CSS; añadido bloque `[data-theme="light"]` (2026-08-03) para `.sort-select`, `.library-search-input` y `.item-card__perforation`. |
| `index.html` | Añadido botón `#btn-theme-toggle` con icono y atributos ARIA en el header de la app. |
| `js/app.js` | Añadidas funciones `setTheme()`, `getSavedTheme()`, constante `STORAGE_KEY_THEME`, y event listener para el toggle; meta theme-color del modo claro actualizado a `#f5f0e8` (2026-08-03). |
| `js/profile.js` | Modificados colores de Chart.js para leer de `getComputedStyle` en lugar de valores fijos. |

## Estructura de datos persistida

```json
// localStorage clave "mi-registro-theme"
"dark"    // por defecto
"light"   // si el usuario activó el modo claro
```
