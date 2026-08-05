# ADR-018: Integración de GitHub Issues como fuente de tareas para los agentes de IA

## Estado
Implementado

## Fecha
Agosto 2026

**NOTA — SUPERADO EN LO RELATIVO AL ESQUEMA DE LABELS Y AL CIERRE**: el esquema `ai-*` descrito aquí queda reemplazado por el de ADR-034 (issue #74): estados compartidos `status: *`, label `ai` como marcador de agente, y cierre de issues al promover `dev` a `main` (workflow `issues-done-on-main.yml`), no al fusionar la PR. El resto se conserva como registro histórico.

## Contexto

Hasta ahora, los agentes de IA del flujo SDD recibían sus tareas exclusivamente a través de archivos locales en `tasks/` (creados a mano por el usuario) o mediante peticiones directas en la conversación. Esto generaba varios problemas:

1. **Falta de trazabilidad**: no existía un vínculo entre el trabajo realizado por los agentes y las GitHub Issues del repositorio; era imposible saber de qué issue provenía cada tarea.
2. **Cierre manual de issues**: cuando un cambio se fusionaba, la issue correspondiente debía cerrarse a mano; no se aprovechaba el cierre automático de GitHub mediante keywords en la descripción de la PR (`Closes #N`).
3. **Labels desincronizadas**: las issues no reflejaban el estado real de la tarea (pendiente, en progreso, en revisión, bloqueada, completada), ni se corregía su clasificación por tipo (`type: feature|bug|style|refactor|content`).
4. **El usuario no podía consultar el trabajo pendiente**: no había forma de preguntar qué issues había abiertas para decidir cuál debía abordar el agente, ya que la tarea local solo se creaba en el momento de adoptarla.

El objetivo era convertir a GitHub Issues en la **fuente de tareas** del flujo SDD: los agentes solo procesan issues etiquetadas con `ai-*` (el resto son de usuarios), el usuario puede consultarlas y elegir cuál abordar, la task local se crea al adoptarla, y las labels de la issue se mantienen sincronizadas con el estado SDD en cada transición.

Related issue: #18 — https://github.com/gonzalitojh/Registro-personal/issues/18

## Decisión

Integrar GitHub Issues como fuente de tareas del flujo SDD, con los siguientes componentes:

### 1. Regla de negocio: solo issues con label `ai-*`

El agente SDD master **solo adopta issues que tengan alguna label `ai-*`** (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`). Si la issue no la tiene (o está cerrada), el agente rechaza la adopción de forma cortés y lista las disponibles con `scripts/gh-issue.sh list --todo`, ya que esas issues corresponden a trabajo de usuario.

### 2. Flujo de consulta y adopción en `sdd-master.md`

Se añadieron dos pasos nuevos al agente maestro:

- **Step 0 — Interpretación de la petición**: distingue entre *consulta* (listar issues: `--all`, `--todo`, `--review`, `--blocked`, `--done`, `--type <tipo>`) y *adopción* ("aborda la issue #N"). En las consultas **no** se crea ningún task local: solo se presenta la información para que el usuario decida.
- **Step 0-b — Adopción de una issue**: obtiene el detalle (`scripts/gh-issue.sh show <N>`), verifica la regla `ai-*`, comprueba si `tasks/task-issue-N.json` ya existe (en ese caso se reanuda la tarea, reconciliando estado local y labels de la issue, sin recrearla), y si no, lo crea con el bloque:
  ```json
  "issue": { "number": 18, "url": "https://github.com/.../issues/18", "title": "..." }
  ```
  También verifica/corrige la label de tipo (`set-type`) si falta o está mal clasificada, elimina la label de usuario `todo` si está presente, y fija la label de estado inicial (`ai-todo` o `ai-in-progress`).

### 3. Sincronización de labels de estado (Step 3-b)

En **cada transición** de la tarea, el agente maestro sincroniza la label de estado de la issue (exactamente una a la vez), según el mapeo:

| Estado local de la tarea | Label de la issue | Cuándo |
|--------------------------|-------------------|--------|
| `created` / `planned` | `ai-todo` | Adoptada pero aún no implementada |
| `implemented` / `validated` / `security-cleared` / `documenting` | `ai-in-progress` | Trabajo activo |
| `blocked` | `ai-blocked` | Requiere input del usuario o fallos repetidos |
| `review` (PR creada) | `ai-needs-review` | Aplicada por el publisher tras crear la PR |
| `done` / `published` | `ai-done` | PR fusionada e issue cerrada (verificado) |

La sincronización es **best-effort**: si el comando falla (red, rate limit), se registra el fallo en el reporte y se continúa el flujo; nunca bloquea el proceso SDD.

### 4. Corrección de labels de tipo

Se verifica que la issue tenga exactamente una label `type: feature|bug|style|refactor|content`. Si falta o está claramente mal clasificada, se corrige con `scripts/gh-issue.sh set-type <N> <tipo>`. Si la clasificación es ambigua, se pregunta al usuario en lugar de adivinar.

### 5. Cierre automático de la issue al fusionar (`publisher.md`)

El publisher extrae el número de issue del bloque `issue` del task file, nombra la rama incluyendo la issue (`fix/issue-18-<slug>`), incluye `Closes #N` como **primera línea del body** de la PR (GitHub cierra la issue automáticamente al fusionar) y, tras crear la PR, aplica `scripts/gh-issue.sh set-state <N> ai-needs-review`. Si el task file no tiene bloque `issue`, se omite tanto el `Closes #N` como la actualización de labels.

### 6. Reconciliación al inicio de sesión (Step 6)

Al comienzo de una sesión (o cuando el usuario lo pide), el agente maestro:
- Lista las issues en `ai-needs-review`; si la PR ya fue fusionada y la issue está cerrada, aplica `ai-done` y marca el task local como `published`.
- Lista las issues en `ai-blocked` y pregunta al usuario si desea reanudarlas.

### 7. Comando `/issues` para el usuario

Nuevo comando de opencode (`.opencode/command/issues.md`) que permite consultar las issues del repositorio sin crear tareas: `--all`, `--todo`, `--review`, `--blocked`, `--done`, `--type <tipo>`, `--help`. Los resultados se presentan en una tabla legible (número, tipo, título, estado, agente/usuario) destacando cuántas están listas para abordar (`ai-todo`).

### 8. Helper `scripts/gh-issue.sh`

Script bash central que encapsula toda la interacción con la API de GitHub (vía `gh`) con las siguientes garantías:

- **Listas blancas**: solo toca labels de las listas `AI_STATES` (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`) y `TYPES` (`feature`, `bug`, `style`, `refactor`, `content`). Nunca manipula otras labels.
- **Idempotencia**: `set-state` y `set-type` eliminan las labels de la misma categoría antes de añadir la nueva (excluyendo la target por el comportamiento de `gh 2.45`, que procesa `remove-label` antes que `add-label`), garantizando exactamente una label de estado y una de tipo.
- **Rechazo de issues cerradas**: solo se permite la transición terminal `ai-done` sobre una issue cerrada; cualquier otro cambio sobre una cerrada aborta con aviso.
- **Salvaguarda anti-PR**: comprueba vía API si el número corresponde a un Pull Request y, en ese caso, aborta sin modificar sus labels.

### 9. Labels nuevas en GitHub

Se añadieron las labels que faltaban para completar la taxonomía del flujo:
- **Prioridad**: `priority: high`, `priority: medium`, `priority: low`.
- **Naturaleza**: `question`.

Junto a las ya existentes (`type: feature|bug|style|refactor|content` y `ai-todo|ai-in-progress|ai-needs-review|ai-blocked|ai-done`).

### 10. Ajustes en agentes auxiliares

- **`qa-reviewer.md`**: al validar una tarea que referencia una issue, verifica (de forma informativa, no bloqueante) que las labels reflejen el estado: `ai-in-progress` durante la validación y tipo coherente con el cambio revisado; si hay inconsistencia, lo reporta al master para que sincronice.
- **`documentation-sync.md`**: al documentar, si la tarea referencia una issue, el ADR debe incluir `Related issue: #<N>` con la URL; la numeración del ADR siempre se calcula como **máximo de los números existentes en `docs/adr-*.md` + 1**, para evitar colisiones por los duplicados históricos (adr-008 y adr-009).

## Alternativas descartadas

- **Mantener solo tareas locales en `tasks/` sin GitHub Issues**: descartado porque no aporta trazabilidad, no permite el cierre automático de issues ni la sincronización de labels, y el usuario no podía consultar el estado del trabajo.
- **Sincronizar el estado mediante el título o el cuerpo de la issue** (ej. prefijos `[TODO]`/`[DONE]`): descartado porque las labels son la vía nativa de GitHub, consultables por la API y visuales en la web; el texto del título además se usa para construir el task.
- **Un bot/acción de GitHub Actions para sincronizar labels**: descartado por sobre-ingeniería: los agentes ya disponen de `gh` autenticado y el helper cubre la sincronización con lógica de negocio (listas blancas, salvaguardas) que un flujo externo complicaría.
- **Crear el task local automáticamente para todas las issues con `ai-*`**: descartado porque el usuario debe decidir cuál abordar; la task se crea **en el momento de la adopción**, no antes (requisito explícito de la issue #18).
- **Eliminar las labels de estado de usuario (`todo`, `in-progress`, `done`, `blocked`)**: descartado: se mantienen para distinguir issues de usuario de las de agente (`ai-*`); de hecho el script y el master distinguen explícitamente ambas categorías en las consultas.

## Consecuencias

### Positivas
- **Trazabilidad completa**: issue → task local (`task-issue-N.json`) → rama `issue-N-<slug>` → PR con `Closes #N` → issue cerrada automáticamente al fusionar.
- **El usuario controla el trabajo del agente**: puede consultar qué issues hay abiertas/pendientes/completadas y elegir cuál abordar; la task solo se crea en la adopción.
- **Estado visible en GitHub**: las labels `ai-*` reflejan el estado SDD en todo momento, y la clasificación por tipo y prioridad es corregible por el agente.
- **Seguridad del helper**: listas blancas, idempotencia, rechazo de cerradas (salvo `ai-done`) y salvaguarda anti-PR evitan mutaciones accidentales de issues/PRs.
- **Resiliencia**: la sincronización de labels es best-effort; un fallo de red o rate limit no bloquea el flujo SDD.

### Negativas
- **Dependencia de `gh` autenticado**: todo el flujo de issues requiere la CLI de GitHub con permisos sobre las labels; sin ella, las consultas y sincronizaciones fallan (se reportan pero no se bloquea).
- **El estado en GitHub puede quedar desactualizado**: si un agente olvida sincronizar o el comando falla repetidamente, la label puede no reflejar el estado real hasta la reconciliación de la siguiente sesión.
- **Las issues sin label `ai-*` quedan fuera del flujo**: por diseño no las procesa el agente; el usuario debe etiquetarlas para delegarlas.

### Neutras
- **Nueva taxonomía de labels** (estado `ai-*`, tipo `type:*`, prioridad `priority:*`, `question`) que debe mantenerse coherente en el repositorio; el helper las centraliza en dos listas blancas.
- **Nomenclatura de ramas con la issue**: `fix/issue-18-<slug>` identifica la procedencia del trabajo, pero puede resultar verbosa para números grandes.
- **La numeración de ADRs** se calcula ahora como máximo + 1 por los duplicados históricos (adr-008 y adr-009), y cada ADR vinculado a una issue lleva `Related issue: #<N>`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.opencode/agents/sdd-master.md` | Steps 0/0-b (consulta/adopción de issues), Step 3-b (mapeo de labels por estado), Step 6 (reconciliación al inicio de sesión: PRs fusionados → `ai-done`) |
| `.opencode/agents/publisher.md` | Extracción del número de issue del task file, rama `issue-N-<slug>`, `Closes #N` como primera línea del body de la PR, `set-state N ai-needs-review` tras crear la PR |
| `.opencode/agents/qa-reviewer.md` | Verificación informativa de labels de estado/tipo al revisar tareas procedentes de issues |
| `.opencode/agents/documentation-sync.md` | Regla de numeración ADR (máximo + 1) y línea `Related issue: #N` con URL |
| `.opencode/command/issues.md` | **Nuevo**: comando `/issues` con filtros `--all/--todo/--review/--blocked/--done/--type` |
| `scripts/gh-issue.sh` | **Nuevo**: helper bash (`list`, `show`, `set-state`, `set-type`) con listas blancas, idempotencia, rechazo de issues cerradas y salvaguarda anti-PR |
| `tasks/task-issue-18.json` | **Nuevo**: task local generado en la adopción de la issue #18, con bloque `issue` {number, url, title} |
| Labels de GitHub | **Nuevas**: `priority: high/medium/low` y `question` (junto a las ya existentes `type:*` y `ai-*`) |
