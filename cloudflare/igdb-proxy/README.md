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
# En este directorio (cloudflare/igdb-proxy/)
npm install -g wrangler        # si no lo tienes instalado
wrangler login                 # abre el navegador para autorizar
wrangler deploy                # despliega el Worker
```

Al final verás una URL parecida a
`https://igdb-proxy.<tu-subdominio>.workers.dev`. Esa es la URL que
pondrás en la web.

## 3. Configurar los secretos

```bash
wrangler secret put TWITCH_CLIENT_ID        # pega tu Client ID
wrangler secret put TWITCH_CLIENT_SECRET    # pega tu Client Secret
wrangler secret put ALLOWED_ORIGIN          # p. ej. https://tuapp.web.app
```

- `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET` son **obligatorios**.
- `ALLOWED_ORIGIN` es **opcional pero recomendado**: limita el proxy a
  tu dominio (p. ej. `https://registro-personal.web.app` o el dominio
  de GitHub Pages que uses). Sin este valor el Worker acepta peticiones
  de cualquier origen (el secreto sigue a salvo, pero la cuota la
  comparte cualquiera).

> Los secretos se guardan cifrados en Cloudflare y se inyectan en el
> Worker en tiempo de ejecución: no quedan en el repositorio ni se
> sirven al navegador.

## 4. Probar el Worker

```bash
curl -X POST "https://igdb-proxy.<tu-subdominio>.workers.dev/v4/games" \
  -H "Content-Type: text/plain" \
  -d 'search "zelda"; fields name, first_release_date, cover.image_id; limit 5;'
```

Debe devolver un JSON con juegos de Zelda. Si devuelve un error 502,
revisa que los dos secretos estén bien configurados.

## 5. Conectar la web

En `js/config.js`:

```js
// URL pública de tu Cloudflare Worker (proxy IGDB).
export const IGDB_PROXY_URL = "https://igdb-proxy.<tu-subdominio>.workers.dev";
```

Sin este valor, la búsqueda de videojuegos muestra un aviso claro
(«Falta IGDB_PROXY_URL…»), pero el resto de la app funciona igual.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `502 Bad Gateway` al probar | Secretos mal configurados | `wrangler secret put TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` de nuevo |
| `403 Origen no permitido` | `ALLOWED_ORIGIN` no coincide con tu dominio | Revisa el valor exacto (incluye `https://`) |
| Búsqueda muestra «IGDB rechazó la petición» | Credenciales de Twitch inválidas o token caducado | Revisa Client ID/Secret en dev.twitch.tv |
| `429 Too Many Requests` | Cuota IGDB superada (4 req/s) | Espera un segundo; es temporal |
