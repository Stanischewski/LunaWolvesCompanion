// Mit `withGlobalTauri: true` (tauri.conf.json) sind die Tauri-APIs unter
// window.__TAURI__ verfuegbar — ohne npm-Import, passend zum Vanilla-Setup.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const loginViewEl = document.querySelector("#login-view");
const appViewEl = document.querySelector("#app-view");

const loginApiUrlEl = document.querySelector("#login-api-url");
const apiUrlEl = document.querySelector("#api-url");
const svPathEl = document.querySelector("#sv-path");
const loginStateEl = document.querySelector("#login-state");

const statusApiUrlEl = document.querySelector("#status-api-url");
const statusSvPathEl = document.querySelector("#status-sv-path");

const statusTabEl = document.querySelector("#tab-status");
const settingsTabEl = document.querySelector("#tab-settings");
const navItems = document.querySelectorAll(".nav-item");

// Login- und Hauptansicht haben je eine eigene Statuszeile; es ist immer nur
// eine sichtbar, daher werden beide gleich gesetzt.
const statusEls = [
  document.querySelector("#login-status"),
  document.querySelector("#status"),
];

function setStatus(state, message) {
  for (const el of statusEls) {
    el.className = `status status-${state}`;
    el.textContent = message;
  }
}

// ===================== Ansicht-Umschaltung =====================

function showView(name) {
  loginViewEl.hidden = name !== "login";
  appViewEl.hidden = name !== "app";
}

function showTab(name) {
  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.tab === name);
  }
  statusTabEl.hidden = name !== "status";
  settingsTabEl.hidden = name !== "settings";
}

// Setzt das Login-Abzeichen und schaltet zwischen Login- und Hauptansicht um.
function applyLoginState(loggedIn) {
  loginStateEl.textContent = loggedIn ? "Angemeldet" : "Nicht angemeldet";
  loginStateEl.className = `badge ${loggedIn ? "badge-in" : "badge-out"}`;
  showView(loggedIn ? "app" : "login");
}

// ===================== Konfiguration =====================

function currentSettings() {
  return {
    api_url: apiUrlEl.value.trim(),
    saved_variables_path: svPathEl.value.trim(),
  };
}

async function loadAddonStatus() {
  try {
    const status = await invoke("get_addon_status");
    const el = document.querySelector("#addon-installed-version");
    if (el) el.textContent = status.installed_version ?? "Nicht installiert";
  } catch (_) {}
}

async function loadConfig() {
  try {
    const config = await invoke("get_config");
    const apiUrl = config.api_url ?? "";
    const svPath = config.saved_variables_path ?? "";

    loginApiUrlEl.value = apiUrl;
    apiUrlEl.value = apiUrl;
    svPathEl.value = svPath;
    statusApiUrlEl.textContent = apiUrl || "—";
    statusSvPathEl.textContent = svPath || "—";

    applyLoginState(config.logged_in === true);
  } catch (err) {
    setStatus("error", `Konfiguration konnte nicht geladen werden: ${err}`);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    await invoke("save_settings", { settings: currentSettings() });
    statusApiUrlEl.textContent = apiUrlEl.value.trim() || "—";
    statusSvPathEl.textContent = svPathEl.value.trim() || "—";
    setStatus("ok", "Einstellungen gespeichert.");
  } catch (err) {
    setStatus("error", `Speichern fehlgeschlagen: ${err}`);
  }
}

// ===================== Aktionen =====================

async function startLogin() {
  try {
    // Das API-URL-Feld der Login-Ansicht ist hier die Quelle.
    apiUrlEl.value = loginApiUrlEl.value.trim();
    // Erst speichern, damit der Login die aktuelle API-URL verwendet.
    await invoke("save_settings", { settings: currentSettings() });
    await invoke("start_login");
  } catch (err) {
    setStatus("error", `Login konnte nicht gestartet werden: ${err}`);
  }
}

async function detectPath() {
  setStatus("running", "Suche WoW-Installation …");
  try {
    const path = await invoke("detect_saved_variables_path");
    svPathEl.value = path;
    setStatus("ok", "SavedVariables-Ordner gefunden. Bitte Einstellungen speichern.");
  } catch (err) {
    setStatus("error", `${err}`);
  }
}

// ===================== Start =====================

window.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  loadAddonStatus();
  showTab("status");

  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#login-btn").addEventListener("click", startLogin);
  document.querySelector("#detect-btn").addEventListener("click", detectPath);
  document.querySelector("#sync-now").addEventListener("click", () => {
    invoke("sync_now").catch((err) => setStatus("error", `Fehler: ${err}`));
  });

  document.querySelector("#install-addon-btn").addEventListener("click", () => {
    document.querySelector("#install-addon-btn").disabled = true;
    invoke("install_addon").catch((err) => {
      setStatus("error", `Addon-Installation fehlgeschlagen: ${err}`);
      document.querySelector("#install-addon-btn").disabled = false;
    });
  });

  document.querySelector("#update-btn").addEventListener("click", async () => {
    setStatus("running", "Update wird heruntergeladen und installiert …");
    document.querySelector("#update-btn").disabled = true;
    try {
      await invoke("install_update");
    } catch (err) {
      setStatus("error", `Update fehlgeschlagen: ${err}`);
      document.querySelector("#update-btn").disabled = false;
    }
  });

  document.querySelector("#logout-btn").addEventListener("click", async () => {
    try {
      await invoke("logout");
    } catch (err) {
      setStatus("error", `Abmelden fehlgeschlagen: ${err}`);
    }
  });

  for (const item of navItems) {
    item.addEventListener("click", () => showTab(item.dataset.tab));
  }

  // Statusmeldungen vom Rust-Backend (Sync- und Login-Fortschritt).
  listen("sync-status", (event) => {
    const { state, message } = event.payload;
    setStatus(state, message);
  });
  // Aenderungen am Login-Status (nach erfolgreicher Anmeldung).
  listen("login-changed", (event) => {
    applyLoginState(event.payload === true);
  });
  // Neue Addon-Version auf GitHub gefunden.
  listen("addon-update-available", (event) => {
    const version = event.payload;
    const latest = document.querySelector("#addon-latest-version");
    const btn = document.querySelector("#install-addon-btn");
    if (latest) latest.textContent = `v${version}`;
    if (btn) btn.hidden = false;
  });

  // Addon wurde erfolgreich installiert.
  listen("addon-installed", (event) => {
    const version = event.payload;
    const installed = document.querySelector("#addon-installed-version");
    const latest = document.querySelector("#addon-latest-version");
    const btn = document.querySelector("#install-addon-btn");
    if (installed) installed.textContent = `v${version}`;
    if (latest) latest.textContent = `v${version} (aktuell)`;
    if (btn) { btn.hidden = true; btn.disabled = false; }
  });

  // Neues Release auf GitHub gefunden.
  listen("update-available", (event) => {
    const { version } = event.payload;
    const banner = document.querySelector("#update-banner");
    const text = document.querySelector("#update-text");
    if (banner && text) {
      text.textContent = `Update verfügbar: v${version}`;
      banner.hidden = false;
    }
  });

  // Ausstehende Web-DKP-Eintraege, die noch nicht im Addon angekommen sind.
  listen("pending-entries", (event) => {
    const count = event.payload;
    const banner = document.querySelector("#pending-banner");
    const text = document.querySelector("#pending-text");
    if (banner && text) {
      text.textContent = `${count} neue DKP-Eintrag${count === 1 ? "" : "einträge"} aus der Web-App — werden beim nächsten WoW-Login geladen.`;
      banner.hidden = false;
    }
  });
});
