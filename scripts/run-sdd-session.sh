#!/usr/bin/env bash
# =============================================================================
# run-sdd-session.sh — Ejecuta una sesión headless de opencode con protección
# contra estancamiento y límite de duración (issue #145).
#
# Sustituye al antiguo "timeout 3600 opencode run ..." del workflow
# auto-resolve-issues.yml: si la sesión falla (tokens del modelo free
# agotados, push rechazado, fallo de un subagente...) opencode podía quedar
# vivo y silencioso hasta 1 hora sin hacer nada, quemando minutos gratuitos
# de GitHub Actions. Este script:
#
#   1. Lanza opencode en background con setsid (grupo de procesos propio,
#      para poder matar también las tools hijas con kill -9 -PID).
#   2. Mantiene el log en vivo en stdout con tail -f (mismo comportamiento
#      que antes: el log de la action muestra la sesión en directo).
#   3. Watchdog: si no hay salida nueva durante SESSION_STALL_LIMIT_SEC
#      (default 600 s = 10 min) o si se supera SESSION_TOTAL_LIMIT_SEC
#      (default 2700 s = 45 min, calibrado con las ejecuciones observadas:
#      exitosas de 7-25 min), mata la sesión, imprime el motivo con
#      ::error:: y sale con exit 1 (activa wip-save y rollback del workflow).
#   4. Siempre (éxito o fallo) vuelca la transcripción completa de la
#      sesión, INCLUIDOS los logs de los subagentes, desde la base de datos
#      local de opencode (scripts/dump-session-transcript.py).
#   5. En fallo escribe el motivo en $SESSION_FAIL_REASON (por defecto
#      session-failure.txt) para que el paso de rollback del workflow lo
#      incluya en el comentario de la issue.
#
# Variables de entorno (todas con default):
#   SESSION_STALL_LIMIT_SEC  segundos sin salida nueva antes de matar (600)
#   SESSION_TOTAL_LIMIT_SEC  duración máxima total de la sesión (2700)
#   SESSION_AGENT            agente opencode (sdd-master)
#   SESSION_MODEL            modelo opencode (opencode/deepseek-v4-flash-free)
#   SESSION_VARIANT          variante del modelo (max)
#   SESSION_OUT_LOG          archivo de salida cruda (opencode-session.log)
#   SESSION_FAIL_REASON      archivo del motivo de fallo (session-failure.txt)
#
# Uso: run-sdd-session.sh <prompt-file> <titulo-sesion>
# =============================================================================
set -euo pipefail

# Raíz del repo: permite invocar el script desde cualquier directorio
# (p. ej. en CI el CWD es $GITHUB_WORKSPACE, pero también se puede probar
# en local desde /tmp).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROMPT_FILE="${1:-}"
TITLE="${2:-}"
if [[ -z "$PROMPT_FILE" || -z "$TITLE" ]]; then
  echo "::error::Uso: run-sdd-session.sh <prompt-file> <titulo-sesion>" >&2
  exit 2
fi

STALL_LIMIT_SEC="${SESSION_STALL_LIMIT_SEC:-600}"
TOTAL_LIMIT_SEC="${SESSION_TOTAL_LIMIT_SEC:-2700}"
AGENT="${SESSION_AGENT:-sdd-master}"
MODEL="${SESSION_MODEL:-opencode/deepseek-v4-flash-free}"
VARIANT="${SESSION_VARIANT:-max}"
OUT="${SESSION_OUT_LOG:-opencode-session.log}"
FAIL_REASON_FILE="${SESSION_FAIL_REASON:-session-failure.txt}"

echo "=== run-sdd-session.sh: lanzando sesión '$TITLE' ==="
echo "  agente: $AGENT | modelo: $MODEL | variante: $VARIANT"
echo "  límite de estancamiento: ${STALL_LIMIT_SEC}s sin salida nueva"
echo "  límite total: ${TOTAL_LIMIT_SEC}s"
echo "  salida cruda: $OUT | motivo de fallo: $FAIL_REASON_FILE"
echo "==================================================================="

START_TS="$(date +%s)"
START_TS_MS="$(date +%s%N | cut -c1-13)"
rm -f "$OUT" "$FAIL_REASON_FILE"
: > "$OUT"

# Lanzar en su propio grupo de procesos (setsid): kill -9 -PID mata también
# las tools hijas (p. ej. un bash tool que ejecute npm install).
setsid opencode run \
  --agent "$AGENT" \
  -m "$MODEL" \
  --variant "$VARIANT" \
  --auto \
  --format default \
  --title "$TITLE" \
  "$(cat "$PROMPT_FILE")" > "$OUT" 2>&1 &
PID=$!

# Mantener el log de la sesión en vivo en el log de la action.
tail -n +1 -f "$OUT" >&1 &
TAIL_PID=$!

# ---- Watchdog --------------------------------------------------------------
LAST_SIZE=0
LAST_ACTIVE="$START_TS"
LAST_HEARTBEAT="$START_TS"
FAILURE_REASON=""

while kill -0 "$PID" 2>/dev/null; do
  NOW="$(date +%s)"
  SIZE="$(stat -c %s "$OUT" 2>/dev/null || echo 0)"
  if [ "$SIZE" -gt "$LAST_SIZE" ]; then
    LAST_SIZE="$SIZE"
    LAST_ACTIVE="$NOW"
  fi
  IDLE=$((NOW - LAST_ACTIVE))
  ELAPSED=$((NOW - START_TS))

  if [ "$IDLE" -ge "$STALL_LIMIT_SEC" ]; then
    echo ""
    echo "::error::Sesión estancada: sin salida nueva durante ${IDLE}s (límite ${STALL_LIMIT_SEC}s). Matando la sesión."
    kill -9 -"$PID" 2>/dev/null || true
    FAILURE_REASON="estancada sin salida durante ${IDLE}s"
    break
  fi
  if [ "$ELAPSED" -ge "$TOTAL_LIMIT_SEC" ]; then
    echo ""
    echo "::error::Tiempo total agotado: ${ELAPSED}s (límite ${TOTAL_LIMIT_SEC}s). Matando la sesión."
    kill -9 -"$PID" 2>/dev/null || true
    FAILURE_REASON="tiempo total agotado (${ELAPSED}s)"
    break
  fi
  if [ $((NOW - LAST_HEARTBEAT)) -ge 120 ]; then
    LAST_HEARTBEAT="$NOW"
    echo "watchdog: sesión en curso (${ELAPSED}s transcurridos, ${IDLE}s sin salida nueva, log: ${SIZE} bytes)"
  fi
  sleep 5
done

# Recolectar el exit code (con set +e para no abortar antes del volcado).
set +e
wait "$PID"
CODE=$?
set -e
kill "$TAIL_PID" 2>/dev/null || true
wait "$TAIL_PID" 2>/dev/null || true

# ---- Transcripción (siempre: éxito o fallo) --------------------------------
echo ""
echo "==============================================================="
echo "=== Transcripción completa de la sesión (incluye subagentes) ==="
echo "==============================================================="
python3 "$ROOT/scripts/dump-session-transcript.py" "$TITLE" "$START_TS_MS" || \
  echo "(aviso: no se pudo volcar la transcripción; ver opencode-session.log)" >&2

# ---- Resultado --------------------------------------------------------------
if [ -n "$FAILURE_REASON" ]; then
  echo "$FAILURE_REASON" > "$FAIL_REASON_FILE"
  echo "::error::FALLO de la sesión automática: $FAILURE_REASON."
  exit 1
fi
if [ "$CODE" -ne 0 ]; then
  REASON="opencode terminó con exit code $CODE"
  echo "$REASON" > "$FAIL_REASON_FILE"
  echo ""
  echo "=== Últimas 80 líneas de la salida cruda de la sesión ==="
  tail -n 80 "$OUT" || true
  echo "::error::FALLO de la sesión automática: $REASON."
  exit 1
fi

echo ""
echo "run-sdd-session.sh: sesión completada con éxito (exit 0)."
exit 0
