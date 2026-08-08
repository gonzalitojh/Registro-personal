# ADR-050: Deploy explícito tras sesión, comentario en PR de iteración, eliminación del trigger pull_request y logs legibles en auto-resolve-issues (issue #126)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

El ADR-047 introdujo el workflow `.github/workflows/auto-resolve-issues.yml`: una
sesión headless de OpenCode (agente `sdd-master`) resuelve automáticamente la
issue más prioritaria del backlog, crea una rama y una PR contra `dev`, y el
merge en `dev` disparaba el siguiente ciclo. El usuario reportó 4 problemas
(issue #126):

1. **El despliegue de Pages no se relanza tras una sesión exitosa**. Cuando el
   push de la rama/PR lo hace el bot (`github-actions[bot]` con `GITHUB_TOKEN`),
   los eventos `push` generados con ese token **no disparan** los triggers de
   otros workflows (regla de GitHub Actions: los eventos creados con el
   `GITHUB_TOKEN` del repo no crean nuevos runs, con la excepción de
   `workflow_dispatch` y `repository_dispatch`). Antes el push lo hacía la
   máquina local del usuario y sí se disparaba `deploy-all-branches`; ahora,
   con el bot, los previews de Pages se quedan desactualizados hasta un
   despliegue manual o un merge posterior.
2. **En iteración no se comenta en la PR lo nuevo aplicado**: el agente
   actualiza la PR con `gh pr edit`, pero quien revisa la PR no ve qué cambió
   en la última iteración sin comparar commits.
3. **El trigger `pull_request` provoca la ejecución continua de la action**:
   PR mergeada en `dev` → se resuelve la siguiente issue → nueva PR → merge →
   siguiente issue… un ciclo sin intervención manual que el usuario quiere
   evitar. La resolución automática debe dispararse solo con issue nueva,
   comentario en issue en curso o dispatch manual.
4. **El log de la sesión es ilegible**: `--format json` emite eventos JSONL
   crudos; se quiere una salida similar al cliente local (formato por defecto).

Related issue: #126 — https://github.com/gonzalitojh/Registro-personal/issues/126

## Decisión

Ampliar ADR-047 con cuatro correcciones en `.github/workflows/auto-resolve-issues.yml`:

### 1. Dispatch explícito de `deploy-all-branches` tras sesión exitosa

Nuevo paso «Disparar despliegue deploy-all-branches (workflow_dispatch)» entre
el paso de «Rollback en fallo de sesión» y el de «Resumen»:

```yaml
- name: Disparar despliegue deploy-all-branches (workflow_dispatch)
  if: steps.candidate.outputs.selected != 'NONE' && inputs.dry_run != 'true'
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    echo "Lanzando deploy-all-branches (dispatch) para reconstruir Pages con las nuevas ramas..."
    gh workflow run deploy-all-branches.yml
    echo "Dispatch enviado: revisa el run de deploy-all-branches en la pestaña Actions."
```

- **Permiso nuevo**: `actions: write` en `permissions` del workflow (necesario
  para lanzar `workflow_dispatch` de otro workflow con `gh workflow run`).
- **`if` implícito `success()`**: el paso solo corre si la sesión terminó con
  exit 0. Está **después** del rollback para que un fallo del propio dispatch
  no re-evalúe ni `wip-save` ni el rollback (no hay best-effort ni trap: si el
  dispatch falla, el run falla y el Resumen lo muestra).
- **Sin `--ref`**: se usa la rama por defecto (`main`), donde el trigger
  `workflow_dispatch` de `deploy-all-branches` ya existe (ADR-041); el workflow
  construye todas las ramas con `fetch-depth: 0`, así que las ramas nuevas de
  la sesión aparecen en el despliegue aunque `main` no se haya tocado.
- **Por qué NO `workflow_run`**: el trigger `workflow_run` solo se activa si el
  workflow fuente está publicado en la **rama por defecto** y depende del
  evento de completación, que además no se genera para runs disparados por
  `GITHUB_TOKEN` (misma restricción del problema 1). El `workflow_dispatch`
  explícito **funciona de inmediato** desde el propio run, sin esperar
  promoción ni eventos derivados del token del bot.

### 2. Comentario obligatorio en la PR en modo iteración

El prompt de la sesión (MODO ITERACIÓN, «PUBLICACIÓN CON PR EXISTENTE») exige
ahora que, **tanto si se actualiza una PR existente (`gh pr edit`) como si se
crea una PR nueva** en la iteración, el agente añada un comentario con
`gh pr comment <NUM> --body "..."` que resuma lo nuevo aplicado: cambios,
validaciones (aceptación + DoD), escaneo de seguridad y ADR. El contenido lo
genera la propia sesión, adaptado a lo hecho.

También se añade una frase breve en el paso 5a del prompt normal (modo
WIP-restore): si se actualiza una PR existente, comentarla igualmente con
`gh pr comment` resumiendo lo nuevo.

### 3. Eliminación del trigger `pull_request`

- `on: pull_request: types: [closed]` eliminado: la action ya NO se lanza al
  fusionar PRs (ni contra `dev` ni contra ninguna rama).
- El `if:` del job `resolve` pierde el término
  `(github.event_name == 'pull_request' && merged && base.ref == 'dev')` y queda
  con `issues`, `issue_comment` y `workflow_dispatch`.
- Comentario de cabecera actualizado (se elimina el bullet de pull_request y la
  NOTA de activación ya no menciona el merge ref: todos los triggers
  automáticos usan la rama por defecto `main`).
- Comentario del Caso C renombrado: `# ---- Caso C: issues (opened) → selección automática ----`.
- Se **mantienen** los guards anti-PR (`!github.event.issue.pull_request`) en
  los términos `issues`/`issue_comment` del `if:`.

Consecuencia de diseño: el «ciclo continuo» de ADR-047 (merge → siguiente
issue) deja de ser automático; la resolución se dispara con issue nueva,
comentario en issue en curso o dispatch manual, y tras cada sesión exitosa el
despliegue de Pages se relanza con el dispatch del punto 1.

### 4. Log legible de la sesión

La invocación de `opencode run` sustituye `--format json` por `--format
default`: la salida es similar al cliente local, legible en el log de CI. No se
añade `--print-logs` y no se toca nada más: **ningún paso posterior parsea la
salida** de la sesión (la sesión solo necesita su exit code, que ya se captura
con `$?`).

## Alternativas descartadas

- **`workflow_run` para relanzar el deploy**: descartado — depende de que el
  workflow fuente esté en la rama por defecto y del evento de completación,
  que no se genera para runs disparados por `GITHUB_TOKEN`; el dispatch
  explícito funciona de inmediato.
- **Mantener `pull_request: closed` con `base.ref == 'dev'`**: descartado —
  es la causa del ciclo continuo no deseado (problema 3 de la issue #126).
- **Seguir con `--format json` y documentar cómo leer los eventos**: descartado
  — la issue pide explícitamente logs legibles; el formato por defecto no
  afecta al flujo (nada parsea la salida).
- **Comentar la PR solo cuando se actualiza una existente**: descartado — una
  PR nueva de iteración también necesita el resumen de lo nuevo para el
  revisor.

## Consecuencias

### Positivas

- **Pages siempre al día**: tras cada sesión exitosa, `deploy-all-branches` se
  relanza automáticamente; los previews de las ramas nuevas de la sesión se
  construyen sin depender de los push del bot (que no generan eventos).
- **PRs de iteración autoexplicativas**: el revisor ve en el comentario de la
  PR qué se validó y qué cambió en cada iteración.
- **Fin del ciclo continuo no deseado**: la action solo se dispara con issue
  nueva, comentario o dispatch manual; el usuario controla cuándo se resuelven
  issues.
- **Logs legibles**: la ejecución de la sesión se lee como en el cliente local.

### Negativas / Riesgos

- **El ciclo «merge → siguiente issue» ya no es automático**: el backlog solo
  se drena con issues nuevas, comentarios o dispatch manual (decisión
  solicitada por el usuario).
- **El dispatch depende del permiso `actions: write`**: si GitHub cambia la
  política del token en el futuro, el paso fallaría; el fallo del dispatch
  tiñe el run (no hay best-effort, a propósito: es señal visible de que el
  despliegue no se relanzó).

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambios internos de CI, no
  visibles para el usuario final de la web (AC6 de la tarea; no aplica la
  regla 3 de AGENTS.md).
- **`.github/workflows/deploy-all-branches.yml` sin cambios**: el trigger
  `workflow_dispatch` ya existe en `main` (ADR-041) y el workflow ya construye
  todas las ramas.
- **Guards anti-PR y concurrency intactos**: `!github.event.issue.pull_request`
  y `sdd-auto-resolver` con `cancel-in-progress: false` se mantienen.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: eliminado el trigger `pull_request` de `on:` y del `if:` del job (con comentarios de cabecera/NOTA actualizados y Caso C renombrado); instrucción obligatoria `gh pr comment` en MODO ITERACIÓN y paso 5a; `--format json` → `--format default` en la sesión; permiso `actions: write`; nuevo paso «Disparar despliegue deploy-all-branches (workflow_dispatch)» entre rollback y resumen (`if: selected != 'NONE' && dry_run != 'true'`, sin `--ref` → rama por defecto) |
| `docs/adr-050-auto-resolve-deploy-iteracion-triggers.md` | **Nuevo**: este documento (amplía ADR-047) |
| `tasks/task-issue-126.json` | Task file de la tarea (title/description, plan de cambios C1–C4, criterios de aceptación AC1–AC6, DoD y bloque `issue` con la issue #126) |
| `README.md` | **Modificado**: sección 6, punto 6 — la resolución ya NO se dispara al fusionar PRs (solo issue nueva, comentario en issue en curso o dispatch manual) y tras cada sesión exitosa se relanza automáticamente el despliegue Pages |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de infraestructura, no visible para el usuario final) |

Related issue: #126 — https://github.com/gonzalitojh/Registro-personal/issues/126
