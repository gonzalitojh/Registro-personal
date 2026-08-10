// =============================================================
// Proxy de IGDB (Twitch) para la app Registro-personal.
//
// IGDB no permite peticiones directas desde el navegador (no hay
// CORS) y su Client Secret NO puede exponerse en una SPA. Este
// Worker:
//   1. Guarda TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET como secretos
//      de Cloudflare (nunca se sirven al navegador).
//   2. Obtiene un token de acceso (flujo client_credentials de
//      Twitch) y lo cachea con su caducidad.
//   3. Reenvía las peticiones POST a https://api.igdb.com/v4/* con
//      las cabeceras Client-ID y Authorization, y añade CORS.
//
// La app solo conoce la URL pública de este Worker
// (IGDB_PROXY_URL en js/config.js), nunca los secretos.
//
// Documentación: https://api-docs.igdb.com/
// =============================================================

const IGDB_BASE = "https://api.igdb.com/v4";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

// Cache del token en memoria (por aislamiento del Worker). El token
// dura ~60 días, así que se refresca solo si falta o está a punto de
// expirar. Cloudflare puede recrear el aislamiento y repetir el
// intercambio OAuth de vez en cuando: es normal y gratuito.
let cachedToken = null;
let tokenExpiresAt = 0;

// -------------------------------------------------------------
// CORS
// -------------------------------------------------------------

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  let allowOrigin = env.ALLOWED_ORIGIN || "*";
  if (origin && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
    // Origen no permitido: no se añade cabecera CORS (el navegador
    // bloqueará la petición, que es justo lo que se quiere).
    allowOrigin = origin; // se bloquea abajo con 403
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(env, request) {
  if (!env.ALLOWED_ORIGIN) return true;
  const origin = request.headers.get("Origin");
  return !origin || origin === env.ALLOWED_ORIGIN;
}

// -------------------------------------------------------------
// Token OAuth (client_credentials de Twitch)
// -------------------------------------------------------------

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  // Margen de seguridad: se refresca 5 minutos antes de caducar.
  if (cachedToken && tokenExpiresAt - now > 300) {
    return cachedToken;
  }
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error(
      "Faltan los secretos TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET " +
        "en el Worker (wrangler secret put)."
    );
  }
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(`${TWITCH_TOKEN_URL}?${params}`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token IGDB fallido (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}

// -------------------------------------------------------------
// Handler principal
// -------------------------------------------------------------

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env, request),
      });
    }

    // Restricción opcional de origen (recomendada en producción).
    if (!isAllowedOrigin(env, request)) {
      return new Response(JSON.stringify({ error: "Origen no permitido" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    // Reenvía TODO lo que venga bajo /v4/* (p. ej. /v4/games).
    if (!url.pathname.startsWith("/v4/")) {
      return new Response(
        JSON.stringify({ error: `Ruta no soportada: ${url.pathname} (usa /v4/*)` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const token = await getAccessToken(env);
      const target = IGDB_BASE + url.pathname.slice("/v4".length);

      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Client-ID": env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          Accept: "application/json",
        },
        body: await request.text(),
      });

      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...corsHeaders(env, request),
          "Content-Type": res.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { ...corsHeaders(env, request), "Content-Type": "application/json" },
      });
    }
  },
};
