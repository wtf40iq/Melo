// Клиент сервера Melo (Cloudflare Worker): аккаунт, вход и синхронизация.
import { Track } from "../types";
import { inTauri } from "./env";

/** Адрес сервера. Для сборки можно переопределить переменной VITE_MELO_API. */
export const MELO_API: string = (import.meta.env.VITE_MELO_API as string | undefined)?.replace(/\/+$/, "") || "https://melo-api.skymywex.workers.dev";

export type Identity = { provider: "vk" | "email" | "google"; label: string | null; created_at: number };
export type MeloUser = { id: string; name: string | null; avatar: string | null; created_at: number; identities: Identity[] };
export type MeloSession = { token: string; user: MeloUser };
export type MeloConfig = { vk: boolean; email: boolean; google: boolean; captcha: boolean };

export type TrackRef = {
  source: string; id: string; title: string; artist: string;
  album?: string; cover?: string; duration?: number; explicit?: boolean;
  ownerId?: number; audioId?: number; accessKey?: string;
};
export type CloudPlaylist = {
  id: string; title: string; count: number; cover: string | null;
  shared: boolean; share_slug: string | null; created_at: number; updated_at: number; tracks?: TrackRef[];
};
export type Stats = {
  year: number;
  total: { plays: number; seconds: number; artists: number };
  top_artists: { artist: string; plays: number; seconds: number }[];
  top_tracks: { title: string; artist: string; plays: number }[];
  months: { month: number; seconds: number }[];
};

/** Ошибка сервера: code — машинный код, message — текст для человека. */
export class MeloError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
  /** Сервер недоступен (нет сети / сервер лежит), а не «отказал». */
  get offline() {
    return this.status === 0 || this.status >= 500;
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => (token = t);
export const hasToken = () => !!token;

async function req<T>(method: string, path: string, data?: unknown, opts: { auth?: boolean; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  let r: Response;
  try {
    r = await fetch(MELO_API + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), keepalive: opts.keepalive });
  } catch {
    throw new MeloError("offline", "Нет связи с сервером Melo");
  }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new MeloError(out.error || "error", out.message || `Ошибка сервера (${r.status})`, r.status);
  return out as T;
}

// ---------- Хранение сессии ----------

const LS_KEY = "melo.account";

export async function loadSession(): Promise<MeloSession | null> {
  try {
    if (inTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<MeloSession | null>("melo_session_get")) ?? null;
    }
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
}

export async function saveSession(s: MeloSession | null) {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("melo_session_set", { value: s }).catch(() => {});
  } else if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
  else localStorage.removeItem(LS_KEY);
}

export async function openExternal(url: string) {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  } else window.open(url, "_blank", "noopener");
}

/** Токен ВК для подтверждения входа (только в приложении). */
export async function vkProof(): Promise<{ token: string; client: string } | null> {
  if (!inTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("vk_proof");
}

// ---------- Методы ----------

type Login = { token: string | null; created: boolean; user: MeloUser };

export const melo = {
  config: () => req<MeloConfig>("GET", "/config", undefined, { auth: false }),

  /** Вход или (если уже вошли) привязка ВК. */
  authVk: (vk_token: string, client: string) => req<Login>("POST", "/auth/vk", { vk_token, client }),
  emailStart: (email: string, captcha: string, lang: string) =>
    req<{ ok: true; expires_in: number }>("POST", "/auth/email/start", { email, captcha, lang }),
  emailVerify: (email: string, code: string) => req<Login>("POST", "/auth/email/verify", { email, code }),
  googleInit: (poll_secret: string) => req<{ id: string; url: string; expires_in: number }>("POST", "/auth/google/init", { poll_secret }),
  googlePoll: (id: string, poll_secret: string) =>
    req<{ state: "waiting" | "ok" | "error" | "expired"; message?: string; token?: string | null; user?: MeloUser }>(
      "POST", "/auth/google/poll", { id, poll_secret }),
  logout: () => req("POST", "/auth/logout"),

  me: () => req<{ user: MeloUser }>("GET", "/me"),
  rename: (name: string) => req<{ user: MeloUser }>("PUT", "/me", { name }),
  deleteAccount: () => req("DELETE", "/me"),
  unlink: (provider: string) => req<{ user: MeloUser }>("DELETE", `/me/identities/${provider}`),
  logoutAll: () => req("DELETE", "/me/sessions"),

  getSettings: () => req<{ data: Record<string, unknown> | null; updated_at: number }>("GET", "/me/settings"),
  putSettings: (data: Record<string, unknown>) => req<{ updated_at: number }>("PUT", "/me/settings", { data }),

  playlists: () => req<{ items: CloudPlaylist[] }>("GET", "/me/playlists").then((r) => r.items),
  playlist: (id: string) => req<CloudPlaylist>("GET", `/me/playlists/${id}`),
  createPlaylist: (title: string, tracks: TrackRef[] = []) => req<CloudPlaylist>("POST", "/me/playlists", { title, tracks }),
  updatePlaylist: (id: string, patch: { title?: string; tracks?: TrackRef[] }) => req<CloudPlaylist>("PUT", `/me/playlists/${id}`, patch),
  deletePlaylist: (id: string) => req("DELETE", `/me/playlists/${id}`),
  sharePlaylist: (id: string, enabled: boolean) => req<CloudPlaylist>("POST", `/me/playlists/${id}/share`, { enabled }),
  importPlaylist: (link: string) => req<CloudPlaylist>("POST", "/me/playlists/import", { slug: link }),
  shareUrl: (slug: string) => `${MELO_API}/share/${slug}`,

  favorites: () => req<{ items: (TrackRef & { added_at: number })[] }>("GET", "/me/favorites").then((r) => r.items),
  addFavorite: (track: TrackRef) => req("POST", "/me/favorites", { track }),
  removeFavorite: (artist: string, title: string) => req("DELETE", "/me/favorites", { artist, title }),

  pushHistory: (items: { track: TrackRef; seconds: number; played_at: number }[], keepalive = false) =>
    req<{ saved: number }>("POST", "/me/history", { items }, { keepalive }),
  clearHistory: () => req("DELETE", "/me/history"),
  stats: (year: number) => req<Stats>("GET", `/me/stats?year=${year}`),
};

// ---------- Преобразования треков ----------

export const toRef = (t: Track): TrackRef => ({
  source: "vk",
  id: t.id,
  title: t.title,
  artist: t.artist,
  album: t.album,
  cover: t.cover,
  duration: t.duration,
  explicit: t.explicit,
  ownerId: t.ownerId,
  audioId: t.audioId,
  accessKey: t.accessKey,
});

export const fromRef = (r: TrackRef, demo = false): Track => ({
  id: r.id,
  ownerId: r.ownerId ?? 0,
  audioId: r.audioId ?? 0,
  accessKey: r.accessKey,
  title: r.title,
  artist: r.artist,
  album: r.album,
  cover: r.cover,
  duration: r.duration ?? 0,
  explicit: r.explicit,
  // Ссылки ВК живут около суток — плеер сам запросит свежую через refresh
  url: demo ? "/demo.mp3" : undefined,
});
