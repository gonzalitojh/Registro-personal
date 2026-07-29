# ADR-015: Feed de actividad de amigos

## Estado
Aceptado

## Contexto
La aplicación ya contaba con una sección de "Amigos" donde se podía ver
el perfil, las estadísticas y la biblioteca detallada de cada amigo
(películas, series y libros de forma individual). Sin embargo, no había
una vista consolidada y cronológica que permitiera al usuario enterarse
de forma rápida de qué están haciendo sus amigos: qué películas han
visto, qué series han empezado o completado, y qué libros están leyendo
o han terminado.

Para obtener esta información, el usuario tenía que abrir manualmente la
ficha de cada amigo y examinar su biblioteca, lo cual era tedioso e
impedía tener una visión general de la actividad reciente. Además, la
aplicación ya disponía de un toggle de notificaciones "Actividad de
amigos" en los ajustes, pero no existía el feed correspondiente que
mostrara dicha actividad.

## Decisión
Implementar un **feed de actividad de amigos** que agregue las acciones
recientes de todos los amigos del usuario, ordenadas cronológicamente
de más reciente a más antiguo, y lo muestre en una nueva sección
"Actividad" dentro de la vista de perfil.

### Arquitectura del feed

Se crea un nuevo módulo independiente (`js/activity-feed.js`) que
genera eventos de actividad a partir de los datos existentes de cada
amigo (películas, series y libros). El feed es **generado
exclusivamente del lado del cliente**: no se crean colecciones nuevas
en Firestore ni se persisten eventos. Cada vez que el usuario accede a
la pestaña de actividad, se leen los datos actuales de todos los amigos
y se reconstruye el feed en tiempo real.

### Flujo de datos

```
Usuario hace clic en pestaña "Actividad"
  → profile.js: loadActivityFeed()
    → Obtiene perfiles de todos los usuarios
    → Filtra para excluir al usuario actual
    → Para cada amigo, carga en paralelo: movies, series, books
    → activity-feed.js: buildGlobalFeed(friendsData)
      → Por cada amigo: buildFriendFeed(name, movies, series, books)
        → Genera eventos según el contenido de cada categoría
      → Combina y ordena por fecha descendente
    → ui.js: renderActivityFeed(container, events, onItemClick)
      → Agrupa eventos por fecha ("Hoy", "Ayer", "DD de Mes, AAAA")
      → Renderiza tarjetas con portada, nombre, acción y título
      → Cada evento es cliqueable → modal de solo lectura
```

### Tipos de eventos detectados

| Evento                   | Constante             | Label                  | Condición de disparo                                     |
|--------------------------|-----------------------|------------------------|----------------------------------------------------------|
| Película vista           | `MOVIE_WATCHED`       | "Vio la película"      | Entrada en `watchLog`, o `status === "completado"`       |
| Serie empezada           | `SERIES_STARTED`      | "Empezó la serie"      | Un único episodio con fecha (serie no completada)        |
| Serie completada         | `SERIES_COMPLETED`    | "Completó la serie"    | `status === "completado"` (desde watched o lastWatchedAt)|
| Episodios vistos         | `SERIES_EPISODES`     | "Vio episodios de"     | Múltiples episodios con fecha (serie en curso)           |
| Libro empezado           | `BOOK_STARTED`        | "Está leyendo"         | Entrada en `readLog` con `startedAt` sin `finishedAt`    |
| Libro terminado          | `BOOK_FINISHED`       | "Terminó de leer"      | Entrada en `readLog` con `finishedAt`                    |

### Eventos adicionales (series)

El módulo también procesa el historial de recompletados (`history`) de
series, generando eventos adicionales de tipo `SERIES_STARTED` y
`SERIES_COMPLETED` para cada re-visión registrada. Además, si una serie
está marcada como completada pero no tiene episodios individuales
marcados, se usa `lastWatchedAt` o `updatedAt` como fecha de
referencia.

### Integración en la UI

- **Nueva pestaña "Actividad"** en la barra de subpestañas del perfil
  (junto a Estadísticas, Amigos, Datos y Ajustes).
- **Contenedor** `#profile-section-activity` con un área de carga
  (`#activity-feed-loading`) y un contenedor de eventos
  (`#activity-feed-container`).
- **Estados vacíos**: mensaje "Todavía no hay actividad reciente de tus
  amigos." cuando no hay eventos, y "No se pudo cargar la actividad de
  amigos." en caso de error.
- **Agrupación por fecha**: los eventos se agrupan bajo encabezados
  "Hoy", "Ayer" o la fecha completa (ej. "15 de Julio, 2026").
- **Cada evento muestra**: portada del contenido, nombre del amigo (en
  negrita), acción realizada, título del contenido (en cursiva) y un
  icono representativo. Al hacer clic se abre un modal de solo lectura
  con los detalles del ítem.
- **Carga paralela**: los datos de cada amigo se obtienen con
  `Promise.all`, minimizando el tiempo de espera.

### Implementación técnica

- **Módulo nuevo**: `js/activity-feed.js` (233 líneas) con dos
  exportaciones principales:
  - `buildFriendFeed(friendName, movies, series, books)` → eventos de
    un amigo.
  - `buildGlobalFeed(friendsData)` → eventos combinados y ordenados
    globalmente.
- **Helper interno**: `maybePushDateEvent(events, date, type, label,
  friendName, item, detail)` que valida y convierte fechas (soporta
  strings ISO, Timestamp de Firestore con `.toDate()`, y objetos con
  `.seconds`) antes de añadir el evento.
- **Íconos por tipo**: definidos en `ui.js` con `eventIcon()`: 🎬
  (película), 📺 (serie), 🏁 (serie completada), 📖 (leyendo), 📚
  (terminado).
- **Lógica de fechas**: la función `formatDateLabel()` produce etiquetas
  "Hoy", "Ayer" o "DD de Mes, AAAA" para agrupar visualmente los
  eventos.

## Alternativas consideradas

- **Feed persistido en Firestore**: Almacenar eventos en una colección
  `/activity/{eventId}` cada vez que un usuario realiza una acción.
  Descartado porque:
  - Requiere escrituras adicionales en cada acción del usuario,
    aumentando el costo de Firestore.
  - Los eventos existentes no tendrían este registro, por lo que
    igualmente habría que migrarlos o generarlos client-side.
  - Complejidad añadida para mantener la consistencia (ej. acciones
    deshechas, ediciones de fecha).
- **Notificaciones push como feed**: Usar el sistema de notificaciones
  existente para doblar como feed histórico. Descartado porque las
  notificaciones tienen un propósito diferente (avisos puntuales, no
  un registro cronológico completo).

## Consecuencias

### Positivas
- Los usuarios pueden ver de un vistazo la actividad reciente de todos
  sus amigos, ordenada cronológicamente.
- No requiere cambios en el modelo de datos de Firestore ni en las
  reglas de seguridad.
- Reutiliza el sistema existente de carga de datos de amigos y el modal
  de solo lectura, minimizando el nuevo código.
- Los eventos se generan siempre con los datos más actualizados (no hay
  lag de sincronización).
- La carga en paralelo de los datos de cada amigo ofrece un rendimiento
  aceptable incluso con varios amigos.

### Negativas
- El feed se genera completamente en el cliente cada vez que se accede
  a la pestaña, lo que puede ser lento para usuarios con muchos amigos
  y grandes bibliotecas. No hay caché ni paginación.
- No hay soporte para "carga infinita" o "ver más": todos los eventos
  se renderizan a la vez, lo que podría degradar el rendimiento en
  pantalla con muchos eventos.
- Los eventos desaparecen si el amigo elimina o modifica el ítem (por
  diseño, ya que se genera en tiempo real), pero esto puede resultar
  confuso si un evento desaparece del feed sin aviso.
- Dependencia de que los datos de los amigos tengan fechas bien
  formadas: los eventos sin fecha se omiten silenciosamente.
- Los nombres de los amigos se resuelven a partir del perfil en el
  momento de la carga; si un amigo cambia su nombre, los eventos
  anteriores aparecerán con el nombre nuevo.

### Neutras
- El feed incluye al usuario actual si aparece en la lista de perfiles
  (se filtra por UID, no por relación de amistad explícita, ya que la
  app no implementa un sistema de amistad formal — todos los usuarios
  registrados son visibles entre sí).
- Los eventos de series tienen un tratamiento más complejo que los de
  películas y libros, debido a la naturaleza episódica del progreso.

## Archivos creados/modificados
- `js/activity-feed.js` — Nuevo módulo generador del feed (233 líneas).
- `js/profile.js` — Integración: nueva pestaña "Actividad", función
  `loadActivityFeed()`, importación de `buildGlobalFeed`.
- `js/ui.js` — Añadidas `renderActivityFeed()`, `formatDateLabel()`,
  `eventIcon()` y constante `PLACEHOLDER_COVER_SMALL`.
- `index.html` — Añadido `#profile-section-activity` con contenedor de
  feed y estado de carga.
- `css/styles.css` — Añadidos estilos para `.activity-feed`,
  `.activity-group`, `.activity-event` y sus variantes.
