# ADR-054: Watchdog de la sesión de opencode y logs de subagentes en auto-resolve-issues (issue #145)

## Estado
Aceptado

## Fecha
2026-08-08

## Contexto

El workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047) lanza
sesiones headless de opencode (agente `sdd-master`, modelo free
`opencode/deepseek-v4-flash-free`, variante `max`) para resolver issues del
backlog. La sesión se invocaba con `timeout 3600 opencode run ...` y el step
con `timeout-minutes: 90`.

Dos problemas observados en la operación real:

1. **Sesión viva y silenciosa hasta 1 hora tras un fallo**: cuando la sesión
   fallaba (tokens gratuitos del modelo free agotados, `git push` rechazado,
   fallo de un subagente...), opencode quedaba vivo sin producir salida hasta
   agotar el `timeout 3600`, quemando minutos gratuitos de GitHub Actions sin
   hacer nada. Las ejecuciones exitosas observadas tardaban 7-25 minutos; el
   run fallido quemó ~60 minutos hasta el timeout.
2. **Sin logs de subagentes en el log de la action**: solo se veía el
   inicio/fin de cada subagente («• ... subagent» / «✓ ...»), nunca su
   contenido, porque `opencode run --format json/default` **filtra los parts de
   las sesiones hijas** (verificado en el fuente de opencode v1.18.7,
   `run.ts`, línea 717) y `--print-logs` solo ofrece metadatos, sin el
   contenido de los mensajes.

La issue #145 pide: (1) detener la ejecución con un output adecuado cuando
falle cualquier componente, incluido un subagente; (2) un límite de tiempo que
evite quedar estancado en un único paso (~10 minutos sugeridos, ajustado a las
ejecuciones observadas); (3) ver en el log de la action también los logs de
los subagentes.

Related issue: #145 — https://github.com/gonzalitojh/Registro-personal/issues/145

## Decisión

### 1. Nuevo `scripts/run-sdd-session.sh`: watchdog de la sesión

Sustituye al antiguo `timeout 3600 opencode run ...` del workflow. Lanza
opencode en background y lo supervisa:

- **`setsid`**: la sesión corre en su propio grupo de procesos, de modo que
  `kill -9 -$PID` mata también las tools hijas (p. ej. un `bash` tool
  ejecutando `npm install`), no solo el proceso de opencode.
- **`tail -f` del log en vivo**: la salida cruda se escribe en
  `opencode-session.log` y se replica a stdout, manteniendo el comportamiento
  anterior de logs en directo en la action.
- **Detección de estancamiento**: si no hay salida nueva durante
  `SESSION_STALL_LIMIT_SEC` (default **600 s = 10 min**, configurable por env),
  mata la sesión, imprime el motivo con `::error::` y escribe el motivo en
  `session-failure.txt`.
- **Límite total**: `SESSION_TOTAL_LIMIT_SEC` (default **2700 s = 45 min**,
  configurable por env), calibrado con los runs observados (exitosos de
  7-25 min; el fallido quemó 60 min). Reemplaza al timeout fijo de 3600 s.
- **Heartbeat**: cada 120 s imprime un aviso de «sesión en curso» con el
  tiempo transcurrido, los segundos sin salida y el tamaño del log, para
  mantener visible que el watchdog sigue activo.
- **Exit codes**: `exit 1` en cualquier fallo (estancamiento, límite total o
  exit code no nulo de opencode), lo que activa los pasos `wip-save` y
  `rollback` de la issue #128; `exit 0` en éxito. El motivo del fallo se
  escribe siempre en `session-failure.txt` (ruta configurable con
  `SESSION_FAIL_REASON`).
- Otras variables de entorno configurables: `SESSION_AGENT` (sdd-master),
  `SESSION_MODEL` (opencode/deepseek-v4-flash-free), `SESSION_VARIANT` (max),
  `SESSION_OUT_LOG` (opencode-session.log).
- Uso: `bash scripts/run-sdd-session.sh <prompt-file> <titulo-sesion>`.

### 2. Nuevo `scripts/dump-session-transcript.py`: transcripción con logs de subagentes

El stream stdout de `opencode run` no expone el contenido de los subagentes,
pero opencode **almacena todos los mensajes** (sesión primaria y sesiones
hijas enlazadas por `parent_id`) en su base de datos SQLite local
(`~/.local/share/opencode/opencode.db`). El script reconstruye el log
completo leyendo esa base **en modo read-only** (`mode=ro`, URI):

- **Sesión primaria del run**: se busca por título exacto + `time_created`
  posterior al arranque (margen de 60 s) + `parent_id IS NULL` (refuerza que
  sea una sesión raíz, nunca un subagente).
- **Sesiones hijas**: CTE recursiva sobre `session.parent_id` para incluir
  todos los descendientes de la sesión primaria.
- **Mensajes `assistant` de todas las sesiones del run, en orden temporal**,
  con cabecera `--- HH:MM:SS | agente [subagente] ---` que identifica agente y
  momento.
- **Contenido**: parts `type=text` completados (`time.end`) y errores de
  tools (`type=tool` con `state.status == "error"`).
- **Best-effort**: ante cualquier problema (db no encontrada, error de
  consulta, sesión no hallada) imprime un aviso en stderr y sale con 0 —
  nunca hace fallar el workflow por un diagnóstico.

El script se invoca **siempre**, tanto en éxito como en fallo, desde
`run-sdd-session.sh` con el título de la sesión y el timestamp de arranque en
ms.

### 3. Cambios en `.github/workflows/auto-resolve-issues.yml`

- El paso «Sesión OpenCode» llama ahora a
  `bash scripts/run-sdd-session.sh "sdd_prompt.md" "auto: issue #$N"`
  (`timeout-minutes: 60` en el step; el job mantiene `timeout-minutes: 90`).
  El watchdog acota la sesión muy por debajo del timeout del step/job.
- **`wip-save`** (issue #128) excluye los nuevos artefactos del commit de
  guardado, además de `candidate.json` y `sdd_prompt.md`:
  `:(exclude)opencode-session.log` y `:(exclude)session-failure.txt`.
- **`rollback`** incluye el motivo del fallo en el comentario de la issue:
  lee `session-failure.txt` y lo incorpora con
  `head -c 4000` (truncado a 4000 bytes) como « Motivo: ...».
- **`.gitignore`**: se añaden `opencode-session.log` y `session-failure.txt`
  como defensa en profundidad (protegen de un `git add -A` manual, además de
  las exclusiones explícitas del wip-save).

### 4. Comportamiento del flujo SDD intacto

No se altera el resto del flujo (AC7): micro-commits, rama de PR contra `dev`,
publisher, reclamación, restauración WIP y despliegue siguen idénticos.

## Consideraciones

- **El watchdog sustituye, no complementa, al `timeout`**: el antiguo
  `timeout 3600` se elimina; los límites del script (10 min de estancamiento,
  45 min totales) son mucho más estrictos y tienen motivo de fallo explícito.
- **El dump es post-mortem, no en vivo**: la transcripción completa (con
  subagentes) se imprime al final de la sesión, éxito o fallo; durante la
  ejecución el log de la action sigue mostrando solo la salida en vivo del
  stream (sin subagentes) — limitación del propio opencode, no del script.
- **Los artefactos del run no viajan al repo**: log crudo y motivo de fallo
  quedan excluidos del wip-save y del `.gitignore`; la PR del agente nunca los
  incluye.
- **Sin cambios visibles para el usuario**: no aplica la regla 3 de AGENTS.md
  (`docs/manual-de-usuario.md` no se toca).

## Alternativas descartadas

- **`--fail-fast` de opencode**: descartado — el flag no existe en v1.18.7.
- **`--format json` para detectar errores y mostrar subagentes**: descartado —
  verificado en el fuente de v1.18.7 (`run.ts` línea 717): el formato
  json/default filtra igualmente los parts de las sesiones hijas; los eventos
  del stream no contienen el contenido de los subagentes.
- **`--print-logs`**: descartado — solo expone metadatos de las sesiones
  (títulos, tiempos), sin el contenido de los mensajes.
- **Leer los JSONL del storage de opencode**: descartado — v1.18.7 persiste en
  SQLite (`opencode.db`), no en JSONL; se complementa con la lectura directa
  de la base, que es la fuente que contiene los mensajes de los subagentes.

## Consecuencias

### Positivas

- **Fin de la sesión zombi**: una sesión estancada (10 min sin salida) o que
  supera los 45 min totales se mata con motivo claro en `::error::`; los
  minutos gratuitos de GitHub Actions dejan de quemarse hasta el timeout de 1
  hora.
- **Diagnóstico completo**: la transcripción con logs de subagentes (texto y
  errores de tools) se imprime siempre, y el motivo del fallo llega al
  comentario de la issue (rollback) y al log de la action.
- **Cadena de fallo preservada**: el `exit 1` del watchdog activa `wip-save`
  y `rollback` (issue #128): el progreso intermedio se guarda en `wip/issue-N`
  y la issue vuelve a la cola con el motivo.
- **Configurable por env**: límites y parámetros de la sesión se ajustan sin
  tocar el workflow.

### Negativas / Riesgos

- **Una sesión legítimamente larga (>45 min) se cortaría**: riesgo acotado —
  el límite se calibró con las ejecuciones observadas (exitosas de 7-25 min);
  es configurable vía `SESSION_TOTAL_LIMIT_SEC` si el flujo cambiara.
- **Dependencia del esquema/ruta de la db local de opencode**: el dump lee
  `~/.local/share/opencode/opencode.db` con el esquema de v1.18.7; si una
  versión futura cambiara ubicación o tablas, el volcado se degrada a un
  aviso (best-effort) y el workflow no falla, pero se perdería el diagnóstico.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: infraestructura interna de CI,
  no visible para el usuario final (no aplica la regla 3).
- **Resto del flujo SDD intacto**: micro-commits, rama de PR contra `dev`,
  publisher, restauración WIP y dispatch de despliegue no se tocan (AC7).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `scripts/run-sdd-session.sh` | **Nuevo**: watchdog de la sesión — `setsid` (grupo de procesos propio, `kill -9 -PID` mata también tools hijas), `tail -f` del log en vivo, estancamiento (`SESSION_STALL_LIMIT_SEC`, default 600 s), límite total (`SESSION_TOTAL_LIMIT_SEC`, default 2700 s), heartbeat cada 120 s, motivo en `::error::` + `session-failure.txt`, `exit 1` en fallo (activa wip-save/rollback) / `exit 0` en éxito |
| `scripts/dump-session-transcript.py` | **Nuevo**: vuelca siempre la transcripción completa desde la db SQLite local de opencode (mode=ro) — sesión primaria por título + `time_created` + `parent_id IS NULL`, CTE recursiva de sesiones hijas, mensajes assistant en orden temporal con cabecera `--- HH:MM:SS \| agente [subagente] ---`, parts `type=text` completados y errores de tools; best-effort (nunca falla el workflow) |
| `.github/workflows/auto-resolve-issues.yml` | **Modificado**: paso «Sesión OpenCode» llama a `bash scripts/run-sdd-session.sh "sdd_prompt.md" "auto: issue #$N"` (step `timeout-minutes: 60`, job 90); `wip-save` excluye `opencode-session.log` y `session-failure.txt` (además de `candidate.json` y `sdd_prompt.md`); `rollback` incluye el motivo del fallo (`head -c 4000` de `session-failure.txt`) en el comentario de la issue |
| `.gitignore` | **Modificado**: añadidos `opencode-session.log` y `session-failure.txt` (defensa en profundidad frente a `git add -A` manual) |
| `docs/adr-054-watchdog-sesion-opencode-y-logs-subagentes.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de CI, no visible para el usuario) |

Related issue: #145 — https://github.com/gonzalitojh/Registro-personal/issues/145
