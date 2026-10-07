// Melo API — аккаунты, вход (ВК / почта / Google) и синхронизация.
// Cloudflare Worker + D1. Без внешних зависимостей.

export interface Env {
  DB: D1Database;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Только для локальной разработки: код из письма пишется в лог. */
  DEV_EMAIL_LOG?: string;
}

const DAY = 86400;
const SESSION_TTL = 180 * DAY;
const now = () => Math.floor(Date.now() / 1000);

// ---------- Утилиты ----------

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src https: data:; connect-src https://challenges.cloudflare.com",
      "X-Content-Type-Options": "nosniff",
    },
  });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const randomCode = () => {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
};

async function body<T = Record<string, unknown>>(req: Request, max = 512 * 1024): Promise<T> {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > max) throw new HttpError(413, "too_large");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too_large");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ip = (req: Request) => req.headers.get("CF-Connecting-IP") || "local";

/** Не больше `limit` событий за `windowSec` секунд для ключа. */
async function rateLimit(env: Env, key: string, limit: number, windowSec: number) {
  const w = Math.floor(now() / windowSec) * windowSec;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, win_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN win_start = ?2 THEN count + 1 ELSE 1 END,
       win_start = ?2
     RETURNING count`,
  ).bind(key, w).first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new HttpError(429, "rate_limited", "Слишком много попыток, подождите немного");
}

// ---------- Пользователи и сессии ----------

type User = { id: string; name: string | null; avatar: string | null; created_at: number };

async function createSession(env: Env, userId: string, device: string) {
  const token = randomToken();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, device, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(await sha256(token), userId, device.slice(0, 80), t, t, t + SESSION_TTL).run();
  return token;
}

async function authUser(env: Env, req: Request): Promise<User | null> {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar, u.created_at, s.last_seen, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(hash).first<User & { last_seen: number; expires_at: number }>();
  if (!row || row.expires_at < now()) return null;
  // Продлеваем сессию не чаще раза в сутки, чтобы не тратить записи
  if (now() - row.last_seen > DAY) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?").bind(now(), now() + SESSION_TTL, hash),
      env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now(), row.id),
    ]);
  }
  return { id: row.id, name: row.name, avatar: row.avatar, created_at: row.created_at };
}

async function requireUser(env: Env, req: Request) {
  const u = await authUser(env, req);
  if (!u) throw new HttpError(401, "unauthorized");
  return u;
}

/**
 * Найти пользователя по способу входа или создать нового.
 * Если передан linkTo — привязать способ входа к этому пользователю.
 */
async function signIn(
  env: Env,
  provider: "vk" | "email" | "google",
  subject: string,
  profile: { name?: string; avatar?: string; label?: string },
  linkTo: User | null,
): Promise<{ user: User; created: boolean }> {
  const t = now();
  const existing = await env.DB.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?")
    .bind(provider, subject).first<{ user_id: string }>();

  if (linkTo) {
    if (existing && existing.user_id !== linkTo.id) throw new HttpError(409, "identity_taken", "Этот способ входа уже привязан к другому аккаунту Melo");
    if (!existing) {
      await env.DB.prepare("INSERT INTO identities (provider, subject, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(provider, subject, linkTo.id, profile.label ?? null, t).run();
    }
    if (!linkTo.avatar && profile.avatar) {
      await env.DB.prepare("UPDATE users SET avatar = ? WHERE id = ?").bind(profile.avatar, linkTo.id).run();
      linkTo.avatar = profile.avatar;
    }
    return { user: linkTo, created: false };
  }

  if (existing) {
    const user = await env.DB.prepare("SELECT id, name, avatar, created_at FROM users WHERE id = ?").bind(existing.user_id).first<User>();
    if (user) {
      // Обновляем подпись способа входа (например, новое имя в ВК)
      if (profile.label) await env.DB.prepare("UPDATE identities SET label = ? WHERE provider = ? AND subject = ?").bind(profile.label, provider, subject).run();
      return { user, created: false };
    }
  }

  const id = crypto.randomUUID();
  const user: User = { id, name: profile.name?.slice(0, 64) || null, avatar: profile.avatar || null, created_at: t };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, avatar, created_at, last_seen) VALUES (?, ?, ?, ?, ?)").bind(id, user.name, user.avatar, t, t),
    env.DB.prepare("INSERT INTO identities (provider, subject, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(provider, subject, id, profile.label ?? null, t),
  ]);
  return { user, created: true };
}

async function userPayload(env: Env, user: User) {
  const ids = await env.DB.prepare("SELECT provider, label, created_at FROM identities WHERE user_id = ? ORDER BY created_at")
    .bind(user.id).all<{ provider: string; label: string | null; created_at: number }>();
  return { id: user.id, name: user.name, avatar: user.avatar, created_at: user.created_at, identities: ids.results };
}

async function loginResponse(env: Env, req: Request, user: User, created: boolean, linked: boolean) {
  const token = linked ? null : await createSession(env, user.id, str(req.headers.get("User-Agent"), 80));
  return json({ token, created, user: await userPayload(env, user) });
}

// ---------- Защита от ботов (Cloudflare Turnstile) ----------

async function checkTurnstile(env: Env, req: Request, token: string) {
  if (!env.TURNSTILE_SECRET) return; // не настроено — пропускаем (локальная разработка)
  if (!token) throw new HttpError(400, "captcha_required", "Подтвердите, что вы не робот");
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip(req));
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await r.json()) as { success: boolean };
  if (!data.success) throw new HttpError(400, "captcha_failed", "Проверка на робота не пройдена, попробуйте ещё раз");
}

function turnstilePage(env: Env, lang: string) {
  const key = env.TURNSTILE_SITE_KEY || "";
  return html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>html,body{margin:0;background:transparent;display:flex;justify-content:center;align-items:center;min-height:100%;overflow:hidden}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ready&render=explicit" async defer></script>
<script>
function send(m){parent.postMessage(Object.assign({source:"melo-turnstile"},m),"*")}
function ready(){turnstile.render("#w",{sitekey:${JSON.stringify(key)},theme:"dark",language:${JSON.stringify(lang === "en" ? "en" : "ru")},
 callback:function(t){send({token:t})},"expired-callback":function(){send({token:""})},"error-callback":function(){send({error:true})}})}
addEventListener("message",function(e){if(e.data==="melo-turnstile-reset"&&window.turnstile)turnstile.reset("#w")});
</script></head><body><div id="w"></div></body></html>`);
}

// ---------- Вход через ВКонтакте ----------

const VK_UA: Record<string, string> = {
  kate: "KateMobileAndroid/109.1 lite-550 (Android 13; SDK 33; arm64-v8a; Google Pixel 5; ru)",
  vk_android: "VKAndroidApp/8.52-14102 (Android 13; SDK 33; arm64-v8a; Google Pixel 5; ru; 2400x1080; No Cellular)",
};

async function authVk(env: Env, req: Request) {
  await rateLimit(env, `vk:${ip(req)}`, 30, 600);
  const b = await body<{ vk_token?: string; client?: string }>(req, 4096);
  const token = str(b.vk_token, 500);
  if (!token) throw new HttpError(400, "vk_token_required");
  // Проверяем токен у самого ВК и узнаём, чей он. Сам токен нигде не сохраняется.
  const form = new URLSearchParams({ access_token: token, v: "5.131", fields: "photo_100" });
  const r = await fetch("https://api.vk.com/method/users.get", {
    method: "POST",
    body: form,
    headers: { "User-Agent": VK_UA[b.client ?? ""] ?? VK_UA.kate },
  });
  const data = (await r.json().catch(() => ({}))) as { response?: { id: number; first_name: string; last_name: string; photo_100?: string }[] };
  const u = data.response?.[0];
  if (!u?.id) throw new HttpError(401, "vk_invalid", "ВКонтакте не подтвердил вход");
  const name = `${u.first_name} ${u.last_name}`.trim();
  const avatar = u.photo_100 && !u.photo_100.includes("camera_") ? u.photo_100 : undefined;
  const linkTo = await authUser(env, req);
  const { user, created } = await signIn(env, "vk", String(u.id), { name: u.first_name, avatar, label: name }, linkTo);
  return loginResponse(env, req, user, created, !!linkTo);
}

// ---------- Вход по почте ----------

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

async function sendEmail(env: Env, to: string, code: string, lang: string) {
  const ru = lang !== "en";
  const subject = ru ? `Код входа в Melo: ${code}` : `Your Melo sign-in code: ${code}`;
  const text = ru
    ? `Ваш код для входа в Melo: ${code}\n\nОн действует 10 минут. Если вы не входили в Melo — просто проигнорируйте письмо.`
    : `Your Melo sign-in code: ${code}\n\nIt expires in 10 minutes. If you didn't try to sign in, just ignore this email.`;
  const htmlBody = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#12131a;color:#fff;border-radius:16px">
<h2 style="margin:0 0 8px">Melo</h2><p style="color:#bbb">${ru ? "Ваш код для входа:" : "Your sign-in code:"}</p>
<div style="font-size:34px;letter-spacing:8px;font-weight:700;margin:16px 0">${code}</div>
<p style="color:#888;font-size:13px">${ru ? "Код действует 10 минут. Если вы не входили в Melo — проигнорируйте письмо." : "The code expires in 10 minutes. If you didn't try to sign in, ignore this email."}</p></div>`;

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (env.DEV_EMAIL_LOG) {
      console.log(`[dev] код для ${to}: ${code}`);
      return;
    }
    throw new HttpError(503, "email_disabled", "Вход по почте пока не настроен");
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html: htmlBody }),
  });
  if (!r.ok) {
    console.log("resend error", r.status, await r.text());
    throw new HttpError(502, "email_failed", "Не удалось отправить письмо, попробуйте позже");
  }
}

const emailEnabled = (env: Env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM) || !!env.DEV_EMAIL_LOG;

async function emailStart(env: Env, req: Request) {
  const b = await body<{ email?: string; captcha?: string; lang?: string }>(req, 8192);
  const email = str(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "bad_email", "Проверьте адрес почты");
  if (!emailEnabled(env)) throw new HttpError(503, "email_disabled", "Вход по почте пока не настроен");
  await rateLimit(env, `mail-ip:${ip(req)}`, 10, 3600);
  await checkTurnstile(env, req, str(b.captcha, 4096));
  await rateLimit(env, `mail-to:${email}`, 5, 3600);

  const prev = await env.DB.prepare("SELECT sent_at FROM email_codes WHERE email = ?").bind(email).first<{ sent_at: number }>();
  if (prev && now() - prev.sent_at < 60) throw new HttpError(429, "too_soon", "Новый код можно запросить через минуту");

  const code = randomCode();
  await env.DB.prepare(
    `INSERT INTO email_codes (email, code_hash, attempts, sent_at, expires_at) VALUES (?1, ?2, 0, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET code_hash = ?2, attempts = 0, sent_at = ?3, expires_at = ?4`,
  ).bind(email, await sha256(`${email}:${code}`), now(), now() + 600).run();
  await sendEmail(env, email, code, str(b.lang, 4));
  return json({ ok: true, expires_in: 600 });
}

async function emailVerify(env: Env, req: Request) {
  await rateLimit(env, `verify:${ip(req)}`, 30, 600);
  const b = await body<{ email?: string; code?: string }>(req, 4096);
  const email = str(b.email, 254).toLowerCase();
  const code = str(b.code, 12).replace(/\D/g, "");
  const row = await env.DB.prepare("SELECT code_hash, attempts, expires_at FROM email_codes WHERE email = ?")
    .bind(email).first<{ code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now()) throw new HttpError(400, "code_expired", "Код устарел, запросите новый");
  if (row.attempts >= 5) throw new HttpError(400, "code_locked", "Слишком много попыток, запросите новый код");
  if ((await sha256(`${email}:${code}`)) !== row.code_hash) {
    await env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    throw new HttpError(400, "code_wrong", "Неверный код");
  }
  await env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(email).run();
  const linkTo = await authUser(env, req);
  const { user, created } = await signIn(env, "email", email, { name: email.split("@")[0], label: email }, linkTo);
  return loginResponse(env, req, user, created, !!linkTo);
}

// ---------- Вход через Google (в системном браузере) ----------

const googleEnabled = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

async function googleInit(env: Env, req: Request, origin: string) {
  if (!googleEnabled(env)) throw new HttpError(503, "google_disabled", "Вход через Google пока не настроен");
  await rateLimit(env, `google:${ip(req)}`, 20, 600);
  const b = await body<{ poll_secret?: string }>(req, 4096);
  const pollSecret = str(b.poll_secret, 200);
  if (pollSecret.length < 20) throw new HttpError(400, "poll_secret_required");
  const linkTo = await authUser(env, req);
  const id = randomToken(18);
  const verifier = randomToken(48);
  await env.DB.prepare(
    "INSERT INTO login_requests (id, poll_hash, verifier, link_user, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, await sha256(pollSecret), verifier, linkTo?.id ?? null, now(), now() + 600).run();
  return json({ id, url: `${origin}/auth/google/go?id=${id}`, expires_in: 600 });
}

async function googleGo(env: Env, url: URL, origin: string) {
  const id = url.searchParams.get("id") || "";
  const row = await env.DB.prepare("SELECT verifier, expires_at FROM login_requests WHERE id = ?").bind(id).first<{ verifier: string; expires_at: number }>();
  if (!row || row.expires_at < now()) return resultPage("Ссылка для входа устарела. Вернитесь в Melo и попробуйте ещё раз.", false);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state: id,
    code_challenge: await sha256(row.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
}

async function googleCallback(env: Env, url: URL, origin: string) {
  const id = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const row = await env.DB.prepare("SELECT verifier, link_user, expires_at, user_id FROM login_requests WHERE id = ?")
    .bind(id).first<{ verifier: string; link_user: string | null; expires_at: number; user_id: string | null }>();
  if (!row || row.expires_at < now() || row.user_id) return resultPage("Ссылка для входа устарела. Вернитесь в Melo и попробуйте ещё раз.", false);
  const fail = async (msg: string) => {
    await env.DB.prepare("UPDATE login_requests SET error = ? WHERE id = ?").bind(msg, id).run();
    return resultPage(msg, false);
  };
  if (!code) return fail("Вход через Google отменён.");

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: row.verifier,
    }),
  });
  const tok = (await tr.json().catch(() => ({}))) as { access_token?: string };
  if (!tok.access_token) return fail("Google не подтвердил вход. Попробуйте ещё раз.");
  const ur = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const info = (await ur.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; given_name?: string; name?: string; picture?: string };
  if (!info.sub) return fail("Google не вернул данные аккаунта.");

  let linkTo: User | null = null;
  if (row.link_user) linkTo = await env.DB.prepare("SELECT id, name, avatar, created_at FROM users WHERE id = ?").bind(row.link_user).first<User>();
  try {
    const { user } = await signIn(env, "google", info.sub, { name: info.given_name || info.name, avatar: info.picture, label: info.email || info.name }, linkTo);
    await env.DB.prepare("UPDATE login_requests SET user_id = ? WHERE id = ?").bind(user.id, id).run();
  } catch (e) {
    return fail(e instanceof HttpError ? e.message : "Не удалось войти.");
  }
  return resultPage("Готово! Можно закрыть эту вкладку и вернуться в Melo.", true);
}

async function googlePoll(env: Env, req: Request) {
  const b = await body<{ id?: string; poll_secret?: string }>(req, 4096);
  const id = str(b.id, 64);
  const row = await env.DB.prepare("SELECT poll_hash, user_id, link_user, error, expires_at FROM login_requests WHERE id = ?")
    .bind(id).first<{ poll_hash: string; user_id: string | null; link_user: string | null; error: string | null; expires_at: number }>();
  if (!row || row.poll_hash !== (await sha256(str(b.poll_secret, 200)))) throw new HttpError(404, "not_found");
  if (row.expires_at < now()) return json({ state: "expired" });
  if (row.error) {
    await env.DB.prepare("DELETE FROM login_requests WHERE id = ?").bind(id).run();
    return json({ state: "error", message: row.error });
  }
  if (!row.user_id) return json({ state: "waiting" });
  await env.DB.prepare("DELETE FROM login_requests WHERE id = ?").bind(id).run();
  const user = await env.DB.prepare("SELECT id, name, avatar, created_at FROM users WHERE id = ?").bind(row.user_id).first<User>();
  if (!user) throw new HttpError(404, "not_found");
  const linked = !!row.link_user;
  const token = linked ? null : await createSession(env, user.id, str(req.headers.get("User-Agent"), 80));
  return json({ state: "ok", token, user: await userPayload(env, user) });
}

function resultPage(msg: string, ok: boolean) {
  return html(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Melo</title><meta name="viewport" content="width=device-width">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,system-ui,sans-serif;color:#fff;
background:radial-gradient(800px 500px at 20% 0%,#1d2a5c,transparent 70%),radial-gradient(700px 500px at 100% 100%,#2a1f5e,transparent 70%),#0a0f28}
.c{padding:40px 48px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(20px);text-align:center;max-width:420px}
.i{font-size:44px}h1{margin:12px 0 8px;font-size:24px}p{color:rgba(255,255,255,.7);line-height:1.5}</style></head>
<body><div class="c"><div class="i">${ok ? "✅" : "⚠️"}</div><h1>Melo</h1><p>${esc(msg)}</p></div></body></html>`, ok ? 200 : 400);
}

// ---------- Аккаунт ----------

async function logout(env: Env, req: Request) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/);
  if (m) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(m[1])).run();
  return json({ ok: true });
}

async function unlink(env: Env, user: User, provider: string) {
  const ids = await env.DB.prepare("SELECT provider FROM identities WHERE user_id = ?").bind(user.id).all<{ provider: string }>();
  if (ids.results.length <= 1) throw new HttpError(400, "last_identity", "Нельзя отвязать единственный способ входа");
  await env.DB.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").bind(user.id, provider).run();
  return json({ user: await userPayload(env, user) });
}

// ---------- Синхронизация ----------

type TrackRef = {
  source: string; id: string; title: string; artist: string;
  album?: string; cover?: string; duration?: number; explicit?: boolean;
  ownerId?: number; audioId?: number; accessKey?: string;
};

function cleanTrack(t: unknown): TrackRef | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  const title = str(o.title, 300), artist = str(o.artist, 300), id = str(o.id, 100);
  if (!title || !id) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const r: TrackRef = { source: str(o.source, 20) || "vk", id, title, artist };
  const album = str(o.album, 300); if (album) r.album = album;
  const cover = str(o.cover, 600); if (cover.startsWith("https://")) r.cover = cover;
  const accessKey = str(o.accessKey, 100); if (accessKey) r.accessKey = accessKey;
  if (num(o.duration) !== undefined) r.duration = Math.round(num(o.duration)!);
  if (num(o.ownerId) !== undefined) r.ownerId = num(o.ownerId);
  if (num(o.audioId) !== undefined) r.audioId = num(o.audioId);
  if (o.explicit === true) r.explicit = true;
  return r;
}

const trackKey = (t: { artist: string; title: string }) => `${t.artist}|${t.title}`.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);

async function getSettings(env: Env, user: User) {
  const row = await env.DB.prepare("SELECT data, updated_at FROM settings WHERE user_id = ?").bind(user.id).first<{ data: string; updated_at: number }>();
  return json(row ? { data: JSON.parse(row.data), updated_at: row.updated_at } : { data: null, updated_at: 0 });
}

async function putSettings(env: Env, req: Request, user: User) {
  const b = await body<{ data?: unknown }>(req, 64 * 1024);
  if (!b.data || typeof b.data !== "object") throw new HttpError(400, "bad_settings");
  const t = Date.now();
  await env.DB.prepare(
    "INSERT INTO settings (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3",
  ).bind(user.id, JSON.stringify(b.data), t).run();
  return json({ ok: true, updated_at: t });
}

type PlRow = { id: string; title: string; tracks: string; share_slug: string | null; created_at: number; updated_at: number };
const plOut = (r: PlRow, withTracks = true) => {
  const tracks = JSON.parse(r.tracks) as TrackRef[];
  return {
    id: r.id, title: r.title, count: tracks.length, cover: tracks.find((t) => t.cover)?.cover ?? null,
    shared: !!r.share_slug, share_slug: r.share_slug, created_at: r.created_at, updated_at: r.updated_at,
    ...(withTracks ? { tracks } : {}),
  };
};

async function listPlaylists(env: Env, user: User) {
  const rows = await env.DB.prepare("SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC").bind(user.id).all<PlRow>();
  return json({ items: rows.results.map((r) => plOut(r, false)) });
}

async function getPlaylist(env: Env, user: User, id: string) {
  const r = await env.DB.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").bind(id, user.id).first<PlRow>();
  if (!r) throw new HttpError(404, "not_found", "Плейлист не найден");
  return json(plOut(r));
}

async function savePlaylist(env: Env, req: Request, user: User, id: string | null) {
  const b = await body<{ title?: string; tracks?: unknown[] }>(req, 1024 * 1024);
  const t = Date.now();
  const tracks = Array.isArray(b.tracks) ? b.tracks.slice(0, 5000).map(cleanTrack).filter(Boolean) : null;
  const title = str(b.title, 120);
  if (!id) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?").bind(user.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 500) throw new HttpError(400, "too_many", "Слишком много плейлистов");
    const nid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO playlists (id, user_id, title, tracks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(nid, user.id, title || "Новый плейлист", JSON.stringify(tracks ?? []), t, t).run();
    return getPlaylist(env, user, nid);
  }
  const res = await env.DB.prepare(
    `UPDATE playlists SET title = COALESCE(?, title), tracks = COALESCE(?, tracks), updated_at = ? WHERE id = ? AND user_id = ?`,
  ).bind(title || null, tracks ? JSON.stringify(tracks) : null, t, id, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, "not_found", "Плейлист не найден");
  return getPlaylist(env, user, id);
}

async function deletePlaylist(env: Env, user: User, id: string) {
  await env.DB.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  return json({ ok: true });
}

async function sharePlaylist(env: Env, req: Request, user: User, id: string) {
  const b = await body<{ enabled?: boolean }>(req, 1024);
  const slug = b.enabled === false ? null : randomToken(9);
  const res = await env.DB.prepare(
    "UPDATE playlists SET share_slug = CASE WHEN ?1 IS NULL THEN NULL ELSE COALESCE(share_slug, ?1) END WHERE id = ?2 AND user_id = ?3",
  ).bind(slug, id, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, "not_found", "Плейлист не найден");
  return getPlaylist(env, user, id);
}

async function sharedPlaylist(env: Env, slug: string, req: Request) {
  const r = await env.DB.prepare(
    "SELECT p.*, u.name AS owner FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.share_slug = ?",
  ).bind(slug).first<PlRow & { owner: string | null }>();
  if (!r) throw new HttpError(404, "not_found", "Плейлист не найден или ссылка отключена");
  const out = { ...plOut(r), owner: r.owner, share_slug: undefined, id: undefined };
  if ((req.headers.get("Accept") || "").includes("application/json")) return json(out);
  const rows = (out.tracks as TrackRef[]).map((t, i) =>
    `<li><span class="n">${i + 1}</span><span><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span></li>`).join("");
  return html(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(r.title)} — Melo</title><meta name="viewport" content="width=device-width">
<style>body{margin:0;font-family:Segoe UI,system-ui,sans-serif;color:#fff;min-height:100vh;
background:radial-gradient(800px 500px at 20% 0%,#1d2a5c,transparent 70%),radial-gradient(700px 500px at 100% 100%,#2a1f5e,transparent 70%),#0a0f28}
main{max-width:640px;margin:0 auto;padding:48px 20px}h1{margin:4px 0}.s{color:rgba(255,255,255,.6)}
ol{list-style:none;padding:0;margin:28px 0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px}
li{display:flex;gap:16px;align-items:center;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.06)}li:last-child{border:0}
.n{width:24px;color:rgba(255,255,255,.4);text-align:right}small{display:block;color:rgba(255,255,255,.55)}
a{color:#9ec5ff}</style></head><body><main><div class="s">Плейлист Melo${r.owner ? ` · ${esc(r.owner)}` : ""}</div>
<h1>${esc(r.title)}</h1><div class="s">Треков: ${out.count}</div><ol>${rows}</ol>
<p class="s">Откройте Melo → Плейлисты → «Импорт по ссылке» и вставьте адрес этой страницы. <a href="https://github.com/wtf40iq/Melo">Скачать Melo</a></p></main></body></html>`);
}

async function importPlaylist(env: Env, req: Request, user: User) {
  const b = await body<{ slug?: string }>(req, 2048);
  const slug = str(b.slug, 300).split("/").pop()!.split("?")[0];
  const r = await env.DB.prepare("SELECT title, tracks FROM playlists WHERE share_slug = ?").bind(slug).first<{ title: string; tracks: string }>();
  if (!r) throw new HttpError(404, "not_found", "Плейлист не найден или ссылка отключена");
  const nid = crypto.randomUUID();
  const t = Date.now();
  await env.DB.prepare("INSERT INTO playlists (id, user_id, title, tracks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(nid, user.id, r.title, r.tracks, t, t).run();
  return getPlaylist(env, user, nid);
}

async function listFavorites(env: Env, user: User) {
  const rows = await env.DB.prepare("SELECT track, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 5000")
    .bind(user.id).all<{ track: string; added_at: number }>();
  return json({ items: rows.results.map((r) => ({ ...JSON.parse(r.track), added_at: r.added_at })) });
}

async function addFavorite(env: Env, req: Request, user: User) {
  const b = await body<{ track?: unknown }>(req, 16 * 1024);
  const t = cleanTrack(b.track);
  if (!t) throw new HttpError(400, "bad_track");
  await env.DB.prepare("INSERT OR REPLACE INTO favorites (user_id, track_key, track, added_at) VALUES (?, ?, ?, ?)")
    .bind(user.id, trackKey(t), JSON.stringify(t), Date.now()).run();
  return json({ ok: true, key: trackKey(t) });
}

async function removeFavorite(env: Env, req: Request, user: User) {
  const b = await body<{ artist?: string; title?: string }>(req, 4096);
  await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND track_key = ?")
    .bind(user.id, trackKey({ artist: str(b.artist, 300), title: str(b.title, 300) })).run();
  return json({ ok: true });
}

async function addHistory(env: Env, req: Request, user: User) {
  await rateLimit(env, `hist:${user.id}`, 120, 3600);
  const b = await body<{ items?: { track?: unknown; seconds?: number; played_at?: number }[] }>(req, 256 * 1024);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200);
  const t = Date.now();
  const stmts = items.flatMap((it) => {
    const tr = cleanTrack(it.track);
    const sec = Math.round(Number(it.seconds) || 0);
    const at = Math.round(Number(it.played_at) || t);
    if (!tr || sec < 10 || sec > 6 * 3600 || at > t + 60_000 || at < t - 30 * DAY * 1000) return [];
    return [env.DB.prepare("INSERT INTO history (user_id, track_key, title, artist, source, seconds, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(user.id, trackKey(tr), tr.title, tr.artist, tr.source, sec, at)];
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, saved: stmts.length });
}

async function getHistory(env: Env, url: URL, user: User) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const before = Number(url.searchParams.get("before")) || Date.now() + 1;
  const rows = await env.DB.prepare(
    "SELECT title, artist, source, seconds, played_at FROM history WHERE user_id = ? AND played_at < ? ORDER BY played_at DESC LIMIT ?",
  ).bind(user.id, before, limit).all();
  return json({ items: rows.results });
}

async function getStats(env: Env, url: URL, user: User) {
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
  const from = Date.UTC(year, 0, 1), to = Date.UTC(year + 1, 0, 1);
  const q = (sql: string) => env.DB.prepare(sql).bind(user.id, from, to);
  const [total, artists, tracks, months] = await env.DB.batch([
    q("SELECT COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds, COUNT(DISTINCT artist) AS artists FROM history WHERE user_id = ? AND played_at >= ? AND played_at < ?"),
    q("SELECT artist, COUNT(*) AS plays, SUM(seconds) AS seconds FROM history WHERE user_id = ? AND played_at >= ? AND played_at < ? GROUP BY artist ORDER BY plays DESC LIMIT 10"),
    q("SELECT title, artist, COUNT(*) AS plays FROM history WHERE user_id = ? AND played_at >= ? AND played_at < ? GROUP BY track_key ORDER BY plays DESC LIMIT 10"),
    q("SELECT CAST(strftime('%m', played_at / 1000, 'unixepoch') AS INTEGER) AS month, SUM(seconds) AS seconds FROM history WHERE user_id = ? AND played_at >= ? AND played_at < ? GROUP BY month ORDER BY month"),
  ]);
  return json({ year, total: total.results[0], top_artists: artists.results, top_tracks: tracks.results, months: months.results });
}

// ---------- Маршрутизация ----------

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const M = req.method;
  if (M === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (p === "/" || p === "/health") return json({ ok: true, name: "melo-api" });
  if (p === "/config" && M === "GET")
    return json({
      vk: true,
      email: emailEnabled(env),
      google: googleEnabled(env),
      captcha: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET),
    });
  if (p === "/turnstile" && M === "GET") return turnstilePage(env, url.searchParams.get("lang") || "ru");

  if (p === "/auth/vk" && M === "POST") return authVk(env, req);
  if (p === "/auth/email/start" && M === "POST") return emailStart(env, req);
  if (p === "/auth/email/verify" && M === "POST") return emailVerify(env, req);
  if (p === "/auth/google/init" && M === "POST") return googleInit(env, req, origin);
  if (p === "/auth/google/go" && M === "GET") return googleGo(env, url, origin);
  if (p === "/auth/google/callback" && M === "GET") return googleCallback(env, url, origin);
  if (p === "/auth/google/poll" && M === "POST") return googlePoll(env, req);
  if (p === "/auth/logout" && M === "POST") return logout(env, req);

  const share = p.match(/^\/share\/([A-Za-z0-9_-]{6,40})$/);
  if (share && M === "GET") return sharedPlaylist(env, share[1], req);

  if (!p.startsWith("/me")) throw new HttpError(404, "not_found");
  const user = await requireUser(env, req);

  if (p === "/me" && M === "GET") return json({ user: await userPayload(env, user) });
  if (p === "/me" && M === "PUT") {
    const b = await body<{ name?: string }>(req, 2048);
    const name = str(b.name, 64);
    if (name) await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
    return json({ user: await userPayload(env, { ...user, name: name || user.name }) });
  }
  if (p === "/me" && M === "DELETE") {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    return json({ ok: true });
  }
  const un = p.match(/^\/me\/identities\/(vk|email|google)$/);
  if (un && M === "DELETE") return unlink(env, user, un[1]);
  if (p === "/me/sessions" && M === "DELETE") {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }

  if (p === "/me/settings" && M === "GET") return getSettings(env, user);
  if (p === "/me/settings" && M === "PUT") return putSettings(env, req, user);

  if (p === "/me/playlists" && M === "GET") return listPlaylists(env, user);
  if (p === "/me/playlists" && M === "POST") return savePlaylist(env, req, user, null);
  if (p === "/me/playlists/import" && M === "POST") return importPlaylist(env, req, user);
  const pl = p.match(/^\/me\/playlists\/([0-9a-f-]{36})(\/share)?$/);
  if (pl && !pl[2] && M === "GET") return getPlaylist(env, user, pl[1]);
  if (pl && !pl[2] && M === "PUT") return savePlaylist(env, req, user, pl[1]);
  if (pl && !pl[2] && M === "DELETE") return deletePlaylist(env, user, pl[1]);
  if (pl && pl[2] && M === "POST") return sharePlaylist(env, req, user, pl[1]);

  if (p === "/me/favorites" && M === "GET") return listFavorites(env, user);
  if (p === "/me/favorites" && M === "POST") return addFavorite(env, req, user);
  if (p === "/me/favorites" && M === "DELETE") return removeFavorite(env, req, user);

  if (p === "/me/history" && M === "GET") return getHistory(env, url, user);
  if (p === "/me/history" && M === "POST") return addHistory(env, req, user);
  if (p === "/me/history" && M === "DELETE") {
    await env.DB.prepare("DELETE FROM history WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }
  if (p === "/me/stats" && M === "GET") return getStats(env, url, user);

  throw new HttpError(404, "not_found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.log("internal error", e instanceof Error ? e.stack : e);
      return json({ error: "internal", message: "Ошибка сервера, попробуйте позже" }, 500);
    }
  },

  async scheduled(_: ScheduledController, env: Env) {
    const t = now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
      env.DB.prepare("DELETE FROM email_codes WHERE expires_at < ?").bind(t),
      env.DB.prepare("DELETE FROM login_requests WHERE expires_at < ?").bind(t),
      env.DB.prepare("DELETE FROM rate_limits WHERE win_start < ?").bind(t - 2 * DAY),
    ]);
  },
};
