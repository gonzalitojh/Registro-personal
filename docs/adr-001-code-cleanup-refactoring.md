# ADR-001: Limpieza de código y refactorización de app.js

**Fecha:** 2026-07-28
**Estado:** Aceptado
**Decisor:** Gonza (propietario del proyecto)

## Contexto

El proyecto "Mi Registro" es una aplicación web estática (HTML + CSS + JS con módulos ES nativos, sin herramientas de build) para registrar películas, series y libros. Usa Firebase como base de datos y APIs externas (TMDB, Open Library, Google Books). Está alojada en GitHub Pages.

El archivo principal `app.js` había crecido hasta las 1338 líneas, con toda la lógica de negocio concentrada en una única función `init()` de más de 1200 líneas. `ui.js` tenía 1323 líneas de renderizado del DOM. Existía código duplicado entre módulos:

- `isNextEpisodeUnreleased` estaba definida tanto en `app.js` como en `ui.js`
- `STATUS_LABELS` / `STATUS_LABELS_NEUTRAL` estaban definidos en ambos archivos
- `localNormalizeEntry` en `ui.js` era duplicado de `normalizeEntry` en `tv-progress.js`
- `TYPE_BY_GROUP` estaba en `app.js` sin reutilización

## Decisión

Refactorizar la base de código extrayendo 8 módulos nuevos de `app.js`, siguiendo el patrón de Contexto (`ctx`) para pasar dependencias explícitamente y evitar importaciones circulares.

### Patrón de Contexto (ctx)

Cada módulo extraído recibe un objeto `ctx` con funciones de acceso al estado y a las dependencias. Ejemplo:

```js
const ctx = {
  getCurrentUser: () => currentUser,
  getItemsByGroup: (group) => allItems[group] || [],
  updateItem,
  deleteItem,
  showToast: ui.showToast,
  // ...etc
};
setupSearch(ctx);
```

Este patrón:
- Hace todas las dependencias explícitas en la firma de cada función
- Evita importaciones circulares (ningún módulo importa de app.js)
- Permite que los módulos se prueben de forma independiente
- Mantiene el estado mutable centralizado en app.js

## Cambios Realizados

### Módulos Nuevos Creados

| Módulo | Líneas | Responsabilidad |
|--------|--------|-----------------|
| `js/constants.js` | 39 | Constantes compartidas: STATUS_LABELS, TYPE_BY_GROUP |
| `js/sorting.js` | 99 | Funciones de ordenación y comparación |
| `js/daily-check.js` | 161 | Comprobación diaria de estrenos y metadatos |
| `js/quick-actions.js` | 98 | Acciones rápidas (marcar vista/siguiente episodio) |
| `js/modal-handlers.js` | 199 | Apertura y gestión de modales por tipo |
| `js/notifications-setup.js` | 31 | Wiring del dropdown de notificaciones |
| `js/search.js` | 284 | Toda la funcionalidad de búsqueda y alta |
| `js/profile.js` | 237 | Perfil, estadísticas y amigos |

### Archivos Modificados

- **js/app.js**: Reducido de 1338 a 330 líneas (-75%), ahora sirve como orquestador
- **js/ui.js**: Eliminadas 3 funciones duplicadas, ahora importa de nuevos módulos
- **ocio/ocio.css**: Fusionadas definiciones duplicadas de `.seasons-list` y `.season-header`

### Deduplicación Eliminada

| Código duplicado | Antes | Después |
|-----------------|-------|---------|
| `isNextEpisodeUnreleased` | app.js + ui.js | Solo en sorting.js |
| `STATUS_LABELS` | app.js + ui.js | Solo en constants.js |
| `STATUS_LABELS_NEUTRAL` | app.js | Solo en constants.js |
| `localNormalizeEntry` | ui.js | Eliminado (usa normalizeEntry de tv-progress.js) |
| `TYPE_BY_GROUP` | app.js | Solo en constants.js |
| CSS `.seasons-list` | 2 definiciones | 1 definición |
| CSS `.season-header` | 2 definiciones | 1 definición |

## Consecuencias

### Positivas
- `app.js` es ahora un orquestador limpio (~330 líneas)
- Cada módulo de funcionalidad es mantenible de forma independiente
- Las dependencias fluyen en una sola dirección (sin importaciones circulares)
- El patrón ctx hace todas las dependencias explícitas
- Código total: 3573 líneas en 21 módulos
- Sin cambios de comportamiento, sin nuevas dependencias

### Negativas
- HTTP requests adicionales (8 módulos nuevos) — aceptable en GitHub Pages con HTTP/2
- Complejidad de wiring ligeramente mayor (ctx objects) — compensada por la claridad

### Riesgos Mitigados
- Importaciones circulares: evitadas por el patrón ctx
- Regresiones: el código extraído mantiene la misma interfaz pública
- Event listeners: todos se registran dentro de `init()` después de `loadOcioPartials()`

## Estructura Final del Proyecto (solo JS)

```
js/
├── app.js                 ← orquestador (330 líneas, antes 1338)
├── constants.js           ← constantes compartidas (39)
├── sorting.js             ← funciones de ordenación (99)
├── search.js              ← búsqueda y alta (284)
├── modal-handlers.js      ← modales de detalle (199)
├── profile.js             ← perfil y estadísticas (237)
├── daily-check.js         ← comprobación diaria (161)
├── quick-actions.js       ← acciones rápidas (98)
├── notifications-setup.js ← wiring notificaciones (31)
├── ui.js                  ← renderizado DOM (1289, antes 1323)
├── db.js                  ← acceso a Firestore (148)
├── firebase.js            ← init de Firebase (67)
├── api-movies.js          ← API de TMDB (137)
├── api-books.js           ← APIs de libros (185)
├── tv-progress.js         ← lógica de progreso TV (115)
├── watch-log.js           ← historial visionados (25)
├── reading-log.js         ← historial lecturas (38)
├── dates.js               ← utilidades fecha (15)
├── http.js                ← fetch con reintento (25)
├── config.js              ← claves de API (33)
└── allowed-emails.js      ← lista de correos (18)
```
