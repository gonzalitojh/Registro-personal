// =============================================================
// Exportación e importación de copias de seguridad (JSON).
// Permite descargar todos los datos del usuario como un archivo
// JSON estructurado, y restaurarlos posteriormente desde un
// archivo previamente exportado.
// =============================================================

import * as ui from "./ui.js";

const BACKUP_MAJOR_VERSION = 1;

// Input de archivo singleton para importación (evita fugas de DOM)
let _fileInput = null;
function getFileInput() {
  if (!_fileInput) {
    _fileInput = document.createElement("input");
    _fileInput.type = "file";
    _fileInput.accept = ".json,application/json";
    _fileInput.style.display = "none";
    document.body.appendChild(_fileInput);
  }
  return _fileInput;
}

/**
 * Prepara y descarga un archivo JSON con todos los datos del usuario.
 * @param {Object} ctx - Contexto de la aplicación (createCtx)
 */
export async function exportBackup(ctx) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  const uid = user.uid;
  ui.showToast("Preparando copia de seguridad…");

  try {
    // Obtener perfil del usuario
    const profile = await ctx.getUserProfile(uid);

    // Obtener todos los items mediante getItemsOnce (lectura única)
    const [movies, series, books] = await Promise.all([
      ctx.getItemsOnce(uid, "movie"),
      ctx.getItemsOnce(uid, "tv"),
      ctx.getItemsOnce(uid, "book"),
    ]);

    // Obtener notificaciones
    // (no hay getNotificationsOnce en ctx, así que las incluimos si están disponibles)
    const notifications = ctx.getNotifications ? ctx.getNotifications() : [];

    // Construir el objeto de exportación
    const backup = {
      exportDate: new Date().toISOString(),
      version: BACKUP_VERSION,
      source: "Mi Registro",
      user: {
        uid: uid,
        email: user.email,
        displayName: user.displayName || null,
      },
      data: {
        profile: profile || {},
        movies,
        series,
        books,
        notifications,
      },
    };

    // Generar y descargar el archivo
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `mi-registro-backup-${uid.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    ui.showToast("Copia de seguridad descargada.");
  } catch (err) {
    console.error("Error al exportar datos:", err);
    ui.showToast("No se pudo exportar: " + err.message);
  }
}

/**
 * Permite al usuario seleccionar un archivo JSON de backup y restaura
 * los datos en Firestore.
 * @param {Object} ctx - Contexto de la aplicación (createCtx)
 */
export function importBackup(ctx) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  // Confirmación antes de importar
  if (!confirm("¿Estás seguro de que quieres importar estos datos?\n\nSe añadirán elementos nuevos a los que ya tienes. No se reemplazarán ni eliminarán datos existentes.")) {
    return;
  }

  const input = getFileInput();

  // Desvincular evento anterior para evitar acumulación de listeners
  const newInput = input.cloneNode(false);
  input.parentNode.replaceChild(newInput, input);
  _fileInput = newInput;

  newInput.addEventListener("change", async () => {
    const file = newInput.files && newInput.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      // Validar estructura básica (comparación por versión major)
      const backupMajor = parseInt(backup && backup.version, 10);
      if (!backup || !backup.data || Number.isNaN(backupMajor) || backupMajor < BACKUP_MAJOR_VERSION) {
        ui.showToast(
          "El archivo no tiene el formato de copia de seguridad de Mi Registro."
        );
        return;
      }

      const { profile, movies, series, books, notifications } = backup.data;
      const uid = user.uid;
      let restored = 0;
      let errors = 0;

      ui.showToast("Restaurando datos…");

      // Restaurar perfil
      if (profile && Object.keys(profile).length > 0) {
        try {
          const { id, ...profileData } = profile;
          if (ctx.upsertUserProfile) {
            await ctx.upsertUserProfile(uid, profileData);
            restored++;
          }
        } catch (e) {
          errors++;
          console.warn("Error restaurando perfil:", e);
        }
      }

      // Restaurar películas
      if (Array.isArray(movies)) {
        for (const item of movies) {
          try {
            const { id, ...data } = item;
            await ctx.addItem(uid, "movie", data);
            restored++;
          } catch (e) {
            errors++;
            console.warn("Error restaurando película:", item.title, e);
          }
        }
      }

      // Restaurar series
      if (Array.isArray(series)) {
        for (const item of series) {
          try {
            const { id, ...data } = item;
            await ctx.addItem(uid, "tv", data);
            restored++;
          } catch (e) {
            errors++;
            console.warn("Error restaurando serie:", item.title, e);
          }
        }
      }

      // Restaurar libros
      if (Array.isArray(books)) {
        for (const item of books) {
          try {
            const { id, ...data } = item;
            await ctx.addItem(uid, "book", data);
            restored++;
          } catch (e) {
            errors++;
            console.warn("Error restaurando libro:", item.title, e);
          }
        }
      }

      // Restaurar notificaciones
      if (Array.isArray(notifications) && ctx.addNotification) {
        for (const notif of notifications) {
          try {
            const { id, ...data } = notif;
            await ctx.addNotification(uid, data);
            restored++;
          } catch (e) {
            errors++;
            console.warn("Error restaurando notificación:", e);
          }
        }
      }

      const msg = `Restaurados ${restored} elemento${restored !== 1 ? "s" : ""}.`;
      if (errors > 0) {
        ui.showToast(`${msg} ${errors} error${errors !== 1 ? "es" : ""} (ver consola).`);
      } else {
        ui.showToast(msg);
      }
    } catch (err) {
      console.error("Error al importar datos:", err);
      ui.showToast("No se pudo importar: " + err.message);
    }
  });

  newInput.click();
}

/**
 * Configura los botones de exportación e importación en la vista de perfil.
 * @param {Object} ctx - Contexto de la aplicación (createCtx)
 */
export function setupExportBackup(ctx) {
  const btnExport = document.getElementById("btn-export-backup");
  const btnImport = document.getElementById("btn-import-backup");

  if (btnExport) {
    btnExport.addEventListener("click", () => exportBackup(ctx));
  }

  if (btnImport) {
    btnImport.addEventListener("click", () => importBackup(ctx));
  }
}
