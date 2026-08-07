# ADR-043: Foto y nombre del usuario como una única zona clicable en el botón de perfil (issue #94)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

En la cabecera de la web, el botón de perfil
`#btn-open-profile` (`.user-badge__avatar-btn`) contenía **solo la foto**
del usuario (`<img id="user-avatar" class="user-badge__avatar">`). El
nombre del usuario (`<span id="user-name" class="user-badge__name">`)
vivía **fuera del botón**: era un hermano de `.profile-menu-wrap`, dentro
de `.user-badge`, de modo que en anchos ≥520 px (tablet y PC), donde el
CSS muestra el nombre junto a la foto (`@media (min-width: 520px)`), el
nombre era **texto inerte**: pulsarlo no abría el menú de perfil.

La issue #94 pedía que el nombre forme parte del botón: la zona clicable
debe abarcar la foto **y** el nombre completos en los dispositivos donde
el nombre se muestra, manteniendo el comportamiento actual en móvil
(<520 px, solo foto).

El comportamiento del menú (abrir/cerrar al pulsar, click-fuera para
cerrar) se gestiona desde `js/profile.js`:

- `document.getElementById("btn-open-profile")` para el botón y
  `document.querySelector(".profile-menu-wrap")` para el contenedor — los
  selectores por id/clase son **independientes de la posición del
  `<span>`** en el DOM.
- El click-fuera usa
  `!profileMenuWrap.contains(e.target)`: al mover el nombre **dentro**
  del botón (hijo de `.profile-menu-wrap`), pulsar el nombre pasa a
  considerarse «dentro» del menú, que es exactamente el objetivo (pulsar
  el nombre alterna el menú).

Related issue: #94 — https://github.com/gonzalitojh/Registro-personal/issues/94

## Decisión

Mover `#user-name` **dentro** de `#btn-open-profile`, inmediatamente
después del `<img>`, para que foto y nombre constituyan una **única zona
clicable** del botón de perfil. Ajustar el CSS del botón y del nombre
para que el flex del botón no rompa el layout ni el truncado con
ellipsis del nombre.

### 1. HTML: el nombre pasa a ser hijo del botón

`index.html`:

- Se **elimina** el `<span id="user-name" class="user-badge__name">` que
  estaba como hermano de `.profile-menu-wrap` (al final de `.user-badge`).
- Se **añade** el mismo `<span id="user-name" class="user-badge__name">`
  **dentro** de `#btn-open-profile`, justo tras el
  `<img id="user-avatar" class="user-badge__avatar">`.

Los atributos del botón no cambian: `aria-label="Abrir menú de perfil"`,
`aria-haspopup="menu"`, `aria-expanded` y `aria-controls` se conservan
(el botón sigue teniendo su etiqueta accesible propia; el nombre es texto
visible del botón, no su label).

### 2. CSS: `.user-badge__avatar-btn` pasa a flex inline

`css/styles.css`, en `.user-badge__avatar-btn`:

- **Se elimina** `line-height: 0` (estilo heredado de cuando el botón
  solo contenía la imagen; con texto dentro colapsaría la línea del
  nombre y lo cortaría).
- **Se añade**:

  ```css
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  min-width: 0;
  max-width: 100%;
  ```

  `inline-flex` + `align-items: center` alinea foto y nombre en una
  fila centrada verticalmente; `gap: 0.6rem` separa la foto del nombre;
  `cursor: pointer` mantiene el indicador clicable explícito del botón;
  `min-width: 0` y `max-width: 100%` son las reglas de responsividad de
  AGENTS.md: el botón puede encoger dentro del flex del header y el
  nombre truncar con ellipsis en vez de desbordar.

### 3. CSS: `.user-badge__name` con `line-height: normal` y `min-width: 0`

`css/styles.css`, en `.user-badge__name`:

- **`line-height: normal`**: evita que el texto quede cortado verticalmente
  dentro del flex del botón (el valor heredado `0` de la `line-height` que
  tenía el botón truncaría la caja de línea).
- **`min-width: 0`**: requisito del ellipsis dentro de un flex item: sin
  él, el texto no puede encoger por debajo de su contenido y el truncado
  (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` +
  `max-width: min(12rem, 30vw)` del `@media (min-width: 520px)`) no
  funcionaría.

El `display: none` base (móvil <520 px) se mantiene: en esos anchos el
nombre no se renderiza, **no genera flex item**, y por tanto no hay
espacio fantasma ni `gap` entre la foto y un elemento invisible.

### 4. Sin cambios en JS

`js/ui.js` y `js/profile.js` **no se tocan**: usan `getElementById` /
`querySelector` (posición independiente del `<span>`), y el click-fuera
de `js/profile.js`
(`profileMenuWrap.contains(e.target)`) gana la semántica deseada: al
estar el nombre dentro del botón (hijo de `.profile-menu-wrap`), pulsar
el nombre no dispara el click-fuera y el menú alterna como al pulsar la
foto.

### 5. Manual de usuario actualizado

`docs/manual-de-usuario.md` (obligación de AGENTS.md: cambio visible
para el usuario):

- Sección 2 (acceso): «Para salir, pulsa **tu foto o tu nombre** (arriba
  a la derecha)…».
- Sección 3 (pantalla principal): «**Tu foto (y tu nombre, si se
  muestra)**: pulsándolos se abre un menú…».
- Sección 13 (tu perfil): «Pulsa **tu foto o tu nombre** (arriba a la
  derecha)…» + nota aclaratoria: «En móvil solo se ve la foto; en tablet
  y ordenador también aparece tu nombre, y ambas cosas forman parte del
  mismo botón».

## Alternativas descartadas

- **No tocar el HTML y añadir el clic al nombre por JS** (listener
  propio sobre `#user-name`): descartado — duplicaría la gestión del
  menú (dos listeners, dos estados `aria-expanded` que sincronizar),
  rompería la accesibilidad (un clic «falso» fuera del botón no es
  activable por teclado ni anuncia el control) y no resolvería el
  click-fuera; el marcado correcto de un control único es un único
  `<button>`.
- **Envolver foto y nombre en un contenedor clicable aparte** (p. ej.
  un `div` con listener o un segundo botón): descartado — crearía una
  zona clicable duplicada, con el mismo problema de sincronización de
  estados y de accesibilidad que la opción anterior; además añadía un
  elemento sin rol semántico propio.
- **Mantener la estructura y agrandar solo la foto** (foto más grande
  como zona clicable implícita): descartado — no cumple el criterio de
  aceptación de la issue #94 (la zona debe abarcar foto **y** nombre
  completos) y desvirtuaría el diseño de la cabecera (ADR-040).
- **Dejar `line-height: 0` en el botón y compensar con `line-height`
  explícita en el `<span>`**: descartado — el valor `0` del botón se
  propaga a la caja de línea del span y lo corta (la caja de línea del
  hijo se resuelve contra la `line-height` del contenedor); eliminar la
  propiedad obsoleta del botón es más limpio y menos frágil que
  compensarla.

## Consecuencias

### Positivas

- **Zona clicable unificada**: en tablet/PC la foto **y** el nombre son
  una única zona clicable del botón de perfil; pulsar cualquiera de los
  dos abre/alterna el menú (criterio de aceptación 1 de la issue #94).
- **Móvil intacto**: en <520 px el nombre sigue oculto (`display:
  none`) y la foto es clicable exactamente igual que antes (criterio de
  aceptación 2); `display: none` no genera flex item, así que no hay
  gap fantasma entre la foto y un elemento invisible.
- **Accesibilidad conservada**: sigue habiendo un único `<button>` con
  `aria-label`, `aria-haspopup`, `aria-expanded` y `aria-controls`
  (criterio de aceptación 3); `cursor: pointer` explícito y estados de
  hover/focus coherentes con el resto de la UI.
- **Ellipsis preservado**: `min-width: 0` en el botón y en el nombre +
  `line-height: normal` mantienen el truncado de nombres largos
  (`nowrap` + `overflow: hidden` + `max-width: min(12rem, 30vw)` del
  media query ≥520 px) funcionando dentro del flex del botón, sin
  desbordar la cabecera de altura fija (ADR-040).
- **Sin cambios en JS**: `js/ui.js` y `js/profile.js` intactos; el
  click-fuera (`profileMenuWrap.contains`) pasa a cubrir el nombre por
  construcción del DOM, sin lógica nueva.
- **Responsividad verificada** según AGENTS.md: 360/768/1280 px sin
  scroll horizontal; unidades relativas, `min-width: 0` y `max-width:
  100%`, sin `overflow-x: hidden` como parche.

### Negativas / Riesgos

- **Ninguna funcional negativa identificada**: el cambio es aditivo
  sobre el área clicable existente; el único matiz es que pulsar el
  nombre ahora **alterna** el menú (antes no hacía nada), que es
  precisamente el comportamiento deseado.
- **La zona clicable del botón es más ancha en ≥520 px** (foto + nombre
  + gap): acota el espacio libre de la cabecera, que tiene altura y
  anchos fijos; mitigado con `max-width: 100%` y el ellipsis del nombre,
  que impide que el botón crezca indefinidamente con nombres largos.

### Neutras

- **Sin bump de versión PWA**: el cambio está en el working tree de la
  rama `fix/issue-94-boton-perfil` y se versionará junto al PR
  correspondiente (política de versionado de los ADRs previos: el bump
  acompaña al release/merge, no a este documento).
- **`docs/manual-de-usuario.md` actualizado** (obligación de AGENTS.md:
  cambio visible al usuario): secciones 2, 3 y 13 reflejan que se pulsa
  «tu foto o tu nombre».
- **ADR-040 sigue vigente**: la cabecera fija, la altura `--header-h` y
  el ellipsis del nombre que definió no cambian; este ADR solo modifica
  la **ubicación** del `<span>` del nombre (del contenedor `.user-badge`
  al interior del botón) y los estilos de flex asociados.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: `<span id="user-name" class="user-badge__name">` movido de hermano de `.profile-menu-wrap` a **hijo de `#btn-open-profile`** (tras el `<img id="user-avatar">`); atributos del botón sin cambios |
| `css/styles.css` | **Modificado**: `.user-badge__avatar-btn` — se elimina `line-height: 0` y se añade `display: inline-flex; align-items: center; gap: 0.6rem; cursor: pointer; min-width: 0; max-width: 100%`; `.user-badge__name` — se añaden `line-height: normal` y `min-width: 0` (el ellipsis del `@media (min-width: 520px)` se mantiene intacto) |
| `docs/manual-de-usuario.md` | **Modificado**: secciones 2, 3 y 13 — «tu foto o tu nombre» (con nota en la sección 13 de que en móvil solo se ve la foto y ambas cosas forman parte del mismo botón) |
| `js/ui.js` | **Sin cambios** (usa `getElementById`, posición independiente) |
| `js/profile.js` | **Sin cambios** (click-fuera con `profileMenuWrap.contains`; el nombre dentro del botón queda cubierto por construcción) |
| `docs/adr-043-boton-perfil.md` | **Nuevo**: este documento |

Related issue: #94 — https://github.com/gonzalitojh/Registro-personal/issues/94
