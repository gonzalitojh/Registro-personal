# ADR-053: Cierre dirigido de issues al fusionar la PR en `dev` — rediseño de `issues-done-on-dev` (issue #143)

## Estado
Aceptado

## Fecha
2026-08-09

**SUPERA A**: ADR-034 y ADR-029 en lo relativo al **cierre de issues**: el cierre vuelve a ocurrir al fusionar la PR en `dev` (no en la promoción `dev` → `main`) y con alcance **dirigido** a la issue que la PR resuelve (no un barrido de `status: needs-review` ni la keyword del body). El esquema de labels `status: *` + label `ai` de ADR-034 permanece plenamente vigente.

**ERRATA DE IMPLEMENTACIÓN CORREGIDA (iteración)**: la PR #148 (implementación inicial) introdujo un bug en el script de `actions/github-script`: usaba `github.event.pull_request` y `core.getInput('issue_number')`, que en github-script NO existen — `github` es el cliente octokit (API REST) y el payload del evento se lee de `context.payload` (los inputs de `workflow_dispatch` viven en `context.payload.inputs`). Eso producía `TypeError: Cannot read properties of undefined (reading 'pull_request')` al fusionar PRs y un no-op con `''` en el dispatch manual. Corregido en la rama `fix/issue-143-context-payload-fix`: se lee `context.payload.pull_request` y `context.payload.inputs.issue_number`. El `if:` del job con `github.event.*` es correcto (sintaxis de expresiones GitHub Actions, distinta del objeto JS).

## Contexto

El workflow `.github/workflows/issues-done-on-dev.yml` gestionaba el cierre de issues con el esquema de labels `status: *` + `ai` (ADR-034), pero su diseño tenía dos problemas:

1. **Barrido no dirigido**: se disparaba con `push: branches: [dev]` y barría **TODAS** las issues con label `status: needs-review`, cerrándolas y marcándolas `status: done`. Al fusionar una PR en `dev`, ese push también cerraba las issues de **otras PRs pendientes de revisión**, adelantando su cierre y perdiendo el estado de revisión del backlog (residuo de la época en que el cierre ocurría sobre `main`).
2. **La instrucción "Closes #N" del body de las PRs nunca funcionó**: GitHub solo auto-cierra issues con keywords de cierre cuando la PR se fusiona en la **rama por defecto** del repositorio (`main`), y todas las PRs del flujo se fusionan contra `dev` (hallazgo documentado en ADR-029, issue #42: la PR #55 fusionada con "Closes #42" dejó la issue #42 abierta). Por tanto, **no se puede prescindir de un workflow**: el auto-close de GitHub no aplica a `dev`.

La issue #143 pide: al fusionar una PR en `dev`, **SOLO** la issue que esa PR resuelve debe cerrarse y marcarse `status: done`; si se puede sin workflow, eliminar `issues-done-on-dev`; y si se necesita action (se necesita), borrar la instrucción "Closes #N" de las PRs y modificar el workflow.

Related issue: #143 — https://github.com/gonzalitojh/Registro-personal/issues/143

## Decisión

Rediseñar el workflow `issues-done-on-dev.yml` como cierre **dirigido** por PR, eliminar la keyword "Closes #N" de todo el proceso de publicación y ajustar el fallback manual del Step 6 del master:

### 1. Workflow `issues-done-on-dev.yml` reescrito: cierre dirigido por PR

- **Trigger**: `pull_request: types: [closed]` con guard en el `if` del job (`merged == true`, `base.ref == 'dev'` y `head.repo.full_name == github.repository` — anti-forks, equivalente a `context.repo.full_name`) + `workflow_dispatch` con input opcional `issue_number` (modo reparación manual de una issue concreta; si el input no es numérico → no-op con `core.notice` y salida limpia).
- **Permisos mínimos**: `issues: write` (labels y cierre) y `pull-requests: read` (listFiles de la PR).
- **Identificación de las issues de la PR** (Set → deduplicación), en este orden:
  - (a) **Archivos de la PR**: `pulls.listFiles` paginado (`per_page: 100`) matcheando `tasks/task-issue-<N>.json` — la vía principal, porque el publisher sube el task file con un segundo commit a la rama de la PR.
  - (b) **Rama de la PR**: patrón `issue-<N>` / `task-<N>` en `pr.head.ref` (el publisher nombra las ramas `<tipo>/issue-<N>-<slug>`).
  - (c) **Keywords de cierre del body**: regex case-insensitive de las keywords oficiales, como compatibilidad con PRs manuales o iteraciones antiguas que aún las llevaran.
- **Procesamiento por issue** (best-effort: try/catch por issue; un fallo jamás rompe el run):
  - Salvaguarda anti-PR (`issue.pull_request` → se omite).
  - **Solo issues con marcador del agente**: label `ai` **o** alguna label `status: *`; las issues de usuario sin marcadores no se tocan.
  - Idempotencia: si la issue ya está cerrada con `status: done`, se omite.
  - Limpieza: `removeLabel` en try/catch para las `status: *` ≠ `status: done` y los residuales `ai-*` — **nunca `deleteLabel`** (borra la etiqueta del repo completo; ADR-052).
  - `addLabels` `status: done` y cierre de la issue si está abierta, ambos en try/catch con `core.warning` ante fallo.
- **Activación inmediata**: el trigger `pull_request: [closed]` usa el merge ref (base+head de la PR), por lo que corre la versión del workflow de la rama fusionada (`dev`): el nuevo comportamiento se activa en la siguiente fusión **sin esperar la promoción `dev` → `main`** (misma mecánica documentada en ADR-047).

### 2. Eliminación de "Closes #N" de todo el proceso de publicación

El cierre ya no depende de la keyword (que nunca funcionó sobre `dev`); lo aplica el workflow al fusionar. Se elimina la instrucción de escribir "Closes #N" en:

- `.opencode/agents/publisher.md`: el body de la PR comienza directamente con `## Summary`, sin keywords de cierre en ninguna parte (ni en iteraciones); el flag `no_closes` del task file queda como metadato informativo (trazabilidad de PRs anteriores) pero ya no condiciona nada.
- `.opencode/agents/sdd-master.md`: DoD y Step 5 (Publishing) sin keyword; Step 6 actualizado (ver punto 3).
- `.opencode/agents/qa-reviewer.md`: la transición a `status: done` + cierre la aplica el workflow al fusionar en `dev` (best-effort), ya no espera la promoción.
- `.github/workflows/auto-resolve-issues.yml`: los prompts de la sesión (modo normal e iteración) instruyen el body SIN keyword y explican que la issue se cierra al fusionar vía `issues-done-on-dev.yml`.
- `scripts/gh-issue.sh`: comentario de cabecera actualizado (la transición a `status: done` la aplica `issues-done-on-dev.yml` al fusionar la PR en `dev`).

### 3. Fallback manual del Step 6 del master: ya no espera la promoción

El fallback manual se basa ahora en el estado de la PR, no en la promoción `dev` → `main`:

- Se elimina el check `gh api repos/{owner}/{repo}/compare/main...dev --jq .status` (≠ `ahead`).
- Nueva condición: si la PR del bloque `pr` del task file está **MERGED** (`gh pr view <N_PR> --json state -q .state` → `"MERGED"`) y la issue sigue abierta o en `status: needs-review` (el workflow no corrió o falló), el master aplica manualmente: `set-state <N> "status: done"` + `gh issue close <N>` (best-effort) y task file → `"published"`.

## Alternativas descartadas

- **Prescindir del workflow (auto-close de GitHub con "Closes #N")**: descartado — imposible: GitHub solo auto-cierra issues cuando la PR se fusiona en la rama por defecto (`main`); todas las PRs se fusionan contra `dev` (demostrado con la issue #42, ADR-029). Por eso se conserva un workflow como fuente única de cierre.
- **Mantener el barrido de `status: needs-review` en el push a `dev`**: descartado — es el bug de la issue #143: cerraba también las issues de otras PRs pendientes de revisión; el usuario pidió cierre dirigido SOLO de la issue de la PR.
- **Cambiar la rama por defecto del repositorio a `dev`**: descartado — la rama por defecto (`main`) es la de producción y la que usa GitHub para el auto-cierre y para la versión de los workflows en eventos `issues`/`issue_comment` (ADR-047); cambiarla tendría efectos colaterales no deseados (el auto-close cerraría issues al fusionar en `main`, duplicando el mecanismo, y rompería la semántica de producción de `main`).
- **Workflow que cierra al fusionar en `dev` TODAS las issues de la PR con keyword + barrido**: descartado — la keyword no funciona sobre `dev` (es decorativa) y el barrido repite el bug; la identificación por task file/rama es la fiable.

## Consecuencias

### Positivas

- **Cierre dirigido**: al fusionar una PR en `dev` se procesan SOLO las issues que esa PR resuelve (task file, rama o body); el resto del backlog en `status: needs-review` permanece intacto.
- **Cierre inmediato sin esperar la promoción**: la issue se cierra y marca `status: done` en el momento de la fusión en `dev`, no cuando el usuario promueve `dev` → `main`; el estado «terminado» se refleja al instante.
- **Fuente única de cierre**: el workflow reemplaza a la keyword "Closes #N" (que nunca funcionó sobre `dev`); las guías y prompts ya no instruyen escribirla, eliminando la falsa expectativa del auto-close.
- **Robustez**: identificación multi-vía (task file → rama → body), deduplicación con `Set`, best-effort por issue con try/catch, idempotencia y salvaguarda anti-PR; el modo `workflow_dispatch` con `issue_number` permite reparar manualmente una issue concreta sin tocar las demás.
- **Técnica ADR-052 conservada**: `removeLabel` + try/catch (nunca `deleteLabel`) en la limpieza de labels.

### Negativas / Riesgos

- **Dependencia de GitHub Actions para el cierre**: si el workflow no corre o falla (p. ej. Actions deshabilitado, rate limit), la issue queda pendiente hasta la reconciliación del Step 6 (fallback manual del master, que ya no depende de la promoción).
- **Riesgo residual de issues sin identificar**: si una PR no incluye el task file ni matchea el patrón de rama `issue-<N>`/`task-<N>` ni lleva keyword en el body, la issue no se procesa (se registra en el log del run); es un caso límite de PRs manuales, mitigable con `workflow_dispatch` + `issue_number`.
- **Las keywords del body ya no cierran nada**: una PR manual creada con "Closes #N" ya no auto-cierra la issue; solo la procesa el workflow si la PR es del propio repo y se fusiona en `dev` (compatibilidad vía el punto (c) de identificación).

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambio interno de infraestructura de CI, no visible para el usuario final de la web (no aplica la regla 3 de AGENTS.md).
- **El esquema de labels `status: *` + `ai` no cambia**: sigue siendo el de ADR-034; solo cambia el momento (fusión en `dev`, no promoción) y el alcance (issue de la PR, no barrido) del cierre.
- **El flag `no_closes` del task file permanece como metadato**: histórico e informativo (trazabilidad de PRs anteriores), sin efecto sobre el publisher.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/issues-done-on-dev.yml` | **Reescrito**: trigger `pull_request: [closed]` con guard (`merged`, `base.ref == 'dev'`, anti-forks `head.repo.full_name == github.repository`) + `workflow_dispatch` con input `issue_number` opcional; permisos `issues: write` / `pull-requests: read`; identificación de issues por task file (listFiles paginado), rama `issue-N`/`task-N` y keywords del body; procesamiento dirigido por issue (salvaguarda anti-PR, solo labels `ai`/`status: *`, idempotencia, `removeLabel` + try/catch — nunca `deleteLabel`, `status: done` + cierre, best-effort) |
| `.opencode/agents/publisher.md` | **Modificado**: eliminada la instrucción "Closes #N" del body de la PR (empieza con `## Summary`); `no_closes` queda como metadato informativo sin efecto; el cierre lo aplica el workflow al fusionar en `dev` |
| `.opencode/agents/sdd-master.md` | **Modificado**: DoD y Step 5 sin keyword de cierre; Step 6: fallback manual si la PR del bloque `pr` está MERGED y la issue sigue abierta/`needs-review` (eliminado el check `compare/main...dev` de la promoción) |
| `.opencode/agents/qa-reviewer.md` | **Modificado**: transición a `status: done` + cierre aplicada por `issues-done-on-dev.yml` al fusionar en `dev` (best-effort, sin esperar la promoción) |
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: prompts de sesión (normal e iteración) sin "Closes #N" en el body de la PR; se explica que la issue se cierra al fusionar vía `issues-done-on-dev.yml` |
| `scripts/gh-issue.sh` | **Modificado**: comentario de cabecera actualizado (la transición a `status: done` + cierre la aplica `issues-done-on-dev.yml` al fusionar la PR en `dev`) |
| `tasks/task-issue-143.json` | Task file de esta tarea (bloque `issue` con la issue #143) |
| `docs/adr-053-issues-done-on-pr-merge.md` | **Nuevo**: este documento |
| `docs/adr-029-issue-done-on-merge.md` | Nota de superación/recuperación por este ADR |
| `docs/adr-034-status-labels-close-on-main.md` | Nota: el cierre ya no ocurre en la promoción, sino al fusionar cada PR en `dev` (este ADR) |
| `docs/adr-047-auto-resolve-issues.md` | Nota al final: el prompt ya no instruye "Closes #N" (este ADR) |
| `docs/adr-052-remove-label-vs-delete-label.md` | Nota: la técnica `removeLabel` + try/catch se conserva en el workflow rediseñado (este ADR) |
| `docs/adr-019-dev-branch-integration.md` | Nota: refutada la afirmación del auto-close de "Closes #N" en cualquier rama (ADR-029/este ADR) |
| `docs/adr-018-gh-issues-integration.md` | Nota existente ampliada: superación posterior del cierre por este ADR (cierre por merge a `dev`) |

Related issue: #143 — https://github.com/gonzalitojh/Registro-personal/issues/143
