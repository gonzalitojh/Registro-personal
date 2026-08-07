# ADR-044: Hub de previews en /dev y reestructuración del despliegue multi-rama (issue #103)

## Estado
Aceptado

## Fecha
2026-08-07

## Contexto

El ADR-036 introdujo el despliegue multi-rama en GitHub Pages vía
`.github/workflows/deploy-all-branches.yml` y `scripts/build-pages-site.sh`:
main en la raíz, cada rama no-default en `/<ruta-saneada>/`
(`https://gonzalitojh.github.io/Registro-personal/<rama>/`). El ADR-041
revisó después los triggers (push solo a `main`/`dev`, guard en `delete`,
`configure-pages@v5` y reintentos de deploy), dejando intacta la estructura
de rutas.

La issue #103 pedía reestructurar esa estructura:

1. Una **página simple**, desplegada en `/Registro-personal/dev`, que
   simplemente tenga enlaces al resto de ramas.
2. La rama `main` sigue desplegada en `/Registro-personal` (raíz, **sin
   cambios**).
3. El resto de ramas se desplegarían en `/Registro-personal/dev/<nombre de
   rama>`, **incluida la rama `dev`**.

Es decir: la ruta `/dev/` pasa de ser el preview de la rama `dev` a ser un
**hub de previews** con una página índice auto-generada.

Related issue: #103 — https://github.com/gonzalitojh/Registro-personal/issues/103

## Decisión

Reestructurar el despliegue multi-rama para convertir `/dev/` en un **hub de
previews**:

- **`main`** sigue extrayéndose en la **raíz de `_site/`** (sin cambios;
  las URLs de producción quedan intactas).
- **`_site/dev/index.html`** es una **página índice simple auto-generada**
  por el script (el hub de previews) con enlaces a todas las ramas
  no-default (incluida `dev`) y a la raíz.
- **Cada rama no-default** se extrae en `_site/dev/<ruta-saneada>/`
  (incluida `dev` → `_site/dev/dev/`), en lugar de `_site/<ruta>/`.

### 1. Constante `HUB_DIR="dev"` en `scripts/build-pages-site.sh`

El nombre del hub es fijo: `HUB_DIR="dev"`. Toda la construcción depende de
esta constante (extracciones, checks y generación del índice), de modo que
renombrar el hub futuro se reduce a cambiar una línea. Nota: `dev` es
también el nombre de la rama de integración, que sanea a `dev` y se extrae
en `_site/dev/dev/` (la propia rama dev tiene su preview como cualquier
rama no-default, bajo el hub que lleva su mismo nombre).

### 2. Generación del índice: `html_escape()` + `build_hub_index()`

- **`html_escape()`**: escapa las cinco entidades estándar (`&`, `<`, `>`,
  `"`, `'`) con `sed` antes de incrustar el texto visible en el HTML. Los
  `href` usan rutas saneadas (solo `[A-Za-z0-9._-]` y `/`), pero también se
  escapan por defensa en profundidad.
- **`build_hub_index()`**: genera `_site/dev/index.html` como HTML
  autocontenido (doctype, `lang="es"`, viewport, CSS mínimo con
  `color-scheme: light dark`, títulos y enlaces con `overflow-wrap:
  anywhere`). Recibe una línea por rama con el formato
  `NOMBRE<TAB>ruta` (la ruta saneada **relativa al hub**, sin el prefijo
  `dev/`) ya ordenadas.
- **Determinismo byte-idéntico**: el HTML se acumula con `printf` línea a
  línea, **sin timestamps ni fechas**. Dos builds del mismo conjunto de
  ramas producen el mismo `index.html` byte a byte.
- **Orden alfabético**: el índice se ordena por **nombre original** de rama
  con `LC_ALL=C sort` (no por la ruta saneada).
- **hrefs relativos al hub**: `../` para el enlace a la raíz (main) y
  `<ruta-saneada>/` para cada rama. El texto visible es el **nombre
  original** de la rama, escapado con `html_escape()`.
- **Guard de cero ramas no-default**: `mkdir -p _site/dev` + `build_hub_index`
  con entradas vacías producen un índice mínimo con solo el enlace a la
  raíz; el build no falla si no hay ramas de trabajo.

### 3. Checks de colisión actualizados a la nueva estructura

Todos se ejecutan **antes de extraer** ramas y fallan con `::error::` +
`exit 1`:

- **(a) Duplicados de rutas completas**: dos ramas no-default cuyas rutas
  saneadas completas (con prefijo `dev/`) coinciden (p. ej. `feat/a` y
  `feat/a#x`), con mensaje claro de colisión.
- **(b) Hub vs entradas top-level de main**: como **todas** las ramas
  no-default comparten el primer segmento `HUB_DIR`, el check degenera a un
  único caso: si la rama raíz (`origin/${DEFAULT_BRANCH}`) tiene una entrada
  top-level llamada `dev` (fichero o directorio, detectada con
  `git ls-tree`), el build falla con mensaje claro pidiendo **renombrar la
  entrada `dev` de main**.
- **(c) Nuevo, defensivo — colisión archivo/directorio con el índice**:
  ninguna ruta bajo el hub puede empezar por `index.html`. Una rama llamada
  `index.html` (o `index.html/foo`) escribiría `_site/dev/index.html` como
  **directorio**, colisionando con el archivo índice del hub
  (`_site/dev/index.html`). El check lo detecta antes de extraer y pide
  renombrar la rama. Nota: el nombre de rama `.nojekyll` se sanea a
  `nojekyll` (el saneo recorta `-`/`.` iniciales), por lo que no colisiona
  con el `.nojekyll` del hub y no requiere check propio.

### 4. Extracción bajo el hub, `.nojekyll` y `strip_sensitive()` intactos

Cada rama no-default se extrae en `_site/dev/<ruta-saneada>/` con
`git archive`, se añade `.nojekyll` en la raíz, en el hub (`_site/dev/`) y
en cada carpeta de rama (Pages sirve el contenido tal cual, sin Jekyll), y
se aplica `strip_sensitive()` a raíz y a cada rama, **exactamente igual
que documentaba el ADR-036** (defensa en profundidad: `.env`, `*.pem`,
`*.key`, `*.p12`, `*.pfx`, `*service-account*.json`, `credentials*.json`).

### 5. Regeneración automática en cada build

El índice se regenera en **cada ejecución** del script: una rama nueva
aparece en el hub automáticamente, y una rama borrada desaparece. El
evento `delete` del workflow (que reconstruye **todo** el sitio, sin
filtros de rama) garantiza que al borrar una rama su preview deja de
servirse y se elimina del índice en el mismo build.

### 6. Workflow sin cambios

`.github/workflows/deploy-all-branches.yml` **no se toca**: los triggers
(push a `main`/`dev`, `workflow_dispatch`, `delete` con guard
`ref_type == 'branch'`), los reintentos y el paso `configure-pages@v5`
documentados en el ADR-041 siguen intactos; el workflow continúa llamando
al script sin ningún cambio.

### 7. README y `.gitignore`

- **README sección 6** actualizada con la nueva estructura de rutas: hub
  `/dev/` con índice auto-generado, ramas en `/dev/<rama>/`, la propia
  `dev` en `/dev/dev/`, y la regeneración del índice en cada build (ramas
  nuevas aparecen, borradas desaparecen).
- **`.gitignore` nuevo** con `_site/`: el build local no debe committearse.
  Es la mitigación del hallazgo MEDIUM del security scan (evitar que
  `git add .` suba el build de Pages al repositorio).

## Alternativas descartadas

- **Índice estático commiteado a mano**: descartado — quedaría **obsoleto**
  en cuanto se creara o borrara una rama: exigiría un commit y un merge
  adicionales por cada cambio de ramas, y no cubre el caso «rama borrada
  desaparece del índice» sin intervención manual.
- **Índice con timestamps o fecha de generación**: descartado — rompe el
  **determinismo**: dos builds del mismo conjunto de ramas producirían
  bytes distintos, dificultando la comparación y las cachés.
- **Mantener las URLs antiguas `/<rama>/`**: descartado — imposible con la
  nueva estructura: el primer segmento de todas las ramas no-default es
  ahora `dev`, y `dev/` está ocupado por el hub. Las URLs antiguas
  (`/Registro-personal/<rama>/`) pasan a devolver **404** — comportamiento
  esperado: el hub (`/dev/`) es el nuevo punto de entrada a los previews.
- **Índice generado por la app en runtime**: descartado — la app no debe
  conocer la lista de ramas ni el hub; es **infraestructura** del
  despliegue y pertenece al script de build, no al código de la web.
- **Enlazar `main` como una rama más de la lista**: descartado — main vive
  en la raíz, no bajo el hub; se enlaza de forma destacada y separada al
  inicio del índice con `href="../"` («main — raíz (producción)»), en
  lugar de mezclarlo con el resto.

## Consecuencias

### Positivas

- **Hub de previews navegable**: una única URL estable (`/dev/`) lista
  todas las ramas de trabajo con enlaces directos; el enlace a producción
  (main) siempre está presente al inicio del índice.
- **Índice siempre al día**: se regenera en cada build; ramas nuevas
  aparecen y borradas desaparecen sin intervención manual (el evento
  `delete` del workflow reconstruye todo el sitio).
- **Determinismo**: sin timestamps, dos builds del mismo conjunto de ramas
  producen un `index.html` byte-idéntico.
- **URLs de producción intactas**: main sigue en la raíz; nada cambia para
  el sitio público.
- **Checks de colisión más estrictos**: el check (c) cierra la colisión
  archivo/directorio con el índice, imposible de detectar con la estructura
  anterior.

### Negativas / Riesgos

- **URLs antiguas `/<rama>/` → 404**: cualquier enlace o bookmark de un
  preview con la estructura anterior deja de funcionar. Es el
  comportamiento esperado de la decisión (el hub `/dev/` es el nuevo punto
  de entrada); no se añade redirección.
- **Si `main` gana una entrada top-level `dev`**: el build falla con un
  mensaje claro pidiendo renombrar la entrada de main (check b). Es un
  bloqueo intencional: sin él, el hub y la entrada de main colisionarían
  silenciosamente en el despliegue.
- **Rama llamada `index.html` inviable**: una rama (o un primer segmento de
  rama) que sane a `index.html` rompe el build con mensaje claro (check c);
  hay que renombrarla. Caso límite improbable, pero ahora está detectado en
  CI en lugar de corromper el despliegue.

### Neutras

- **`docs/manual-de-usuario.md` sin cambios**: el cambio es interno
  (infraestructura de despliegue); el usuario final no ve ninguna
  diferencia de comportamiento, por lo que no aplica la obligación de
  AGENTS.md de actualizar el manual (misma decisión que ADR-036 y ADR-041;
  se verificó que el manual no menciona rutas de despliegue).
- **Workflow sin cambios**: triggers, guard, reintentos y
  `configure-pages@v5` se mantienen exactamente como los documentó el
  ADR-041.
- **La web de cada preview no cambia**: service worker, manifest y assets
  relativos siguen funcionando igual desde su nueva base `/dev/<rama>/` (la
  base dinámica de ADR-036 los hace agnósticos a la profundidad).

## Nota de implementación

- **Por qué `sed` en `html_escape()`**: en la expansión de patrones de
  bash, `&` en el reemplazo se sustituye por el texto que casó con el
  patrón: `"${s//</&lt;}"` produce `'<lt;'` (el `&` se convierte en el
  literal `<` casado), no la entidad `&lt;`. En `sed`, en cambio, `\&` es
  el carácter `&` literal, por lo que `sed 's/&/\&amp;/g; s/</\&lt;/g; ...'`
  escapa correctamente. El comentario del script documenta este detalle.
- **Por qué bucle + `printf` en lugar de heredoc con interpolación**: con
  `set -u` y nombres de rama arbitrarios, un heredoc con variables (p. ej.
  `<h1>${name}</h1>`) es frágil (una variable sin definir aborta, y el
  sangrado/expansión de `$(...)` dentro del heredoc es delicado). Acumular
  líneas con `printf '%s\n'` y comillas simples evita cualquier
  interpolación accidental; el único punto de interpolación es el `li` de
  cada rama, donde los valores ya pasan por `html_escape()`.
- **Por qué el check (b) degenera a un único caso `dev`**: todas las ramas
  no-default comparten el primer segmento (`HUB_DIR`), así que el bucle
  sobre `NON_DEFAULT_PATHS` comprueba N veces el mismo valor. El mensaje de
  error usa el primer segmento real (`'${first_segment}'`) y pide renombrar
  la entrada homónima de main; en la práctica solo puede fallar con la
  entrada `dev` (a menos que se cambie `HUB_DIR`).
- **Por qué `.nojekyll` no requiere check**: el saneo recorta `-`/`.`
  iniciales (`s/^[-.]+//` en `sanitize_segment`), así que una rama llamada
  `.nojekyll` se convierte en `nojekyll` y no colisiona con el archivo
  `.nojekyll` del hub. Lo mismo aplica a la raíz.
- **Separador `TAB` en las entradas del índice**: `git` no permite
  caracteres de control en los nombres de rama, así que el tab es un
  separador seguro entre el nombre original y la ruta saneada.
- **El orden del índice es por nombre original** (`LC_ALL=C sort` sobre
  `NOMBRE<TAB>ruta`), no por ruta saneada: el texto visible es el nombre
  real de la rama, que es lo que ordena el usuario espera ver.
- El guard de cero ramas no-default: si `HUB_ENTRIES` está vacío,
  `build_hub_index` recibe cero argumentos y genera el índice mínimo (solo
  el enlace a la raíz); el `mkdir -p _site/dev` del paso 7b cubre el caso.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `scripts/build-pages-site.sh` | **Modificado**: `HUB_DIR="dev"`; nuevas funciones `html_escape()` y `build_hub_index()` (HTML autocontenido acumulado con `printf`, sin timestamps → determinismo byte-idéntico, orden `LC_ALL=C sort` por nombre original, hrefs relativos al hub); checks de colisión (a) duplicados con prefijo `dev/`, (b) hub vs entradas top-level de main, (c) nuevo defensivo `index.html`; extracción de ramas en `_site/dev/<saneada>/` con `.nojekyll` y `strip_sensitive()`; paso 7b genera el hub (con guard de cero ramas no-default); resumen actualizado |
| `README.md` | **Modificado**: sección 6 con la nueva estructura de rutas — hub `/dev/` con índice auto-generado en cada build, ramas en `/dev/<rama>/`, `dev` en `/dev/dev/` |
| `.gitignore` | **Nuevo**: `_site/` (el build local de Pages no debe ir a git; mitigación MEDIUM del security scan) |
| `docs/adr-044-dev-preview-hub.md` | **Nuevo**: este documento |
| `docs/adr-036-deploy-all-branches.md` | **Modificado**: nota de deprecación parcial al inicio (estructura de rutas `/<rama>/` sustituida por el hub `/dev/` de ADR-044); el resto queda intacto como histórico |
| `.github/workflows/deploy-all-branches.yml` | **Sin cambios** (triggers intactos: push a `main`/`dev`, `workflow_dispatch`, `delete` con guard `ref_type == 'branch'`; sigue llamando al script) |
| `docs/manual-de-usuario.md` | **Sin cambios** (cambio interno de infraestructura, no visible para el usuario final — misma decisión que ADR-036 y ADR-041) |

Related issue: #103 — https://github.com/gonzalitojh/Registro-personal/issues/103
