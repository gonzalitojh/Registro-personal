# ADR-110: Lista completa de reparto y producción en series (aggregate_credits de TMDB) (issue #308)

## Estado

Aceptado

## Fecha

2026-08-19

## Contexto

La issue #308 reporta que en las **series** no se muestra la lista
completa de reparto y producción: «No se está mostrando la lista
completa de reparto y producción, al menos en las series, se muestra
una versión reducida».

Desde la issue #294 (ADR-104) la ficha de películas y series muestra
dos carruseles de elenco —«Producción» y «Reparto»— con el botón «Ver
en más detalle» que abre la ventana con la lista completa, alimentados
por `getMovieDetails`/`getTvExtraDetails` (`js/api-movies.js`), que
consultaban TMDB con `append_to_response=credits`.

El fallo estaba en TMDB, no en la UI: el endpoint `/tv/{id}/credits`
**no devuelve el elenco completo de una serie**, solo el reparto
principal de la **temporada más reciente** (documentado por TMDB: "This
call differs from the main credits call in that it does not return the
newest season. Instead, it is a view of all the entire cast & crew for
all episodes belonging to a TV show" — esa cita es de
`/tv/{id}/aggregate_credits`, el endpoint que SÍ devuelve la lista
completa). En las películas no había problema: `/movie/{id}/credits`
sí devuelve el reparto completo.

Además, el formato de `aggregate_credits` difiere del de `credits`:
el cast lleva `roles: [{character, …}]` (una persona puede interpretar
**varios personajes** a lo largo de la serie) y el crew
`jobs: [{job, …}]` (varias funciones por persona), sin campos planos
`character`/`job`, y `order` puede faltar en el crew.

Related issue: #308 — https://github.com/gonzalitojh/Registro-personal/issues/308

## Decisión

Cambiar **solo la capa de datos de las series** para consumir el
elenco completo de TMDB, manteniendo intacto el contrato que consumen
`ui.js` y `cast-modal.js`:

1. **`getTvExtraDetails` pasa de `append_to_response=credits,videos` a
   `append_to_response=aggregate_credits,videos`** (`js/api-movies.js`):
   una sola petición al mismo endpoint `/tv/{id}`, con la misma caché
   en memoria de 24 h (`providersCache`, clave `details_tv_${id}`) y
   sin coste extra de llamadas. Se conservan `videos` (tráiler),
   `created_by` y el resto de campos del detalle.
2. **Dos funciones de mapeo nuevas** — `mapAggregateCastPerson` y
   `mapAggregateCrewPerson` — que aplanan el formato de
   `aggregate_credits` al MISMO contrato de salida que
   `mapCastPerson`/`mapCrewPerson`:
   `{id, name, character|job, department, profileUrl, order}`.
   - **Cast**: `character` = todos los personajes de la persona,
     unidos con `", "` y sin repetidos («Ned Stark»,
     «Gregor Clegane, Dongo»…). Una persona puede interpretar varios
     personajes en la serie; tomar solo el primero perdería
     información real. Mismo patrón de fusión visible que los puestos
     del crew (que `groupCrewByDepartment` ya une con `", "`).
     `order: c.order ?? 999`.
   - **Crew**: `job` = todos los puestos de la persona, unidos con
     `", "` («Director, Guionista»); `department` plano se conserva
     (`c.department || "Otros"`); `order: c.order ?? 999` (aggregate
     no siempre trae order en el crew — mismo fallback que la UI ya
     aplica en `ui.js` y `cast-modal.js`).
3. **`mergeCreatorsIntoCrew` se conserva intacto**: los creadores
   vienen de `data.created_by` (base de `/tv/{id}`, no de credits) y
   siguen incorporándose al crew como área «Creadores» con `order: -1`
   y sin duplicar por id.
4. **Películas NO se tocan**: `getMovieDetails` y
   `mapCastPerson`/`mapCrewPerson` siguen con `credits`
   (`/movie/{id}/credits` sí devuelve la lista completa; no hay bug).
5. **Sin límite de tamaño**: el elenco completo se muestra en el
   carrusel y en la ventana de detalle (la issue pide la lista
   completa; las imágenes ya van con `loading="lazy"`).
6. **Robustez ante vacíos**: `roles`/`jobs` ausentes o vacíos →
   `character`/`job` = `""` (la UI ya oculta la línea de rol vacía y
   el modal no añade puestos vacíos).

Los consumidores (`castCrewHtml` en `ui.js`, `openCastModal`/
`groupCrewByDepartment` en `cast-modal.js`, buscador de la ventana)
**no cambian**: reciben el mismo contrato y, en series, el elenco
completo en lugar del reducido. El buscador filtra por nombre y por
personaje/función, así que también encuentra a una persona por
cualquiera de sus personajes unidos.

## Alternativas descartadas

- **Parametrizar `mapCastPerson`/`mapCrewPerson` para ambos formatos**:
  el mapeo de películas debe quedar inmune a regresiones; las funciones
  de aggregate tienen lógica propia (roles/jobs) que no comparten con
  las planas. Funciones nuevas mantienen el diff limpio y la ruta de
  películas intacta.
- **Llamada separada a `/tv/{id}/aggregate_credits`** (segunda
  petición HTTP): `append_to_response` lo soporta en la misma llamada
  de detalle; una petición extra añadiría latencia y dos puntos de
  fallo sin beneficio (misma caché, misma forma de datos).
- **Mostrar solo el primer personaje de `roles[]`**: pierde la
  información real de los personajes secundarios que TMDB sí ofrece y
  que la UI ya sabe mostrar y envolver.
- **Fallback silencioso a `credits` cuando falte `aggregate_credits`**:
  un fallback así re-introduciría el bug (versión reducida) enmascarado;
  `aggregate_credits` es estable dentro de `append_to_response`.

## Consecuencias

**Positivas:**

- Las series muestran el elenco **completo**: el carrusel «Reparto»
  con todos los actores de todas las temporadas/episodios (no solo los
  de la última temporada) y la ventana «Ver en más detalle» con la
  lista íntegra, incluidos los personajes múltiples por persona y los
  puestos múltiples del crew.
- **Cero coste de llamadas**: misma petición `/tv/{id}` con
  `append_to_response`, misma caché de 24 h.
- **Contrato intacto**: `ui.js` y `cast-modal.js` no se tocan; el
  cambio es de capa de datos únicamente.
- Películas y creadores sin regresión (funciones nuevas, ruta movie
  intacta).

**Negativas / neutras:**

- **Respuestas de TMDB más grandes** en series longevas (cientos de
  personas): el carrusel y la ventana renderizan más tarjetas/filas que
  antes (render estático con `loading="lazy"` en las imágenes; si en
  una prueba real se observara jank, se evaluaría en una iteración
  aparte).
- **Textos de personaje más largos** cuando una persona tiene varios
  personajes: la UI ya envuelve (`overflow-wrap` en las tarjetas, sin
  ellipsis en contenido esencial, regla 2 de AGENTS.md); verificado en
  360/768/1280 px sin scroll horizontal.
- **Ítems de series ya guardados** conservan en memoria/Firestore el
  elenco reducido que cargaron con la versión anterior hasta que se
  vuelva a abrir su ficha (el flujo bajo demanda refresca al abrir);
  no hay migración de datos: el siguiente render usa la lista completa.
- Versión PWA bumped a `20261002` (evita colisión con `20261001` de
  dev/main y las versiones de las otras ramas en vuelo): un precache
  adicional para los usuarios al desplegar.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `js/api-movies.js` | **Modificado**: `getTvExtraDetails` consulta `append_to_response=aggregate_credits,videos` (antes `credits,videos`) y mapea `data.aggregate_credits.cast/crew`; nuevas `mapAggregateCastPerson` (roles → personajes unidos «, ») y `mapAggregateCrewPerson` (jobs → puestos unidos «, », department, order ?? 999) y helper `joinUnique`; `mergeCreatorsIntoCrew` y `getMovieDetails` (películas, `credits`) intactos |
| `js/config.js` | **Modificado**: `APP_VERSION` a `20261002` |
| `index.html` | **Modificado**: 3 referencias `?v=` a `20261002` |
| `service-worker.js` | **Modificado**: 7 referencias `?v=` de `STATIC_ASSETS` a `20261002` |
| `docs/manual-de-usuario.md` | **Modificado**: §12 bullet «Información ampliada» — en series, el reparto incluye a TODOS los actores de todas las temporadas y episodios (no solo los principales) y los personajes múltiples de una persona se muestran juntos (igual que los puestos de producción) |
| `docs/adr-110-elenco-completo-series.md` | **Nuevo**: este documento |
| `tasks/task-issue-308.json` | Task file de la tarea |

Related issue: #308 — https://github.com/gonzalitojh/Registro-personal/issues/308