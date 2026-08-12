# ADR-077: Relanzamiento automático en fallo y cola de ejecuciones en auto-resolve-issues (issue #226)

## Estado
Aceptado

## Fecha
2026-08-12

## Contexto

El workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 y
ampliaciones ADR-050, ADR-054, ADR-055) resuelve automáticamente el backlog
de issues con label `ai`: selecciona la issue más prioritaria, lanza una
sesión headless de OpenCode (agente `sdd-master`, modelo free) que crea la
rama y la PR contra `dev`, y tras la sesión relanza el despliegue de Pages
(ADR-050).

La issue #226 reporta dos problemas del comportamiento actual:

1. **Un fallo de sesión deja la issue abandonada hasta un disparo manual**:
   en fallo (tokens del modelo free, watchdog del ADR-055, timeout), el paso
   «Rollback en fallo de sesión» devuelve la issue a la cola y comenta el
   motivo, pero **no relanza nada**: la issue queda en `status: todo` a la
   espera de un nuevo evento (issue abierta, comentario o `workflow_dispatch`
   manual). Si no llega ninguno, puede quedarse días sin procesar.
2. **Solo caben dos ejecuciones encoladas**: el concurrency group
   `sdd-auto-resolver` con `cancel-in-progress: false` permite 1 run en
   ejecución + 1 en cola; cuando llega una 3ª run, GitHub **cancela
   automáticamente** la run encolada anterior («Canceling since a higher
   priority waiting request exists»). En la práctica, si se abren N issues
   seguidas, solo 2 runs llegan a ejecutarse y el resto se pierden sin
   procesar (se observó en el propio run: la run de la issue #226 disparada
   por el evento `issues` quedó `cancelled` al entrar el dispatch manual en
   el grupo).

Hallazgos técnicos verificados:

- GitHub publicó (changelog 2026-05-07) **`queue: max`** en el concurrency:
  encola **hasta 100 runs por grupo** que se ejecutan **en orden**, sin
  cancelar las encoladas, cuando `cancel-in-progress` es `false` (o no está
  definido). Es exactamente la semántica «encolar varias ejecuciones, no
  solo dos».
- `gh workflow run` (y la API de `workflow_dispatch`) **rechaza inputs no
  declarados** en el workflow con HTTP 422 (`Unexpected inputs provided`).
  Por tanto, el relanzamiento necesita un input declarado (`retry`) y debe
  apuntar a un ref cuya versión del workflow lo declare: `--ref dev` (dev
  se actualiza antes que main al fusionar la PR; main solo tras la
  promoción).
- El mecanismo WIP del ADR-047 (sección 7-d, issue #128) ya conserva el
  progreso de una sesión fallida en `wip/issue-N` y lo restaura en la run
  siguiente (`wip-restore`): el relanzamiento reutiliza ese mecanismo tal
  cual, de modo que un reintento **continúa el trabajo**, no empieza de
  cero.
- Las runs canceladas **mientras están encoladas no ejecutan ningún paso**:
  desde dentro de un run en ejecución, un paso con `if: cancelled()` solo se
  ejecuta cuando se cancela el run en marcha, que con `queue: max` y
  `cancel-in-progress: false` solo puede hacer el usuario manualmente (GitHub
  ya no cancela runs encoladas). La cláusula «o es cancelado» del
  requerimiento (con su salvedad «siempre que no lo haya cancelado el
  usuario manualmente») queda resuelta por la **causa raíz**: con la cola
  nueva, las ejecuciones ya no se cancelan automáticamente.

## Decisión

**Dos cambios en `.github/workflows/auto-resolve-issues.yml`:**

### 1. Cola de ejecuciones: `queue: max` en el concurrency group

```yaml
concurrency:
  group: sdd-auto-resolver
  cancel-in-progress: false
  queue: max
```

- Hasta **100 runs encoladas** en el grupo; se ejecutan **en orden, una
  sesión a la vez** (se conserva el diseño «una sola sesión activa» de
  ADR-047; `cancel-in-progress: false` nunca mata una sesión activa).
- Las runs encoladas **ya no se cancelan** al llegar una nueva: N issues
  abiertas seguidas generan N runs que se procesan secuencialmente; cada
  run selecciona la issue más prioritaria en `status: todo` y la reclama a
  `in-progress` (paso «Reclamar», anti-race), así que cada una trabaja una
  issue distinta.
- La **cancelación manual** del usuario sigue siendo posible (cancela la
  run en marcha; la siguiente de la cola empieza). No hay relanzamiento en
  ese caso: ver punto 3.

### 2. Relanzamiento automático en fallo de sesión (con tope de reintentos)

Nuevo input interno `retry` (número, default 0) en `workflow_dispatch` y el
paso «Rollback en fallo de sesión» se sustituye por «Relanzar o devolver a
la cola en fallo de sesión» (`if: failure() && selected != 'NONE' &&
dry_run != 'true'`), best-effort, con dos ramas:

- **Quedan reintentos** (`retry + 1 <= MAX_RELAUNCHES`, con
  `MAX_RELAUNCHES = 2` → **3 intentos en total**):
  1. La issue **se mantiene en `status: in-progress`** (el relanzamiento la
     retoma vía dispatch con `issue_number`, que acepta cualquier status, y
     el selector no la vuelve a elegir mientras tanto).
  2. Se comenta en la issue el fallo con su motivo y el intento
     (`⚠️ La sesión automática de SDD falló. Motivo: ... Se relanza
     automáticamente (intento N de 3).`).
  3. Se relanza: `gh workflow run auto-resolve-issues.yml --ref dev
     -f issue_number=<N> -f retry=<N+1>`.
  4. La run relanzada entra en la cola del concurrency (si hay otras runs,
     espera su turno), restaura el progreso con `wip-restore` (issue #128)
     y recibe el prompt MODO ITERACIÓN (dispatch con `issue_number` →
     `resume=true`): reanuda el task file y actualiza la rama/PR existentes.
- **Reintentos agotados** (`retry + 1 > MAX_RELAUNCHES`): comportamiento
  previo — la issue vuelve a la cola (`status: todo`, o `prev_status` si es
  un estado significativo distinto de `in-progress`: `blocked`,
  `needs-review`…) con comentario indicando el agotamiento y el motivo.

Detalles de robustez:

- El input `retry` se **sanitiza** (solo dígitos) antes de usar; los fallos
  del propio paso son best-effort (`|| true`/`|| echo AVISO`): un fallo del
  dispatch nunca tiñe el run con un motivo falso.
- El `--ref dev` es deliberado y documentado en el YAML: el input `retry`
  solo existe en la versión nueva del workflow, y el dispatch API valida los
  inputs contra el ref indicado (HTTP 422 si el input no está declarado).
  Tras la promoción `dev → main`, el ref `dev` sigue siendo válido (dev
  tiene la versión nueva).
- El paso **no relanza si no hay `candidate.json`** (el fallo fue anterior a
  la selección: checkout/instalación) ni en runs `dry_run`.
- Orden de pasos intacto: sesión → `wip-save` (fallo) → relanzar/devolver a
  la cola (fallo) → dispatch de deploy (éxito) → resumen. Un fallo del paso
  de deploy **no** relanza la sesión (los pasos con `if: failure()` ya
  corrieron).

### 3. Cancelación: NO relanzar la cancelación manual

El requerimiento pide relanzar si el run «es cancelado, siempre que no lo
haya cancelado el usuario manualmente». Con `queue: max`:

- GitHub **ya no cancela runs encoladas** por prioridad (era la única
  cancelación automática relevante: la causa del «solo dos» y de la run
  `cancelled` observada).
- Una run en marcha solo se cancela manualmente (`cancel-in-progress:
  false` protege las activas). Un paso `if: cancelled()` en una run
  cancelada **mientras estaba encolada ni siquiera se ejecuta** (no hay
  job), así que relanzar desde `cancelled()` relanzaría exactamente las
  cancelaciones manuales que la issue excluye.

Por eso **no hay paso de relanzamiento por cancelación**: la cláusula queda
satisfecha por la causa raíz (ya no existen cancelaciones automáticas que
relanzar) y se evita el efecto adverso de relanzar una cancelación explícita
del usuario (que cancelaría también los reintentos del relanzamiento). Se
documenta en la cabecera del workflow y en este ADR.

## Alternativas descartadas

- **Quitar el concurrency group** (dejar que GitHub ejecute N runs en
  paralelo): descartado — pierde la garantía «una sesión a la vez» de
  ADR-047, multiplica el consumo del modelo free y reintroduce la carrera de
  selección (dos runs podrían elegir la misma issue antes de reclamarla).
- **Groups por issue** (`group: sdd-${{ inputs.issue_number }}`): descartado
  — no resuelve «encolar varias ejecuciones» del backlog global (el número
  de issue no se conoce en el evento `issues` hasta seleccionar) y añade
  complejidad sin beneficio frente a `queue: max`.
- **Relanzar con `gh workflow run` sin el input `retry`** (contar reintentos
  por otra vía, p. ej. labels `retry: N`): descartado — el input declarado
  es el mecanismo más simple y no contamina las labels de la issue.
- **Relanzar también en `if: cancelled()`**: descartado — con `queue: max`
  la cancelación de una run en marcha solo es manual (la única cancelación
  automática, la de runs encoladas, desaparece), y el requerimiento excluye
  explícitamente la cancelación manual.
- **Sin tope de reintentos (relanzar siempre)**: descartado — un fallo
  sistemático (p. ej. cuota del modelo agotada de verdad) lanzaría un bucle
  infinito de runs que consumen minutos de Actions; el tope de 2 reintentos
  (3 intentos) equilibra la recuperación real (con WIP, cada intento avanza)
  y el coste.

## Consecuencias

### Positivas

- **Un fallo ya no abandona la issue**: la sesión se relanza automáticamente
  sobre la misma issue hasta 3 intentos, y cada intento continúa el progreso
  guardado en `wip/issue-N` (issue #128) en vez de empezar de cero.
- **Cola real de ejecuciones**: N runs encoladas se procesan en orden, una
  sesión a la vez; ya no se pierden runs por la cancelación automática de la
  3ª en llegar (el problema que motivó la issue).
- **Trazabilidad**: cada fallo se comenta en la issue con motivo e intento;
  el agotamiento de reintentos devuelve la issue a la cola con comentario
  explícito.
- **La issue queda protegida durante los reintentos**: se mantiene en
  `in-progress`, así que el selector no la re-elige ni otra run la adopta
  mientras el relanzamiento hace cola.
- **Retrocompatible y best-effort**: si el dispatch del relanzamiento falla
  (permisos, red), el run no miente sobre el motivo; el flujo previo
  (devolver a la cola + comentario) sigue como última red.

### Negativas / Riesgos

- **Consumo de minutos de Actions en reintentos**: un fallo sistemático
  cuesta hasta 3 intentos × hasta 90 min; mitigado con el tope y con el
  hecho de que el watchdog del ADR-055 corta las sesiones estancadas.
- **`queue: max` depende de la disponibilidad de la función en GitHub**:
  publicada en GA (changelog 2026-05-07); si el plan del repositorio no la
  soportara, GitHub rechazaría el workflow al evaluarlo desde la rama por
  defecto (visible en el primer run tras la promoción). Riesgo asumido y
  fácil de revertir (quitar una línea).
- **El relanzamiento usa `--ref dev`**: si `dev` no contuviera la versión
  nueva del workflow en el momento del fallo (p. ej. fallo antes de
  fusionar), el dispatch sería rechazado (HTTP 422) y el paso avisaría
  (best-effort). Tras la fusión de esta PR, `dev` siempre tiene la versión
  nueva.
- **Posible doble procesamiento leve**: si entre el fallo y la ejecución del
  relanzamiento otra run encolada selecciona la misma issue (solo posible si
  la issue volvió a `todo` por una ruta previa a esta versión), el
  relanzamiento la retoma igualmente en modo iteración (actualiza la
  rama/PR existente, no duplica PRs). Caso improbable y sin consecuencias
  graves.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambio interno de
  infraestructura de CI, no visible para el usuario final de la web (regla
  3 de AGENTS.md; misma decisión que ADR-047, ADR-050).
- **README actualizado** (sección 6, punto 6): relanzamiento automático en
  fallo (hasta 2 reintentos) y cola de ejecuciones.
- **El resto del workflow no cambia**: selección, reclamación, WIP,
  iteración por comentario, dispatch de deploy y resumen quedan intactos.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: input `retry` en `workflow_dispatch` (número, default 0, sanitizado); concurrency con `queue: max` (comentario de la sección y de la cabecera actualizados con la cola y el relanzamiento); el paso «Rollback en fallo de sesión» se sustituye por «Relanzar o devolver a la cola en fallo de sesión» (best-effort: reintentos con `gh workflow run --ref dev -f issue_number -f retry`, issue mantenida en in-progress y comentario por intento; agotados → vuelve a la cola con `prev_status` y comentario; `MAX_RELAUNCHES=2`); log del reintento en el caso dispatch del paso candidato; eliminado el output `claim_owner` (ya no lo consume nadie) |
| `README.md` | **Modificado**: sección 6, punto 6 — relanzamiento automático en fallo de sesión (hasta 2 reintentos) y encolado de varias ejecuciones |
| `docs/adr-077-relanzamiento-y-cola-auto-resolve.md` | **Nuevo**: este documento |
| `tasks/task-issue-226.json` | Task file de la tarea (title/description, criterios de aceptación AC1–AC8, DoD y bloque `issue` con la issue #226) |

Related issue: #226 — https://github.com/gonzalitojh/Registro-personal/issues/226
