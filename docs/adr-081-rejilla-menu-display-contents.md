# ADR-081: Rejilla del menú semanal — wrappers de cabecera/filas con `display: contents` (issue #215)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #215 reporta que la pestaña «Menú» de la sección de Recetas
(issue #64) se ve muy mal: los elementos se superponen unos a otros.

**Causa raíz**: `renderMenuGrid()` en `js/menu.js` genera dentro de
`#menu-grid` un div `.menu-grid__head` (con las 4 celdas de cabecera:
Día, Desayuno, Comida, Cena) y 7 divs `.menu-grid__row` (cada uno con
una celda de día + 3 celdas de comida). El contenedor `.menu-grid` es
un grid de 4 columnas (`7.5rem repeat(3, minmax(170px, 1fr))`), pero
los wrappers `.menu-grid__head` / `.menu-grid__row` **no tenían
ninguna regla de colocación**: al ser los grid items directos, el
auto-placement los repartía uno por celda (cabecera → columna 1,
fila 1 → columna 2, fila 2 → columna 3, …) y cada wrapper apilaba sus
4 celdas dentro de una columna estrecha de 120–170 px, aplastando y
superponiendo todo el contenido.

La decisión fue tomada siguiendo el plan del task-architect; QA aprobó
todos los criterios y la revisión de seguridad quedó limpia. Es un
cambio exclusivamente de CSS: sin tocar HTML ni JS.

Related issue: #215 — https://github.com/gonzalitojh/Registro-personal/issues/215

## Decisión

Añadir en `css/styles.css`, justo después del bloque `.menu-grid`, la
regla:

```css
.menu-grid__head,
.menu-grid__row {
  display: contents;
}
```

Con `display: contents` los wrappers no generan caja: sus hijos
`.menu-grid__cell` pasan a ser los grid items directos de
`.menu-grid`, y el auto-placement los coloca de forma natural en 8
filas × 4 columnas (cabecera en la fila 1, cada día en su fila),
alineándose a las columnas definidas (`7.5rem` + 3 × `minmax(170px,
1fr)`). El `gap: 0.4rem`, el `overflow-x: auto` del contenedor
(scroll horizontal permitido solo dentro del grid, patrón de
AGENTS.md) y los overrides de tema existentes (que apuntan a las
celdas `--cell`, `--cell--head`, `--cell--day`, no a los wrappers)
siguen aplicando sin cambios.

## Alternativas descartadas

- **A1: `grid-column: 1 / -1` + `grid-template-columns: subgrid` en
  los wrappers**: descartado — más complejo, depende de `subgrid` y
  no aporta ventaja frente a `display: contents` (soportado en todos
  los navegadores modernos).
- **A2: cambiar el DOM en `js/menu.js`** (eliminar los wrappers y
  renderizar las celdas como hijos directos del grid): descartado —
  el DOM actual es correcto y los wrappers agrupan lógicamente las
  filas; tocar el JS añadía riesgo sin beneficio.

## Consecuencias

### Positivas
- **Vista correcta**: cabecera alineada con sus columnas y 7 filas de
  días alineadas; ningún elemento se superpone a otro.
- **Cero regresiones**: no se tocan JS ni HTML; los listeners del
  menú («+ Receta», ✕ de quitar, picker inline, navegación de
  semanas, comensales, recetas a la semana, exclusión de la lista de
  la compra) no dependen de la caja de los wrappers.
- **Responsividad intacta**: en móvil el grid hace scroll horizontal
  dentro de su contenedor (nunca a nivel de página), patrón ya
  documentado y permitido por AGENTS.md.

### Negativas
- Ninguna conocida. `display: contents` no introduce colores ni
  superficies nuevas, por lo que los cuatro modos de tema (Oscuro,
  Negro puro, Claro, Blanco puro) no requieren overrides adicionales.

Related issue: #215
