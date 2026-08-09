# ADR-053: conceder `workflows: write` al workflow auto-resolve-issues (issue #141)

## Estado
Aceptado

## Fecha
2026-08-08

## Contexto

El workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047) lanza
sesiones headless de OpenCode que resuelven issues automáticamente: el agente
edita código, hace commits, pushea ramas y crea PRs contra `dev` usando el
`GITHUB_TOKEN` generado por GitHub Actions. Los permisos de ese token se
declaran explícitamente en el bloque `permissions:` del propio workflow.

Al resolver la issue #124 (que modificaba `.github/workflows/issues-done-on-dev.yml`),
la sesión del agente editó el workflow y creó el commit local, pero el `git
push` fue **rechazado por GitHub**: los repositorios están configurados para
rechazar cualquier push que modifique archivos `.github/workflows/*.yml` si el
token usado no tiene el scope `workflows` (error típico «refusing to allow a
GitHub App or bot to create or update workflow ... without `workflows`
permission»). El run quedó colgado ~56 minutos hasta el timeout y falló
(run 31248694436 del 2026-08-08).

El scope `workflows` es especial: **no se puede conceder desde la UI de
Settings** del repositorio (la configuración «Workflow permissions» solo
controla los scopes por defecto, no `workflows`). Únicamente se otorga
declarándolo en el YAML del workflow (o con un PAT de usuario con ese scope,
descartado por requerir rotación manual de secretos).

Related issue: #141 — https://github.com/gonzalitojh/Registro-personal/issues/141

## Decisión

Añadir `workflows: write` al bloque `permissions:` de
`.github/workflows/auto-resolve-issues.yml`, junto a los scopes existentes:

```yaml
permissions:
  contents: write      # commits/push del agente (flujo SDD: rama + PR)
  pull-requests: write # creación de la PR por el publisher
  issues: write        # labels (set-state) y comentarios
  actions: write       # lanzar workflow_dispatch de deploy-all-branches tras sesión exitosa
  workflows: write     # el agente puede modificar .github/workflows/*.yml (issue #141)
```

No se toca ningún otro aspecto del workflow: triggers, `concurrency`,
jobs, steps y comentarios permanecen idénticos.

## Consideraciones

- **Los pushes del `GITHUB_TOKEN` no disparan nuevos runs de workflows**: un
  commit/push hecho con el token de la sesión no reactiva `auto-resolve-issues`
  (protección anti-bucle de GitHub), por lo que modificar workflows desde el
  agente no genera recursión.
- **Activación por rama por defecto**: los eventos `issues` e `issue_comment`
  usan la versión del workflow de `main`; el fix se activará de forma plena
  tras la promoción `dev` → `main` (mecánica ya documentada en ADR-047/issue
  #120). Con `workflow_dispatch` se puede validar antes desde la propia rama.
- **Elevación de privilegio mínima**: `workflows: write` permite modificar
  archivos `.github/workflows/*.yml`. Es aceptable porque el token ya tenía
  `contents: write` (podía modificar cualquier otro archivo del repo), es
  efímero y en el run, y el prompt del agente incluye instrucciones
  anti-exfiltración de `GH_TOKEN`/`OPENCODE_API_KEY` y protección frente a
  prompt injection desde el contenido de las issues.
- **Sin cambios visibles para el usuario**: no aplica la regla 3 de AGENTS.md
  (`docs/manual-de-usuario.md` no se toca).

## Alternativas descartadas

- **PAT de usuario con scope `workflows`**: descartado — exigiría crear un
  secret, rotación manual, y desvirtúa el diseño CI con identidad de bot.
- **No hacer nada / conceder por UI**: no es posible en Settings; la UI no
  expone el scope `workflows`. Es necesaria la declaración en el YAML.
- **Job separado con token propio para workflow files**: descartado — más
  complejo y el agente necesitaría el scope durante todo el flujo SDD, no solo
  en un job.

## Consecuencias

### Positivas

- **El agente puede pushear cambios en `.github/workflows/*.yml`**: se evita el
  error de «refusing to allow ... without `workflows` permission» y el fallo de
  runs como el de la resolución de la #124.
- **Desbloquea futuras issues de infraestructura**: cualquier issue `ai` que
  requiera modificar workflows podrá completarse en una sola sesión.
- **`wip-save` (issue #128) también se beneficia**: los pushes de progreso WIP
  que incluyan cambios en workflows ya no serán rechazados.

### Negativas / Riesgos

- **Mayor capacidad del token del bot**: un token con `workflows: write` puede
  reescribir el propio workflow. Escenario mitigado con la identidad del bot,
  el prompt endurecido, la anti-instilación de issue bodies y el `concurrency`
  single-flight existente.
- **Activación diferida**: hasta la promoción dev → main, los eventos
  automáticos siguen usando la versión sin el scope (comportamiento actual).

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: infraestructura interna de CI,
  no visible para el usuario final (no aplica la regla 3).
- **Resto de workflows intactos**: `issues-done-on-dev.yml` y
  `deploy-all-branches.yml` no requieren el scope (son los agentes de
  `auto-resolve-issues.yml` quienes hacen push de cambios de workflows).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: añadido `workflows: write` al bloque `permissions:` (1 línea) |
| `docs/adr-053-workflows-permission-github-actions.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de CI, no visible para el usuario) |

Related issue: #141 — https://github.com/gonzalitojh/Registro-personal/issues/141