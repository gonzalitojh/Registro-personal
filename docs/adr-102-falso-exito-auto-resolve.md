# ADR-102: Verificación de finalización real de la sesión en auto-resolve-issues (issue #314)

## Estado
Aceptado

## Fecha
2026-08-20

## Contexto

La issue #314 (type: bug, priority: high) reporta que el workflow
`.github/workflows/auto-resolve-issues.yml` termina «en ocasiones sin
finalizar la tarea ni dar un error ni nada»: el run acaba en verde pero
la issue queda a medias.

Evidencia verificada (runs 252 y 253 de Actions, ambos sobre la issue
#310): los dos runs terminaron con `conclusion: success`, el paso
«Sesión OpenCode» devolvió exit 0, pero la issue #310 siguió en
`status: in-progress` y no hubo PR actualizada ni agente publisher. En
el run 253 el transcript muestra al modelo escribiendo «Seguridad
PASS... Ahora actualizo la PR #313...» y la sesión termina justo
después, sin más tool calls.

Causa raíz: `opencode run --auto` termina con exit code 0 cuando el
modelo emite su mensaje final. El modelo free
(`opencode/deepseek-v4-flash-free`, variante max) a veces emite ese
mensaje final **en mitad del flujo SDD** (p. ej. tras el escaneo de
seguridad y antes del publisher, o mientras investiga un bug).
`scripts/run-sdd-session.sh` solo distinguía estancamiento
(`SESSION_STALL_LIMIT_SEC` = 1200 s sin actividad en la BD de
opencode), tiempo total (`SESSION_TOTAL_LIMIT_SEC` = 5400 s) y exit
code != 0; un exit 0 se interpretaba como éxito y el workflow seguía a
«Disparar despliegue» y «Resumen» sin verificar que la tarea se
completó. El watchdog no lo detecta porque el modelo **sí** tiene
actividad hasta el final: simplemente decide terminar antes de tiempo
(probablemente por límites de contexto/tokens del modelo free o por una
respuesta final prematura).

### Restricción de entorno descubierta

Durante la implementación se verificó (2026-08-20, empíricamente) que
el `GITHUB_TOKEN` de la sesión (token de la GitHub App instalada, tras
la issue #257 toda la sesión publica con `github.token`) **no tiene
permiso `workflows`**: GitHub rechaza cualquier push o ref que modifique
`.github/workflows/*` (rechazo comprobado tanto en `git push` como en
la Git Data API: blobs/trees/commits se crean, pero crear/actualizar un
ref cuyo historial cambia un workflow devuelve 403). Esto impide que
una sesión publique cambios en los workflows — la primera sesión que
necesitaba tocar uno (esta) descubrió el límite. Por eso el fix vive en
`scripts/`, un directorio publicable con el token de sesión.

## Decisión

### 1. Verificación de finalización real dentro de `run-sdd-session.sh`

Se añade la función `verify_completion` en `scripts/run-sdd-session.sh`,
invocada tras el exit 0 de opencode y antes del «sesión completada con
éxito»:

- **Opt-in por título**: solo se verifica si el título de la sesión es
  `auto: issue #N` (el formato exacto que usa el workflow para lanzarla).
  El uso local (títulos arbitrarios) no verifica y su comportamiento no
  cambia.
- **Lógica**: se lee la label `status: *` de la issue N
  (`gh issue view --json labels`, misma extracción que el paso «Determinar
  issue candidata» del workflow: una label por línea, `head -1` defensivo
  ante residuales; `gh-issue.sh set-state` garantiza una única `status: *`).
- Si la issue **sigue en `status: in-progress`**, es un **falso éxito**:
  se escribe el motivo en `$SESSION_FAIL_REASON` (por defecto
  `session-failure.txt`, el archivo que el paso «Relanzar o devolver a la
  cola en fallo de sesión» incluye en el comentario de la issue vía
  `head -c 4000`), se emite un `::error::` y el script sale con **exit 1**.
- **Cualquier otro status** (`needs-review`, `blocked`, `done`, `todo` o
  ninguno) → OK (no relanza).
- **Fail-closed deliberado**: si en una sesión `auto: issue #N` no se
  puede leer el estado (red/rate limit), también se falla: relanzar es
  seguro y acotado por `MAX_RELAUNCHES`, mientras que no verificar
  reintroduciría el bug.

Al fallar el paso de sesión del workflow entra la maquinaria de fallo
existente (issue #226): `wip-save` guarda el progreso en `wip/issue-N` y
el workflow se relanza automáticamente sobre la misma issue con el input
interno `retry` incrementado (máx. `MAX_RELAUNCHES` = 2 relanzamientos;
agotados, la issue vuelve a la cola con un comentario).

### 2. Justificación de la condición

En el flujo SDD normal una sesión que completa **siempre** termina en
`needs-review` (vía publisher) o decide parar en `blocked`/`todo`;
quedarse en `in-progress` sin publicar es exactamente el bug → la
condición no produce falsos positivos en el flujo normal.

### 3. Por qué no en el workflow (alternativa evaluada y descartada)

La alternativa natural era un paso de verificación en
`.github/workflows/auto-resolve-issues.yml` (entre «Sesión OpenCode» y
«Guardar progreso WIP»). Se descartó al descubrir la restricción de
entorno descrita arriba: con el token de sesión es imposible publicar
cualquier cambio en `.github/workflows/*`, así que un fix allí sería
impúblicable por las propias sesiones (círculo vicioso: el fix del
workflow no puede publicarse vía workflow). El script es publicable y su
contrato incluso se refuerza: un exit 0 devuelto por `run-sdd-session.sh`
garantiza que la tarea está realmente completada.

## Consecuencias

### Positivas

- **El falso éxito deja de ser silencioso**: la sesión (y por tanto el
  run) queda en rojo con un motivo claro y accionable, en vez de verde
  sin tarea completada.
- **El relanzamiento automático de la issue #226 cubre también este
  caso**: la issue se reintenta con el contexto/progreso WIP guardado.
- **El motivo viaja al comentario de la issue** (vía
  `session-failure.txt` y el paso «Relanzar o devolver a la cola») **y
  al log del run** (`::error::`), lo que permite diagnosticar el
  falso éxito sin abrir la issue.
- **El contrato de `run-sdd-session.sh` queda más fuerte**: exit 0
  significa «sesión terminada y tarea completada»; la verificación vive
  junto a la decisión del exit code, donde corresponde.
- **No requiere permiso `workflows`**: el cambio se publica con el
  token normal de sesión.

### Negativas / Riesgos

- **Relanzamiento innecesario** si un actor externo moviera la issue a
  `in-progress` durante la ventana de verificación. Inofensivo: acotado
  por `MAX_RELAUNCHES` y, tras agotarlos, la issue vuelve a la cola con
  un comentario.
- **Acoplamiento al formato del título** `auto: issue #N`: si el
  workflow cambiara ese formato, la verificación dejaría de aplicarse.
  Documentado en la cabecera del script.
- **Revisión futura**: si algún día el flujo permitiera terminar
  deliberadamente en `in-progress` (p. ej. tareas multilote divididas),
  esta verificación habría que revisarla para no relanzar en ese caso.
- **Pendiente de entorno**: la restricción de permiso `workflows` del
  token de sesión es un problema latente para cualquier futuro cambio de
  workflow (p. ej. la issue #314 solo se ha esquivado viviendo en
  `scripts/`). Conviene revisar la configuración de la GitHub App
  (permiso *Workflows*) o el bloque `permissions:` del workflow para
  restaurar la capacidad de publicación de cambios de workflow.

### Relacionado

- Extiende la issue #226 (relanzamiento automático ante fallo de sesión)
  y es coherente con #145 (watchdog de la sesión), #128 (protección WIP)
  y #245/#257 (publicación de comentarios como `github-actions[bot]`).

## Alternativas descartadas

- **Timeout fijo más corto en la sesión**: descartado — no resuelve el
  caso: el modelo no está estancado, tiene actividad hasta el final;
  simplemente emite su mensaje final antes de completar el flujo.
- **Heurística sobre el transcript/log** (p. ej. buscar «publisher» en
  la transcripción): descartado — frágil, depende del formato del log y
  del modelo, y no distingue un final prematuro de una parada legítima.
- **Paso de verificación en el workflow**: descartado por la restricción
  de entorno (permiso `workflows` ausente en el token de sesión; el fix
  sería impúblicable por las propias sesiones).

Related issue: #314 — https://github.com/gonzalitojh/Registro-personal/issues/314