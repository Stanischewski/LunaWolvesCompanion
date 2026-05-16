// Mit `withGlobalTauri: true` (tauri.conf.json) sind die Tauri-APIs unter
// window.__TAURI__ verfuegbar — ohne npm-Import, passend zum Vanilla-Setup.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const apiUrlEl = document.querySelector("#api-url");
const tokenEl = document.querySelector("#token");
const svPathEl = document.querySelector("#sv-path");
const statusEl = document.querySelector("#status");

function setStatus(state, message) {
  statusEl.className = `status status-${state}`;
  statusEl.textContent = message;
}

async function loadConfig() {
  try {
    const config = await invoke("get_config");
    apiUrlEl.value = config.api_url ?? "";
    tokenEl.value = config.token ?? "";
    svPathEl.value = config.saved_variables_path ?? "";
  } catch (err) {
    setStatus("error", `Konfiguration konnte nicht geladen werden: ${err}`);
  }
}

async function saveConfig(event) {
  event.preventDefault();
  try {
    await invoke("save_config", {
      config: {
        api_url: apiUrlEl.value.trim(),
        token: tokenEl.value.trim(),
        saved_variables_path: svPathEl.value.trim(),
      },
    });
    setStatus("ok", "Einstellungen gespeichert.");
  } catch (err) {
    setStatus("error", `Speichern fehlgeschlagen: ${err}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadConfig();

  document.querySelector("#settings-form").addEventListener("submit", saveConfig);
  document.querySelector("#sync-now").addEventListener("click", () => {
    invoke("sync_now").catch((err) => setStatus("error", `Fehler: ${err}`));
  });

  // Statusmeldungen vom Rust-Backend (automatischer und manueller Sync).
  listen("sync-status", (event) => {
    const { state, message } = event.payload;
    setStatus(state, message);
  });
});
