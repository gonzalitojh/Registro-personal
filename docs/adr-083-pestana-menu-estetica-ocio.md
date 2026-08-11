# ADR-083: Estética tipo Ocio de la pestaña de Menú — botones píldora y controles coherentes (issue #220)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #220 pide mejorar la estética de la pestaña **«Menú»** de la
sección de Recetas (issue #64): sus botones tenían una estética
**completamente diferente** al resto de la web (sección Ocio y pestañas
de Recetas/Ingredientes). El objetivo es que sigan el mismo lenguaje
visual: botones **píldora** estilo `.sort-select` /
`.ingredients-filter__btn` de Ocio, `.btn--primary` para las acciones
principales, `danger` coherente para las destructivas y selects
consistentes.

Estado previo (construido en ADR-076/ADR-081, issues #214/#215): la
barra de herramientas del menú usaba `btn--small` para la navegación de
semanas (`menu-prev-week`/`menu-next-week`), «Borrar semana»
(`menu-delete-week`) y «+ Añadir receta a la semana»
(`btn-add-weekly-recipe`); los selects de `.menu-meal__picker` y
`.menu-weekly__addrow` eran nativos sin estilizar y el input de
comensales no seguía ningún patrón de la web.

Nota del flujo: la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde ahí
y la PR va **también a esa rama, no a `dev`** — excepción puntual a la
regla de PRs contra `dev` de AGENTS.md §1, pedida explícitamente por el
usuario en la issue.

Decisiones clave del rediseño:

1. **Clase píldora nueva `.btn--pill`**: reutiliza las métricas exactas
   de `.sort-select` / `.ingredients-filter__btn` de Ocio (fondo
   `--ink-raised`, texto `--paper`, borde 1px `--paper-alpha-30`, radio
   999px, padding 0.3rem 0.75rem, font-size 1rem, hover
   `--paper-alpha-10`). Se declara **antes** de `.btn--danger` para que
   la combinación `.btn--pill.btn--danger` conserve el color de peligro
   (`--stamp`) y su hover: la píldora aporta radio/padding y el danger
   fondo/borde/color.
2. **Jerarquía de acciones**: navegación de semana (←/→) y «Borrar
   semana» pasan a píldora; la destructiva se combina con
   `.btn--danger`; «+ Añadir receta a la semana» pasa a
   `.btn--primary btn--small` por ser la acción principal.
3. **Controles de la pestaña uniformados**: `.menu-week-label`
   (font-size 0.95rem + color `--ink-soft`), `.menu-comensales input`
   (píldora: radio 999px, borde `--paper-alpha-30`, padding, font-size
   1rem, text-align center, + `:focus-visible` con outline
   `--teal-reel`), `.menu-meal__add` (radio 999px, borde
   `--paper-alpha-30`, hover `--paper-alpha-10`) y los selects de
   `.menu-meal__picker` y `.menu-weekly__addrow` (fondo
   `--ink-raised`, píldora, + `:focus-visible`).
4. **Cuatro temas**: overrides **agrupados** de la familia clara
   (`[data-theme="light"/"white"] .btn--pill:not(.btn--danger)` → color
   `--ink` y hover `--ink-alpha-10`; `.menu-meal__add:hover` →
   `--ink-alpha-10`), siguiendo el patrón de selectores agrupados de
   AGENTS.md §4. El **negro puro no necesita override**: queda
   documentado con comentario en el CSS (—`--ink-raised` es #0a0a0a,
   fondo casi negro, con texto `--paper` claro, borde
   `--paper-alpha-30` y hover `--paper-alpha-10`—, y la píldora de
   borrar usa `--stamp-dark`).
5. **Botón dinámico coherente**: el botón recreado en JS
   (`renderWeeklyRecipes` de `js/menu.js`) pasa a `btn--primary
   btn--small`, igual que su homólogo estático, para que el flujo «+ Añadir
   receta a la semana» nunca quede visualmente distinto.

## Decisión

1. **CSS** (`css/styles.css`): nueva clase `.btn--pill` (con su hover),
   declarada **antes** de `.btn--danger` y con comentario explicando el
   orden de cascada para `.btn--pill.btn--danger`. Se actualizan
   `.menu-week-label`, `.menu-comensales input` (+`:focus-visible`),
   `.menu-meal__add` (+hover), `.menu-meal__picker select` y
   `.menu-weekly__addrow select` (+`:focus-visible`), y se añaden los
   overrides agrupados de la familia clara
   (`[data-theme="light"]`+`[data-theme="white"]`) para `.btn--pill` y
   `.menu-meal__add`, junto al comentario que documenta por qué el modo
   negro puro no necesita override.
2. **HTML** (`index.html`): `menu-prev-week` y `menu-next-week` pasan de
   `btn--small` a `btn--pill`; `menu-delete-week` pasa a
   `btn--pill btn--danger`; `btn-add-weekly-recipe` pasa a
   `btn--primary btn--small`.
3. **JS** (`js/menu.js`): el botón dinámico que reconstruye
   `renderWeeklyRecipes` (cuando el picker consumió el estático) pasa a
   `btn--primary btn--small`, coherente con el estático.
4. **PWA**: bump de versión `20260911 → 20260912` en `index.html`
   (`?v=`), `js/config.js` (`APP_VERSION`) y `service-worker.js`
   (`STATIC_ASSETS`).
5. **Manual de usuario**: sin cambios — la sección 8.3 describe solo
   funcionalidad (navegar semanas, comensales, borrar, añadir recetas),
   no estética; el cambio es puramente visual de botones y no altera
   nada visible a nivel de comportamiento.
6. **PR contra `content/issue-64-seccion-recetas`**: excepción puntual y
   explícita a la regla de AGENTS.md §1 (PRs siempre contra `dev`),
   solicitada por el usuario en la issue #220; la rama de trabajo
   `wip/issue-220` se creó a partir de esa base.

## Consecuencias

- **Positivas**: la pestaña «Menú» queda a la altura visual de Ocio y
  de las pestañas Recetas/Ingredientes; la jerarquía de acciones es
  legible (píldoras para navegación, danger para la destructiva,
  primary para la acción principal); la clase `.btn--pill` queda
  reutilizable para futuros controles; el botón dinámico y el estático
  nunca divergen visualmente.
- **Neutras**: bump de versión PWA (invalida la caché de `20260911`
  para propagar el nuevo CSS); el botón dinámico vuelve a
  `btn--primary btn--small` cuando `renderWeeklyRecipes` lo
  reconstruye, pero el usuario no percibe cambio de comportamiento; el
  modo negro puro no recibe override propio porque los valores base de
  la píldora ya son correctos sobre fondo negro (decisión documentada
  en el CSS).
- **Negativas**: ninguna conocida. La funcionalidad queda intacta
  (navegar semanas, comensales, borrar semana, «+ Receta» por comida,
  recetas a la semana, quitar/eliminar). QA PASS: lenguaje visual
  coherente, cuatro modos de tema con contraste WCAG AA (calculado por
  tema) y responsividad en 360 / 768 / 1280 px sin scroll horizontal a
  nivel de página (el scroll interno del grid del menú sigue permitido).
  Seguridad PASS: sin hallazgos (las claves Firebase/TMDB/GB son
  preexistentes y públicas por diseño).

Related issue: #220
