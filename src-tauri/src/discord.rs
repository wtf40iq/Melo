//! Discord Rich Presence через локальный IPC-канал Discord.
//! Никаких сетевых запросов: только named pipe на этом компьютере.

use serde_json::{json, Value};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const APP_ID: &str = "1570402325393178705";

#[derive(Clone, Default)]
struct Activity {
    title: Option<String>,
    artist: Option<String>,
    playing: bool,
    position: f64,
}

static ENABLED: AtomicBool = AtomicBool::new(false);
static ACTIVITY: Mutex<Option<Activity>> = Mutex::new(None);

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn clip(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= 128 { s.to_string() } else { s.chars().take(127).collect::<String>() + "…" }
}

fn frame(file: &mut std::fs::File, op: u32, body: &str) -> std::io::Result<()> {
    file.write_all(&op.to_le_bytes())?;
    file.write_all(&(body.len() as u32).to_le_bytes())?;
    file.write_all(body.as_bytes())?;
    file.flush()
}

#[cfg(windows)]
fn connect() -> Option<std::fs::File> {
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{i}");
        if let Ok(mut f) = std::fs::OpenOptions::new().read(true).write(true).open(path) {
            let hello = json!({ "v": 1, "client_id": APP_ID }).to_string();
            if frame(&mut f, 0, &hello).is_ok() {
                return Some(f);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn connect() -> Option<std::fs::File> {
    None
}

fn payload(act: &Activity) -> Value {
    let title = act.title.as_deref().unwrap_or("").trim();
    let artist = act.artist.as_deref().unwrap_or("").trim();
    if title.is_empty() {
        return json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": null }, "nonce": now_ms().to_string() });
    }
    let mut activity = json!({
        "details": clip(title),
        "state": clip(if artist.is_empty() { "Melo" } else { artist }),
        "type": 2,
    });
    if act.playing {
        let start = now_ms().saturating_sub((act.position.max(0.0) * 1000.0) as u128);
        activity["timestamps"] = json!({ "start": start });
    }
    json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity }, "nonce": now_ms().to_string() })
}

/// Запускается один раз при старте приложения.
pub fn start() {
    std::thread::spawn(|| {
        let mut conn: Option<std::fs::File> = None;
        loop {
            if !ENABLED.load(Ordering::Relaxed) {
                if let Some(mut f) = conn.take() {
                    let clear = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": null }, "nonce": now_ms().to_string() });
                    let _ = frame(&mut f, 1, &clear.to_string());
                }
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            let act = ACTIVITY.lock().ok().and_then(|a| a.clone());
            let Some(act) = act else {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            };
            if conn.is_none() {
                conn = connect();
            }
            if let Some(f) = conn.as_mut() {
                if frame(f, 1, &payload(&act).to_string()).is_err() {
                    conn = None;
                }
            }
            std::thread::sleep(Duration::from_secs(15));
        }
    });
}

#[tauri::command]
pub fn discord_update(enabled: bool, title: Option<String>, artist: Option<String>, playing: bool, position: f64, duration: f64) {
    let _ = duration;
    ENABLED.store(enabled, Ordering::Relaxed);
    if let Ok(mut a) = ACTIVITY.lock() {
        *a = Some(Activity { title, artist, playing, position });
    }
}
