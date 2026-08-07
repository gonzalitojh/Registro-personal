// =============================================================
// Perfil, estadísticas y amigos. Extraído de app.js.
// Maneja la vista de perfil con gráficas (Chart.js) y la sección
// de amigos (lista + detalle de solo lectura).
// =============================================================

import { normalizeEntry } from "./tv-progress.js";
import { STATUS_LABELS_NEUTRAL } from "./constants.js";
import * as ui from "./ui.js";
import { setupExportBackup } from "./export-backup.js";
import { setupExportIcs } from "./export-ics.js";
import { renderSettings } from "./settings.js";
import { buildGlobalFeed } from "./activity-feed.js";
import { logout } from "./firebase.js";
import { trapFocus } from "./focus-utils.js";

let activityChart = null;
let statusChart = null;

function getCurrentStatsFilter() {
  const statsPeriodSelect = document.getElementById("stats-period-select");
  const statsRangeStart = document.getElementById("stats-range-start");
  const statsRangeEnd = document.getElementById("stats-range-end");

  if (statsPeriodSelect.value === "custom") {
    return {
      type: "custom",
      start: statsRangeStart.value || null,
      end: statsRangeEnd.value || null,
    };
  }
  return { type: statsPeriodSelect.value };
}

function withinPeriod(dateStr, filter) {
  if (!dateStr) return false;
  if (filter.type === "all") return true;
  if (filter.type === "custom") {
    if (filter.start && dateStr < filter.start) return false;
    if (filter.end && dateStr > filter.end) return false;
    return true;
  }
  const now = new Date();
  const d = new Date(dateStr);
  if (filter.type === "year") return d.getFullYear() === now.getFullYear();
  if (filter.type === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

function computeStats(filter, ctx) {
  const allItems = ctx.getAllItems();
  const monthly = {};
  let moviesWatched = 0;
  allItems.movies.forEach((m) => {
    (m.watchLog || []).forEach((date) => {
      if (withinPeriod(date, filter)) {
        moviesWatched++;
        const key = date.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  let episodesWatched = 0;
  let seriesCompleted = 0;
  allItems.tv.forEach((s) => {
    Object.values(s.watched || {}).forEach((seasonMap) => {
      Object.values(seasonMap).forEach((raw) => {
        const entry = normalizeEntry(raw);
        if (!entry || !entry.date) return;
        if (withinPeriod(entry.date, filter)) {
          episodesWatched++;
          const key = entry.date.slice(0, 7);
          monthly[key] = (monthly[key] || 0) + 1;
        }
      });
    });
    if (s.status === "completado" && withinPeriod(s.lastWatchedAt, filter)) seriesCompleted++;
  });

  let booksRead = 0;
  allItems.books.forEach((b) => {
    (b.readLog || []).forEach((entry) => {
      if (entry.finishedAt && withinPeriod(entry.finishedAt, filter)) {
        booksRead++;
        const key = entry.finishedAt.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  const statusCounts = {};
  [...allItems.movies, ...allItems.tv, ...allItems.books].forEach((i) => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  return { moviesWatched, episodesWatched, seriesCompleted, booksRead, monthly, statusCounts };
}

function renderStats(filter, ctx) {
  const stats = computeStats(filter, ctx);
  const summaryEl = document.getElementById("stats-summary");
  summaryEl.innerHTML = `
    <div class="stat-tile"><span class="stat-tile__value">${stats.moviesWatched}</span><span class="stat-tile__label">Películas vistas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.episodesWatched}</span><span class="stat-tile__label">Episodios vistos</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.seriesCompleted}</span><span class="stat-tile__label">Series completadas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.booksRead}</span><span class="stat-tile__label">Libros leídos</span></div>
  `;

  if (typeof Chart === "undefined") return;

  const months = Object.keys(stats.monthly).sort();
  const activityCtx = document.getElementById("chart-activity");
  if (activityChart) activityChart.destroy();
  activityChart = new Chart(activityCtx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [{ label: "Actividad", data: months.map((m) => stats.monthly[m]), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--teal-reel").trim() }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const statusLabelsPresent = Object.keys(stats.statusCounts).filter((k) => stats.statusCounts[k] > 0);
  const statusCtx = document.getElementById("chart-status");
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: statusLabelsPresent.map((k) => STATUS_LABELS_NEUTRAL[k] || k),
      datasets: [
        {
          data: statusLabelsPresent.map((k) => stats.statusCounts[k]),
          backgroundColor: [
            getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--teal-reel").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--ochre-spine").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--ochre-spine-dark").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--stamp").trim(),
          ],
        },
      ],
    },
    options: { responsive: true },
  });
}

export function setupProfile(ctx) {
  const profileSubtabs = document.querySelectorAll(".profile-subtab");
  const statsSection = document.getElementById("profile-section-stats");
  const friendsSection = document.getElementById("profile-section-friends");
  const activitySection = document.getElementById("profile-section-activity");
  const dataSection = document.getElementById("profile-section-data");
  const settingsSection = document.getElementById("profile-section-settings");
  const friendsListEl = document.getElementById("friends-list");
  const friendDetailEl = document.getElementById("friend-detail");
  const friendDetailNameEl = document.getElementById("friend-detail-name");
  const statsPeriodWrap = document.querySelector(".stats-period");
  const activityFeedContainer = document.getElementById("activity-feed-container");
  const activityFeedLoading = document.getElementById("activity-feed-loading");
  const statsPeriodSelect = document.getElementById("stats-period-select");
  const statsRangeFields = document.getElementById("stats-range-fields");
  const statsRangeStart = document.getElementById("stats-range-start");
  const statsRangeEnd = document.getElementById("stats-range-end");

  // Estado de la vista de detalle de amigo (pestañas y filtros en memoria)
  const friendData = { movies: [], tv: [], books: [] };
  const friendFilters = { movies: "todos", tv: "todos", books: "todos" };
  let friendActiveTab = "movies";
  let currentFriendName = "";
  let currentFriendUid = "";

  async function loadFriendsList() {
    friendsListEl.innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      const profiles = await ctx.getAllUserProfiles();
      ui.renderFriendsList(friendsListEl, profiles, ctx.getCurrentUser().uid, openFriend);
    } catch (err) {
      friendsListEl.innerHTML = `<p class="empty-state">No se pudo cargar la lista de amigos.</p>`;
    }
  }

  function renderFriendTab(tabKey) {
    const status = friendFilters[tabKey];
    const filtered =
      status === "todos" ? friendData[tabKey] : friendData[tabKey].filter((item) => item.status === status);
    ui.renderFriendTab(
      tabKey,
      filtered,
      (item) => ui.openReadOnlyModal(item, currentFriendName),
      status === "todos" ? undefined : "No hay nada con ese estado."
    );
  }

  function setFriendTab(tabKey) {
    document.querySelectorAll(".friend-subtab").forEach((btn) => {
      const isActive = btn.dataset.friendTab === tabKey;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
    ["movies", "tv", "books"].forEach((key) => {
      document.getElementById("friend-panel-" + key).classList.toggle("hidden", key !== tabKey);
    });
    friendActiveTab = tabKey;
    renderFriendTab(tabKey);
  }

  function setFriendFilter(tabKey, status) {
    friendFilters[tabKey] = status;
    document.querySelectorAll(`#friend-panel-${tabKey} .friend-chip`).forEach((chip) => {
      const isActive = chip.dataset.status === status;
      chip.classList.toggle("is-active", isActive);
      chip.setAttribute("aria-pressed", String(isActive));
    });
    renderFriendTab(tabKey);
  }

  async function openFriend(profile) {
    const requestedUid = profile.uid;
    friendsListEl.classList.add("hidden");
    friendDetailEl.classList.remove("hidden");
    friendDetailNameEl.textContent = profile.displayName || profile.email || "Amigo";
    currentFriendName = profile.displayName || profile.email || "tu amigo";
    currentFriendUid = profile.uid;
    // Reset de pestaña y filtros al abrir cualquier amigo
    friendData.movies = [];
    friendData.tv = [];
    friendData.books = [];
    friendFilters.movies = "todos";
    friendFilters.tv = "todos";
    friendFilters.books = "todos";
    document.querySelectorAll(".friend-chip").forEach((chip) => {
      const isAll = chip.dataset.status === "todos";
      chip.classList.toggle("is-active", isAll);
      chip.setAttribute("aria-pressed", String(isAll));
    });
    setFriendTab("movies");
    document.getElementById("friend-movies").innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      const [movies, series, books] = await Promise.all([
        ctx.getItemsOnce(profile.uid, "movie"),
        ctx.getItemsOnce(profile.uid, "tv"),
        ctx.getItemsOnce(profile.uid, "book"),
      ]);
      if (requestedUid !== currentFriendUid) return;
      friendData.movies = movies;
      friendData.tv = series;
      friendData.books = books;
      renderFriendTab(friendActiveTab);
    } catch (err) {
      if (requestedUid !== currentFriendUid) return;
      document.getElementById("friend-" + friendActiveTab).innerHTML = `<p class="empty-state">No se pudo cargar.</p>`;
    }
  }

  /* ---------- Apertura de secciones del perfil ---------- */

  function openProfileSection(section, ctx) {
    document.getElementById("app").classList.add("hidden");
    document.getElementById("profile-view").classList.remove("hidden");
    profileSubtabs.forEach((b) => {
      const isActive = b.dataset.section === section;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", String(isActive));
    });
    statsSection.classList.toggle("hidden", section !== "stats");
    friendsSection.classList.toggle("hidden", section !== "friends");
    if (activitySection) activitySection.classList.toggle("hidden", section !== "activity");
    if (dataSection) dataSection.classList.toggle("hidden", section !== "data");
    if (settingsSection) settingsSection.classList.toggle("hidden", section !== "settings");
    statsPeriodWrap.classList.toggle("hidden", section !== "stats");
    if (section === "stats") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renderStats(getCurrentStatsFilter(), ctx);
        });
      });
    } else if (section === "friends") {
      friendDetailEl.classList.add("hidden");
      friendsListEl.classList.remove("hidden");
      loadFriendsList();
    } else if (section === "activity") {
      loadActivityFeed();
    } else if (section === "settings" && ctx) {
      renderSettings(ctx);
    }
  }

  /* ---------- Dropdown del menú de perfil ---------- */

  const profileMenuWrap = document.querySelector(".profile-menu-wrap");
  const profileDropdown = document.getElementById("profile-dropdown");
  const btnOpenProfile = document.getElementById("btn-open-profile");
  let focusTrapCleanup = null;

  function escHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeProfileDropdown();
    }
  }

  function closeProfileDropdown() {
    profileDropdown.classList.add("hidden");
    if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
    document.removeEventListener("keydown", escHandler);
    btnOpenProfile.setAttribute("aria-expanded", "false");
    btnOpenProfile.focus();
  }

  btnOpenProfile.addEventListener("click", () => {
    profileDropdown.classList.toggle("hidden");
    if (profileDropdown.classList.contains("hidden")) {
      closeProfileDropdown();
      return;
    }
    btnOpenProfile.setAttribute("aria-expanded", "true");
    focusTrapCleanup = trapFocus(profileDropdown);
    document.addEventListener("keydown", escHandler);
  });

  document.addEventListener("click", (e) => {
    if (profileMenuWrap && !profileMenuWrap.contains(e.target) && !profileDropdown.classList.contains("hidden")) {
      closeProfileDropdown();
    }
  });

  profileDropdown.querySelectorAll("[data-section]").forEach((item) => {
    item.addEventListener("click", () => {
      closeProfileDropdown();
      openProfileSection(item.dataset.section, ctx);
    });
  });

  document.getElementById("btn-profile-logout").addEventListener("click", () => {
    closeProfileDropdown();
    logout();
  });

  document.getElementById("btn-close-profile").addEventListener("click", () => {
    document.getElementById("profile-view").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
  });

  statsPeriodSelect.addEventListener("change", () => {
    const isCustom = statsPeriodSelect.value === "custom";
    statsRangeFields.classList.toggle("hidden", !isCustom);
    if (!isCustom) renderStats(getCurrentStatsFilter(), ctx);
    else if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });

  statsRangeStart.addEventListener("change", () => {
    if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });
  statsRangeEnd.addEventListener("change", () => {
    if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });

  // Inicializar botones de exportación/importación de datos
  setupExportBackup(ctx);
  setupExportIcs(ctx);

  async function loadActivityFeed() {
    if (!activityFeedContainer || !activityFeedLoading) return;
    activityFeedLoading.classList.remove("hidden");
    activityFeedContainer.innerHTML = "";
    try {
      const profiles = await ctx.getAllUserProfiles();
      const myUid = ctx.getCurrentUser().uid;
      const others = profiles.filter((p) => p.uid !== myUid);

      // Cargar items de cada amigo en paralelo
      const friendsData = await Promise.all(
        others.map(async (profile) => {
          try {
            const [movies, series, books] = await Promise.all([
              ctx.getItemsOnce(profile.uid, "movie"),
              ctx.getItemsOnce(profile.uid, "tv"),
              ctx.getItemsOnce(profile.uid, "book"),
            ]);
            return { profile, movies, series, books };
          } catch {
            return null;
          }
        })
      );

      const validFriendsData = friendsData.filter(Boolean);
      const events = buildGlobalFeed(validFriendsData);

      activityFeedLoading.classList.add("hidden");

      if (events.length === 0) {
        activityFeedContainer.innerHTML = `<p class="empty-state">Todavía no hay actividad reciente de tus amigos.</p>`;
        return;
      }

      ui.renderActivityFeed(activityFeedContainer, events, (item, friendName) => {
        ui.openReadOnlyModal(item, friendName);
      });
    } catch (err) {
      activityFeedLoading.classList.add("hidden");
      activityFeedContainer.innerHTML = `<p class="empty-state">No se pudo cargar la actividad de amigos.</p>`;
    }
  }

  profileSubtabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      openProfileSection(btn.dataset.section, ctx);
    });
  });

  document.getElementById("btn-back-to-friends").addEventListener("click", () => {
    friendDetailEl.classList.add("hidden");
    friendsListEl.classList.remove("hidden");
  });

  document.querySelectorAll(".friend-subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setFriendTab(btn.dataset.friendTab);
    });
  });

  document.querySelectorAll(".friend-filters").forEach((group) => {
    group.addEventListener("click", (e) => {
      const chip = e.target.closest(".friend-chip");
      if (!chip) return;
      setFriendFilter(group.dataset.tab, chip.dataset.status);
    });
  });

  return { openProfileSection };
}
