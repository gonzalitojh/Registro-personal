# ADR-002: Búsqueda de libros con Google Books API y agrupación inteligente

## Estado
Aceptado

## Contexto
La búsqueda de libros usaba Open Library como fuente principal y Google Books como respaldo. Aunque Open Library agrupa por obra (un libro = un resultado), su calidad de metadatos es inferior: sinopsis limitada, menos portadas disponibles, y resultados a veces incompletos. Google Books tiene metadatos superiores (sinopsis completas, múltiples portadas por edición, conteo de páginas) pero agrupa por edición, lo que inundaba la lista con la misma novela en tapa dura, bolsillo, inglés, francés...

El usuario prefería la calidad de resultados de Google Books pero quería evitar la duplicación por edición.

## Decisión
Cambiar la fuente principal de búsqueda de libros a **Google Books API**, implementando una **agrupación inteligente por título+autor** que consolida múltiples ediciones de la misma obra en un único resultado. Al añadir un libro con múltiples ediciones agrupadas, se muestra un **modal de selección** donde el usuario puede elegir:

1. **Portada**: entre todas las portadas disponibles de todas las ediciones agrupadas.
2. **Sinopsis**: entre las diferentes sinopsis disponibles (si difieren entre ediciones).

Open Library se mantiene como fuente de respaldo cuando Google Books no encuentra resultados o falla.

### Flujo de datos (nuevo)

```
Consulta del usuario
  │
  ▼
searchBooks() ─── Google Books primero
  │
  ├─ Google Books devuelve items crudos (múltiples ediciones)
  │     │
  │     ▼
  │  groupBooksByWork()  ← agrupa por título+autor normalizados
  │     │                  fusiona covers[], descriptions[]
  │     │                  elige mejor edición representante
  │     ▼
  │  Resultados enriquecidos con allCovers[], allDescriptions[], editionsCount
  │
  ├─ Si no hay resultados → respaldo Open Library (sin cambios)
  │
  ▼
renderSearchResults()  ← muestra badge "X eds." para libros agrupados
  │
  ▼
Usuario pulsa "Añadir"
  │
  ├─ Si 1 portada + 1 sinopsis → ruta rápida (sin modal)
  │
  ├─ Si múltiples portadas O sinopsis
  │     │
  │     ▼
  │  openBookConfirmModal()  ← selector de portada + sinopsis
  │     │
  │     ▼
  │  Usuario elige → addItem() con valores seleccionados
  │
  ▼
Libro guardado en Firestore (estructura sin cambios)
```

### Detección cruzada de "ya añadido"
Un libro añadido vía Open Library (externalId "/works/...") se detecta también en resultados de Google Books (y viceversa) mediante coincidencia por título+autor normalizados, no solo por externalId.

## Consecuencias

### Positivas
- **Mejores resultados**: Google Books ofrece sinopsis completas, más portadas, y metadatos más ricos.
- **Sin duplicación**: La agrupación por título+autor consolida ediciones de la misma obra.
- **Control del usuario**: Al añadir, se puede elegir portada y sinopsis de entre todas las opciones.
- **Compatibilidad cruzada**: Un libro añadido por Open Library se reconoce en búsquedas de Google Books.
- **Respaldado**: Si Google Books falla, Open Library sigue disponible.

### Negativos
- **Complejidad adicional**: La agrupación y el modal de selección añaden código.
- **Dependencia de Google Books**: Si su API cambia o limita el acceso, se cae al respaldo de Open Library.
- **Posible sobrerrepresentación**: La normalización de títulos puede agrupar libros distintos con títulos similares (riesgo bajo, mitigado por incluir el autor en la clave).

### Neutros
- **Estructura Firestore sin cambios**: No se necesita migración de datos existentes.
- **UX sin cambios en películas/series**: Solo afecta a la pestaña de libros.

## Archivos modificados
- `js/api-books.js` — Reescrito: Google Books como fuente principal, `groupBooksByWork()`, `normalizeTitle()`, `pickBestEdition()`
- `js/search.js` — Modificado: detección cruzada de "ya añadido", modal de confirmación para libros
- `js/ui.js` — Modificado: `renderSearchResults()` con parámetro `customCheck`, badge de ediciones, `openBookConfirmModal()`
- `ocio/ocio.css` — Modificado: estilos para cover picker, description picker, badge de ediciones
