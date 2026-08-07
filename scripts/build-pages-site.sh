#!/usr/bin/env bash
# =============================================================================
# build-pages-site.sh — Construye `_site/` (raíz del repo) con TODAS las
# ramas del repositorio, listo para GitHub Pages con Actions.
#
# Estructura resultante de _site/:
#   - Rama por defecto (main)      → extraída en la raíz: _site/
#   - Hub de previews              → _site/dev/ con un índice auto-generado
#                                    (_site/dev/index.html) con enlaces a
#                                    todas las ramas no-default y a la raíz
#   - Cada rama no-default         → _site/dev/<ruta-saneada-de-rama>/
#                                    (incluida dev → _site/dev/dev/)
#   - Un .nojekyll por carpeta     → Pages no aplica Jekyll y sirve tal cual
#                                    (raíz, hub y cada carpeta de rama).
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
# html_escape: escapa & < > " ' (cinco entidades estándar) para incrustar
# texto visible en el HTML del índice. Los href usan rutas saneadas (solo
# [A-Za-z0-9._-] y '/'), pero se escapan también por defensa en profundidad.
# -----------------------------------------------------------------------------
html_escape() {
  local s="$1"
  # sed para escapar: en la expansión de patrones de bash, '&' en el
  # reemplazo se sustituye por el texto que casó con el patrón (p. ej.
  # ${s//</&lt;} → '<lt;'), por eso se usa sed, donde '\&' sí es literal.
  s="$(printf '%s' "${s}" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&#39;/g')"
  printf '%s' "${s}"
}

# -----------------------------------------------------------------------------
# build_hub_index: genera _site/dev/index.html, el hub de previews. Recibe
# una línea por rama no-default con el formato "NOMBRE<TAB>ruta" (ruta
# saneada RELATIVA al hub, sin el prefijo 'dev/'), ya ordenadas por nombre
# original (LC_ALL=C sort). El separador es un tab porque git no permite
# caracteres de control en los nombres de rama. El HTML se monta acumulando
# líneas en una variable con printf (sin heredoc con interpolación: con
# set -u y nombres de rama raros es frágil). Sin timestamps ni fechas: dos
# builds producen un índice byte-idéntico.
# -----------------------------------------------------------------------------
build_hub_index() {
  local entries=("$@")
  local html=""
  local line="" name="" rel=""

  mkdir -p _site/dev

  html="$(printf '%s\n' \
    '<!DOCTYPE html>' \
    '<html lang="es">' \
    '<head>' \
    '  <meta charset="utf-8">' \
    '  <meta name="viewport" content="width=device-width, initial-scale=1">' \
    '  <title>Previews de ramas</title>' \
    '  <style>' \
    '    :root { color-scheme: light dark; }' \
    '    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 1rem; line-height: 1.5; padding: 1.5rem; }' \
    '    main { max-width: 40rem; margin: 0 auto; }' \
    '    h1 { font-size: 1.6rem; overflow-wrap: anywhere; }' \
    '    p { overflow-wrap: anywhere; }' \
    '    ul { list-style: none; padding: 0; }' \
    '    li { margin: 0.6rem 0; }' \
    '    a { overflow-wrap: anywhere; }' \
    '  </style>' \
    '</head>' \
    '<body>' \
    '  <main>' \
    '    <h1>Previews de ramas</h1>' \
    '    <p>Cada rama no-default del repositorio tiene su preview bajo esta ruta. Usa el enlace de abajo para volver a la raíz (producción, main).</p>' \
    '    <ul>' \
    '      <li><a href="../">main — raíz (producción)</a></li>')"

  for line in "${entries[@]}"; do
    name="${line%%$'\t'*}"
    rel="${line#*$'\t'}"
    html="${html}"$'\n'"$(printf '      <li><a href="%s/">%s</a></li>' "$(html_escape "${rel}")" "$(html_escape "${name}")")"
  done

  html="${html}"$'\n'"$(printf '%s\n' \
    '    </ul>' \
    '  </main>' \
    '</body>' \
    '</html>')"

  printf '%s\n' "${html}" > _site/dev/index.html
}

# -----------------------------------------------------------------------------
# 6) Checks de colisión ANTES de extraer ramas (evita sobrescribir la raíz,
#    el índice del hub o entre sí en el despliegue). Todas las ramas
#    no-default comparten el primer segmento: HUB_DIR (hub de previews).
# -----------------------------------------------------------------------------
HUB_DIR="dev"

NON_DEFAULT_PATHS=()
for b in "${BRANCHES[@]}"; do
  if [ "${b}" != "${DEFAULT_BRANCH}" ]; then
    NON_DEFAULT_PATHS+=("${HUB_DIR}/$(branch_path "${b}")")
  fi
done

# a) Duplicados entre rutas saneadas de ramas (rutas completas con prefijo)
duplicates="$(printf '%s\n' "${NON_DEFAULT_PATHS[@]}" | sort | uniq -d)"
if [ -n "${duplicates}" ]; then
  echo "::error::Colisión entre rutas saneadas de ramas: $(printf '%s' "${duplicates}" | tr '\n' ' ')" >&2
  exit 1
fi

# b) Colisión del hub con entradas top-level de la rama raíz (dev, css/, ...)
top_level="$(git ls-tree --name-only "origin/${DEFAULT_BRANCH}")"
for bp in "${NON_DEFAULT_PATHS[@]}"; do
  first_segment="${bp%%/*}"
  if printf '%s\n' "${top_level}" | grep -qxF "${first_segment}"; then
    echo "::error::'${first_segment}' es el directorio del hub de previews y colisiona con la entrada homónima de la raíz (origin/${DEFAULT_BRANCH}). Renombra la entrada '${first_segment}' de main." >&2
    exit 1
  fi
done

# c) Defensivo: ninguna ruta del hub puede empezar por 'index.html'. Una rama
#    'index.html' o 'index.html/foo' escribiría _site/dev/index.html como
#    directorio, colisionando con el archivo índice del hub. El nombre de
#    rama '.nojekyll' se sanea a 'nojekyll' (el saneo recorta '-'/'.'
#    iniciales), no requiere check.
for bp in "${NON_DEFAULT_PATHS[@]}"; do
  rel="${bp#${HUB_DIR}/}"
  if [ "${rel%%/*}" = "index.html" ]; then
    echo "::error::La rama con ruta saneada '${bp}' colisiona con el archivo índice del hub (_site/${HUB_DIR}/index.html): se escribiría como directorio. Renombra la rama." >&2
    exit 1
  fi
done

# -----------------------------------------------------------------------------
# 6b) Nota: la función strip_sensitive está definida en el paso 4 (antes de
#     su primer uso) y se aplica a la raíz y a cada rama extraída.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# 7) Extraer cada rama no-default bajo el hub (_site/dev/<ruta-saneada>/,
#    incluida dev → _site/dev/dev/) + .nojekyll por robustez dentro de cada
#    carpeta de rama.
# -----------------------------------------------------------------------------
for b in "${BRANCHES[@]}"; do
  if [ "${b}" = "${DEFAULT_BRANCH}" ]; then continue; fi
  bp="$(branch_path "${b}")"
  dest="_site/${HUB_DIR}/${bp}"
  echo "Extrayendo rama '${b}' → ${dest}/"
  mkdir -p "${dest}"
  git archive "origin/${b}" | tar -x -C "${dest}"
  echo > "${dest}/.nojekyll"
  strip_sensitive "${dest}"
done

# -----------------------------------------------------------------------------
# 7b) Hub de previews: índice auto-generado _site/dev/index.html con enlaces
#     a todas las ramas no-default (incluida dev) y a la raíz (main). El
#     mkdir -p previo cubre el caso de cero ramas no-default.
# -----------------------------------------------------------------------------
mkdir -p _site/dev
echo > _site/dev/.nojekyll
HUB_ENTRIES=()
for b in "${BRANCHES[@]}"; do
  if [ "${b}" != "${DEFAULT_BRANCH}" ]; then
    HUB_ENTRIES+=("${b}"$'\t'"$(branch_path "${b}")")
  fi
done
SORTED_ENTRIES=()
if [ "${#HUB_ENTRIES[@]}" -gt 0 ]; then
  mapfile -t SORTED_ENTRIES < <(printf '%s\n' "${HUB_ENTRIES[@]}" | LC_ALL=C sort)
fi
build_hub_index "${SORTED_ENTRIES[@]}"
echo "Hub de previews generado: _site/dev/index.html"

# -----------------------------------------------------------------------------
# 8) Resumen final para los logs
# -----------------------------------------------------------------------------
echo "----------------------------------------"
echo "Tamaño total de _site:"
du -sh _site
echo "Hub de previews (índice auto-generado):"
echo "_site/dev/index.html"
echo "Directorio raíz de _site (carpetas de rama):"
find _site -mindepth 1 -maxdepth 1 -type d | sort
echo "Archivos en _site (uno por línea):"
find _site -type f | sort
echo "----------------------------------------"
echo "build-pages-site.sh: _site construido correctamente."
