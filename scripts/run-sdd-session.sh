#!/usr/bin/env bash
# =============================================================================
# run-sdd-session.sh — Ejecuta una sesión headless de opencode con protección
# contra estancamiento y límite de duración (issue #145, iteración 2).
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
#   3. Watchdog POR ACTIVIDAD REAL (iteración 2): la señal de estancamiento
#      NO es el tamaño del log crudo (opencode no emite la salida de los
#      subagentes en el stream, así que el log no crecía mientras un
#      subagente trabajaba → falsos positivos). En su lugar, cada iteración
#      consulta la BD local de opencode (dump-session-transcript.py
#      --activity) y considera actividad el MAX(time_updated) de mensajes y
#      parts de TODAS las sesiones del árbol (primaria + subagentes). Solo
#      se mata la sesión si NO hay actividad en todo el árbol durante
#      SESSION_STALL_LIMIT_SEC (default 1200 s = 20 min) o si se supera
#      SESSION_TOTAL_LIMIT_SEC (default 3600 s = 60 min).
#   4. Si la BD no está disponible (3 sondas fallidas consecutivas), entra
#      en MODO DEGRADADO: avisa con ::warning:: y deja de matar por
#      estancamiento (solo aplica el límite total) — política elegida para
#      eliminar de raíz los falsos positivos (el fallback de tamaño de log
#      fue precisamente lo que mató la sesión de la issue #135).
#   5. STREAMING EN VIVO de los subagentes: lanza dump-session-transcript.py
#      --watch en background, que imprime en stdout los mensajes de las
#      sesiones hijas a medida que se completan (issue #145, iteración 2).
#   6. Siempre (éxito o fallo) vuelca la transcripción completa de la
#      sesión, INCLUIDOS los logs de los subagentes (modo dump).
#   7. En fallo escribe el motivo en $SESSION_FAIL_REASON (por defecto
#      session-failure.txt) para que el paso de rollback del workflow lo
#      incluya en el comentario de la issue.
#
# Variables de entorno (todas con default):
#   SESSION_STALL_LIMIT_SEC  segundos sin actividad (BD) antes de matar (1200)
#   SESSION_TOTAL_LIMIT_SEC  duración máxima total de la sesión (3600)
#   SESSION_WATCH_POLL_SEC   intervalo de polling del streaming (5)
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

STALL_LIMIT_SEC="${SESSION_STALL_LIMIT_SEC:-1200}"
TOTAL_LIMIT_SEC="${SESSION_TOTAL_LIMIT_SEC:-3600}"
WATCH_POLL_SEC="${SESSION_WATCH_POLL_SEC:-5}"
AGENT="${SESSION_AGENT:-sdd-master}"
MODEL="${SESSION_MODEL:-opencode/deepseek-v4-flash-free}"
VARIANT="${SESSION_VARIANT:-max}"
OUT="${SESSION_OUT_LOG:-opencode-session.log}"
FAIL_REASON_FILE="${SESSION_FAIL_REASON:-session-failure.txt}"

echo "=== run-sdd-session.sh: lanzando sesión '$TITLE' ==="
echo "  agente: $AGENT | modelo: $MODEL | variante: $VARIANT"
echo "  límite de estancamiento: ${STALL_LIMIT_SEC}s sin actividad (BD de opencode)"
echo "  límite total: ${TOTAL_LIMIT_SEC}s"
echo "  streaming subagentes: polling ${WATCH_POLL_SEC}s"
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

# Streaming en vivo de los subagentes (best-effort): imprime los mensajes de
# las sesiones hijas a medida que se completan. Termina con SIGTERM.
python3 "$ROOT/scripts/dump-session-transcript.py" --watch "$TITLE" "$START_TS_MS" "$WATCH_POLL_SEC" >&1 &
WATCH_PID=$!
# Red de seguridad: si el script muere (p. ej. por set -e), se limpian los
# procesos en background (tail del log + watcher de subagentes).
trap 'kill "$TAIL_PID" 2>/dev/null || true; kill "$WATCH_PID" 2>/dev/null || true' EXIT

# ---- Watchdog --------------------------------------------------------------
# Actividad = MAX(time_updated) de mensajes/parts de TODAS las sesiones del
# árbol (primaria + subagentes), vía sonda a la BD de opencode.
LAST_ACTIVITY_TS=0
LAST_ACTIVE="$START_TS"
LAST_HEARTBEAT="$START_TS"
DB_PROBE_FAILURES=0
DEGRADED=0
FAILURE_REASON=""

probe_activity() {
  # Sonda de actividad. Devuelve (en stdout) el epoch_ms del último cambio
  # en la BD, o falla (exit 1) si la BD no está disponible. Best-effort.
  python3 "$ROOT/scripts/dump-session-transcript.py" --activity "$TITLE" "$START_TS_MS" 2>/dev/null
}

while kill -0 "$PID" 2>/dev/null; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - START_TS))

  # Sonda de actividad real por BD (solo si no estamos degradados).
  if [ "$DEGRADED" -eq 0 ]; then
    if ACTIVITY_TS="$(probe_activity)"; then
      DB_PROBE_FAILURES=0
      # Sanear: solo dígitos (un "0" es válido: sin sesión aún en BD).
      ACTIVITY_TS="${ACTIVITY_TS//[^0-9]/}"
      ACTIVITY_TS="${ACTIVITY_TS:-0}"
      if [ "$ACTIVITY_TS" -gt "$LAST_ACTIVITY_TS" ]; then
        LAST_ACTIVITY_TS="$ACTIVITY_TS"
        LAST_ACTIVE="$NOW"
      fi
    else
      DB_PROBE_FAILURES=$((DB_PROBE_FAILURES + 1))
      if [ "$DB_PROBE_FAILURES" -ge 3 ]; then
        DEGRADED=1
        echo "::warning::BD de opencode no disponible; modo degradado: sin kill por estancamiento (solo límite total ${TOTAL_LIMIT_SEC}s)."
      fi
    fi
  fi

  IDLE=$((NOW - LAST_ACTIVE))

  if [ "$DEGRADED" -eq 0 ] && [ "$IDLE" -ge "$STALL_LIMIT_SEC" ]; then
    echo ""
    echo "::error::Sesión estancada: sin actividad en la BD de opencode durante ${IDLE}s (límite ${STALL_LIMIT_SEC}s). Matando la sesión."
    kill -9 -"$PID" 2>/dev/null || true
    FAILURE_REASON="estancada sin actividad durante ${IDLE}s"
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
    if [ "$DEGRADED" -eq 1 ]; then
      echo "watchdog: sesión en curso (${ELAPSED}s transcurridos, modo degradado sin estancamiento, log: $(stat -c %s "$OUT" 2>/dev/null || echo 0) bytes)"
    else
      echo "watchdog: sesión en curso (${ELAPSED}s transcurridos, ${IDLE}s sin actividad, última actividad BD: $(date -u -d @"$((LAST_ACTIVITY_TS / 1000))" +%H:%M:%S 2>/dev/null || echo '?') UTC)"
    fi
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
kill "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true

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
