import { useSyncExternalStore } from "react";
import { api } from "../api";
import { norm, trackArtists } from "../api/match";
import { Track, trackKey } from "../types";

/** Настроение «Моей волны» — откуда берутся треки. */
export type WaveMode = "foryou" | "discover" | "favorite" | "popular" | "calm";
export const WAVE_MODES: { id: WaveMode; label: string; hint: string }[] = [
  { id: "foryou", label: "Для вас", hint: "Рекомендации ВКонтакте по вашему вкусу" },
  { id: "discover", label: "Открытия", hint: "Исполнители, которых нет в вашей музыке" },
  { id: "favorite", label: "Любимое", hint: "Ваши треки вперемешку с похожими" },
  { id: "popular", label: "Популярное", hint: "Что сейчас слушают во ВКонтакте" },
  { id: "calm", label: "Спокойное", hint: "Тихая музыка для работы и отдыха" },
];

type WaveState = { mode: WaveMode; head: string | null; loading: boolean };
let st: WaveState = { mode: (localStorage.getItem("melo.waveMode") as WaveMode) || "foryou", head: localStorage.getItem("melo.waveHead"), loading: false };
if (!WAVE_MODES.some((m) => m.id === st.mode)) st.mode = "foryou";
const subs = new Set<() => void>();
const set = (p: Partial<WaveState>) => {
  st = { ...st, ...p };
  if ("head" in p) { if (p.head) localStorage.setItem("melo.waveHead", p.head); else localStorage.removeItem("melo.waveHead"); }
  subs.forEach((f) => f());
};
export const useWave = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);
export const waveState = () => st;

const shuffle = <T,>(a: T[]) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

/** Не больше двух треков одного исполнителя подряд — волна звучит разнообразнее. */
function spread(list: Track[]): Track[] {
  const out: Track[] = [];
  const rest = list.slice();
  while (rest.length) {
    const a = out.length ? norm(out[out.length - 1].artist) : "";
    const b = out.length > 1 ? norm(out[out.length - 2].artist) : "";
    let i = rest.findIndex((x) => { const n = norm(x.artist); return !(n === a && n === b) && n !== a; });
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

/** Очередная порция волны: свежие, доступные, без того, что уже звучало. */
export async function waveBatch(mode: WaveMode, library: Track[], played: Track[] = []): Promise<Track[]> {
  const seen = new Set(played.map((t) => t.id));
  const keys = new Set(played.map(trackKey));
  const mineArtists = new Set(library.flatMap((t) => trackArtists(t).map(norm)));
  let pool: Track[] = [];
  if (mode === "foryou") {
    pool = await api.recommendations();
  } else if (mode === "discover") {
    const recs = await api.recommendations();
    const seeds = shuffle(library.slice(0, 300)).slice(0, 2);
    const sim = (await Promise.all(seeds.map((s) => api.similar(s).catch(() => [] as Track[])))).flat();
    pool = [...recs, ...sim].filter((t) => !trackArtists(t).some((a) => mineArtists.has(norm(a))));
    if (pool.length < 12) pool = [...pool, ...recs];
  } else if (mode === "favorite") {
    const mine = shuffle(library).slice(0, 14);
    const seeds = shuffle(library.slice(0, 400)).slice(0, 2);
    const sim = (await Promise.all(seeds.map((s) => api.similar(s).catch(() => [] as Track[])))).flat();
    pool = [...mine, ...shuffle(sim).slice(0, 16)];
    if (!pool.length) pool = await api.recommendations();
  } else if (mode === "popular") {
    pool = await api.popular(0);
  } else {
    pool = [...(await api.popular(4).catch(() => [] as Track[])), ...(await api.popular(21).catch(() => [] as Track[])).slice(0, 15)];
  }
  const out: Track[] = [];
  const take = (list: Track[]) => {
    for (const t of shuffle(list)) {
      const k = trackKey(t);
      if (!t.url || seen.has(t.id) || keys.has(k)) continue;
      seen.add(t.id);
      keys.add(k);
      out.push(t);
    }
  };
  take(pool);
  // ВК отдаёт те же рекомендации, а всё уже прозвучало — продолжаем похожими на последние треки волны
  if (out.length < 6 && played.length) {
    const seeds = shuffle(played.slice(-5)).slice(0, 2);
    const sim = (await Promise.all(seeds.map((x) => api.similar(x).catch(() => [] as Track[])))).flat();
    take(mode === "discover" ? sim.filter((t) => !trackArtists(t).some((a) => mineArtists.has(norm(a)))) : sim);
    if (out.length < 6) take(sim);
  }
  return spread(out).slice(0, 40);
}

type PlayerLike = { playList: (t: Track[]) => void; append: (t: Track[]) => void; queue: Track[]; index: number };

export function setWaveMode(mode: WaveMode) {
  localStorage.setItem("melo.waveMode", mode);
  set({ mode });
}

/** Запустить волну. Возвращает false, если треков не нашлось. */
export async function startWave(p: PlayerLike, library: Track[], mode = st.mode): Promise<boolean> {
  if (st.loading) return false;
  set({ loading: true, mode });
  try {
    const list = await waveBatch(mode, library);
    if (!list.length) return false;
    set({ head: list[0].id });
    p.playList(list);
    return true;
  } finally {
    set({ loading: false });
  }
}

/** Волна сейчас играет (очередь начата волной). */
export const waveActive = (queue: Track[]) => !!st.head && queue[0]?.id === st.head;

/** Подкачать треки, когда до конца очереди волны осталось немного. */
export async function keepWave(p: PlayerLike, library: Track[]) {
  if (st.loading || !waveActive(p.queue) || p.queue.length - p.index > 4) return;
  set({ loading: true });
  try {
    const more = await waveBatch(st.mode, library, p.queue);
    if (more.length) p.append(more);
  } catch {
    /* попробуем на следующем треке */
  } finally {
    set({ loading: false });
  }
}

export const stopWave = () => set({ head: null });
