// =============================================================
// Wiring del dropdown de notificaciones: abrir/cerrar, marcar
// como leídas, borrar todas. Extraído de app.js.
// =============================================================

export function setupNotifications(ctx) {
  const { deleteNotification, markNotificationRead } = ctx;
  const notifWrap = document.querySelector(".notif-wrap");
  const notifDropdown = document.getElementById("notif-dropdown");

  document.getElementById("btn-notifications").addEventListener("click", () => {
    notifDropdown.classList.toggle("hidden");
    if (!notifDropdown.classList.contains("hidden")) {
      ctx.getNotifications()
        .filter((n) => !n.read)
        .forEach((n) => markNotificationRead(ctx.getCurrentUser().uid, n.id));
    }
  });

  document.addEventListener("click", (e) => {
    if (notifWrap && !notifWrap.contains(e.target)) {
      notifDropdown.classList.add("hidden");
    }
  });

  document.getElementById("btn-clear-notifs").addEventListener("click", async () => {
    for (const n of ctx.getNotifications()) {
      await deleteNotification(ctx.getCurrentUser().uid, n.id);
    }
  });
}
