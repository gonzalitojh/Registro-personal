#!/usr/bin/env bash
# =============================================================================
# gh-issue.sh — Integración de GitHub Issues con el flujo SDD.
#
# Los agentes de IA usan este helper para:
#   - Consultar issues (pendientes, completadas, por tipo, en revisión...).
#   - Obtener el detalle de una issue para construir el task local.
#   - Sincronizar las labels de la issue con el estado de la tarea SDD
#     (ai-todo, ai-in-progress, ai-needs-review, ai-blocked, ai-done).
#   - Corregir la label de tipo si está mal clasificada
#     (type: feature|bug|style|refactor|content).
#
# Regla de negocio: el agente SÓLO debe abordar issues con label "ai-..."
# (normalmente "ai-todo"). Las issues sin esa label son de usuarios.
#
# Uso:
#   scripts/gh-issue.sh list [--all|--todo|--review|--blocked|--done|--type <tipo>]
#   scripts/gh-issue.sh show <NUMERO>
#   scripts/gh-issue.sh set-state <NUMERO> <ai-todo|ai-in-progress|ai-needs-review|ai-blocked|ai-done>
#   scripts/gh-issue.sh set-type <NUMERO> <feature|bug|style|refactor|content>
#   scripts/gh-issue.sh help
#   - La transición a ai-done (y el cierre de la issue) al fusionar la PR la hace
#     automáticamente el workflow .github/workflows/issue-done-on-merge.yml; este
#     script queda como vía manual de respaldo.
# =============================================================================
set -euo pipefail

# Listas blancas (no se tocan otras labels).
AI_STATES=("ai-todo" "ai-in-progress" "ai-needs-review" "ai-blocked" "ai-done")
TYPES=("feature" "bug" "style" "refactor" "content")

REPO="${GH_REPO:-}" # Si está vacío, gh usa el repo del directorio actual.

# -----------------------------------------------------------------------------
# Utilidades
# -----------------------------------------------------------------------------
usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

in_list() {
  local needle="$1"
  shift
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

# Coma-lista con TODOS los elementos excepto el que se va a añadir.
# IMPORTANTE: gh 2.45 procesa remove-label antes que add-label; si la label
# objetivo está también en la lista de remoción, la quita y NO la vuelve a
# añadir. Por eso la label objetivo se excluye de la lista de remoción.
excluding() {
  local target="$1"
  shift
  local out=()
  for item in "$@"; do
    if [[ "$item" != "$target" ]]; then
      out+=("$item")
    fi
  done
  local IFS=,
  echo "${out[*]}"
}

# gh wrapper con --repo si está definido
gh_() {
  if [[ -n "$REPO" ]]; then
    gh --repo "$REPO" "$@"
  else
    gh "$@"
  fi
}

# -----------------------------------------------------------------------------
# list — consulta de issues
# -----------------------------------------------------------------------------
cmd_list() {
  local filter="${1:-ai}" # por defecto: issues abiertas con label ai-*
  local state="open"
  local label_filter=""
  local python_filter=""

  case "$filter" in
    ai|--ai)
      python_filter="ai"
      ;;
    --all)
      python_filter="all"
      ;;
    --todo)
      label_filter="ai-todo"
      ;;
    --review)
      label_filter="ai-needs-review"
      ;;
    --blocked)
      label_filter="ai-blocked"
      ;;
    --done)
      state="all"
      label_filter="ai-done"
      ;;
    --type)
      local t="${2:-}"
      if ! in_list "$t" "${TYPES[@]}"; then
        echo "ERROR: tipo inválido '$t'. Válidos: ${TYPES[*]}" >&2
        exit 2
      fi
      label_filter="type: $t"
      ;;
    *)
      echo "ERROR: filtro desconocido '$filter'. Usa --all, --todo, --review, --blocked, --done o --type <tipo>." >&2
      exit 2
      ;;
  esac

  local json
  json="$(gh_ issue list --state "$state" --limit 100 --json number,title,labels,state 2>/dev/null)" || {
    echo "ERROR: no se pudo listar issues. ¿Está 'gh' autenticado (gh auth status)?" >&2
    exit 1
  }

  python3 - "$json" "$python_filter" "$label_filter" <<'PYEOF'
import json, sys

data = json.loads(sys.argv[1])
python_filter = sys.argv[2]
label_filter = sys.argv[3]

def ai_status(labels):
    for l in labels:
        if l["name"].startswith("ai-"):
            return l["name"]
    return None

def type_label(labels):
    for l in labels:
        if l["name"].startswith("type: "):
            return l["name"][6:]
    return "-"

rows = []
counts = {"ai": 0, "user": 0, "none": 0}
for issue in data:
    names = [l["name"] for l in issue["labels"]]
    if label_filter and label_filter not in names:
        continue
    if python_filter == "ai" and not any(n.startswith("ai-") for n in names):
        continue
    st = ai_status(issue["labels"]) or "-"
    ty = type_label(issue["labels"])
    agent = any(n.startswith("ai-") for n in names)
    user = any(n in ("todo", "in-progress", "done", "blocked") for n in names)
    if agent:
        counts["ai"] += 1
    elif user:
        counts["user"] += 1
    else:
        counts["none"] += 1
    flag = "AGENTE" if agent else ("USUARIO" if user else "-")
    state_marker = "" if issue["state"] == "OPEN" else " [CERRADA]"
    rows.append(f"#{issue['number']:<4} [{ty:<8}] {issue['title']}  (estado: {st})  {flag}{state_marker}")

if rows:
    for r in sorted(rows, key=lambda x: int(x.split(']')[0].lstrip('#').split()[0])):
        print(r)
else:
    print("(sin resultados para el filtro actual)")

print(f"\nResumen: {counts['ai']} para agente, {counts['user']} de usuario, {counts['none']} sin estado.")
PYEOF
}

# -----------------------------------------------------------------------------
# show — detalle de una issue
# -----------------------------------------------------------------------------
cmd_show() {
  local n="${1:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  local json
  json="$(gh_ issue view "$n" --json number,title,body,state,url,labels,comments 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  python3 - "$json" <<'PYEOF'
import json, sys

issue = json.loads(sys.argv[1])
labels = [l["name"] for l in issue["labels"]]
ai = [l for l in labels if l.startswith("ai-")]
ty = [l for l in labels if l.startswith("type: ")]
other = [l for l in labels if not l.startswith("ai-") and not l.startswith("type: ")]

print(f"# {issue['number']} — {issue['title']}")
print(f"Estado: {issue['state']} | URL: {issue['url']}")
print(f"Labels ai: {ai if ai else '(ninguna)'}")
print(f"Tipo: {ty if ty else '(sin tipo)'}")
print(f"Otras labels: {other if other else '(ninguna)'}")
print("---")
print(issue.get("body") or "(sin descripción)")
if issue.get("comments"):
    print("--- COMENTARIOS ---")
    for c in issue["comments"]:
        print(f"[{c['author']['login']}]: {c['body']}")
PYEOF
}

# -----------------------------------------------------------------------------
# set-state — fija exactamente una label de estado ai-*
# -----------------------------------------------------------------------------
cmd_set_state() {
  local n="${1:-}"
  local label="${2:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  if ! in_list "$label" "${AI_STATES[@]}"; then
    echo "ERROR: estado inválido '$label'. Válidos: ${AI_STATES[*]}" >&2
    exit 2
  fi
  local is_pr
  is_pr="$(gh_ api "repos/{owner}/{repo}/issues/$n" --jq '.pull_request != null' 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$is_pr" == "true" ]]; then
    echo "ERROR: #$n es un Pull Request, no una issue. No se modifican sus labels." >&2
    exit 2
  fi
  local state
  state="$(gh_ issue view "$n" --json state --jq .state 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$state" == "CLOSED" ]]; then
    if [[ "$label" == "ai-done" ]]; then
      echo "OK: issue #$n CERRADA → aplicando estado terminal 'ai-done'."
    else
      echo "AVISO: la issue #$n está CERRADA; solo se permite la transición a 'ai-done'." >&2
      exit 3
    fi
  fi
  local remove
  remove="$(excluding "$label" "${AI_STATES[@]}")"
  gh_ issue edit "$n" --remove-label "$remove" --add-label "$label" >/dev/null
  echo "OK: issue #$n → label '$label'"
}

# -----------------------------------------------------------------------------
# set-type — fija exactamente una label de tipo
# -----------------------------------------------------------------------------
cmd_set_type() {
  local n="${1:-}"
  local t="${2:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  if ! in_list "$t" "${TYPES[@]}"; then
    echo "ERROR: tipo inválido '$t'. Válidos: ${TYPES[*]}" >&2
    exit 2
  fi
  local is_pr
  is_pr="$(gh_ api "repos/{owner}/{repo}/issues/$n" --jq '.pull_request != null' 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$is_pr" == "true" ]]; then
    echo "ERROR: #$n es un Pull Request, no una issue. No se modifican sus labels." >&2
    exit 2
  fi
  local state
  state="$(gh_ issue view "$n" --json state --jq .state 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$state" == "CLOSED" ]]; then
    echo "AVISO: la issue #$n está CERRADA; no se modifican sus labels." >&2
    exit 3
  fi
  local remove
  remove="$(excluding "type: $t" "${TYPES[@]/#/type: }")"
  gh_ issue edit "$n" --remove-label "$remove" --add-label "type: $t" >/dev/null
  echo "OK: issue #$n → tipo 'type: $t'"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
cmd="${1:-help}"
case "$cmd" in
  list)      shift; cmd_list "$@" ;;
  show)      shift; cmd_show "${1:-}" ;;
  set-state) shift; cmd_set_state "${1:-}" "${2:-}" ;;
  set-type)  shift; cmd_set_type "${1:-}" "${2:-}" ;;
  help|-h|--help) usage ;;
  *) echo "ERROR: subcomando desconocido '$cmd'"; usage ;;
esac
