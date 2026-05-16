//! Luna Wolves Agent — ueberwacht die WoW-SavedVariables-Datei und laedt sie
//! bei Aenderungen automatisch zum Gilden-Sync-Endpoint hoch.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// ===================== Konfiguration =====================

/// Vom Nutzer gesetzte Einstellungen. Wird als JSON im App-Konfigordner abgelegt.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Config {
    api_url: String,
    token: String,
    saved_variables_path: String,
}

/// Geteilter App-Zustand. Tauri haelt davon genau eine Instanz (`app.manage`);
/// Commands und der Hintergrund-Thread greifen ueber einen Mutex darauf zu.
struct AppState {
    config: Mutex<Config>,
}

/// Pfad zur config.json im plattformueblichen Konfigurationsverzeichnis.
fn config_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("config.json"))
}

/// Laedt die Konfiguration von der Platte; fehlt sie, gibt es leere Defaults.
fn load_config(app: &AppHandle) -> Config {
    config_file_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Config>(&text).ok())
        .unwrap_or_default()
}

/// Schreibt die Konfiguration als JSON auf die Platte.
fn save_config_to_disk(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_file_path(app).ok_or("Konfigurationsverzeichnis nicht gefunden")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ===================== Upload =====================

/// Liest die SavedVariables-Datei und schickt sie roh an den Sync-Endpoint.
/// Laeuft immer in einem eigenen Thread, da `reqwest::blocking` nicht innerhalb
/// eines async-Kontextes aufgerufen werden darf.
fn upload(config: &Config) -> Result<String, String> {
    if config.api_url.is_empty() || config.token.is_empty() {
        return Err("API-URL und Token muessen gesetzt sein.".into());
    }
    if config.saved_variables_path.is_empty() {
        return Err("Es ist keine SavedVariables-Datei konfiguriert.".into());
    }

    let content = std::fs::read_to_string(&config.saved_variables_path)
        .map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))?;

    let url = format!(
        "{}/api/v1/sync/addon-data",
        config.api_url.trim_end_matches('/')
    );

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", config.token))
        .header("Content-Type", "text/plain")
        .body(content)
        .send()
        .map_err(|e| format!("Anfrage fehlgeschlagen: {e}"))?;

    let status = response.status();
    let body = response.text().unwrap_or_default();
    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("Server antwortete mit {status}: {body}"))
    }
}

// ===================== Status-Events ans Frontend =====================

/// Nutzlast des Events "sync-status", auf das das Frontend lauscht.
#[derive(Clone, Serialize)]
struct SyncStatus {
    state: String, // "running" | "ok" | "error"
    message: String,
}

/// Schickt eine Statusmeldung an das UI.
fn emit_status(app: &AppHandle, state: &str, message: impl Into<String>) {
    let payload = SyncStatus {
        state: state.to_string(),
        message: message.into(),
    };
    let _ = app.emit("sync-status", payload);
}

/// Fuehrt einen Upload in einem eigenen Thread aus und meldet das Ergebnis per Event.
fn upload_in_background(app: AppHandle, config: Config) {
    std::thread::spawn(move || {
        emit_status(&app, "running", "Synchronisiere …");
        match upload(&config) {
            Ok(body) => emit_status(&app, "ok", format!("Synchronisiert. {body}")),
            Err(err) => emit_status(&app, "error", err),
        }
    });
}

// ===================== Hintergrund-Ueberwachung =====================

/// Abstand zwischen zwei Pruefungen der Datei.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Startet einen Thread, der die SavedVariables-Datei dauerhaft beobachtet.
/// Statt eines Filesystem-Watchers wird periodisch die Aenderungszeit geprueft —
/// simpel und robust, da sich SavedVariables nur selten aendern.
fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_seen: Option<SystemTime> = None;

        loop {
            std::thread::sleep(POLL_INTERVAL);

            // Aktuelle Konfiguration aus dem geteilten Zustand kopieren.
            let config = {
                let state = app.state::<AppState>();
                let guard = state.config.lock().unwrap();
                guard.clone()
            };
            if config.saved_variables_path.is_empty() {
                continue;
            }

            // Aenderungszeit lesen; existiert die Datei nicht, spaeter erneut versuchen.
            let modified = match std::fs::metadata(&config.saved_variables_path)
                .and_then(|meta| meta.modified())
            {
                Ok(time) => time,
                Err(_) => continue,
            };

            if last_seen == Some(modified) {
                continue; // unveraendert
            }

            let first_run = last_seen.is_none();
            last_seen = Some(modified);

            // Beim ersten Durchlauf nur den Ausgangswert merken — sonst wuerde
            // jeder App-Start sofort einen Upload ausloesen.
            if first_run {
                continue;
            }

            upload_in_background(app.clone(), config);
        }
    });
}

// ===================== Tauri Commands =====================
// Commands sind Rust-Funktionen, die das Frontend per `invoke("name", ...)` aufruft.

/// Liefert die gespeicherte Konfiguration ans Frontend.
#[tauri::command]
fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

/// Speichert neue Einstellungen — auf der Platte und im geteilten Zustand.
#[tauri::command]
fn save_config(app: AppHandle, state: State<AppState>, config: Config) -> Result<(), String> {
    save_config_to_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

/// Stoesst einen sofortigen Upload an ("Jetzt synchronisieren").
#[tauri::command]
fn sync_now(app: AppHandle, state: State<AppState>) {
    let config = state.config.lock().unwrap().clone();
    upload_in_background(app, config);
}

// ===================== App-Einstieg =====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_config, save_config, sync_now])
        .setup(|app| {
            // AppHandle: ein klonbarer, thread-sicherer Griff auf die laufende App.
            let handle = app.handle().clone();

            // Gespeicherte Konfiguration laden und als geteilten Zustand registrieren.
            let config = load_config(&handle);
            app.manage(AppState {
                config: Mutex::new(config),
            });

            // Datei-Ueberwachung im Hintergrund starten.
            spawn_watcher(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
