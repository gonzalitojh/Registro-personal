# ADR-058: Unificar la pestaña de datos del perfil en Ajustes (issue #135)

## Estado
Aceptado

## Fecha
2026-08-09

## Contexto

La issue #135 («Unificar pestaña de datos del perfil en ajustes») pide
eliminar la pestaña «Datos» del perfil e incluir su contenido en la
pestaña «Ajustes» como un apartado de datos.

Estado anterior:

- El perfil tenía **5 subtabs** (`index.html`, `.profile-subtabs`):
  Estadísticas, Amigos, Actividad, Datos y Ajustes; además, el
  **dropdown del perfil** (`#profile-dropdown`) tenía su propia entrada
  «Datos» (`data-section="data"`).
- La sección `#profile-section-data` contenía **3 tarjetas `.data-card`**:
  Exportar copia de seguridad (`#btn-export-backup`), Importar copia de
  seguridad (`#btn-import-backup`) y Exportar calendario `.ics`
  (`#btn-export-ics`).
- El router por hash (ADR-051) mapeaba el token «datos» → sección
  `"data"` (deep links `#/perfil/datos`).
- La pestaña Ajustes (`#profile-section-settings`) ya tenía sus propias
  cards (Apariencia, Notificaciones, Sincronización de datos) con el
  patrón `.settings-card` + `.settings-desc`.

La implementación está validada (QA PASS) y escaneada (seguridad PASS);
el manual de usuario ya se actualizó en la misma tarea (regla 3 de
AGENTS.md). Este ADR documenta la decisión a posteriori.

Related issue: #135 — https://github.com/gonzalitojh/Registro-personal/issues/135

## Decisión

Unificar la pestaña de datos dentro de Ajustes como apartado «Datos»,
conservando el alias de URL `#/perfil/datos` → Ajustes.

### 1. UI: se elimina la pestaña «Datos» y su contenido pasa a Ajustes

- Se eliminan la **subtab «Datos»** (quedan 4 subtabs: Estadísticas,
  Amigos, Actividad y Ajustes) y la **entrada «Datos» del dropdown**
  del perfil (quedan 4 entradas).
- Se elimina del DOM la sección `#profile-section-data` (con sus 3
  tarjetas `.data-card`).
- Su contenido pasa a `#profile-section-settings` como **una card única
  «Datos»** (`div.settings-card.settings-card--data`) con la misma
  estructura del resto de Ajustes: título `h3`, párrafos `.settings-desc`
  y los 3 botones apilados en vertical
  (`.settings-card--data .btn { display:block; width:fit-content;
  max-width:100%; margin:0 0 1.2rem }` y `:last-child` sin margen),
  siguiendo el patrón de las antiguas tarjetas.
- **Se conservan los ids de los botones** (`#btn-export-backup`,
  `#btn-import-backup`, `#btn-export-ics`): el wiring
  `setupExportBackup(ctx)` / `setupExportIcs(ctx)` de `js/profile.js`
  no se toca, y tampoco los módulos `js/export-backup.js` /
  `js/export-ics.js` que los referencian.

### 2. Router: el token «datos» pasa a ser alias de `settings`

En `js/router.js`, el mapa `PROFILE_KEY_TO_SECTION` deja de tener
`datos: "data"` (sección inexistente) y pasa a:

```js
datos: "settings",
ajustes: "settings",
```

Consecuencias del enrutado:

- El deep link **legado `#/perfil/datos` sigue funcionando** y abre
  Ajustes; la URL **no se normaliza** (permanece `#/perfil/datos` en la
  barra de direcciones).
- **Detalle crítico documentado en el código**: `PROFILE_SECTION_TO_KEY`
  se auto-genera con `Object.fromEntries` y la **última clave gana**, por
  eso «ajustes» debe quedar **después** de «datos» en
  `PROFILE_KEY_TO_SECTION`: así el inverso devuelve `settings` →
  «ajustes» y el hash canónico sigue siendo `#/perfil/ajustes`. Un
  comentario en el mapa fija este orden para futuras ediciones.
- Se actualiza el comentario de cabecera del módulo: «El antiguo token
  “datos” sobrevive como alias de Ajustes (issue #135)».

### 3. CSS: se elimina `.data-card` y se añade `.settings-card--data`

- **Eliminadas** las reglas `.data-card` (muertas: ya no existe ninguna
  tarjeta con esa clase en el DOM).
- **Añadidas** las reglas de apilado vertical de los botones del
  apartado «Datos» dentro de Ajustes (`.settings-card--data .btn` con
  `display:block`, `width:fit-content`, `max-width:100%` y margen
  inferior de `1.2rem`, excepto `:last-child`), reutilizando el resto
  del estilo de `.settings-card` sin duplicar nada.

### 4. Documentación, manual de usuario y PWA

- **Manual** (`docs/manual-de-usuario.md`): listas de secciones del
  perfil reducidas de 5 a 4; eliminada la subsección «13.4 Datos»;
  «13.5 Ajustes» renumerada a «13.4 Ajustes»; apartado «Datos» añadido
  en la sección 14 (exportar/importar copia de seguridad y exportar
  `.ics`); nota en 13.0 de que `#/perfil/datos` sigue funcionando y
  abre Ajustes.
- **Bump PWA** `20260830` → `20260831` (un bump por PR que toca
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260831` ×3) y `service-worker.js` (`?v=20260831` ×6).
- **ADR históricos intactos**: `adr-008-export-backup.md`,
  `adr-014-export-ics.md` y `adr-051-enrutamiento-hash.md` mencionan
  `#profile-section-data`, `.data-card` y el token «datos»; son
  registro histórico del estado previo y **no se modifican**.

## Alternativas descartadas

- **Eliminar el token «datos» del router** (normalizar
  `#/perfil/datos` a `#/perfil/estadisticas`): descartado — rompería
  favoritos y URLs compartidas que los usuarios ya han guardado desde
  ADR-051; el alias cuesta una línea y mantiene la compatibilidad.
- **Mantener `.data-card` con reglas propias dentro de Ajustes**:
  descartado — CSS duplicado innecesario; la card «Datos» reutiliza el
  patrón `.settings-card` y solo necesita las reglas de apilado de
  botones.
- **Mover la sección sin alias de URL**: descartado — inconsistente con
  la función de deep links del ADR-051 (cada sección del perfil tiene
  URL propia y compartible); dejar `#/perfil/datos` roto degradaría
  silenciosamente una URL pública ya documentada.

## Consecuencias

### Positivas

- **Un solo lugar para datos y ajustes**: menos superficie de
  navegación (4 subtabs y 4 entradas de dropdown); el perfil queda más
  limpio y el usuario encuentra exportar/importar junto al resto de
  ajustes.
- **Deep links legado preservados**: `#/perfil/datos` sigue abriendo
  Ajustes sin romper favoritos ni URLs compartidas (ADR-051).
- **Wiring intacto**: al conservar los ids de los botones,
  `setupExportBackup`/`setupExportIcs` no cambian — cero riesgo de
  regresión en exportar/importar copia de seguridad y `.ics`.
- **CSS sin duplicados ni código muerto**: `.data-card` eliminada
  (no quedaba ninguna en el DOM) y una sola clase nueva
  (`.settings-card--data`) para el apilado.
- **Manual al día**: regla 3 de AGENTS.md cumplida en la misma tarea
  (listas a 4 secciones, apartado «Datos» en sección 14 y nota de
  legado en 13.0).
- **QA y seguridad PASS** antes de documentar: la decisión está
  validada en la práctica.

### Negativas / Riesgos

- **Cambio visible para el usuario**: quien buscaba la pestaña «Datos»
  del perfil debe ir ahora a Ajustes. Mitigado con la actualización del
  manual y la nota de legado de `#/perfil/datos`.
- **Canónico dependiente del orden de claves**: si un futuro editor
  reordena `PROFILE_KEY_TO_SECTION` (p. ej. «ajustes» antes que
  «datos»), el inverso `Object.fromEntries` haría que `settings` se
  canonicalizara como `#/perfil/datos`. Mitigado con el comentario
  fijando el orden en el propio mapa.
- **Desincronización con los ADRs históricos**: los ADR-008, ADR-014
  y ADR-051 describen `#profile-section-data`, `.data-card` y el token
  «datos» como sección real; ya no reflejan el estado actual (quedan
  como legado histórico, sin modificar). Este ADR es el que describe
  el estado vigente.

### Neutras

- **URLs sin normalizar**: `#/perfil/datos` permanece en la barra de
  direcciones al abrir Ajustes (no se reescribe a `#/perfil/ajustes`);
  el canónico sigue siendo `#/perfil/ajustes`.
- **Sin cambios en `js/export-backup.js` ni `js/export-ics.js`**: los
  módulos de exportación/importación no se tocan; solo cambia su
  ubicación en el DOM.
- **Bump PWA de rutina**: `20260830` → `20260831` siguiendo la
  práctica de un bump por PR (ADR-049); los navegadores purgan las
  cachés anteriores en el siguiente `activate`.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: eliminadas la subtab «Datos» (quedan 4 subtabs) y la entrada «Datos» del dropdown (quedan 4 entradas); eliminada `#profile-section-data`; añadida la card «Datos» (`settings-card settings-card--data`) en `#profile-section-settings` con los 3 botones conservando sus ids (`#btn-export-backup`, `#btn-import-backup`, `#btn-export-ics`); bump `?v=20260830` → `?v=20260831` (×3) |
| `js/router.js` | **Modificado**: token «datos» pasa de sección `"data"` a alias de `"settings"` en `PROFILE_KEY_TO_SECTION` (con comentario fijando el orden: «ajustes» debe quedar después de «datos» para que el canónico siga siendo `#/perfil/ajustes`, porque el inverso `Object.fromEntries` deja ganar a la última clave); comentario de cabecera del módulo actualizado |
| `js/profile.js` | **Modificado**: eliminada la referencia a `dataSection` (const + toggle hidden); el wiring `setupExportBackup(ctx)`/`setupExportIcs(ctx)` queda intacto (los ids de los botones no cambian) |
| `css/styles.css` | **Modificado**: eliminadas las reglas `.data-card` (muertas); añadidas `.settings-card--data .btn` (`display:block`, `width:fit-content`, `max-width:100%`, `margin:0 0 1.2rem`) y `.settings-card--data .btn:last-child` (sin margen inferior) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260830` → `20260831` |
| `service-worker.js` | **Modificado**: bump `?v=20260830` → `?v=20260831` en los 6 assets versionados de `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modificado**: listas de secciones del perfil a 4; eliminada «13.4 Datos»; «13.5 Ajustes» renumerada a «13.4 Ajustes»; apartado «Datos» añadido en la sección 14; nota en 13.0 de que `#/perfil/datos` sigue funcionando y abre Ajustes (regla 3 de AGENTS.md) |
| `tasks/task-issue-135.json` | Task file de la tarea (title/description, plan de cambios, criterios de aceptación y bloque `issue` con la issue #135) |
| `docs/adr-058-unificar-pestana-datos-en-ajustes.md` | **Nuevo**: este documento |

Related issue: #135 — https://github.com/gonzalitojh/Registro-personal/issues/135
