//! Rust-часть Melo: вход в ВК, запросы к API и прокси для аудиопотоков.

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

mod offline;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    http::{Request, Response},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// Публичный client_id Kate Mobile — вход через окно браузера.
const CLIENT_ID: &str = "2685278";
const WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
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
    /// Unix-время, когда ключ истечёт (None — бессрочный)
    #[serde(default)]
    expires_at: Option<i64>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Срок жизни ключа из ответа ВК: 0 или пусто — бессрочный.
fn expiry(expires_in: Option<i64>) -> Option<i64> {
    expires_in.filter(|&e| e > 0).map(|e| now_secs() + e)
}

impl Session {
    fn user_agent(&self) -> &'static str {
        // Запросы должны выглядеть так же, как клиент, выдавший ключ, — иначе ВК может его отозвать
        match self.client.as_str() {
            "vk_android" => VKA_UA,
            "vk_web" => WEB_UA,
            _ => KATE_UA,
        }
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

/// Папка с данными Melo. Если папка установки доступна на запись — `<папка Melo.exe>\data`
/// (там же токены ВК и профиль WebView), иначе — старое место в %APPDATA%.
static DATA_ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
const IDENT: &str = "com.skymywex.melo";

fn legacy_roaming() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(IDENT))
}

fn legacy_local() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(IDENT))
}

fn portable_root() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.join("data");
    fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write-test");
    fs::write(&probe, b"ok").ok()?;
    let _ = fs::remove_file(&probe);
    Some(dir)
}

fn data_root() -> &'static PathBuf {
    DATA_ROOT.get_or_init(|| {
        portable_root()
            .or_else(|| legacy_roaming())
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

fn is_portable() -> bool {
    Some(data_root()) != legacy_roaming().as_ref()
}

fn webview_dir() -> PathBuf {
    data_root().join("webview")
}

/// Копирует папку целиком, пропуская кеши (их WebView пересоздаст сам).
fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    let Ok(rd) = fs::read_dir(from) else { return };
    let _ = fs::create_dir_all(to);
    for e in rd.flatten() {
        let name = e.file_name();
        let n = name.to_string_lossy();
        if matches!(n.as_ref(), "Cache" | "Code Cache" | "GPUCache" | "GrShaderCache" | "ShaderCache" | "DawnCache" | "Crashpad") {
            continue;
        }
        let (src, dst) = (e.path(), to.join(&name));
        match e.file_type() {
            Ok(t) if t.is_dir() => copy_dir(&src, &dst),
            Ok(t) if t.is_file() => { let _ = fs::copy(&src, &dst); }
            _ => {}
        }
    }
}

/// Первый запуск из папки установки: переносим вход ВК и настройки из старых мест.
fn migrate_legacy() {
    if !is_portable() {
        return;
    }
    let root = data_root();
    let marker = root.join(".migrated");
    if marker.exists() {
        return;
    }
    if let Some(old) = legacy_roaming() {
        for f in ["accounts.json", "accounts.json.bak", "session.json"] {
            let (src, dst) = (old.join(f), root.join(f));
            if src.exists() && !dst.exists() {
                let _ = fs::copy(&src, &dst);
            }
        }
    }
    let wv = webview_dir().join("EBWebView");
    if !wv.exists() {
        if let Some(old) = legacy_local().map(|d| d.join("EBWebView")).filter(|d| d.exists()) {
            copy_dir(&old, &wv);
        }
    }
    let _ = fs::write(&marker, b"1");
}

fn data_path(_app: &AppHandle, name: &str) -> Option<PathBuf> {
    Some(data_root().join(name))
}

/// Все добавленные аккаунты и какой из них активен.
#[derive(Serialize, Deserialize, Default)]
struct Accounts {
    active: Option<i64>,
    accounts: Vec<Session>,
}

fn read_accounts(app: &AppHandle, name: &str) -> Option<Accounts> {
    data_path(app, name)
        .and_then(|p| fs::read(p).ok())
        .and_then(|d| serde_json::from_slice::<Accounts>(&d).ok())
}

fn load_accounts(app: &AppHandle) -> Accounts {
    // Основной файл, а если он повреждён (например, компьютер выключился во время записи) —
    // резервная копия. Так вход не теряется из-за сбоя записи.
    if let Some(acc) = read_accounts(app, "accounts.json").or_else(|| read_accounts(app, "accounts.json.bak")) {
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
    let data = serde_json::to_vec_pretty(acc).unwrap_or_default();
    // Атомарная запись: сначала во временный файл, потом замена. Прошлую версию храним как .bak
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &data).is_ok() {
        if path.exists() {
            let _ = fs::copy(&path, path.with_extension("json.bak"));
        }
        if fs::rename(&tmp, &path).is_err() {
            let _ = fs::write(&path, &data);
            let _ = fs::remove_file(&tmp);
        }
    } else {
        let _ = fs::write(&path, &data);
    }
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
        data_dir: data_root().display().to_string(),
        stream: state.stream_base.lock().unwrap().split('/').nth(2).unwrap_or_default().to_string(),
        client: state.session.lock().unwrap().as_ref().map(|s| s.client.clone()),
        api_version: API_VERSION.into(),
    }
}

/// Достаёт токен из адреса вида https://oauth.vk.com/blank.html#access_token=...&user_id=...
fn parse_redirect(u: &Url) -> Option<Result<Session, String>> {
    // ВК переезжает на vk.ru — принимаем оба домена
    if !matches!(u.host_str(), Some("oauth.vk.com") | Some("oauth.vk.ru")) || u.path() != "/blank.html" {
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
            expires_at: expiry(params.get("expires_in").and_then(|e| e.parse().ok())),
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
async fn vk_login(app: AppHandle, state: State<'_, AppState>, fresh: Option<bool>) -> Result<i64, String> {
    if let Some(w) = app.get_webview_window("vk-auth") {
        let _ = w.close();
    }
    let auth_url = format!(
        "https://oauth.vk.com/authorize?client_id={CLIENT_ID}&display=page&redirect_uri={REDIRECT}\
         &scope=audio,offline&response_type=token&v={API_VERSION}{}",
        // Если в окне ВК уже выполнен вход — он подхватится сам; для второго аккаунта просим выбрать заново
        if fresh.unwrap_or(false) { "&revoke=1" } else { "" }
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
    .data_directory(webview_dir())
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
    if !form.iter().any(|(k, _)| k == "v") {
        form.push(("v".into(), API_VERSION.into()));
    }
    if !form.iter().any(|(k, _)| k == "lang") {
        form.push(("lang".into(), "ru".into()));
    }

    // Раньше ключ с ограниченным сроком (QR) «продлевался» скрытым входом через Kate Mobile каждые
    // 5 минут. ВК считал это попытками входа и блокировал вход по паролю — больше так не делаем.

    let mut res = vk_send(&state, &method, &form, &token, ua).await?;
    // «Слишком много запросов в секунду» (6) — просто повторяем чуть позже.
    // Flood control (9) не долбим повторами: от них ВК только дольше держит ограничение.
    for wait_ms in [700u64, 1500] {
        let code = res.get("error").and_then(|e| e["error_code"].as_i64()).unwrap_or(0);
        if code != 6 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
        res = vk_send(&state, &method, &form, &token, ua).await?;
    }
    if let Some(err) = res.get("error") {
        let code = err["error_code"].as_i64().unwrap_or(0);
        let msg = err["error_msg"].as_str().unwrap_or("Ошибка ВКонтакте");
        if code == 5 {
            // Не выкидываем из аккаунта из-за случайного сбоя: ВК иногда отвечает «ошибкой
            // авторизации» на секунду (перегрузка, смена IP/VPN). Перепроверяем ключ через паузу.
            let lower = msg.to_lowercase();
            if lower.contains("another ip") || lower.contains("ip address") {
                return Err(format!("ВК не принял ключ с этого IP — выключите или смените VPN ({msg})"));
            }
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            if token_alive(&state, &token, ua).await != Some(false) {
                return Err(format!("ВК временно не ответил, попробуйте ещё раз ({msg})"));
            }
            // Ключ отозван — пробуем тихо войти заново через сохранённый вход ВК и повторить запрос
            if let Some(new) = relogin_once(&app, &state, &token, true).await {
                let res = vk_send(&state, &method, &form, &new.token, new.user_agent()).await?;
                return vk_result(res);
            }
            // Ключ действительно отозван (вышли на всех устройствах, сменили пароль и т. п.)
            let still_same = state.session.lock().unwrap().as_ref().map(|s| s.token == token).unwrap_or(false);
            if still_same {
                *state.session.lock().unwrap() = None;
                save_session(&app, None);
            }
            return Err(format!("not_authorized: {msg}"));
        }
        return Err(format!("{msg} (код {code})"));
    }
    vk_result(res)
}

async fn vk_send(state: &AppState, method: &str, form: &[(String, String)], token: &str, ua: &str) -> Result<Value, String> {
    let mut form = form.to_vec();
    form.push(("access_token".into(), token.to_string()));
    state
        .http
        .post(format!("https://api.vk.com/method/{method}"))
        .header("User-Agent", ua)
        .form(&form)
        .send()
        .await
        .map_err(|_| "Нет соединения с ВКонтакте".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

fn vk_result(res: Value) -> Result<Value, String> {
    if let Some(err) = res.get("error") {
        let code = err["error_code"].as_i64().unwrap_or(0);
        let msg = err["error_msg"].as_str().unwrap_or("Ошибка ВКонтакте");
        return Err(format!("{msg} (код {code})"));
    }
    Ok(res.get("response").cloned().unwrap_or(Value::Null))
}

// ---------- Тихий повторный вход ----------
// Если ВК отозвал ключ, но в окне входа ВК (его cookies лежат в папке data\webview)
// аккаунт всё ещё авторизован, ВК выдаёт новый ключ без единого клика — в скрытом окне.

static RELOGIN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static LAST_RELOGIN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

async fn relogin_once(app: &AppHandle, state: &AppState, old_token: &str, urgent: bool) -> Option<Session> {
    let _g = RELOGIN.lock().await;
    let cur = state.session.lock().unwrap().clone()?;
    if cur.token != old_token {
        return Some(cur); // ключ уже обновил параллельный запрос
    }
    // Скрытый вход работает только для ключа из окна Kate Mobile (там сохранён вход ВК).
    // Для QR и входа по паролю он бесполезен и лишь копит «попытки входа» у ВК.
    if cur.client != "kate" {
        return None;
    }
    // И даже для Kate — не чаще раза в 30 минут
    let gap = if urgent { 1800 } else { 3600 };
    let last = LAST_RELOGIN.load(std::sync::atomic::Ordering::Relaxed);
    if now_secs() - last < gap {
        return None;
    }
    LAST_RELOGIN.store(now_secs(), std::sync::atomic::Ordering::Relaxed);
    let mut s = silent_relogin(app, cur.user_id).await?;
    s.name = cur.name.clone();
    s.photo = cur.photo.clone();
    save_session(app, Some(&s));
    *state.session.lock().unwrap() = Some(s.clone());
    Some(s)
}

async fn silent_relogin(app: &AppHandle, user_id: i64) -> Option<Session> {
    let url = format!(
        "https://oauth.vk.com/authorize?client_id={CLIENT_ID}&display=page&redirect_uri={REDIRECT}\
         &scope=audio,offline&response_type=token&v={API_VERSION}"
    );
    if let Some(w) = app.get_webview_window("vk-silent") {
        let _ = w.close();
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = tx.clone();
    let win = WebviewWindowBuilder::new(app, "vk-silent", WebviewUrl::External(url.parse().ok()?))
        .title("Melo")
        .data_directory(webview_dir())
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        .inner_size(480.0, 600.0)
        .on_navigation(move |u| match parse_redirect(u) {
            Some(res) => {
                reply(&tx_nav, res);
                false
            }
            None => true,
        })
        .build()
        .ok()?;
    disable_autofill(&win);
    let tx_poll = tx.clone();
    let poll_win = win.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(300)).await;
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
    let res = tokio::time::timeout(Duration::from_secs(12), rx).await;
    reply(&tx, Err(String::new()));
    let _ = win.close();
    match res {
        Ok(Ok(Ok(s))) if s.user_id == user_id => Some(s),
        _ => None,
    }
}

// ---------- Вход через браузер ----------
// Открываем страницу ВК в браузере пользователя (там он обычно уже вошёл), он жмёт
// «Разрешить» и копирует адрес страницы — Melo сам замечает его в буфере обмена.

static BROWSER_LOGIN: Mutex<Option<Reply>> = Mutex::new(None);

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ищет в тексте адрес oauth.vk.com/blank.html#access_token=…
fn token_from_text(text: &str) -> Option<Result<Session, String>> {
    let i = text.find("oauth.vk.com/blank.html").or_else(|| text.find("oauth.vk.ru/blank.html"))?;
    let rest = text[i..].split_whitespace().next()?.trim_end_matches(['"', '\'', '>', ')']);
    let u = Url::parse(&format!("https://{rest}")).ok()?;
    parse_redirect(&u)
}

fn browser_auth_url() -> String {
    format!(
        "https://oauth.vk.com/authorize?client_id={CLIENT_ID}&display=page&redirect_uri={REDIRECT}\
         &scope=audio,offline&response_type=token&v={API_VERSION}"
    )
}

#[tauri::command]
async fn vk_browser_login(app: AppHandle, state: State<'_, AppState>) -> Result<i64, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));
    if let Some(old) = BROWSER_LOGIN.lock().unwrap().replace(tx.clone()) {
        reply(&old, Err("Вход отменён".into()));
    }
    open_in_browser(&browser_auth_url())?;

    // Следим за буфером обмена: как только там появится адрес с ключом — входим
    let tx_clip = tx.clone();
    std::thread::spawn(move || {
        let mut cb = arboard::Clipboard::new().ok();
        let initial = cb.as_mut().and_then(|c| c.get_text().ok());
        let started = std::time::Instant::now();
        while tx_clip.lock().unwrap().is_some() && started.elapsed() < Duration::from_secs(900) {
            std::thread::sleep(Duration::from_millis(500));
            if cb.is_none() {
                cb = arboard::Clipboard::new().ok();
            }
            let Some(c) = cb.as_mut() else { continue };
            let Ok(text) = c.get_text() else { continue };
            if initial.as_deref() == Some(text.as_str()) {
                continue;
            }
            if let Some(res) = token_from_text(&text) {
                if res.is_ok() {
                    let _ = c.clear(); // не оставляем ключ в буфере обмена
                }
                reply(&tx_clip, res);
                break;
            }
        }
        reply(&tx_clip, Err("Время ожидания входа истекло — попробуйте ещё раз".into()));
    });

    let result = rx.await.unwrap_or_else(|_| Err("Вход отменён".into()));
    {
        let mut cur = BROWSER_LOGIN.lock().unwrap();
        if cur.as_ref().map(|c| Arc::ptr_eq(c, &tx)).unwrap_or(false) {
            *cur = None;
        }
    }
    let session = result?;
    let uid = session.user_id;
    save_session(&app, Some(&session));
    *state.session.lock().unwrap() = Some(session);
    show_main(&app);
    Ok(uid)
}

/// Адрес страницы, вставленный вручную.
/// Если вход ещё ждёт — отдаём ключ ему (вернётся None); если ожидание уже закончилось
/// (ошибка, перезапуск) — входим сразу сами и возвращаем id пользователя.
#[tauri::command]
fn vk_browser_submit(app: AppHandle, state: State<'_, AppState>, text: String) -> Result<Option<i64>, String> {
    let res = token_from_text(&text).ok_or("В адресе нет ключа входа. Нажмите «Разрешить» в браузере и скопируйте адрес страницы целиком.")?;
    {
        let cur = BROWSER_LOGIN.lock().unwrap();
        if let Some(tx) = cur.as_ref() {
            if tx.lock().unwrap().is_some() {
                reply(tx, res);
                return Ok(None);
            }
        }
    }
    let session = res?;
    let uid = session.user_id;
    save_session(&app, Some(&session));
    *state.session.lock().unwrap() = Some(session);
    show_main(&app);
    Ok(Some(uid))
}

#[tauri::command]
fn vk_browser_reopen() -> Result<(), String> {
    open_in_browser(&browser_auth_url())
}

#[tauri::command]
fn vk_browser_cancel() {
    if let Some(tx) = BROWSER_LOGIN.lock().unwrap().take() {
        reply(&tx, Err("Вход отменён".into()));
    }
}

/// Жив ли ключ ВК: Some(true) — да, Some(false) — точно отозван, None — не удалось проверить.
async fn token_alive(state: &AppState, token: &str, ua: &str) -> Option<bool> {
    let res: Value = state
        .http
        .post("https://api.vk.com/method/users.get")
        .header("User-Agent", ua)
        .form(&[("access_token", token), ("v", API_VERSION)])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    if res.get("response").is_some() {
        return Some(true);
    }
    match res["error"]["error_code"].as_i64() {
        Some(5) => Some(false),
        _ => None,
    }
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
    let exp = expiry(r["expires_in"].as_i64().or(res["expires_in"].as_i64()));
    let session = Session { token: token.to_string(), user_id, client: "vk_android".into(), name: None, photo: None, expires_at: exp };
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
            let session = Session { token: token.to_string(), user_id, client: client.into(), name: None, photo: None, expires_at: expiry(d["expires_in"].as_i64()) };
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


// ---------- Вход по номеру/почте и паролю (прямая авторизация как у приложения VK для Android) ----------
// Страница VK ID для сторонних приложений (Kate Mobile) часто отвечает «Слишком много попыток [9]»,
// поэтому логин и пароль уходят напрямую в oauth.vk.com/token от имени официального клиента.
// Пароль нигде не сохраняется.

#[derive(Serialize, Default)]
struct DirectAuth {
    /// "ok", "code" (нужен код 2FA), "captcha", "error"
    state: String,
    uid: Option<i64>,
    sid: Option<String>,
    img: Option<String>,
    phone: Option<String>,
    /// "sms" или "app" — откуда ждать код
    kind: Option<String>,
    msg: Option<String>,
}

fn direct_err(msg: impl Into<String>) -> DirectAuth {
    DirectAuth { state: "error".into(), msg: Some(msg.into()), ..Default::default() }
}

/// Окно ВК для дополнительной проверки (ВК иногда просит подтвердить вход на своей странице).
async fn validation_window(app: &AppHandle, url: &str) -> Result<Session, String> {
    if let Some(w) = app.get_webview_window("vk-check") {
        let _ = w.close();
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = tx.clone();
    let win = WebviewWindowBuilder::new(app, "vk-check", WebviewUrl::External(url.parse().map_err(|_| "bad url")?))
        .title("Подтверждение входа ВКонтакте")
        .data_directory(webview_dir())
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
    disable_autofill(&win);
    let tx_close = tx.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
            reply(&tx_close, Err("Вход отменён".into()));
        }
    });
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
    let res = rx.await.unwrap_or_else(|_| Err("Вход отменён".into()));
    if let Some(w) = app.get_webview_window("vk-check") {
        let _ = w.close();
    }
    res
}

#[tauri::command]
async fn vk_direct_login(
    app: AppHandle,
    state: State<'_, AppState>,
    login: String,
    password: String,
    code: Option<String>,
    sms: Option<bool>,
    captcha_sid: Option<String>,
    captcha_key: Option<String>,
) -> Result<DirectAuth, String> {
    let login = login.trim().replace([' ', '(', ')', '-'], "");
    let mut q: Vec<(&str, String)> = vec![
        ("grant_type", "password".into()),
        ("client_id", VKA_ID.into()),
        ("client_secret", VKA_SECRET.into()),
        ("username", login.clone()),
        ("password", password),
        ("v", API_VERSION.into()),
        ("2fa_supported", "1".into()),
        ("lang", "ru".into()),
    ];
    if let Some(c) = code.as_deref().map(|c| c.trim()).filter(|c| !c.is_empty()) {
        q.push(("code", c.to_string()));
    }
    if sms.unwrap_or(false) {
        q.push(("force_sms", "1".into()));
    }
    if let (Some(sid), Some(key)) = (captcha_sid, captcha_key) {
        q.push(("captcha_sid", sid));
        q.push(("captcha_key", key.trim().to_string()));
    }
    let res: Value = state
        .http
        .get("https://oauth.vk.com/token")
        .header("User-Agent", VKA_UA)
        .query(&q)
        .send()
        .await
        .map_err(|_| "Нет соединения с ВКонтакте".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(token) = res["access_token"].as_str() {
        let session = Session {
            token: token.to_string(),
            user_id: res["user_id"].as_i64().unwrap_or(0),
            client: "vk_android".into(),
            name: None,
            photo: None,
            expires_at: expiry(res["expires_in"].as_i64()),
        };
        let uid = session.user_id;
        save_session(&app, Some(&session));
        *state.session.lock().unwrap() = Some(session);
        return Ok(DirectAuth { state: "ok".into(), uid: Some(uid), ..Default::default() });
    }

    let err = res["error"].as_str().unwrap_or_default();
    let desc = res["error_description"].as_str().unwrap_or_default();
    match err {
        "need_captcha" => Ok(DirectAuth {
            state: "captcha".into(),
            sid: res["captcha_sid"].as_str().map(String::from).or(res["captcha_sid"].as_i64().map(|v| v.to_string())),
            img: res["captcha_img"].as_str().map(String::from),
            ..Default::default()
        }),
        "need_validation" => {
            if let Some(kind) = res["validation_type"].as_str() {
                let sid = res["validation_sid"].as_str().map(String::from);
                let is_sms = kind.contains("sms");
                if is_sms {
                    if let Some(sid) = sid.as_deref() {
                        // Просим ВК отправить СМС с кодом
                        let _ = state
                            .http
                            .get("https://api.vk.com/method/auth.validatePhone")
                            .header("User-Agent", VKA_UA)
                            .query(&[("sid", sid), ("api_id", VKA_ID), ("v", API_VERSION)])
                            .send()
                            .await;
                    }
                }
                return Ok(DirectAuth {
                    state: "code".into(),
                    sid,
                    phone: res["phone_mask"].as_str().map(String::from),
                    kind: Some(if is_sms { "sms".into() } else { "app".into() }),
                    msg: (code.is_some()).then(|| "Неверный код. Проверьте его и попробуйте ещё раз.".to_string()),
                    ..Default::default()
                });
            }
            if let Some(url) = res["redirect_uri"].as_str() {
                // ВК хочет подтвердить вход на своей странице — открываем её и ловим ключ
                let mut session = validation_window(&app, url).await?;
                session.client = "vk_android".into();
                let uid = session.user_id;
                save_session(&app, Some(&session));
                *state.session.lock().unwrap() = Some(session);
                return Ok(DirectAuth { state: "ok".into(), uid: Some(uid), ..Default::default() });
            }
            Ok(direct_err(if desc.is_empty() { "ВК просит дополнительную проверку" } else { desc }))
        }
        "invalid_client" | "invalid_request" => {
            let low = desc.to_lowercase();
            let msg = if low.contains("password") || low.contains("username") || low.contains("логин") {
                "Неверный номер, почта или пароль".to_string()
            } else if low.contains("code") || low.contains("код") {
                "Неверный код. Проверьте его и попробуйте ещё раз.".to_string()
            } else if desc.is_empty() {
                "ВК не принял вход".to_string()
            } else {
                desc.to_string()
            };
            Ok(direct_err(msg))
        }
        "" => Ok(direct_err(format!("Неожиданный ответ ВК: {res}"))),
        _ => Ok(direct_err(if desc.is_empty() { err.to_string() } else { format!("{desc} ({err})") })),
    }
}

/// Убирает браузерные подсказки WebView2 («Сохранённые сведения», сохранение паролей) в окне Melo.
#[cfg(windows)]
fn disable_autofill(w: &tauri::WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
        use windows_core::Interface;
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
                    let _ = s4.SetIsGeneralAutofillEnabled(false);
                    let _ = s4.SetIsPasswordAutosaveEnabled(false);
                }
            }
        }
    });
}
#[cfg(not(windows))]
fn disable_autofill(_w: &tauri::WebviewWindow) {}

/// Где сейчас курсор внутри окна (в CSS-пикселях). Пока тянут полосу прокрутки, страница
/// не получает движений мыши — огонёк спрашивает позицию отсюда.
#[tauri::command]
fn cursor_client(window: tauri::WebviewWindow) -> Option<(f64, f64)> {
    let c = window.cursor_position().ok()?;
    let p = window.inner_position().ok()?;
    let k = window.scale_factor().unwrap_or(1.0);
    Some(((c.x - p.x as f64) / k, (c.y - p.y as f64) / k))
}

/// Отключённое автозаполнение не прячет то, что WebView успел запомнить раньше:
/// сохранённые пароли и введённые номера всё равно подсказываются. Стираем эти базы
/// до запуска WebView (куки и вход ВК лежат в других файлах и не трогаются).
fn forget_autofill(wv: &std::path::Path) {
    let profile = wv.join("EBWebView").join("Default");
    for f in ["Login Data", "Login Data-journal", "Login Data For Account", "Login Data For Account-journal", "Web Data", "Web Data-journal"] {
        let _ = fs::remove_file(profile.join(f));
    }
}

// ---------- Экономия памяти, когда окно скрыто ----------
// Свёрнутое/убранное в трей окно: WebView2 перестаёт рисовать (анимации и canvas
// замирают) и отдаёт лишнюю память системе. Музыка при этом играет как обычно.
static IN_BACKGROUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn set_background(w: &tauri::WebviewWindow, bg: bool) {
    use std::sync::atomic::Ordering;
    if IN_BACKGROUND.swap(bg, Ordering::Relaxed) == bg {
        return;
    }
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let c = wv.controller();
        let _ = c.SetIsVisible(!bg);
        if let Ok(core) = c.CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(if bg {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                });
            }
        }
    });
}
#[cfg(not(windows))]
fn set_background(_w: &tauri::WebviewWindow, _bg: bool) {}

// ---------- Эффекты окна (стекло) ----------

/// "none", "mica", "acrylic", "blur", "tabbed" — системный фон окна Windows под прозрачным интерфейсом.
#[tauri::command]
fn set_window_effect(app: AppHandle, kind: String) -> Result<(), String> {
    use tauri::window::{Effect, EffectsBuilder};
    let w = app.get_webview_window("main").ok_or("нет окна")?;
    *LAST_EFFECT.lock().unwrap() = kind.clone();
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
    release_tray_menu(app);
}

/// Меню трея — отдельный WebView (~100 МБ). Если его минуту не открывали,
/// закрываем совсем; при следующем клике по значку оно создастся заново.
fn release_tray_menu(app: &AppHandle) {
    static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let my = GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        if GEN.load(std::sync::atomic::Ordering::Relaxed) != my {
            return;
        }
        if let Some(w) = app.get_webview_window("tray-menu") {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.destroy();
            }
        }
    });
}

const TRAY_W: f64 = 300.0;
const TRAY_H: f64 = 262.0;

/// Последний выбранный системный фон окна — меню трея создаётся заново и должно выглядеть так же.
static LAST_EFFECT: Mutex<String> = Mutex::new(String::new());

fn create_tray_menu(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    use tauri::window::{Effect, EffectsBuilder};
    let w = create_tray_window(app)?;
    let effect = match LAST_EFFECT.lock().unwrap().as_str() {
        "mica" => Some(Effect::Mica),
        "tabbed" => Some(Effect::Tabbed),
        "acrylic" => Some(Effect::Acrylic),
        _ => None,
    };
    if let Some(e) = effect {
        let _ = w.set_effects(EffectsBuilder::new().effect(e).build());
        let _ = w.set_shadow(true);
    }
    Ok(w)
}

fn create_tray_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, "tray-menu", tauri::WebviewUrl::App("index.html#tray".into()))
        .data_directory(webview_dir())
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
        set_background(&w, false);
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
    // Офлайн-плейлисты: local?p=плейлист/файл и cover?p=плейлист/файл
    if let Some(rest) = req.url().strip_prefix(prefix).map(str::to_string) {
        if rest.starts_with("local?") || rest.starts_with("cover?") {
            let rel = Url::parse(&format!("http://x/{rest}"))
                .ok()
                .and_then(|u| u.query_pairs().find(|(k, _)| k == "p").map(|(_, v)| v.into_owned()));
            let Some(path) = rel.and_then(|r| offline::resolve(&r)) else {
                return fail(req, 404);
            };
            let hs: Vec<tiny_http::Header> = cors.iter().flatten().cloned().collect();
            if rest.starts_with("cover?") {
                offline::serve_cover(req, &path, hs);
            } else {
                offline::serve_file(req, &path, hs);
            }
            return;
        }
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
        Vec::from(bytes)
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

    // Все данные (токены ВК, cookies, настройки) — в папке установки.
    let _ = fs::create_dir_all(data_root());
    migrate_legacy();
    let wv = webview_dir();
    let _ = fs::create_dir_all(&wv);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &wv);
    forget_autofill(&wv);

    tauri::Builder::default()
        // Повторный запуск (ярлык, меню «Пуск») не открывает вторую копию, а показывает уже открытое окно
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(AppState { session: Mutex::new(None), http, anon: Mutex::new(None), stream_base: Mutex::new(String::new()), close_to_tray: std::sync::atomic::AtomicBool::new(false), tray: Mutex::new(TrayState::default()) })
        .setup(|app| {
            cleanup_old_exe();
            let handle = app.handle().clone();
            let session = load_session(&handle);
            *app.state::<AppState>().session.lock().unwrap() = session;
            if app.get_webview_window("main").is_none() {
                if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
                    let w = WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                        .data_directory(webview_dir())
                        .build()?;
                    disable_autofill(&w);
                }
            }
            setup_tray(app)?;
            if let Some(base) = start_stream_server(handle.clone()) {
                *app.state::<AppState>().stream_base.lock().unwrap() = base;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "tray-menu" {
                match event {
                    WindowEvent::Focused(false) => { let _ = window.hide(); release_tray_menu(window.app_handle()); }
                    WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); let _ = window.hide(); release_tray_menu(window.app_handle()); }
                    _ => {}
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            let Some(main) = window.app_handle().get_webview_window("main") else { return };
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.state::<AppState>().close_to_tray.load(std::sync::atomic::Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                        set_background(&main, true);
                    }
                }
                // Свернули/развернули из панели задач
                WindowEvent::Resized(_) => set_background(&main, main.is_minimized().unwrap_or(false)),
                WindowEvent::Focused(true) => set_background(&main, false),
                _ => {}
            }
        })
        .register_asynchronous_uri_scheme_protocol("vkstream", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy(app, request).await);
            });
        })
        .invoke_handler(tauri::generate_handler![offline::offline_root_path, offline::offline_list, offline::offline_playlist, offline::offline_tracks, offline::offline_create, offline::offline_update, offline::offline_delete_playlist, offline::offline_delete_track, offline::offline_add_files, offline::offline_add_paths, offline::offline_pick_cover, offline::offline_open, vk_direct_login, vk_login, vk_browser_login, vk_browser_submit, vk_browser_reopen, vk_browser_cancel, vk_session, vk_logout, vk_call, qr_start, qr_check, qr_submit_code, stream_base, accounts_list, account_switch, account_remove, account_set_info, account_detach, app_info, set_close_to_tray, tray_update, tray_state, tray_action, set_window_effect, update_check, update_install, cursor_client])
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

/// Лучший релиз из ответа GitHub API: самая новая версия, у которой уже загружен Melo.exe
/// (пока CI собирает релиз, файла в нём ещё нет — такой релиз пропускаем).
fn pick_release(list: &[Value]) -> Option<(&Value, &Value)> {
    list.iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false) && !r["prerelease"].as_bool().unwrap_or(false))
        .filter_map(|r| {
            let a = r["assets"].as_array()?.iter().find(|x| {
                x["name"].as_str().map(|n| n.eq_ignore_ascii_case("Melo.exe")).unwrap_or(false)
                    && x["state"].as_str().unwrap_or("uploaded") == "uploaded"
            })?;
            Some((r, a))
        })
        .max_by(|x, y| {
            let v = |r: &Value| parse_ver(r["tag_name"].as_str().unwrap_or_default());
            v(x.0).cmp(&v(y.0))
        })
}

#[tauri::command]
async fn update_check(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let api = |url: String| {
        state
            .http
            .get(url)
            .header("User-Agent", "Melo-updater")
            .header("Accept", "application/vnd.github+json")
            .header("Cache-Control", "no-cache")
            .timeout(Duration::from_secs(15))
            .send()
    };
    let mut last_err = String::new();
    // 1) GitHub API: список последних релизов (надёжнее, чем /latest — тот кешируется и
    //    может указывать на релиз, в который ещё не загружен exe)
    for attempt in 0..2 {
        match api(format!("https://api.github.com/repos/{UPDATE_REPO}/releases?per_page=10")).await {
            Ok(r) if r.status().is_success() => {
                let list: Vec<Value> = r.json().await.unwrap_or_default();
                if let Some((rel, asset)) = pick_release(&list) {
                    let version = rel["tag_name"].as_str().unwrap_or_default().trim_start_matches(['v', 'V']).to_string();
                    return Ok(UpdateInfo {
                        available: parse_ver(&version) > parse_ver(&current),
                        current,
                        version,
                        notes: rel["body"].as_str().unwrap_or_default().to_string(),
                        url: asset["browser_download_url"].as_str().unwrap_or_default().to_string(),
                        size: asset["size"].as_u64().unwrap_or(0),
                        digest: asset["digest"].as_str().map(|d| d.trim_start_matches("sha256:").to_lowercase()),
                        page: rel["html_url"].as_str().unwrap_or_default().to_string(),
                    });
                }
                last_err = "На GitHub пока нет релизов".into();
                break;
            }
            Ok(r) => {
                last_err = format!("GitHub ответил {}", r.status());
                // 403/429 — лимит запросов к API, повтор не поможет: идём запасным путём
                if matches!(r.status().as_u16(), 403 | 429) {
                    break;
                }
            }
            Err(e) => last_err = format!("Нет связи с GitHub: {e}"),
        }
        if attempt == 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
    // 2) Запасной путь без API и без лимитов: страница последнего релиза перенаправляет на /tag/vX.Y.Z
    let page = state
        .http
        .get(format!("https://github.com/{UPDATE_REPO}/releases/latest"))
        .header("User-Agent", "Melo-updater")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| if last_err.is_empty() { format!("Нет связи с GitHub: {e}") } else { last_err.clone() })?;
    let final_url = page.url().to_string();
    let tag = final_url.rsplit("/tag/").next().filter(|t| !t.contains('/') && final_url.contains("/tag/")).ok_or(last_err.clone())?.to_string();
    let url = format!("https://github.com/{UPDATE_REPO}/releases/download/{tag}/Melo.exe");
    let head = state.http.head(&url).header("User-Agent", "Melo-updater").timeout(Duration::from_secs(15)).send().await;
    let ok = head.as_ref().map(|r| r.status().is_success()).unwrap_or(false);
    let size = head.ok().and_then(|r| r.content_length()).unwrap_or(0);
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    Ok(UpdateInfo {
        available: ok && parse_ver(&version) > parse_ver(&current),
        current,
        version,
        notes: String::new(),
        url: if ok { url } else { String::new() },
        size,
        digest: None,
        page: final_url,
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
