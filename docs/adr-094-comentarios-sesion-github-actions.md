# ADR-094: Toda la sesión SDD de auto-resolve-issues publica como github-actions[bot] (issue #257)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

El workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 y
ampliaciones ADR-050, ADR-054, ADR-055, ADR-077, ADR-078) resuelve
automáticamente el backlog de issues con label `ai` lanzando una sesión
headless de OpenCode (agente `sdd-master` + subagentes, entre ellos el
publisher). La sesión ejecuta operaciones de escritura sobre issues y PRs:

- el **publisher** crea la PR con `gh pr create` y, en las iteraciones,
  la actualiza y comenta con `gh pr edit` / `gh pr comment`;
- la sesión publica comentarios en issues y sincroniza las labels
  (`scripts/gh-issue.sh set-state/set-type`).

El job `resolve` define a nivel de job `GH_TOKEN: ${{ secrets.WORKFLOW_GIT_TOKEN }}`
(un PAT del propietario), y la sesión se lanza con
`bash scripts/run-sdd-session.sh`, que hereda todo el env del job. Por
tanto TODAS esas operaciones `gh` de la sesión se publicaban firmadas por
el propietario (`gonzalitojh`), no por el usuario de GitHub Actions.

La issue #245 (ADR-078, PR #247) corrigió SOLO los dos comentarios de fallo
del paso «Relanzar o devolver a la cola» (los `gh issue comment` del
workflow pasaron a `GH_TOKEN="$GITHUB_TOKEN"` → autor `github-actions[bot]`).
La issue #257 extiende el requisito a TODO: todos los comentarios que hagan
los workflows sobre issues o PRs, así como cualquier issue o PR que creen,
deben publicarse desde el usuario de GitHub Actions, mensajes de
explicación incluidos.

**Root cause**: el env de job con el PAT. Además de la autoría engañosa en
el hilo de la issue/PR, tiene una consecuencia funcional: el trigger
`issue_comment: types: [created]` filtra solo `github.actor !=
'github-actions[bot]'`, así que un comentario de issue publicado por la
sesión con el PAT del propietario **vuelve a disparar el workflow** sobre
esa misma issue (sesión de iteración duplicada o no deseada).

## Decisión

**Lanzar la sesión SDD con el `GITHUB_TOKEN` integrado del runner** (autor:
`github-actions[bot]`), mediante un override de env a nivel de STEP en el
paso «Sesión OpenCode» del workflow:

```yaml
env:
  GH_TOKEN: ${{ github.token }}
```

El override de step solo sustituye `GH_TOKEN`; el resto del env del job
(`OPENCODE_API_KEY`, `RETRY_INPUT`) se sigue heredando. Con esto, TODAS las
operaciones `gh` de la sesión (PRs del publisher, `gh pr edit/comment` de
iteraciones, comentarios en issues y sync de labels) se publican con autor
`github-actions[bot]`, que el filtro del trigger `issue_comment` ya
excluye (mismo principio que ADR-078).

Cobertura de permisos verificada: el bloque `permissions:` del job ya
concede al `GITHUB_TOKEN` `contents: write` (commits/push del agente),
`pull-requests: write` (`gh pr create/edit/comment`), `issues: write`
(comentarios y labels) y `actions: write`. El push de git NO se ve
afectado por el cambio: git no usa `GH_TOKEN` — las credenciales las deja
`actions/checkout` (github.token) y la identidad ya es
`github-actions[bot]` (paso «Identidad de git»).

**El PAT del job se reserva solo para los pasos que lo necesitan** (fuera
de la sesión): el relanzamiento con `gh workflow run` y el dispatch de
`deploy-all-branches` (requieren `actions: write` para el dispatch, mismo
criterio que ADR-078), y los `set-state` de labels de los pasos del propio
workflow (claim y fallo) que no tienen autoría visible de comentario.

## Alternativas descartadas

- **Instruir al agente en el prompt para que anteponga `GH_TOKEN="$GITHUB_TOKEN"`**
  a cada comando de comentario/PR: descartado — frágil y dependiente del
  modelo; un agente puede omitirlo y volver a publicar como propietario. El
  override de env es determinista: la sesión no puede publicar con el PAT
  aunque lo intente.
- **Cambiar el env del job entero a `${{ github.token }}`**: descartado —
  los pasos de relanzamiento (`gh workflow run`) y dispatch de deploy
  necesitan el PAT para `actions: write` fuera del alcance de la sesión
  (mismo argumento que ADR-078).
- **Ampliar el filtro del `if` del job** para excluir también al
  propietario: descartado en ADR-078 — censura los comentarios legítimos
  del propietario (la iteración por comentario es un flujo de usuario real,
  ADR-047 sección 7-c).
- **Sobrescribir ADR-078** en lugar de crear uno nuevo: descartado — ADR-078
  es el registro histórico del fix parcial (#245); este ADR lo extiende y
  lo referencia.

## Consecuencias

### Positivas

- **Toda la autoría de la sesión es `github-actions[bot]`**: PRs creadas
  por el publisher, comentarios de PR/issue (mensajes de explicación
  incluidos) y cambios de labels aparecen firmados por el bot, nunca por el
  propietario (requisito de la issue #257).
- **Los comentarios de la sesión ya no re-disparan el workflow**: al
  publicarse como `github-actions[bot]`, el filtro del trigger
  `issue_comment` los excluye; se eliminan sesiones de iteración duplicadas
  o no deseadas causadas por los propios comentarios de la sesión.
- **Least privilege**: la sesión (que no necesita `actions: write` para
  nada) usa el token automático repo-scoped y mínimo; el PAT con más
  privilegios queda solo donde es necesario.
- **Autor coherente**: la sesión se firma con el mismo actor que ya firma
  los commits (`github-actions[bot]`) y los comentarios de fallo (ADR-078).

### Negativas / Riesgos

- **`GITHUB_TOKEN` solo es válido dentro del run que lo emite**: la sesión
  publica sus PRs/comentarios dentro del mismo run, así que no hay riesgo
  práctico; no puede reutilizarse fuera del run (no necesario).
- **El `GITHUB_TOKEN` no expone `actions: write` a `workflow_dispatch`**
  (criterio de ADR-078): si algún día la sesión necesitara relanzar
  workflows con `gh workflow run`, habría que revisar esta decisión
  (mitigado: hoy la sesión nunca lanza workflows; los dispatch son pasos
  del workflow con PAT).
- **Los pasos del workflow que siguen con PAT** (claim, fallo) muestran al
  propietario como actor en los eventos de labels del timeline: fuera del
  alcance de la issue (no son comentarios ni issues/PRs creadas) y sin
  efecto funcional (un cambio de label no dispara el workflow).

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambio interno de
  infraestructura de CI (autor de comentarios/PRs de la automatización),
  no visible para el usuario final de la web (regla 3 de AGENTS.md; misma
  decisión que ADR-047, ADR-077, ADR-078).
- **README actualizado** (sección 6, punto 6): la nota de los comentarios
  de fallo (ADR-078) se generaliza a todos los comentarios, PRs y cambios
  de labels de la sesión.
- **El resto del workflow no cambia**: selección, reclamación, WIP,
  reintentos, cola, dispatch de deploy y resumen quedan intactos; los dos
  comentarios de fallo siguen con el fix de ADR-078.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: el paso «Sesión OpenCode» añade `env: GH_TOKEN: ${{ github.token }}` (override de step; autor de TODAS las operaciones gh de la sesión: `github-actions[bot]`); nota explicativa en la cabecera del workflow junto al bloque de la issue #245 |
| `README.md` | **Modificado**: sección 6, punto 6 — la nota sobre el autor pasa a cubrir todos los comentarios, PRs y cambios de labels de la sesión y de los pasos de fallo (`github-actions[bot]`, no vuelven a disparar el workflow) |
| `docs/adr-094-comentarios-sesion-github-actions.md` | **Nuevo**: este documento |
| `tasks/task-issue-257.json` | Task file de la tarea (title/description con la root cause, criterios de aceptación AC1–AC5, DoD y bloque `issue` con la issue #257 — https://github.com/gonzalitojh/Registro-personal/issues/257) |

Related issue: #257
