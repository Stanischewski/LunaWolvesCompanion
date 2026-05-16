//! Luna Wolves Agent — ueberwacht die WoW-SavedVariables-Datei und laedt sie
//! bei Aenderungen automatisch zum Gilden-Sync-Endpoint hoch.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tiny_http::{Header, Response, Server};

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
        return Err("Nicht angemeldet oder keine API-URL gesetzt.".into());
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

            let config = {
                let state = app.state::<AppState>();
                let guard = state.config.lock().unwrap();
                guard.clone()
            };
            if config.saved_variables_path.is_empty() {
                continue;
            }

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

// ===================== Battle.net-Login (Loopback-OAuth) =====================

/// Extrahiert den Wert des `token`-Query-Parameters aus einer URL wie "/?token=…".
fn extract_token(url: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token=").map(str::to_string))
}

/// Fuehrt den Login durch: startet einen lokalen Loopback-HTTP-Server, oeffnet
/// den Browser auf den API-Startpunkt und wartet auf das zurueckgeleitete Token.
fn run_login_flow(app: &AppHandle, api_url: &str) -> Result<String, String> {
    // Lokaler HTTP-Server auf 127.0.0.1; Port 0 laesst das OS einen freien waehlen.
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("Lokaler Server konnte nicht gestartet werden: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("Server-Adresse unbekannt")?
        .port();

    // Browser auf die API schicken — der Port sagt der API, wohin sie das
    // fertige Token zurueckleiten soll.
    let auth_url = format!("{}/auth/desktop?port={}", api_url.trim_end_matches('/'), port);
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("Browser konnte nicht geoeffnet werden: {e}"))?;

    // Auf die eine Rueckleitung warten (hoechstens 5 Minuten).
    let request = server
        .recv_timeout(Duration::from_secs(300))
        .map_err(|e| format!("Fehler beim Warten auf die Anmeldung: {e}"))?
        .ok_or("Zeitueberschreitung — keine Anmeldung empfangen.")?;

    let token = extract_token(request.url());

    // Dem Browser eine Abschlussseite zeigen.
    let page = if token.is_some() {
        "<!doctype html><meta charset=utf-8><title>Luna Wolves Agent</title>\
         <body style='font-family:sans-serif;background:#09090b;color:#e4e4e7;padding:48px'>\
         <h2>Anmeldung erfolgreich</h2><p>Du kannst dieses Fenster schliessen.</p></body>"
    } else {
        "<!doctype html><meta charset=utf-8><title>Luna Wolves Agent</title>\
         <body style='font-family:sans-serif;background:#09090b;color:#e4e4e7;padding:48px'>\
         <h2>Anmeldung fehlgeschlagen</h2><p>Es wurde kein Token empfangen.</p></body>"
    };
    let header = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .expect("gueltiger Header");
    let _ = request.respond(Response::from_string(page).with_header(header));

    token.ok_or_else(|| "Es wurde kein Token zurueckgeleitet.".to_string())
}

// ===================== WoW-Pfad-Erkennung =====================

/// Sucht innerhalb einer WoW-Installation den ersten Account-Ordner mit einem
/// `SavedVariables`-Verzeichnis und schlaegt den vollen Pfad zur LunaWolvesDB.lua
/// vor. Die Datei selbst muss noch nicht existieren — sie wird erst vom Addon
/// angelegt; entscheidend ist, dass der SavedVariables-Ordner vorhanden ist.
fn sv_path_in_install(install: &Path) -> Option<String> {
    // WoW-Retail-Layout: <install>/_retail_/WTF/Account/<ACCOUNT>/SavedVariables
    let account_dir = install.join("_retail_").join("WTF").join("Account");
    if !account_dir.is_dir() {
        return None;
    }
    for entry in std::fs::read_dir(&account_dir).ok()?.flatten() {
        let saved_variables = entry.path().join("SavedVariables");
        if saved_variables.is_dir() {
            return Some(
                saved_variables
                    .join("LunaWolvesDB.lua")
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    None
}

/// Durchsucht die ueblichen Installationsorte aller Laufwerke (C–Z) nach einer
/// WoW-Retail-Installation. Pruefungen auf nicht vorhandene Laufwerke/Ordner
/// sind guenstig, daher ist das simple Abklappern der Kandidaten ausreichend.
fn detect_sv_path() -> Option<String> {
    let suffixes = [
        "World of Warcraft",
        r"Games\World of Warcraft",
        r"Program Files (x86)\World of Warcraft",
        r"Program Files\World of Warcraft",
    ];
    for drive in 'C'..='Z' {
        for suffix in suffixes {
            let root = format!("{drive}:\\{suffix}");
            if let Some(path) = sv_path_in_install(Path::new(&root)) {
                return Some(path);
            }
        }
    }
    None
}

// ===================== Tauri Commands =====================
// Commands sind Rust-Funktionen, die das Frontend per `invoke("name", ...)` aufruft.

/// Sicht auf die Konfiguration fuer das Frontend — ohne das rohe Token.
#[derive(Serialize)]
struct ConfigView {
    api_url: String,
    saved_variables_path: String,
    logged_in: bool,
}

/// Vom Einstellungsformular geschickte Felder.
#[derive(Deserialize)]
struct Settings {
    api_url: String,
    saved_variables_path: String,
}

/// Liefert API-URL, Dateipfad und Login-Status ans Frontend.
#[tauri::command]
fn get_config(state: State<AppState>) -> ConfigView {
    let config = state.config.lock().unwrap();
    ConfigView {
        api_url: config.api_url.clone(),
        saved_variables_path: config.saved_variables_path.clone(),
        logged_in: !config.token.is_empty(),
    }
}

/// Speichert API-URL und Dateipfad; das Login-Token bleibt unveraendert.
#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.api_url = settings.api_url;
    config.saved_variables_path = settings.saved_variables_path;
    save_config_to_disk(&app, &config)
}

/// Startet den Battle.net-Login (vollautomatischer Loopback-Flow).
#[tauri::command]
fn start_login(app: AppHandle, state: State<AppState>) {
    let api_url = state.config.lock().unwrap().api_url.trim().to_string();
    if api_url.is_empty() {
        emit_status(&app, "error", "Bitte zuerst die API-URL eintragen und speichern.");
        return;
    }
    std::thread::spawn(move || {
        emit_status(&app, "running", "Browser geoeffnet — bitte bei Battle.net anmelden …");
        match run_login_flow(&app, &api_url) {
            Ok(token) => {
                let saved = {
                    let state = app.state::<AppState>();
                    let mut config = state.config.lock().unwrap();
                    config.token = token;
                    save_config_to_disk(&app, &config)
                };
                match saved {
                    Ok(()) => {
                        emit_status(&app, "ok", "Erfolgreich angemeldet.");
                        let _ = app.emit("login-changed", true);
                    }
                    Err(err) => {
                        emit_status(&app, "error", format!("Token speichern fehlgeschlagen: {err}"))
                    }
                }
            }
            Err(err) => emit_status(&app, "error", err),
        }
    });
}

/// Stoesst einen sofortigen Upload an ("Jetzt synchronisieren").
#[tauri::command]
fn sync_now(app: AppHandle, state: State<AppState>) {
    let config = state.config.lock().unwrap().clone();
    upload_in_background(app, config);
}

/// Sucht automatisch nach dem SavedVariables-Pfad ("Automatisch suchen").
#[tauri::command]
fn detect_saved_variables_path() -> Result<String, String> {
    detect_sv_path()
        .ok_or_else(|| "Keine WoW-Installation gefunden. Bitte den Pfad manuell eintragen.".into())
}

// ===================== App-Einstieg =====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_settings,
            start_login,
            sync_now,
            detect_saved_variables_path
        ])
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
