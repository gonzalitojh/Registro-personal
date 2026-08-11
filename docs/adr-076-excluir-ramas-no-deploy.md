# ADR-076: Excluir ramas del despliegue con el prefijo no-deploy/ (issue #198)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La action `deploy-all-branches`
(`.github/workflows/deploy-all-branches.yml`) despliega **todas las ramas**
del repositorio en GitHub Pages vía `scripts/build-pages-site.sh` (ADR-036):
`main` en la raíz de `_site/` y cada rama no-default en
`_site/dev/<ruta-saneada>/`, con `/dev/` como **hub de previews** y un
índice auto-generado (`_site/dev/index.html`) que enlaza todas las ramas y
la raíz (ADR-044). Cada ejecución consume minutos de Actions y crea un
deployment en la cola de Pages (el problema de saturación de la cola fue la
motivación del ADR-041).

La issue #198: el usuario conserva ramas que **no fusionará** (p. ej.
`feat/issue-191-portadas-no-cargan`) y quiere que las ramas cuyo nombre
empieza por `no-deploy/` (p. ej. `no-deploy/feat/issue-191-portadas-no-cargan`)
queden **excluidas del despliegue**, para no consumir recursos desplegando
algo que se va a quedar mucho tiempo ahí. Propone renombrar la rama con ese
prefijo como mecanismo de exclusión.

Estado del código verificado en el momento de la decisión:

- `scripts/build-pages-site.sh` lista **todas** las ramas remotas
  (`git for-each-ref refs/remotes/origin`, recortando el prefijo y
  filtrando `origin/HEAD`) y extrae cada rama no-default en
  `_site/dev/<ruta-saneada>/` (`sanitize_segment`/`branch_path`, con
  `strip_sensitive()` como defensa en profundidad sobre el árbol extraído).
- El trigger `push` del workflow vuelve a dispararse en **todas las ramas,
  sin filtro**: el usuario revirtió a propósito (commit `1cd1061`,
  2026-08-07) la limitación a `main`/`dev` del ADR-041. **Esta issue NO
  reintroduce esa limitación**: los pushes a ramas de trabajo normales
  siguen desplegando igual que antes.
- Los eventos `workflow_dispatch` y `delete` **no admiten filtros de
  rama**: cualquier exclusión que viva solo en el trigger no cubriría ni el
  re-despliegue manual ni el borrado de una rama.

Related issue: #198 — https://github.com/gonzalitojh/Registro-personal/issues/198

## Decisión

**Excluir del despliegue las ramas cuyo nombre empieza por el prefijo
`no-deploy/` (con barra), en dos niveles: el trigger del workflow y el
script de build (defensa en profundidad).**

### 1. Capa de trigger: `branches-ignore` en `on: push`

El trigger `push` pasa de «todas las ramas, sin filtro» a:

```yaml
on:
  push:
    branches-ignore:  # un push a ramas no-deploy/* no dispara el workflow
      - 'no-deploy/**'
```

- El patrón `no-deploy/**` es **multi-segmento**: cubre `no-deploy/foo` y
  `no-deploy/foo/bar` (el `**` cruza `/`, a diferencia de `*` — misma
  semántica `File.fnmatch` que el patrón `**/*` del entorno `github-pages`
  documentado en ADR-036).
- Un push a una rama `no-deploy/*` **no dispara el workflow**: no consume
  minutos de Actions ni crea deployment en la cola de Pages. El resto de
  pushes (incluidas las ramas de trabajo normales) sigue disparándolo.
- `workflow_dispatch` y `delete` quedan **intactos** (no admiten filtros de
  rama; la exclusión de esas vías la cubre la capa de script).

### 2. Capa de script: partición INCLUDED/EXCLUDED en `build-pages-site.sh`

El script define `NO_DEPLOY_PREFIX="no-deploy/"` y **particiona** la lista
de ramas remotas en `INCLUDED_BRANCHES` / `EXCLUDED_BRANCHES` con un
*prefix match* que incluye la barra (`[[ "${b}" == "${NO_DEPLOY_PREFIX}"* ]]`):

- Las ramas excluidas **no se extraen** en `_site/dev/` ni se enlazan en el
  hub de previews (AC1).
- Si hay ramas excluidas se loguea
  `Ramas excluidas del despliegue (prefijo no-deploy/): ...`
  (**trazabilidad** en los logs del build, AC4); las incluidas se loguean
  como `Ramas detectadas (se desplegarán): ...`.
- **Salvaguarda «todas excluidas»**: si TODAS las ramas llevan el prefijo,
  el script emite `::warning::` («Todas las ramas tienen el prefijo
  no-deploy/: solo se desplegará la rama por defecto en la raíz.») y
  continúa desplegando solo la rama por defecto en la raíz — **sin
  abortar**. El caso real de **cero ramas sin prefijo** (p. ej. repositorio
  sin ramas remotas) conserva el comportamiento previo: `::error::` +
  `exit 1`.
- El texto del hub se ajusta: «Las ramas no-default **desplegadas** tienen
  su preview bajo esta ruta...» (antes «Cada rama no-default del
  repositorio tiene su preview...»), reflejando que ya no todas las ramas
  se sirven.

### 3. Caso límite aceptado: `no-deploy` sin barra NO se excluye

El prefix match es `no-deploy/` con barra: una rama llamada exactamente
`no-deploy` (sin barra, ni segmentos posteriores) **no** casa con el
prefijo y se despliega como una rama normal. Caso límite improbable (el
prefijo es un namespace, no un nombre de rama) aceptado y documentado; el
mismo criterio es consistente en las dos capas (el patrón `no-deploy/**` de
GitHub tampoco casa `no-deploy`).

### 4. Documentación

El README (sección 6) documenta el mecanismo: ramas con prefijo
`no-deploy/` excluidas del hub de previews y un push a ellas sin disparo del
workflow, con el caso de uso de conservar ramas no fusionables
(`feat/...` → `no-deploy/feat/...`). La línea de cabecera de la sección
vuelve a decir «cada push de cualquier rama», coherente con el revert de
`1cd1061` (sin reintroducir la limitación del ADR-041).

## Alternativas descartadas

- **Reintroducir la limitación de `push` a `main`/`dev` (ADR-041)**:
  descartado — el usuario la revirtió a propósito (`1cd1061`, 2026-08-07);
  además de contradecir esa intención explícita, perdería los previews
  frescos de las ramas de trabajo en cada push (que se actualizaban al
  instante y es el comportamiento que el usuario quiere conservar).
- **Solo `branches-ignore` sin tocar el script**: descartado —
  `workflow_dispatch` y `delete` no admiten filtros de rama; un
  re-despliegue manual o el borrado de una rama `no-deploy/` volverían a
  extraerla en `_site/dev/` y a enlazarla en el hub.
- **Solo filtro en el script sin `branches-ignore`**: descartado — el push
  a una rama `no-deploy/*` seguiría disparando el workflow y consumiendo
  minutos de Actions (build completo de todas las ramas) aunque el resultado
  final no desplegara la rama; la mitad del ahorro de la issue depende del
  filtro del trigger.
- **Otro prefijo o lista mantenida manualmente**: descartado —
  `no-deploy/` es autoexplicativo (una rama excluida «no se despliega» sin
  más convención que su nombre) y el mecanismo es **idéntico para cualquier
  prefijo**, por lo que cambiarlo no aporta nada; una lista explícita de
  ramas exigiría mantenimiento en cada alta/baja y desincronizaría las dos
  capas (el trigger no puede expresar una lista arbitraria con un patrón
  simple).

## Consecuencias

### Positivas

- **Ahorro de recursos real**: un push a una rama `no-deploy/*` no dispara
  el workflow (cero minutos de Actions) y la rama nunca entra en la cola de
  deployments de Pages; las ramas conservadas sin fusionar dejan de
  consumir en cada iteración.
- **Doble capa (defensa en profundidad)**: el filtro del trigger evita el
  coste; el filtro del script garantiza el **resultado correcto** en todas
  las vías de entrada (`push` con workflow aún sin promocionar,
  `workflow_dispatch` y `delete`).
- **Trazabilidad**: los logs del build listan las ramas excluidas, de modo
  que una rama que no aparece en el hub se distingue entre «excluida» y
  «no detectada».
- **Despliegue atómico en el caso límite**: si todas las ramas acaban con
  el prefijo, el build no aborta (warning + solo rama por defecto en la
  raíz); el `::error::` + `exit 1` se conserva para el caso real de cero
  ramas remotas.
- **Resto de ramas sin cambios**: `main` en la raíz, ramas no-default en
  `/dev/<ruta-saneada>/` y hub regenerado con sus enlaces (AC3).

### Negativas / Riesgos

- **Borrar una rama `no-deploy/` SÍ dispara un run**: el evento `delete` no
  admite filtros y reconstruye el sitio completo. Aceptado: es un run único
  con salida **idéntica** a la anterior (la rama nunca estuvo desplegada),
  y eliminar la exclusión tras borrar la rama es justo el comportamiento
  deseado.
- **Rama llamada exactamente `no-deploy` (sin barra) no se excluye**: caso
  límite aceptado y documentado; el prefijo se define con barra para que
  solo actúe sobre el namespace completo.
- **El filtro del trigger solo tiene efecto pleno cuando el workflow esté
  en la rama por defecto (main)**: mientras esta versión viva solo en la
  rama de trabajo, GitHub evalúa el workflow desde `main` para decidir el
  disparo, así que un push a `no-deploy/*` aún ejecutaría el run; la capa
  de script ya excluye del build en ese escenario.
- **Orden recomendado al usuario**: **promover esta versión a `main` ANTES
  de renombrar** la rama (`feat/...` → `no-deploy/feat/...`): renombrar
  antes expone a un run intermedio con el script viejo (la rama renombrada
  no tiene esta versión del script) que desplegaría la rama una última vez.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios** (regla 3 de AGENTS.md): el
  cambio es interno (infraestructura de despliegue); el usuario final no ve
  ninguna diferencia de comportamiento y el manual no documenta los
  previews por rama (misma decisión que ADR-036, ADR-041 y ADR-044).
- El cambio es **retrocompatible**: ninguna rama existente con el prefijo
  se desplegaba antes de forma distinta (el prefijo es nuevo), y el resto
  del pipeline (saneo, checks de colisión, `strip_sensitive`, hub) no se
  toca.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `scripts/build-pages-site.sh` | **Modificado**: `NO_DEPLOY_PREFIX="no-deploy/"`; partición de ramas remotas en `INCLUDED_BRANCHES`/`EXCLUDED_BRANCHES` (prefix match con barra); log «Ramas excluidas del despliegue (prefijo no-deploy/): ...»; salvaguarda «todas excluidas» (`::warning::` + solo rama por defecto en la raíz, sin abortar; `::error::` + `exit 1` preservado para el caso real de cero ramas); texto del hub («Las ramas no-default desplegadas...»); comentarios de cabecera y del paso 2 |
| `.github/workflows/deploy-all-branches.yml` | **Modificado**: `on: push` con `branches-ignore: ['no-deploy/**']` (patrón `**` multi-segmento); comentario de cabecera con la política de exclusión; `workflow_dispatch` y `delete` intactos |
| `README.md` | **Modificado**: sección 6 — bala documentando el prefijo de exclusión (no se sirve en el hub, el push no dispara el workflow, caso de uso «conservar ramas no fusionables») y retoque de la línea de cabecera a «cada push de cualquier rama» |
| `docs/adr-076-excluir-ramas-no-deploy.md` | **Nuevo**: este documento |

Related issue: #198 — https://github.com/gonzalitojh/Registro-personal/issues/198
