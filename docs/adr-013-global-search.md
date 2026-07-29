# ADR-013: Buscador global para navegación rápida en toda la biblioteca

## Estado
Implementado

## Contexto

La aplicación "Mi Registro" permite al usuario gestionar películas, series,
libros y amigos, con todos los datos disponibles en memoria a través de un
objeto de contexto (`ctx`). Sin embargo, la navegación entre contenidos
requería cambiar de pestaña (Series → Películas → Libros) o ir a la sección
de perfil para ver amigos. No existía una forma de buscar simultáneamente
en todos los datos del usuario desde un solo punto de entrada.

A medida que la biblioteca personal crece, encontrar un título específico
implica recordar en qué pestaña está o desplazarse manualmente. Además, no
había un atajo de teclado global para acceder rápidamente a cualquier
contenido.

Los buscadores tipo "command palette" (Cmd+K) se han convertido en un
estándar de UX moderno (GitHub, Linear, Notion, etc.) y proporcionan una
forma rápida y eficiente de navegar sin interrumpir el flujo de trabajo.

## Decisión

Implementar un **buscador global modal** (tipo command palette) accesible
mediante:

- Atajo de teclado `Ctrl+K` / `Cmd+K`
- Tecla `/` (cuando no hay un input enfocado)
- Botón de lupa 🔍 en el header de la aplicación

### Arquitectura

#### Nuevo módulo: `js/global-search.js`

El módulo se encapsula completamente con una única función de exportación:

```js
export function setupGlobalSearch(ctx)
```

**Estado interno** (closures del módulo, no globales):
- `isOpen` — si el modal está visible
- `highlightedIndex` — índice del elemento seleccionado con teclado
- `flatResults` — array plano de resultados (para navegación secuencial)
- `cachedProfiles` — caché de perfiles de amigos (se carga al abrir)
- `searchCtx` — referencia al contexto de la aplicación

**Flujo de búsqueda**:

```
Usuario pulsa Ctrl+K
        │
        ▼
openGlobalSearch() → muestra modal, enfoca input
        │
        ▼
Usuario escribe → input event → debounce 200ms
        │
        ▼
performSearch(query)
  ├─ ctx.getAllItems() → { movies, tv, books }
  │   └─ filterItems(items, query) por título (y autor en libros)
  │      └─ relevanceScore: exact > startsWith > includes > author
  │      └─ limit: 5 por grupo
  └─ cachedProfiles → filterFriends(profiles, query) por nombre/email
      └─ limit: 3
        │
        ▼
renderResults({ movies, tv, books, friends })
  → HTML agrupado con iconos, covers, estados y badges
  → Conecta event listeners de click en cada resultado
```

**Navegación**:
- Click en un resultado → `openItem(item, ctx)` (abre modal de detalle)
- Amigos → toast informativo "Próximamente podrás ver el perfil..."
- Flechas arriba/abajo → highlight progresivo con `scrollIntoView`
- Enter → abre el elemento highlighteado (o el primero)
- Escape → cierra el modal

#### Marcado HTML

El modal del buscador se inserta en `index.html` como un overlay fijo con
z-index superior al del modal de detalle (70 vs 50):

```html
<div id="global-search" class="global-search hidden">
  <div class="global-search__backdrop"></div>
  <div class="global-search__panel" role="dialog" aria-modal="true">
    <div class="global-search__header">
      <span class="global-search__icon">🔍</span>
      <input type="search" id="global-search-input"
             placeholder="Buscar películas, series, libros o amigos..." />
      <button type="button" id="global-search-close"><kbd>ESC</kbd></button>
    </div>
    <div class="global-search__results" id="global-search-results">
      <p class="global-search__hint">Escribe para buscar...</p>
    </div>
  </div>
</div>
```

#### Sistema de puntuación por relevancia

Los resultados se ordenan por relevancia para mostrar primero los más
probables:

| Condición | Puntos |
|-----------|--------|
| Título coincide exactamente | 100 |
| Título empieza con la query | 50 |
| Título contiene la query | 10 |
| Autor contiene la query | 5 |

### Alternativas descartadas

| Alternativa | Motivo |
|-------------|--------|
| **Búsqueda inline en el header** | Ocupa espacio permanente en la cabecera, compite visualmente con otros elementos, menos adecuado para móvil. |
| **Búsqueda solo con atajo de teclado** | Reduce la descubribilidad; se añadió un botón 🔍 en el header como punto de entrada visual. |
| **Búsqueda en Firebase (consultas a Firestore)** | Los datos ya están en memoria; una consulta remota añadiría latencia y coste innecesarios. |
| **Integrar la búsqueda en el input de búsqueda de pestañas** | Cada pestaña tiene su propio filtro local; mezclar ambas funcionalidades crearía confusión. |
| **Usar un Web Component o librería externa** | Sin build tool, no se pueden añadir dependencias npm. El JS nativo es suficiente para esta funcionalidad. |

## Consecuencias

### Positivas

- **Navegación unificada**: el usuario encuentra cualquier contenido desde
  un solo punto de entrada, sin cambiar de pestaña.
- **Atajos de teclado**: `Ctrl+K` y `/` proporcionan acceso rápido para
  usuarios avanzados.
- **Búsqueda en tiempo real**: el debounce de 200ms ofrece una experiencia
  fluida sin saturar el renderizado.
- **Navegación por teclado completa**: flechas + Enter permiten usar el
  buscador sin el ratón.
- **Sin dependencias externas**: todo el código usa APIs nativas del
  navegador (ES modules, Fetch, DOM API).
- **Caché de perfiles**: los datos de amigos se cargan una sola vez al
  abrir el buscador, reutilizándose en búsquedas posteriores.
- **Accesibilidad**: el modal usa `role="dialog"`, `aria-modal="true"` y
  `aria-label` en todos los elementos interactivos.

### Negativas

- **Límite de resultados**: 5 items por categoría y 3 amigos. Usuarios con
  bibliotecas muy grandes podrían no ver todos los resultados posibles.
- **Sin búsqueda en notas**: actualmente solo busca por título y autor; no
  indexa el contenido de las notas del usuario.
- **Amigos sin navegación directa**: seleccionar un amigo muestra un toast
  en lugar de navegar a su perfil (funcionalidad futura).
- **El botón 🔍 añade un elemento más al header**, que ya contiene
  notificaciones, tema, ajustes y perfil.

### Neutras

- El módulo `global-search.js` tiene ~420 líneas, similar en tamaño a otros
  módulos del proyecto.
- No se modificó la interfaz pública de ningún módulo existente.
- La búsqueda es puramente local (cliente), sin llamadas a Firestore ni a
  APIs externas.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/global-search.js` | **Nuevo**: lógica completa del buscador global (~424 líneas) |
| `index.html` | Añadido bloque HTML del modal `#global-search` y botón 🔍 en el header |
| `css/styles.css` | Añadidos estilos para el buscador global (~228 líneas al final) |
| `js/app.js` | Añadido `import` y llamada a `setupGlobalSearch(ctx)` en `init()` |
