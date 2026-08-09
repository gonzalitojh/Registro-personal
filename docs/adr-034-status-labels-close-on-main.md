# ADR-034: Esquema de labels `status: *` + label `ai` y cierre de issues al promover dev a main (issue #74)

## Estado
Aceptado

## Fecha
2026-08-05

**SUPERA A**: ADR-018 y ADR-029 en lo relativo al esquema de labels y al cierre de issues (ambos llevan notas de superación apuntando a este documento). El resto de ambos se conserva como registro histórico.

**NOTA — SUPERADA EN LO RELATIVO AL CIERRE DE ISSUES (ADR-053, issue #143)**: el cierre de issues ya NO ocurre en la promoción `dev` → `main`: desde ADR-053 cada issue se cierra y marca `status: done` al **fusionar su PR en `dev`** (workflow `issues-done-on-dev.yml` con alcance dirigido a la issue de la PR). El esquema de labels `status: *` + label `ai` documentado aquí permanece plenamente vigente.

## Contexto

El usuario migró el esquema de labels de GitHub Issues del flujo SDD. Hasta ahora existían dos familias de labels paralelas: las de agente con prefijo `ai-` (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`) y las de usuario sin prefijo (`todo`, `in-progress`, `done`, `blocked`). El nuevo esquema unifica ambas en **estados compartidos** `status: todo | in-progress | needs-review | blocked | done`, más una label **`ai`** (sin sufijo) como marcador de las issues que debe abordar el agente.

El código del flujo SDD seguía usando el esquema antiguo: el helper `scripts/gh-issue.sh` gestionaba labels `ai-*`, el workflow `issue-done-on-merge.yml` cerraba las issues al fusionar PRs en `dev` y las guías de agentes (sdd-master, publisher, qa-reviewer) y el comando `issues` documentaban la transición a `ai-done`.

Además, el requisito sobre el cierre cambió: el problema original (issue #74) era que al completar una PR la issue no se marcaba ni se cerraba, pero el usuario amplió el requisito con una regla explícita: **NO se cierra la issue ni se cambia a `status: done` al hacer la PR**. El cierre y la transición a `done` deben ocurrir **ÚNICAMENTE** cuando el usuario promueve `dev` a `main` (merge o push directo a `main`). El workflow viejo `issue-done-on-merge.yml` (que se activaba con `pull_request: closed` y cerraba las issues al fusionar PRs en `dev`) fue eliminado.

Related issue: #74 — https://github.com/gonzalitojh/Registro-personal/issues/74

## Decisión

Adoptar el esquema de estados compartidos `status: *` + label `ai` como marcador de agente, y trasladar el cierre de issues a la promoción `dev` → `main`:

### 1. Helper `scripts/gh-issue.sh` migrado al nuevo esquema

- **`STATUS_STATES`**: `("status: todo" "status: in-progress" "status: needs-review" "status: blocked" "status: done")`; el prefijo `status: ` es lo único que distingue un estado.
- **`list`**: filtros `--todo` / `--review` / `--blocked` / `--done` con consultas `status: *` que **exigen además la label `ai`** (solo issues de agente); la clasificación AGENTE se determina por la presencia de la label `ai`.
- **`show`**: agrupa las labels en agente (`ai`), estado (`status: *`), residuales `ai-*`, tipo (`type: *`) y otras.
- **`set-state`**: valida el estado contra `STATUS_STATES`, elimina en batch el resto de labels `status: *` (vía `--remove-label`) y los residuales `ai-*` (vía `gh api -X DELETE ... || true`, porque gh 2.45 falla con `--remove-label` si la label ya no existe en el repo; la API tolera el no-op). **Nunca toca la label `ai`**: por construcción `"ai"` no matchea el prefijo `"ai-"`, así que la label de agente queda siempre intacta. Es **idempotente**, tiene guardia de issues cerradas (solo se permite `status: done`), salvaguarda anti-PR y códigos de salida 2/3/1 (uso inválido, validación fallida, fallo de red/API).
- **`set-type`**: sin cambios (el esquema `type: *` se mantiene).

### 2. Eliminación del workflow `issue-done-on-merge.yml`

Se elimina el workflow que se activaba con `pull_request: [closed]` y cerraba las issues al fusionar PRs en `dev`: ya no se quiere cerrar en el merge de PR, sino en la promoción.

### 3. Nuevo workflow `.github/workflows/issues-done-on-main.yml`

- **Trigger**: `on: push: branches: [main]` (cubre el merge `dev` → `main` tanto por PR como por push directo; **NO** se activa con PRs a `dev`) + `workflow_dispatch` sin inputs como respaldo de prueba manual.
- **Permisos mínimos**: `issues: write` (único permiso; no se usan secrets).
- **Lógica** (con `actions/github-script@v7`): pagina `issues.listForRepo` (`state: all`, `labels: 'status: needs-review'`, `per_page: 100`); salvaguarda anti-PR (`if (issue.pull_request) continue`); por cada issue elimina las labels `status: *` ≠ `done` y los residuales `ai-*`, añade `status: done` si no la tiene y **cierra la issue si está abierta**.
- **Alcance**: procesa **TODAS** las issues con `status: needs-review`, tanto de agente como de usuario (requisito explícito del usuario: la promoción cierra todo lo que esté en revisión).
- **Sin parseo de bodies ni keywords "Closes"**: el cierre no depende de la keyword de GitHub (que además no funciona porque la rama de integración `dev` no es la rama por defecto — hallazgo de ADR-029).

### 4. Guías de agentes y comando migrados

- `.opencode/agents/sdd-master.md`: regla AI-only = label `ai`; tabla de mapeo de estados `status: *`; **nota IMPORTANTE**: la transición a `status: done` + cierre la aplica el workflow al promover `dev` → `main`, por lo que las issues permanecen en `status: needs-review` tras fusionar la PR en `dev`; Step 6 con fallback manual **solo** si la promoción ya ocurrió (verificar con `gh api repos/{owner}/{repo}/compare/main...dev --jq .status` → si NO es `'ahead'`); `set-state` con comillas en los estados.
- `.opencode/agents/publisher.md`: `set-state <N> "status: needs-review"`; nueva EXCEPCIÓN `no_closes`: si el task file contiene `"no_closes": true`, se omite "Closes #N" del body de la PR (el cierre lo hace el workflow de promoción).
- `.opencode/agents/qa-reviewer.md`: la transición a `done` solo se produce vía promoción `dev` → `main`.
- `.opencode/command/issues.md`: ayuda actualizada con la label `ai` y los estados `status: *`.

### 5. Limpieza defensiva de residuales `ai-*`

Tanto `set-state` como el workflow eliminan las labels residuales `ai-*` cuando aparecen (issues migradas a medias). **No se recrean labels `ai-*`**: el esquema nuevo solo crea `status: *`, `ai`, `type: *` y las de usuario.

## Alternativas descartadas

- **Mantener el esquema `ai-*` (solo agente) + labels de usuario sin prefijo**: descartado — el usuario lo cambió explícitamente al esquema compartido `status: *` + label `ai`; mantener el viejo iría contra el requisito y perpetuaría la duplicidad de estados.
- **Workflow que cierra al fusionar PRs en `dev` (conservar `issue-done-on-merge.yml`)**: descartado — requisito explícito del usuario: cerrar SOLO en la promoción `dev` → `main`; fusionar la PR no debe marcar ni cerrar la issue.
- **Cierre automático de GitHub con keywords "Closes #N"**: descartado — la rama de integración es `dev`, no la rama por defecto (`main`), y GitHub solo auto-cierra issues al fusionar en la rama por defecto (hallazgo documentado en ADR-029 con la issue #42); además el requisito ahora es cerrar en la promoción, no en el merge de la PR.
- **Exigir la label `ai` en `set-state` (obligar al helper a comprobar el marcador de agente)**: descartado — `set-state` es una herramienta de bajo nivel que solo gestiona estados; la regla de adopción (etiquetar con `ai` toda issue de agente) la aplica el master al tomar la issue.

## Consecuencias

### Positivas
- **Cero trabajo manual en el cierre**: al promover `dev` a `main`, el workflow marca `status: done` y cierra todas las issues en `status: needs-review` de una vez.
- **Esquema único de estados compartido agente/usuario**: una sola familia `status: *` para ambos, con la label `ai` como único diferenciador del ámbito de agente; desaparece la duplicidad `ai-done` vs `done`.
- **Cierre independiente de la rama de fusión**: el workflow cierra por API en el push a `main`, sin depender del auto-close de GitHub ni de keywords en el body.
- **Limpieza automática de residuales**: `set-state` y el workflow eliminan las labels `ai-*` sobrantes del esquema antiguo sin recrearlas.
- **Permisos mínimos**: el workflow usa solo `issues: write`, sin secrets ni `pull_request_target`.

### Negativas
- **Las issues quedan pendientes de la promoción `dev` → `main`**: mientras el usuario no promueva, una issue cuya PR ya se fusionó en `dev` permanece abierta en `status: needs-review`. Es el comportamiento pedido (el cierre marca una versión publicada, no un merge intermedio), pero implica que el estado «terminado» no se refleja hasta la promoción.
- **Si el usuario nunca promueve, las issues quedan en `needs-review`**: consecuencia directa del requisito; es un estado correcto del flujo (pendiente de publicación) y se mitiga con el fallback manual del Step 6 del master, que solo debe ejecutarse si la promoción ya ocurrió.

### Neutras
- **La PR de la propia issue #74 no incluye "Closes #74" ni la cierra**: el task file lleva `no_closes: true`; el cierre de #74 lo hará la promoción `dev` → `main` que la publique, como cualquier otra issue.
- **El esquema `type: *` y las labels de usuario se mantienen**: la migración solo afecta a estados y al marcador de agente; `set-type` no cambia.
- **`workflow_dispatch` sin inputs**: permite disparar la limpieza manualmente (p. ej. para probar o recuperar una promoción cuyo workflow falló), procesando exactamente el mismo barrido.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `scripts/gh-issue.sh` | Migrado al esquema nuevo: `STATUS_STATES` con `status: *`; `list` con filtros `--todo/--review/--blocked/--done` basados en `status: *` + label `ai` (clasificación AGENTE = label `ai`); `show` agrupa agente/estado/residuales `ai-*`/tipo/otras; `set-state` valida contra `STATUS_STATES`, elimina otras `status: *` en batch y residuales `ai-*` vía `gh api -X DELETE ... \|\| true` (gh 2.45 falla con `--remove-label` si la label no existe), nunca toca la label `ai` (por construcción), idempotente, guardia de cerradas (solo `status: done`), salvaguarda anti-PR, códigos de salida 2/3/1; `set-type` sin cambios |
| `.github/workflows/issue-done-on-merge.yml` | **Eliminado**: el workflow de cierre al fusionar PRs en `dev` ya no se quiere |
| `.github/workflows/issues-done-on-main.yml` | **Nuevo**: workflow `issues-done-on-main` (`push: branches: [main]` + `workflow_dispatch` sin inputs, permisos mínimos `issues: write`, `actions/github-script@v7`, pagina `listForRepo` con `labels: 'status: needs-review'`, salvaguarda anti-PR, elimina `status: *` ≠ done y residuales `ai-*`, añade `status: done` y cierra si está abierta; procesa todas las issues con la label, agente y usuario) |
| `.opencode/agents/sdd-master.md` | Regla AI-only = label `ai`; tabla de mapeo de estados `status: *`; nota IMPORTANTE (la transición a `done` + cierre la hace el workflow al promover `dev` → `main`; las issues quedan en `needs-review` tras fusionar la PR); Step 6 con fallback manual solo si la promoción ya ocurrió (`gh api ... compare/main...dev --jq .status` ≠ `ahead`); `set-state` con comillas |
| `.opencode/agents/publisher.md` | `set-state <N> "status: needs-review"`; EXCEPCIÓN `no_closes`: si el task file tiene `"no_closes": true` se omite "Closes #N" del body (el cierre lo hace el workflow de promoción) |
| `.opencode/agents/qa-reviewer.md` | Transición a `done` solo vía promoción `dev` → `main` |
| `.opencode/command/issues.md` | Ayuda actualizada con la label `ai` y los estados `status: *` |
| `docs/adr-018-gh-issues-integration.md` | Nota de superación en lo relativo al esquema de labels (apunta a este ADR) |
| `docs/adr-029-issue-done-on-merge.md` | Nota de superación en lo relativo al esquema de labels y al cierre (apunta a este ADR) |
| `docs/adr-034-status-labels-close-on-main.md` | **Nuevo**: este documento |

Related issue: #74 — https://github.com/gonzalitojh/Registro-personal/issues/74
