# ADR-026: Reglas generales del agente — AGENTS.md en la raíz y responsividad obligatoria

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

El agente libre de opencode (y cualquier agente que trabaje en el proyecto) no disponía de reglas fijas del proyecto: cada agente solo conocía las instrucciones de su propio archivo en `.opencode/agents/`, y el agente libre actuaba únicamente con la conversación del usuario. Esto generaba dos problemas:

1. **La responsividad no estaba garantizada**: la web debe verse correctamente en ordenador, tablet y móvil (cualquier ancho), sin desplazamiento horizontal a nivel de página ni texto fuera de pantalla, pero no existía ninguna regla que obligara a los agentes a verificarlo en cada tarea que toca HTML, CSS o UI.
2. **No había lugar para reglas generales**: no existía un archivo de reglas de proyecto cargado automáticamente por opencode; cualquier norma transversal (como la responsividad) tendría que repetirse manualmente en cada agente o en cada conversación, con riesgo de olvidos e inconsistencias.

El objetivo era crear un **lugar único y automático** para las reglas generales del proyecto, de forma que el agente libre y cualquier agente de opencode (subagentes, build/plan) las tuviera presentes SIEMPRE, en cualquier tarea, sin excepción.

Related issue: #19 — https://github.com/gonzalitojh/Registro-personal/issues/19

## Decisión

Crear `AGENTS.md` en la **raíz del proyecto** como archivo de reglas generales, con la sección `## Reglas generales` → `### 1. Responsividad obligatoria` como primera regla. opencode carga `AGENTS.md` automáticamente en el contexto de **todos** los agentes (libre, subagentes y build/plan), por lo que la regla aplica a cualquier tarea sin necesidad de invocar un agente concreto.

### 1. Regla general en `AGENTS.md` de la raíz

El archivo establece que TODO agente de opencode debe cumplir las reglas SIEMPRE, en cualquier tarea, sin excepción, y que si una tarea entra en conflicto con ellas, el agente debe detenerse y pedir confirmación al usuario antes de continuar.

La regla 1 («Responsividad obligatoria») define **4 criterios verificables**:

1. **Sin scroll horizontal a nivel de página** en ningún ancho; el scroll horizontal solo está permitido dentro de contenedores diseñados para ello (p. ej. tablas con `overflow-x: auto`).
2. **Ningún texto fuera de pantalla**: títulos, fechas, nombres de autores y sinopsis largas deben ajustarse a su contenedor (`overflow-wrap: break-word`, `min-width: 0` en hijos de flex/grid, unidades relativas). No se trunca contenido esencial con ellipsis en móvil.
3. **Unidades relativas** (%, rem, em, fr, vw/vh, `minmax()`) para anchos, columnas y tipografía de cuerpo; evitar `px` fijos en contenedores de ancho completo.
4. **Prohibido `overflow-x: hidden` en `body`/`html` como parche**: enmascara el desbordamiento y puede cortar contenido; siempre se corrige la causa raíz.

Además incluye la **verificación obligatoria** para tareas que toquen HTML, CSS o UI:

1. Probar en al menos tres anchos: **~360 px (móvil), ~768 px (tablet) y ~1280 px (ordenador)**, con el modo dispositivo de DevTools.
2. Confirmar que no hay scroll horizontal: `document.documentElement.scrollWidth <= window.innerWidth` en consola (debe ser `true`).
3. Probar con contenido largo realista: títulos largos, fechas, URLs o palabras sin espacios.

### 2. Refuerzo en `qa-reviewer.md`

Se añadió la sección `## Reglas generales del proyecto` en `.opencode/agents/qa-reviewer.md`: cuando la tarea toque HTML, CSS o UI, el revisor QA debe verificar además la regla de responsividad del `AGENTS.md` de la raíz (sin scroll horizontal ni texto fuera de pantalla en anchos de ~360 px, ~768 px y ~1280 px) y mencionar en su informe cualquier incumplimiento.

### 3. Alcance y documentación

- **Alcance estricto**: la primera versión de `AGENTS.md` contiene **solo** la regla de responsividad; no se añadieron otras normas para mantener el archivo acotado a la issue.
- **Sin referencia en README**: la existencia de las reglas no se documenta en el README; el ADR es la referencia suficiente.

## Alternativas descartadas

- **Incluir la regla en un agente concreto** (p. ej. `tdd-ddd-architect.md` o `sdd-master.md`): descartado — las instrucciones de un agente solo se cargan cuando ese agente se invoca; la regla no aplicaría al agente libre ni a build/plan, que son precisamente quienes más tareas de UI realizan.
- **Regla global en `~/.config/opencode`**: descartado — la configuración global es local a la máquina del usuario, no viaja con el repositorio ni la ven otros colaboradores, y no se versiona.
- **`.opencode/AGENTS.md`**: descartado — la carga de este archivo depende de la versión de opencode y está menos documentado que el `AGENTS.md` de la raíz, que es el mecanismo estándar.
- **`opencode.json` con `instructions`**: descartado — resuelve lo mismo con más complejidad de configuración (fichero JSON menos legible para reglas largas como la checklist de verificación).

## Consecuencias

### Positivas
- **La regla llega a todos los agentes**: cualquier agente de opencode que trabaje en el proyecto (libre, subagentes, build/plan) tiene presente la responsividad en cualquier tarea, sin depender de qué agente se invoque.
- **Lugar único y versionado para reglas generales**: las futuras reglas generales se añadirán como puntos numerados en la misma sección `## Reglas generales` del `AGENTS.md`.
- **Verificación objetiva en tareas UI**: la checklist (3 anchos, `scrollWidth <= innerWidth`, contenido largo realista) convierte la responsividad en un criterio comprobable, y el refuerzo en `qa-reviewer.md` hace que se valide también en la revisión QA.
- **Resuelto en la capa de configuración, no en código**: no hay cambios en HTML, CSS ni JS; la regla es preventiva (evita regresiones de responsividad en futuras tareas).

### Negativas
- **Nuevo archivo de configuración que mantener**: `AGENTS.md` debe mantenerse coherente con el proyecto real; si la regla quedara obsoleta, habría que actualizarla (mitigado por la naturaleza general de la regla y porque el propio ADR documenta su propósito).

### Neutras
- **`AGENTS.md` complementa, no sustituye**: los agentes de `.opencode/agents/` conservan sus instrucciones específicas; el archivo raíz aporta la capa transversal que faltaba.
- **Alcance inicial limitado a responsividad**: el archivo está preparado para crecer con nuevos puntos numerados, pero la issue #19 solo añade la regla 1.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `AGENTS.md` | **Nuevo**: reglas generales del proyecto; sección `## Reglas generales` → `### 1. Responsividad obligatoria` con 4 criterios verificables y checklist de verificación para tareas UI (anchos ~360/~768/~1280 px, `scrollWidth <= innerWidth`, contenido largo realista) |
| `.opencode/agents/qa-reviewer.md` | Sección `## Reglas generales del proyecto`: el revisor QA verifica la regla de responsividad en tareas que toquen HTML, CSS o UI y lo reporta en su informe |
| `docs/adr-026-agent-rules.md` | **Nuevo**: este documento |

Related issue: #19 — https://github.com/gonzalitojh/Registro-personal/issues/19
