# ADR-009: Modo claro (alternativa de tema claro/oscuro)

**Fecha:** 2026-07-29
**Estado:** Aceptado

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

## Decisión

Implementar un **sistema de temas claro/oscuro** basado en **CSS Custom
Properties (variables CSS)** combinadas con un **atributo `[data-theme]`
en `<html>`**, controlado por JavaScript con persistencia en `localStorage`.

### Arquitectura del sistema de temas

1. **Definición de variables en `:root`** — Todas las variables de color
   se definen en `:root` con los valores del tema oscuro (por defecto).
   Esto incluye no solo los colores base (`--ink`, `--paper`, `--teal-reel`,
   etc.), sino también variantes con opacidad (`--ink-alpha-06`,
   `--paper-alpha-20`, etc.) y variables de estado (`--bg-state-en_curso`,
   `--bg-state-completado`, etc.).

2. **Override con `[data-theme="light"]`** — Un bloque `[data-theme="light"]`
   redeclara las mismas variables con valores adaptados al modo claro:
   - `--ink`: de `#171512` a `#1e1b16` (texto oscuro sobre fondo claro)
   - `--ink-raised`: de `#211e19` a `#f2ede6` (superficies elevadas se
     aclaran)
   - `--paper`: de `#f1ead9` a `#faf6f0` (fondo más claro y cálido)
   - `--ink-soft`: de `#948a76` a `#6b6559` (texto secundario)
   - `--backdrop`: de `rgba(10,9,7,0.65)` a `rgba(0,0,0,0.35)` (sombras
     más suaves)
   - `--date-picker-filter`: de `invert(1)` a `none` (icono de calendario
     visible sobre fondo claro)
   - `--shadow-card` y `--shadow-pop`: sombras más sutiles en modo claro

3. **Variables de estado compartidas** — Los colores de estado
   (`--bg-state-en_curso`, `--bg-state-completado`, etc.) son los mismos
   en ambos temas porque son colores semánticos que funcionan sobre
   cualquier fondo.

4. **JavaScript de control (`js/app.js`):**
   - `setTheme(theme)`: asigna `data-theme` al `<html>`, persiste en
     `localStorage`, actualiza el icono del botón (☀️/🌙), la etiqueta
     ARIA, y el `<meta name="theme-color">` (`#171512` oscuro /
     `#faf6f0` claro).
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
     automáticamente compatible con ambos temas sin duplicar estilos.

### Alternativas descartadas

| Alternativa | Motivo del descarte |
|-------------|---------------------|
| **Preprocesador CSS (Sass/LESS)** | Añade una dependencia de build innecesaria; el proyecto es HTML+CSS+JS plano alojado en GitHub Pages sin paso de compilación. Las variables CSS nativas resuelven el problema. |
| **`prefers-color-scheme` (media query)** | No da control al usuario para cambiar de tema manualmente. Podría combinarse como valor por defecto, pero el proyecto prioriza la elección explícita del usuario. |
| **Tema vía JavaScript (inyección de estilos)** | Más complejo y menos accesible; las CSS variables son declarativas, más rápidas y funcionan con el DevTools del navegador. |
| **Dos hojas de estilo separadas** | Duplicación masiva de CSS; difícil de mantener. Con variables compartidas un solo conjunto de reglas funciona para ambos temas. |

## Consecuencias

### Positivas

- **Toda la interfaz** (incluyendo `ocio/ocio.css`) se adapta al tema
  activo sin duplicar reglas CSS, gracias a las variables compartidas.
- La preferencia del usuario persiste entre sesiones vía `localStorage`.
- Chart.js obtiene colores coherentes con el tema activo automáticamente.
- El `<meta name="theme-color">` se actualiza, dando una experiencia
  nativa en navegadores móviles.
- El botón de alternancia es accesible: `role="switch"`, `aria-checked`
  y `aria-label` dinámicos.
- El sistema es declarativo y fácil de extender (añadir una nueva variable
  es suficiente para que ambos temas la soporten).

### Negativas

- Se añaden ~50 líneas de variables en `[data-theme="light"]` (~30
  variables redeclaradas).
- La lógica JS añade ~30 líneas y un event listener.
- `localStorage` es síncrono y puede no estar disponible en contextos
  de terceros (no aplica en GitHub Pages, pero es una limitación conocida).
- Los gráficos de Chart.js no se repintan automáticamente al cambiar de
  tema en caliente — requieren recargar la vista de perfil o
  reconstruir los charts.

### Neutras

- El número total de variables CSS crece de 0 a ~45 (compartidas entre
  ambos temas, redefiniendo solo las que cambian).
- El proyecto no incorpora ninguna dependencia nueva.

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `css/styles.css` | Añadido bloque `:root` con variables de modo oscuro y bloque `[data-theme="light"]` con override parcial; añadida variable `--date-picker-filter`; añadidos estilos `.theme-toggle`. |
| `ocio/ocio.css` | Sustituidos todos los valores de color hardcodeados por referencias a variables CSS (`var(--...)`). |
| `index.html` | Añadido botón `#btn-theme-toggle` con icono y atributos ARIA en el header de la app. |
| `js/app.js` | Añadidas funciones `setTheme()`, `getSavedTheme()`, constante `STORAGE_KEY_THEME`, y event listener para el toggle. |
| `js/profile.js` | Modificados colores de Chart.js para leer de `getComputedStyle` en lugar de valores fijos. |

## Estructura de datos persistida

```json
// localStorage clave "mi-registro-theme"
"dark"    // por defecto
"light"   // si el usuario activó el modo claro
```
