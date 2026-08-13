# ADR-078: Comentarios de fallo de auto-resolve-issues publicados por github-actions[bot] (issue #245)

## Estado
Aceptado

## Fecha
2026-08-13

## Contexto

El workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 y
ampliaciones ADR-050, ADR-054, ADR-055, ADR-077) resuelve automáticamente el
backlog de issues con label `ai`. Entre sus triggers está
`issue_comment: types: [created]` (iteración: un comentario en una issue en
curso relanza la sesión sobre esa issue), y el job `resolve` (línea 95 del
YAML) filtra en su `if` que el autor del comentario no sea el bot:

```yaml
|| (github.event_name == 'issue_comment' && !github.event.issue.pull_request
                                         && github.actor != 'github-actions[bot]')
```

La issue #245 reporta un bug (priority medium) del paso «Relanzar o devolver
a la cola en fallo de sesión» (ADR-077): los comentarios que ese paso
publica en la issue cuando la sesión SDD falla (devolución a la cola con
`return_to_queue`, o aviso del relanzamiento automático) se publicaban con
`gh issue comment` usando el `GH_TOKEN` del job
(`${{ secrets.WORKFLOW_GIT_TOKEN }}`, un PAT del propietario).

**Root cause verificada**: al publicar el comentario con el PAT del
propietario, el comentario aparecía firmado por `gonzalitojh`, por lo que el
filtro `github.actor != 'github-actions[bot]'` del trigger `issue_comment`
**no lo excluía**: el propio comentario de fallo volvía a disparar el
workflow sobre la misma issue. En el caso del relanzamiento, la issue se
mantiene en `status: in-progress` durante los reintentos (ADR-077), así que
el comentario de fallo lanzaba una **sesión de iteración nueva** que
duplicaba el relanzamiento ya encolado (o ejecutaba iteraciones no deseadas
sobre la misma issue).

## Decisión

**Publicar los comentarios de fallo con el `GITHUB_TOKEN` integrado del
runner** (autor: `github-actions[bot]`), que el filtro del trigger ya
excluye. Cambio mínimo y quirúrgico en el paso «Relanzar o devolver a la
cola en fallo de sesión» del workflow:

- **`return_to_queue`** (reintentos agotados o fallo del dispatch de
  relanzamiento): el `gh issue comment` de «Se devuelve la issue a la cola
  (status: ...)» usa `GH_TOKEN="$GITHUB_TOKEN"`.
- **Comentario de relanzamiento** («Se relanza automáticamente (intento N de
  3)»): el `gh issue comment` usa `GH_TOKEN="$GITHUB_TOKEN"`.
- **El resto de operaciones del paso siguen usando el `GH_TOKEN` del job
  (PAT)**: los `set-state` de labels (`bash scripts/gh-issue.sh`) y el
  `gh workflow run` del relanzamiento requieren permisos sobre
  actions/workflow que el `GITHUB_TOKEN` no concede (`actions: write` del
  workflow lo firma con `workflow_dispatch`, no con el token del runner).
- **Comentarios explicativos** en la cabecera del workflow y en el propio
  paso documentando el porqué (token automático vs PAT, issue #245).
- **README.md sección 6, punto 6**: nota sobre el autor de los comentarios
  de fallo (`github-actions[bot]`, de modo que no vuelven a disparar el
  workflow).

El `if: failure()`, la semántica de reintentos, la cola (`queue: max`,
ADR-077), el WIP de la issue #128 y el resto del flujo quedan intactos.

## Alternativas descartadas

- **Ampliar el filtro del `if` del job para excluir también al propietario**
  (`github.actor != 'gonzalitojh'`): descartado — censura los comentarios
  legítimos del propietario en una issue en curso (la iteración por
  comentario es un flujo de usuario real, ADR-047 sección 7-c), y deja el
  problema de fondo (comentarios del bot firmados por el propietario, autor
  engañoso en el hilo de la issue).
- **Usar el `GITHUB_TOKEN` para todo el paso** (labels y dispatch del
  relanzamiento incluidos): descartado — el token automático no tiene
  permiso para `gh workflow run` (requiere `actions: write`, que el
  `GITHUB_TOKEN` del runner no expone a `workflow_dispatch`), así que el
  relanzamiento del ADR-077 fallaría; además el agente necesita el PAT para
  commits/push con identidad del propietario en el resto del job.
- **No comentar en fallo** (eliminar los comentarios del paso): descartado —
  perdería la trazabilidad de los fallos en la issue (motivo e intento,
  ADR-077: «Trazabilidad») que es parte del valor del flujo; el bug no es
  comentar, sino el autor con el que se comenta.

## Consecuencias

### Positivas

- **Los comentarios de fallo ya no re-disparan el workflow**: al publicarse
  como `github-actions[bot]`, el filtro `github.actor != 'github-actions[bot]'`
  del trigger `issue_comment` los excluye; no se duplican relanzamientos ya
  encolados ni se lanzan iteraciones no deseadas sobre la misma issue.
- **Least privilege**: los comentarios de fallo (única operación del paso
  que no requiere permisos de actions/workflow) usan el token automático
  repo-scoped y mínimo; el PAT con más privilegios queda solo donde es
  necesario.
- **Autor coherente**: los avisos automáticos se firman con el mismo actor
  que ya usa el resto de la automatización (commits del checkout con
  `github-actions[bot]`), evitando que el hilo de la issue parezca llevar
  comentarios del propietario.

### Negativas / Riesgos

- **`GITHUB_TOKEN` solo es válido dentro del run que lo emite**: los
  comentarios se publican en el momento del fallo, dentro del mismo job, así
  que no hay riesgo práctico; pero el token no puede reutilizarse fuera del
  run (p. ej. en un dispatch posterior) — algo que el paso no necesita.
- **El `GITHUB_TOKEN` no tiene `actions: write`**: por eso el cambio es
  parcial (solo los dos `gh issue comment`); si en el futuro se quisiera
  usar el token automático para `gh workflow run`, requeriría permisos
  adicionales no disponibles (mitigado: el PAT sigue cubriendo esa
  operación).
- **El paso sigue dependiendo del PAT para el resto de operaciones**: el
  fallo de un comentario ya era best-effort (`|| true`), y el relanzamiento
  sigue funcionando igual que en el ADR-077.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambio interno de
  infraestructura de CI (autor de un comentario automático de fallo), no
  visible para el usuario final de la web (regla 3 de AGENTS.md; misma
  decisión que ADR-047, ADR-077).
- **README actualizado** (sección 6, punto 6): nota sobre el autor de los
  comentarios de fallo.
- **El resto del workflow no cambia**: selección, reclamación, WIP,
  reintentos, cola, dispatch de deploy y resumen quedan intactos.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: en el paso «Relanzar o devolver a la cola en fallo de sesión», los dos `gh issue comment` (función `return_to_queue` y aviso del relanzamiento) usan `GH_TOKEN="$GITHUB_TOKEN"` (autor: `github-actions[bot]`); comentarios explicativos del porqué (issue #245) en la cabecera del workflow y en el paso; el resto de operaciones (set-state de labels, `gh workflow run`) sigue con el `GH_TOKEN` del job (PAT) |
| `README.md` | **Modificado**: sección 6, punto 6 — nota sobre el autor de los comentarios de fallo (`github-actions[bot]`, no vuelven a disparar el workflow) |
| `docs/adr-078-comentarios-fallo-github-actions.md` | **Nuevo**: este documento |
| `tasks/task-issue-245.json` | Task file de la tarea (title/description con la root cause, criterios de aceptación AC1–AC5, DoD y bloque `issue` con la issue #245 — https://github.com/gonzalitojh/Registro-personal/issues/245) |

Related issue: #245