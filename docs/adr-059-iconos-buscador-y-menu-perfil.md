# ADR-059: Iconos en el buscador global y en el menú de perfil (issue #134)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #134 (type: style) pide dos mejoras visuales relacionadas con
los iconos:

1. **Menú desplegable del perfil**: el dropdown (`#profile-dropdown`,
   `index.html`) tenía 4 entradas de sección (Estadísticas, Amigos,
   Actividad, Ajustes) + Cerrar sesión, **todas sin icono**.
2. **Buscador global**: la barra superior (`#global-search-results`,
   `js/global-search.js`) usaba **emojis** 📺/🎬/📚 para los tipos de
   medio en los títulos de grupo («Catálogo · X» y resultados de
   colección), y los botones de tipo (Serie/Película/Libro) no tenían
   icono. En cambio, las **pestañas** (`index.html`,
   `.tab--tv`/`.tab--movies`/`.tab--books`) ya usaban **SVGs inline**
   con su color de acento (`--teal-reel` series, `--stamp` películas,
   `--ochre-spine` libros).

La issue pide: (a) un icono sencillo en cada sección del dropdown del
perfil; (b) que los iconos de series/películas/libros de la búsqueda
sean **los mismos que los de las pestañas** y usen también **su color**.

La implementación está validada (QA PASS, 6/6 criterios) y escaneada
(seguridad PASS, 0 hallazgos); el manual de usuario se actualizó en la
misma tarea (regla 3 de AGENTS.md). Este ADR documenta la decisión a
posteriori.

Related issue: #134 — https://github.com/gonzalitojh/Registro-personal/issues/134

## Decisión

Añadir iconos al menú de perfil y unificar la iconografía del buscador
global con la de las pestañas (mismos SVGs, mismos colores de acento).

### 1. `js/constants.js`: fuente canónica `MEDIA_ICONS`

Nuevo export:

```js
export const MEDIA_ICONS = { tv, movies, books }
```

- Los SVGs se copian **verbatim** de las pestañas de `index.html`
  (`.tab--tv` / `.tab--movies` / `.tab--books`).
- La fuente canónica queda **comentada en el propio archivo**: si
  cambian las pestañas, hay que actualizar `MEDIA_ICONS` (issue #134).

### 2. `js/global-search.js`: los emojis se sustituyen por los SVGs

- `import { MEDIA_ICONS } from "./constants.js"`.
- `GROUPS[].icon` y `groupIcons` usan los SVGs de `MEDIA_ICONS`; el
  grupo **amigos conserva el 👤** (no existe pestaña homóloga).
- `renderTypeButtons()` añade
  `<span class="global-search__type-icon" aria-hidden="true">` con el
  SVG + la clase modificadora `global-search__type-btn--<key>` por tipo.
- Los títulos de grupo llevan la clase `global-search__group-title--<key>`
  (solo media; `friends` sin modificador) en `renderResults`,
  `renderExternalSection` y `externalSectionLoadingHtml`.

### 3. `index.html`: iconos en el menú desplegable del perfil

Los 5 items del dropdown (`#profile-dropdown`) incorporan un **SVG
feather inline** cada uno, dentro de un `span aria-hidden="true"`:

| Item | Icono feather |
|------|---------------|
| Estadísticas | `bar-chart-2` |
| Amigos | `users` |
| Actividad | `activity` (pulse) |
| Ajustes | el mismo engranaje que usa `js/sidebar.js` |
| Cerrar sesión | `log-out` |

Se conservan `role="menuitem"`, `data-section` e ids existentes
(`#btn-profile-logout`): el wiring de `js/profile.js` no cambia.

### 4. `css/styles.css`: flex en el dropdown y acento por tipo

- `.profile-dropdown__item`: `display:flex` + `gap: 0.6rem`; `svg`
  `1.05rem` con `color: currentColor` (el item de logout hereda
  `--stamp-dark`).
- `.global-search__type-btn`: `inline-flex` + `gap: 6px` + variable
  `--type-accent` por tipo (`--tv` → `--teal-reel`, `--movies` →
  `--stamp`, `--books` → `--ochre-spine`); el icono se colorea con el
  acento.
- `hover` e `is-active` usan `var(--type-accent)`; en `is-active` el
  `svg` pasa a `color: inherit` (evita acento-sobre-acento) y hay una
  **excepción** `.global-search__type-btn--books.is-active { color:
  var(--ink) }` por contraste de texto sobre fondo ocre.
- `.global-search__group-title svg`: `1rem`, coloreado con el acento
  por tipo.

### 5. Documentación, manual de usuario y PWA

- **Manual** (`docs/manual-de-usuario.md`): §7.2 (los resultados de la
  búsqueda se agrupan con los mismos iconos de las pestañas, cada uno
  en su color — series verde, películas rojo, libros ocre — y el icono
  👤 para amigos) y §13 (cada opción del menú de perfil lleva su
  icono).
- **Bump PWA** `20260831` → `20260832` (un bump por PR que toca
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260832` ×3) y `service-worker.js` (`?v=20260832` ×6), vía
  `scripts/bump-version.sh`.

### 6. Entrega

Rama `style/issue-134-iconos-desplegable-perfil` con 4 micro-commits:

- `1d668e5` feat: iconos de tipo en el buscador global con colores de
  pestaña (issue #134)
- `d3a68e1` feat: iconos en el menú desplegable del perfil (issue #134)
- `7aac898` style: acento por tipo en buscador y flex en items del menú
  de perfil (issue #134)
- `065e87a` chore: bump de versión PWA 20260832 y manual con iconos de
  buscador y menú (issue #134)

## Alternativas descartadas

- **Mantener los emojis 📺/🎬/📚 en la búsqueda**: descartado — la
  issue pide explícitamente los mismos iconos que las pestañas con su
  color; los emojis no pueden heredar el acento por tipo y rompen la
  coherencia visual con el resto de la interfaz.
- **Generar las pestañas por JS** (renderizar su markup desde
  `MEDIA_ICONS` para evitar la duplicación del SVG): descartado — scope
  creep: el patrón del repo es markup estático con SVG inline en
  `index.html`; el cambio se limita a documentar la fuente canónica en
  un comentario de `constants.js`.
- **Color fijo teal en los botones de tipo activos**: descartado —
  rompería la coherencia con el acento por tipo (cada medio tiene su
  color de pestaña); solo se acepta la excepción puntual de
  `books.is-active` con `var(--ink)` por contraste sobre el ocre.
- **Iconos en el feed de actividad de `js/ui.js`**: NO-GOAL declarado —
  los emojis de `eventIcon()` (`js/ui.js`, líneas 2085-2090: 🎬/📺/🏁/
  📖/📚/📌) pertenecen a otra feature (feed de actividad, ADR-015) y no
  se tocan; la issue #134 cubre solo el buscador y el menú de perfil.

## Consecuencias

### Positivas

- **Menú de perfil más reconocible**: cada sección (y Cerrar sesión)
  tiene su icono feather; la lectura del menú es más rápida.
- **Buscador coherente con las pestañas**: mismos SVGs y mismos acentos
  (`--teal-reel`/`--stamp`/`--ochre-spine`) en títulos de grupo y
  botones de tipo; se elimina la mezcla emojis/SVG.
- **Accesibilidad**: los iconos van en `span aria-hidden="true"` y los
  SVGs conservan su `aria-hidden` — no duplican el texto legible; el
  grupo amigos sigue identificado con 👤.
- **Wiring intacto**: `role`/`data-section`/ids del dropdown no
  cambian; `js/profile.js` no se toca.
- **Manual al día**: regla 3 de AGENTS.md cumplida en la misma tarea
  (§7.2 y §13).
- **QA y seguridad PASS antes de documentar**: la decisión está
  validada en la práctica (6/6 criterios, 0 hallazgos).

### Negativas / Riesgos

- **Markup SVG duplicado**: las pestañas en `index.html` y
  `MEDIA_ICONS` en `js/constants.js` son dos copias del mismo SVG.
  Riesgo de desincronización si cambian las pestañas; mitigado con el
  comentario de fuente canónica en `constants.js`.
- **Excepción de contraste ad-hoc**: `books.is-active` con `var(--ink)`
  es una regla puntual que habrá que revisar si cambia el acento ocre.
- **Cambio visual en la búsqueda**: quien reconocía los emojis de los
  grupos ve ahora iconos; mitigado con la actualización del manual
  (§7.2).

### Neutras

- **Bump PWA de rutina**: `20260831` → `20260832` siguiendo la práctica
  de un bump por PR (ADR-049), aplicado con `scripts/bump-version.sh`.
- **ADR históricos intactos**: los que mencionan emojis 📺🎬📚 (p. ej.
  `adr-038-barralateral-navegacion.md`) son registro histórico del
  estado previo y **no se modifican**.
- **Emojis del feed de actividad sin cambios**: `eventIcon()` de
  `js/ui.js` queda como estaba (feature aparte, NO-GOAL de esta issue).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/constants.js` | **Modificado**: nuevo export `MEDIA_ICONS = { tv, movies, books }` con los SVGs de las pestañas copiados verbatim de `index.html` (fuente canónica comentada en el propio archivo, issue #134) |
| `js/global-search.js` | **Modificado**: import de `MEDIA_ICONS`; `GROUPS[].icon` y `groupIcons` usan los SVGs (amigos conserva 👤); `renderTypeButtons()` añade `<span class="global-search__type-icon" aria-hidden="true">` + clase `global-search__type-btn--<key>`; títulos de grupo con `global-search__group-title--<key>` (solo media; friends sin modificador) en `renderResults`, `renderExternalSection` y `externalSectionLoadingHtml` |
| `index.html` | **Modificado**: los 5 items del dropdown del perfil con SVGs feather inline (Estadísticas=`bar-chart-2`, Amigos=`users`, Actividad=`activity`, Ajustes=el engranaje de `js/sidebar.js`, Cerrar sesión=`log-out`), cada uno en un `span aria-hidden`; conservados `role`/`data-section`/ids; bump `?v=20260831` → `?v=20260832` (×3) |
| `css/styles.css` | **Modificado**: `.profile-dropdown__item` flex + `gap: 0.6rem` + `svg` `1.05rem` `color: currentColor` (el logout hereda `--stamp-dark`); `.global-search__type-btn` inline-flex + `gap: 6px` + `--type-accent` por tipo (`--tv`→`--teal-reel`, `--movies`→`--stamp`, `--books`→`--ochre-spine`); icono coloreado con el acento; hover e is-active con `var(--type-accent)`; en is-active el svg usa `color: inherit` y excepción `--books.is-active { color: var(--ink) }`; `.global-search__group-title svg` `1rem` con acento por tipo |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260831` → `20260832` |
| `service-worker.js` | **Modificado**: bump `?v=20260831` → `?v=20260832` en los 6 assets versionados de `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modificado**: §7.2 (los resultados de la búsqueda se agrupan con los mismos iconos de las pestañas, cada uno en su color, y el 👤 para amigos) y §13 (cada opción del menú de perfil lleva su icono) — regla 3 de AGENTS.md |
| `docs/adr-059-iconos-buscador-y-menu-perfil.md` | **Nuevo**: este documento |

Related issue: #134 — https://github.com/gonzalitojh/Registro-personal/issues/134
