// =============================================================
// Wiring del dropdown de notificaciones: abrir/cerrar, marcar
// como leídas, borrar todas. Extraído de app.js.
// Incluye gestión de foco para accesibilidad.
// =============================================================

import { trapFocus } from "./focus-utils.js";

export function setupNotifications(ctx) {
  const { deleteNotification, markNotificationRead } = ctx;
  const notifWrap = document.querySelector(".notif-wrap");
  const notifDropdown = document.getElementById("notif-dropdown");
  const btnNotifications = document.getElementById("btn-notifications");

  let focusTrapCleanup = null;

  function closeNotifDropdown() {
    notifDropdown.classList.add("hidden");
    if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
    // Restaurar foco al botón de notificaciones
    if (btnNotifications) btnNotifications.focus();
  }

  btnNotifications.addEventListener("click", () => {
    const wasHidden = notifDropdown.classList.contains("hidden");
    notifDropdown.classList.toggle("hidden");

    if (!notifDropdown.classList.contains("hidden")) {
      // Marcar como leídas
      ctx.getNotifications()
        .filter((n) => !n.read)
        .forEach((n) => markNotificationRead(ctx.getCurrentUser().uid, n.id));

      // Atrapar foco dentro del dropdown
      focusTrapCleanup = trapFocus(notifDropdown);

      // Escape para cerrar
      function escHandler(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeNotifDropdown();
          document.removeEventListener("keydown", escHandler);
        }
      }
      document.addEventListener("keydown", escHandler);
    } else {
      closeNotifDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (notifWrap && !notifWrap.contains(e.target) && !notifDropdown.classList.contains("hidden")) {
      closeNotifDropdown();
    }
  });

  document.getElementById("btn-clear-notifs").addEventListener("click", async () => {
    for (const n of ctx.getNotifications()) {
      await deleteNotification(ctx.getCurrentUser().uid, n.id);
    }
  });
}
