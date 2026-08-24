# ADR-116: Ajustes en ventana de actores — sin recuadro, biografía truncada con Leer más, filmografía en carrusel con expandir y búsqueda, edad calculada (issue #324)

## Estado

Aceptado

## Fecha

2026-08-24

## Contexto

La issue #324 pide cuatro ajustes sobre la **página de detalle de persona** creada en la issue #321 (ADR-115) y cuya base es la rama `feat/issue-201`:

1. La ventana de los actores no debe verse enmarcada en un recuadro.
2. La biografía debe leerse unas pocas líneas por defecto y, si se desea leer más, que haya un botón de **Leer más** que abra una ventana.
3. Las películas/series en las que ha participado la persona deben estar en **modo carrusel** (como las personas en las películas/series) y que se pueda **expandir permitiendo además la búsqueda**.
4. Bajo el nombre de la persona, donde pone la fecha de nacimiento, **calcular los años** (edad).

El punto de partida es la ficha enmarcada en `.item-view__card` (papel con sombra), biografía completa sin límite, filmografía en **lista vertical** (`person-credits__list` + `person-credit__btn` con poster 2.75rem) y línea de vida sin edad (`Nació el 09/06/1963 en ...`). La PR debe crearse contra `feat/issue-201`, no contra `dev` (instrucción explícita de la issue).

### Diagnóstico y alternativas

- **Sin recuadro**: tras ADR-103 la ficha de título ya va directa sobre el fondo de `.item-view` (oscuro/crema según familia) sin `.item-view__card`, con mejor contraste y menos ruido. Replicar ese patrón en la ficha de persona elimina el recuadro sin perder legibilidad: la página hereda el fondo de `.item-view` y los textos secundarios usan `--ink-soft` directo (AA 5.5–6.2:1 sobre `--ink`/`--paper-dim` en los 4 temas). Mantener los estados de carga/mensaje dentro de `.item-view__card` conserva el feedback sin romper el patrón.
- **Biografía**: dos alternativas evaluadas: (a) `<details>` nativo minimizado y (b) clamp + modal. El `<details>` mantiene todo en la misma página y es más ligero, pero la issue pide explícitamente **una ventana** al pulsar Leer más. Se elige (b) con `line-clamp: 4` y botón que abre `#person-bio-modal` (mismo armazón que `#cast-modal`), con focus trap, cierre por ✕/backdrop/Esc y restauración de foco. El botón solo se muestra cuando el texto es largo (>220 caracteres o `scrollHeight > clientHeight` tras el paint), evitando ruido en biografías cortas.
- **Filmografía en carrusel**: alternativa 1 — mantener lista vertical y añadir filtro; alternativa 2 — migrar a carrusel horizontal scroll contenido + ventana expandida con buscador. La 2 cumple el requisito «como las personas en las películas/series» y facilita la comparación visual: se elige un carrusel por sección (`Actuación` / `Equipo`) con tarjetas de 110px (poster 2/3 + título 2 líneas + año/personaje), scroll horizontal con `overscroll-behavior-x: contain`, y botón **Ver todo** que abre `#person-credits-modal` (cabecera + lupa + input + lista vertical filtrable). El filtrado es por `title` + `role` + `year` en `toLocaleLowerCase("es")`, con mensaje de sin resultados y `Esc` limpia la búsqueda.
- **Edad**: cálculo por calendario (año/mes/día), no solo diferencia de años. Si la persona está viva, edad actual contra hoy; si falleció, edad al fallecer. Protegido ante ISO inválida o fecha futura (devuelve null y no se muestra). Mostrar la edad entre paréntesis tras la fecha de nacimiento mantiene la línea compacta y legible.

## Decisión

1. **Sin recuadro**: `renderPerson()` deja de envolver en `<div class="item-view__card person-card">` y pasa a `<div class="person-page">` (contenedor transparente, `color: inherit`). `person-page` aporta solo layout; los bloques interiores (hero, bio, créditos, premios) usan el patrón de página sin tarjeta. Los estados transitorios (`renderLoading`, `renderMessage`) siguen usando `.item-view__card` para mantener el feedback visible. CSS: `.person-page { background: transparent }` y revisión de los overrides de contraste — el override oscuro `#5f5849` para textos sobre papel claro se acota a `.item-view__card`; la página sin recuadro restaura `var(--ink-soft)` en oscuro para el fondo tinta, y las tarjetas de carrusel sobre página oscura mantienen `#5f5849` al ser superficies claras.
2. **Biografía truncada + ventana**: `biographyHtml()` devuelve `<div class="person-bio-wrap"><p class="person-bio--clamp" id="person-bio-clamped">…</p><button …>Leer más</button></div>`; `.person-bio--clamp` usa `display: -webkit-box; -webkit-line-clamp: 4; overflow: hidden`. `wireBioModal()` evalúa tras el paint si `scrollHeight > clientHeight` o `full.length > 220` para mostrar el botón y cablea `openBioModal(fullText)` que llena `#person-bio-modal-content` con `<h3>Biografía</h3><p class="person-bio--full">…</p>`, abre el modal y activa `trapFocus`. Cierres: ✕, backdrop, Esc (prioridad sobre el goBack), y restauración de foco.
3. **Filmografía en carrusel + expandir con búsqueda**: `creditsSectionHtml()` pasa a cabecera + `.person-credits__scroll` (flex, gap 0.6rem, `overflow-x: auto`, `overscroll-behavior-x: contain`) con tarjetas `person-credit-card` (110px, `flex: 0 0 110px`, `background: var(--paper)`, hover `--paper-dim`, focus `--teal-reel`). La navegación delega en cada tarjeta (`data-credit-id/kind` → `navigate({section:"item", kind, externalId})`). El botón `Ver todo` abre `openCreditsModal({title, credits})` que pinta cabecera `cast-modal__header` + buscador `cast-modal__search` (lupa SVG + input `cast-modal__search-input` → reutiliza el contraste de `cast-modal.css` y el override claro/blanco) + `#person-credits-expanded-body` con `creditsExpandedListHtml()` (fila vertical `person-credit__btn` filtrada). Input `input` refiltra; `Esc` con texto limpia sin cerrar; `Esc` con vacío cierra el modal. La ventana usa `trapFocus` y restauración de foco, y la delegación del listado expandido navega a la ficha y cierra la ventana.
4. **Edad calculada**: nuevo `calcAge(birthIso, refIso)` con parsing `YYYY-MM-DD` y ajuste por mes/día; `lifeInfoHtml()` añade ` (${age} años)` tras la fecha de nacimiento (ref = `deathday` si existe, hoy si no). Si `calcAge` devuelve null (ISO inválida, edad fuera de rango), no se muestra paréntesis.
5. **Versión PWA**: `APP_VERSION` y `STATIC_ASSETS` suben a `20261015`; `js/person-page.js` ya estaba en `STATIC_ASSETS`. Los enlaces `css/styles.css` y `ocio/ocio.css` pasan a `?v=20261015`.

## Consecuencias

- La ficha de persona deja de mostrar un recuadro: mejor coherencia visual con la ficha de título (ADR-103) y menos ruido en los 4 temas. Los textos secundarios mantienen contraste AA sin overrides duplicados.
- La biografía es escaneable (4 líneas) y la lectura completa requiere un gesto explícito (Leer más → ventana), sin perder el contenido en la carga inicial.
- La filmografía es comparable de un vistazo en carrusel y sigue accesible en detalle con búsqueda (título/personaje/puesto/año), cubriendo desde actores prolíficos hasta fichas cortas.
- La edad se muestra sin mantenimiento manual y es consistente con la fecha de referencia (hoy o fallecimiento).
- El manual de usuario (sección 12) documenta el nuevo comportamiento.

Related issue: #324
