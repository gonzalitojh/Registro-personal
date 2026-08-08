# ADR-052: `removeLabel` en lugar de `deleteLabel` en issues-done-on-dev (issue #124)

## Estado
Aceptado

## Fecha
2026-08-08

## Contexto

El workflow `.github/workflows/issues-done-on-dev.yml` (esquema de labels
documentado en ADR-034) marca como `status: done` y cierra, al pushear a `dev`,
todas las issues que tienen la label `status: needs-review`. El bucle de
limpieza retiraba de cada issue las labels `status: *` (excepto `status: done`)
y los residuales `ai-*` usando `github.rest.issues.deleteLabel`.

El problema: `deleteLabel` llama a `DELETE /repos/{owner}/{repo}/labels/{name}`,
cuyo endpoint elimina la etiqueta **del repositorio completo**, afectando a
**todas** las issues que la usan — y no solo retirarla de la issue concreta,
que era la intención. Consecuencias observadas (issue #124):

- La etiqueta `status: needs-review` desaparecía del repositorio de forma
  recurrente, afectando a todas las issues (de agente y de usuario).
- La desaparición provocaba en ocasiones errores en la propia action: al no
  existir la label en el repo, las llamadas que la referenciaban fallaban y el
  marcado a `status: done` / cierre quedaba a medias.

La llamada correcta para retirar la etiqueta solo de una issue es
`github.rest.issues.removeLabel` (`DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}`).

Nota de proceso: una sesión automática anterior (rama `fix/issue-124-etiqueta-needs-review`)
realizó este fix, ADR y task file, pero el runner era efímero y el trabajo se
perdió sin publicarse (el bot no tenía permiso `workflows`). El usuario concedió
los permisos y la tarea se reimplementa con la misma especificación.

Related issue: #124 — https://github.com/gonzalitojh/Registro-personal/issues/124

## Decisión

En `.github/workflows/issues-done-on-dev.yml`, sustituir
`github.rest.issues.deleteLabel` por `github.rest.issues.removeLabel`, envuelto
en try/catch defensivo:

### 1. `removeLabel` en lugar de `deleteLabel`

El bucle de limpieza retira ahora la label de cada issue concreta
(`DELETE .../issues/{issue_number}/labels/{name}`) en lugar de borrar la
etiqueta del repositorio. El resto del flujo se mantiene intacto: añadir
`status: done` si la issue no la tiene, cerrar la issue si está abierta y la
salvaguarda anti-PR.

### 2. Try/catch defensivo

Cada llamada a `removeLabel` se envuelve en
`try { ... } catch (error) { core.warning(...) }`: si la label ya no está en la
issue (p. ej. retirada manualmente, o 404 por cualquier motivo), se emite un
warning con el número de la issue y el mensaje del error, y el bucle continúa
procesando el resto de labels e issues sin romper la ejecución.

## Alternativas descartadas

- **Mantener `deleteLabel` y recrear la etiqueta después**: descartado — la
  recreación no es atómica: deja una ventana en la que la label no existe (errores
  en otras acciones, en `scripts/gh-issue.sh` y en el propio workflow) y no
  corrige la causa raíz (borrar la etiqueta del repo completo).
- **Envolver `deleteLabel` en try/catch sin cambiar de endpoint**: descartado —
  el try/catch evita el fallo del run, pero la etiqueta del repo ya se habría
  perdido; no cumple el requisito de que la label permanezca en el repositorio.

## Consecuencias

### Positivas

- **La etiqueta `status: needs-review` persiste en el repositorio**: la action
  solo la retira de cada issue, como era la intención; deja de desaparecer del
  repo y de afectar a otras issues.
- **Flujo robusto por issue**: si una label no está presente en una issue, el
  try/catch emite `core.warning` y el bucle sigue; el marcado a `status: done`
  y el cierre se completan para el resto de issues.
- **Diagnóstico visible en CI**: el warning del catch incluye el número de la
  issue y el mensaje del error (p. ej. el 404), lo que facilita la auditoría de
  runs posteriores.
- **Sin cambio de comportamiento externo**: la action procesa el mismo conjunto
  de issues y produce el mismo resultado visible; cambia solo la forma de
  retirar las labels.

### Negativas / Riesgos

- **Warnings de 404 esperables**: si una label del `toRemove` ya no está en la
  issue, el catch produce un `core.warning` (ruido en el log, no falla el run).
  Riesgo aceptado: es preferible a romper la ejecución y a borrar la etiqueta
  del repositorio.
- **Ruido transitorio con los residuales `ai-*`**: las issues con labels
  residuales del esquema antiguo pueden generar warnings hasta que la limpieza
  las elimine; es un caso límite que se resuelve con las propias ejecuciones.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: cambio interno de infraestructura
  de CI, no visible para el usuario final de la web (no aplica la regla 3 de
  AGENTS.md).
- **Permisos y salvaguardas intactos**: `issues: write`, triggers (`push` a
  `dev` + `workflow_dispatch`) y la salvaguarda anti-PR se mantienen sin cambios.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/issues-done-on-dev.yml` | **Modificado**: `github.rest.issues.deleteLabel` → `github.rest.issues.removeLabel` en el bucle de limpieza, envuelto en try/catch defensivo con `core.warning` (el run no falla si la label no está en la issue); mensaje de éxito actualizado («retirada de la issue» en vez de «eliminada») |
| `docs/adr-052-remove-label-vs-delete-label.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de CI, no visible para el usuario) |

Related issue: #124 — https://github.com/gonzalitojh/Registro-personal/issues/124