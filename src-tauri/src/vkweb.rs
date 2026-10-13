//! Вход по QR-коду «как на сайте ВК» (так же работает Meridius).
//!
//! После подтверждения на телефоне приложение получает обычный вход на vk.ru — куки, как у браузера.
//! Куки хранятся в файле, и из них в любой момент берётся свежий ключ (login.vk.ru/?act=web_token) —
//! это не попытка входа, ВК его не ограничивает, поэтому сессия не слетает неделями.

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ORIGIN, REFERER};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use serde_json::Value;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Приложение «ВКонтакте» для сайта: на него выдаётся ключ из куки
pub const WEB_APP: &str = "6287487";
const ID_APP: &str = "7913379";
const QR_V: &str = "5.258";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";

#[derive(Clone)]
pub struct WebClient {
    pub jar: Arc<CookieStoreMutex>,
    pub http: reqwest::Client,
}

impl WebClient {
    pub fn with_store(store: CookieStore) -> Result<Self, String> {
        let jar = Arc::new(CookieStoreMutex::new(store));
        let mut h = HeaderMap::new();
        h.insert(ACCEPT, HeaderValue::from_static("*/*"));
        h.insert("Accept-Language", HeaderValue::from_static("ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"));
        let http = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(UA)
            .default_headers(h)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { jar, http })
    }

    pub fn fresh() -> Result<Self, String> {
        Self::with_store(CookieStore::default())
    }

    pub fn load(path: &Path) -> Option<Self> {
        let f = fs::File::open(path).ok()?;
        let store = cookie_store::serde::json::load_all(BufReader::new(f)).ok()?;
        Self::with_store(store).ok()
    }

    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = path.with_extension("tmp");
        let ok = (|| -> Option<()> {
            let mut f = fs::File::create(&tmp).ok()?;
            let store = self.jar.lock().ok()?;
            cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut f).ok()
        })();
        if ok.is_some() {
            let _ = fs::rename(&tmp, path);
        }
    }
}

pub fn cookies_path(root: &Path, user_id: i64) -> PathBuf {
    root.join("vk-web").join(format!("{user_id}.json"))
}

/// Незавершённый вход по QR
#[derive(Clone)]
pub struct WebQr {
    pub client: WebClient,
    pub host_app: String,
    pub anon: String,
    pub auth_hash: String,
    pub uuid: String,
}

fn rand_str(len: usize, alphabet: &[u8]) -> String {
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1)
        ^ 0x9E37_79B9_7F4A_7C15;
    (0..len)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            alphabet[(seed % alphabet.len() as u64) as usize] as char
        })
        .collect()
}

fn b64(s: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b = s.as_bytes();
    let mut out = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18 & 63) as usize] as char);
        out.push(T[(n >> 12 & 63) as usize] as char);
        out.push(if c.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn net_err(_: reqwest::Error) -> String {
    "Нет соединения с ВКонтакте".into()
}

fn parse_json(text: &str) -> Value {
    let t = text.trim_start().trim_start_matches("<!--");
    serde_json::from_str(t).unwrap_or(Value::Null)
}

impl WebClient {
    async fn post_id(&self, url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
        let text = self
            .http
            .post(url)
            .header(ORIGIN, "https://id.vk.ru")
            .header(REFERER, "https://id.vk.ru/")
            .header("Priority", "u=1, i")
            .form(form)
            .send()
            .await
            .map_err(net_err)?
            .text()
            .await
            .map_err(net_err)?;
        Ok(parse_json(&text))
    }

    async fn api(&self, method: &str, host_app: &str, form: &[(&str, &str)]) -> Result<Value, String> {
        let url = format!("https://api.vk.ru/method/{method}?v={QR_V}&client_id={host_app}");
        let v = self.post_id(&url, form).await?;
        if let Some(e) = v.get("error") {
            return Err(e["error_msg"].as_str().unwrap_or("Ошибка ВКонтакте").to_string());
        }
        Ok(v)
    }

    /// Свежий ключ доступа из куки. Ok((ключ, id, когда истечёт))
    pub async fn web_token(&self) -> Result<(String, i64, Option<i64>), String> {
        let ver = "1";
        let v = self
            .post_id("https://login.vk.ru/?act=web_token", &[("version", ver), ("app_id", WEB_APP)])
            .await?;
        let d = &v["data"];
        let Some(token) = d["access_token"].as_str().filter(|t| !t.is_empty()) else {
            let why = v["error_info"].as_str().or(v["error_code"].as_str()).or(v["type"].as_str()).unwrap_or("нет ответа");
            return Err(format!("web_token: {why}"));
        };
        let uid = d["user_id"]
            .as_i64()
            .or(d["auth_info"]["user"]["id"].as_i64())
            .or(d["auth_info"]["user_id"].as_i64())
            .unwrap_or(0);
        let exp = d["expires"].as_i64().filter(|&e| e > 0);
        Ok((token.to_string(), uid, exp))
    }
}

/// Начинает вход: открывает страницу id.vk.ru (как браузер) и создаёт QR-код.
/// Ok((вход, ссылка для QR, когда истечёт))
pub async fn qr_start() -> Result<(WebQr, String, i64), String> {
    let client = WebClient::fresh()?;
    let uuid = rand_str(6, b"abcdefghijklmnopqrstuvwxyz");
    let action = b64(r#"{"name":"qr_auth","token":"qr_auth_scanned","entry":{"source":"main","screen":"start"}}"#);
    let page = client
        .http
        .get("https://id.vk.ru/auth")
        .header("Priority", "u=0, i")
        .query(&[
            ("action", action.as_str()),
            ("scheme", "dark"),
            ("is_redesigned", "1"),
            ("response_type", "silent_token"),
            ("v", "1.3.0"),
            ("redirect_uri", "https://vk.ru/"),
            ("uuid", uuid.as_str()),
            ("app_id", ID_APP),
        ])
        .send()
        .await
        .map_err(net_err)?
        .text()
        .await
        .map_err(net_err)?;
    let at = page.find("window.init = ").ok_or("Страница входа ВК не открылась")?;
    let init: Value = serde_json::Deserializer::from_str(&page[at + 14..])
        .into_iter::<Value>()
        .next()
        .and_then(|r| r.ok())
        .ok_or("Страница входа ВК не открылась")?;
    let auth = &init["auth"];
    let host_app = auth["host_app_id"]
        .as_i64()
        .map(|x| x.to_string())
        .or(auth["host_app_id"].as_str().map(String::from))
        .unwrap_or_else(|| ID_APP.into());
    let anon = auth["anonymous_token"].as_str().ok_or("ВК не выдал QR-код")?.to_string();
    let r = client
        .api(
            "auth.getAuthCode",
            &host_app,
            &[
                ("device_name", "Windows NT 10.0; Win64; x64"),
                ("auth_code_flow", "0"),
                ("verification_hash", ""),
                ("force_regenerate", "0"),
                ("anonymous_token", anon.as_str()),
                ("is_switcher_flow", ""),
                ("access_token", ""),
            ],
        )
        .await?;
    let r = &r["response"];
    let url = r["auth_url"].as_str().ok_or("ВК не выдал QR-код")?.to_string();
    let auth_hash = r["auth_hash"].as_str().unwrap_or_default().to_string();
    let exp = r["expires_in"].as_i64().unwrap_or(0);
    Ok((WebQr { client, host_app, anon, auth_hash, uuid }, url, exp))
}

pub enum Check {
    /// 0 — ждём, 1 — открыт на телефоне, 3 — отклонён, 4 — истёк, 5 — нужен код
    Status(i64),
    /// Вход завершён: куки получены
    Done,
}

pub async fn qr_check(q: &WebQr) -> Result<Check, String> {
    let r = q
        .client
        .api(
            "auth.checkAuthCode",
            &q.host_app,
            &[("auth_hash", q.auth_hash.as_str()), ("web_auth", "1"), ("anonymous_token", q.anon.as_str()), ("access_token", "")],
        )
        .await?;
    let st = r["response"]["status"].as_i64().unwrap_or(0);
    if st != 2 {
        return Ok(Check::Status(st));
    }
    let sat = r["response"]["super_app_token"].as_str().unwrap_or_default().to_string();
    let to = b64("https://vk.ru/");
    let v = q
        .client
        .post_id(
            "https://login.vk.ru/?act=connect_code_auth",
            &[
                ("token", sat.as_str()),
                ("uuid", q.uuid.as_str()),
                ("app_id", q.host_app.as_str()),
                ("flow_start_state", ""),
                ("is_external_carousel", ""),
                ("oauth_version", ""),
                ("sid", ""),
                ("oauth_force_hash", "0"),
                ("is_registration", "0"),
                ("oauth_response_type", "silent_token"),
                ("vkid_oauth_hash", ""),
                ("is_oauth_migrated_flow", "0"),
                ("oauth_state", ""),
                ("to", to.as_str()),
                ("version", "1"),
            ],
        )
        .await?;
    if v["type"].as_str() == Some("error") || !v["data"].is_object() {
        let code = v["error_code"].as_str().or(v["error_info"].as_str()).unwrap_or("нет ответа");
        if code.contains("bruteforce") || code.contains("flood") {
            return Err("ВК временно ограничил вход в этот аккаунт: за короткое время было слишком много входов. \
                        Это защита ВК, она снимается сама — попробуйте снова через 30–60 минут."
                .into());
        }
        return Err(format!("Не удалось завершить вход ({code})"));
    }
    if let Some(next) = v["data"]["next_step_url"].as_str().filter(|u| !u.is_empty()) {
        // Здесь ВК ставит куки входа (переходы с перенаправлениями проходят сами)
        let _ = q.client.http.get(next).header("Priority", "u=0, i").send().await.map_err(net_err)?.text().await;
    }
    Ok(Check::Done)
}

pub async fn qr_validate(q: &WebQr, code: &str) -> Result<Value, String> {
    q.client
        .api(
            "auth.validateAuthCode",
            &q.host_app,
            &[("auth_hash", q.auth_hash.as_str()), ("validation_code", code), ("access_token", q.anon.as_str())],
        )
        .await
}
