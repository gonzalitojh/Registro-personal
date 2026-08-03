# ADR-007: Service Worker para PWA completa con soporte offline

## Estado
Aceptado

> **Nota (Agosto 2026):** este ADR describe la implementación original del
> service worker (cachés `mi-registro-v1-*`). La **estrategia de navegación**
> y el **flujo de actualización** (toast de "Nueva versión disponible" y
> registro manual del SW) quedan **superados por ADR-019** — *Estrategia de
> actualización de caché del service worker* (fix issue #25). Desde entonces,
> la navegación usa network-first con timeout (3 s), las actualizaciones se
> auto-aplican (`SKIP_WAITING`) sin toast, los assets llevan versionado
> `?v=`/`APP_VERSION` y las cachés pasaron a `mi-registro-v2-*`. El resto de
> estrategias de caché (cache-first para estáticos/CDNs/posters, network-first
> para APIs, network-only para escrituras y auth) siguen vigentes.

## Contexto
La aplicación "Mi Registro" ya contaba con un `manifest.json` que
definía los metadatos básicos para ser una Progressive Web App
(nombre, iconos, tema, `display: standalone`). Sin embargo, carecía
del **service worker**, que es el componente esencial que permite:

1. **"Añadir a pantalla de inicio"** en navegadores compatibles
   (Chrome, Edge, Safari, Samsung Internet). Sin service worker, el
   navegador no considera la app como instalable.
2. **Funcionamiento offline**: sin service worker, la aplicación
   requiere conexión a internet incluso para cargar su propio HTML,
   CSS y JavaScript.
3. **Actualizaciones controladas**: el service worker permite
   gestionar versiones de la aplicación sin interferir con la
   experiencia del usuario.

La aplicación se sirve desde la subruta `/Registro-personal/` en
GitHub Pages, y usa múltiples recursos externos: Firebase para
autenticación y base de datos, TMDB para datos de películas/series,
Google Books y Open Library para datos de libros, Google Fonts para
tipografía, y Chart.js CDN para estadísticas.

## Decisión
Implementar un service worker manual (sin librerías externas como
Workbox) con las siguientes estrategias de caché:

### Estrategias de caché

| Tipo de recurso | Ejemplos | Estrategia | Nombre de caché |
|---|---|---|---|
| **App shell (estáticos)** | HTML, CSS, JS, manifiesto, iconos, parciales HTML | Cache First | `mi-registro-v1-static` |
| **Google Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Cache First | `mi-registro-v1-static` |
| **CDN Librerías** | Chart.js, Firebase SDK (`www.gstatic.com`) | Cache First | `mi-registro-v1-static` |
| **Posters/portadas** | `image.tmdb.org`, `covers.openlibrary.org` | Cache First | `mi-registro-v1-static` |
| **APIs externas** | TMDB, Google Books, Open Library | Network First | `mi-registro-v1-dynamic` |
| **Firestore GET** | Lecturas de datos | Network First | `mi-registro-v1-dynamic` |
| **Firestore writes** | POST/PUT/DELETE a Firestore | Network Only | — |
| **Firebase Auth** | `identitytoolkit`, `securetoken` | Network Only | — |

### Arquitectura

```
service-worker.js              → Archivo clásico (no módulo) en la raíz
js/sw-register.js              → Módulo ES para registro y ciclo de vida
index.html                     → Importa sw-register.js y añade UI de actualización
manifest.json                  → Añadidos scope y description
```

### Flujo de instalación

1. El usuario visita la página.
2. `sw-register.js` registra `service-worker.js` con ámbito
   `/Registro-personal/`.
3. El evento `install` del SW precarga todos los recursos estáticos
   (30+ archivos) en la caché `mi-registro-v1-static`.
4. El evento `activate` limpia caches antiguas y toma control de
   todas las pestañas abiertas.

### Flujo de actualización

1. Cuando se despliega una nueva versión del SW, el nuevo worker se
   instala pero queda en estado `waiting` (porque el anterior aún
   controla la página).
2. `sw-register.js` detecta el cambio mediante el evento
   `updatefound` y la transición a `installed`.
3. Se dispara un evento personalizado `sw-update-ready`.
4. La página muestra un toast con el mensaje "Nueva versión
   disponible" y un botón "Actualizar".
5. Al hacer clic, se envía un mensaje `SKIP_WAITING` al SW en espera.
6. El SW activo llama a `self.skipWaiting()`, lo que dispara
   `controllerchange` en la página.
7. La página se recarga automáticamente con la nueva versión del SW
   al mando.

### Mecanismo de respaldo offline

- **Navegación**: Si una petición de navegación falla (usuario
  offline), se devuelve el `index.html` cachead.
- **APIs**: Si una llamada a API falla, se devuelve el resultado
  previamente cachead, o un JSON con error `503` si no hay caché.
- **Firestore en tiempo real**: las suscripciones `onSnapshot` usan
  WebSocket/gRPC, que no pasan por el SW. El SDK de Firebase maneja
  internamente la reconexión. Los mensajes de error existentes en
  `app.js` ya muestran toasts cuando falla la carga de datos.
- **Escrituras**: las mutaciones a Firestore (POST/PUT/DELETE) pasan
  sin intervención del SW, por lo que no se cachean accidentalmente.

### Limitación de caché dinámica
La caché dinámica (`mi-registro-v1-dynamic`) se limita a 50 entradas
para evitar que crezca sin control. Las entradas más antiguas se
eliminan automáticamente cuando se supera el límite.

### Alternativas descartadas

- **Workbox**: Librería de Google que simplifica la creación de
  service workers. Se descartó por mantener el proyecto libre de
  dependencias adicionales y porque la implementación manual es
  directa para este caso de uso.
- **Uso de `importScripts`**: No es necesario; toda la lógica del SW
  cabe en un único archivo.
- **Página offline dedicada (`offline.html`)**: Se decidió usar el
  propio `index.html` cacheado como fallback, ya que la app muestra
  la pantalla de login que es útil incluso sin conexión.
- **Cache de Firebase Auth**: Explícitamente excluido por seguridad
  (las credenciales de autenticación no deben cachearse).

## Consecuencias

### Positivas
- La aplicación es ahora una **PWA completa** y se puede "Añadir a
  pantalla de inicio" en dispositivos móviles y de escritorio.
- La **interfaz básica se carga offline**: el usuario ve al menos la
  pantalla de inicio de sesión aunque no tenga conexión.
- Los **recursos estáticos se cargan más rápido** en visitas
  sucesivas gracias a la caché local.
- Las **actualizaciones se gestionan de forma controlada**: el
  usuario decide cuándo aplicar una nueva versión mediante el toast
  de actualización.

### Negativas
- El service worker añade **complejidad al ciclo de desarrollo**: los
  cambios en recursos estáticos requieren cambiar el nombre de la
  caché (versión) para que los usuarios reciban la nueva versión.
- La **primera visita no tiene beneficio de caché**: el SW se instala
  de forma asíncrona y los recursos se cachean en segundo plano.
- Los **navegadores antiguos** (IE11, Safari antiguo) no soportan
  service workers, pero la aplicación sigue funcionando sin SW en
  estos navegadores (graceful degradation).

### Neutras
- El proyecto pasa de tener ~22 KB de JS a ~24 KB (se añade
  `sw-register.js`). El `service-worker.js` se descarga solo una vez
  y no se incluye en el bundle.
- Firebase `onSnapshot` (WebSocket/gRPC) no es interceptable por el
  SW; las suscripciones en tiempo real siguen funcionando igual que
  antes.

## Archivos creados/modificados
- `service-worker.js` — Nuevo: service worker principal con lógica de
  caché y estrategias de red (258 líneas).
- `js/sw-register.js` — Nuevo: módulo de registro y gestión del ciclo
  de vida del SW (80 líneas).
- `index.html` — Modificado: añadidos metadatos iOS PWA, toast de
  actualización del SW, y script de registro.
- `manifest.json` — Modificado: añadidos `description` y `scope`.
