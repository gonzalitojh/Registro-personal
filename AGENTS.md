# Reglas del proyecto

Este archivo contiene reglas generales que TODO agente de opencode debe
cumplir SIEMPRE, en cualquier tarea, sin excepción. Si una tarea entra en
conflicto con estas reglas, detente y pide confirmación al usuario antes de
continuar.

## Reglas generales

### 1. PRs SIEMPRE contra `dev` (nunca contra `main`)

- Todas las Pull Requests se crean contra la rama de integración `dev`.
- Prohibido crear PRs contra `main` (o pushear directamente a `main`) en
  cualquier circunstancia. El único que promueve `dev` a `main` es el usuario,
  cuando considere que la versión es estable.
- El publisher debe aplicar `--base dev` automáticamente al crear cada PR.

### 2. Responsividad obligatoria

La web debe verse correctamente en ordenador, tablet y móvil, en cualquier
ancho de pantalla.

Criterios obligatorios:

1. No debe existir desplazamiento horizontal a nivel de página en ningún
   ancho. El scroll horizontal solo está permitido dentro de contenedores
   concretos diseñados para ello (p. ej. tablas con `overflow-x: auto`).
2. Ningún texto puede salirse de la pantalla: títulos, fechas, nombres de
   autores y sinopsis largas deben ajustarse a su contenedor
   (`overflow-wrap: break-word`, `min-width: 0` en hijos de flex/grid,
   unidades relativas). No truncar contenido esencial con ellipsis en móvil.
3. Usar unidades relativas (%, rem, em, fr, vw/vh, `minmax()`) para anchos,
   columnas y tipografía de cuerpo. Evitar `px` fijos en contenedores de
   ancho completo.
4. Prohibido usar `overflow-x: hidden` en `body`/`html` como parche: enmascara
   el desbordamiento y puede cortar contenido. Siempre corregir la causa raíz.

Verificación obligatoria cuando la tarea toque HTML, CSS o UI:

1. Probar en al menos tres anchos: ~360 px (móvil), ~768 px (tablet) y
   ~1280 px (ordenador), con el modo dispositivo de DevTools.
2. Confirmar que no hay scroll horizontal:
   `document.documentElement.scrollWidth <= window.innerWidth` en consola
   (debe ser true).
3. Probar con contenido largo realista: títulos largos, fechas, URLs o
   palabras sin espacios.

### 3. Manual de usuario siempre actualizado

Existe un manual de usuario en `docs/manual-de-usuario.md` que explica, en
lenguaje no técnico y para cualquier usuario, todo lo que se puede hacer en
la web (estados, acciones, ajustes, búsqueda, frecuencias de actualización,
etc.).

- **Cualquier cambio que afecte a lo que el usuario ve o hace** (nuevas
  funciones, cambios de comportamiento, textos, estados, ajustes,
  frecuencias de actualización de datos...) **debe reflejarse en el manual**
  en la misma tarea que lo implementa: añadiendo, corrigiendo o eliminando
  la sección/subsección pertinente.
- Los cambios puramente internos (refactors, optimizaciones, seguridad)
  que no alteren la experiencia del usuario no requieren tocar el manual.
- El manual debe estar siempre al día con el comportamiento real de la web;
  una PR que cambie algo visible para el usuario sin actualizarlo quedará
  incompleta.
