import { invoke } from "@tauri-apps/api/core";
import { Account, AppInfo, DirectAuth, MusicApi, QrCode, QrStatus } from "./types";
import { Artist, Lyrics, OfflinePlaylist, Playlist, Profile, Track } from "../types";
import { coverage, dedupeTracks, isSameSong, norm, rankTracks, relevant, trackArtists, uniqueTracks, variantScore, words } from "./match";

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
  artists: [...(a.main_artists ?? []), ...(a.featured_artists ?? [])]
    .filter((x: any) => x?.name)
    .map((x: any) => ({ id: x.id ? String(x.id) : undefined, name: x.name })),
});

/** Короткий кеш поиска: повторный запрос и «назад» — мгновенно. */
const cache = new Map<string, { at: number; v: Promise<any> }>();
function cached<T>(key: string, make: () => Promise<T>, ttl = 5 * 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = make();
  cache.set(key, { at: Date.now(), v });
  v.catch(() => cache.delete(key));
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return v;
}

const photoOf = (p: any): string | undefined => {
  if (Array.isArray(p)) return [...p].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  return p?.photo_300 || p?.photo_270 || p?.url;
};

const localUrl = (kind: "local" | "cover", rel: string) => `${streamBase || "http://vkstream.localhost/"}${kind}?p=${encodeURIComponent(rel)}`;

const mapOffline = (p: any): OfflinePlaylist => ({
  id: p.id,
  title: p.title,
  description: p.description || "",
  count: p.count,
  // ?v — чтобы новая обложка сразу подхватилась
  cover: p.cover ? `${localUrl("cover", `${p.id}/${p.cover}`)}&v=${Date.now() >> 12}` : undefined,
});

const offlineTrack = (pl: string, x: any): Track => ({
  id: `off:${pl}/${x.file}`,
  ownerId: 0,
  audioId: 0,
  title: x.title,
  artist: x.artist,
  album: x.album || undefined,
  duration: x.duration,
  url: `offline:${pl}/${x.file}`,
  cover: x.has_cover ? localUrl("cover", `${pl}/${x.file}`) : undefined,
});

const mapArtist = (a: any): Artist => ({
  id: a.id ? String(a.id) : undefined,
  name: a.name,
  // ВК кладёт фото по-разному: photo[], photos[0].photo[], cover[]…
  photo: photoOf(a.photo) || photoOf(a.photos?.[0]?.photo) || photoOf(a.photos) || photoOf(a.cover) || photoOf(a.images),
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

/**
 * Профиль сразу после входа. Flood control — ВК просит подождать: ключ оставляем, экран входа
 * сам повторит через минуту. Другие ошибки для нового аккаунта — откатываем вход, чтобы не попасть
 * в безымянный «id…» без музыки.
 */
const profileAfterLogin = async (uid: number): Promise<Profile> => {
  try {
    return await loadProfile();
  } catch (e) {
    const msg = String(e);
    const known = (await invoke<Account[]>("accounts_list").catch(() => [] as Account[])).find((a) => a.user_id === uid && a.name);
    if (known && !msg.includes("not_authorized")) {
      me = { id: uid, name: known.name!, photo: known.photo };
      return me;
    }
    if (/flood|код 9|код 6/i.test(msg)) throw new Error(`FLOOD:${uid}`);
    await invoke("account_remove", { userId: uid }).catch(() => {});
    await invoke("vk_logout").catch(() => {});
    throw e;
  }
};

const items = (r: any) => (Array.isArray(r) ? r : r?.items ?? []);

// ---------- Поиск через каталог ВК (как в официальном приложении) ----------
const CATALOG_V = "5.199";
type CatalogResult = { tracks: Track[]; playlists: Playlist[]; artists: Artist[] };

/** Собирает объекты из ответа каталога по их id ("owner_id" + "_" + "id"). */
function catalogPools(r: any) {
  const audios = new Map<string, any>();
  for (const a of r?.audios ?? []) audios.set(`${a.owner_id}_${a.id}`, a);
  const playlists = new Map<string, any>();
  for (const p of r?.playlists ?? []) playlists.set(`${p.owner_id}_${p.id}`, p);
  const artists = new Map<string, any>();
  for (const a of r?.artists ?? []) artists.set(String(a.id), a);
  return { audios, playlists, artists };
}
const idKey = (id: string) => id.split("_").slice(0, 2).join("_");

function catalogSearch(q: string): Promise<CatalogResult> {
  return cached(`c:${q.trim().toLowerCase()}`, async () => {
    const r = await call("catalog.getAudioSearch", { query: q.trim(), need_blocks: 1, v: CATALOG_V });
    const pools = catalogPools(r);
    const section = r?.catalog?.sections?.find((x: any) => x.id === r?.catalog?.default_section) ?? r?.catalog?.sections?.[0];
    const blocks: any[] = section?.blocks ?? [];
    const tracks: Track[] = [];
    const seen = new Set<string>();
    const push = (ids: string[] | undefined, pool: Map<string, any>) => {
      for (const id of ids ?? []) {
        const a = pool.get(idKey(id));
        if (!a) continue;
        const t = mapTrack(a);
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        tracks.push(t);
      }
    };
    const playlists: Playlist[] = [];
    const artists: Artist[] = [];
    let more: { section?: string } | null = null;
    for (const b of blocks) {
      if (b.data_type === "music_audios" && b.audios_ids?.length) {
        push(b.audios_ids, pools.audios);
        // «Показать все» у основного списка треков — там полная выдача
        const btn = [...(b.buttons ?? []), ...(b.layout?.top_title?.buttons ?? [])].find((x: any) => x.section_id || x.action?.section_id);
        if (!more && btn) more = { section: btn.section_id ?? btn.action?.section_id };
      } else if (b.data_type === "music_playlists") {
        for (const id of b.playlists_ids ?? []) {
          const p = pools.playlists.get(idKey(id));
          if (p) playlists.push(mapPlaylist(p, me?.id));
        }
      } else if (b.artists_ids?.length) {
        for (const id of b.artists_ids) {
          const a = pools.artists.get(String(id));
          if (a) artists.push(mapArtist(a));
        }
      }
    }
    if (!artists.length) for (const a of pools.artists.values()) artists.push(mapArtist(a));
    if (!playlists.length) for (const p of pools.playlists.values()) playlists.push(mapPlaylist(p, me?.id));
    // Полный список треков: листаем раздел «Показать все»
    if (more?.section) {
      let from: string | undefined;
      for (let page = 0; page < 8 && tracks.length < 800; page++) {
        const s = await call("catalog.getSection", { section_id: more.section, start_from: from, v: CATALOG_V }).catch(() => null);
        if (!s) break;
        const sp = catalogPools(s);
        const before = tracks.length;
        for (const b of s.section?.blocks ?? []) if (b.data_type === "music_audios") push(b.audios_ids, sp.audios);
        from = s.section?.next_from;
        if (!from || tracks.length === before) break;
      }
    }
    return { tracks, playlists, artists };
  });
}

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
      // Безымянный аккаунт, который ни разу не загрузился, — не показываем пустой «id…», просим войти заново
      if (!acc?.name) { await invoke("vk_logout").catch(() => {}); return null; }
      me = { id: uid, name: acc.name, photo: acc.photo };
      return me;
    }
  },

  async login(fresh) {
    let uid = await invoke<number | null>("vk_session");
    if (!uid) uid = await invoke<number>("vk_login", { fresh: !!fresh });
    return profileAfterLogin(uid);
  },

  async browserLogin() {
    const uid = await invoke<number>("vk_browser_login");
    return profileAfterLogin(uid);
  },
  async browserSubmit(text) {
    // null — ключ подхватил ждущий вход; число — ожидание уже закончилось, и Melo вошёл сам
    return invoke<number | null>("vk_browser_submit", { text });
  },
  async directLogin(p) {
    const r = await invoke<DirectAuth>("vk_direct_login", {
      login: p.login, password: p.password, code: p.code ?? null, sms: p.sms ?? null,
      captchaSid: p.captchaSid ?? null, captchaKey: p.captchaKey ?? null,
    });
    if (r.state !== "ok" || !r.uid) return r;
    return { ...r, profile: await profileAfterLogin(r.uid) };
  },
  browserReopen: () => invoke("vk_browser_reopen"),
  browserCancel: () => invoke("vk_browser_cancel"),

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
    if (t.id.startsWith("off:")) return t; // офлайн-файл всегда на месте
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

  /**
   * Поиск. Берём всю выдачу ВК (все страницы, оба варианта запроса, каталог), ничего не
   * выбрасываем — перезаливы и повторы остаются. Порядок — по ступеням совпадения,
   * внутри ступени — как у ВК:
   *  6 — исполнитель из запроса и точное название (оригинал);  5 — исполнитель и все слова или перезалив «A - B»;
   *  4 — точное название у другого исполнителя;  3 — все слова запроса (перезаливы «A - B»);
   *  2 — совпало название. Если такие есть, прочие треки исполнителя и случайные результаты скрываются.
   *  Nightcore/speed up/slowed и т. п. — сразу после точных совпадений, если их не просили.
   */
  searchTracks(q) {
    return cached(`t:${norm(q)}`, async () => {
      const query = q.trim();
      // ВК путается в тире и знаках вроде «%» — ищем и так, и без них
      const clean = query.replace(/\s+[-–—]+\s+/g, " ").replace(/[%#@]/g, " ").replace(/\s+/g, " ").trim();
      const pages = async (x: string, max = 1500, extra: Record<string, unknown> = { auto_complete: 1 }) => {
        let out: Track[] = [];
        for (let off = 0; off < max; off += 300) {
          const r = await call("audio.search", { q: x, count: 300, offset: off, ...extra }).catch((e) => { if (!off) throw e; return null; });
          const page = items(r).map(mapTrack);
          out = out.concat(page);
          if (page.length < 290) break;
        }
        return out;
      };
      const res = await Promise.allSettled([
        pages(query),
        clean && clean !== query ? pages(clean) : Promise.resolve([] as Track[]),
        catalogSearch(query).then((c) => c.tracks),
      ]);
      if (res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
      const got = (i: number) => (res[i].status === "fulfilled" ? (res[i] as PromiseFulfilledResult<Track[]>).value : []);
      let all = uniqueTracks([...got(0), ...got(1), ...got(2)]);

      // Исполнитель из запроса — тот, чьё имя целиком есть в запросе и чьих треков больше всего
      const qw = words(query);
      const dash = query.split(/\s+[-–—]+\s+/);
      const counts = new Map<string, { a: Artist; n: number }>();
      for (const t of all) for (const name of trackArtists(t)) {
        const k = norm(name);
        if (!k || coverage(name, query) < 1 || words(name).length >= qw.length) continue;
        const a = t.artists?.find((x: Artist) => norm(x.name) === k) ?? { name };
        const c = counts.get(k);
        counts.set(k, { a: c?.a.id ? c.a : a, n: (c?.n ?? 0) + 1 });
      }
      let who = [...counts.values()].sort((x, y) => y.n - x.n || words(y.a.name).length - words(x.a.name).length)[0]?.a;
      if (!who && dash.length >= 2 && words(dash[0]).length < qw.length) who = { name: dash[0].trim() };
      const aw = new Set(who ? words(who.name) : []);
      const rest = norm(qw.filter((w) => !aw.has(w)).join(" "));

      const bare = (s: string) => norm(s.replace(/[([{][^)\]}]*[)\]}]/g, " "));
      // Запрос «исполнитель + название»: обычный поиск ВК находит лишь часть загрузок.
      // Добираем все версии и перезаливы: загрузки с этим исполнителем в поле «исполнитель»,
      // поиск по одному названию (оставляем то, где упомянут исполнитель), другой порядок слов,
      // треки и альбомы самого исполнителя.
      if (who && rest) {
        const title = (dash.length >= 2 ? dash.slice(1).join(" - ") : rest).trim();
        const mentions = (t: Track) => coverage(who!.name, `${t.artist} ${t.title}`) >= 1;
        const none = () => [] as Track[];
        const [own, albums, byName, byTitle, swapped, joined] = await Promise.all([
          vkApi.artistTracks(who).catch(() => [] as Track[]),
          who.id ? vkApi.artistAlbums(who).catch(() => [] as Playlist[]) : Promise.resolve([] as Playlist[]),
          pages(who.name, 1200, { performer_only: 1 }).catch(none),
          pages(title, 900).then((l) => l.filter(mentions)).catch(none),
          pages(`${title} ${who.name}`, 600).catch(none),
          pages(`${who.name} ${title}`, 600, { auto_complete: 0 }).catch(none),
        ]);
        const fromAlbums = await Promise.allSettled(albums.slice(0, 8).map((p) => vkApi.playlistTracks(p)));
        const extra = [...own, ...byName, ...byTitle, ...swapped, ...joined, ...fromAlbums.flatMap((r) => (r.status === "fulfilled" ? r.value : []))];
        // Берём только треки с нужным названием, а не всю дискографию
        all = uniqueTracks([...all, ...extra.filter((t) => coverage(rest, bare(t.title)) >= 1)]);
      }

      const wantMix = /\b(speed|sped|slowed|remix|nightcore|reverb|cover|karaoke|минус|bass)\b/.test(norm(query));
      const isMix = (t: Track) => /\b(speed up|sped up|slowed|remix|nightcore\w*|reverb|cover|karaoke|минус|bass boosted)\b/.test(norm(`${t.title} ${t.artist}`));
      const byArtist = (t: Track) => !!who && trackArtists(t).some((n) => norm(n) === norm(who!.name));
      // Перезалив «Исполнитель - Название» от другого человека: в названии есть исполнитель, а остаток — ровно название
      const reupload = (t: Track) => !!who && !!rest && coverage(who.name, t.title) >= 1 && norm(words(bare(t.title)).filter((w) => !aw.has(w)).join(" ")) === rest;
      const tier = (t: Track) => {
        const full = coverage(query, `${t.artist} ${bare(t.title)}`) >= 1;
        const titleExact = !!rest && bare(t.title) === rest;
        const art = byArtist(t);
        let s = 0;
        if (art && titleExact) s = 6;
        else if ((art && full) || reupload(t)) s = 5;
        else if (titleExact) s = 4;
        else if (full) s = 3;
        else if (rest && coverage(rest, bare(t.title)) >= 1) s = 2;
        else if (art) s = 1;
        // Nightcore/speed up и т. п. — ниже оригиналов и перезаливов, если их не просили
        if (s >= 3 && !wantMix && isMix(t)) s = 2.5;
        return s;
      };
      const scored = all.map((t, i) => ({ t, i, s: tier(t) }));
      // Есть совпадения по названию — остальные треки исполнителя и случайные результаты не показываем
      const kept = scored.some((x) => x.s >= 2) ? scored.filter((x) => x.s >= 2) : scored;
      return kept.sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.t);
    });
  },

  searchExtras(q) {
    return cached(`x:${q.trim().toLowerCase()}`, async () => {
      const c = await catalogSearch(q).catch(() => null);
      let playlists = c?.playlists ?? [];
      let artists = c?.artists ?? [];
      if (!playlists.length || !artists.length) {
        const [pl, ar] = await Promise.allSettled([
          playlists.length ? Promise.resolve(null) : call("audio.searchPlaylists", { q, count: 20 }),
          artists.length ? Promise.resolve(null) : call("audio.searchArtists", { q, count: 8 }),
        ]);
        if (!playlists.length && pl.status === "fulfilled") playlists = items(pl.value).map((p: any) => mapPlaylist(p, me?.id));
        if (!artists.length && ar.status === "fulfilled") artists = items(ar.value).map(mapArtist);
      }
      if (!artists.length) {
        // ВК не дал исполнителей — берём из найденных треков тех, чьё имя есть в запросе
        const tracks = await vkApi.searchTracks(q).catch(() => [] as Track[]);
        const seen = new Map<string, Artist>();
        for (const t of tracks) for (const a of t.artists ?? []) {
          if (coverage(a.name, q) >= 1 || coverage(q, a.name) >= 1) if (!seen.has(norm(a.name))) seen.set(norm(a.name), a);
        }
        artists = [...seen.values()].slice(0, 6);
      }
      // У поиска исполнителей часто нет фото — берём из карточки исполнителя, а если и там нет, из обложки альбома
      artists = await Promise.all(artists.filter((a) => a.name).slice(0, 8).map(async (a) => {
        if (a.photo) return a;
        const info = await vkApi.artistInfo(a).catch(() => a);
        if (info.photo) return { ...a, photo: info.photo };
        const albums = a.id ? await vkApi.artistAlbums(a).catch(() => [] as Playlist[]) : [];
        return { ...a, photo: albums.find((x: Playlist) => x.cover)?.cover };
      }));
      return { playlists, artists };
    });
  },

  deepSearch(artist, title) {
    const a = artist.trim(), ti = title.trim();
    return cached(`d:${norm(a)}|${norm(ti)}`, async () => {
      const reqs: Promise<any>[] = [];
      if (a && ti) reqs.push(call("audio.search", { q: `${a} ${ti}`, count: 100, auto_complete: 1 }));
      if (a) reqs.push(call("audio.search", { q: a, performer_only: 1, count: 200 }));
      if (ti) reqs.push(call("audio.search", { q: ti, count: 150, auto_complete: 1 }));
      const res = await Promise.allSettled(reqs);
      if (res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
      let all = uniqueTracks(res.flatMap((r) => (r.status === "fulfilled" ? items(r.value).map(mapTrack) : [])));
      let strict = rankTracks(all, { artist: a || undefined, title: ti || undefined }, true);
      // Поиск ВК находит не всё: смотрим треки и альбомы самого исполнителя
      if (a && ti && !strict.some((t) => coverage(ti, t.title) >= 1 && norm(t.title).length <= norm(ti).length + 12)) {
        const found = all.flatMap((t) => t.artists ?? []).find((x) => norm(x.name) === norm(a) && x.id);
        const who: Artist = found ?? { name: a };
        const [own, albums] = await Promise.all([vkApi.artistTracks(who).catch(() => []), vkApi.artistAlbums(who).catch(() => [])]);
        const fromAlbums = await Promise.allSettled(albums.slice(0, 15).map((p) => vkApi.playlistTracks(p)));
        all = uniqueTracks([...all, ...own, ...fromAlbums.flatMap((r) => (r.status === "fulfilled" ? r.value : []))]);
        strict = rankTracks(all, { artist: a, title: ti }, true);
      }
      // Сначала точные совпадения, ниже — всё остальное, что нашлось по запросу
      const ids = new Set(strict.map((t) => t.id));
      return [...strict, ...rankTracks(all.filter((t) => !ids.has(t.id)), { any: `${a} ${ti}` }, false, true)];
    });
  },

  variants(t) {
    return cached(`v:${t.id}`, async () => {
      const q = `${t.artists?.[0]?.name ?? t.artist} ${t.title.replace(/[([{][^)\]}]*[)\]}]/g, " ")}`.replace(/\s+/g, " ").trim();
      const res = await Promise.allSettled([
        call("audio.search", { q, count: 300, auto_complete: 0 }),
        call("audio.search", { q: `${t.artist} ${t.title}`, count: 200, auto_complete: 0 }),
        call("audio.search", { q: `${t.title.replace(/[([{][^)\]}]*[)\]}]/g, " ")} ${t.artists?.[0]?.name ?? t.artist}`, count: 300, auto_complete: 0 }),
      ]);
      if (res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
      const all = uniqueTracks(res.flatMap((r) => (r.status === "fulfilled" ? items(r.value).map(mapTrack) : [])));
      return all
        .filter((x) => x.id !== t.id && isSameSong(t, x))
        .map((x, i) => ({ x, s: variantScore(t, x), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((v) => v.x);
    }, 10 * 60_000);
  },

  async artist(a) {
    const [artist, tracks, albums] = await Promise.all([
      vkApi.artistInfo(a).catch(() => a),
      vkApi.artistTracks(a).catch(() => [] as Track[]),
      vkApi.artistAlbums(a).catch(() => [] as Playlist[]),
    ]);
    return { artist: { ...artist, photo: artist.photo || albums[0]?.cover || tracks.find((t) => t.cover)?.cover }, tracks, albums };
  },

  artistInfo(a) {
    return cached(`ai:${a.id ?? norm(a.name)}`, async () => {
      if (!a.id) return a;
      const r = await call("audio.getArtistById", { artist_id: a.id }).catch(() => null);
      return r ? { ...a, ...mapArtist(r), id: a.id, name: r.name || a.name } : a;
    }, 30 * 60_000);
  },

  artistTracks(a) {
    return cached(`at:${a.id ?? ""}:${norm(a.name)}`, async () => {
      const mine = (t: Track) => (t.artists?.length ? t.artists.some((x) => (a.id && x.id === a.id) || norm(x.name) === norm(a.name)) : coverage(a.name, t.artist) >= 1);
      // Оба запроса сразу: что придёт по id — лучше, поиск — запасной вариант
      const byId = a.id ? call("audio.getAudiosByArtist", { artist_id: a.id, count: 100 }).then((r) => items(r).map(mapTrack)).catch(() => [] as Track[]) : Promise.resolve([] as Track[]);
      const bySearch = call("audio.search", { q: a.name, performer_only: 1, count: 200 }).then((r) => items(r).map(mapTrack).filter(mine)).catch(() => [] as Track[]);
      const first = await byId;
      return dedupeTracks(first.length ? first : await bySearch);
    }, 10 * 60_000);
  },

  artistAlbums(a) {
    return cached(`aa:${a.id ?? ""}:${norm(a.name)}`, async () => {
      if (a.id) {
        const r = await call("audio.getAlbumsByArtist", { artist_id: a.id, count: 60 }).catch(() => null);
        const list = items(r).map((p: any) => mapPlaylist(p, me?.id));
        if (list.length) return list;
      }
      const r = await call("audio.searchAlbums", { q: a.name, count: 60 }).catch(() => call("audio.searchPlaylists", { q: a.name, count: 40 }).catch(() => null));
      return items(r)
        .filter((p: any) => (p.main_artists ?? []).some((x: any) => (a.id && String(x.id) === a.id) || norm(x.name) === norm(a.name)))
        .map((p: any) => mapPlaylist(p, me?.id));
    }, 10 * 60_000);
  },

  // ---------- Офлайн ----------
  offlineRoot: () => invoke<string>("offline_root_path"),
  async offlineList() {
    await streamReady;
    return (await invoke<any[]>("offline_list")).map(mapOffline);
  },
  async offlinePlaylist(id) {
    await streamReady;
    return mapOffline(await invoke<any>("offline_playlist", { id }));
  },
  async offlineTracks(id) {
    await streamReady;
    const r = await invoke<any[]>("offline_tracks", { id });
    return r.map((x) => offlineTrack(id, x));
  },
  offlineCreate: (title, description) => invoke<string>("offline_create", { title, description }),
  offlineUpdate: (id, title, description) => invoke("offline_update", { id, title, description }),
  offlineDelete: (id) => invoke("offline_delete_playlist", { id }),
  offlineDeleteTrack: (t) => {
    const [id, file] = t.id.slice(4).split(/\/(.*)/s);
    return invoke("offline_delete_track", { id, file });
  },
  offlineAddFiles: (id) => invoke<number>("offline_add_files", { id }),
  offlineAddPaths: (id, paths) => invoke<number>("offline_add_paths", { id, paths }),
  offlinePickCover: (id) => invoke<boolean>("offline_pick_cover", { id }),
  offlineOpen: (id) => invoke("offline_open", { id: id ?? null }),

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
    if (url.startsWith("offline:")) return localUrl("local", url.slice(8));
    const base = streamBase || "http://vkstream.localhost/";
    return `${base}?u=${encodeURIComponent(url)}`;
  },
};
