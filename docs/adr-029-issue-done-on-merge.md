# ADR-029: Cierre automático de issues al fusionar la PR — workflow issue-done-on-merge y subida del task file al repositorio (issue #44)

## Estado
Aceptado

## Fecha
Agosto 2026

**NOTA — CONCEPTO RECUPERADO POR ADR-053 (issue #143)**: el ADR-053 recupera el concepto de este ADR (cierre de la issue al fusionar la PR) adaptado al esquema de labels `status: *` + label `ai` (ADR-034) y con alcance **dirigido**: al fusionar la PR en `dev` se cierra y marca `status: done` SOLO la issue que esa PR resuelve (identificada por su task file, su rama o keyword del body), sin el barrido de todas las issues en revisión. El cierre deja de esperar a la promoción `dev` → `main`.

**NOTA — SUPERADO EN LO RELATIVO AL ESQUEMA DE LABELS Y AL CIERRE**: este ADR queda superado por el ADR-034 (issue #74): el workflow `issue-done-on-merge.yml` queda eliminado y sustituido por `issues-done-on-main.yml`, que al promover `dev` a `main` cierra todas las issues en `status: needs-review` (no al fusionar la PR). El resto se conserva como registro histórico.

## Contexto

La issue #44 reporta tres problemas en la gestión de los cambios de estado de las tareas SDD:

1. **Task files no subidos al repo**: al publicar una tarea, el task file local (`tasks/task-issue-*.json`) cambia su `status` (p. ej. a `"review"` o `"published"`), pero el cambio nunca se sube al repositorio, porque el commit del publisher es anterior a esa actualización. Evidencia: `tasks/task-issue-42.json` quedó con `status: "review"` y el bloque `pr` (PR #55) sin commitear en el working tree.
2. **Transición a `ai-done` manual**: las issues se marcan `ai-needs-review` al crear la PR, pero pasarlas a `ai-done` requería intervención manual (la reconciliación del Step 6 al inicio de sesión).
3. **"Closes #N" se omitía a veces**: al iterar sobre una issue con varias PRs, alguna PR no incluía la keyword de cierre y la issue no se cerraba al resolverse.

**Hallazgo clave (causa raíz del problema 3)**: la rama por defecto del repositorio es `main`, pero TODAS las PRs se fusionan contra `dev`. GitHub solo auto-cierra issues con keywords de cierre ("Closes #N") cuando la PR se fusiona en la rama POR DEFECTO. Por eso la PR #55 (fusionada, con "Closes #42" como primera línea del body) dejó la issue #42 **OPEN** con `ai-needs-review`. El mecanismo de auto-cierre de GitHub nunca funcionó en este repositorio; el workflow de esta decisión pasa a ser el mecanismo fiable de cierre + label.

Related issue: #44 — https://github.com/gonzalitojh/Registro-personal/issues/44

## Decisión

### 1. Nuevo workflow `.github/workflows/issue-done-on-merge.yml` (GitHub Actions)

Al fusionar una PR cuyo body contiene keywords de cierre ("Closes #N", etc.), para cada issue referenciada que tenga alguna label `ai-*`: se eliminan las demás labels `ai-*`, se añade `ai-done` y se CIERRA la issue si está abierta (cierre imprescindible por el hallazgo del base `dev`). Detalles técnicos:

- **Trigger**: `pull_request: types: [closed]` con guard `if merged == true`, más respaldo `workflow_dispatch` con inputs `pr_number`/`pr_body` para pruebas manuales.
- **Implementación**: `actions/github-script@v7` (node script inline, sin binarios auxiliares).
- **Regex de keywords oficiales**: `\b(?:closes?|closed|fix(?:es|ed)?|resolves?|resolved)\s*:?\s*#(\d+)` — case-insensitive, dos puntos opcionales, números deduplicados (`Set`).
- **Solo issues con label `ai-*`**: las issues de usuario (sin ninguna label `ai-*`) no se tocan.
- **Guard de forks**: si `pr.head.repo.full_name !== context.repo.full_name`, se omite la actualización (PRs de fork no tocan issues del repo principal).
- **Permisos mínimos**: `issues: write`, `pull-requests: read`.
- **Best-effort**: cada issue se procesa en `try/catch`; un fallo emite `core.warning` y no rompe el resto (el merge ya ocurrió, no hay nada que bloquear).
- **Sin secrets y sin `pull_request_target`**: solo el `GITHUB_TOKEN` automático del workflow.

### 2. Publisher con segundo commit (subida del task file)

Tras crear la PR (y aplicar `set-state <N> ai-needs-review`), el publisher actualiza el task file local y lo sube:

- Actualiza `tasks/task-issue-<N>.json` con python3 **round-trip JSON preservando todos los campos**, incluidos los desconocidos (p. ej. `bump_pwa`): `"status"` → `"review"`, bloque `"pr"` `{number, url, title, branch, commit, closes}` (el campo `closes` solo si hay bloque `issue`), y el bloque `pr` anterior se guarda en `"previousPr"` en iteraciones (historial de un nivel).
- `git add tasks/task-issue-<N>.json` — SOLO el task file, nunca `git add .`.
- Commit `chore: task #<N> en revisión (PR #<N_PR>)` y push a la **misma rama**: la PR existente se actualiza sola con ese commit, sin recrearla.
- Guardas: si el task file no cambió se omite el commit/push; si el push falla por rama desactualizada, `git pull --rebase` (o `--force-with-lease` si el rebase arrastra basura del PR anterior).

### 3. "Closes #N" SIEMPRE

El publisher incluye la keyword como PRIMERA línea del body de la PR siempre que el task file tenga bloque `issue`, **incluidas las PRs de iteración/reapertura**: la nueva PR lleva su propio "Closes #N" aunque exista una PR anterior para la misma issue; nunca se omite ni se confía en PRs previas.

### 4. Master Step 6 con push (reconciliación al inicio de sesión)

Cuando la PR de una issue está **MERGED** (verificado con `gh pr view <N_PR> --json state -q .state`):

1. `set-state <N> ai-done` — fallback manual best-effort (el workflow normalmente ya lo hizo).
2. Cierre de la issue si sigue abierta (el workflow no corrió o falló): `gh issue close <N>`.
3. Task file → `"status": "published"` (round-trip JSON preservando el resto de campos).
4. **PUSH del task file a `dev`**: `git checkout dev`, `git pull origin dev`, `git add tasks/task-issue-<N>.json` (solo el task file), commit `chore: task #<N> publicado`, push, y restauración de la rama anterior. Stash previo de cambios ajenos (`git stash push` / `pop`) y aborto limpio si `git pull` da conflicto (no se resuelve a medias).

### 5. Reversión parcial de ADR-018

El punto "Alternativas descartadas" de ADR-018 descartaba un bot/acción de GitHub Actions para sincronizar labels por sobre-ingeniería ("los agentes ya disponen de `gh` autenticado"). **ADR-029 revisa ADR-018 en ese punto**: el workflow se adopta por necesidad — el auto-close de GitHub con keywords no funciona cuando la rama de integración (`dev`) no es la rama por defecto, como demostró la issue #42. El resto de ADR-018 permanece vigente (source of truth en issues, labels, helper `gh-issue.sh`).

### 6. Limpieza one-off de la issue #42

La PR #55 ya está fusionada y **no re-dispara el workflow** (el trigger `closed` solo se evalúa al fusionar, no retroactivamente). Tras la publicación de esta tarea se realiza la limpieza manual: cierre de la issue #42, `set-state 42 ai-done` y task file → `"published"` con push a `dev`, rescatando así la actualización pendiente del task file (status `review` + bloque `pr` #55 que quedó sin commitear).

## Alternativas descartadas

- **`bash` + `gh` en el runner en vez de `actions/github-script`**: descartado: el quoting del body de la PR en bash es frágil y no ofrece manejo estructurado de errores (un fallo de parseo rompería silenciosamente el flujo); el script de `github-script` maneja la API de forma tipada con `try/catch` por issue.
- **Solo `workflow_dispatch` sin el trigger automático**: descartado: requeriría intervención manual en cada merge, lo que no cumple el objetivo de la issue #44 (cero trabajo manual en la transición a `ai-done`). El `workflow_dispatch` se mantiene solo como respaldo de pruebas.
- **Mantener únicamente el fallback manual del Step 6**: descartado: no elimina el trabajo manual que la issue pide minimizar (la transición seguiría esperando a la siguiente sesión de reconciliación).
- **Cierre manual de issues / confiar en el auto-close de GitHub**: descartado: el auto-close no funciona con base `dev` (demostrado con la issue #42, PR #55 fusionada con "Closes #42" y issue quedó abierta) y el cierre manual es exactamente el trabajo que se quiere eliminar.

## Consecuencias

### Positivas
- **Ciclo completo sin intervención manual**: issue → task → PR → merge → `ai-done` + issue cerrada, todo automático.
- **El estado del task file siempre queda reflejado en el repositorio**: segundo commit del publisher (status `review`) y push del Step 6 (status `published`); el publisher ya no deja "deuda" local.
- **La keyword "Closes #N" se garantiza siempre**, incluidas PRs de iteración/reapertura (problema 3 de la issue).
- **Cierre de issues fiable independiente de la rama de fusión**: el workflow cierra la issue explícitamente por API, sin depender del auto-close de GitHub.

### Negativas
- **Dependencia de GitHub Actions para la transición final**: si el workflow falla o no corre (p. ej. Actions deshabilitado en el repo), el estado queda pendiente hasta la reconciliación del Step 6 en la siguiente sesión.
- **Push directo a `dev` en el Step 6**: asumido porque `dev` no tiene protección de rama y es la rama de integración del flujo; un push fallido por conflictos aborta y se reporta sin resolver a medias.
- **Historial `previousPr` de un solo nivel**: solo se conserva la PR inmediatamente anterior, no el historial completo de PRs de la issue.

### Neutras
- **El workflow no distingue forks/colaboradores más allá del guard `full_name`**: cualquier PR del propio repo con keywords de cierre puede cerrar issues `ai-*`; es el comportamiento deseado para colaboradores.
- **El `GITHUB_TOKEN` con `issues: write` queda activo en el repositorio**: permiso mínimo necesario para labels/cierre, con `pull-requests: read` y sin secrets.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/issue-done-on-merge.yml` | **Nuevo**: workflow `issue-done-on-merge` (`pull_request: [closed]` + `workflow_dispatch`, `actions/github-script@v7`, regex de keywords de cierre, solo issues con label `ai-*`, guard de forks, permisos `issues: write`/`pull-requests: read`, best-effort con `core.warning`) |
| `.opencode/agents/publisher.md` | Paso 6 "Subir el task file (segundo commit)" (round-trip JSON, bloque `pr` + `previousPr`, commit/push a la misma rama), "Closes #N" SIEMPRE como primera línea incluidas iteraciones, pre-flight con limpieza de ruido EOL (`git diff --ignore-space-at-eol`), prefijos de rama `refactor`/`content`, captura `number`/`url` de la PR vía `gh pr create --json` |
| `.opencode/agents/sdd-master.md` | Step 3-b: nota del workflow (transición `ai-done` automática; sincronización manual como fallback); Step 5: Closes siempre + segundo commit del publisher; Step 6 reescrito (PR MERGED → `ai-done` + cierre + `published` con push a `dev` y stash de cambios ajenos) |
| `.opencode/agents/qa-reviewer.md` | Nota: `ai-needs-review` la aplica el publisher y `ai-done` + cierre los aplica el workflow al fusionar — no es un paso manual |
| `scripts/gh-issue.sh` | 3 líneas de comentario en la cabecera: el workflow es la vía automática de la transición a `ai-done`; el script queda como respaldo manual |
| `tasks/task-issue-42.json` | Actualización pendiente rescatada: `status: "review"` + bloque `pr` (PR #55) con commit/push one-off al cierre de la issue #42 |
| `tasks/task-issue-44.json` | Task file de esta tarea |
| `docs/adr-029-issue-done-on-merge.md` | **Nuevo**: este documento |

Related issue: #44 — https://github.com/gonzalitojh/Registro-personal/issues/44
