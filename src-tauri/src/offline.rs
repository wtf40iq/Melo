//! Офлайн-плейлисты: папка «Offline» рядом с Melo.exe, одна подпапка = один плейлист.
//! Внутри — любые аудиофайлы, необязательная обложка cover.jpg/png/webp и .melo.json
//! с названием и описанием. Папки можно создавать и наполнять и вручную, и из приложения.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

use lofty::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav", "webm", "wma", "alac", "aiff", "aif"];
const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "webp"];
const META: &str = ".melo.json";

pub fn root() -> PathBuf {
    let r = if super::is_portable() {
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.join("Offline")))
            .unwrap_or_else(|| super::data_root().join("Offline"))
    } else {
        super::data_root().join("Offline")
    };
    let _ = fs::create_dir_all(&r);
    r
}

fn ext(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase()
}

/// Имя папки или файла — строго одна часть пути, без «..» и разделителей.
fn safe_name(s: &str) -> Result<&str, String> {
    if s.is_empty() || s == "." || s == ".." || s.contains(['/', '\\', ':']) {
        return Err("Недопустимое имя".into());
    }
    Ok(s)
}

fn pl_dir(id: &str) -> Result<PathBuf, String> {
    let d = root().join(safe_name(id)?);
    if !d.is_dir() {
        return Err("Офлайн-плейлист не найден".into());
    }
    Ok(d)
}

/// Путь вида «плейлист/файл» внутри папки Offline (для локального сервера).
pub fn resolve(rel: &str) -> Option<PathBuf> {
    let mut it = rel.splitn(2, '/');
    let (a, b) = (it.next()?, it.next()?);
    let p = root().join(safe_name(a).ok()?).join(safe_name(b).ok()?);
    p.is_file().then_some(p)
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct Meta {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

fn read_meta(dir: &Path) -> Meta {
    fs::read(dir.join(META)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn cover_file(dir: &Path) -> Option<String> {
    let mut imgs: Vec<String> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_file() && IMAGE_EXT.contains(&ext(&e.path()).as_str()))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();
    imgs.sort_by_key(|n| (!n.to_lowercase().starts_with("cover"), !n.to_lowercase().starts_with("folder"), n.clone()));
    imgs.into_iter().next()
}

#[derive(Serialize, Clone)]
pub struct TrackInfo {
    file: String,
    title: String,
    artist: String,
    album: Option<String>,
    duration: u64,
    has_cover: bool,
}

static META_CACHE: Mutex<Option<HashMap<PathBuf, (SystemTime, TrackInfo)>>> = Mutex::new(None);

fn track_info(path: &Path) -> TrackInfo {
    let mtime = fs::metadata(path).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    if let Some((t, info)) = META_CACHE.lock().unwrap().as_ref().and_then(|c| c.get(path)) {
        if *t == mtime {
            return info.clone();
        }
    }
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let stem = path.file_stem().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    // Без тегов: «Исполнитель - Название.mp3»
    let (mut artist, mut title) = match stem.split_once(" - ") {
        Some((a, t)) => (a.trim().to_string(), t.trim().to_string()),
        None => (String::new(), stem.clone()),
    };
    let mut album = None;
    let mut duration = 0;
    let mut has_cover = false;
    if let Ok(tagged) = lofty::read_from_path(path) {
        duration = tagged.properties().duration().as_secs();
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if let Some(t) = tag.title().filter(|t| !t.trim().is_empty()) {
                title = t.to_string();
            }
            if let Some(a) = tag.artist().filter(|a| !a.trim().is_empty()) {
                artist = a.to_string();
            }
            album = tag.album().map(|a| a.to_string()).filter(|a| !a.trim().is_empty());
            has_cover = !tag.pictures().is_empty();
        }
    }
    if artist.is_empty() {
        artist = "Неизвестный исполнитель".into();
    }
    let info = TrackInfo { file, title, artist, album, duration, has_cover };
    META_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(path.to_path_buf(), (mtime, info.clone()));
    info
}

fn audio_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && AUDIO_EXT.contains(&ext(p).as_str())).collect())
        .unwrap_or_default();
    // Сначала новые — как в «Моей музыке»
    v.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.created().or_else(|_| m.modified())).unwrap_or(SystemTime::UNIX_EPOCH)));
    v
}

#[derive(Serialize)]
pub struct PlaylistInfo {
    id: String,
    title: String,
    description: String,
    cover: Option<String>,
    count: usize,
}

fn info_of(dir: &Path) -> Option<PlaylistInfo> {
    let id = dir.file_name()?.to_str()?.to_string();
    let meta = read_meta(dir);
    let files = audio_files(dir);
    // Нет картинки — берём обложку из тегов первого трека
    let cover = cover_file(dir).or_else(|| files.iter().find(|f| track_info(f).has_cover).and_then(|f| f.file_name()?.to_str().map(str::to_string)));
    Some(PlaylistInfo {
        title: meta.title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| id.clone()),
        description: meta.description.unwrap_or_default(),
        cover,
        count: files.len(),
        id,
    })
}

#[tauri::command]
pub fn offline_root_path() -> String {
    root().display().to_string()
}

#[tauri::command]
pub fn offline_list() -> Vec<PlaylistInfo> {
    let mut v: Vec<PlaylistInfo> = fs::read_dir(root())
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).filter_map(|p| info_of(&p)).collect())
        .unwrap_or_default();
    v.sort_by_key(|p| p.title.to_lowercase());
    v
}

#[tauri::command]
pub fn offline_playlist(id: String) -> Result<PlaylistInfo, String> {
    info_of(&pl_dir(&id)?).ok_or("Офлайн-плейлист не найден".into())
}

#[tauri::command]
pub async fn offline_tracks(id: String) -> Result<Vec<TrackInfo>, String> {
    let dir = pl_dir(&id)?;
    tauri::async_runtime::spawn_blocking(move || audio_files(&dir).iter().map(|f| track_info(f)).collect())
        .await
        .map_err(|e| e.to_string())
}

fn folder_name(title: &str) -> String {
    let clean: String = title
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches('.').trim().to_string();
    if clean.is_empty() { "Плейлист".into() } else { clean.chars().take(80).collect() }
}

#[tauri::command]
pub fn offline_create(title: String, description: String) -> Result<String, String> {
    let base = folder_name(&title);
    let mut name = base.clone();
    let mut n = 2;
    while root().join(&name).exists() {
        name = format!("{base} ({n})");
        n += 1;
    }
    let dir = root().join(&name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let meta = Meta { title: Some(title.trim().to_string()), description: Some(description.trim().to_string()) };
    fs::write(dir.join(META), serde_json::to_vec_pretty(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
pub fn offline_update(id: String, title: String, description: String) -> Result<(), String> {
    let dir = pl_dir(&id)?;
    let meta = Meta { title: Some(title.trim().to_string()), description: Some(description.trim().to_string()) };
    fs::write(dir.join(META), serde_json::to_vec_pretty(&meta).unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn offline_delete_playlist(id: String) -> Result<(), String> {
    fs::remove_dir_all(pl_dir(&id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn offline_delete_track(id: String, file: String) -> Result<(), String> {
    let p = pl_dir(&id)?.join(safe_name(&file)?);
    fs::remove_file(p).map_err(|e| e.to_string())
}

fn copy_into(dir: &Path, src: &Path) -> Option<()> {
    let name = src.file_name()?;
    let mut dst = dir.join(name);
    if dst.exists() {
        let stem = src.file_stem()?.to_string_lossy().to_string();
        let e = ext(src);
        let mut n = 2;
        while dst.exists() {
            dst = dir.join(format!("{stem} ({n}).{e}"));
            n += 1;
        }
    }
    fs::copy(src, dst).ok().map(|_| ())
}

fn dialog(app: &AppHandle) -> rfd::AsyncFileDialog {
    let d = rfd::AsyncFileDialog::new();
    match app.get_webview_window("main") {
        Some(w) => d.set_parent(&w),
        None => d,
    }
}

/// Выбрать файлы на компьютере и скопировать их в плейлист.
#[tauri::command]
pub async fn offline_add_files(app: AppHandle, id: String) -> Result<usize, String> {
    let dir = pl_dir(&id)?;
    let Some(files) = dialog(&app).set_title("Добавить музыку").add_filter("Музыка", AUDIO_EXT).pick_files().await else {
        return Ok(0);
    };
    let paths: Vec<PathBuf> = files.iter().map(|f| f.path().to_path_buf()).collect();
    tauri::async_runtime::spawn_blocking(move || paths.iter().filter(|p| copy_into(&dir, p).is_some()).count())
        .await
        .map_err(|e| e.to_string())
}

/// Добавить файлы по путям (перетаскивание в окно).
#[tauri::command]
pub async fn offline_add_paths(id: String, paths: Vec<String>) -> Result<usize, String> {
    let dir = pl_dir(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Перетащили папку — берём музыку из неё и вложенных папок
        fn walk(p: PathBuf, out: &mut Vec<PathBuf>, depth: u8) {
            if p.is_dir() {
                if depth > 4 { return; }
                if let Ok(rd) = fs::read_dir(&p) {
                    for e in rd.flatten() { walk(e.path(), out, depth + 1); }
                }
            } else if p.is_file() && AUDIO_EXT.contains(&ext(&p).as_str()) {
                out.push(p);
            }
        }
        let mut files = Vec::new();
        for p in paths { walk(PathBuf::from(p), &mut files, 0); }
        files.iter().filter(|p| copy_into(&dir, p).is_some()).count()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Выбрать картинку обложки.
#[tauri::command]
pub async fn offline_pick_cover(app: AppHandle, id: String) -> Result<bool, String> {
    let dir = pl_dir(&id)?;
    let Some(f) = dialog(&app).set_title("Обложка плейлиста").add_filter("Картинка", IMAGE_EXT).pick_file().await else {
        return Ok(false);
    };
    let src = f.path().to_path_buf();
    for e in IMAGE_EXT {
        let _ = fs::remove_file(dir.join(format!("cover.{e}")));
    }
    let e = ext(&src);
    fs::copy(&src, dir.join(format!("cover.{}", if e == "jpeg" { "jpg" } else { &e }))).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Открыть папку Offline (или папку плейлиста) в проводнике.
#[tauri::command]
pub fn offline_open(id: Option<String>) -> Result<(), String> {
    let p = match id {
        Some(id) => pl_dir(&id)?,
        None => root(),
    };
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(&p).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&p).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Отдача файлов локальному плееру ----------

fn mime(e: &str) -> &'static str {
    match e {
        "mp3" => "audio/mpeg",
        "m4a" | "aac" | "alac" => "audio/mp4",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "webm" => "audio/webm",
        "aiff" | "aif" => "audio/aiff",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Отдаёт файл с поддержкой перемотки (Range).
pub fn serve_file(req: tiny_http::Request, path: &Path, headers: Vec<tiny_http::Header>) {
    let Ok(mut f) = fs::File::open(path) else {
        let _ = req.respond(tiny_http::Response::empty(404));
        return;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .and_then(|h| h.value.as_str().strip_prefix("bytes=").map(str::to_string))
        .and_then(|r| {
            let (a, b) = r.split_once('-')?;
            let a: u64 = a.trim().parse().ok()?;
            let b: u64 = b.trim().parse().unwrap_or(len.saturating_sub(1)).min(len.saturating_sub(1));
            (a <= b && a < len).then_some((a, b))
        });
    let mut hs = headers;
    hs.extend(super::hdr("Content-Type", mime(&ext(path))));
    hs.extend(super::hdr("Accept-Ranges", "bytes"));
    let (status, start, size) = match range {
        Some((a, b)) => {
            hs.extend(super::hdr("Content-Range", &format!("bytes {a}-{b}/{len}")));
            (206, a, b - a + 1)
        }
        None => (200, 0, len),
    };
    if f.seek(SeekFrom::Start(start)).is_err() {
        let _ = req.respond(tiny_http::Response::empty(500));
        return;
    }
    let r = tiny_http::Response::new(tiny_http::StatusCode(status), hs, f.take(size), Some(size as usize), None);
    let _ = req.respond(r);
}

/// Обложка: картинка из папки или встроенная в теги трека.
pub fn serve_cover(req: tiny_http::Request, path: &Path, headers: Vec<tiny_http::Header>) {
    if IMAGE_EXT.contains(&ext(path).as_str()) {
        return serve_file(req, path, headers);
    }
    let pic = lofty::read_from_path(path).ok().and_then(|t| {
        let tag = t.primary_tag().or_else(|| t.first_tag())?;
        let p = tag.pictures().first()?;
        Some((p.data().to_vec(), p.mime_type().map(|m| m.as_str().to_string()).unwrap_or_else(|| "image/jpeg".into())))
    });
    let Some((data, m)) = pic else {
        let _ = req.respond(tiny_http::Response::empty(404));
        return;
    };
    let mut r = tiny_http::Response::from_data(data);
    for h in headers {
        r.add_header(h);
    }
    if let Some(h) = super::hdr("Content-Type", &m) {
        r.add_header(h);
    }
    if let Some(h) = super::hdr("Cache-Control", "max-age=3600") {
        r.add_header(h);
    }
    let _ = req.respond(r);
}
