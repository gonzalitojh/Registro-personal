# ADR-019: Rama `dev` como rama de integración para las PR de los agentes

## Estado
Implementado

## Fecha
Agosto 2026

## Contexto

Hasta ahora, el agente publisher creaba todas las Pull Requests contra la rama por defecto del repositorio (`main`), lo que hacía que los cambios llegaran directamente al entorno de producción sin pasar por un entorno intermedio de verificación.

Para resolverlo, el usuario creó la rama `dev` como **rama de integración**, la desplegó en **Cloudflare Pages como entorno de desarrollo** y promoverá `dev` a `main` cuando estime que la versión es estable. La issue #20 divide el trabajo en dos partes:

1. **Parte del usuario (hecha)**: creación de la rama `dev` en el remoto y sesión iniciada en Cloudflare Pages para el despliegue del entorno de desarrollo.
2. **Parte del agente (esta tarea)**: configurar a los agentes para que TODAS las PR apunten a `dev` como rama base (en lugar de `main`).

Related issue: #20 — https://github.com/gonzalitojh/Registro-personal/issues/20

## Decisión

Configurar el flujo de publicación de los agentes para que `dev` sea la rama de integración de todo el trabajo, con los siguientes componentes:

### 1. PR contra `dev` como rama base

El publisher crea **todas** las PR contra la rama `dev` (y no contra la rama por defecto del repositorio):

```
gh pr create --base dev --title "<title>" --body "<body>"
```

Si `gh pr create --base dev` falla, el publisher debe verificar que `origin/dev` existe y que la rama de feature tiene commits, reportando el error si no es así.

### 2. Ramas de feature creadas SIEMPRE desde `origin/dev`

Las ramas de feature se crean siempre a partir de `origin/dev` —nunca desde la rama actual ni desde `main`— para que el diff de la PR contra `dev` sea limpio:

- `git checkout -b <branch-name> origin/dev`
- Si la rama de feature ya existe localmente, **no se recrea**: se hace `git checkout <branch-name>` y `git rebase origin/dev` si hace falta.

### 3. Verificación pre-flight de `origin/dev`

Antes de publicar, el publisher ejecuta `git fetch origin --prune` y verifica que `origin/dev` existe (`git branch -r | grep dev`). Si no existe, se detiene y reporta el error.

### 4. Flujo de ramas

- `dev` = rama de **integración**: todas las PR de los agentes se fusionan aquí y el entorno de desarrollo de Cloudflare Pages se despliega desde esta rama.
- El usuario promueve `dev` a `main` cuando estima que la versión es estable.
- `main` = rama de **producción**: recibe únicamente promociones de `dev`.

## Alternativas descartadas

- **PR directas contra `main`**: descartado porque el usuario no vería los cambios en el entorno de desarrollo antes de que lleguen a producción.
- **Vercel, Netlify o GitHub Actions para el despliegue del entorno de desarrollo**: descartado; se eligió Cloudflare Pages por el límite de despliegues.

## Consecuencias

### Positivas
- **Verificación antes de producción**: todos los cambios se prueban en el entorno de desarrollo (Cloudflare Pages, rama `dev`) antes de que el usuario los promueva a `main`.
- **Diffs limpios**: al partir las ramas de feature desde `origin/dev`, el diff de cada PR contra `dev` contiene únicamente los cambios de la tarea.

### Negativas
- **Posibles conflictos puntuales al promover `dev` a `main`**: si la promoción no es fast-forward, el usuario deberá resolver conflictos manualmente.
- **Ramas de feature antiguas creadas desde `main`**: si `dev` diverge de `main`, una rama de feature antigua puede arrastrar diffs no deseados; hay que recrearlas o rebasarlas contra `origin/dev`.

### Neutras
- **Cierre automático de issues**: GitHub cierra la issue con `Closes #N` al fusionar la PR en cualquier rama, incluida `dev` (el cierre funciona igual que contra `main`).
- **La nomenclatura de ramas no cambia**: sigue el patrón `<type-prefix>/issue-<N>-<slug>` (ej. `fix/issue-18-<slug>`); solo cambia la rama base de la PR y el origen de las ramas de feature.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `.opencode/agents/publisher.md` | Pre-flight `git fetch origin --prune` con verificación de `origin/dev`, checkout de ramas de feature desde `origin/dev` (con rebase si la rama ya existe) y `gh pr create --base dev` en todas las PR |
| `.opencode/agents/sdd-master.md` | Nota en Step 5 (Publishing): todas las PR se crean contra `dev`, nunca contra `main`; el usuario promueve `dev` a `main` cuando la versión es estable; el publisher aplica `--base dev` automáticamente |
| `docs/adr-019-dev-branch-integration.md` | **Nuevo**: este ADR documentando el flujo de ramas `dev` (integración) → `main` (producción) |
