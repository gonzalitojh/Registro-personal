# ADR-115: Página de detalle de persona (actores y producción) con créditos combinados y premios (issue #321)

## Estado

Aceptado

## Fecha

2026-08-20

## Contexto

La issue #321 («Ventanas de actores y otras personas») pide hacer
pulsables a las personas de los carruseles **«Producción»** y
**«Reparto»** de las fichas de películas y series (issue #294) y de
la ventana «Ver en más detalle» (issue #294), para que cada persona
abra su **propia ventana de detalle**, con el mismo patrón de
navegación que la ficha de un título (ADR-100): barra de navegación
superior intacta (búsqueda, perfil), botón **←** para volver y tecla
**Esc**.

La página debe mostrar, al menos: foto, nombre, biografía (en
español), fecha y lugar de nacimiento (y de fallecimiento, si lo
hay), películas y series en las que ha participado (separando
actuación de equipo) y premios y nominaciones. La base de la PR es
`feat/issue-201` (instrucción explícita de la issue, como en
ADR-114/#319).

### Diagnóstico y alternativas

- **Ficha de persona en TMDB**: no existe un endpoint que devuelva
  la ficha de una persona al estilo de `/movie/{id}`. Lo más cercano
  es combinar `/person/{id}` (con `append_to_response`) con
  `combined_credits` (películas y series juntas, con `character` y
  `job`), ambos con `language=es-ES` cuando aplican.
- **Créditos ordenados**: `combined_credits` no garantiza orden
  estable; hay que ordenar por año de estreno descendente.
- **Premios**: la ficha de persona en la web de TMDB tira de
  Wikidata; la web ya sabe mapear premios desde Wikidata para
  títulos (ADR-111), pero el modelo de consulta de premios de una
  persona es distinto: CMDB P166 (premio) / P1411 (nominado) y, si la
  persona no tiene ítem propio de Wikidata (o está protegido), fallback
  por identificador IMDB (P345) vía `byidservice`.
- **Personas sin id de TMDB**: los carruseles anteriores a la issue
  #294 podían contener personas legacy (arrays de strings). Sin id
  no se puede navegar: esas tarjetas se quedan como elementos
  estáticos, sin comportamiento de botón.

## Decisión

1. **Ruta propia**: `#/ocio/personas/<id>` (`PERSON_KEY` en el
   router), con la misma validación de id que los títulos
   (`ITEM_ID_RE`), `canonicalHashFor` y `personHashFor`. La persona
   se abre como una sección más (`onRoute` en app.js) con las mismas
   garantías que la página de ítem: cierre de la página opuesta,
   cierre de modales, swap del botón de cabecera vía
   `body.is-person-page` y `#btn-person-back` (mismo mecanismo CSS
   que `body.is-item-page`, con exclusión mutua en CSS por si ambas
   clases coexistieran por un bug).
2. **Endpoint combinado con tolerancia a fallos**: `getPersonDetails`
   llama a `/person/{id}` con `append_to_response=combined_credits,external_ids`
   y `language=es-ES` (nombres/puestos también con `language=es-ES`
   y guard de `null` para el adverso de traducciones). `getPersonAwards`
   consulta Wikidata (P166/P1411, query por ítem o por IMDB P345) y
   cachea con la misma política de TTL que los premios de títulos
   (ADR-111). En el render, los premios se resuelven con
   `Promise.allSettled`: si fallan o no existen, la página se
   muestra igualmente (los premios son contenido secundario).
3. **Créditos combinados**: se renderizan en dos secciones —
   **Actuación** (con el personaje) y **Equipo** (con el puesto)
   —, ordenadas por año de estreno descendente, con año, y cada
   título pulsable hacia su ficha `#/ocio/...` (la ficha ya sabe
   mostrar la preview si el título no está en la colección,
   ADR-113). Los créditos "aún no estrenados" se marcan con su año
   futuro sin etiqueta especial (igual que hace TMDB).
4. **Foto sin avatar**: se reutiliza `safePhotoUrl` (fallback de
   silueta). Foto en `w342` y pósters de créditos en `w92`.
5. **Feedback táctil de tarjeta pulsable**: el `button.cast-card` de
   los carruseles y el `button.cast-modal__row` del modal conservan
   exactamente el mismo aspecto visual previo (reset total del
   estilo de botón del navegador), con `cursor: pointer`, hover
   `--ink-alpha-10` y focus-visible `--teal-reel` (AA y visible en
   los 4 temas). La delegación de clicks del modal es un único
   listener en `#cast-modal` (las filas se re-renderizan al
   buscar, mantenible en el tiempo).
6. **A11y**: `aria-label="Ver la página de <nombre>"` en cada
   tarjeta/fila pulsable; foco inicial en el nombre de la persona al
   abrir la página; Esc y botón ← con el mismo contrato que
   ADR-100. Sin desplazamiento horizontal y con unidades relativas
   (regla 2 de AGENTS.md): la foto del hero encoge en pantallas ≤
   400 px vía media query, y todos los textos usan
   `overflow-wrap: anywhere`; la página se probó a 360/768/1280 px.
7. **PWA**: `js/person-page.js` se añade a `STATIC_ASSETS` y la
   versión sube a `20261014`.

## Consecuencias

- La navegación ahora tiene un cuarto destino por persona: desde
  cualquier tarjeta de persona (carrusel o modal) se llega a su
  página, y desde ahí a cualquiera de sus títulos, y de vuelta con
  ←/Esc/historial.
- Las personas legacy (sin id de TMDB) siguen existiendo en
  colecciones antiguas; quedan como tarjetas estáticas no pulsables
  (degradación explícita y documentada en el manual).
- El manual de usuario (sección 12) documenta la nueva página.

Related issue: #321