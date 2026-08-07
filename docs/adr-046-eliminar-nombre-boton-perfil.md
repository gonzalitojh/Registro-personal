# ADR-046: Eliminar el nombre de usuario del botón de perfil en todos los anchos de pantalla (issue #107)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

Desde el ADR-043 (issue #94), el botón de perfil
`#btn-open-profile` (`.user-badge__avatar-btn`) contenía la foto del
usuario (`<img id="user-avatar" class="user-badge__avatar">`) **y** el
nombre (`<span id="user-name" class="user-badge__name">`) como una única
zona clicable. En móvil (<520 px) el nombre quedaba oculto con
`display: none` (solo foto); en tablet y PC (≥520 px, `@media
(min-width: 520px)`) se mostraba junto a la foto, dentro del botón.

La issue #107 pide eliminar el nombre del botón de acceso al perfil en
**todos** los anchos de pantalla: el usuario quiere que el botón muestre
**únicamente la foto**, sin el nombre, tanto en móvil como en tablet y
ordenador.

El comportamiento del menú (abrir/cerrar al pulsar, click-fuera para
cerrar) se gestiona desde `js/profile.js`, que usa
`document.getElementById("btn-open-profile")` y
`document.querySelector(".profile-menu-wrap")`: selectores por
id/clase **independientes del contenido interno del botón**, por lo que
la eliminación del `<span>` no afecta a esa lógica.

Related issue: #107 — https://github.com/gonzalitojh/Registro-personal/issues/107

## Decisión

Eliminar por completo el nombre de usuario del botón de perfil en todos
los anchos: quitar el `<span id="user-name">` del HTML, eliminar todas
sus referencias en JS, limpiar las reglas CSS que ya no tienen sentido y
actualizar el manual de usuario. El botón queda reducido a la foto, como
ya ocurría en móvil.

### 1. HTML: se elimina el `<span id="user-name">` del botón

`index.html`, dentro de `#btn-open-profile`:

- Se **elimina** el `<span id="user-name" class="user-badge__name">` que
  quedaba tras el `<img id="user-avatar" class="user-badge__avatar">`.
- El botón conserva **solo** el `<img>` (como antes del ADR-043).

Los atributos del botón no cambian: `aria-label="Abrir menú de perfil"`,
`aria-haspopup="menu"`, `aria-expanded` y `aria-controls` se conservan
(el botón sigue teniendo su etiqueta accesible propia; el nombre ya no
es texto visible del botón).

### 2. JS: se elimina la línea que rellenaba el nombre

`js/ui.js`, en `showApp(user)`:

- Se **elimina** la línea
  `document.getElementById("user-name").textContent = ...` (ya no existe
  el elemento al que asignar el nombre).

El resto de `showApp` no cambia: sigue asignando la foto con
`document.getElementById("user-avatar").src = user.photoURL || PLACEHOLDER_COVER`.

### 3. CSS: se eliminan las reglas del nombre y se simplifica el botón

`css/styles.css`:

- **Se elimina** la regla base `.user-badge__name` (móvil, con el
  `display: none` y el `min-width: 0`/`line-height: normal` añadidos en
  el ADR-043).
- **Se elimina** la regla `.user-badge__name` del
  `@media (min-width: 520px)` (la que mostraba el nombre con ellipsis
  junto a la foto en tablet/PC).
- **Se elimina** el comentario obsoleto que mencionaba el
  `.user-badge__name`.
- **Se simplifica** `.user-badge__avatar-btn`: se eliminan `gap: 0.6rem`,
  `min-width: 0` y `max-width: 100%`, propiedades que solo servían para
  acomodar el texto del nombre dentro del flex del botón. Se conserva el
  resto (`display: inline-flex; align-items: center; cursor: pointer`,
  además de `background: transparent; border: none; padding: 0`), que
  con un único hijo `<img>` se comporta igual que antes.

### 4. Manual de usuario actualizado

`docs/manual-de-usuario.md` (obligación de AGENTS.md: cambio visible
para el usuario):

- Sección 2 (acceso): «Para salir, pulsa **tu foto** (arriba a la
  derecha)…» (se elimina la mención al nombre).
- Sección 3 (pantalla principal): «**Tu foto**: pulsándola se abre un
  menú…» (se elimina «(y tu nombre, si se muestra)»).
- Sección 13 (tu perfil): «Pulsa **tu foto** (arriba a la derecha)…» +
  nota: «El botón muestra únicamente tu foto, sin tu nombre, en
  cualquier dispositivo (móvil, tablet u ordenador)» (sustituye a la
  nota anterior que explicaba que en tablet/PC también aparecía el
  nombre).

## Alternativas descartadas

- **Ocultar el nombre con `display: none` en todos los anchos,
  manteniendo el `<span>` y la línea de JS**: descartado — deja código
  muerto: el `<span>` y su asignación en `showApp(user)` seguirían en el
  DOM/código sin renderizarse nunca, y el texto del nombre se cargaría
  en el DOM inútilmente en cada inicio de sesión.
- **Mantener el `<span>` vacío por si acaso (sin JS)**: descartado — por
  la misma razón: un elemento que no se usa no aporta nada y obliga a
  mantener CSS (o reglas eliminadas) y marcado sin propósito; si en el
  futuro se quisiera volver a mostrar el nombre, recuperarlo desde git
  es trivial.

## Consecuencias

### Positivas

- **Botón compacto**: el botón de perfil queda reducido a la foto (32px)
  en todos los dispositivos; desaparece el texto y el `gap` que lo
  separaba de la imagen.
- **Menos espacio ocupado en la cabecera**: al no haber nombre, el botón
  no puede crecer con nombres largos y libera ancho en tablet/PC (la
  cabecera tiene anchos/alturas fijas, ADR-040); desaparece además la
  necesidad de ellipsis y de las salvaguardas `min-width: 0` /
  `max-width: 100%` que lo hacían posible.
- **Simetría con móvil**: el botón se ve idéntico en los tres anchos
  (360/768/1280 px), eliminando la diferencia de comportamiento visual
  entre móvil y tablet/PC que motivaba las notas del manual.
- **Código más limpio**: se eliminan el `<span>`, su asignación en JS y
  dos bloques de CSS (base + media query) junto con sus comentarios; no
  queda código muerto ni referencias a elementos inexistentes.
- **JS de menú intacto**: `js/profile.js` no se toca; los selectores por
  id/clase y el click-fuera (`profileMenuWrap.contains`) no dependen del
  contenido interno del botón.
- **Accesibilidad conservada**: sigue habiendo un único `<button>` con
  `aria-label`, `aria-haspopup`, `aria-expanded` y `aria-controls`;
  `cursor: pointer` explícito y estados de hover/focus coherentes con el
  resto de la UI.

### Negativas / Riesgos

- **El nombre ya no es visible en la cabecera** en tablet/PC: el usuario
  pierde esa referencia visual directa en esos anchos. Es el
  comportamiento solicitado explícitamente en la issue #107; el nombre
  sigue disponible dentro del menú de perfil (sección «Datos»).
- **ADR-043 queda parcialmente superado**: su parte del **nombre**
  (moverlo dentro del botón, estilos de flex y ellipsis) deja de aplicar;
  su parte del **botón/clic** (única zona clicable, atributos ARIA,
  gestión del menú) sigue plenamente vigente.

### Neutras

- **Sin bump de versión PWA**: el cambio se versionará junto al PR
  correspondiente (política de versionado de los ADRs previos: el bump
  acompaña al release/merge, no a este documento).
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambio visible al usuario): secciones 2, 3 y 13 reflejan que el botón
  muestra solo la foto en cualquier dispositivo.
- **Responsividad preservada**: al eliminar el texto no se introducen
  nuevos desbordamientos; el botón solo contiene la imagen, que ya tenía
  tamaño fijo y verificada en 360/768/1280 px.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: eliminado `<span id="user-name" class="user-badge__name">` de `#btn-open-profile`; el botón queda solo con `<img id="user-avatar" class="user-badge__avatar">`; atributos ARIA sin cambios |
| `js/ui.js` | **Modificado**: eliminada la línea `document.getElementById("user-name").textContent = ...` en `showApp(user)`; el resto de la función intacto |
| `css/styles.css` | **Modificado**: eliminadas las reglas `.user-badge__name` (base + `@media (min-width: 520px)`) y el comentario obsoleto; `.user-badge__avatar-btn` simplificado (eliminados `gap: 0.6rem`, `min-width: 0`, `max-width: 100%`) |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 2, 3 y 13 — «pulsa tu foto» (sin mención al nombre) + nota en la sección 13: el botón muestra únicamente la foto en cualquier dispositivo |
| `js/profile.js` | **Sin cambios** (selectores por id/clase y click-fuera independientes del contenido del botón) |
| `docs/adr-046-eliminar-nombre-boton-perfil.md` | **Nuevo**: este documento |

Related issue: #107 — https://github.com/gonzalitojh/Registro-personal/issues/107
