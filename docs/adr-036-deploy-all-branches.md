# ADR-036: Despliegue de todas las ramas mediante GitHub Actions (issue #83)

> **Nota de deprecación parcial (ADR-041, issue #98)**: la política de
> triggers documentada en este ADR — `on: push` a **todas las ramas** y la
> migración Pages legacy → Actions vía `gh api` — fue **sustituida** por el
> ADR-041 (revisión de triggers, issue #98): `push` limitado a `main`/`dev`,
> guard `ref_type == 'branch'` en el evento `delete` y
> `actions/configure-pages@v5` con `enablement: true` en lugar del hack
> `gh api`. El resto de este ADR (multi-rama, rutas dinámicas, saneo de
> nombres, `strip_sensitive()`, entorno `github-pages`) sigue vigente. Este
> documento se conserva intacto como histórico.

## Estado
Aceptado

## Fecha
2026-08-06

## Contexto

Hasta ahora, GitHub Pages se publicaba en modo **legacy** («Deploy from a
branch»): solo la rama `main` se servía en
`https://gonzalitojh.github.io/Registro-personal/`, y solo cuando se
promovía `dev` → `main`. Las ramas de trabajo (feature, fix…) no tenían
ningún preview público: para probar un cambio había que desplegarlo en
local o esperar a que llegara a `main`.

La issue #83 pedía:

1. Una GitHub Action que despliegue **todas las ramas** del repositorio en
   GitHub Pages.
2. La rama `main` se mantiene en la raíz
   (`https://gonzalitojh.github.io/Registro-personal/`, sin nombre de rama).
3. Cada rama se sirve en su propio subdirectorio
   (`https://gonzalitojh.github.io/Registro-personal/<rama>/`) con la web
   **completa y funcional** (CSS/JS, parciales `ocio/*`, login, service
   worker, manifest PWA).
4. El workflow debe evitar **bucles infinitos** (que el push del deploy no
   vuelva a disparar el workflow).

Estado detectado en el código que hacía falta cambiar:

- El **service worker** usaba rutas absolutas hardcodeadas
  `/Registro-personal/...` en `STATIC_ASSETS`, en los fallbacks offline y en
  el check `url.pathname.startsWith('/Registro-personal/')`.
- `js/sw-register.js` registraba el SW con `SW_PATH='/Registro-personal/service-worker.js'`
  y `SW_SCOPE='/Registro-personal/'` (absolutos hardcodeados).
- `manifest.json` tenía `start_url` y `scope` absolutos
  (`/Registro-personal/`).
- `index.html` y los parciales `ocio/*.html` ya usaban rutas relativas
  (`css/...`, `js/...`, `ocio/...`) y fetch relativo, así que eran
  compatibles con subdirectorios sin tocar nada.

Related issue: #83 — https://github.com/gonzalitojh/Registro-personal/issues/83

## Decisión

Sustituir el modo legacy de Pages por un **workflow de GitHub Actions que
publica todas las ramas**, y hacer que el service worker, el manifest y el
registro del SW resuelvan sus rutas **de forma dinámica respecto a su
propia base**, para que el mismo código funcione en la raíz (main) y en el
subdirectorio de cada rama.

### 1. Workflow `.github/workflows/deploy-all-branches.yml`

- **Disparadores**: `on: push` (todas las ramas, sin filtro), `on:
  workflow_dispatch` (re-despliegue manual desde la UI) y `on: delete` (al
  borrar una rama o tag se reconstruye el sitio; el evento `delete` no
  admite filtros de rama). Nota: la primera versión usó `push: []`, pero
  GitHub rechaza el fichero con «A sequence was not expected» (el esquema
  exige un mapa de filtros); la forma válida de «todas las ramas» es
  `push:` sin valor.
- **Sin bucle infinito**: el workflow **no hace push** — solo lee el
  repositorio y sube un artefacto a Pages. Pese a dispararse en cada push
  de cualquier rama, nada vuelve a escribir en el repo y por tanto no puede
  retrigger-se.
- **Permisos**: `contents: read`, `pages: write`, `id-token: write`
  (declarados a nivel de workflow y repetidos en el job `deploy`).
- **Concurrencia**: `concurrency: group: pages, cancel-in-progress: true`
  — una sola ejecución de Pages a la vez; si llega otra (p. ej. dos pushes
  seguidos), se cancela la anterior.
- **Job `build`** (ubuntu-latest):
  1. `actions/checkout@v4` con `fetch-depth: 0` (todas las ramas, no solo
     la actual).
  2. **Migración automática de Pages legacy → Actions** vía API de GitHub:
     `gh api` con `PUT /repos/<repo>/pages` y `build_type=workflow`; si
     devuelve 404 (sitio aún no creado) se reintenta con `POST`. Si ambos
fallan se emite `::warning::` indicando hacerlo manualmente en
      Settings → Pages → Source: «GitHub Actions» (el job no falla).
      **Advertencia**: el `GITHUB_TOKEN` no tiene permisos de
      administración para esa API, así que el intento automático suele
      fallar y la migración acaba haciéndose a mano la primera vez.
  3. `bash scripts/build-pages-site.sh` → genera `_site/`.
  4. `actions/upload-pages-artifact@v4` con `path: _site`.
- **Job `deploy`**: `needs: build`, `environment: github-pages` (con `url`
  del artefacto) y `actions/deploy-pages@v4`.
- **Requisito del entorno `github-pages`**: el entorno debe permitir
  desplegar a **todas las ramas**. En el primer despliegue desde una rama
  `feature/...`, el job `deploy` fallaba con «Branch ... is not allowed to
  deploy to github-pages due to environment protection rules» porque el
  entorno (heredado del modo legacy) solo tenía `main` como rama permitida.
  Se resolvió añadiendo el patrón **`**/*`** en Settings → Environments →
  `github-pages` → Deployment branches. Con la sintaxis `File.fnmatch` que
  usa GitHub (flag `FNM_PATHNAME`) los comodines `*` y `**` **no cruzan
  `/`**, por lo que `*` no matchea `feature/x`; el patrón `**/*` cubre
  cualquier jerarquía. (La API REST rechaza poner `protected_branches` y
  `custom_branch_policies` ambos a `false`, por eso se usa patrón comodín.)

### 2. Script `scripts/build-pages-site.sh`

Construye `_site/` (la raíz del repo) con **todas las ramas remotas**:

- Lista ramas con `git for-each-ref refs/remotes/origin`, recortando el
  prefijo `refs/remotes/origin/` y filtrando `origin/HEAD` (el refname
  completo evita las variantes de `origin/HEAD` según la versión de git).
- **Rama por defecto** (normalmente `main`): detectada con
  `git symbolic-ref refs/remotes/origin/HEAD` (con fallback a `main` si no
  existe). Se extrae con `git archive` en la **raíz de `_site/`**.
- **Cada rama no-default** se extrae en `_site/<ruta-saneada>/`, y se
  añade un `.nojekyll` en la raíz y en cada carpeta de rama (Pages sirve el
  contenido tal cual, sin Jekyll).
- **Saneo de nombres de rama** (`sanitize_segment`): cada segmento se
  normaliza a `[A-Za-z0-9._-]` (todo lo demás → `-`), se colapsan los `-`
  repetidos, se recortan los `-`/`.` de los extremos y un segmento vacío
  pasa a llamarse `branch`. Se mantienen las **jerarquías con `/`**
  (p. ej. `feature/mi-cambio` → `_site/feature/mi-cambio/`).
- **Checks de colisión ANTES de extraer** (con `::error::` + `exit 1`):
  duplicados entre rutas saneadas de ramas, y colisión del primer segmento
  de cada ruta contra las entradas top-level de la rama raíz (via
  `git ls-tree`). Evita sobrescribir la raíz o ramas entre sí.
- **`strip_sensitive()` — defensa en profundidad**: elimina del árbol
  extraído (raíz y ramas) los ficheros sensibles que nunca deben servirse
  públicamente: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
  `*service-account*.json`, `credentials*.json`.
- Refresca `refs/remotes/origin/*` con `git fetch --prune` si existe un
  remoto `origin` (redundante en CI — el checkout ya trae todo — pero
  permite probar el script en local).
- Resumen final con `du`/`find` para los logs del job.

### 3. Rutas dinámicas en el service worker (`service-worker.js`)

Se eliminan todas las rutas absolutas `/Registro-personal/...`:

- Al arrancar: `const scopeURL = new URL(self.registration.scope)`,
  `scopePath = scopeURL.pathname` y un helper
  `resolved(p) = new URL(p, scopeURL).toString()`.
- `STATIC_ASSETS` pasa a ser una lista de **rutas relativas `./...`** que
  se resuelven con `resolved()` durante el `install`; el mismo fichero
  sirve para la raíz (main) y para cada preview de rama.
- Los **fallbacks offline** (catch de `cacheFirst` y `networkFirst`) y el
  `cache.put` del app shell tras navegación de red usan
  `resolved('./index.html')`.
- El check de **assets propios** pasa de
  `url.pathname.startsWith('/Registro-personal/')` a
  `url.pathname.startsWith(scopePath)`.
- **Cachés renombradas** de `mi-registro-v2-*` a `mi-registro-v3-*`: el
  `activate` elimina cualquier caché fuera de la allowlist, de modo que las
  entradas antiguas guardadas con rutas absolutas se invalidan de golpe.

### 4. Base dinámica en `js/sw-register.js`

- `SITE_BASE = new URL('../', import.meta.url).href` (el módulo vive en
  `js/` y sube un nivel hasta la raíz de la app).
- `SW_PATH = new URL('service-worker.js', SITE_BASE).href` y
  `SW_SCOPE = SITE_BASE`; el registro pasa `{ scope: SW_SCOPE }` explícito,
  de modo que funciona igual en la raíz y en los subdirectorios de rama.

### 5. `manifest.json` relativo

`start_url` y `scope` pasan a `'./'`: se resuelven relativos al URL del
manifest, es decir, a la base de cada rama.

### 6. Versionado PWA

`APP_VERSION` en `js/config.js` sube a `20260808` y
`scripts/bump-version.sh` sincroniza los `?v=20260808` de `index.html` y
`service-worker.js`, invalidando las cachés PWA de la versión anterior.

### 7. README actualizado

La sección 6 («Subir a GitHub y activar Pages») se reescribe: Source
**«GitHub Actions»** (con nota sobre la migración automática del modo
antiguo), despliegue de todas las ramas (main en la raíz, resto en
`/<rama>/` como preview completo), re-despliegue manual con
`workflow_dispatch` y comportamiento al borrar una rama.

## Alternativas descartadas

- **Deploy por rama en modo legacy** («Deploy from a branch»): descartado —
  GitHub Pages legacy solo permite elegir **una** rama y **un** path por
  sitio; no existe forma de publicar varias ramas simultáneamente ni
  subdirectorios automáticos por rama.
- **Rama `gh-pages`** (compilar y pushear el sitio a una rama dedicada):
  descartado — requiere que el workflow haga **push**, lo que reintroduciría
  el riesgo de bucle infinito (además de exigir un PAT y acciones de
  terceros), y complica el modelo «cada rama en su subdirectorio» al
  consolidar ramas sin nombres de origen.
- **`amalgamate-pages` u otras acciones de terceros**: descartado — añade
  dependencias externas no mantenidas por GitHub y típicamente hacen push a
  `main`/`gh-pages`; la consolidación de ramas se resuelve con un script
  propio de 170 líneas, sin dependencias.
- **Un artefacto de Pages por rama sin consolidar**: descartado — GitHub
  Pages publica **un único artefacto** por despliegue; no es posible
  publicar N artefactos (uno por rama) en el mismo sitio, y el
  `environment: github-pages` es único por repositorio.
- **Mantener rutas absolutas y publicar solo main**: descartado — no cumple
  el requisito de la issue (#83) de servir cada rama en su subdirectorio.

## Consecuencias

### Positivas

- **Previews públicos de cada rama**: cualquier push a una rama (feature,
  fix…) despliega la web completa en `/<rama>/` en minutos; probar cambios
  ya no requiere esperar a `main` ni desplegar en local.
- **`main` intacta en la raíz**: las URLs de producción no cambian.
- **Sin bucles infinitos**: el workflow no hace push, solo lee y sube
  artefacto a Pages.
- **Reducción de ejecuciones**: `concurrency` con `cancel-in-progress`
  cancela despliegues obsoletos ante pushes consecutivos.
- **PWA por rama**: service worker, manifest y assets se resuelven desde la
  base de cada rama; el mismo código vale para todos los subdirectorios.
- **Migración de Pages automática**: el primer despliegue intenta convertir
  el modo legacy a GitHub Actions vía API; si falla, aviso `::warning::`
  claro para hacerlo manualmente.
- **Defensa en profundidad**: `strip_sensitive()` garantiza que un fichero
  sensible commiteado por error en cualquier rama **no** se sirva en el
  despliegue.
- **Errores de colisión explícitos en CI**: si dos ramas sanean a la misma
  ruta o una colisiona con la raíz, el build falla con un mensaje claro
  (renombrar la rama).

### Negativas / Riesgos

- **Consumo de minutos de Actions**: cada push de cualquier rama ejecuta
  build + deploy. Se mitiga con la cancelación de ejecuciones obsoletas,
  pero el tráfico de ramas es directamente proporcional al consumo.
- **Migración automática no garantizada**: la conversión legacy → Actions
  depende de la API de GitHub (`gh api`); si la cuenta o el token lo
  impiden, requiere una intervención manual puntual (Settings → Pages).
  Además, la **política de ramas del entorno `github-pages`** no se migra
  automáticamente: si el entorno conserva la lista de ramas del modo legacy
  (p. ej. solo `main`), los deploys desde otras ramas fallan hasta que se
  añada el patrón `**/*` en Settings → Environments.
- **Colisiones de ramas tras el saneo**: dos ramas cuyos nombres solo
  difieran en caracteres fuera de `[A-Za-z0-9._-]` (p. ej. `feat/a` y
  `feat/a#x`) colisionan y rompen el build hasta que se renombra la rama.
- **Previews conectados a la base de producción**: cada rama despliega la
  app completa con la misma configuración de Firebase, por lo que los
  previews leen/escriben en la misma Firestore. No es un cambio nuevo (ya
  ocurría con cualquier deploy), pero ahora hay N apps funcionales
  apuntando a la misma base; se mitiga con la restricción de dominios
  autorizados en Firebase (README sección 7) y la lista de correos
  invitados.

### Neutras

- **`docs/manual-de-usuario.md` no se tocó**: el cambio es interno
  (infraestructura de despliegue); el usuario final no ve ninguna
  diferencia de comportamiento, por lo que no aplica la obligación de
  AGENTS.md de actualizar el manual.
- **PWA versionada a `20260808`**: `APP_VERSION`, `?v=` en `index.html` y
  `service-worker.js` invalidan las cachés previas (incluidas las antiguas
  con rutas absolutas, al renombrarse las cachés a `v3`).

## Nota de implementación

- El workflow usa `on: push` — sin valor, lo que GitHub interpreta como
  «todas las ramas» (sin filtro de rama ni de paths). La forma `push: []`
  es inválida y GitHub la rechaza al validar el fichero.
- El job `build` depende de `fetch-depth: 0` para que el checkout traiga
  **todas** las ramas a `refs/remotes/origin/*`; el script las lista con
  `git for-each-ref` y extrae cada una con `git archive` (sin tocar el
  working tree).
- El evento `delete` no admite filtros de rama y reconstruye **todo** el
  sitio (no solo elimina la rama borrada): simple y robusto, a costa de una
  ejecución completa tras cada borrado.
- La rama por defecto se detecta vía `origin/HEAD` (`git symbolic-ref`),
  con fallback a `main`, para no hardcodear el nombre en el script.
- En local, `bash scripts/build-pages-site.sh` sirve para previsualizar el
  sitio (refresca `origin/*` con `fetch --prune` si hay remoto).

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.github/workflows/deploy-all-branches.yml` | **Nuevo**: workflow de Pages con todas las ramas (`on: push` + `workflow_dispatch` + `delete`), migración legacy→Actions vía `gh api`, jobs `build`/`deploy`, `concurrency` con cancelación |
| `scripts/build-pages-site.sh` | **Nuevo**: construye `_site/` con todas las ramas (default en raíz, resto en subdirectorios saneados), `.nojekyll` por carpeta, checks de colisión, `strip_sensitive()` |
| `service-worker.js` | Rutas absolutas `/Registro-personal/...` → base dinámica (`scopeURL`/`scopePath`/`resolved()`); `STATIC_ASSETS` relativos; fallbacks con `resolved('./index.html')`; check `startsWith(scopePath)`; cachés renombradas `v3`; `?v=20260808` |
| `js/sw-register.js` | `SITE_BASE`/`SW_PATH`/`SW_SCOPE` derivados de `import.meta.url`; registro con scope explícito |
| `manifest.json` | `start_url` y `scope` → `'./'` (relativos al manifest) |
| `js/config.js` | `APP_VERSION` de `20260807` a `20260808` |
| `index.html` | Versionado `?v=20260808` (sincronizado por `scripts/bump-version.sh`) |
| `README.md` | Sección 6 reescrita: Source «GitHub Actions», despliegue de todas las ramas, previews, re-despliegue manual, borrado de rama. Añadido requisito del entorno `github-pages` (patrón `**/*`) |
| `docs/adr-036-deploy-all-branches.md` | **Nuevo**: este documento |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de infraestructura, no visible para el usuario) |
| Entorno `github-pages` (Settings) | Configuración manual de una sola vez: Deployment branches → patrón `**/*` (tras primera migración a GitHub Actions) |

Related issue: #83 — https://github.com/gonzalitojh/Registro-personal/issues/83
