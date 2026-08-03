#!/usr/bin/env bash
# =============================================================================
# bump-version.sh — Actualiza la versión de despliegue/caché de la PWA.
#
# Cada deploy debería subir este número para invalidar las cachés del
# service worker (CACHE_STATIC v2) y del navegador. El script actualiza:
#   1. Las refs de assets con ?v=<vieja> → ?v=<nueva> en index.html.
#   2. APP_VERSION = '<vieja>' → APP_VERSION = '<nueva>' en js/config.js.
#   3. Las entradas versionadas ?v=<vieja> → ?v=<nueva> en STATIC_ASSETS
#      de service-worker.js.
#   4. Verifica que los tres archivos quedaron coherentes con el nuevo valor.
#
# Uso:
#   scripts/bump-version.sh <version>
#   scripts/bump-version.sh help
# =============================================================================
set -euo pipefail

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# -----------------------------------------------------------------------------
# Validación del argumento
# -----------------------------------------------------------------------------
if [[ $# -ne 1 ]]; then
  echo "ERROR: se espera un argumento: <version>" >&2
  usage
fi
VERSION="$1"

if [[ ! "$VERSION" =~ ^[0-9A-Za-z]+$ ]]; then
  echo "ERROR: versión inválida '$VERSION'. Solo se permiten caracteres [0-9A-Za-z]." >&2
  exit 2
fi

# -----------------------------------------------------------------------------
# Rutas
# -----------------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_HTML="$ROOT/index.html"
CONFIG_JS="$ROOT/js/config.js"
SERVICE_WORKER="$ROOT/service-worker.js"

for f in "$INDEX_HTML" "$CONFIG_JS" "$SERVICE_WORKER"; do
  [[ -f "$f" ]] || { echo "ERROR: no existe $f" >&2; exit 1; }
done

# -----------------------------------------------------------------------------
# Sustituciones
# -----------------------------------------------------------------------------
sed -i -E "s/\?v=[0-9A-Za-z]+/?v=$VERSION/g" "$INDEX_HTML"
sed -i -E "s/APP_VERSION = '[0-9A-Za-z]+'/APP_VERSION = '$VERSION'/" "$CONFIG_JS"
sed -i -E "s/\?v=[0-9A-Za-z]+/?v=$VERSION/g" "$SERVICE_WORKER"

# -----------------------------------------------------------------------------
# Verificación de coherencia
# -----------------------------------------------------------------------------
ok=1

if grep -q "?v=$VERSION" "$INDEX_HTML"; then
  echo "OK: index.html tiene refs con ?v=$VERSION"
else
  echo "AVISO: index.html NO tiene ninguna ref con ?v=$VERSION" >&2
  ok=0
fi

if grep -q "APP_VERSION = '$VERSION'" "$CONFIG_JS"; then
  echo "OK: js/config.js tiene APP_VERSION = '$VERSION'"
else
  echo "AVISO: js/config.js NO tiene APP_VERSION = '$VERSION'" >&2
  ok=0
fi

sw_count="$(grep -c "?v=$VERSION" "$SERVICE_WORKER" || true)"
echo "OK: service-worker.js tiene $sw_count entradas con ?v=$VERSION"
if [[ "$sw_count" -eq 0 ]]; then
  echo "AVISO: service-worker.js NO tiene entradas versionadas con ?v=$VERSION" >&2
  ok=0
fi

if [[ "$ok" -eq 1 ]]; then
  echo "bump-version.sh: los tres archivos quedaron coherentes con $VERSION."
else
  echo "bump-version.sh: hay AVISOS pendientes, revisa lo anterior." >&2
  exit 3
fi
