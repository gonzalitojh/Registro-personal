# ADR-075: Correos permitidos: firestore.rules como única fuente de verdad (issue #195)

## Estado
Aceptado

## Fecha
2026-08-11

## Contexto

La web solo está disponible para una lista de **correos autorizados** y
exige inicio de sesión con Google. Hasta ahora la lista estaba **duplicada
en dos sitios**:

1. **`js/allowed-emails.js`**: array JS (`ALLOWED_EMAILS`) que el navegador
   comprobaba en `init()` justo después del login. Si el correo del usuario
   no estaba, se mostraba el aviso «Tu correo no está en la lista de
   invitados. Pide que te añadan.» y se cerraba la sesión. Su papel era
   **puramente de UX**: dar un rechazo inmediato, sin depender de la red,
   y evitar que un no invitado llegara a ver la app.
2. **`isAllowedUser()` de `firestore.rules`**: la lista que **de verdad
   protege los datos**, porque toda lectura/escritura de Firestore pasa
   por ella.

El problema: la lista **se desincronizaba**. En `main` se añadió
`josemcrespo98@gmail.com` al array JS **sin tocarlo en las reglas**: el
filtro del navegador le dejaba pasar, pero Firestore le bloqueaba todas las
lecturas — el usuario «entraba» a una app rota, con los datos inaccesibles
y sin que el problema fuera visible en el código. Mantener los correos en
dos sitios obligaba al administrador a hacer **dos ediciones manuales**
por cada alta/baja, y una sola de ellas pasaba desapercibida fácilmente.

La issue #195 pide **explicar por qué existía el archivo** y, si es
posible, **eliminarlo**, dejando únicamente los correos en la regla de
Firebase que el usuario actualiza manualmente.

Related issue: #195 — https://github.com/gonzalitojh/Registro-personal/issues/195

## Decisión

**Eliminar `js/allowed-emails.js` y convertir `firestore.rules` en la
ÚNICA fuente de verdad** de los correos autorizados. El administrador
edita solo la función `isAllowedUser()` y publica el archivo en Firebase
console; no hay ningún otro sitio donde mantener correos.

1. **La comprobación en el navegador se sustituye por una sonda de
   acceso**: tras el login, la app lee su propio perfil
   (`getDoc` de `users/{uid}` vía `getUserProfile`) **contra las reglas de
   Firestore**:
   - Si Firestore responde `permission-denied`, el usuario no está en
     `isAllowedUser()`: se muestra el aviso «Tu correo no está en la lista
     de invitados. Pide que te añadan.» y se cierra la sesión (mismo texto
     y comportamiento que antes).
   - **Cualquier otro error (p. ej. sin conexión) no bloquea la entrada**:
     las suscripciones a los datos ya reintentan solas (issue #147) y las
     reglas siguen protegiendo la información aunque el usuario entre.
2. **Se añade `josemcrespo98@gmail.com` a `isAllowedUser()`** (4.º correo):
   estaba solo en el JS de `main` y las reglas lo rechazaban. La regla pasa
   a autorizar exactamente los mismos 4 correos que autorizaba antes el
   conjunto «JS + reglas»: el conjunto de autorizados no se reduce.
3. **Service worker**: se retira `js/allowed-emails.js` del precache
   (`STATIC_ASSETS`).
4. **Bump de versión a `20260905`** (`js/config.js`, `index.html`,
   `service-worker.js`) para invalidar las cachés del deploy anterior.
5. **README.md y `docs/manual-de-usuario.md`** se actualizan explicando el
   nuevo mecanismo: los correos se editan en un único sitio
   (`firestore.rules`).

## Consecuencias

**Positivas**:

- **Un solo sitio que mantener**: la lista de correos vive donde ya vivía
  la protección real de los datos; es imposible que vuelva a
  desincronizarse (el caso de `josemcrespo98@gmail.com` en `main` no puede
  repetirse).
- **La lista ya no se expone en el navegador**: antes cualquier visitante
  podía leer el array completo de correos autorizados descargando el JS;
  ahora la lista solo existe en las reglas y no se sirve al cliente.
- La decisión de quién entra la toma **la misma capa que protege los
  datos**: no hay diferencia posible entre «parece invitado» (JS) y «es
  invitado» (reglas).
- El conjunto de correos autorizados no se reduce (siguen siendo los 4).

**Negativas / a vigilar**:

- **Una lectura extra de Firestore por login** (`getDoc` del perfil propio
  contra las reglas): solo ocurre al iniciar sesión y es despreciable
  frente al resto de lecturas de la sesión.
- **Un no invitado sin conexión no es detectado hasta reconectar**: la
  sonda falla con error de red y no bloquea la entrada. Está mitigado
  porque las reglas siguen denegando lecturas/escrituras — el usuario ve
  la app vacía y sus cambios no se guardan, pero los datos nunca quedan
  expuestos; al recuperar la conexión, las suscripciones reintentan
  (issue #147).
- El aviso de «no invitado» ahora depende de una respuesta de Firestore:
  con mala conexión puede tardar algo más que la comprobación local
  instantánea anterior (aceptable: es un caso límite).

## Issues relacionadas

- Related issue: #195 (correos permitidos)
- Se apoya en: #147 (retry de suscripciones), #145 (flujo SDD)
