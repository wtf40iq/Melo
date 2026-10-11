import { MusicApi } from "./types";
import { coverage, rankTracks, trackArtists } from "./match";
import { OfflinePlaylist, Playlist, Track } from "../types";

// Демо-режим для предпросмотра в браузере: без ВК, с тестовым звуком.
let uid = 1000;
const t = (title: string, artist: string, duration: string, album?: string, explicit = true): Track => {
  const [m, s] = duration.split(":").map(Number);
  const id = uid++;
  return { id: `1_${id}`, ownerId: 1, audioId: id, title, artist, album, duration: m * 60 + s, explicit, url: "/demo.mp3" };
};

let mine: Track[] = [
  t("SEXXXDRIVER", "Slattcrank", "2:11"),
  t("clinic", "3umph", "2:12", "anémie"),
  t("хотя бы раз - bonus track", "elyaplugg!", "2:35"),
  t("all inclusive (speed up)", "LUXELIN", "2:05", "all inclusive"),
  t("LOST IN SUMMER", "Aquakey", "3:06"),
  t("Сон позади", "mightymason, Belijokes", "2:15", "ROUTINE LIFE"),
  t("перцовка", "можно выйти?", "2:17"),
  t("Снова 2.0 slowed", "атараксия, MONETY", "2:14"),
  t("солнце ушло за горизонт", "h1deki", "2:06"),
  t("Janice STFU", "Drake", "3:58", "Scorpion"),
  t("Музыка", "WHYNG", "2:41", undefined, false),
  t("ночной город", "h1deki", "2:29"),
];
const other: Track[] = ([
  t("холод", "elyaplugg!", "1:58"),
  t("summer rain", "Aquakey", "2:44", undefined, false),
  t("Rich Flex", "Drake, 21 Savage", "3:59", "Her Loss"),
  t("неон", "LUXELIN", "2:21"),
  t("последний вагон", "h1deki", "2:33"),
  t("Тишина", "WHYNG", "2:50", undefined, false),
]).map((x) => ({ ...x, ownerId: -2, id: `-2_${x.audioId}` }));
const all = () => [...mine, ...other];

const pls: Playlist[] = ["Ночная поездка", "Под учёбу", "Phonk", "Медляки", "Лето 2026"].map((title, i) => ({
  id: `1_${i + 1}`, ownerId: 1, playlistId: i + 1, title, subtitle: "", count: 8, editable: true,
}));

let offline: OfflinePlaylist[] = [{ id: "В дорогу", title: "В дорогу", description: "Скачанное на телефон и в машину", count: 0 }];
const offTracks = (id: string): Track[] =>
  id === "В дорогу" ? mine.slice(0, 4).map((x) => ({ ...x, id: `off:${id}/${x.title}.mp3`, ownerId: 0, url: "/demo.mp3" })) : [];

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));
const pick = (seed: number, n: number) => all().filter((_, i) => (i * 7 + seed) % 3 !== 0).slice(0, n);

export const demoApi: MusicApi = {
  demo: true,
  restore: () => wait(null),
  login: () => wait({ id: 1, name: "skymywex" }),
  browserLogin: () => new Promise((r) => setTimeout(() => r({ id: 1, name: "skymywex" }), 4000)),
  browserSubmit: () => wait(null),
  directLogin: async (p) => (p.code ? { state: "ok", uid: 1, profile: await demoApi.login() } : { state: "code", kind: "sms", phone: "+7 *** *** ** 27", sid: "1" }),
  browserReopen: () => wait(undefined),
  browserCancel: () => wait(undefined),
  logout: () => wait(undefined),
  qrStart: () => wait({ url: "https://qr.vk.ru/ca?q=DEMO42", hash: "demo", expires_at: Date.now() / 1000 + 300 }),
  qrCheck: () => wait({ state: "waiting" as const, raw: 0 }),
  qrSubmit: () => wait({ state: "incorrect" as const, raw: 1 }),
  refresh: (tr) => wait(tr),
  myTracks: (offset, count) => wait({ items: mine.slice(offset, offset + count), total: mine.length }),
  myPlaylists: () => wait(pls),
  playlistTracks: (pl) => wait(pick(pl.playlistId, 8)),
  recommendations: () => wait([...other, ...mine.slice(3)]),
  popular: (g) => wait(pick(g ?? 0, 12)),
  searchTracks: (q) => wait(rankTracks(all().filter((x) => coverage(q, `${x.artist} ${x.title}`) >= 0.5), { any: q })),
  searchExtras: (q) => {
    const names = [...new Set(all().flatMap(trackArtists))].filter((n) => coverage(q, n) >= 1 || coverage(n, q) >= 1);
    return wait({ playlists: pls.filter((p) => coverage(q, p.title) >= 0.5), artists: names.map((name) => ({ name })) });
  },
  deepSearch: (artist, title) => wait(rankTracks(all(), { artist: artist || undefined, title: title || undefined }, true)),
  variants: (t) => wait([
    { ...t, id: `${t.id}_u`, audioId: t.audioId + 1, ownerId: t.ownerId + 7, title: `${t.title} (без цензуры)`, explicit: true },
    { ...t, id: `${t.id}_e`, audioId: t.audioId + 2, ownerId: t.ownerId + 9, explicit: true, duration: t.duration + 1 },
    { ...t, id: `${t.id}_c`, audioId: t.audioId + 3, title: `${t.title} (Clean)`, explicit: false },
  ]),
  artistInfo: (a) => wait(a),
  artistTracks: (a) => wait(all().filter((x) => trackArtists(x).some((n) => n.toLowerCase() === a.name.toLowerCase()))),
  artistAlbums: (a) => wait(pls.slice(0, 2).map((p) => ({ ...p, subtitle: a.name }))),
  offlineRoot: () => wait("C:\\Users\\you\\AppData\\Local\\Melo\\Offline"),
  offlineList: () => wait(offline.map((o) => ({ ...o, count: offTracks(o.id).length }))),
  offlinePlaylist: (id) => wait({ ...offline.find((o) => o.id === id)!, count: offTracks(id).length }),
  offlineTracks: (id) => wait(offTracks(id)),
  offlineCreate: async (title, description) => { offline.push({ id: title, title, description, count: 0 }); return wait(title); },
  offlineUpdate: async (id, title, description) => { const o = offline.find((x) => x.id === id); if (o) Object.assign(o, { title, description }); },
  offlineDelete: async (id) => { offline = offline.filter((x) => x.id !== id); },
  offlineDeleteTrack: async () => {},
  offlineAddFiles: () => wait(0),
  offlineAddPaths: (_id, paths) => wait(paths.length),
  offlinePickCover: () => wait(false),
  offlineOpen: () => wait(undefined),
  artist: (a) => {
    const tracks = all().filter((x) => trackArtists(x).some((n) => n.toLowerCase() === a.name.toLowerCase()));
    return wait({ artist: a, tracks, albums: pls.slice(0, 2).map((p) => ({ ...p, subtitle: a.name })) });
  },
  add: async (tr) => {
    const copy = { ...tr, audioId: uid, id: `1_${uid++}` };
    mine = [copy, ...mine];
    return wait(copy);
  },
  remove: async (tr) => {
    mine = mine.filter((x) => x.id !== tr.id);
    return wait(undefined);
  },
  undoRemove: async (tr) => {
    mine = [tr, ...mine.filter((x) => x.id !== tr.id)];
    return wait(undefined);
  },
  addToPlaylist: () => wait(undefined),
  createPlaylist: async (title) => {
    const p = { id: `1_${uid}`, ownerId: 1, playlistId: uid++, title, subtitle: "", count: 0, editable: true };
    pls.unshift(p);
    return wait(p);
  },
  deletePlaylist: async (pl) => {
    const i = pls.findIndex((x) => x.id === pl.id);
    if (i >= 0) pls.splice(i, 1);
    return wait(undefined);
  },
  renamePlaylist: async (pl, title) => {
    const x = pls.find((y) => y.id === pl.id);
    if (x) x.title = title;
    return wait(undefined);
  },
  removeFromPlaylist: () => wait(undefined),
  lyrics: async (tr) =>
    wait(tr.title.length % 3 === 0 ? null : {
      synced: true,
      lines: ["Ночь опять зовёт меня", "Город в огнях, и я один", "", "Этот трек — просто демо", "Тут будет настоящий текст", "Из ВКонтакте, строка за строкой", "", "И подсветка в такт музыке"].map((text, i) => ({ time: 2 + i * 4, text })),
    }),
  similar: (tr) => wait(all().filter((x) => x.id !== tr.id).sort(() => Math.random() - 0.5).slice(0, 10)),
  reorder: () => wait(undefined),
  accounts: () => wait([{ user_id: 1, name: "skymywex", active: true }, { user_id: 2, name: "Второй аккаунт", active: false }]),
  switchAccount: () => wait(undefined),
  removeAccount: () => wait(undefined),
  detach: () => wait(undefined),
  info: () => wait({ version: "demo", data_dir: "—", stream: "—", client: "demo", api_version: "5.131" }),
  streamUrl: (u) => u,
};
