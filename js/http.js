// =============================================================
// fetch con reintento. Las APIs externas (sobre todo Google Books)
// a veces devuelven errores temporales del servidor (503, etc.).
// Reintentar una vez tras una pequeña espera resuelve la mayoría
// de esos casos sin que el usuario tenga que volver a buscar a mano.
// =============================================================

export async function fetchJson(url, { retries = 1, retryDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}
