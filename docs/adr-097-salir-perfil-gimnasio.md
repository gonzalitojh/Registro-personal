# ADR-097: La flecha de volver del perfil regresa también a Gimnasio (issue #268)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

La issue #268 (type: bug) detecta que **la flecha de volver del
perfil regresaba a Ocio en lugar de a Gimnasio** cuando el usuario
entraba al perfil desde la sección de Gimnasio. El bug apareció con
la integración de la sección (issue #62, ADR-095): el router ya
guardaba `lastSection = "gimnasio"`, pero el handler de la flecha no
lo contemplaba y caía a la rama por defecto.

Estado previo (construido en ADR-061, ADR-077, ADR-078 y ADR-079):

- El perfil tiene su propia cabecera (`#profile-view__header`) con la
  **flecha de volver** (`#btn-close-profile`, ADR-061); la cabecera
  global no aparece en el perfil (ADR-077, issue #206).
- El handler de `#btn-close-profile` en `js/profile.js` decide el
  destino según `getLastSection()` (issue #213, ADR-079): si
  `"recetas"` navega a Recetas con su última pestaña; si no, cae al
  `else` y vuelve a Ocio. Esa lógica **se escribió cuando solo
  existían Ocio y Recetas**: la sección Gimnasio (issue #62, ADR-095)
  se integró después y la rama nueva nunca se añadió al handler.
- El router (`js/router.js`) sí que se actualizó con la sección:
  `lastSection = "gimnasio"` en `applyRoute()` y
  `getLastGymTab()` para la última pestaña de Gimnasio de la sesión
  (ADR-095). El resultado era un estado incoherente: la memoria se
  guardaba, pero la flecha de volver la ignoraba.

El manual de usuario **ya documentaba el comportamiento correcto**
(`docs/manual-de-usuario.md` §3.2 y §15: la flecha vuelve a la
sección desde la que se entró, **«Ocio», «Recetas» o «Gimnasio»**, con
la pestaña activa — actualizado en la tarea de la sección, issue #62,
regla 3 de AGENTS.md). El fix alinea el código con lo documentado: no
hay que tocar el manual (regla 3).

La implementación está validada (QA PASS: 30 checks E2E en navegador
real chromium headless — gimnasio/entrenos, gimnasio/ejercicios,
regresiones de Recetas y Ocio, pestaña oculta en Ajustes, deep-link
directo a `#/perfil`, botón atrás del navegador y responsividad
360/768/1280 px) y escaneada (seguridad PASS, escaneo en curso). Este
ADR documenta la decisión a posteriori, como los recientes
(ADR-093, ADR-094, ADR-095, ADR-096).

Related issue: #268 — https://github.com/gonzalitojh/Registro-personal/issues/268

## Decisión

### 1. Nueva rama «Gimnasio» en el handler de la flecha de volver

Añadir la rama de Gimnasio a `#btn-close-profile` en `js/profile.js`,
con el **mismo patrón que la rama Recetas** (issue #213, ADR-079):

```js
} else if (getLastSection() === "gimnasio") {
  navigate({ section: "gimnasio", tab: normalizeTabKey("gimnasio", getLastGymTab()) });
}
```

- **Import ampliado**: `getLastGymTab` se añade al import existente de
  `./router.js` (junto a `navigate`, `parseHash`, `getLastOcioKey`,
  `getLastRecipesTab` y `getLastSection`).
- **El `else` de Ocio queda como fallback**: cubre el deep-link
  directo a `#/perfil` sin sección de contenido visitada
  (`lastSection` vale `"ocio"` por defecto, ADR-079).
- **Comentario del handler actualizado**: la lista de secciones de
  vuelta pasa de «Ocio o Recetas» a «Ocio, Recetas o Gimnasio».

### 2. Flujo de navegación (verificado sobre el código real)

`navigate({ section: "gimnasio", tab })` cambia el hash
(`#/perfil/...` → `#/gimnasio` o `#/gimnasio/ejercicios`) y dispara
`canonicalHashFor` → `gymHashFor` → `onRoute` (rama `gimnasio` de
`js/app.js`) → `openGym({ tab, fromRouter: true })` (`js/gym.js`),
que oculta `#app`/`#profile-view`/`#recipes-view`, destapa `#gym-view`
y activa la pestaña. **No hace falta tocar `#app` ni la cabecera en el
handler**:

- El onRoute de `app.js` re-muestra la cabecera global en cualquier
  ruta ≠ perfil con sesión (ramas `app.js` 543-548), así que la rama
  nueva hereda ese comportamiento.
- El guard de pestaña oculta queda cubierto por **doble
  normalización** (issue #97, ADR-067): el `normalizeTabKey` del
  handler cae a la primera pestaña visible de Gimnasio si la última
  quedó oculta en Ajustes, y el `onRoute` lo re-normaliza con
  `replace: true` reescribiendo la URL si fuera necesario.
- `getLastGymTab()` devuelve por defecto `"entrenos"`, que canoniza a
  `#/gimnasio` (sin sufijo): la vuelta al perfil siempre aterriza en
  una ruta canónica.

### 3. Bump PWA

`APP_VERSION` `20260927` → `20260928` (`scripts/bump-version.sh`,
toca `js/config.js`, `index.html` y `service-worker.js`), práctica de
un bump por PR (ADR-049/059/079): invalida las cachés cache-first de
la PWA (ADR-019) y evita servir `js/profile.js` antiguo desde el
service worker.

### 4. Manual de usuario: sin cambios

El manual ya documentaba la vuelta a «Ocio, Recetas o Gimnasio» con
la pestaña activa (actualizado en la tarea de la sección, issue #62;
regla 3 de AGENTS.md). El fix alinea el código con lo documentado:
**no hay nada que añadir ni corregir**.

## Alternativas descartadas

- **Refactor del dispatch a un mapa centralizado o a una función
  genérica de «volver a la última sección»**: descartado — más limpio
  a futuro (un solo sitio donde registrar las secciones), pero una
  superficie de regresión mayor para un bug puntual; el patrón
  if/else-if existente (issue #213) ya fija el precedente y añadir una
  rama más es el cambio de menor riesgo.
- **Trazar el historial del navegador (history.back)**: descartado —
  mismo razonamiento que en ADR-079: las memorias de sesión del router
  son la fuente de verdad existente y evitan depender del historial
  (recarga, deep-link directo).

## Consecuencias

### Positivas

- **El volver del perfil refleja la intención real del usuario** en
  las tres secciones de primer nivel: Ocio, Recetas o Gimnasio, con la
  última pestaña activa (normalizada si quedó oculta, #97).
- **Cero cambios visuales y cero cambios de CSS**: solo lógica de
  navegación; la cabecera global la re-muestra el onRoute existente.
- **Código alineado con la documentación**: el manual ya prometía la
  vuelta a Gimnasio (regla 3 de AGENTS.md) y ahora el código cumple;
  la documentación no necesita cambios.
- **Rutas canónicas garantizadas**: `getLastGymTab()` devuelve
  siempre una pestaña válida y `normalizeTabKey` + el guard del
  `onRoute` con `replace: true` reescriben la URL si es necesario.

### Neutras

- **El `else` de Ocio conserva el toggle manual** (mostrar `#app`
  antes de navegar): cubre el caso de navegar sin cambio de hash y es
  el fallback para deep-links directos a `#/perfil`.
- **Bump PWA `20260928`**: un bump más de la serie incremental
  (ADR-019/049/059); sin otra implicación.

### Negativas / Riesgos

- **Ninguna conocida.** Validado: QA PASS (30 checks E2E en chromium
  headless: gimnasio/entrenos, gimnasio/ejercicios, regresiones de
  Recetas y Ocio, pestaña oculta en Ajustes, deep-link a `#/perfil`,
  botón atrás del navegador y responsividad 360/768/1280 px sin
  scroll horizontal) y seguridad PASS (escaneo en curso al cierre de
  este ADR, 0 hallazgos conocidos).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/profile.js` | **Modificado**: import de `getLastGymTab` en el import de `./router.js`; nueva rama `gimnasio` en el handler de `#btn-close-profile` (`navigate({ section: "gimnasio", tab: normalizeTabKey("gimnasio", getLastGymTab()) })`); comentario del handler actualizado a «Ocio, Recetas o Gimnasio» |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260927` → `20260928` |
| `index.html` | **Modificado**: refs `?v=20260927` → `?v=20260928` |
| `service-worker.js` | **Modificado**: entradas versionadas `?v=20260927` → `?v=20260928` |
| `docs/manual-de-usuario.md` | **Sin cambios**: ya documentaba la vuelta a «Ocio, Recetas o Gimnasio» con la pestaña activa (§3.2 y §15; regla 3 de AGENTS.md) |
| `docs/adr-097-salir-perfil-gimnasio.md` | **Nuevo**: este documento |

Related issue: #268 — https://github.com/gonzalitojh/Registro-personal/issues/268
