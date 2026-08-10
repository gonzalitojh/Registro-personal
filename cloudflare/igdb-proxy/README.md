# Proxy de IGDB para Registro-personal (Cloudflare Worker)

IGDB (Twitch) no permite peticiones desde el navegador: no tiene CORS y
exige un **Client Secret** que **no puede exponerse en una SPA**. Este
Worker actúa de proxy seguro: guarda el Client ID y el Client Secret
como secretos de Cloudflare, obtiene el token OAuth en el servidor y
reenvía las peticiones a `https://api.igdb.com/v4/*` con CORS.

La web solo necesita la **URL pública** de este Worker
(`IGDB_PROXY_URL` en `js/config.js`): los secretos nunca llegan al
navegador.

---

## 0. Antes de empezar: dónde se hace esto y qué hay que subir a GitHub

- **Dónde se ejecuta la configuración**: en **tu PC**, en la terminal
  (consola), **dentro de la carpeta `cloudflare/igdb-proxy/`**. No hay
  que configurar nada en GitHub: el repositorio solo contiene la app; el
  Worker se sube con `wrangler deploy` directamente a **Cloudflare**.
- **¿Hay que hacer commit y push?** Solo **una** cosa, al final: la URL
  del Worker en `js/config.js` (paso 5). Desplegar el Worker y guardar
  los secretos **no** requiere commit ni push.
- **No ejecutes `wrangler init`**: el repositorio ya trae su propio
  `wrangler.toml` con el nombre correcto del Worker (`igdb-proxy`). Si
  ya lo ejecutaste, te habrá creado un `wrangler.jsonc` y añadido líneas
  al `.gitignore`:
  - **Borra `wrangler.jsonc`** (si queda junto a `wrangler.toml`,
    wrangler podría usar el equivocado y desplegar el Worker con otro
    nombre).
  - **No commitees ni pushees** esos cambios del `.gitignore` ni el
    `wrangler.jsonc`: no forman parte de la app. (Lo que sí es normal es
    que wrangler cree una carpeta `.wrangler/` de trabajo: tampoco se
    sube; tu `.gitignore` local se encarga.)

## 1. Obtener las credenciales de Twitch (IGDB)

1. Entra en [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
   con tu cuenta de Twitch (si no tienes, créala gratis).
2. Pulsa **Register Your Application**:
   - **Name**: por ejemplo `registro-personal-igdb`.
   - **OAuth Redirect URLs**: `http://localhost` (no se usará; es un
     requisito del formulario).
   - **Category**: *Application Integration*.
   - Marca el captcha y pulsa **Create**.
3. En la lista de apps, pulsa **Manage** en la que acabas de crear.
4. Anota el **Client ID**.
5. Pulsa **New Secret** para generar el **Client Secret** y cópialo.
   - El Client Secret solo se muestra una vez. Guárdalo en un gestor de
     contraseñas; si lo pierdes, genera uno nuevo.
6. La API de IGDB es **gratuita para uso no comercial** (acuerdo de
   desarrollador de Twitch) y admite **4 peticiones por segundo**, más
   que suficiente para uso personal.

## 2. Desplegar el Worker

Necesitas una cuenta de Cloudflare gratuita y Node.js ≥ 18.

```bash
# IMPORTANTE: primero entra en la carpeta del Worker
cd cloudflare/igdb-proxy
npm install -g wrangler        # si no lo tienes instalado
wrangler login                 # abre el navegador para autorizar
wrangler deploy                # despliega el Worker
```

Al final, `wrangler deploy` imprime la **URL pública** de tu Worker:

```
https://igdb-proxy.<tu-subdominio>.workers.dev
```

- **Copia la URL exacta que imprime wrangler** (con `https://`) y úsala
  en los pasos 4 y 5. No la inventes ni la mezcles.
- Si la URL impresa tiene **otro nombre** de Worker (por ejemplo
  `registro-personal...` o `hello-world...`), es que `wrangler deploy`
  se ejecutó desde otra carpeta o con otra configuración
  (`wrangler.jsonc` de un `wrangler init` previo): entra en
  `cloudflare/igdb-proxy/`, borra el `wrangler.jsonc` si existe y
  vuelve a desplegar. El nombre debe ser **`igdb-proxy`** (el que fija
  `wrangler.toml`).
- **El Worker debe quedar público**. Si al abrir su URL el navegador
  muestra una página de inicio de sesión de **Cloudflare Access / Zero
  Trust** («Sign in · Cloudflare Access»), el Worker no sirve como
  proxy público: desactiva esa protección en el panel de Cloudflare
  (Workers & Pages → tu Worker → Settings → Access) y vuelve a probar.

## 3. Configurar los secretos

```bash
# Desde la misma carpeta cloudflare/igdb-proxy/
wrangler secret put TWITCH_CLIENT_ID        # pega tu Client ID
wrangler secret put TWITCH_CLIENT_SECRET    # pega tu Client Secret
wrangler secret put ALLOWED_ORIGIN          # p. ej. https://tuapp.web.app
```

- `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET` son **obligatorios**.
- `ALLOWED_ORIGIN` es **opcional pero recomendado**: limita el proxy a
  tu dominio (el de la app desplegada, por ejemplo
  `https://tuapp.web.app` o el de GitHub Pages). Sin este valor el
  Worker acepta peticiones de cualquier origen (el secreto sigue a
  salvo, pero la cuota la comparte cualquiera).

> Los secretos se guardan cifrados en Cloudflare y se inyectan en el
> Worker en tiempo de ejecución: no quedan en el repositorio ni se
> sirven al navegador. Los secretos **no** se suben a GitHub.

## 4. Probar el Worker

### Método A — navegador (el más sencillo, recomendado)

Abre en el navegador la URL exacta del paso 2
(`https://igdb-proxy.<tu-subdominio>.workers.dev/`).

- Debe mostrar un JSON parecido a este:

  ```json
  {
    "ok": true,
    "service": "igdb-proxy",
    "secretsConfigured": true,
    "hint": "Secretos OK. Prueba el POST a /v4/games del README."
  }
  ```

- Si `secretsConfigured` es `false`, todavía faltan los secretos del
  paso 3 (el Worker sí está bien desplegado).
- Si el navegador muestra una **página de login** (Cloudflare Access) o
  **no carga nada**, consulta la tabla de Solución de problemas.

### Método B — línea de comandos

**Linux / macOS** (o Windows con Git Bash):

```bash
curl -X POST "https://igdb-proxy.<tu-subdominio>.workers.dev/v4/games" \
  -H "Content-Type: text/plain" \
  -d 'search "zelda"; fields name, first_release_date, cover.image_id; limit 5;'
```

Debe devolver un JSON con juegos de Zelda. Si devuelve un error 502,
revisa que los dos secretos estén bien configurados.

**Windows (PowerShell)**: el comando `curl` de PowerShell es un alias de
`Invoke-WebRequest` y puede fallar con *«no se puede crear un canal
seguro SSL/TLS»* aunque todo esté bien. Usa `curl.exe` (el de verdad):

```powershell
curl.exe -X POST "https://igdb-proxy.<tu-subdominio>.workers.dev/v4/games" -H "Content-Type: text/plain" -d "search \"zelda\"; fields name, first_release_date, cover.image_id; limit 5;"
```

O usa directamente el **Método A** (navegador), que evita el problema.

## 5. Conectar la web (el único cambio que se sube a GitHub)

En `js/config.js`:

```js
// URL pública de tu Cloudflare Worker (proxy IGDB).
export const IGDB_PROXY_URL = "https://igdb-proxy.<tu-subdominio>.workers.dev";
```

Sustituye `<tu-subdominio>` por el de **tu** URL exacta del paso 2.

**Este sí es un cambio para commit y push** (junto con el resto de la
tarea): es lo que hace que la web sepa dónde preguntar por el catálogo.
Sin este valor, la búsqueda de videojuegos muestra un aviso claro
(«Falta IGDB_PROXY_URL…»), pero el resto de la app funciona igual.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| *«No se puede crear un canal seguro SSL/TLS»* al probar (Windows) | El `curl` de PowerShell no habla TLS con Cloudflare; o la URL no existe (aún no desplegada o con nombre distinto) | Usa `curl.exe` (Método B) o el navegador (Método A). Comprueba que la URL es la exacta que imprimió `wrangler deploy` |
| El navegador dice «conexión no segura» / no muestra nada | La URL no existe (Worker no desplegado con ese nombre) o mezcla nombres | Comprueba la URL exacta impresa por `wrangler deploy` (debe empezar por `https://igdb-proxy.`) |
| El navegador muestra la página de login de «Cloudflare Access» | El Worker está protegido con Zero Trust / Access | Desactiva el acceso en Workers & Pages → tu Worker → Settings → Access; debe ser público |
| `404` / error `1042` (Worker no encontrado) | El Worker desplegado no se llama `igdb-proxy` (p. ej. un `wrangler.jsonc` de un `wrangler init` tomó el relevo) | Entra en `cloudflare/igdb-proxy/`, borra `wrangler.jsonc` si existe y vuelve a `wrangler deploy` |
| `502 Bad Gateway` al probar | Secretos mal configurados | `wrangler secret put TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` de nuevo |
| `403 Origen no permitido` | `ALLOWED_ORIGIN` no coincide con tu dominio | Revisa el valor exacto (incluye `https://`) |
| Búsqueda muestra «IGDB rechazó la petición» | Credenciales de Twitch inválidas o token caducado | Revisa Client ID/Secret en dev.twitch.tv |
| `429 Too Many Requests` | Cuota IGDB superada (4 req/s) | Espera un segundo; es temporal |
