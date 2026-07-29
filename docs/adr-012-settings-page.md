# ADR-012: Página de ajustes con selector de tema y preferencias de notificación

## Estado
Aceptado

## Contexto
La aplicación había crecido significativamente en funcionalidad (películas,
series, libros, perfil, estadísticas, amigos, exportación de datos) pero
carecía de un punto centralizado donde el usuario pudiera configurar sus
preferencias. Hasta ahora:

- El **selector de tema** (oscuro/claro) existía como un botón en la
  cabecera, con persistencia en `localStorage` (clave `mi-registro-theme`),
  pero no había una interfaz de ajustes donde el usuario pudiera descubrir
  esta opción cómodamente.
- Las **notificaciones** se generaban automáticamente en la comprobación
  diaria (`daily-check.js`) sin que el usuario pudiera elegir qué tipo de
  notificaciones recibir.
- No existía un punto de entrada único para configurar preferencias de la
  aplicación.

Se necesitaba crear una página o sección de ajustes accesible desde la
interfaz que consolidara estas opciones y permitiera añadir más en el
futuro.

## Decisión
Crear una sección de **Ajustes** como una cuarta pestaña dentro de la
vista de perfil (`#profile-view`), junto a las existentes Estadísticas,
Amigos y Datos. Se añade un botón con icono de engranaje (⚙️) en la
cabecera para acceso directo.

### Arquitectura

La sección de ajustes se implementa como:

1. **Nuevo módulo `js/settings.js`**: Encapsula toda la lógica de
   gestión de ajustes: carga/guardado en `localStorage`, sincronización
   con Firestore, renderizado de la UI y conexión de eventos.

2. **Persistencia en dos capas**:
   - **localStorage** (inmediato): Los cambios se guardan al instante
     mediante `saveSettings()`, con merge profundo contra valores por
     defecto.
   - **Firestore** (diferido): Las preferencias de notificación se
     sincronizan con el perfil del usuario (`users/{uid}/preferences`)
     con un debounce de 2 segundos para evitar escrituras excesivas.
   - El tema se considera una preferencia de dispositivo (un usuario
     puede querer oscuro en el móvil y claro en el escritorio), por lo
     que **no** se sincroniza con Firestore, solo con localStorage.

3. **Flujo de datos**:
   ```
   Usuario cambia ajuste en UI
       │
       ▼
   settings.js: loadSettings() → modifica → saveSettings()
       │
       ├──▶ localStorage (inmediato)
       └──▶ Firestore vía upsertUserProfile (debounce 2s, solo notificaciones)
       
   daily-check.js: getNotificationPrefs() → lee de localStorage
       │
       └──▶ Antes de cada addNotification(), verifica que el tipo esté habilitado
   ```

4. **Sincronización bidireccional del tema**: Cuando el usuario cambia
   el tema desde el selector de ajustes o desde el botón de la cabecera,
   ambas fuentes se mantienen sincronizadas mediante `syncThemeToSettings()`
   y `syncThemeSelect()`.

### Ajustes incluidos

#### Apariencia
- **Tema**: Selector desplegable con opciones "Oscuro" y "Claro".
  Reutiliza el sistema de variables CSS existente (`:root` /
  `[data-theme="light"]`) y la función `setTheme()` de `app.js`.

#### Notificaciones
- **Estrenos de películas** (`movie_release`): Notifica cuando una
  película marcada como `awaitingRelease` se estrena.
- **Nuevos episodios de series** (`new_episode`): Notifica cuando hay
  un nuevo episodio disponible de una serie en emisión.
- **Estrenos de series** (`series_premiere`): Notifica cuando una serie
  marcada como `awaitingRelease` se estrena.
- **Actividad de amigos** (`friend_activity`): Preparado para uso futuro
  (cuando se implemente el feed de actividad de amigos). Actualmente es
  un no-op que no afecta a ninguna funcionalidad.

### Implementación técnica

#### `js/settings.js` (nuevo)
- `loadSettings()` / `saveSettings()`: Persistencia en localStorage con
  merge profundo contra defaults, con try/catch para manejo de errores.
- `renderSettings(ctx)`: Pinta el estado actual de los ajustes en la UI
  (select de tema, checkboxes de notificaciones).
- `setupSettings(ctx)`: Conecta los event listeners de los controles de
  ajustes. Cada handler lee los datos frescos de localStorage en lugar
  de usar closures para evitar datos obsoletos.
- `getNotificationPrefs()`: Exportada para que `daily-check.js` pueda
  leer las preferencias de notificación de forma síncrona.
- `syncThemeSelect(theme)` / `syncThemeToSettings(theme)`: Mantienen
  sincronizados el selector de tema de ajustes y la clave de localStorage
  del tema cuando se cambia desde el botón de la cabecera.
- `cleanupSettings()`: Limpia el temporizador de debounce al cerrar
  sesión, evitando escrituras tardías a Firestore.
- `scheduleFirestoreSync(ctx)`: Debounce de 2 segundos, lee ajustes
  frescos de localStorage y persiste solo `preferences.notifications`
  en Firestore.

#### `js/app.js` (modificado)
- Se añadió `setTheme` al objeto de contexto (`createCtx()`) para que
  `settings.js` pueda cambiar el tema mediante `ctx.setTheme()`.
- El botón `#btn-settings` abre la vista de perfil con la pestaña de
  ajustes activa.
- El manejador del toggle de tema (`#btn-theme-toggle`) ahora también
  llama a `syncThemeSelect(next)` y `syncThemeToSettings(next)`.
- En `init()`, tras restaurar el tema, se llama a
  `syncThemeToSettings(getSavedTheme())` para garantizar consistencia.
- Se llama a `cleanupSettings()` cuando el usuario cierra sesión.

#### `js/profile.js` (modificado)
- Se añadió la gestión de la sección `#profile-section-settings` en el
  manejador de pestañas, importando `renderSettings` para pintar los
  ajustes cuando se activa la pestaña.

#### `js/daily-check.js` (modificado)
- Se importa `getNotificationPrefs()` desde `settings.js`.
- Cada llamada a `addNotification()` se protege con una comprobación
  de la preferencia correspondiente (`prefs.movie_release !== false`,
  `prefs.series_premiere !== false`, `prefs.new_episode !== false`).

#### `index.html` (modificado)
- Botón `#btn-settings` con icono ⚙️ en la cabecera, junto al toggle
  de tema.
- Pestaña "Ajustes" en el perfil (`data-section="settings"`).
- Sección `#profile-section-settings` con:
  - Selector de tema (`#settings-theme-select`)
  - Cuatro interruptores de notificaciones con diseño toggle switch.

#### `css/styles.css` (modificado)
- Clases `.settings-card`, `.settings-row`, `.settings-desc`,
  `.settings-select` para el diseño de tarjetas de ajustes.
- Clases `.switch`, `.switch__input`, `.switch__slider` para
  interruptores de tipo toggle.
- Estilo para `#btn-settings` en la cabecera.

### Alternativas descartadas

- **Página separada (nueva vista)**: Se consideró crear una vista
  independiente como `#settings-view`, pero se optó por integrarla
  en el perfil existente para mantener la navegación simple y
  reutilizar el patrón de pestañas ya familiar para el usuario.
- **Modal de ajustes**: Se descartó por que los modales tienen
  espacio limitado y no son ideales para configuraciones que el
  usuario quiere consultar mientras navega.
- **Sincronizar tema a Firestore**: Se decidió no hacerlo porque
  el tema es una preferencia de dispositivo. Un usuario puede querer
  tema oscuro en el móvil y claro en el escritorio.
- **Usar solo Firestore sin localStorage**: Se descartó porque
  Firestore requiere conexión a internet y la carga es asíncrona.
  localStorage permite que los ajustes estén disponibles
  instantáneamente.

## Consecuencias

### Positivas
- El usuario tiene un lugar centralizado para configurar sus
  preferencias, descubrible desde un icono en la cabecera.
- Las notificaciones respetan las preferencias del usuario, reduciendo
  el ruido informativo.
- Los cambios se aplican inmediatamente sin recargar la página.
- La arquitectura es extensible: añadir un nuevo ajuste solo requiere
  añadir el control HTML, la clave en `DEFAULT_SETTINGS` y consumirla
  donde corresponda.
- El sistema de persistencia en dos capas (localStorage + Firestore)
  proporciona velocidad en local y respaldo en la nube para las
  preferencias de notificación.
- El debounce de 2 segundos evita escrituras excesivas a Firestore
  cuando el usuario ajusta varios controles rápidamente.

### Negativas
- Los ajustes de notificación solo se sincronizan desde localStorage
  a Firestore (no en sentido inverso). Si un usuario inicia sesión
  en un dispositivo nuevo, las preferencias se inicializan con los
  valores por defecto hasta que las modifique. Esto es un compromiso
  aceptable para mantener la simplicidad.
- La clave `mi-registro-settings` en localStorage duplica parte de
  la información ya almacenada en `mi-registro-theme`, aunque se
  mantienen sincronizadas mediante `syncThemeToSettings()`.

### Neutras
- La preferencia `friend_activity` no tiene efecto hasta que se
  implemente el feed de actividad de amigos. Está incluida para
  que la UI no requiera cambios en el futuro.
- Las preferencias de notificación se incluyen automáticamente en
  las exportaciones de copia de seguridad (al ser parte del perfil
  de usuario en Firestore).

## Archivos creados
- `js/settings.js` — Módulo de gestión de ajustes (179 líneas).

## Archivos modificados
- `index.html` — Botón de ajustes, pestaña y sección HTML de ajustes.
- `css/styles.css` — Estilos de tarjetas de ajustes, toggle switch.
- `js/app.js` — Import de settings.js, `setTheme` en ctx, botón de
  ajustes, sincronización de tema en toggle, cleanup en logout.
- `js/profile.js` — Gestión de pestaña de ajustes, import de
  `renderSettings`.
- `js/daily-check.js` — Import de `getNotificationPrefs`, guardas
  en notificaciones.
