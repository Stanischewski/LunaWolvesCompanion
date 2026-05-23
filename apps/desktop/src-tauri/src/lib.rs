//! Luna Wolves Agent — ueberwacht die WoW-SavedVariables-Datei und laedt sie
//! bei Aenderungen automatisch zum Gilden-Sync-Endpoint hoch.

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tiny_http::{Header, Response, Server};

// ===================== Konfiguration =====================

/// Vom Nutzer gesetzte Einstellungen. Wird als JSON im App-Konfigordner abgelegt.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Config {
    api_url: String,
    token: String,
    saved_variables_path: String,
    /// Unix-Timestamp des neuesten DKP-Eintrags aus dem letzten erfolgreichen Sync.
    /// Wird vom Server zurückgegeben und hier gespeichert für spätere Optimierungen.
    #[serde(default)]
    last_synced_ts: u64,
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

    let bytes = std::fs::read(&config.saved_variables_path)
        .map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))?;
    let content = String::from_utf8_lossy(&bytes).into_owned();

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
            Ok(body) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();

                // Neuesten Entry-Timestamp aus der Response speichern
                if let Some(ts) = parsed
                    .as_ref()
                    .and_then(|v| v["latestAddonEntryTimestamp"].as_u64())
                    .filter(|&ts| ts > config.last_synced_ts)
                {
                    let state = app.state::<AppState>();
                    let should_save = {
                        let mut conf = state.config.lock().unwrap();
                        if ts > conf.last_synced_ts {
                            conf.last_synced_ts = ts;
                            true
                        } else {
                            false
                        }
                    };
                    if should_save {
                        let conf = state.config.lock().unwrap().clone();
                        let _ = save_config_to_disk(&app, &conf);
                    }
                }

                let pending_count = parsed
                    .as_ref()
                    .and_then(|v| v["pendingWebEntries"].as_array().map(|a| a.len()))
                    .unwrap_or(0);

                if pending_count > 0 {
                    emit_status(
                        &app,
                        "ok",
                        format!(
                            "Synchronisiert. {pending_count} neue DKP-Einträge aus der Web-App."
                        ),
                    );
                    let _ = app.emit("pending-entries", pending_count);
                } else {
                    emit_status(&app, "ok", "Synchronisiert.");
                }
            }
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
    // Bevorzuge den Account, in dem LunaWolves.lua bereits existiert.
    // Erst danach Fallback auf den ersten Ordner mit SavedVariables-Dir.
    let mut fallback: Option<String> = None;
    for entry in std::fs::read_dir(&account_dir).ok()?.flatten() {
        let sv_dir = entry.path().join("SavedVariables");
        let lua_file = sv_dir.join("LunaWolves.lua");
        if lua_file.is_file() {
            return Some(lua_file.to_string_lossy().into_owned());
        }
        if sv_dir.is_dir() && fallback.is_none() {
            fallback = Some(lua_file.to_string_lossy().into_owned());
        }
    }
    fallback
}

/// Durchsucht die ueblichen Installationsorte aller Laufwerke (C–Z) nach einer
/// WoW-Retail-Installation. Pruefungen auf nicht vorhandene Laufwerke/Ordner
/// sind guenstig, daher ist das simple Abklappern der Kandidaten ausreichend.
fn detect_sv_path() -> Option<String> {
    let suffixes = [
        r"Battle.net\World of Warcraft",
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

// ===================== Addon-Verwaltung =====================

/// Findet den Interface/AddOns-Ordner der WoW-Retail-Installation.
fn detect_addons_path() -> Option<PathBuf> {
    let suffixes = [
        r"Battle.net\World of Warcraft",
        "World of Warcraft",
        r"Games\World of Warcraft",
        r"Program Files (x86)\World of Warcraft",
        r"Program Files\World of Warcraft",
    ];
    for drive in 'C'..='Z' {
        for suffix in suffixes {
            let addons = PathBuf::from(format!("{drive}:\\{suffix}"))
                .join("_retail_")
                .join("Interface")
                .join("AddOns");
            if addons.is_dir() {
                return Some(addons);
            }
        }
    }
    None
}

/// Liest die installierte Addon-Version aus der .toc-Datei.
fn read_installed_addon_version(addons_path: &Path) -> Option<String> {
    let toc = addons_path.join("LunaWolves").join("LunaWolves.toc");
    let content = std::fs::read_to_string(toc).ok()?;
    content.lines().find_map(|l| {
        l.strip_prefix("## Version:")
            .map(|v| v.trim().to_string())
    })
}

/// Ruft das neueste Release aus der Addon-Repo ab.
/// Gibt `(version, download_url)` zurueck.
fn fetch_latest_addon_release() -> Result<(String, String), String> {
    let body: serde_json::Value = reqwest::blocking::Client::new()
        .get("https://api.github.com/repos/Stanischewski/LunaWolves/releases/latest")
        .header("User-Agent", "LunaWolves-Agent")
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("GitHub-Anfrage fehlgeschlagen: {e}"))?
        .json()
        .map_err(|e| format!("Antwort ungültig: {e}"))?;

    let tag = body["tag_name"]
        .as_str()
        .ok_or("Kein tag_name in Release")?
        .trim_start_matches('v')
        .to_string();

    let url = body["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(".zip")))
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("Kein .zip-Asset im Release gefunden")?
        .to_string();

    Ok((tag, url))
}

/// Laedt das Addon herunter und entpackt es in den AddOns-Ordner.
fn install_addon_blocking(app: &AppHandle) {
    let addons_path = match detect_addons_path() {
        Some(p) => p,
        None => {
            emit_status(app, "error", "Kein WoW-AddOns-Ordner gefunden.");
            return;
        }
    };
    emit_status(app, "running", "Neueste Addon-Version wird abgefragt …");
    let (version, url) = match fetch_latest_addon_release() {
        Ok(r) => r,
        Err(e) => {
            emit_status(app, "error", e);
            return;
        }
    };
    emit_status(
        app,
        "running",
        format!("LunaWolves v{version} wird heruntergeladen …"),
    );
    let bytes = match reqwest::blocking::Client::new()
        .get(&url)
        .header("User-Agent", "LunaWolves-Agent")
        .send()
        .and_then(|r| r.bytes())
    {
        Ok(b) => b,
        Err(e) => {
            emit_status(app, "error", format!("Download fehlgeschlagen: {e}"));
            return;
        }
    };
    emit_status(app, "running", "Addon wird entpackt …");
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => {
            emit_status(app, "error", format!("Zip-Datei fehlerhaft: {e}"));
            return;
        }
    };
    if let Err(e) = archive.extract(&addons_path) {
        emit_status(app, "error", format!("Entpacken fehlgeschlagen: {e}"));
        return;
    }
    emit_status(
        app,
        "ok",
        format!("LunaWolves v{version} erfolgreich installiert."),
    );
    let _ = app.emit("addon-installed", &version);
}

/// Prueft im Hintergrund ob eine neue Addon-Version verfuegbar ist.
fn spawn_addon_update_check(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok((version, _)) = fetch_latest_addon_release() else {
            return;
        };
        let installed = detect_addons_path()
            .and_then(|p| read_installed_addon_version(&p));
        if installed.as_deref() != Some(version.as_str()) {
            let _ = app.emit("addon-update-available", &version);
        }
    });
}

// ===================== Auto-Update =====================

/// Prueft im Hintergrund ob ein neues Release verfuegbar ist.
/// Sendet `update-available` ans Frontend wenn ja; schlaegt still fehl wenn nicht.
async fn check_for_update(app: AppHandle) {
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };

    #[derive(Clone, Serialize)]
    struct UpdateInfo {
        version: String,
        notes: Option<String>,
    }
    let _ = app.emit(
        "update-available",
        UpdateInfo {
            version: update.version.clone(),
            notes: update.body.clone(),
        },
    );
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

/// Loescht das gespeicherte Token und meldet den Nutzer ab.
#[tauri::command]
fn logout(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.token = String::new();
    save_config_to_disk(&app, &config)?;
    let _ = app.emit("login-changed", false);
    Ok(())
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

/// Laedt das Update herunter und installiert es. Die App startet danach neu.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

/// Liefert die installierte Addon-Version und den AddOns-Pfad ans Frontend.
#[tauri::command]
fn get_addon_status() -> serde_json::Value {
    let addons_path = detect_addons_path();
    let installed_version = addons_path.as_ref().and_then(|p| read_installed_addon_version(p));
    serde_json::json!({
        "installed_version": installed_version,
        "addons_path": addons_path.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Laedt das neueste Addon herunter und installiert es.
#[tauri::command]
fn install_addon(app: AppHandle) {
    std::thread::spawn(move || install_addon_blocking(&app));
}

// ===================== App-Einstieg =====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_settings,
            start_login,
            logout,
            sync_now,
            detect_saved_variables_path,
            install_update,
            get_addon_status,
            install_addon
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
            spawn_watcher(handle.clone());

            // Update-Pruefung beim Start (schlaegt still fehl wenn kein Netz/kein Update).
            tauri::async_runtime::spawn(check_for_update(handle.clone()));

            // Addon-Update-Pruefung beim Start.
            spawn_addon_update_check(handle);

            // Close-to-Tray: X schliesst das Fenster nicht, sondern versteckt es.
            // is_quitting erlaubt dem Tray-Menue-Eintrag "Beenden" das echte Schliessen.
            let is_quitting = Arc::new(AtomicBool::new(false));
            let quit_check = is_quitting.clone();

            let window = app.get_webview_window("main").unwrap();
            let win = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if quit_check.load(Ordering::SeqCst) {
                        return; // echtes Beenden — Fenster normal schliessen lassen
                    }
                    api.prevent_close();
                    let _ = win.hide();
                }
            });

            // System-Tray: Kontextmenue aufbauen und Tray-Icon einrichten.
            let show_item = MenuItem::with_id(app, "show", "Fenster anzeigen", true, None::<&str>)?;
            let sync_item = MenuItem::with_id(app, "sync", "Jetzt synchronisieren", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::new(app)?;
            menu.append(&show_item)?;
            menu.append(&sync_item)?;
            menu.append(&quit_item)?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Luna Wolves Agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "sync" => {
                        let config = app.state::<AppState>().config.lock().unwrap().clone();
                        upload_in_background(app.clone(), config);
                    }
                    "quit" => {
                        // Flag setzen, damit on_window_event das Schliessen durchlaesst,
                        // dann per win.close() beenden — gibt WebView2 Zeit zum Aufraeumen.
                        is_quitting.store(true, Ordering::SeqCst);
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.close();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
