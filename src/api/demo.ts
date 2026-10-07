import { MusicApi } from "./types";
import { Playlist, Track } from "../types";

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

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));
const pick = (seed: number, n: number) => all().filter((_, i) => (i * 7 + seed) % 3 !== 0).slice(0, n);

export const demoApi: MusicApi = {
  demo: true,
  restore: () => wait(null),
  login: () => wait({ id: 1, name: "skymywex" }),
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
  search: async (q) => {
    const s = q.toLowerCase();
    return wait({
      tracks: all().filter((x) => `${x.artist} ${x.title}`.toLowerCase().includes(s)),
      playlists: pls.filter((p) => p.title.toLowerCase().includes(s)),
    });
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
  reorder: () => wait(undefined),
  accounts: () => wait([{ user_id: 1, name: "skymywex", active: true }, { user_id: 2, name: "Второй аккаунт", active: false }]),
  switchAccount: () => wait(undefined),
  removeAccount: () => wait(undefined),
  detach: () => wait(undefined),
  info: () => wait({ version: "demo", data_dir: "—", stream: "—", client: "demo", api_version: "5.131" }),
  streamUrl: (u) => u,
};
