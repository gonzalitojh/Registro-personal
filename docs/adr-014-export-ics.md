# ADR-014: Exportación de calendario de estrenos a formato .ics

## Estado
Aceptado

## Contexto
Los usuarios de "Mi Registro" siguen series en emisión y tienen películas
pendientes de estreno, pero no disponen de una forma sencilla de hacer
seguimiento de las fechas de sus próximos episodios y estrenos desde su
calendario personal (Google Calendar, Apple Calendar, etc.).

La aplicación ya almacena información de próximos episodios
(`nextEpisodeToAir` obtenido de TMDB) y fechas de estreno de películas
(`releaseDate`), pero esta información solo es visible dentro de la
interfaz de la web. No existía un mecanismo para exportar estas fechas
a un formato estándar de calendario.

## Decisión
Implementar un módulo de exportación de calendario en formato .ics
(iCalendar, RFC 5545), accesible desde la pestaña "Datos" de la vista
de perfil del usuario.

### Formato del archivo .ics
El archivo generado sigue el estándar iCalendar (RFC 5545) con la
siguiente estructura:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Mi Registro//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:mi-registro-{tipo}-{id}@registro-personal
DTSTART;VALUE=DATE:YYYYMMDD
SUMMARY:Nuevo episodio: {serie} T{temp}E{ep}
DESCRIPTION:...
TRANSP:TRANSPARENT
END:VEVENT
...
END:VCALENDAR
```

### Eventos incluidos
1. **Próximos episodios de series**: Se incluyen todas las series que
   tengan un `nextEpisodeToAir.airDate` válido y futuro. El resumen
   muestra "Nuevo episodio: {título} T{temp}E{episodio}".
2. **Estrenos de películas**: Se incluyen las películas con estado
   "pendiente" o marcadas como `awaitingRelease` que tengan una
   `releaseDate` futura. El resumen muestra "Estreno: {título}".

### Estrategia de exportación
1. El usuario hace clic en "Exportar calendario (.ics)" desde la
   pestaña "Datos" del perfil.
2. Se recopilan los eventos a partir de los datos ya cargados en
   memoria (`ctx.getItemsByGroup("tv")` y `ctx.getItemsByGroup("movies")`).
3. Se filtran solo los elementos con fechas futuras (mayores o iguales
   a la fecha actual).
4. Se genera el contenido ICS siguiendo RFC 5545, con:
   - Escapado de caracteres especiales en valores TEXT (\ , ; , \n)
   - Plegado de líneas (máximo 75 octetos por línea)
   - Fechas en formato DATE (YYYYMMDD) para eventos de día completo
   - UIDs estables basados en el tipo e ID del elemento
5. Se descarga mediante un enlace temporal (`Blob` + `URL.createObjectURL`)
   con nombre `calendario-estrenos-{fecha}.ics`.

### Ubicación en la interfaz
El botón de exportación se encuentra en la vista de perfil, bajo la
pestaña "Datos", en una nueva tarjeta independiente después de las
tarjetas de exportación e importación de copia de seguridad JSON.

### Arquitectura
```
js/export-ics.js     → Nuevo módulo con generateIcsString(),
                        collectUpcomingEvents(), downloadIcs()
                        y setupExportIcs()
js/profile.js        → Modificado: importa y llama a
                        setupExportIcs(ctx)
index.html           → Modificado: añade data-card con
                        botón #btn-export-ics en la sección de datos
```

### Detalles técnicos
- **Formato de fecha**: Se usa `VALUE=DATE` (sin hora) porque las fechas
  de episodios y estrenos son fechas sin hora específica. Esto evita
  problemas de zona horaria.
- **TRANSP:TRANSPARENT**: Marca los eventos como transparentes (no
  bloquean tiempo en el calendario), apropiado para estrenos y episodios.
- **Sin DTEND**: Para eventos de un solo día con `VALUE=DATE`, la
  ausencia de DTEND implica duración de 1 día (RFC 5545 §3.6.1).
- **Escapado ICS**: Se escapan correctamente \, ; , y saltos de línea
  para evitar romper la estructura del archivo.
- **Plegado de líneas**: Implementa el plegado RFC 5545 (máx. 75
  octetos) para cumplir con el estándar.
- **Sin DTSTAMP**: No se incluye por simplicidad; Google Calendar y
  Apple Calendar aceptan el archivo sin este campo.

### Alternativas descartadas
- **Exportación automática periódica**: No hay backend que pueda
  programar tareas; depender de Firebase Functions añade complejidad.
- **Formato CSV**: Los formatos CSV no son directamente importables en
  calendarios; .ics es el estándar universal.
- **Sincronización en tiempo real (CalDAV)**: Requeriría un servidor
  CalDAV y autenticación adicional, fuera del alcance de la aplicación.
- **Selector de qué incluir (series/películas)**: Para la versión
  inicial se incluyen ambos tipos. Un modal de selección puede añadirse
  en el futuro si los usuarios lo solicitan.
- **Recordatorios (VALARM)**: No se añaden porque cada calendario
  gestiona recordatorios de forma diferente; los usuarios pueden
  configurarlos desde su calendario.

## Consecuencias

### Positivas
- Los usuarios pueden importar los próximos episodios y estrenos en
  su calendario personal con un solo clic.
- Al estar en formato .ics estándar, funciona en cualquier aplicación
  de calendario (Google Calendar, Apple Calendar, Outlook, etc.).
- No se requieren APIs externas ni permisos adicionales.
- La información se genera completamente del lado del cliente, sin
  enviar datos a servidores externos.

### Negativas
- No hay sincronización automática: si el usuario añade nuevas series
  o películas, debe exportar de nuevo el archivo.
- Los eventos se generan como fecha completa (día) sin hora específica;
  no se puede saber la hora exacta de emisión del episodio.
- Si no hay próximos episodios ni estrenos, el botón muestra un toast
  informativo pero no descarga ningún archivo.

### Neutras
- Se añade un nuevo archivo JS de ~200 líneas (`export-ics.js`).
- No se requieren cambios en CSS (reusa estilos existentes `.data-card`
  y `.btn--accent-media`).
- La funcionalidad no interfiere con la exportación/importación JSON
  existente.

## Archivos creados/modificados
- `js/export-ics.js` — Nuevo: módulo con generación y descarga de
  archivos .ics (~200 líneas).
- `js/profile.js` — Modificado: añadida importación y llamada a
  `setupExportIcs(ctx)`.
- `index.html` — Modificado: añadida tarjeta con botón de exportación
  `#btn-export-ics` en la sección `#profile-section-data`.
