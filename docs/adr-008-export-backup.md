# ADR-008: Exportación e importación de copia de seguridad JSON

## Estado
Aceptado

## Contexto
Los usuarios de "Mi Registro" acumulan datos personales en Firestore
(películas, series, libros, perfil, notificaciones) sin ninguna forma
de obtener una copia de seguridad de los mismos. Si un usuario quería
respaldar su información, no tenía forma de hacerlo desde la interfaz.

Además, la aplicación no ofrecía mecanismo alguno para migrar datos
entre cuentas o restaurar información en caso de pérdida accidental.

## Decisión
Implementar un módulo de exportación e importación de datos en formato
JSON, accesible desde una nueva pestaña "Datos" dentro de la vista de
perfil del usuario.

### Formato del archivo de respaldo
El archivo JSON exportado sigue esta estructura:

```json
{
  "exportDate": "2026-07-28T12:00:00.000Z",
  "version": "1",
  "source": "Mi Registro",
  "user": {
    "uid": "...",
    "email": "...",
    "displayName": "..."
  },
  "data": {
    "profile": { ... },
    "movies": [ ... ],
    "series": [ ... ],
    "books": [ ... ],
    "notifications": [ ... ]
  }
}
```

### Estrategia de exportación
1. El usuario hace clic en "Exportar copia de seguridad" desde la
   pestaña "Datos" del perfil.
2. Se recopilan todos los datos mediante lecturas simples de Firestore
   (`getItemsOnce` para películas, series y libros; `getUserProfile`
   para el perfil; y la lista en memoria de notificaciones).
3. Se construye un objeto JSON con metadatos (fecha, versión, usuario)
   y los datos organizados por categorías.
4. Se serializa con `JSON.stringify(backup, null, 2)` para producir un
   archivo legible.
5. Se descarga mediante un enlace temporal (`Blob` + `URL.createObjectURL`).

### Estrategia de importación
1. El usuario hace clic en "Importar copia de seguridad".
2. Un diálogo `confirm()` solicita confirmación antes de proceder.
3. Se abre un selector de archivos para elegir un JSON previamente
   exportado.
4. Se valida la estructura (versión mayor ≥ 1, presencia de `data`).
5. Se restauran los datos en Firestore en este orden:
   - Perfil del usuario (mediante `upsertUserProfile`)
   - Películas (mediante `addItem` con tipo "movie")
   - Series (mediante `addItem` con tipo "tv")
   - Libros (mediante `addItem` con tipo "book")
   - Notificaciones (mediante `addNotification`)
6. Cada elemento se inserta como un nuevo documento (los IDs viejos
   se descartan), y Firestore asigna nuevos `addedAt`/`updatedAt`
   mediante `serverTimestamp()`.
7. Se muestra un toast con el número total de elementos restaurados
   y cualquier error ocurrido.

### Ubicación en la interfaz
La funcionalidad se encuentra en la vista de perfil, bajo una nueva
pestaña "Datos", junto a las existentes "Estadísticas" y "Amigos".
Se muestran dos tarjetas independientes: una para exportar y otra
para importar.

### Arquitectura
```
js/export-backup.js          → Nuevo módulo con exportBackup(),
                                importBackup() y setupExportBackup()
js/profile.js                → Modificado: importa y llama a
                                setupExportBackup(ctx)
index.html                   → Modificado: añade subtab "Datos" y
                                sección #profile-section-data
css/styles.css               → Modificado: añade estilos .data-card
```

### Alternativas descartadas

- **Exportación automática periódica**: Se descartó porque la
  aplicación no tiene un backend propio que pueda programar tareas;
  depender de Firebase Functions añadiría complejidad innecesaria.
- **Integración con Google Drive/OneDrive**: El valor añadido no
  justifica la complejidad de OAuth adicional y gestión de tokens.
- **Botón de exportación en el header**: Se prefirió ubicarlo en el
  perfil porque es donde el usuario gestiona su información personal.
- **Importación con reemplazo de datos existentes**: Se optó por
  "solo añadir" para evitar pérdidas accidentales de datos. Si el
  usuario quiere reemplazar, debe borrar manualmente antes de importar.
- **Formato CSV/u otros formatos**: JSON es el formato nativo de
  Firestore y permite preservar la estructura completa de los datos.

## Consecuencias

### Positivas
- Los usuarios pueden descargar una copia de seguridad completa de
  sus datos con un solo clic.
- La importación permite restaurar datos de forma controlada, con
  confirmación y validación del formato.
- No se requieren permisos adicionales ni APIs externas.
- El archivo JSON es legible y portable.

### Negativas
- La importación es secuencial (un documento a la vez), por lo que
  restaurar conjuntos de datos muy grandes (>500 elementos) puede
  tomar varios segundos.
- No se conservan los IDs originales de Firestore; los elementos
  importados reciben nuevos IDs generados por Firestore.
- La importación no verifica duplicados: si se importa el mismo
  archivo dos veces, los elementos se duplican.

### Neutras
- Se añade un nuevo archivo JS de ~210 líneas (`export-backup.js`).
- La API de Firestore se usa para lecturas (`getItemsOnce`) y
  escrituras (`addItem`) que ya existían en el proyecto.
- La funcionalidad de importación incluye una llamada a
  `ctx.upsertUserProfile` que ya estaba disponible en el contexto.

## Archivos creados/modificados
- `js/export-backup.js` — Nuevo: módulo con exportación e importación
  de copias de seguridad (213 líneas).
- `js/profile.js` — Modificado: añadida importación y llamada a
  `setupExportBackup`, gestión de la nueva sección "Datos".
- `index.html` — Modificado: añadido subtab "Datos" y sección
  `#profile-section-data` con las tarjetas de exportar/importar.
- `css/styles.css` — Modificado: añadidos estilos `.data-card`.
