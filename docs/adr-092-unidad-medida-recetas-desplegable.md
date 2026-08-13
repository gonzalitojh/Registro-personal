# ADR-092: Unidad de medida de los ingredientes de receta como desplegable (issue #251)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #251 pide que al **crear o editar una receta** la unidad de
medida de los ingredientes sea un **desplegable** con las opciones
**g, Kg, mL, L y Unidades**.

Estado previo: en `ingredienteRowHtml` (js/recipes.js, ~línea 1593) la
unidad era un `<input type="text" class="ing-unidad">` de **texto
libre** con placeholder «Unidad», así que cada receta podía guardar
cualquier texto (g, gr, gramos, cucharada…), lo que dificultaba la
comparación con la cantidad de paquete y la agregación por
«nombre|unidad» (ADR-086).

Patrón previo existente en la app:

- `SHOPPING_UNITS = ["g", "Kg", "mL", "L", "Unidades"]` en
  js/recipes-data.js (línea 121), la misma lista que ya usa el ítem
  extra `#extra-unidad` y el modal de añadir a la compra
  `#ing-shopping-unidad` (issue #249, ADR-091).
- `PACKAGE_UNITS` (js/recipes.js, línea 901) con su **primera opción
  vacía «—»** para «sin especificar» (issue #224, ADR-085).

Nota del flujo (misma excepción que ADR-083, ADR-085, ADR-087,
ADR-088, ADR-089, ADR-090 y ADR-091): la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde
ahí y la PR va **también a `content/issue-64-seccion-recetas`, no a
`dev`**. El ADR se numera **092** (el número 090 quedó usado por dos
ADR de la issue #242, el 091 por la #249).

## Decisión

1. **Nuevo helper `unidadOptionsHtml(unidad)`** en js/recipes.js
   (junto a `ingredienteRowHtml`): genera un
   `<select class="ing-unidad" aria-label="Unidad de medida">` con la
   **primera opción vacía «—»** (selected explícito cuando la fila no
   tiene unidad, patrón `PACKAGE_UNITS` — evita que el navegador
   preseleccione «g» en filas nuevas) seguida de las **5 opciones de
   `SHOPPING_UNITS`** (g, Kg, mL, L, Unidades). La coincidencia con la
   unidad guardada se compara **normalizando ambos lados con
   `normalizeUnit`**, así «kg» guardado coincide con la opción «Kg» de
   la lista.
2. **Datos legados**: si la unidad guardada no coincide con ninguna
   estándar (p. ej. «cucharada», de cuando el campo era texto libre),
   se añade como **opción extra al final, seleccionada**, con `value` y
   `label` escapados con `escapeHtml` (es dato de usuario); el dato se
   conserva tal cual al editar y guardar. El `selected` cae
   **exactamente en una opción** en todos los casos (vacía, estándar o
   legada), nunca en dos.
3. **Lectura/persistencia sin cambios**: `readRecipeFromForm` sigue
   leyendo `.ing-unidad` y normalizando con `normalizeUnit` (el
   `.value` de un select se lee igual que el de un input); los datos
   nuevos quedan siempre en el conjunto normalizado (g, kg, ml, l,
   unidades), mejorando la consistencia con la comparación de paquetes
   y la agregación por «nombre|unidad» (ADR-086).
4. **CSS (css/styles.css)**: `select` se añade a los selectores
   agrupados de la píldora base de `.recipe-form__ingrediente`
   (`--paper-dim`/`--ink` con `min-width: 0`), al grupo de **overrides
   de familia clara** (`[data-theme="light"]`/`[data-theme="white"]`,
   patrón agrupado, una sola fuente de verdad) y al **override de negro
   puro** (`[data-theme="black"]`). Además, la regla propia
   `.recipe-form__ingrediente select { width: 100% }` para que el
   `min-content` del select (la opción más ancha, p. ej. una unidad
   legada larga) no desborde su celda del grid
   `1.4fr 0.7fr 0.9fr auto` (y las dos columnas ≤560 px): sin scroll
   horizontal en 360 / 768 / 1280 px (AGENTS.md §2).
5. **Manual de usuario §8.1**: «A cada ingrediente le pones la
   **cantidad** y eliges su **unidad de medida** en un desplegable con
   las opciones **g, Kg, mL, L y Unidades** (puedes dejarla sin
   elegir)».
6. **PWA**: bump `20260924 → 20260925` en js/config.js
   (`APP_VERSION`), index.html (`?v=` ×3: styles.css, ocio.css,
   app.js) y service-worker.js (`STATIC_ASSETS`, las 7 entradas
   versionadas con `?v=`).

## Consecuencias

- **Positivas**: la unidad de medida pasa a ser una selección cerrada
  con las cinco unidades que pidió el usuario; los datos nuevos quedan
  siempre en el conjunto normalizado (g, kg, ml, l, unidades), de modo
  que la comparación de paquetes (ADR-086) y la agregación por
  «nombre|unidad» (ADR-086, issue #225) quedan más consistentes; la
  experiencia es la misma que la del ítem extra y el modal de añadir a
  la compra (ADR-091), con la lista compartida `SHOPPING_UNITS`.
- **Neutras**: las unidades legadas (texto libre de recetas antiguas)
  se siguen viendo y conservan tal cual al editar, como opción extra
  del desplegable; la unidad vacía («—») sigue permitida igual que
  antes; en móvil los selects nativos usan el popup del sistema —
  comportamiento ya preexistente en la app (ítem extra y modal de
  compra, ADR-091). Los CSS reutilizan el patrón de selectores
  agrupados existente, añadiendo `select` a las reglas base, claras y
  negro puro.
- **Negativas**: ninguna conocida. Validado: sintaxis JS, criterios de
  aceptación, responsividad 360 / 768 / 1280 px sin scroll horizontal
  (AGENTS.md §2), cuatro modos de tema con contraste AA heredado de los
  inputs hermanos (AGENTS.md §4) y escaneo de seguridad sin hallazgos —
  toda interpolación de dato de usuario pasa por `escapeHtml` (incluida
  la opción extra legada).

Related issue: #251