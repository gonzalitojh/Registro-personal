# ADR-088: Ventana de recetas en modo lectura — vista de texto diferenciada de la edición (issue #236)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #236 pide que la ventana en **modo lectura** de las recetas
no sea «el formulario con los campos deshabilitados» (como quedó en la
decisión 2 de ADR-087), sino una **vista de texto legible**,
visualmente distinta de la de edición:

1. **La foto primero** y, justo debajo, **el nombre** con las etiquetas
   de alérgenos y tipo de plato, la descripción y las porciones.
2. Bajo ello, los **ingredientes en forma de lista**, sin opción de
   eliminar ni la categoría: solo **nombre y cantidad**.
3. Debajo, las **instrucciones**, también en forma de lista (numerada)
   y sin opción de eliminar.
4. Al final, los **enlaces de referencia**, si los hay.
5. Las etiquetas de **alérgenos y de tipo de plato deben diferenciarse
   por color** para no confundirse entre ellas.
6. La vista de lectura **no debe verse como recuadros sin opción a
   editar, sino como texto**: no se muestran los nombres de los campos
   (Nombre, Descripción, Porciones...); el **nombre de la receta
   aparece como título** y los ingredientes y las instrucciones llevan
   su propio **encabezado de título**.

Estado previo: ADR-087 (issue #234) implementó el modo lectura
reutilizando `recipeModalHtml` con todos los campos `disabled` (misma
estructura de formulario, solo que bloqueada); los botones «Editar» y
«Eliminar»; y el cierre por ✕ siempre con backdrop/Escape solo en
lectura. Esa ventana funcionaba, pero visualmente era indistinguible de
un formulario inaccesible.

Nota del flujo (misma excepción que ADR-083, ADR-085 y ADR-087): la
base de trabajo es la rama `content/issue-64-seccion-recetas`; la rama
de trabajo se crea desde ahí y la PR va **también a esa rama, no a
`dev`**. El ADR se numera **088**.

## Decisión

1. **Render propio de lectura**: `recipeModalHtml` (js/recipes.js)
   bifurca al inicio con `if (modalReadOnly && recipe) return
   recipeReadOnlyHtml(recipe)`. La nueva función privada
   `recipeReadOnlyHtml` genera una vista **sin `<form>`**, sin inputs,
   selects ni textareas, y **sin nombres de campo**. El resto de
   `recipeModalHtml` (alta y edición) no se toca: el formulario sigue
   intacto para editar.
2. **Estructura de la vista de lectura** (en orden): foto opcional
   (`img` con `alt=""` y `loading="lazy"`), **nombre como título** en
   `h3.recipe-view__title`, etiquetas en `div.recipe-view__tags`,
   descripción, porciones («N porciones»), sección **Ingredientes**
   (lista `ul` con cada fila nombre + cantidad), sección **Instrucciones**
   (lista **`ol` numerada** con los pasos), sección **Enlaces** (si los
   hay, al final) y, cerrando, los botones **Editar/Eliminar**
   (`data-recipe-edit` / `data-recipe-delete`, los mismos que ya
   conectaba `bindRecipeModalHandlers` en la issue #234). Las secciones
   vacías (sin descripción, sin foto, sin enlaces...) simplemente se
   omiten: una receta importada incompleta no deja huecos.
3. **Etiquetas diferenciadas por color**: dos clases,
   `recipe-view__tag--alergeno` (teal `--teal-reel` con texto `--white`,
   ≈ 6.8:1) y `recipe-view__tag--tipo` (ocre `--ochre-spine-dark` con
   texto `--white`, ≈ 5.2:1) — ambas AA ≥ 4.5:1. Se descarta el estilo
   translúcido de `.recipe-card__tag` (texto teal sobre `--teal-alpha-18`)
   porque el ocre sobre papel no alcanza el umbral de texto (≈ 4.3:1).
   En **negro puro**, bloque `[data-theme="black"]` con las variantes
   claras y texto `--ink`: `--teal-reel-dark` (≈ 6.5:1) y
   `--ochre-spine-dark #c99a4e` (≈ 8.2:1), mismas parejas ya aprobadas
   en el filtro de Recetas (ADR-087). Comentarios en el CSS documentan
   los ratios (AGENTS.md §4.4).
4. **Cantidades de ingrediente**: helper `cantidadRecetaHtml` — muestra
   `formatCantidad(cantidad) + unidad` (p. ej. «200 g») solo si hay
   cantidad o unidad; nunca la categoría; nunca botón de eliminar.
5. **Enlaces con higiene defensiva**: helper `enlaceRecetaHtml` — solo
   los esquemas `http/https` son clickeables (`<a>` con
   `target="_blank"` y `rel="noopener noreferrer"`); cualquier otro
   esquema (p. ej. `javascript:`) se muestra como texto plano. Todo
   dato de usuario pasa por `escapeHtml` (incluidos `href` y `src`).
6. **Interacciones sin cambios** (ADR-087 intacto): «Editar» re-renderiza
   en modo edición sin cerrar el modal, liberando el trap de foco previo
   y enfocando `#recipe-nombre`; «Eliminar» pasa por `deleteRecipeFlow` y
   cierra solo si borra; la ✕ cierra siempre; backdrop y Escape solo
   cierran en lectura; `trapFocus` se re-aplica en los re-renders en
   caliente. `bindRecipeModalHandlers` tolera la ausencia del formulario
   (sus accesos usan `?.` y `querySelectorAll` → no-ops seguros en
   lectura).
7. **Responsividad** (AGENTS.md §2): contenedor `.recipe-view` y todos
   los hijos con `min-width: 0`; `overflow-wrap: break-word` en título,
   descripción, etiquetas, pasos, nombres, cantidades y enlaces; en
   móvil (≤ 560 px) la fila de ingrediente pasa a `flex-wrap` y la
   cantidad larga («250 mililitros») baja a su propia línea. Las `<ul>` de
   ingredientes y enlaces no llevan viñetas (`list-style: none` +
   `padding-left: 0`); el `<ol>` de instrucciones recupera
   `display: block` + `list-style: decimal` para que los números se
   rendericen (un contenedor flex blockifica los `<li>` y los `::marker`
   desaparecen — hallazgo de QA corregido en la iteración).
8. **Manual de usuario**: §8.1 describe la vista de lectura como texto
   (foto, nombre como título, etiquetas verdes/ocre, descripción,
   porciones, ingredientes en lista, instrucciones numeradas, enlaces al
   final pulsables solo si son http/https), junto a los botones
   Editar/Eliminar y los cierres ya documentados.
9. **PWA**: bump de versión `20260917 → 20260918` en `js/config.js`
   (`APP_VERSION`), `index.html` (`?v=` de estilos y `app.js`) y
   `service-worker.js` (`STATIC_ASSETS`).

## Consecuencias

- **Positivas**: el modo lectura se distingue de un vistazo de la
  edición y se lee como contenido (foto, título, listas), no como un
  formulario bloqueado; las etiquetas de alérgenos y tipo ya no se
  confunden por color; los enlaces se abren en pestaña nueva con
  protección contra esquemas peligrosos; las recetas incompletas se
  muestran sin huecos (secciones condicionales).
- **Neutras**: la búsqueda global y el modal «Usada en» heredan la
  nueva vista de lectura (mismo `openRecipeModal(recipe,
  { readOnly: true })`); el formulario de edición no cambia; bump PWA
  `20260917 → 20260918`. Los casos sin foto o sin etiquetas muestran el
  nombre directamente como primer elemento (la foto es opcional).
- **Negativas**: ninguna conocida. QA validó los 10 criterios de
  aceptación (vista distinta de la edición, foto/nombre/etiquetas,
  colores diferenciados, descripción+porciones, ingredientes solo
  nombre+cantidad, instrucciones numeradas, enlaces al final, sin
  nombres de campo, nombre como título con encabezados de sección,
  Editar/Eliminar y cierres sin regresión), responsividad en
  360 / 768 / 1280 px sin scroll horizontal, los cuatro modos de tema
  con contraste AA (píldoras 5.2–8.2:1, meta en tinta plena 15.2:1 en
  Oscuro — el `--ink-soft` anterior daba 2.8:1 y no alcanzaba AA — y
  enlaces teal ≥ 5.7:1) y el escaneo de seguridad sin hallazgos (todo
  dato de usuario pasa por `escapeHtml`; los enlaces no-http no generan
  anclas).

## Iteración (2026-08-13, comentario de la issue)

Nuevo comentario del usuario en la issue #236:

> Las etiquetas de alérgenos y tipo de plato, deben tener también los
> colores diferentes en la tarjeta, no solo dentro de la ventana de
> información. Añade un lápiz al botón de editar.

### Cambios

1. **Colores por tipo también en la tarjeta**: `recipeCardHtml`
   (js/recipes.js) renderiza las etiquetas con los mismos modificadores
   que la vista de lectura (`recipe-card__tag--alergeno` teal /
   `recipe-card__tag--tipo` ocre). En CSS los selectores de color se
   **agrupan** con los de la vista de lectura
   (`.recipe-view__tag--alergeno, .recipe-card__tag--alergeno { ... }`),
   una sola fuente de verdad por regla (AGENTS.md §4.3), incluidos los
   overrides de negro puro. El antiguo estilo translúcido único de
   `.recipe-card__tag` (teal-alpha-18 + texto teal, ≈ 4.4:1, por debajo
   de AA) desaparece: la píldora base conserva solo la forma (radio,
   padding, tamaño) y el color lo aporta el modificador, con pares AA
   (teal 6.7:1 y ocre 5.2:1; en negro puro variantes claras 6.6:1 y
   7.4:1 con texto tinta).
2. **Lápiz en el botón de editar**: los dos botones «Editar» del flujo
   de recetas (vista de lectura y rama de solo lectura de
   `recipeModalHtml`) pasan de «Editar» a «✎ Editar», el mismo glifo
   ✎ (U+270E) que ya usan otros botones de edición de la app
   (p. ej. `editButtonHtml` en ui.js).
3. **Manual de usuario**: §8.1 describe ahora que las tarjetas también
   muestran las etiquetas en píldoras de colores (alérgenos verde, tipo
   ocre) y que el botón de editar lleva un lápiz ✎.
4. **PWA**: bump `20260918 → 20260919` (js/config.js, index.html y
   service-worker.js) porque cambian CSS y JS de la pestaña Recetas.

### Validación

- Criterios de aceptación: sin regresión (los 10 se re-verifican); los
  nuevos puntos de la iteración se validan contra el render real de la
  tarjeta y de la vista (modificadores presentes en el DOM, colores
  AA en los cuatro temas).
- Responsividad: 360 / 768 / 1280 px sin scroll horizontal en la
  tarjeta con etiquetas largas («Plato de cuchara», «Sin frutos secos»).
- Seguridad: escaneo sin hallazgos (el cambio no añade datos de
  usuario nuevos; `escapeHtml` sigue cubriendo las etiquetas).

Related issue: #236