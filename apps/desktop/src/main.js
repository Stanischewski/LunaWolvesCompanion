// Mit `withGlobalTauri: true` (tauri.conf.json) sind die Tauri-APIs unter
// window.__TAURI__ verfuegbar — ohne npm-Import, passend zum Vanilla-Setup.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const apiUrlEl = document.querySelector("#api-url");
const svPathEl = document.querySelector("#sv-path");
const loginStateEl = document.querySelector("#login-state");
const statusEl = document.querySelector("#status");

function setStatus(state, message) {
  statusEl.className = `status status-${state}`;
  statusEl.textContent = message;
}

function setLoginState(loggedIn) {
  loginStateEl.textContent = loggedIn ? "Angemeldet" : "Nicht angemeldet";
  loginStateEl.className = `badge ${loggedIn ? "badge-in" : "badge-out"}`;
}

function currentSettings() {
  return {
    api_url: apiUrlEl.value.trim(),
    saved_variables_path: svPathEl.value.trim(),
  };
}

async function loadConfig() {
  try {
    const config = await invoke("get_config");
    apiUrlEl.value = config.api_url ?? "";
    svPathEl.value = config.saved_variables_path ?? "";
    setLoginState(config.logged_in === true);
  } catch (err) {
    setStatus("error", `Konfiguration konnte nicht geladen werden: ${err}`);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    await invoke("save_settings", { settings: currentSettings() });
    setStatus("ok", "Einstellungen gespeichert.");
  } catch (err) {
    setStatus("error", `Speichern fehlgeschlagen: ${err}`);
  }
}

async function startLogin() {
  try {
    // Erst speichern, damit der Login die aktuelle API-URL verwendet.
    await invoke("save_settings", { settings: currentSettings() });
    await invoke("start_login");
  } catch (err) {
    setStatus("error", `Login konnte nicht gestartet werden: ${err}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadConfig();

  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#login-btn").addEventListener("click", startLogin);
  document.querySelector("#sync-now").addEventListener("click", () => {
    invoke("sync_now").catch((err) => setStatus("error", `Fehler: ${err}`));
  });

  // Statusmeldungen vom Rust-Backend (Sync- und Login-Fortschritt).
  listen("sync-status", (event) => {
    const { state, message } = event.payload;
    setStatus(state, message);
  });
  // Aenderungen am Login-Status (nach erfolgreicher Anmeldung).
  listen("login-changed", (event) => {
    setLoginState(event.payload === true);
  });
});
