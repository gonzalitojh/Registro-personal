// =============================================================
// Reintento de suscripciones (issue #147).
//
// Las suscripciones iniciales de datos (onSnapshot de Firestore)
// pueden fallar por errores transitorios al entrar en la web (red,
// conexión con Firestore...). Antes, un fallo dejaba la biblioteca
// vacía hasta cerrar y volver a abrir la app, porque el callback
// onError solo mostraba un aviso y nunca se reintentaba.
//
// subscribeWithRetry() envuelve cualquier suscripción y la vuelve
// a intentar con espera progresiva (backoff: 1s, 2s, 4s...) hasta
// un máximo de reintentos. Si el dispositivo está sin conexión,
// espera al evento "online" en lugar de quemar los reintentos.
// Devuelve un cancel() estable que limpia la suscripción activa,
// los temporizadores y el listener de red pendientes.
//
// Además, cada intento tiene un watchdog (issue #286): si no llega
// ningún snapshot con éxito en `initialTimeoutMs`, el intento se
// trata como fallo transitorio (antes, una suscripción que ni
// fallaba ni entregaba datos —p. ej. un stream colgado— dejaba el
// «Cargando…» eterno sin posibilidad de reintento).
// =============================================================

/**
 * Envuelve una suscripción con reintento automático.
 *
 * @param {Object} options
 * @param {(handlers: { onChange: (data: any) => void, onError: (err: any) => void }) => () => void} options.subscribe
 *        Función que crea la suscripción y devuelve su función de cancelación.
 * @param {(data: any) => void} options.onChange  — callback de datos (se llama con cada snapshot con éxito).
 * @param {(err: any) => void} options.onError    — error FINAL tras agotar los reintentos.
 * @param {(attempt: number) => void} [options.onRetrying] — aviso informativo (solo la 1ª vez por episodio de fallo).
 * @param {number} [options.maxRetries = 3]       — reintentos tras el intento inicial (4 intentos en total).
 * @param {number} [options.baseDelayMs = 1000]   — espera base del backoff (baseDelay * 2^(n-1)).
 * @param {boolean} [options.waitForOnline = true]— si el dispositivo está offline, esperar al evento "online"
 *                                                 en vez de gastar los reintentos con temporizadores.
 * @param {number} [options.initialTimeoutMs = 12000] — watchdog del intento (issue #286): si no llega ningún
 *                                                 snapshot con éxito en ese tiempo, el intento se trata como
 *                                                 fallo transitorio y se reintenta con el backoff existente.
 *                                                 Poner 0 desactiva el watchdog.
 * @returns {() => void} cancel() — cancelación estable: anula la suscripción actual, los timers y
 *                                   el listener "online" pendientes. Es seguro llamarla varias veces.
 */
export function subscribeWithRetry({
  subscribe,
  onChange,
  onError,
  onRetrying,
  maxRetries = 3,
  baseDelayMs = 1000,
  waitForOnline = true,
  initialTimeoutMs = 12000,
}) {
  let cancelled = false;
  let attempts = 0;
  let notifiedRetry = false;
  let retryTimer = null;
  let watchdogTimer = null;
  let onlineHandler = null;
  let currentUnsubscribe = null;

  function clearOnlineHandler() {
    if (onlineHandler) {
      window.removeEventListener("online", onlineHandler);
      onlineHandler = null;
    }
  }

  // Camino común de error: informa (si toca), decide si reintentar
  // (con backoff) o esperar a estar online, y agota con onError final.
  function handleError(err) {
    if (cancelled || retryTimer) return;
    // El watchdog solo vigila el intento en curso: si el error real
    // llega antes que él, se retira para no disparar un onError final
    // doble cuando el timer del intento ya fallido siga pendiente.
    clearTimeout(watchdogTimer);
    watchdogTimer = null;

    if (!notifiedRetry && onRetrying) {
      notifiedRetry = true;
      onRetrying(attempts + 1);
    }

    // Sin conexión: no gastar reintentos con timers. Al volver la red
    // ("online") se re-suscribe al momento.
    if (waitForOnline && navigator.onLine === false) {
      onlineHandler = retry;
      window.addEventListener("online", onlineHandler);
      return;
    }

    if (attempts < maxRetries) {
      attempts++;
      console.warn("Suscripción falló, se reintentará:", err);
      retryTimer = setTimeout(retry, baseDelayMs * 2 ** (attempts - 1));
    } else {
      console.error("Suscripción agotó los reintentos:", err);
      onError(err);
    }
  }

  function start() {
    if (cancelled) return;
    // Watchdog del intento (issue #286): si en `initialTimeoutMs` no
    // llega ningún snapshot con éxito, el intento se trata como fallo
    // transitorio. Se arma en CADA intento (start) y solo vigila el
    // primer snapshot de ese intento: el onChange de éxito lo retira.
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    if (initialTimeoutMs > 0) {
      watchdogTimer = setTimeout(() => {
        handleError(new Error("watchdog: sin primer snapshot en " + initialTimeoutMs + "ms"));
      }, initialTimeoutMs);
    }
    try {
      currentUnsubscribe = subscribe({
        onChange: (data) => {
          // Éxito: se resetea el episodio de fallo para que un futuro
          // error vuelva a avisar y reintentar desde cero.
          if (cancelled) return;
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
          attempts = 0;
          notifiedRetry = false;
          onChange(data);
        },
        onError: handleError,
      });
    } catch (err) {
      // onSnapshot puede lanzar de forma síncrona; se trata igual que
      // un error asíncrono del listener.
      handleError(err);
    }
  }

  function retry() {
    if (cancelled) return;
    // Limpiar el timer ya disparado y el listener "online": si no, el
    // guard `retryTimer` de handleError bloquearía los reintentos
    // siguientes (el id del timer disparado sigue siendo truthy) y el
    // listener dispararía re-suscripciones espurias en cada reconexión.
    clearTimeout(retryTimer);
    retryTimer = null;
    // Crítico: el watchdog del intento N debe morir aquí. Si no, su
    // timer dispara a mitad del intento N+1 y provoca un reintento
    // espurio (el nuevo intento arma su propio watchdog en start()).
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    clearOnlineHandler();
    // Nunca dejar dos suscripciones vivas: cancelar la rota antes de
    // volver a crear (el unsubscribe de un stream ya muerto es inocuo).
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
    }
    start();
  }

  function cancel() {
    cancelled = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    clearOnlineHandler();
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
    }
  }

  start();
  return cancel;
}
