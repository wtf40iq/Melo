import { invoke } from "@tauri-apps/api/core";
import { Account, AppInfo, MusicApi, QrCode, QrStatus } from "./types";
import { Lyrics, Playlist, Profile, Track } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lang = () => {
  try {
    return JSON.parse(localStorage.getItem("melo.settings") || "{}").lang === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
};
const call = <T = any>(method: string, params: Record<string, unknown> = {}) =>
  invoke<T>("vk_call", { method, params: { lang: lang(), ...params } });

const mapTrack = (a: any): Track => ({
  id: `${a.owner_id}_${a.id}`,
  ownerId: a.owner_id,
  audioId: a.id,
  accessKey: a.access_key,
  title: a.title + (a.subtitle ? ` (${a.subtitle})` : ""),
  artist: a.artist,
  album: a.album?.title,
  cover: a.album?.thumb?.photo_135 || a.album?.thumb?.photo_68,
  duration: a.duration,
  explicit: !!a.is_explicit,
  url: a.url && !a.url.includes("audio_api_unavailable") ? a.url : undefined,
  hasLyrics: !!(a.has_lyrics || a.lyrics_id),
  lyricsId: a.lyrics_id,
});

/** Разбирает ответ audio.getLyrics (новый формат с таймкодами и старый — просто текст). */
const parseLyrics = (r: any): Lyrics | null => {
  const l = r?.lyrics ?? r;
  const ts = l?.timestamps;
  if (Array.isArray(ts) && ts.length) {
    return { synced: true, lines: ts.map((x: any) => ({ time: (x.begin ?? 0) / 1000, text: String(x.line ?? "") })) };
  }
  const text = Array.isArray(l?.text) ? l.text.join("\n") : typeof l?.text === "string" ? l.text : "";
  if (!text.trim()) return null;
  return { synced: false, lines: text.split(/\r?\n/).map((line: string) => ({ text: line })) };
};

const mapPlaylist = (p: any, myId?: number): Playlist => ({
  id: `${p.owner_id}_${p.id}`,
  ownerId: p.owner_id,
  playlistId: p.id,
  accessKey: p.access_key,
  title: p.title,
  subtitle: p.main_artists?.map((a: any) => a.name).join(", ") || (p.year && p.owner_id !== myId ? String(p.year) : ""),
  count: p.count,
  cover: p.photo?.photo_300 || p.photo?.photo_270 || p.thumbs?.[0]?.photo_300 || p.thumbs?.[0]?.photo_270,
  editable: p.owner_id === myId && !p.original,
});

let me: Profile | null = null;

// Адрес локального сервера для музыки (поднимается в Rust при запуске)
let streamBase = "";
const streamReady = invoke<string>("stream_base")
  .then((b) => (streamBase = b))
  .catch(() => "");

const loadProfile = async (): Promise<Profile> => {
  const [u] = await call<any[]>("users.get", { fields: "photo_100" });
  me = { id: u.id, name: `${u.first_name} ${u.last_name}`, photo: u.photo_100 };
  invoke("account_set_info", { name: me.name, photo: me.photo ?? null }).catch(() => {});
  return me;
};

const items = (r: any) => (Array.isArray(r) ? r : r?.items ?? []);

export const vkApi: MusicApi = {
  demo: false,

  async restore() {
    await streamReady;
    const uid = await invoke<number | null>("vk_session");
    if (!uid) return null;
    try {
      return await loadProfile();
    } catch (e) {
      if (String(e).includes("not_authorized")) {
        localStorage.setItem("melo.vkKick", JSON.stringify({ at: Date.now(), msg: String(e).replace(/^.*not_authorized:?\s*/, "").trim() }));
        return null;
      }
      // Нет сети, ВК тормозит или просит подождать — это не выход из аккаунта.
      // Открываем приложение с сохранённым профилем, а данные подтянутся позже.
      const acc = (await invoke<Account[]>("accounts_list").catch(() => [] as Account[])).find((a) => a.user_id === uid);
      me = { id: uid, name: acc?.name || `id${uid}`, photo: acc?.photo };
      return me;
    }
  },

  async login() {
    const uid = await invoke<number | null>("vk_session");
    if (!uid) await invoke<number>("vk_login");
    return loadProfile();
  },

  qrStart() {
    return invoke<QrCode>("qr_start");
  },

  qrCheck(hash) {
    return invoke<QrStatus>("qr_check", { hash });
  },

  qrSubmit(hash, code) {
    return invoke<QrStatus>("qr_submit_code", { hash, code });
  },

  async refresh(t) {
    const r = await call<any[]>("audio.getById", { audios: `${t.ownerId}_${t.audioId}${t.accessKey ? "_" + t.accessKey : ""}` });
    return r?.[0] ? { ...mapTrack(r[0]), id: t.id } : null;
  },

  async logout() {
    me = null;
    await invoke("vk_logout");
  },

  async myTracks(offset, count) {
    const r = await call("audio.get", { owner_id: me?.id, offset, count });
    return { items: items(r).map(mapTrack), total: r?.count ?? 0 };
  },

  async myPlaylists() {
    const r = await call("audio.getPlaylists", { owner_id: me?.id, count: 100 });
    return items(r).map((p: any) => mapPlaylist(p, me?.id));
  },

  async playlistTracks(pl) {
    const r = await call("audio.get", {
      owner_id: pl.ownerId,
      album_id: pl.playlistId,
      access_key: pl.accessKey,
      count: 1000,
    });
    return items(r).map(mapTrack);
  },

  async recommendations() {
    const r = await call("audio.getRecommendations", { count: 60, shuffle: 1 });
    return items(r).map(mapTrack);
  },

  async popular(genreId) {
    const r = await call("audio.getPopular", { count: 60, genre_id: genreId || undefined, only_eng: 0 });
    return items(r).map(mapTrack);
  },

  async search(q) {
    const [tr, pl] = await Promise.allSettled([
      call("audio.search", { q, count: 100, auto_complete: 1, sort: 2 }),
      call("audio.searchPlaylists", { q, count: 20 }),
    ]);
    if (tr.status === "rejected") throw tr.reason;
    return {
      tracks: items(tr.value).map(mapTrack),
      playlists: pl.status === "fulfilled" ? items(pl.value).map((p: any) => mapPlaylist(p, me?.id)) : [],
    };
  },

  async add(t) {
    const newId = await call<number>("audio.add", { owner_id: t.ownerId, audio_id: t.audioId, access_key: t.accessKey });
    return { ...t, ownerId: me!.id, audioId: newId, id: `${me!.id}_${newId}`, accessKey: undefined };
  },

  async remove(t) {
    await call("audio.delete", { owner_id: t.ownerId, audio_id: t.audioId });
  },

  async undoRemove(t) {
    await call("audio.restore", { owner_id: t.ownerId, audio_id: t.audioId });
  },

  async addToPlaylist(t, pl) {
    await call("audio.addToPlaylist", {
      owner_id: pl.ownerId,
      playlist_id: pl.playlistId,
      audio_ids: `${t.ownerId}_${t.audioId}${t.accessKey ? "_" + t.accessKey : ""}`,
    });
  },

  async createPlaylist(title) {
    const p = await call("audio.createPlaylist", { owner_id: me?.id, title });
    return mapPlaylist({ ...p, count: 0 }, me?.id);
  },

  async deletePlaylist(pl) {
    await call("audio.deletePlaylist", { owner_id: pl.ownerId, playlist_id: pl.playlistId });
  },

  async renamePlaylist(pl, title) {
    await call("audio.editPlaylist", { owner_id: pl.ownerId, playlist_id: pl.playlistId, title });
  },

  async removeFromPlaylist(t, pl) {
    await call("audio.removeFromPlaylist", { owner_id: pl.ownerId, playlist_id: pl.playlistId, audio_ids: `${t.ownerId}_${t.audioId}` });
  },

  async lyrics(t) {
    try {
      const r = parseLyrics(await call("audio.getLyrics", { audio_id: `${t.ownerId}_${t.audioId}` }));
      if (r) return r;
    } catch {
      /* старые версии API — пробуем по lyrics_id */
    }
    if (t.lyricsId) {
      try {
        return parseLyrics(await call("audio.getLyrics", { lyrics_id: t.lyricsId }));
      } catch {
        return null;
      }
    }
    return null;
  },

  async similar(t) {
    const r = await call("audio.getRecommendations", { target_audio: `${t.ownerId}_${t.audioId}`, count: 60 });
    return items(r).map(mapTrack).filter((x: Track) => x.id !== t.id);
  },

  async reorder(t, after, before) {
    await call("audio.reorder", { owner_id: t.ownerId, audio_id: t.audioId, after: after?.audioId, before: before?.audioId });
  },

  accounts: () => invoke<Account[]>("accounts_list"),
  async switchAccount(userId) {
    me = null;
    await invoke("account_switch", { userId });
  },
  removeAccount: (userId) => invoke("account_remove", { userId }),
  async detach() {
    me = null;
    await invoke("account_detach");
  },
  info: () => invoke<AppInfo>("app_info"),

  streamUrl(url) {
    // Локальный сервер из Rust: отдаёт поток, добавляет CORS (для эквалайзера) и переписывает m3u8.
    // Запасной вариант — свой протокол.
    const base = streamBase || "http://vkstream.localhost/";
    return `${base}?u=${encodeURIComponent(url)}`;
  },
};
