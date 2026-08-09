# ADR-061: Botón de volver del perfil como flecha hacia la izquierda (issue #157)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #157 (type: style) pide cambiar el botón de volver de la vista
de perfil: «Cambiar el botón de volver por una flecha hacia la izquierda
simplemente, sin recuadro ni palabra _volver_». El botón afectado es
`#btn-close-profile`, en la cabecera de la vista de perfil
(`#profile-view__header`, `index.html`), que tenía este marcado:

```html
<button type="button" class="btn btn--ghost" id="btn-close-profile">← Volver</button>
```

Tenía recuadro (clase `btn btn--ghost`, con borde redondeado) y la
palabra «Volver». La issue pide que quede **solo una flecha hacia la
izquierda, sin recuadro ni texto**.

Ya existía en el repo el patrón **`.icon-btn`**: botón de icono
transparente sin recuadro, con SVG de trazo `currentColor` de ~1.15rem
(`.icon-btn svg`) y `:focus-visible` con outline `--teal-reel`, usado en
la cabecera para la hamburguesa `#btn-sidebar-toggle` y la campana
`#btn-notifications`. En tema claro, `[data-theme="light"] .icon-btn {
color: var(--ink) }` sobre el fondo `--paper-dim` de `.profile-view`
(contraste ~12.8:1, AA/AAA).

El botón `#btn-back-to-friends` («← Todos los amigos», clase `btn-link`)
**no dice "volver"** y ya carece de recuadro: queda **fuera del alcance**
de esta issue.

La implementación está **validada (QA 8/8 criterios PASS)** y
**escaneada (seguridad PASS, 0 hallazgos)**; el manual de usuario se
actualizó en la misma tarea (`docs/manual-de-usuario.md` §13, regla 3 de
AGENTS.md). Este ADR documenta la decisión a posteriori, como los
recientes (ADR-059, ADR-060).

Related issue: #157 — https://github.com/gonzalitojh/Registro-personal/issues/157

## Decisión

Sustituir el botón de texto con recuadro por un **botón de icono
reutilizando la clase `.icon-btn`** existente y el **SVG feather
`arrow-left`** (chevron hacia la izquierda, el mismo glifo visual que el
«←» que ya se mostraba), y eliminar la clase `.btn--ghost` como código
muerto.

### 1. `index.html`: marcado del botón

`#btn-close-profile` pasa de `btn btn--ghost` con texto a:

```html
<button type="button" class="icon-btn" id="btn-close-profile" aria-label="Volver">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
</button>
```

- **El `id` NO cambia**: el listener de `js/profile.js`
  (`getElementById("btn-close-profile")`) funciona igual; el wiring
  queda intacto.
- El botón lleva `aria-label="Volver"` y el SVG es `aria-hidden="true"`
  (no duplica texto legible): la accesibilidad se conserva.
- El destacado de foco viene heredado de `.icon-btn:focus-visible`
  (outline `--teal-reel`, 2px).

### 2. `css/styles.css`: eliminar `.btn--ghost` (código muerto)

Se eliminan **4 reglas**: `.btn--ghost` base
(`background: transparent; border-color: var(--paper-alpha-35)…`),
`.btn--ghost:hover` y las 2 del tema claro
(`[data-theme="light"] .btn--ghost` y su `:hover`). Su **único uso** en
el repo era ese botón; tras el cambio queda código muerto. La limpieza
sigue el precedente de **ADR-046** (eliminación de estilos huérfanos al
cambiar un botón). **No se añade CSS nuevo**: `.icon-btn` ya existía.

### 3. `js/profile.js`: sin cambios de lógica

Solo cambia un **comentario** («← Volver» → «Flecha de volver»); el
listener de `#btn-close-profile` (cierre de la vista con toggle manual
y vuelta a la última pestaña de Ocio activa) queda tal cual.

### 4. Bump PWA `20260833` → `20260834`

La PR toca assets versionados, así que se aplica la práctica de **un
bump por PR** (ADR-049/059) vía `scripts/bump-version.sh`:
`js/config.js` (`APP_VERSION = '20260834'`), `index.html` (`?v=` ×3:
`styles.css`, `ocio.css`, `app.js`) y `service-worker.js` (`?v=` ×6 en
`STATIC_ASSETS`).

### 5. Manual de usuario (§13)

`docs/manual-de-usuario.md` §13 añade la frase: «En la cabecera del
perfil, la flecha de la izquierda te devuelve a la última pestaña de
Ocio (Series, Películas o Libros) que tenías abierta.» — regla 3 de
AGENTS.md (cambio visible para el usuario documentado en la misma
tarea). Como el nombre del botón ya no es visible en la interfaz, el
manual es ahora la referencia explícita de su función.

### 6. `.gitignore`: artefactos CI

Se añaden `candidate.json` y `sdd_prompt.md` (artefactos untracked de la
sesión CI vía `scripts/gh-select-issue.sh`; hallazgo LOW del security
scan).

## Alternativas descartadas

- **Mantener `.btn--ghost` quitándole el borde** (sobreescribir el
  recuadro en ese botón): descartado — duplicaría a `.icon-btn` con una
  segunda clase de propósito idéntico (botón de icono transparente); lo
  coherente es reutilizar el patrón ya existente de la cabecera.
- **Usar el glifo «←» en un botón sin clase**: descartado — depende de
  la fuente del sistema (metrica y trazo variables) y es inconsistente
  con los SVGs de trazo (`stroke="currentColor"`, `stroke-width="1.8"`)
  que usan el resto de botones de icono de la interfaz.
- **Quitar el botón confiando en el botón «atrás» del navegador**:
  descartado — la lógica de `js/profile.js` hace un **toggle manual** de
  vistas que **no siempre cambia el hash**; el botón del navegador no
  garantiza cerrar la vista de perfil ni volver a la última pestaña de
  Ocio activa.
- **Conservar `.btn--ghost` "por si acaso"**: descartado — código muerto
  en producción (único uso eliminado); la limpieza sigue el precedente
  de ADR-046 y la clase es recuperable desde git si alguna vez se
  necesita.

## Consecuencias

### Positivas

- **Cabecera de perfil consistente con el header**: el botón de volver
  usa ahora el mismo `.icon-btn` que hamburguesa y campana; misma
  apariencia y mismo comportamiento (transparente, sin borde, SVG
  1.15rem, outline teal al enfocar).
- **Menos ruido visual**: desaparecen el recuadro redondeado y la
  palabra «Volver»; queda solo la flecha, como pide la issue.
- **Accesibilidad conservada**: `aria-label="Volver"` + SVG
  `aria-hidden="true"`; el `:focus-visible` de `.icon-btn` hereda el
  outline teal.
- **Wiring intacto**: el `id` no cambia; el listener de `js/profile.js`
  (por `getElementById`) funciona sin tocarse.
- **Contraste AA/AAA en ambos temas**: en tema claro `--ink` sobre
  `--paper-dim` (~12.8:1); en tema oscuro `--paper` sobre el fondo del
  perfil.
- **Deuda técnica saldada**: `.btn--ghost` muerto eliminado (precedente
  ADR-046) y artefactos CI añadidos a `.gitignore`.

### Negativas / Riesgos

- **Área táctil pequeña**: el botón mide ~28px (SVG 1.15rem + `padding:
  0.3rem`), por debajo del objetivo de 44px de WCAG 2.5.8. **Aceptada**
  por consistencia con los `.icon-btn` existentes de la cabecera (mismo
  patrón); si en el futuro se endurece el criterio, habrá que ampliarlo
  para todos.
- **La palabra «volver» ya no es visible**: el texto desaparece de la
  interfaz; mitigado con el `aria-label` del botón y documentado en el
  manual (§13), que explica qué hace la flecha.
- **Eliminación de `.btn--ghost`**: si un botón futuro necesita ese
  estilo habrá que recrearlo — recuperable desde git (ADR-046 idéntico).

### Neutras

- **Bump PWA de rutina**: `20260833` → `20260834`, un bump por PR
  (ADR-049/059), aplicado con `scripts/bump-version.sh`.
- **ADR históricos intactos**: ADR-043 (botón de perfil) y ADR-046
  (eliminación del nombre del botón) documentan el estado previo y **no
  se modifican**.
- **`.gitignore` ampliado**: `candidate.json` y `sdd_prompt.md` quedan
  protegidos de un `git add -A` manual.
- **`#btn-back-to-friends` sin cambios**: «← Todos los amigos»
  (`btn-link`) queda fuera del alcance, tal como delimita la issue.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: `#btn-close-profile` pasa de `<button class="btn btn--ghost">← Volver</button>` a `<button class="icon-btn" aria-label="Volver">` con SVG feather `arrow-left` (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="1.8"`, `aria-hidden="true"`, polyline `15 18 9 12 15 6`); el `id` no cambia; bump `?v=20260833` → `?v=20260834` (×3) |
| `css/styles.css` | **Modificado**: eliminadas 4 reglas de `.btn--ghost` (base, `:hover` y las 2 del tema claro) — código muerto tras el cambio, único uso era ese botón (precedente ADR-046); sin CSS nuevo (se reutiliza `.icon-btn`) |
| `js/profile.js` | **Modificado**: solo un comentario («← Volver» → «Flecha de volver»); el listener de `#btn-close-profile` queda intacto |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260833` → `20260834` |
| `service-worker.js` | **Modificado**: bump `?v=20260833` → `?v=20260834` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modificado**: §13 añadida la frase de la flecha de la cabecera del perfil (devuelve a la última pestaña de Ocio abierta) — regla 3 de AGENTS.md |
| `.gitignore` | **Modificado**: añadidos `candidate.json` y `sdd_prompt.md` (artefactos untracked de la sesión CI, hallazgo LOW del security scan) |
| `docs/adr-061-boton-volver-perfil-flecha.md` | **Nuevo**: este documento |

Related issue: #157 — https://github.com/gonzalitojh/Registro-personal/issues/157