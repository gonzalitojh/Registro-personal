# ADR-076: Sección de Recetas — recetas, menú semanal y lista de la compra (issue #64)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La issue #64 pide una **nueva sección de primer nivel** en la web, al
mismo nivel que las secciones existentes (Ocio y Perfil), dedicada a la
cocina. El alcance inicial es:

1. **Recetas**: registrar recetas con nombre, descripción, ingredientes
   (nombre + cantidad + unidad + categoría), porciones resultantes,
   instrucciones paso a paso, fotografía (URL) y enlaces de referencia.
2. **Menú semanal**: rejilla día × comida con **varias opciones de
   receta por comida** (para que cada comensal pueda comer distinto),
   número de comensales, y «recetas a la semana» (p. ej. pan para los
   desayunos) que **no escalan por ración**.
3. **Lista de la compra**: cálculo automático de los ingredientes
   necesarios según las recetas del menú y el factor comensales/porciones,
   con recetas que se pueden **excluir** de la lista, **ítems extra**
   manuales (comestibles y no comestibles, p. ej. productos de limpieza)
   y marcar lo ya comprado.
4. **Categorización**: etiquetas predefinidas de ingredientes, alérgenos
   y tipos de comida, **ampliables con etiquetas personalizadas** del
   usuario.
5. **Importación desde URL**: añadir una receta pegando un enlace,
   extrayendo los datos de la página cuando sea viable y quedando
   marcada como «necesita revisión».
6. **Búsqueda** de recetas (por nombre/ingrediente/categorías).

La web ya tiene el patrón de secciones de primer nivel con URL propia
(Ocio desde ADR-051/ADR-059, Perfil con `#/perfil/...`), el registro
central de secciones/pestañas (`SECTION_REGISTRY`, issue #97), el
enrutado por hash (ADR-051) y las suscripciones con reintento con
backoff (issue #147, `js/retry.js`). La sección de Recetas debe integrarse
con todo ello siguiendo los mismos patrones.

La implementación está **en curso en el working tree** (ramas
`feat/issue-64-*`), pendiente de QA en los cuatro modos de tema, de
responsividad y del escaneo de seguridad; este ADR documenta la decisión
de arquitectura, como los recientes (ADR-059 a ADR-068).

Related issue: #64 — https://github.com/gonzalitojh/Registro-personal/issues/64

## Decisión

Crear la sección «Recetas» como una **vista de primer nivel** más
(`#recipes-view` en `index.html`, mismo patrón que `profile-view`),
con **tres pestañas** (Recetas / Menú / Lista de la compra), **tres
módulos JS** nuevos (`js/recipes.js`, `js/menu.js`, `js/shopping-list.js`)
más un módulo de datos/constantes (`js/recipes-data.js`), y **cuatro
colecciones Firestore** nuevas bajo `users/{uid}`. La decisión se
desarrolla en seis puntos.

### 1. Ruta hash `#/recetas[/tab]` y tres pestañas

- `js/router.js` gana el prefijo `/recetas` con el mapa
  **`RECIPES_TAB_TO_PANEL`** como única fuente de verdad:
  `recetas → panel-recipes-tab`, `menu → panel-menu-tab`,
  `compra → panel-shopping-tab`.
- `parseHash` devuelve `{ section: "recetas", tab, panelId }` para
  `#/recetas/<tab>`; el **canónico de la pestaña por defecto es
  `#/recetas`** (sin segmento, `RECIPES_DEFAULT_TAB = "recetas"`),
  y `recipesHashFor()` canoniza `#/recetas/recetas` → `#/recetas`
  (normalización con `history.replaceState`, mismo comportamiento que
  Ocio y Perfil). Los segmentos desconocidos se sanean a la pestaña por
  defecto con `invalid: true`.
- `js/app.js` (`onRoute` de `initRouter`) trata `route.section ===
  "recetas"` igual que `"perfil"`: oculta las otras vistas
  (`#app` y `#profile-view` quedan `hidden`; `#recipes-view` se muestra)
  y llama a `recipesApi.openRecipes({ tab, fromRouter: true })`. Si la
  pestaña pedida está oculta en Ajustes, `normalizeTabKey` la sustituye
  por la primera visible y se reescribe la URL con `replace: true`
  (mismo guard que Ocio, issue #97).
- La entrada «Recetas» de la barra lateral (`js/sidebar.js`, `SECTIONS`)
  navega con `navigate({ section: "recetas", tab: getLastRecipesTab() })`:
  vuelve a la **pestaña que quedó activa la última vez** de la sesión
  (memoria en el router, patrón `lastOcioKey`).

### 2. Colecciones Firestore bajo `users/{uid}` (mismo modelo que el resto)

Cuatro colecciones nuevas con el **mismo patrón de reglas** que las
existentes (lectura entre amigos autorizados, escritura solo del dueño):

| Colección | Contenido |
|-----------|-----------|
| `recipes/{id}` | Receta: nombre, descripción, porciones, instrucciones `[string]`, fotoUrl, enlaces `[string]`, alergenos/tipos (ids de etiqueta), ingredientes `[{ nombre, cantidad, unidad, categoriaId }]`, `needsReview`, `sourceUrl`, `addedAt`/`updatedAt` |
| `ingredients/{id}` | Catálogo de ingredientes: nombre (normalizado), categoriaId |
| `tags/{id}` | Etiquetas personalizadas: `{ nombre, tipo }` (tipo: `ingrediente` \| `alergeno` \| `tipo`) |
| `menus/{id}` | **Un documento por semana**: `semanaInicio` (lunes ISO), `comensales`, `dias` (día × comida → array de recipeId), `recetasPorSemana`, y los datos de la lista de la compra: `recetasExcluidasCompra` y `itemsExtra` |

En `firestore.rules`:

```
match /recipes/{itemId} { allow read: if isAllowedUser(); allow write: if isAllowedUser() && isOwner(userId); }
match /ingredients/{itemId} { ... idéntico ... }
match /menus/{itemId} { ... idéntico ... }
match /tags/{itemId} { ... idéntico ... }
```

Los menús se guardan **anclados al lunes de la semana ISO**
(`mondayISO()` en `recipes-data.js`): la pestaña Menú navega semanas
(anterior/actual/siguiente), y cada semana es un documento `menus` con
`semanaInicio` = lunes. El documento del menú persiste además los
**ítems extra de la lista de la compra** (`itemsExtra`) y las
**exclusiones** (`recetasExcluidasCompra`), de modo que la lista de la
compra de cada semana viaja con su menú. `js/db.js` expone las funciones
por colección (`subscribeToRecipes`, `addRecipe`, `updateRecipe`,
`deleteRecipe`, `subscribeToIngredients`, `addIngredient`,
`updateIngredientCategory`, `deleteIngredient`, `subscribeToTags`,
`addTag`, `deleteTag`, `subscribeToMenus`, `addMenu`, `updateMenu`,
`deleteMenu`), siguiendo el patrón de las colecciones existentes.

### 3. Módulos JS y datos compartidos

- **`js/recipes-data.js`** (constantes y helpers, sin estado): etiquetas
  predefinidas — **12 categorías de ingrediente** (las 9 de la issue +
  «Bebidas y cafés», «Congelados» y «Otros»), **6 alérgenos** (los 4 de
  la issue + «Sin frutos secos» y «Sin huevo») y **8 tipos de comida**
  (los 5 de la issue + «Salsas y guarniciones», «Desayunos» y
  «Bebidas») —; helpers `slugify`, `normalizeIngredientName` (slug sin
  tildes → espacios), `normalizeUnit` (minúsculas/trim), `mondayISO`,
  `mergeTags`/`tagsByIds` (predefinidas + personalizadas de
  `users/{uid}/tags`), `escapeHtml` y `formatCantidad`.
- **`js/recipes.js`**: pestaña Recetas — listado con búsqueda, modal de
  alta/edición/importación, catálogo de ingredientes (edición de
  categoría), etiquetas personalizadas y el registro de renderers de las
  otras pestañas (`registerTabRenderer`). Expone `setupRecipes({ ctx,
  onRecipeDeleted })` → API `{ openRecipes({ tab }) }` para el router.
- **`js/menu.js`**: pestaña Menú — rejilla día × comida con picker de
  recetas (arrays de opciones), selector de comensales, recetas a la
  semana, exclusión de la compra y navegación entre semanas. Expone
  `getActiveMenuData()`, `setRecipeExcluded()`, `updateMenuExtras()`.
- **`js/shopping-list.js`**: pestaña Lista de la compra — cálculo
  automático y ítems extra manuales.

**El catálogo de ingredientes se auto-rellena por upsert de nombre
normalizado**: al guardar una receta, cada ingrediente se normaliza con
`normalizeIngredientName` y, si no existe ya en `ingredients`, se crea
con su `categoriaId` (`js/recipes.js`); nunca se duplica (el Set se
construye sobre nombres normalizados).

### 4. Importación desde URL (client-side, sin backend propio)

- **Validación previa de protocolo**: la URL debe empezar por
  `http://` o `https://` (regex defensiva que bloquea esquemas como
  `data:` o `file:` antes de tocar el fetch).
- `fetch(url, { mode: "cors" })` directo desde el cliente y, si responde,
  parseo con **`document.implementation.createHTMLDocument("")`**
  (documento **inerte**: el HTML descargado **no ejecuta scripts** ni
  carga recursos). Extracción por **`textContent`** (h1 → título, fallback
  a `title`).
- Si el fetch falla (CORS del sitio origen, red...) **la receta se
  guarda igualmente con la URL (`sourceUrl`) y el distintivo
  «Revisar» (`needsReview: true`)**, mostrado como badge en la tarjeta
  (`.recipe-card--review`); al editar y guardar una receta revisada,
  `needsReview` pasa a `false`. La importación es un relleno asistido:
  el usuario siempre puede corregir los campos antes de guardar.

### 5. Cálculo de la lista de la compra

- Por cada día y comida del menú activo, cada receta **no excluida**
  (`recetasExcluidasCompra`) aporta sus ingredientes multiplicados por
  el **factor `comensales / porciones`** de la receta (si `porciones` es
  0, factor = comensales).
- Las **recetas a la semana** (`recetasPorSemana`) **no escalan**: se
  añaden con su cantidad fija.
- Las cantidades se **agregan por nombre de ingrediente normalizado**
  (misma unidad; `normalizeUnit`), con `formatCantidad` para el redondeo
  a 2 decimales sin ceros finales.
- Los **ítems extra manuales** (`itemsExtra`) admiten comestibles y **no
  comestibles** (productos de limpieza, etc.) y se persisten en el
  documento del menú; «marcar como comprado» es estado visual de la
  sesión en esta primera versión.

### 6. Integración con los patrones de la app

- **`SECTION_REGISTRY`** (`js/settings.js`): nueva entrada `recetas` con
  sus tres tabs (panelIds coinciden con `RECIPES_TAB_TO_PANEL`) y
  `visibleSections`/`visibleTabs` con `recetas/menu/compra` activos por
  defecto (las pestañas se pueden ocultar desde Ajustes, issue #97).
- **`SECTIONS`** (`js/sidebar.js`): entrada «Recetas» con icono propio,
  entre Ocio y Ajustes.
- **Suscripciones en tiempo real** con **`subscribeWithRetry`**
  (`js/retry.js`, issue #147): dos suscripciones nuevas en `js/app.js`
  (recetas+ingredientes+tags vía `subscribeRecipesData`, y menús vía
  `subscribeMenuData`), con `onError`/`onRetrying` mostrando toasts y el
  mismo reintento con backoff que el resto de la app; se registran en
  `stopAllSubscriptions()` y los módulos exponen `reset*` para vaciar el
  estado al cerrar sesión.
- **Versión de caché**: `APP_VERSION` bump `20260903 → 20260905` vía
  `scripts/bump-version.sh` (toca assets precacheados: `index.html`,
  `js/config.js`, `service-worker.js`).

## Consecuencias

### Positivas

- **URLs compartibles**: cada pestaña tiene URL canónica propia
  (`#/recetas`, `#/recetas/menu`, `#/recetas/compra`); la recarga y el
  botón atrás devuelven a la pestaña exacta, y el guard de pestañas
  ocultas (issue #97) mantiene la URL coherente con lo visible.
- **Sincronización en tiempo real**: las cuatro colecciones se
  suscriben con `onSnapshot` + `subscribeWithRetry` (issue #147): los
  cambios de otro dispositivo (o de la propia app) se reflejan al
  momento, sin botón de refrescar.
- **Patrón consistente**: misma arquitectura que Ocio y Perfil — rutas
  hash (ADR-051), colecciones bajo `users/{uid}` con reglas
  `read isAllowedUser` / `write isOwner`, módulo con `setup*` → API para
  el router, `SECTION_REGISTRY` para Ajustes, sidebar, y bump de versión
  PWA por PR (ADR-049/059/061/064/066).
- **Catálogo de ingredientes auto-mantenido**: el upsert por nombre
  normalizado evita duplicados y deja el catálogo siempre al día sin
  gestión manual.
- **Importación sin infraestructura**: la extracción client-side con
  documento inerte (sin ejecución de scripts) no requiere proxy ni
  backend; si el sitio no permite CORS, la receta queda con la URL y el
  distintivo «Revisar» en vez de perder el enlace.
- **Etiquetas ampliables**: las 12 categorías de ingrediente, 6
  alérgenos y 8 tipos de comida predefinidos se combinan con etiquetas
  personalizadas por usuario (`users/{uid}/tags`), cumpliendo el
  criterio de «revisar y ampliar las listas» de la issue.

### Negativas / Riesgos

- **Cuatro colecciones nuevas** (`recipes`, `ingredients`, `tags`) más
  **un documento de `menus` por semana**: más superficie de datos y de
  reglas Firestore; los documentos de `menus` con `itemsExtra` y
  `recetasExcluidasCompra` mezclan datos de menú y de lista de la compra
  en un solo documento (si se borra la semana, se van también sus ítems
  extra — mitigado por el diálogo de confirmación al borrar).
- **La lista de la compra es por menú activo**: solo se calcula sobre la
  semana navegada en la pestaña Menú; no hay agregado histórico ni
  global (fuera del alcance de la issue).
- **Importación dependiente de CORS**: la mayoría de sitios de recetas
  no exponen cabeceras CORS, así que el flujo caerá al caso
  «guardar con URL + Revisar» con frecuencia; la extracción automática
  será la excepción, no la regla.
- **Validaciones visuales pendientes**: la sección es nueva y amplia
  (cards, modal, formularios dinámicos, chips, badges, rejilla del menú,
  lista de la compra) — falta la verificación de los **cuatro modos de
  tema** (regla 4 de AGENTS.md, mínimo WCAG AA) y de **responsividad**
  a 360/768/1280 px sin scroll horizontal (regla 2), que el QA debe
  cerrar antes de fusionar.
- **Primera versión con comidas fijas**: desayuno/almuerzo/cena no son
  configurables (el criterio de la issue pide elegir «varias opciones en
  cada comida», no crear comidas nuevas); «marcar como comprado» es
  estado visual de sesión, no persistido.

### Neutras

- **Sin dependencias nuevas**: no hay librerías ni backend añadidos; la
  importación usa `fetch` + DOM inerte del navegador.
- **Bump PWA `20260903 → 20260905`**: un bump por PR (ADR-019/ADRs
  recientes) vía `scripts/bump-version.sh`, por tocar assets
  precacheados (`index.html`, `js/config.js`, `service-worker.js`).
- **Manual de usuario al día**: la nueva sección se documenta en
  `docs/manual-de-usuario.md` (regla 3 de AGENTS.md) — pestañas,
  creación de recetas, importación desde URL con distintivo «Revisar»,
  menú semanal y lista de la compra.

## Alternativas descartadas

- **Colección única `recetas` con todo embebido** (menús e ingredientes
  dentro del documento de receta): descartada — la issue pide
  explícitamente colecciones separadas para recetas, ingredientes y
  menús, y el catálogo de ingredientes es compartido entre recetas y
  lista de la compra.
- **Menú como documento único por usuario** (una sola semana
  sobrescrita): descartada — un documento por semana con `semanaInicio`
  = lunes ISO permite histórico y navegación entre semanas sin migrar
  datos.
- **Persistir los ítems extra y las exclusiones en la colección de la
  lista de la compra** (o en localStorage): descartada — viven en el
  documento del menú para que cada semana tenga su lista completa y se
  sincronice en tiempo real entre dispositivos.
- **Scraper con backend/proxy propio**: descartado — la importación
  client-side con CORS es suficiente para el caso personal; un proxy
  añadiría infraestructura a mantener (como los proxies de ADR-056 y
  ADR-067) sin necesidad real.
- **Usar DOMParser con `text/html`**: descartado — `createHTMLDocument`
  crea el documento **inerte** (no descarga ni ejecuta nada), que es el
  requisito de seguridad para procesar HTML ajeno.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `index.html` | **Modificado**: nueva vista `#recipes-view` (patrón `profile-view`, oculta `#app` y `#profile-view`) con cabecera y subtabs (Recetas/Menú/Lista de la compra, patrón `profile-subtab`) y los 3 paneles (`panel-recipes-tab`, `panel-menu-tab`, `panel-shopping-tab`) + modal de receta con formulario completo e importación desde URL |
| `js/router.js` | **Modificado**: `RECIPES_TAB_TO_PANEL`, `RECIPES_DEFAULT_TAB`, `RECIPES_PREFIX`, `recipesHashFor` (canónico `#/recetas`), rama Recetas en `parseHash`, `canonicalHashFor`, `lastRecipesTab`/`getLastRecipesTab` |
| `js/app.js` | **Modificado**: rama `recetas` en `onRoute` (oculta perfil/ocio, guard `normalizeTabKey`, `openRecipes`), `setupRecipes`/`setupMenu`/`setupShoppingList`, suscripciones `subscribeWithRetry` para recetas y menús (issue #147), `resetRecipesData`/`resetMenuData` al cerrar sesión, retomar `#/recetas` tras el login |
| `js/db.js` | **Modificado**: `subscribeToRecipes/Ingredients/Tags/Menus` + `add/update/delete` por colección (patrón existente) |
| `js/recipes.js` | **Nuevo**: pestaña Recetas — listado + búsqueda, modal alta/edición, importación desde URL (validación `http(s)://`, fetch CORS, `createHTMLDocument` inerte, `textContent`, fallback `needsReview`), catálogo de ingredientes con upsert por nombre normalizado, etiquetas personalizadas, `registerTabRenderer` |
| `js/menu.js` | **Nuevo**: pestaña Menú — rejilla día × comida, varias opciones por comida, comensales, recetas a la semana, exclusión de la compra, navegación de semanas (`mondayISO`) |
| `js/shopping-list.js` | **Nuevo**: pestaña Lista de la compra — factor `comensales/porciones`, recetas a la semana sin escalar, excluidas saltadas, ítems extra comestibles/no comestibles, comprado visual |
| `js/recipes-data.js` | **Nuevo**: 12 categorías de ingrediente, 6 alérgenos, 8 tipos de comida, `slugify`, `normalizeIngredientName`, `normalizeUnit`, `mondayISO`, `mergeTags`/`tagsByIds`, `escapeHtml`, `formatCantidad`, días/comidas |
| `js/settings.js` | **Modificado**: `SECTION_REGISTRY.recetas` con sus 3 tabs; `visibleSections`/`visibleTabs` por defecto (issue #97) |
| `js/sidebar.js` | **Modificado**: entrada `SECTIONS` «Recetas» con icono y `navigate({ section: "recetas", tab: getLastRecipesTab() })` |
| `firestore.rules` | **Modificado**: `recipes`, `ingredients`, `menus`, `tags` bajo `users/{uid}` con `read isAllowedUser` / `write isAllowedUser && isOwner` |
| `css/styles.css` | **Modificado**: estilos de `recipes-view`, cards de recetas (badge «Revisar»), catálogo, rejilla del menú, lista de la compra (tokens de tema, overrides de negro puro) |
| `js/config.js` | **Modificado**: `APP_VERSION` `20260903` → `20260905` |
| `service-worker.js` | **Modificado**: bump `?v=20260903` → `?v=20260905` en `STATIC_ASSETS` (vía `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modificado**: nueva sección de Recetas (pestañas, recetas, importación desde URL, menú semanal, lista de la compra) — regla 3 de AGENTS.md |
| `docs/adr-076-seccion-recetas-menu-semanal-lista-compra.md` | **Nuevo**: este documento |

Related issue: #64 — https://github.com/gonzalitojh/Registro-personal/issues/64
