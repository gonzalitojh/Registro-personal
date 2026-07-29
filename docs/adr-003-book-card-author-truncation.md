# ADR-003: Truncado de autores en tarjetas de libros

## Estado
Aceptado

## Contexto
Cuando un libro tiene muchos autores, la línea de metadatos
("Autor1, Autor2, Autor3 … · 2024") se alarga horizontalmente
y estira las tarjetas de la cuadrícula (`library-grid`), rompiendo
la alineación del grid que usa `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`.
Esto obliga al usuario a desplazarse horizontalmente y desordena
la biblioteca visualmente.

Además, el título del libro también podía desbordarse en tarjetas
con títulos muy largos.

## Decisión
Aplicar las siguientes técnicas CSS y HTML para mantener tarjetas
de tamaño uniforme sin perder información:

1. **CSS `text-overflow: ellipsis`** en `.item-card__meta` y
   `.list-row__meta` para truncar visualmente la línea de autor/año
   cuando es demasiado larga, mostrando puntos suspensivos (...).

2. **CSS `-webkit-line-clamp: 2`** en `.item-card__title` para
   limitar el título a un máximo de 2 líneas antes de truncar.

3. **`min-width: 0`** en `.item-card` (grid item) para que la
   columna del grid pueda encogerse por debajo del tamaño del
   contenido. Sin esto, los grid items tienen `min-width: auto`
   por defecto y el `text-overflow: ellipsis` nunca se activa
   porque el elemento nunca se ve forzado a ser más angosto.

4. **`min-width: 0`** en `.item-card__body` para evitar que el
   contenido fuerce al contenedor flex (dentro del grid item) a
   expandirse más allá del ancho de la columna.

   > **Nota**: Ambos `min-width: 0` son necesarios: uno a nivel
   > grid item (`.item-card`) y otro a nivel flex child
   > (`.item-card__body`). El primero permite que la columna del
   > grid se encoja, y el segundo permite que el body flex se
   > encoja dentro del card.

5. **Atributo HTML `title`** nativo en los elementos de título y
   metadatos, tanto en vista cuadrícula como lista, para que el
   contenido completo sea visible como tooltip del navegador al
   hacer hover.

6. **`title` en el botón `.item-card__btn`** (capa absoluta que
   cubre toda la tarjeta) con el título y autor completos, para
   garantizar que el tooltip sea accesible en vista cuadrícula
   donde el botón overlay intercepta los eventos del ratón.

### Alternativas descartadas

- **Tooltip personalizado con JavaScript**: Complejidad adicional
  innecesaria; el tooltip nativo (`title`) cubre el caso de uso
  sin añadir dependencias ni lógica extra.
- **Modal adicional para autores**: Sobrecarga de interacción para
  un dato secundario; el detalle completo ya está disponible en el
  modal de ficha del libro al hacer clic.
- **Acortar el autor en JavaScript (mostrar solo primeros N
  autores)**: Pérdida de información sin beneficio claro, y
  requeriría cambios en la lógica de datos.
- **Solo tooltip sin truncado**: No resuelve el problema de layout;
  las tarjetas seguirían estirándose.

### Nota sobre tooltip en cuadrícula
En vista cuadrícula, el botón `.item-card__btn` tiene
`position: absolute; inset: 0` y cubre toda la tarjeta. Esto
impide que los `title` de los elementos hijos se activen. Como
solución, se añadió `title` directamente al botón con el título
y autor completos.

## Consecuencias

### Positivas
- Las tarjetas mantienen tamaño uniforme independientemente de la
  longitud del campo `author`.
- La información completa es accesible por hover (tooltip nativo)
  y permanentemente en el modal de detalle.
- No hay cambios en la lógica de datos ni en el formato de
  almacenamiento de autores.
- Títulos largos se muestran hasta 2 líneas antes de truncar.

### Negativas
- El tooltip nativo del navegador no es personalizable
  visualmente (estilo, animación, tiempo de aparición).
- En vista cuadrícula, el tooltip del botón muestra título y
  autor juntos, no por separado.

### Neutras
- Non-book items (movies, TV) no se ven afectados porque su
  metadato "tipo · año" es siempre corto.
- La vista de lista ya tenía truncado en `.list-row__title`;
  solo se añadió el `title` attribute y truncado en el meta.

## Archivos modificados
- `ocio/ocio.css` — Añadido `min-width: 0` a `.item-card` (grid
  item, la pieza clave que faltaba) y a `.item-card__body`,
  `-webkit-line-clamp` a `.item-card__title`, y `text-overflow:
  ellipsis` a `.item-card__meta` y `.list-row__meta`.
  En las tarjetas de resultados de búsqueda (`.result-card`):
  `min-width: 0` en `.result-card__body`, `text-overflow: ellipsis`
  en `.result-card__title` y `.result-card__meta`.
- `js/ui.js` — Añadidos atributos `title` a los elementos de
  título y metadatos en `renderGrid()` y `renderList()`, y al
  botón `.item-card__btn` en cuadrícula. También en
  `renderSearchResults()` para `.result-card__title` y
  `.result-card__meta`.
- `js/global-search.js` — Añadidos atributos `title` a los
  elementos `.global-search__item-title` y
  `.global-search__item-meta`.
