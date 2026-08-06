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

## Alternativas descartadas

- **Mantener `push` a todas las ramas**: descartado — es la **causa raíz**
  de la saturación de la cola de deployments; cualquier mitigación sobre
  el timeout o la espera dejaría el problema de fondo sin resolver.
- **Aumentar el timeout de `actions/deploy-pages`**: descartado —
  **imposible**: el timeout está hard-capped a 600000 ms (10 minutos) en
  la propia acción y no es configurable desde el workflow.
- **Wrapper de reintentos de terceros** (acciones que envuelven
  `deploy-pages` con retry): descartado — añade una dependencia externa no
  mantenida por GitHub y **no ataca la causa raíz**: los deployments
  seguirían entrando en cola y el retry solo retrasaría el fallo.
- **Eliminar por completo el evento `delete`**: descartado — el sitio debe
  **dejar de servir las ramas borradas**; sin el evento, el subdirectorio
  de una rama eliminada permanecería publicado indefinidamente.

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
- **Dependencia del problema intermitente de la infraestructura de
  Pages** (actions/deploy-pages#406): no es solucionable desde el repo;
  aunque ahora la cola drena en condiciones normales, un pico puntual de
  deployments (p. ej. muchos merges o borrados a la vez) podría volver a
  dejar algún deployment en `deployment_queued`.
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
  `Current status: deployment_queued` repetido cada 5 s hasta el abort
  (`Timeout reached, aborting!`), lo que se percibía como un bucle.
- `actions/configure-pages@v5` con `enablement: true` es idempotente: si
  Pages ya está configurado con GitHub Actions no produce cambios, solo
  configura el sitio según el artefacto que se sube después.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/deploy-all-branches.yml` | **Modificado**: `on: push` limitado a `branches: [main, dev]`; guard `if: github.event_name != 'delete' \|\| github.event.ref_type == 'branch'` en el job `build` (descarta borrados de tags); hack de migración `gh api` sustituido por `actions/configure-pages@v5` con `enablement: true`; comentario de cabecera con la nueva política de triggers |
| `README.md` | Sección 6 actualizada (por el implementador): despliegue en cada push a `main`/`dev`, nota de previews actualizados solo con merges, re-despliegue manual y borrado de tags sin reconstrucción |
| `docs/adr-036-deploy-all-branches.md` | **Modificado**: nota de deprecación parcial al inicio (política de triggers y paso `gh api` sustituidos por ADR-041, issue #98); el resto del ADR queda intacto como histórico |
| `docs/adr-041-deploy-triggers-revision.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de infraestructura, no visible para el usuario final — misma decisión que ADR-036) |
| `scripts/build-pages-site.sh` | **Sin cambios** (el script ya despliega todas las ramas en cada ejecución) |

Related issue: #98 — https://github.com/gonzalitojh/Registro-personal/issues/98
