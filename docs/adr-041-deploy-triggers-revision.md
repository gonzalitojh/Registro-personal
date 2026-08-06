# ADR-041: Revisión de triggers del workflow deploy-all-branches (issue #98)

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

El ADR-036 introdujo el workflow
`.github/workflows/deploy-all-branches.yml`, que despliega **todas las
ramas** del repositorio en GitHub Pages (main en la raíz, cada rama en su
subdirectorio). Su trigger `on: push` se disparaba en **cada push de
cualquier rama** (más `workflow_dispatch` y `delete`), tal y como
documentaba el ADR-036.

La issue #98 reportaba que el workflow **tardaba mucho**, que el log
**parecía entrar en bucle** y que varios despliegues recientes habían
fallado con `Timeout reached, aborting!`. El diagnóstico (master,
2026-08-06) identificó la causa raíz:

- **Cada ejecución crea un deployment de GitHub Pages**, y Pages procesa
  los deployments **en cola, uno a uno**. Con cola vacía un deploy es
  rápido (evidencia: run 31107063823, evento `delete` 13:40, build 11 s +
  deploy 8 s, éxito en ~28 s). Con picos de pushes (cada PR genera 2-3
  pushes + merge + borrado de rama) la cola se satura: los deployments
  quedan en estado `deployment_queued` y `actions/deploy-pages` aborta a
  los 10 minutos con `Timeout reached, aborting!` (evidencia: run
  31103249570, `workflow_dispatch`, deploy atascado 10 m 31 s, fallo).
- El «bucle» percibido en el log no era tal: era el **poll de estado cada
  5 s** (`Current status: deployment_queued`) repetido hasta el timeout.
- Un **problema intermitente conocido de la infraestructura de GitHub
  Pages** (actions/deploy-pages#406, desde 2026-01-13) agravaba el caso:
  incluso con la cola vacía, algunos deployments quedaban en cola sin
  motivo aparente.
- Además, el paso de **migración Pages legacy → Actions vía `gh api`**
  fallaba en **todos** los runs (warning recurrente «No se pudo migrar
  Pages legacy…»): el `GITHUB_TOKEN` no tiene permisos de administración
  para esa API. La vía oficial es `actions/configure-pages@v5`, que es
  además el prerequisito documentado de `deploy-pages`.

Related issue: #98 — https://github.com/gonzalitojh/Registro-personal/issues/98

## Decisión

Revisar los **disparadores** y el **paso de migración** del workflow,
manteniendo intacta la funcionalidad de ADR-036 (main en la raíz, cada
rama en `/<rama>/`, sin bucles infinitos, `concurrency` con cancelación):

### 1. Trigger `push` limitado a las ramas de integración `main` y `dev`

`on: push` pasa de «todas las ramas, sin filtro» a
`branches: [main, dev]`. Cada merge a `main`/`dev` reconstruye **todas**
las ramas: `scripts/build-pages-site.sh` siempre despliega la lista
completa de ramas remotas, por lo que los previews de las ramas abiertas
se actualizan con cada merge sin necesidad de disparar por cada push de
la propia rama. `workflow_dispatch` se mantiene para forzar un
re-despliegue manual desde la UI, y `delete` se mantiene para que el
sitio deje de servir las ramas borradas.

### 2. Guard en el job `build` para el evento `delete`

El evento `delete` no admite filtros de rama, así que el guard se mueve
al job:

```yaml
if: github.event_name != 'delete' || github.event.ref_type == 'branch'
```

Descarta los **borrados de tags** (el sitio no debe reconstruirse por un
tag eliminado) y se queda con los **borrados de ramas**. En
`push`/`workflow_dispatch` la propiedad `ref_type` no existe, por lo que
la condición se evalúa `true` y el job siempre se ejecuta.

### 3. Sustitución del hack `gh api` por `actions/configure-pages@v5`

El paso «Migrar Pages a GitHub Actions (intento automático)» (PUT/POST vía
`gh api` con `GITHUB_TOKEN`, que fallaba siempre y emitía un warning
recurrente) se sustituye por:

```yaml
- name: Configurar GitHub Pages (prerequisito de deploy-pages)
  uses: actions/configure-pages@v5
  with:
    enablement: true   # migra Pages legacy → Actions si procede
```

`actions/configure-pages@v5` es el **prerequisito oficial** de
`actions/deploy-pages`; con `enablement: true` migra Pages legacy → Actions
cuando procede, es **idempotente** (sin efectos si ya está configurado) y
elimina el warning recurrente de los logs.

### 4. README sección 6 actualizado

La sección 6 («Subir a GitHub y activar Pages») refleja la nueva política:
despliegue de todas las ramas en cada push a `main`/`dev`, nota de que los
previews se actualizan con los merges (no con cada push de la rama),
re-despliegue manual con `workflow_dispatch` y comportamiento de borrado
solo de ramas (borrar un tag no reconstruye).

**No se tocaron** `scripts/build-pages-site.sh` (el script ya despliega
todas las ramas en cada ejecución; no hay nada que cambiar) ni
`docs/manual-de-usuario.md` (cambio interno de infraestructura, no visible
para el usuario final — misma decisión que ADR-036).

### 5. Reintentos automáticos del deploy (iteración 2)

Tras el merge de la iteración 1 (PR #99) el run del propio merge
(`31109152406`, push a `dev`, 14:06Z) volvió a fallar con
`Timeout reached, aborting!`: el deployment se creó correctamente pero quedó
atascado en **`deployment_in_progress`** (no en cola) durante los 10
minutos de timeout. La cola ya estaba vacía (solo un deployment) y el
workflow ya usaba `configure-pages@v5`: es el **problema intermitente de la
infraestructura de GitHub Pages** (actions/deploy-pages#406, deployments
atascados en cualquier estado, `queued`/`in_progress`/`syncing_files`).

Mitigación con **jobs nativos de GitHub Actions (sin dependencias de
terceros)**:

- El paso de deploy de cada intento lleva `continue-on-error: true`
  **a nivel de step** (intentos 1 y 2): un timeout por infraestructura no
  tiñe el run por sí solo; el resultado final lo deciden los reintentos.
- Cada job expone su resultado real por **outputs de job** con
  `steps.<id>.outcome` (el valor del paso **antes** de aplicar
  `continue-on-error`). **Detalle crítico de semántica**: no se usa
  `needs.<job>.result` para decidir el retry, porque con
  `continue-on-error` a nivel de job GitHub Actions lo reporta como
  `success` aunque el job falle (los retries nunca se dispararían); la
  distinción outcome/conclusion solo existe a nivel de step.
- Jobs `deploy-retry-1` y `deploy-retry-2` que se ejecutan solo si el
  output del job anterior es `failure`
  (`if: needs.<job>.outputs.deploy_result == 'failure' && !cancelled()`),
  con una espera previa de 60 s / 120 s (tiempo para que la cola de Pages
  procese o drene el deployment atascado). Reutilizan el artefacto del
  mismo run (`deploy-pages` lo localiza por nombre) y crean un deployment
  **nuevo**; como el bug es intermitente, un deployment nuevo tiene alta
  probabilidad de completarse (evidencia: en el mismo día, deployments en
  8-30 s cuando la infra va bien).
- El último retry (`deploy-retry-2`) va **sin** `continue-on-error`: si las
  3 oportunidades fallan, el run falla (señal real) y se re-lanza
  manualmente con `workflow_dispatch`.

## Alternativas descartadas

- **Mantener `push` a todas las ramas**: descartado — es la **causa raíz**
  de la saturación de la cola de deployments; cualquier mitigación sobre
  el timeout o la espera dejaría el problema de fondo sin resolver.
- **Aumentar el timeout de `actions/deploy-pages`**: descartado —
  **imposible**: el timeout está hard-capped a 600000 ms (10 minutos) en
  la propia acción y no es configurable desde el workflow.
- **Wrapper de reintentos de terceros** (acciones que envuelven
  `deploy-pages` con retry, p. ej. `Wandalen/wretry.action`): descartado —
  añade una dependencia externa no mantenida por GitHub y complica la
  lectura de outputs (`page_url`); el mismo efecto de retry se consigue
  con **jobs nativos encadenados** (`deploy-retry-*`), sin dependencias.
- **Eliminar por completo el evento `delete`**: descartado — el sitio debe
  **dejar de servir las ramas borradas**; sin el evento, el subdirectorio
  de una rama eliminada permanecería publicado indefinidamente.
- **Confiar solo en la reducción de triggers (iteración 1) sin retry**:
  descartado — el run del merge de la propia iteración 1 demostró que un
  único deployment también puede atascarse por el problema intermitente de
  la infraestructura; la reducción de triggers era necesaria pero no
  suficiente.

## Consecuencias

### Positivas

- **Reducción drástica de deployments**: de dispararse en cada push de
  cualquier rama a solo merges a `main`/`dev`, `delete` de ramas y
  `workflow_dispatch` manual. Con la frecuencia reducida, la **cola de
  Pages drena** y no se vuelve a producir `Timeout reached, aborting!` en
  condiciones normales.
- **Los previews se mantienen**: cada ejecución sigue construyendo
  **todas** las ramas (el script no cambió), así que cada merge a
  `main`/`dev` actualiza el preview de todas las ramas abiertas.
- **Warning recurrente eliminado**: `actions/configure-pages@v5` con
  `enablement: true` sustituye al hack `gh api` que fallaba en todos los
  runs (el `GITHUB_TOKEN` no tiene permisos de administración para esa
  API); además es el prerequisito oficial de `deploy-pages`.
- **Borrados de tags sin reconstrucción**: el guard
  `ref_type == 'branch'` evita builds completos por tags eliminados.
- **Sin cambios de comportamiento para el sitio publicado**: main sigue en
  la raíz, cada rama en su subdirectorio, y no se tocó ni el script de
  build ni la app.

### Negativas / Riesgos

- **Previews de ramas abiertas menos frescos**: un push a una rama de
  trabajo ya no actualiza su preview inmediatamente; solo se refresca con
  un merge a `main`/`dev` o con `workflow_dispatch` manual. Es el
  trade-off asumido de la decisión.
- **El problema intermitente de la infraestructura de Pages persiste**
  (actions/deploy-pages#406): no es solucionable desde el repo. La
  reducción de triggers + los reintentos lo mitigan (3 oportunidades por
  run; cada deployment nuevo tiene alta probabilidad de completarse),
  pero un fallo de infraestructura prolongado podría seguir haciendo
  fallar un run tras agotar los 3 intentos (re-lanzar manualmente con
  `workflow_dispatch` o re-run).
- **Runs más largos en el peor caso**: si los 3 intentos agotan sus
  timeouts (10 min cada uno + esperas de 60/120 s), el run puede durar
  ~32 minutos antes de fallar. Es el coste asumido por la resiliencia; en
  condiciones normales el deploy completa en <1 min en el primer intento.
- **El historial de ADR-036 queda parcialmente obsoleto**: su sección de
  triggers (`on: push` a todas las ramas) y el paso de migración vía
  `gh api` ya no describen el comportamiento real; se añade una nota de
  deprecación en el propio ADR-036 apuntando a este documento.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: el cambio es interno
  (infraestructura de despliegue); el usuario final no ve ninguna
  diferencia de comportamiento, por lo que no aplica la obligación de
  AGENTS.md de actualizar el manual (misma decisión que ADR-036).
- **`scripts/build-pages-site.sh` sin cambios**: la construcción de
  `_site/` con todas las ramas, el saneo de nombres, los checks de
  colisión y `strip_sensitive()` se mantienen exactamente como los
  documentó el ADR-036.
- **`concurrency` y permisos intactos**: `group: pages,
  cancel-in-progress: true` y los permisos `contents: read`, `pages:
  write`, `id-token: write` no se tocan.

## Nota de implementación

- En `push`/`workflow_dispatch` la propiedad `github.event.ref_type` no
  existe (devuelve una cadena vacía), por lo que el guard
  `github.event_name != 'delete' || github.event.ref_type == 'branch'` se
  evalúa `true` y el job `build` se ejecuta siempre. Solo el evento
  `delete` con `ref_type == 'tag'` descarta el job.
- El timeout de 10 minutos (`600000 ms`) está hard-capped en
  `actions/deploy-pages@v4`; el log de un deployment atascado muestra
  `Current status: deployment_queued` (o `deployment_in_progress`)
  repetido cada 5 s hasta el abort (`Timeout reached, aborting!`), lo que
  se percibía como un bucle.
- `actions/configure-pages@v5` con `enablement: true` es idempotente: si
  Pages ya está configurado con GitHub Actions no produce cambios, solo
  configura el sitio según el artefacto que se sube después.
- Los jobs `deploy-retry-*` reutilizan el artefacto `github-pages` del
  mismo run: `actions/deploy-pages` lo localiza por nombre a través de la
  API de artefactos, sin necesidad de checkout ni de volver a subirlo.
- Los reintentos se deciden con `needs.<job>.outputs.deploy_result`
  (propagado con `steps.<id>.outcome`), **no** con `needs.<job>.result`:
  con `continue-on-error` a nivel de job, `result` devuelve `success`
  aunque el job falle (semántica verificada: actions/runner#2347,
  actions/toolkit#1034). El output de un job `skipped`/`cancelled` se
  evalúa a vacío, con lo que `== 'failure'` es falso y los retries no se
  ejecutan (comportamiento correcto: no reintentar si el build falló, se
  borró un tag o el run se canceló por concurrency).
- Los tres jobs usan el mismo `environment: github-pages` (sin protection
  rules restrictivas; el `url` se resuelve por job desde su propio
  `steps.deployment.outputs.page_url`). `timeout-minutes: 15` por job
  acota el peor caso (deploy ~10 min + sleeps).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/deploy-all-branches.yml` | **Modificado**: `on: push` limitado a `branches: [main, dev]`; guard `if: github.event_name != 'delete' \|\| github.event.ref_type == 'branch'` en el job `build` (descarta borrados de tags); hack de migración `gh api` sustituido por `actions/configure-pages@v5` con `enablement: true`; jobs `deploy-retry-1`/`deploy-retry-2` con reintentos (iteración 2: `continue-on-error` a nivel de step + outputs de job `steps.<id>.outcome`); comentario de cabecera con la política de triggers y los reintentos |
| `README.md` | Sección 6 actualizada: despliegue en cada push a `main`/`dev`, nota de previews actualizados solo con merges, re-despliegue manual y borrado de tags sin reconstrucción |
| `docs/adr-036-deploy-all-branches.md` | **Modificado**: nota de deprecación parcial al inicio (política de triggers y paso `gh api` sustituidos por ADR-041, issue #98); el resto del ADR queda intacto como histórico |
| `docs/adr-041-deploy-triggers-revision.md` | **Nuevo**: este documento (ampliado con la iteración 2: reintentos de deploy) |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de infraestructura, no visible para el usuario final — misma decisión que ADR-036) |
| `scripts/build-pages-site.sh` | **Sin cambios** (el script ya despliega todas las ramas en cada ejecución) |

Related issue: #98 — https://github.com/gonzalitojh/Registro-personal/issues/98
