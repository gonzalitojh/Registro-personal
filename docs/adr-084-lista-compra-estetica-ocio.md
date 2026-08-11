# ADR-084: Estética tipo Ocio de la pestaña de Lista de la compra — botones píldora y controles coherentes (issue #221)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #221 (type: style) pide adecuar la estética de la pestaña
**«Lista de la compra»** de la sección de Recetas (issue #64), y
especialmente sus botones, al resto de la web: el mismo lenguaje visual
tipo **Ocio** ya aplicado a las pestañas de Recetas, Ingredientes
(ADR-082, issue #218) y Menú (ADR-083, issue #220): botones
**píldora**, `btn--primary` para la acción principal, controles de
formulario uniformados, `:focus-visible` destacado y los cuatro modos
de tema.

Estado previo (construido en ADR-076, issue #64): la barra de
herramientas de la pestaña usaba `btn--small` para «+ Ítem extra»
(`#btn-add-extra-item`), sin jerarquía visual entre acciones; el
formulario de ítem extra (`.shopping-extra-form__row`) tenía inputs y
select **nativos sin estilizar** (`background: var(--ink)`, borde
`--paper-alpha-20` y `border-radius: var(--radius)` con esquinas
rectas) y sin `:focus-visible`; y el botón ✕ de quitar un ítem extra
(`.shopping-line__remove`) era un glifo suelto (`background: none;
border: none`) **sin presencia de píldora** ni hover legible.

Nota del flujo: la base de trabajo es la rama
`content/issue-64-seccion-recetas`; la rama de trabajo se crea desde ahí
y la PR va **también a esa rama, no a `dev`** — excepción puntual a la
regla de PRs contra `dev` de AGENTS.md §1, pedida explícitamente por el
usuario en la issue (patrón de las PR #222/#219/#214). Además, la PR
#222 de la issue #220 está **abierta contra la misma base** y define la
clase `.btn--pill` (y reestiliza `.menu-*`/`.menu-week-label`): este
ADR evita reutilizarla para no crear conflicto de fusión, y salta el
número 083 en el nombre del ADR (ya ocupado por el ADR de esa PR) para
no colisionar cuando ambas se fusionen.

Decisiones clave del rediseño:

1. **Acción principal**: `#btn-add-extra-item` pasa de `btn btn--small`
   a `btn btn--primary btn--small`, replicando el patrón del «+ Añadir
   receta a la semana» de la issue #220.
2. **Botón secundario del form**: «Cancelar» pasa a
   `btn btn--small shopping-btn--ghost`; «Añadir» (primario) intacto.
   Sin cambios funcionales.
3. **Controles del formulario uniformados**: inputs/select del form de
   ítem extra a píldora (fondo `--ink-raised`, borde 1px
   `--paper-alpha-30`, radio 999px, padding 0.3rem 0.75rem, font-size
   0.85rem) + `:focus-visible` con outline 2px `--teal-reel`.
4. **✕ de quitar ítem extra**: presencia de píldora (borde
   `--paper-alpha-30`, radio 999px, padding 0.15rem 0.45rem, hover
   `--paper-alpha-10`); el color `--stamp` queda intacto.
5. **Cuatro temas**: overrides **agrupados** de la familia clara
   (light+white) para ghost y ✕ hover, override de negro puro solo para
   inputs/select del form (patrón `ingredient-modal__field`) y
   comentarios en el CSS que documentan por qué el negro puro **no**
   necesita override para ghost/✕ (patrón del comentario de la #220).

## Decisión

1. **CSS** (`css/styles.css`, todo en el bloque de la lista de la
   compra y en overrides propios, sin tocar `.btn--pill`/`.menu-*`/
   `.menu-week-label` que define o usa la PR #222): inputs/select de
   `.shopping-extra-form__row` a píldora + `:focus-visible` (outline
   2px `--teal-reel`); clase nueva `.shopping-btn--ghost` con las
   métricas píldora del ADR-083 (fondo `--ink-raised`, texto `--paper`,
   borde 1px `--paper-alpha-30`, radio 999px, padding 0.3rem 0.75rem,
   font-size 0.85rem; hover `--paper-alpha-10`) — **no reutiliza**
   `.btn--pill` porque la PR #222 aún abierta lo define, decisión
   documentada en comentario CSS; `.shopping-line__remove` (✕) con
   borde `--paper-alpha-30`, radio 999px, padding 0.15rem 0.45rem y
   hover `--paper-alpha-10`; overrides agrupados
   `[data-theme="light"]`+`[data-theme="white"]` en bloque propio (ghost
   → color `--ink` y hover `--ink-alpha-10`; ✕ hover →
   `--ink-alpha-10`), sin tocar el bloque agrupado de la #222; override
   `[data-theme="black"]` para inputs/select del form
   (`background: var(--ink)`, con comentario: la píldora base
   `--ink-raised` quedaría sin límite sobre el `--ink-raised` del
   formulario; patrón `ingredient-modal__field`) y comentarios que
   documentan por qué el negro puro no necesita override para
   ghost/✕ (la base ya es correcta sobre negro).
2. **HTML** (`index.html`): `#btn-add-extra-item` pasa de `btn
   btn--small` a `btn btn--primary btn--small`.
3. **JS** (`js/shopping-list.js`): el botón «Cancelar» del form de ítem
   extra (`renderExtraForm`) pasa a `btn btn--small
   shopping-btn--ghost`; «Añadir» (`btn--primary`) intacto. Sin cambios
   funcionales (cálculo, marcar comprado, añadir/quitar ítem extra y
   excluir recetas se mantienen).
4. **PWA**: bump de versión `20260911 → 20260913` en `index.html`
   (`?v=`), `js/config.js` (`APP_VERSION`) y `service-worker.js`
   (`STATIC_ASSETS`). Se evita `20260912`, ya usado por la PR #222.
5. **Manual de usuario**: sin cambios — precedente de la issue #220
   (ADR-083): la sección 8.4 describe solo funcionalidad (cálculo,
   marcar comprado, ítems extra, excluir recetas), no estética; el
   cambio es puramente visual de botones y controles y no altera nada a
   nivel de comportamiento.
6. **PR contra `content/issue-64-seccion-recetas`**: excepción puntual
   y explícita a la regla de AGENTS.md §1 (PRs siempre contra `dev`),
   solicitada por el usuario en la issue #221; la rama de trabajo
   `wip/issue-221` se creó a partir de esa base.

## Consecuencias

- **Positivas**: la pestaña «Lista de la compra» queda a la altura
  visual de Ocio y de las pestañas Recetas/Ingredientes/Menú; la
  jerarquía de acciones es legible (primary para «+ Ítem extra», ghost
  para «Cancelar», ✕ con presencia de píldora y hover); la clase
  `.shopping-btn--ghost` queda reutilizable para futuros controles de
  la sección; sin cambios de comportamiento (cálculo, marcar comprado,
  añadir/quitar ítem extra y excluir recetas se mantienen).
- **Neutras**: bump de versión PWA (invalida la caché de `20260911`
  para propagar el nuevo CSS); el label `#shopping-week-label`
  comparte la clase `.menu-week-label` con el menú, así que al
  fusionarse la PR #222 (que la reestiliza) mejora automáticamente sin
  tocar esta PR; la PR va contra `content/issue-64-seccion-recetas`
  como excepción explícita (no a `dev`); el ADR salta al número 084
  porque el 083 lo ocupa el ADR de la PR #222, aún abierta contra la
  misma base.
- **Negativas**: ninguna conocida. La funcionalidad queda intacta. QA
  PASS: lenguaje visual coherente, cuatro modos de tema con contraste
  WCAG AA y responsividad en 360 / 768 / 1280 px sin scroll horizontal
  a nivel de página; observaciones no bloqueantes documentadas: los
  bordes de 1px de las píldoras quedan por debajo del 3:1 exigido para
  componentes gráficos (mandatado por la spec de la píldora del
  ADR-083, y mejora frente al estado base) y el glifo ✕ usa `--stamp`
  preexistente en la familia oscura (no introducido en este cambio).
  Seguridad PASS: cambios 100 % presentacionales, `escapeHtml` intacto
  y service worker solo con bump de versión.

Related issue: #221
