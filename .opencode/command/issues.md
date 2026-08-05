---
description: Consulta las GitHub Issues del repositorio (abiertas, pendientes, completadas, en revisión, bloqueadas o por tipo). Ejemplos: /issues, /issues --todo, /issues --done, /issues --type feature
---

El usuario quiere consultar las GitHub Issues del repositorio.

1. Ejecuta el helper del proyecto con el filtro indicado:
   `scripts/gh-issue.sh list $ARGUMENTS`
   - Sin argumentos (o con `--all`): lista todas las issues abiertas, marcando cuáles son para el agente (label ai) y cuáles para el usuario.
   - `--todo`: issues listas para que el agente las aborde (status: todo).
   - `--review`: issues con PR pendiente de aprobación (status: needs-review).
   - `--blocked`: issues bloqueadas (status: blocked).
   - `--done`: issues completadas (status: done), incluidas las cerradas.
   - `--type <tipo>`: issues abiertas de un tipo (feature, bug, style, refactor, content).
   - `--help`: muestra la ayuda del script.
2. Si el comando falla, verifica que `gh` esté autenticado (`gh auth status`) y que el script exista.
3. Presenta los resultados en una tabla legible: número, tipo, título, estado y quién debe abordarla (agente/usuario).
4. Destaca cuántas issues están listas para que el agente las aborde (status: todo).
5. NO crees ningún task local: la task se creará solo cuando el usuario decida abordar una issue concreta.
