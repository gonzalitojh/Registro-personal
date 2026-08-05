# ADR-032: Manual de usuario — `docs/manual-de-usuario.md` en lenguaje no técnico y regla de mantenimiento obligatorio en `AGENTS.md` (issue #60)

## Estado
Aceptado

## Fecha
Agosto 2026

## Contexto

La web «Mi Registro» había crecido hasta acumular muchas funcionalidades —estados por tipo de ítem (series, películas y libros), gestión de episodios y lecturas, historiales, búsquedas (catálogo TMDB/Google Books/Open Library, lista propia y global con Ctrl+K), alta manual, organización (cuadrícula/lista, filtros, orden, colores), fichas de detalle con trailer/streaming/saga/recomendaciones, valoraciones, acciones rápidas (botón grande, swipe, deshacer borrado), notificaciones, perfil, ajustes, sincronización, privacidad, PWA, etc.— sin que existiera **ninguna documentación orientada a usuarios finales**. El conocimiento del comportamiento de la web vivía solo en el código y en los ADRs, redactados para desarrolladores y agentes, no para un usuario que quiere «ver la serie que sigue mañana» o saber por qué un libro no aparece en el catálogo.

La issue #60 pedía dos cosas concretas:

1. Un **manual de usuario completo**, en lenguaje no técnico, que cualquier usuario pudiera leer y entender: bien organizado, con secciones y subsecciones, cubriendo desde los diferentes estados y opciones de cada tipo de ítem, los ajustes y acciones, cada cuánto se actualizan los datos, cómo se busca, etc.
2. Una **regla para el agente** que obligara a que, siempre que se hicieran cambios que afecten a lo que el usuario ve o hace, se incluyera la explicación pertinente en ese manual — de modo que el manual no quedara obsoleto a las pocas semanas de crearse.

Related issue: #60 — https://github.com/gonzalitojh/Registro-personal/issues/60

## Decisión

Crear `docs/manual-de-usuario.md`, un manual de usuario completo en español, redactado en lenguaje no técnico (paso a paso, sin tecnicismos) y pensado para cualquier usuario de la web, y añadir en `AGENTS.md` una regla general que obligue a mantenerlo al día. La decisión se organiza en dos partes.

### 1. Manual de usuario (`docs/manual-de-usuario.md`)

Manual de 18 secciones (con subsecciones numeradas en las que lo requieren), que cubre todo lo que se puede hacer en la web:

1. **Qué es Mi Registro**: propósito (registro privado de series, películas y libros), autocompletado de datos por la web, modelo de grupo de amigos con registros visibles en modo lectura.
2. **Cómo entrar**: login con Google, lista de invitados (mensaje de error si el correo no está), creación automática de cuenta, botón «Salir».
3. **La pantalla principal**: cabecera (campana, lupa, engranaje, sol/luna, foto/nombre, salir) y las tres pestañas Series/Películas/Libros; aterrizaje por defecto en Series con filtro «Viendo» y vista de lista.
4. **Series**: estados (Pendiente/Viendo/Vista/Standby/Abandonada), añadir, ver y marcar episodios (con fechas), pausar/abandonar/retomar, volver a ver desde el principio, historial de visionados, editar y eliminar.
5. **Películas**: estados, añadir, marcar como vista, historial de revisionados.
6. **Libros**: estados, añadir, empezar y terminar lecturas, página actual, historial de lecturas, búsqueda solo en español.
7. **Cómo buscar**: catálogo (TMDB para series/películas, Google Books y Open Library para libros), búsqueda en la lista propia, búsqueda global (Ctrl+K), alta manual de ítems.
8. **Organizar y ordenar tu registro**: vista cuadrícula/lista, filtros, criterios de orden, colores.
9. **La ficha de cada película, serie o libro**: trailer, plataformas de streaming, sagas, recomendaciones.
10. **Valoraciones con estrellas**: valoración propia y nota de la comunidad.
11. **Acciones rápidas**: botón grande de cada fila, deslizar (swipe) en móvil, deshacer un borrado.
12. **Notificaciones**: qué avisos llegan y desde dónde se consultan.
13. **Tu perfil**: estadísticas, amigos, actividad, datos, ajustes.
14. **Ajustes**: tema, notificaciones, sincronizar ahora.
15. **¿Cuándo se actualizan los datos?**: comprobación diaria, relleno de datos faltantes, cooldown de 30 minutos entre sincronizaciones.
16. **Privacidad**: qué se guarda, quién lo ve.
17. **Instalar la web en tu teléfono**: instalación PWA.
18. **Problemas frecuentes**: solución de dudas habituales.

Estilo del manual: lenguaje no técnico, instrucciones paso a paso, nombres de botones entre comillas o con negrita, referencias cruzadas entre secciones (p. ej. «más en [sección 12]»), y una tabla de contenido enlazada al inicio. Sin código, sin nombres de archivos internos y sin términos de desarrollo.

### 2. Regla general en `AGENTS.md` (regla 3: «Manual de usuario siempre actualizado»)

Se añade `### 3. Manual de usuario siempre actualizado` a la sección `## Reglas generales` del `AGENTS.md` de la raíz (junto a las reglas 1 «Responsividad obligatoria», ADR-026, y 2 «PRs SIEMPRE contra dev»), con el siguiente alcance:

- **Cualquier cambio que afecte a lo que el usuario ve o hace** (nuevas funciones, cambios de comportamiento, textos, estados, ajustes, frecuencias de actualización de datos...) **debe reflejarse en `docs/manual-de-usuario.md` en la misma tarea** que lo implementa: añadiendo, corrigiendo o eliminando la sección/subsección pertinente.
- Los cambios **puramente internos** (refactors, optimizaciones, seguridad) que no alteren la experiencia del usuario **no requieren** tocar el manual.
- El manual debe estar **siempre al día** con el comportamiento real de la web; una PR que cambie algo visible para el usuario sin actualizarlo queda incompleta.

Al estar en `AGENTS.md` de la raíz, la regla se carga automáticamente en el contexto de todos los agentes de opencode (libre, subagentes y build/plan), igual que las reglas 1 y 2 (ADR-026), sin depender de qué agente se invoque.

## Alternativas descartadas

- **Documentar solo en los ADRs existentes**: descartado — los ADRs están redactados para desarrolladores y agentes (archivos, funciones, clases CSS); un usuario final no puede usarlos como guía, y no cubren el «cómo se usa» de la web.
- **README como manual de usuario**: descartado — el README es documentación técnica/operativa del repositorio; mezclar el manual de usuario alargaría y confundiría ambos públicos.
- **Manual sin regla de mantenimiento**: descartado — la issue #60 pedía explícitamente la regla; sin ella el manual quedaría obsoleto en pocas semanas y las PRs futuras no sabrían que deben actualizarlo.
- **Regla de mantenimiento fuera de `AGENTS.md`** (p. ej. solo en el agente documentation-sync): descartado — las instrucciones de un agente concreto solo se cargan cuando ese agente se invoca; la regla debe aplicarse a *cualquier* tarea que toque funcionalidad visible, y `AGENTS.md` es el lugar único y automático para reglas transversales (misma decisión que ADR-026).

## Consecuencias

### Positivas
- **Issue #60 resuelta**: existe un manual completo, bien organizado y en lenguaje no técnico que cualquier usuario puede leer y entender, cubriendo todo lo que se puede hacer en la web (estados, acciones, ajustes, búsquedas, frecuencias de actualización, etc.).
- **El manual se mantiene vivo**: la regla 3 de `AGENTS.md` obliga a actualizar `docs/manual-de-usuario.md` en la misma tarea que cambie algo visible para el usuario; una PR que lo omita queda incompleta, igual que ocurría con la responsividad (ADR-026).
- **La regla llega a todos los agentes**: cualquier agente de opencode que trabaje en el proyecto tiene presente la obligación de sincronizar el manual, sin depender de qué agente se invoque.
- **Clara separación de públicos**: el manual (usuarios finales), los ADRs (decisión técnica) y el README (operación del repo) cumplen cada uno su función sin solaparse.

### Negativas
- **Coste por tarea**: cualquier tarea con impacto visible para el usuario añade el paso de actualizar el manual; es un coste intencionado, exigido por la issue #60 para evitar la obsolescencia.
- **Riesgo de desincronización si la regla se ignora**: si un agente o el usuario modificara la web sin tocar el manual, la documentación quedaría desactualizada; mitigado porque la regla 3 lo declara PR incompleta.

### Neutras
- **Documento extenso a mantener**: `docs/manual-de-usuario.md` tiene 18 secciones y crecerá con cada funcionalidad nueva; su índice de contenidos enlazado facilita la navegación y la localización de la sección a actualizar.
- **Sin impacto en código de la aplicación**: no se modificó HTML, CSS ni JS; la decisión es exclusivamente documentación y reglas de proceso.
- **El manual convive con los ADRs**: los ADRs siguen documentando decisiones y detalles de implementación para desarrolladores y agentes; el manual aporta la capa de uso final que faltaba.

## Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `docs/manual-de-usuario.md` | **Nuevo**: manual de usuario completo en español, lenguaje no técnico, 18 secciones con subsecciones (qué es, cómo entrar, pantalla principal, series, películas, libros, búsqueda, organización, ficha de detalle, valoraciones, acciones rápidas, notificaciones, perfil, ajustes, frecuencias de actualización, privacidad, instalación PWA y problemas frecuentes), con tabla de contenido enlazada |
| `AGENTS.md` | Regla `### 3. Manual de usuario siempre actualizado` en `## Reglas generales`: cualquier cambio que afecte a lo que el usuario ve o hace debe reflejarse en `docs/manual-de-usuario.md` en la misma tarea; los cambios puramente internos no lo requieren |
| `docs/adr-032-user-manual.md` | **Nuevo**: este documento |

Related issue: #60 — https://github.com/gonzalitojh/Registro-personal/issues/60
