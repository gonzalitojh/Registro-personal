# ADR-017: Mejora visual del botón de tráiler

## Estado
Implementado

## Contexto

En ADR-008 se implementó el soporte de tráilers desde TMDB, incluyendo la generación del HTML del botón mediante la función `trailerButtonHtml(item)` en `js/ui.js`. Esta función produce un enlace `<a>` con las clases BEM `.trailer-btn`, `.trailer-btn__icon` y `.trailer-btn__label`. Aunque la ADR-008 mencionaba que se habían añadido estilos CSS para estas clases, en realidad **nunca se llegaron a implementar**: no existía ninguna regla CSS para `.trailer-btn` ni sus variantes en `ocio/ocio.css` ni en ningún otro lugar.

Como resultado, el botón de «Ver tráiler» era funcional (abría correctamente el enlace de YouTube en una nueva pestaña), pero se renderizaba como un enlace de texto sin formato —sin fondo, sin padding, sin bordes redondeados—, rompiendo la coherencia visual con el resto de la interfaz. El icono ▶ y la etiqueta «Tráiler» aparecían como texto simple subrayado, indistinguibles de un enlace común.

El botón se muestra en tres modales distintos (detalle de película, detalle de serie, y modal de solo lectura de amigo), por lo que la ausencia de estilo afectaba a todas las vistas de detalle de la aplicación.

## Decisión

Añadir estilos CSS completos para el botón de tráiler en `ocio/ocio.css`, transformándolo visualmente en un «chip» o «píldora» coherente con la paleta de colores y el sistema de diseño de la aplicación.

### Diseño visual

| Propiedad | Valor | Justificación |
|-----------|-------|---------------|
| **Forma** | `border-radius: 999px` (píldora) | Consistente con otros badges del sistema como `.read-only-badge` |
| **Color de fondo** | `var(--teal-reel)` (#2b6459) | Mismo acento teal que usan `.community-rating__label`, `.btn--accent-media` y otros elementos de películas/series |
| **Hover** | `var(--teal-reel-dark)` (#1c4a41) | Transición suave de 0.15s para feedback visual |
| **Active** | `translateY(1px)` | Ligero desplazamiento para sensación de pulsación física |
| **Focus-visible** | `outline: 2px solid var(--teal-reel)` con `outline-offset: 2px` | Accesibilidad por teclado, coherente con el resto de elementos focusables del sistema |
| **Tipografía** | 0.78rem, semibold (600) | Misma escala que botones pequeños del sistema |
| **Icono** | 0.6rem | Reducido proporcionalmente para equilibrar con el texto |
| **Espaciado** | `padding: 0.25rem 0.7rem 0.25rem 0.55rem` | Más relleno a la derecha (texto) que a la izquierda (icono) para equilibrio visual |
| **Layout** | `inline-flex` con `gap: 0.35rem` | Alineación precisa de icono y texto en una sola línea |

### Reglas CSS añadidas

Se añadieron ~40 líneas en `ocio/ocio.css` (bloque completo con comentario de sección) que cubren:

1. **`.trailer-btn`** — Estilo base del botón (display, colores, bordes, tipografía, transiciones).
2. **`.trailer-btn:hover`** — Color de fondo más oscuro, sin subrayado.
3. **`.trailer-btn:active`** — Efecto de presión.
4. **`.trailer-btn__icon`** — Tamaño del icono reducido, sin ajuste de línea.
5. **`.trailer-btn__label`** — Prevención de salto de línea.
6. **`.trailer-btn:focus-visible`** — Outline de accesibilidad.

### Cobertura

El CSS aplica automáticamente a los tres modales donde se usa `trailerButtonHtml()`:
- `openMovieModal()` — modal de detalle de película.
- `openTvModal()` — modal de detalle de serie.
- `openReadOnlyModal()` — modal de solo lectura (amigos).

No se modificó ningún archivo JavaScript, HTML ni otros CSS. Las clases BEM existentes se mantienen intactas.

### Detalles de implementación

- **Solo se modificó** `ocio/ocio.css` (~40 líneas).
- **No se modificó** `js/ui.js`, `js/api-movies.js`, `js/daily-check.js`, `css/styles.css`, ni `index.html`.
- El HTML generado por `trailerButtonHtml()` permanece idéntico:
  ```html
  <a class="trailer-btn" href="https://www.youtube.com/watch?v=..." target="_blank" rel="noopener noreferrer" aria-label="Ver tráiler en YouTube">
    <span class="trailer-btn__icon" aria-hidden="true">▶</span>
    <span class="trailer-btn__label">Tráiler</span>
  </a>
  ```

### Accesibilidad

- **Contraste**: El color `--teal-reel` (#2b6459) sobre `--paper` (#f1ead9) tiene una relación de contraste de 5.70:1, superando el umbral WCAG AA de 4.5:1 para texto normal.
- **Focus-visible**: Outline visible para navegación por teclado, coherente con el patrón establecido en otros elementos interactivos (`.btn-filter`, `.sort-select`, etc.).
- **aria-label**: Se preserva el `aria-label="Ver tráiler en YouTube"` del HTML generado.
- **Icono decorativo**: `aria-hidden="true"` en el span del icono, semántica transmitida por el texto visible y el `aria-label`.

## Alternativas descartadas

- **Rojo YouTube (#ff0000) como color de fondo**: Se descartó porque:
  - El rojo YouTube no forma parte de la paleta de la aplicación.
  - Introduciría un color aislado que no se usa en ningún otro elemento.
  - `--teal-reel` ya es el color identificativo del contenido audiovisual (películas/series) en la aplicación.
  - El contraste de #ff0000 sobre fondo oscuro es bajo en modo oscuro (2.80:1).
  - La ADR-008 original especulaba con un botón «rojo estilo YouTube», pero en la práctica el teal se integra mejor con el sistema de diseño existente.

- **Botón rectangular con bordes tradicionales**: Se descartó porque:
  - El diseño tipo píldora (`border-radius: 999px`) es consistente con otros badges y chips de la interfaz (`.read-only-badge`, etiquetas de estado).
  - Los botones rectangulares con bordes de 4-6px se usan para acciones principales (botones de formulario, filtros), no para complementos informativos.
  - La forma de píldora diferencia visualmente el tráiler como un elemento complementario, no como una acción principal.

- **Botón con relleno completo (block)**: Se descartó porque `inline-flex` permite que el botón fluya con el contenido y no fuerce un ancho completo innecesario. El botón es un complemento que va integrado entre la puntuación comunitaria y la información ampliada.

- **Icono SVG de YouTube en lugar del carácter ▶**: Se descartó porque:
  - El carácter Unicode ▶ es universal, no requiere carga adicional y funciona sin JavaScript.
  - Un SVG de YouTube añadiría una petición extra o código inline, aumentando el peso de la página.
  - El ▶ es reconocible instantáneamente como icono de reproducción.
  - La marca visual de YouTube se transmite suficientemente al abrir el enlace.

- **Sombra o elevación en el botón**: Se descartó porque el sistema de diseño de la aplicación usa sombras principalmente en tarjetas y modales, no en elementos inline pequeños. Un botón tipo píldora sin sombra es más plano y consistente con otros badges.

## Consecuencias

### Positivas
- El botón de tráiler ahora es visualmente distintivo: se reconoce como un elemento interactivo, no como un enlace de texto.
- La coherencia visual con el sistema de diseño mejora: usa `--teal-reel`, el mismo acento que otros elementos de películas/series.
- La accesibilidad mejora con contraste suficiente (5.70:1) y focus-visible explícito.
- La implementación es mínima: solo CSS, sin cambios en JS, HTML ni otros archivos.
- Funciona en los tres modales sin duplicación de código.
- Es responsive por diseño (usa `rem`, `inline-flex` y unidades relativas).

### Negativas
- El color teal, aunque coherente con la app, no es el rojo asociado culturalmente a YouTube. Un usuario podría esperar el color característico de la plataforma.
- El botón es sutil (tamaño pequeño, colores integrados), lo que podría hacerlo menos visible para usuarios que buscan activamente un tráiler.
- Los títulos sin `trailerUrl` (añadidos manualmente sin TMDB) no muestran el botón, pero esto es una limitación del dato, no del estilo.

### Neutras
- El CSS añadido (~40 líneas) incrementa ligeramente el tamaño de `ocio/ocio.css` (de ~1729 a ~1769 líneas).
- Al usar `var(--teal-reel)` y `var(--paper)`, el botón se adapta automáticamente al tema claro/oscuro sin cambios adicionales.
- Las clases BEM existentes no se modifican; el cambio es puramente aditivo en CSS.
- El botón sigue abriendo en nueva pestaña (`target="_blank"`), preservando el estado de la aplicación.

## Archivos modificados

- `ocio/ocio.css` — Nuevas reglas CSS para `.trailer-btn`, `.trailer-btn:hover`, `.trailer-btn:active`, `.trailer-btn:focus-visible`, `.trailer-btn__icon` y `.trailer-btn__label` (bloque entre líneas 1369-1407 y regla `:focus-visible` en línea 1766).
