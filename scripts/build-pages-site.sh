#!/usr/bin/env bash
# =============================================================================
# build-pages-site.sh — Construye `_site/` (raíz del repo) con TODAS las
# ramas del repositorio, listo para GitHub Pages con Actions.
#
# Estructura resultante de _site/:
#   - Rama por defecto (main)      → extraída en la raíz: _site/
#   - Cada rama no-default         → _site/<ruta-saneada-de-rama>/
#   - Un .nojekyll por carpeta     → Pages no aplica Jekyll y sirve tal cual.
#
# Usado por .github/workflows/deploy-all-branches.yml.
# En local también se puede ejecutar para previsualizar el sitio.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# -----------------------------------------------------------------------------
# 1) Refrescar refs/remotes/origin/*. En CI es redundante (checkout con
#    fetch-depth: 0 ya trae todas las ramas); en local permite probar el
#    script con las ramas actuales. Solo si existe un remoto "origin".
# -----------------------------------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' || true
fi

# -----------------------------------------------------------------------------
# 2) Listar ramas remotas. Usamos el refname COMPLETO y recortamos el
#    prefijo 'refs/remotes/origin/' para filtrar de forma robusta el puntero
#    HEAD (origin/HEAD), que en local aparece con formas distintas según la
#    versión de git (origin/HEAD o simplemente origin).
# -----------------------------------------------------------------------------
mapfile -t BRANCHES < <(
  git for-each-ref --format='%(refname)' refs/remotes/origin \
    | sed 's|^refs/remotes/origin/||' \
    | grep -v '^HEAD$'
)

if [ "${#BRANCHES[@]}" -eq 0 ]; then
  echo "::error::No se encontró ninguna rama en refs/remotes/origin/*. No se puede construir _site." >&2
  exit 1
fi
echo "Ramas detectadas: ${BRANCHES[*]}"

# -----------------------------------------------------------------------------
# 3) Rama por defecto: la que apunta origin/HEAD (normalmente main).
#    Si no existe origin/HEAD, fallback a "main".
# -----------------------------------------------------------------------------
DEFAULT_BRANCH="main"
if origin_head="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null)"; then
  candidate="${origin_head#refs/remotes/origin/}"
  if git rev-parse --verify --quiet "refs/remotes/origin/${candidate}" >/dev/null; then
    DEFAULT_BRANCH="${candidate}"
  fi
fi
echo "Rama por defecto: ${DEFAULT_BRANCH}"

# -----------------------------------------------------------------------------
# 4) Limpiar y preparar _site/ (+ .nojekyll en la raíz) y extraer la rama
#    por defecto en la raíz.
# -----------------------------------------------------------------------------
# strip_sensitive: defensa en profundidad. Si en el futuro se commitea un
# fichero sensible en cualquier rama (p. ej. .env, *.pem, *.key,
# service-account.json), se serviría públicamente en el despliegue. Se
# excluyen del árbol extraído (raíz y ramas). Se define antes del primer uso.
strip_sensitive() {
  local dir="$1"
  find "${dir}" -type f \( \
       -name '.env' -o -name '.env.*' \
    -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
    -o -name '*service-account*.json' -o -name 'credentials*.json' \) \
    -delete
}

rm -rf _site
mkdir -p _site
echo > _site/.nojekyll

echo "Extrayendo rama por defecto (${DEFAULT_BRANCH}) → raíz de _site"
git archive "origin/${DEFAULT_BRANCH}" | tar -x -C _site
strip_sensitive _site

# -----------------------------------------------------------------------------
# 5) Saneamiento de nombres de rama. Mantiene jerarquías con '/': cada
#    segmento se normaliza a [A-Za-z0-9._-] (todo lo demás → '-'), se
#    colapsan los '-' repetidos, se recortan '-'/'.' de los extremos y un
#    segmento vacío pasa a llamarse 'branch'.
# -----------------------------------------------------------------------------
sanitize_segment() {
  local seg="$1"
  # Reemplazar todo carácter fuera de [A-Za-z0-9._-] por '-'
  seg="${seg//[^A-Za-z0-9._-]/-}"
  # Colapsar '-' repetidos y recortar '-'/'.' iniciales/finales
  seg="$(printf '%s' "${seg}" | sed -E 's/-+/-/g; s/^[-.]+//; s/[-.]+$//')"
  # Segmento vacío → 'branch'
  if [ -z "${seg}" ]; then seg="branch"; fi
  printf '%s' "${seg}"
}

branch_path() {
  local seg=""
  local out=""
  local parts=()
  local IFS='/'
  read -r -a parts <<< "$1"
  for seg in "${parts[@]}"; do
    seg="$(sanitize_segment "${seg}")"
    if [ -n "${out}" ]; then out="${out}/${seg}"; else out="${seg}"; fi
  done
  if [ -z "${out}" ]; then out="branch"; fi
  printf '%s' "${out}"
}

# -----------------------------------------------------------------------------
# 6) Checks de colisión ANTES de extraer ramas (evita sobrescribir la raíz
#    o entre sí en el despliegue).
# -----------------------------------------------------------------------------
NON_DEFAULT_PATHS=()
for b in "${BRANCHES[@]}"; do
  if [ "${b}" != "${DEFAULT_BRANCH}" ]; then
    NON_DEFAULT_PATHS+=("$(branch_path "${b}")")
  fi
done

# a) Duplicados entre rutas saneadas de ramas
duplicates="$(printf '%s\n' "${NON_DEFAULT_PATHS[@]}" | sort | uniq -d)"
if [ -n "${duplicates}" ]; then
  echo "::error::Colisión entre rutas saneadas de ramas: $(printf '%s' "${duplicates}" | tr '\n' ' ')" >&2
  exit 1
fi

# b) Colisión con entradas top-level de la rama raíz (index.html, css/, ...)
top_level="$(git ls-tree --name-only "origin/${DEFAULT_BRANCH}")"
for bp in "${NON_DEFAULT_PATHS[@]}"; do
  first_segment="${bp%%/*}"
  if printf '%s\n' "${top_level}" | grep -qxF "${first_segment}"; then
    echo "::error::La rama con ruta saneada '${bp}' colisiona con la entrada '${first_segment}' de la raíz (origin/${DEFAULT_BRANCH}). Renombra la rama." >&2
    exit 1
  fi
done

# -----------------------------------------------------------------------------
# 6b) Nota: la función strip_sensitive está definida en el paso 4 (antes de
#     su primer uso) y se aplica a la raíz y a cada rama extraída.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# 7) Extraer cada rama no-default en su subdirectorio (+ .nojekyll por
#    robustez dentro de cada carpeta de rama).
# -----------------------------------------------------------------------------
for b in "${BRANCHES[@]}"; do
  if [ "${b}" = "${DEFAULT_BRANCH}" ]; then continue; fi
  bp="$(branch_path "${b}")"
  dest="_site/${bp}"
  echo "Extrayendo rama '${b}' → ${dest}/"
  mkdir -p "${dest}"
  git archive "origin/${b}" | tar -x -C "${dest}"
  echo > "${dest}/.nojekyll"
  strip_sensitive "${dest}"
done

# -----------------------------------------------------------------------------
# 8) Resumen final para los logs
# -----------------------------------------------------------------------------
echo "----------------------------------------"
echo "Tamaño total de _site:"
du -sh _site
echo "Directorio raíz de _site (carpetas de rama):"
find _site -mindepth 1 -maxdepth 1 -type d | sort
echo "Archivos en _site (uno por línea):"
find _site -type f | sort
echo "----------------------------------------"
echo "build-pages-site.sh: _site construido correctamente."
