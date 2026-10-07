//! Rust-часть Melo: вход в ВК, запросы к API и прокси для аудиопотоков.

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    http::{Request, Response},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// Публичный client_id Kate Mobile — вход через окно браузера.
const CLIENT_ID: &str = "2685278";
const KATE_UA: &str =
    "KateMobileAndroid/109.1 lite-550 (Android 13; SDK 33; arm64-v8a; Google Pixel 5; ru)";
/// Официальное приложение VK для Android — только оно разрешает вход по QR-коду.
const VKA_ID: &str = "2274003";
const VKA_SECRET: &str = "hHbZxrka2uZ6jB1inYsH";
const VKA_UA: &str = "VKAndroidApp/8.52-14102 (Android 13; SDK 33; arm64-v8a; Google Pixel 5; ru; 2400x1080; No Cellular)";
const API_VERSION: &str = "5.131";
const REDIRECT: &str = "https://oauth.vk.com/blank.html";

fn default_client() -> String {
    "kate".into()
}

#[derive(Serialize, Deserialize, Clone)]
struct Session {
    token: String,
    user_id: i64,
    /// "kate" или "vk_android" — от этого зависит User-Agent запросов
    #[serde(default = "default_client")]
    client: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    photo: Option<String>,
}

impl Session {
    fn user_agent(&self) -> &'static str {
        if self.client == "vk_android" { VKA_UA } else { KATE_UA }
    }
}

struct AppState {
    session: Mutex<Option<Session>>,
    http: reqwest::Client,
    /// Анонимный токен для QR-входа: (токен, когда получен)
    anon: Mutex<Option<(String, std::time::Instant)>>,
    /// Адрес локального сервера для музыки, например http://127.0.0.1:51234/abc/
    stream_base: Mutex<String>,
    /// Закрытие окна прячет его в трей
    close_to_tray: std::sync::atomic::AtomicBool,
    /// Что играет — для меню в трее
    tray: Mutex<TrayState>,
}

#[derive(Clone, Default, Serialize)]
struct TrayState {
    title: Option<String>,
    artist: Option<String>,
    cover: Option<String>,
    playing: bool,
}

fn data_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(name))
}

/// Все добавленные аккаунты и какой из них активен.
#[derive(Serialize, Deserialize, Default)]
struct Accounts {
    active: Option<i64>,
    accounts: Vec<Session>,
}

fn load_accounts(app: &AppHandle) -> Accounts {
    if let Some(acc) = data_path(app, "accounts.json")
        .and_then(|p| fs::read(p).ok())
        .and_then(|d| serde_json::from_slice::<Accounts>(&d).ok())
    {
        return acc;
    }
    // Переезд со старого формата (один аккаунт в session.json)
    let old: Option<Session> = data_path(app, "session.json")
        .and_then(|p| fs::read(p).ok())
        .and_then(|d| serde_json::from_slice(&d).ok());
    match old {
        Some(s) => Accounts { active: Some(s.user_id), accounts: vec![s] },
        None => Accounts::default(),
    }
}

fn store_accounts(app: &AppHandle, acc: &Accounts) {
    let Some(path) = data_path(app, "accounts.json") else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&path, serde_json::to_vec_pretty(acc).unwrap_or_default());
    if let Some(old) = data_path(app, "session.json") {
        let _ = fs::remove_file(old);
    }
}

/// Some — добавить/обновить аккаунт и сделать активным; None — удалить активный аккаунт.
fn save_session(app: &AppHandle, s: Option<&Session>) {
    let mut acc = load_accounts(app);
    match s {
        Some(s) => {
            let mut s = s.clone();
            if let Some(old) = acc.accounts.iter().find(|a| a.user_id == s.user_id) {
                if s.name.is_none() { s.name = old.name.clone(); }
                if s.photo.is_none() { s.photo = old.photo.clone(); }
            }
            acc.accounts.retain(|a| a.user_id != s.user_id);
            acc.active = Some(s.user_id);
            acc.accounts.push(s);
        }
        None => {
            if let Some(id) = acc.active.take() {
                acc.accounts.retain(|a| a.user_id != id);
            }
        }
    }
    store_accounts(app, &acc);
}

fn load_session(app: &AppHandle) -> Option<Session> {
    let acc = load_accounts(app);
    let id = acc.active?;
    acc.accounts.into_iter().find(|a| a.user_id == id)
}

#[derive(Serialize)]
struct AccountInfo {
    user_id: i64,
    name: Option<String>,
    photo: Option<String>,
    active: bool,
}

#[tauri::command]
fn accounts_list(app: AppHandle) -> Vec<AccountInfo> {
    let acc = load_accounts(&app);
    acc.accounts
        .iter()
        .map(|a| AccountInfo { user_id: a.user_id, name: a.name.clone(), photo: a.photo.clone(), active: acc.active == Some(a.user_id) })
        .collect()
}

#[tauri::command]
fn account_switch(app: AppHandle, state: State<'_, AppState>, user_id: i64) -> Result<(), String> {
    let mut acc = load_accounts(&app);
    let s = acc.accounts.iter().find(|a| a.user_id == user_id).cloned().ok_or("Аккаунт не найден")?;
    acc.active = Some(user_id);
    store_accounts(&app, &acc);
    *state.session.lock().unwrap() = Some(s);
    Ok(())
}

/// Отвязывает аккаунт. Если он был активным — сеанс сбрасывается.
#[tauri::command]
fn account_remove(app: AppHandle, state: State<'_, AppState>, user_id: i64) {
    let mut acc = load_accounts(&app);
    acc.accounts.retain(|a| a.user_id != user_id);
    if acc.active == Some(user_id) {
        acc.active = None;
        *state.session.lock().unwrap() = None;
    }
    store_accounts(&app, &acc);
}

/// Запоминает имя и аватар активного аккаунта — для переключателя.
#[tauri::command]
fn account_set_info(app: AppHandle, name: String, photo: Option<String>) {
    let mut acc = load_accounts(&app);
    let Some(id) = acc.active else { return };
    if let Some(a) = acc.accounts.iter_mut().find(|a| a.user_id == id) {
        a.name = Some(name);
        a.photo = photo;
    }
    store_accounts(&app, &acc);
}

/// Уходим со текущего аккаунта в «режим добавления», не удаляя его.
#[tauri::command]
fn account_detach(app: AppHandle, state: State<'_, AppState>) {
    let mut acc = load_accounts(&app);
    acc.active = None;
    store_accounts(&app, &acc);
    *state.session.lock().unwrap() = None;
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    data_dir: String,
    stream: String,
    client: Option<String>,
    api_version: String,
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: app.path().app_data_dir().map(|d| d.display().to_string()).unwrap_or_default(),
        stream: state.stream_base.lock().unwrap().split('/').nth(2).unwrap_or_default().to_string(),
        client: state.session.lock().unwrap().as_ref().map(|s| s.client.clone()),
        api_version: API_VERSION.into(),
    }
}

/// Достаёт токен из адреса вида https://oauth.vk.com/blank.html#access_token=...&user_id=...
fn parse_redirect(u: &Url) -> Option<Result<Session, String>> {
    if u.host_str() != Some("oauth.vk.com") || u.path() != "/blank.html" {
        return None;
    }
    let frag = u.fragment().unwrap_or_default();
    let params: HashMap<String, String> = url::form_urlencoded::parse(frag.as_bytes())
        .into_owned()
        .collect();
    if let (Some(token), Some(uid)) = (params.get("access_token"), params.get("user_id")) {
        return Some(Ok(Session {
            token: token.clone(),
            user_id: uid.parse().unwrap_or(0),
            client: default_client(),
            name: None,
            photo: None,
        }));
    }
    if params.contains_key("error") {
        return Some(Err("Вход отменён".into()));
    }
    None
}

type Reply = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<Session, String>>>>>;

fn reply(tx: &Reply, value: Result<Session, String>) {
    if let Some(t) = tx.lock().unwrap().take() {
        let _ = t.send(value);
    }
}

/// Открывает окно с официальной страницей входа ВК и ждёт токен.
#[tauri::command]
async fn vk_login(app: AppHandle, state: State<'_, AppState>) -> Result<i64, String> {
    if let Some(w) = app.get_webview_window("vk-auth") {
        let _ = w.close();
    }
    let auth_url = format!(
        "https://oauth.vk.com/authorize?client_id={CLIENT_ID}&display=page&redirect_uri={REDIRECT}\
         &scope=audio,offline&response_type=token&revoke=1&v={API_VERSION}"
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));

    let tx_nav = tx.clone();
    let win = WebviewWindowBuilder::new(
        &app,
        "vk-auth",
        WebviewUrl::External(auth_url.parse().map_err(|_| "bad url")?),
    )
    .title("Вход ВКонтакте")
    .inner_size(520.0, 700.0)
    .center()
    .on_navigation(move |u| match parse_redirect(u) {
        Some(res) => {
            reply(&tx_nav, res);
            false
        }
        None => true,
    })
    .build()
    .map_err(|e| e.to_string())?;

    let tx_close = tx.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
            reply(&tx_close, Err("Вход отменён".into()));
        }
    });

    // Подстраховка: некоторые редиректы не проходят через on_navigation
    let tx_poll = tx.clone();
    let poll_win = win.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(400)).await;
            if tx_poll.lock().unwrap().is_none() {
                break;
            }
            match poll_win.url() {
                Ok(u) => {
                    if let Some(res) = parse_redirect(&u) {
                        reply(&tx_poll, res);
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let result = rx.await.unwrap_or_else(|_| Err("Вход отменён".into()));
    if let Some(w) = app.get_webview_window("vk-auth") {
        let _ = w.close();
    }
    let session = result?;
    let uid = session.user_id;
    save_session(&app, Some(&session));
    *state.session.lock().unwrap() = Some(session);
    Ok(uid)
}

#[tauri::command]
fn vk_session(state: State<'_, AppState>) -> Option<i64> {
    state.session.lock().unwrap().as_ref().map(|s| s.user_id)
}

#[tauri::command]
fn vk_logout(app: AppHandle, state: State<'_, AppState>) {
    *state.session.lock().unwrap() = None;
    save_session(&app, None);
}

/// Универсальный вызов метода API ВК.
#[tauri::command]
async fn vk_call(
    app: AppHandle,
    state: State<'_, AppState>,
    method: String,
    params: HashMap<String, Value>,
) -> Result<Value, String> {
    let (token, ua) = state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| (s.token.clone(), s.user_agent()))
        .ok_or("not_authorized")?;

    let mut form: Vec<(String, String)> = params
        .into_iter()
        .filter(|(_, v)| !v.is_null())
        .map(|(k, v)| {
            let v = match v {
                Value::String(s) => s,
                Value::Bool(b) => (if b { "1" } else { "0" }).to_string(),
                other => other.to_string(),
            };
            (k, v)
        })
        .collect();
    form.push(("access_token".into(), token));
    form.push(("v".into(), API_VERSION.into()));
    if !form.iter().any(|(k, _)| k == "lang") {
        form.push(("lang".into(), "ru".into()));
    }

    let res: Value = state
        .http
        .post(format!("https://api.vk.com/method/{method}"))
        .header("User-Agent", ua)
        .form(&form)
        .send()
        .await
        .map_err(|_| "Нет соединения с ВКонтакте".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.get("error") {
        let code = err["error_code"].as_i64().unwrap_or(0);
        let msg = err["error_msg"].as_str().unwrap_or("Ошибка ВКонтакте");
        if code == 5 {
            *state.session.lock().unwrap() = None;
            save_session(&app, None);
            return Err("not_authorized".into());
        }
        return Err(format!("{msg} (код {code})"));
    }
    Ok(res.get("response").cloned().unwrap_or(Value::Null))
}

// ---------- Аккаунт Melo ----------

/// Токен активного аккаунта ВК — только чтобы сервер Melo один раз проверил,
/// чей это аккаунт (users.get). Сервер токен не сохраняет.
#[derive(Serialize)]
struct VkProof {
    token: String,
    client: String,
}

#[tauri::command]
fn vk_proof(state: State<'_, AppState>) -> Option<VkProof> {
    state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| VkProof { token: s.token.clone(), client: s.client.clone() })
}

/// Сессия Melo (токен и профиль) хранится в папке данных приложения, как и аккаунты ВК.
#[tauri::command]
fn melo_session_get(app: AppHandle) -> Option<Value> {
    data_path(&app, "melo.json")
        .and_then(|p| fs::read(p).ok())
        .and_then(|d| serde_json::from_slice(&d).ok())
}

#[tauri::command]
fn melo_session_set(app: AppHandle, value: Option<Value>) {
    let Some(path) = data_path(&app, "melo.json") else { return };
    match value {
        Some(v) => {
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::write(&path, serde_json::to_vec(&v).unwrap_or_default());
        }
        None => {
            let _ = fs::remove_file(path);
        }
    }
}

/// Открыть https-ссылку в браузере по умолчанию (вход через Google).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let u = Url::parse(&url).map_err(|_| "Неверная ссылка".to_string())?;
    if u.scheme() != "https" {
        return Err("Можно открывать только https-ссылки".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", u.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(u.as_str()).spawn().map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(u.as_str()).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Вход по QR-коду ----------

async fn vka_get(http: &reqwest::Client, url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let res: Value = http
        .get(url)
        .header("User-Agent", VKA_UA)
        .query(query)
        .send()
        .await
        .map_err(|_| "Нет соединения с ВКонтакте".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(err) = res.get("error") {
        let msg = err["error_msg"].as_str().or(err.as_str()).unwrap_or("Ошибка ВКонтакте");
        return Err(msg.to_string());
    }
    Ok(res)
}

async fn anon_token(state: &AppState) -> Result<String, String> {
    if let Some((t, at)) = state.anon.lock().unwrap().clone() {
        if at.elapsed() < Duration::from_secs(3600) {
            return Ok(t);
        }
    }
    let res = vka_get(
        &state.http,
        "https://oauth.vk.com/get_anonym_token",
        &[("client_id", VKA_ID), ("client_secret", VKA_SECRET), ("v", API_VERSION)],
    )
    .await?;
    let t = res["token"].as_str().ok_or("Не удалось получить QR-код")?.to_string();
    *state.anon.lock().unwrap() = Some((t.clone(), std::time::Instant::now()));
    Ok(t)
}

#[derive(Serialize)]
struct QrCode {
    url: String,
    hash: String,
    /// Unix-время, когда код перестанет работать
    expires_at: i64,
}

#[derive(Serialize)]
struct QrStatus {
    /// "waiting", "scanned" или "ok"
    state: String,
    /// Сырой статус от ВК — для диагностики
    raw: Value,
}

fn take_token(app: &AppHandle, state: &AppState, res: &Value) -> bool {
    let r = &res["response"];
    let Some(token) = r["access_token"].as_str().or(res["access_token"].as_str()) else {
        return false;
    };
    let user_id = r["user_id"].as_i64().or(res["user_id"].as_i64()).unwrap_or(0);
    let session = Session { token: token.to_string(), user_id, client: "vk_android".into(), name: None, photo: None };
    save_session(app, Some(&session));
    *state.session.lock().unwrap() = Some(session);
    true
}

/// Меняет super_app_token (после подтверждения QR) на обычный ключ доступа —
/// так же, как это делает официальная страница входа id.vk.com.
async fn exchange_super_token(app: &AppHandle, state: &AppState, r: &Value) -> Result<(), String> {
    if r["need_password"].as_bool().unwrap_or(false) || r["need_password"].as_i64() == Some(1) {
        return Err("ВК просит пароль для этого входа. Войдите по логину и паролю.".into());
    }
    let Some(sat) = r["super_app_token"].as_str().filter(|t| !t.is_empty()) else {
        let keys: Vec<String> = r.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        return Err(format!("ВК подтвердил вход, но не выдал ключ (поля: {})", keys.join(", ")));
    };
    let uuid = format!("{:032x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let mut errors = Vec::new();
    for app_id in [VKA_ID, "7913379"] {
        let res = state
            .http
            .post("https://login.vk.com/?act=connect_code_auth")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
            .header("Origin", "https://id.vk.com")
            .header("Referer", "https://id.vk.com/")
            .form(&[("token", sat), ("uuid", uuid.as_str()), ("app_id", app_id), ("version", "1")])
            .send()
            .await;
        let v: Value = match res {
            Ok(r) => r.json().await.unwrap_or(Value::Null),
            Err(_) => return Err("Нет соединения с ВКонтакте".into()),
        };
        let d = if v["data"].is_object() { &v["data"] } else { &v };
        if let Some(token) = d["access_token"].as_str().filter(|t| !t.is_empty()) {
            let mut user_id = d["user_id"].as_i64().or(d["auth_info"]["user_id"].as_i64()).unwrap_or(0);
            let client = if app_id == VKA_ID { "vk_android" } else { "vk_web" };
            if user_id == 0 {
                if let Ok(u) = vka_get(&state.http, "https://api.vk.com/method/users.get", &[("access_token", token), ("v", API_VERSION)]).await {
                    user_id = u["response"][0]["id"].as_i64().unwrap_or(0);
                }
            }
            let session = Session { token: token.to_string(), user_id, client: client.into(), name: None, photo: None };
            save_session(app, Some(&session));
            *state.session.lock().unwrap() = Some(session);
            return Ok(());
        }
        errors.push(format!("{app_id}: {}", v["error_code"].as_str().or(v["error_info"].as_str()).unwrap_or("нет ответа")));
    }
    Err(format!("Не удалось завершить вход ({})", errors.join("; ")))
}

/// Создаёт новый QR-код для входа.
#[tauri::command]
async fn qr_start(state: State<'_, AppState>) -> Result<QrCode, String> {
    let anon = anon_token(&state).await?;
    let res = vka_get(
        &state.http,
        "https://api.vk.com/method/auth.getAuthCode",
        &[("client_id", VKA_ID), ("device_name", "Melo (Windows)"), ("access_token", &anon), ("v", API_VERSION)],
    )
    .await?;
    let r = &res["response"];
    Ok(QrCode {
        url: r["auth_url"].as_str().unwrap_or_default().to_string(),
        hash: r["auth_hash"].as_str().unwrap_or_default().to_string(),
        expires_at: r["expires_in"].as_i64().unwrap_or(0),
    })
}

/// Проверяет, отсканирован ли код.
#[tauri::command]
async fn qr_check(app: AppHandle, state: State<'_, AppState>, hash: String) -> Result<QrStatus, String> {
    let anon = anon_token(&state).await?;
    let res = vka_get(
        &state.http,
        "https://api.vk.com/method/auth.checkAuthCode",
        &[("auth_hash", hash.as_str()), ("client_id", VKA_ID), ("web_auth", "1"), ("access_token", &anon), ("v", API_VERSION)],
    )
    .await?;
    if take_token(&app, &state, &res) {
        return Ok(QrStatus { state: "ok".into(), raw: Value::Null });
    }
    if res["response"]["status"].as_i64() == Some(2) {
        // Вход подтверждён: ВК отдаёт одноразовый super_app_token, его нужно обменять на ключ
        return Ok(match exchange_super_token(&app, &state, &res["response"]).await {
            Ok(()) => QrStatus { state: "ok".into(), raw: Value::Null },
            Err(e) => QrStatus { state: "error".into(), raw: Value::String(e) },
        });
    }
    // Статусы ВК: 0 — создан, 1 — открыт на телефоне, 2 — подтверждён,
    // 3 — отклонён, 4 — истёк, 5 — нужен код с телефона
    let raw = res["response"]["status"].clone();
    let st = match raw.as_i64().unwrap_or(0) {
        0 => "waiting",
        1 => "scanned",
        3 => "declined",
        4 => "expired",
        5 => "need_code",
        _ => "scanned",
    };
    Ok(QrStatus { state: st.into(), raw })
}

/// Отправляет код подтверждения, который ВК показал на телефоне.
#[tauri::command]
async fn qr_submit_code(app: AppHandle, state: State<'_, AppState>, hash: String, code: String) -> Result<QrStatus, String> {
    let anon = anon_token(&state).await?;
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    let res = vka_get(
        &state.http,
        "https://api.vk.com/method/auth.validateAuthCode",
        &[
            ("auth_hash", hash.as_str()),
            ("validation_code", code.as_str()),
            ("access_token", &anon),
            ("v", API_VERSION),
        ],
    )
    .await?;
    if take_token(&app, &state, &res) {
        return Ok(QrStatus { state: "ok".into(), raw: Value::Null });
    }
    // 0 — код принят, 1 — неверный код, 2 — сессия истекла
    let raw = res["response"]["status"].clone();
    let st = match raw.as_i64() {
        Some(0) => "accepted",
        Some(1) => "incorrect",
        Some(2) => "expired",
        _ => "error",
    };
    Ok(QrStatus { state: st.into(), raw: res["response"].clone() })
}

// ---------- Эффекты окна (стекло) ----------

/// "none", "mica", "acrylic", "blur", "tabbed" — системный фон окна Windows под прозрачным интерфейсом.
#[tauri::command]
fn set_window_effect(app: AppHandle, kind: String) -> Result<(), String> {
    use tauri::window::{Effect, EffectsBuilder};
    let w = app.get_webview_window("main").ok_or("нет окна")?;
    let effect = match kind.as_str() {
        "mica" => Some(Effect::Mica),
        "tabbed" => Some(Effect::Tabbed),
        "acrylic" => Some(Effect::Acrylic),
        _ => None,
    };
    // Меню в трее выглядит так же, как приложение
    if let Some(t) = app.get_webview_window("tray-menu") {
        match effect.clone() {
            Some(e) => {
                let _ = t.set_effects(EffectsBuilder::new().effect(e).build());
                let _ = t.set_shadow(true);
            }
            None => {
                let _ = t.set_effects(None);
                let _ = t.set_shadow(false);
            }
        }
    }
    match effect {
        Some(e) => w.set_effects(EffectsBuilder::new().effect(e).build()).map_err(|e| e.to_string()),
        None => w.set_effects(None).map_err(|e| e.to_string()),
    }
}

// ---------- Трей ----------

#[tauri::command]
fn set_close_to_tray(state: State<'_, AppState>, value: bool) {
    state.close_to_tray.store(value, std::sync::atomic::Ordering::Relaxed);
}

/// Обновляет подсказку у значка в трее и карточку в меню трея.
#[tauri::command]
fn tray_update(app: AppHandle, state: State<'_, AppState>, title: Option<String>, artist: Option<String>, cover: Option<String>, playing: bool) {
    use tauri::Emitter;
    if let Some(tray) = app.tray_by_id("main") {
        let tip = match (&title, &artist) {
            (Some(t), Some(a)) => format!("Melo — {}{a} - {t}", if playing { "" } else { "⏸ " }),
            (Some(t), None) => format!("Melo — {t}"),
            _ => "Melo".into(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    let st = TrayState { title, artist, cover, playing };
    *state.tray.lock().unwrap() = st.clone();
    let _ = app.emit_to("tray-menu", "tray-state", st);
}

#[tauri::command]
fn tray_state(state: State<'_, AppState>) -> TrayState {
    state.tray.lock().unwrap().clone()
}

/// Кнопки в меню трея.
#[tauri::command]
fn tray_action(app: AppHandle, action: String) {
    use tauri::Emitter;
    match action.as_str() {
        "show" => {
            hide_tray_menu(&app);
            show_main(&app);
        }
        "quit" => app.exit(0),
        "hide" => hide_tray_menu(&app),
        other => {
            let _ = app.emit_to("main", "tray", other.to_string());
        }
    }
}

fn hide_tray_menu(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray-menu") {
        let _ = w.hide();
    }
}

const TRAY_W: f64 = 300.0;
const TRAY_H: f64 = 262.0;

fn create_tray_menu(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, "tray-menu", tauri::WebviewUrl::App("index.html#tray".into()))
        .title("Melo")
        .inner_size(TRAY_W, TRAY_H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(false)
        .build()
}

/// Показывает красивое меню трея рядом с курсором.
fn show_tray_menu(app: &AppHandle, x: f64, y: f64) {
    use tauri::Emitter;
    let w = match app.get_webview_window("tray-menu") {
        Some(w) => w,
        None => match create_tray_menu(app) {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    let sf = w.scale_factor().unwrap_or(1.0);
    let (pw, ph) = (TRAY_W * sf, TRAY_H * sf);
    let mut px = x - pw + 8.0 * sf;
    let mut py = y - ph;
    if let Ok(Some(m)) = app.monitor_from_point(x, y) {
        let (mx, my) = (m.position().x as f64, m.position().y as f64);
        let (mw, mh) = (m.size().width as f64, m.size().height as f64);
        if py < my { py = y; }
        if px < mx { px = x; }
        px = px.min(mx + mw - pw).max(mx);
        py = py.min(my + mh - ph).max(my);
    }
    let _ = w.set_position(tauri::PhysicalPosition::new(px.round() as i32, py.round() as i32));
    let st = app.state::<AppState>().tray.lock().unwrap().clone();
    let _ = w.emit("tray-state", st);
    let _ = w.emit("tray-open", ());
    let _ = w.show();
    let _ = w.set_focus();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("Melo")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, position, .. } = e {
                match button {
                    MouseButton::Left => {
                        hide_tray_menu(tray.app_handle());
                        show_main(tray.app_handle());
                    }
                    MouseButton::Right => show_tray_menu(tray.app_handle(), position.x, position.y),
                    _ => {}
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    // Окно меню создаём заранее, чтобы оно открывалось мгновенно
    let _ = create_tray_menu(app.handle());
    Ok(())
}

// ---------- Локальный сервер для музыки ----------
// WebView2 плохо проигрывает <audio> через свои протоколы, поэтому поднимаем
// маленький HTTP-сервер на 127.0.0.1: он отдаёт поток по частям, поддерживает
// перемотку (Range), добавляет CORS для эквалайзера и переписывает ссылки в m3u8.

#[tauri::command]
fn stream_base(state: State<'_, AppState>) -> String {
    state.stream_base.lock().unwrap().clone()
}

fn start_stream_server(app: AppHandle) -> Option<String> {
    let server = tiny_http::Server::http("127.0.0.1:0").ok()?;
    let port = server.server_addr().to_ip()?.port();
    let key = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos() ^ 0x5bd1e995);
    let base = format!("http://127.0.0.1:{port}/{key}/");
    let client = std::sync::Arc::new(
        reqwest::blocking::Client::builder()
            .timeout(None)
            .connect_timeout(Duration::from_secs(15))
            .build()
            .ok()?,
    );
    let prefix = format!("/{key}/");
    let base2 = base.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let client = client.clone();
            let app = app.clone();
            let base = base2.clone();
            let prefix = prefix.clone();
            std::thread::spawn(move || serve_stream(req, &client, &app, &base, &prefix));
        }
    });
    Some(base)
}

fn hdr(k: &str, v: &str) -> Option<tiny_http::Header> {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).ok()
}

fn serve_stream(req: tiny_http::Request, client: &reqwest::blocking::Client, app: &AppHandle, base: &str, prefix: &str) {
    let cors = [
        hdr("Access-Control-Allow-Origin", "*"),
        hdr("Access-Control-Allow-Headers", "*"),
        hdr("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length"),
    ];
    let fail = |req: tiny_http::Request, code: u16| {
        let mut r = tiny_http::Response::empty(code);
        for h in cors.iter().flatten() {
            r.add_header(h.clone());
        }
        let _ = req.respond(r);
    };
    if req.method() == &tiny_http::Method::Options {
        return fail(req, 204);
    }
    let Some(target) = req
        .url()
        .strip_prefix(prefix)
        .and_then(|rest| Url::parse(&format!("http://x/{rest}")).ok())
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()))
        .and_then(|t| Url::parse(&t).ok())
        .filter(|t| t.scheme() == "https")
    else {
        return fail(req, 403);
    };
    let ua = app
        .state::<AppState>()
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.user_agent())
        .unwrap_or(KATE_UA);
    let mut up = client.get(target.clone()).header("User-Agent", ua);
    if let Some(r) = req.headers().iter().find(|h| h.field.equiv("Range")) {
        up = up.header("Range", r.value.as_str());
    }
    let Ok(res) = up.send() else {
        return fail(req, 502);
    };
    let status = res.status().as_u16();
    let get = |k: &str| res.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let ctype = get("content-type").unwrap_or_else(|| "application/octet-stream".into());
    let is_playlist = target.path().ends_with(".m3u8") || ctype.contains("mpegurl");

    let mut headers: Vec<tiny_http::Header> = cors.iter().flatten().cloned().collect();
    if is_playlist {
        let text = res.text().unwrap_or_default();
        let body = rewrite_m3u8(&text, &target, base);
        headers.extend(hdr("Content-Type", "application/vnd.apple.mpegurl"));
        let mut r = tiny_http::Response::from_string(body).with_status_code(status);
        for h in headers {
            r.add_header(h);
        }
        let _ = req.respond(r);
        return;
    }
    headers.extend(hdr("Content-Type", &ctype));
    for k in ["content-range", "accept-ranges"] {
        if let Some(v) = get(k) {
            headers.extend(hdr(k, &v));
        }
    }
    let len = res.content_length().map(|l| l as usize);
    let r = tiny_http::Response::new(tiny_http::StatusCode(status), headers, res, len, None);
    let _ = req.respond(r);
}

// ---------- Прокси для HLS-потоков (m3u8) ----------

fn proxied(base: &str, target: &str) -> String {
    let enc: String = url::form_urlencoded::byte_serialize(target.as_bytes()).collect();
    format!("{base}?u={enc}")
}

fn rewrite_m3u8(body: &str, src: &Url, base: &str) -> String {
    body.lines()
        .map(|line| {
            let t = line.trim();
            if t.is_empty() {
                return line.to_string();
            }
            if !t.starts_with('#') {
                return src
                    .join(t)
                    .map(|u| proxied(base, u.as_str()))
                    .unwrap_or_else(|_| line.to_string());
            }
            if let Some(start) = t.find("URI=\"") {
                let rest = &t[start + 5..];
                if let Some(end) = rest.find('"') {
                    let uri = &rest[..end];
                    if let Ok(abs) = src.join(uri) {
                        return format!(
                            "{}URI=\"{}\"{}",
                            &t[..start],
                            proxied(base, abs.as_str()),
                            &rest[end + 1..]
                        );
                    }
                }
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn error_response(status: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap()
}

async fn proxy(app: AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = req.uri().to_string();
    let base = if uri.starts_with("vkstream://") {
        "vkstream://localhost/"
    } else {
        "http://vkstream.localhost/"
    };
    let Some(target) = Url::parse(&uri)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()))
        .and_then(|t| Url::parse(&t).ok())
    else {
        return error_response(400);
    };
    if target.scheme() != "https" {
        return error_response(403);
    }

    let state = app.state::<AppState>();
    let http = state.http.clone();
    let ua = state.session.lock().unwrap().as_ref().map(|s| s.user_agent()).unwrap_or(KATE_UA);
    let mut upstream = http.get(target.clone()).header("User-Agent", ua);
    if let Some(range) = req.headers().get("range").and_then(|v| v.to_str().ok()) {
        upstream = upstream.header("Range", range); // нужно для перемотки mp3
    }
    let Ok(res) = upstream.send().await else {
        return error_response(502);
    };
    let status = res.status().as_u16();
    let pass: Vec<(String, String)> = ["content-range", "accept-ranges"]
        .iter()
        .filter_map(|h| res.headers().get(*h).and_then(|v| v.to_str().ok()).map(|v| (h.to_string(), v.to_string())))
        .collect();
    let ctype = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let Ok(bytes) = res.bytes().await else {
        return error_response(502);
    };

    let is_playlist = target.path().ends_with(".m3u8") || ctype.contains("mpegurl");
    let body = if is_playlist {
        rewrite_m3u8(&String::from_utf8_lossy(&bytes), &target, base).into_bytes()
    } else {
        bytes.to_vec()
    };

    let mut b = Response::builder()
        .status(status)
        .header("Content-Type", if is_playlist { "application/vnd.apple.mpegurl" } else { &ctype })
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
    if !is_playlist {
        for (k, v) in &pass {
            b = b.header(k.as_str(), v.as_str());
        }
    }
    b.body(body).unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(KATE_UA)
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client");

    tauri::Builder::default()
        .manage(AppState { session: Mutex::new(None), http, anon: Mutex::new(None), stream_base: Mutex::new(String::new()), close_to_tray: std::sync::atomic::AtomicBool::new(false), tray: Mutex::new(TrayState::default()) })
        .setup(|app| {
            cleanup_old_exe();
            let handle = app.handle().clone();
            let session = load_session(&handle);
            *app.state::<AppState>().session.lock().unwrap() = session;
            setup_tray(app)?;
            if let Some(base) = start_stream_server(handle.clone()) {
                *app.state::<AppState>().stream_base.lock().unwrap() = base;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "tray-menu" {
                match event {
                    WindowEvent::Focused(false) => { let _ = window.hide(); }
                    WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); let _ = window.hide(); }
                    _ => {}
                }
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && window.state::<AppState>().close_to_tray.load(std::sync::atomic::Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("vkstream", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy(app, request).await);
            });
        })
        .invoke_handler(tauri::generate_handler![vk_login, vk_session, vk_logout, vk_call, qr_start, qr_check, qr_submit_code, stream_base, accounts_list, account_switch, account_remove, account_set_info, account_detach, app_info, set_close_to_tray, tray_update, tray_state, tray_action, set_window_effect, update_check, update_install, vk_proof, melo_session_get, melo_session_set, open_url])
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения");
}

// ---------- Автообновление с GitHub ----------
// Melo — один exe без установщика. Обновление: качаем Melo.exe из последнего
// релиза на GitHub, проверяем SHA-256, переименовываем запущенный exe в *.old
// (Windows это позволяет), кладём новый на его место и перезапускаемся.

/// Репозиторий с релизами: "владелец/имя"
pub const UPDATE_REPO: &str = "wtf40iq/Melo";

#[derive(Serialize, Clone)]
struct UpdateInfo {
    available: bool,
    current: String,
    version: String,
    notes: String,
    url: String,
    size: u64,
    digest: Option<String>,
    page: String,
}

fn parse_ver(v: &str) -> Vec<u64> {
    v.trim_start_matches(['v', 'V']).split(['.', '-']).take(3).map(|p| p.parse().unwrap_or(0)).collect()
}

#[tauri::command]
async fn update_check(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let r = state
        .http
        .get(format!("https://api.github.com/repos/{UPDATE_REPO}/releases/latest"))
        .header("User-Agent", "Melo-updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Нет связи с GitHub: {e}"))?;
    if r.status().as_u16() == 404 {
        return Err("На GitHub пока нет релизов".into());
    }
    if !r.status().is_success() {
        return Err(format!("GitHub ответил {}", r.status()));
    }
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    let tag = j["tag_name"].as_str().unwrap_or_default().to_string();
    let asset = j["assets"].as_array().and_then(|a| {
        a.iter().find(|x| x["name"].as_str().map(|n| n.eq_ignore_ascii_case("Melo.exe")).unwrap_or(false))
    });
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    Ok(UpdateInfo {
        available: asset.is_some() && parse_ver(&version) > parse_ver(&current),
        current,
        version,
        notes: j["body"].as_str().unwrap_or_default().to_string(),
        url: asset.and_then(|a| a["browser_download_url"].as_str()).unwrap_or_default().to_string(),
        size: asset.and_then(|a| a["size"].as_u64()).unwrap_or(0),
        digest: asset.and_then(|a| a["digest"].as_str()).map(|d| d.trim_start_matches("sha256:").to_lowercase()),
        page: j["html_url"].as_str().unwrap_or_default().to_string(),
    })
}

#[tauri::command]
async fn update_install(app: AppHandle, state: State<'_, AppState>, url: String, digest: Option<String>) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use tauri::Emitter;
    if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
        return Err("Странная ссылка на обновление".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("нет папки")?.to_path_buf();
    let mut r = state
        .http
        .get(&url)
        .header("User-Agent", "Melo-updater")
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("Не удалось скачать: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Не удалось скачать: {}", r.status()));
    }
    let total = r.content_length().unwrap_or(0);
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = std::time::Instant::now();
    while let Some(chunk) = r.chunk().await.map_err(|e| format!("Загрузка прервалась: {e}"))? {
        buf.extend_from_slice(&chunk);
        if last.elapsed() > Duration::from_millis(120) {
            last = std::time::Instant::now();
            let _ = app.emit("update-progress", (buf.len() as u64, total));
        }
    }
    let _ = app.emit("update-progress", (buf.len() as u64, total));
    if buf.len() < 1_000_000 || &buf[..2] != b"MZ" {
        return Err("Скачанный файл повреждён".into());
    }
    if let Some(d) = digest.filter(|d| !d.is_empty()) {
        let got: String = Sha256::digest(&buf).iter().map(|b| format!("{b:02x}")).collect();
        if got != d {
            return Err("Контрольная сумма не совпала — обновление отменено".into());
        }
    }
    let new = dir.join("Melo.new.exe");
    let old = exe.with_extension("old");
    std::fs::write(&new, &buf).map_err(|e| format!("Нет прав записи в папку с Melo: {e}"))?;
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| format!("Не удалось заменить exe: {e}"))?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        let _ = std::fs::rename(&old, &exe);
        return Err(format!("Не удалось заменить exe: {e}"));
    }
    std::process::Command::new(&exe).spawn().map_err(|e| format!("Не удалось перезапустить: {e}"))?;
    app.exit(0);
    Ok(())
}

/// Убираем старый exe после обновления.
fn cleanup_old_exe() {
    if let Ok(exe) = std::env::current_exe() {
        let old = exe.with_extension("old");
        std::thread::spawn(move || {
            for _ in 0..10 {
                if !old.exists() || std::fs::remove_file(&old).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });
    }
}
