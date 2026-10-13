import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api";
import { norm, trackArtists } from "../api/match";
import { Track, trackKey } from "../types";

/**
 * Подборки дня — как «Плейлисты дня» во ВКонтакте: собираются раз в сутки из ваших треков
 * и рекомендаций ВК, весь день одинаковые, а назавтра — новые.
 */
export type Mix = {
  id: string;
  title: string;
  /** Параметры для перевода заголовка, например исполнитель */
  params?: Record<string, string>;
  subtitle: string;
  hue: number;
  tracks: Track[];
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
/** Сколько часов осталось до новых подборок. */
export const hoursLeft = () => {
  const d = new Date();
  return Math.max(1, Math.ceil((new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime()) / 3_600_000));
};

const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
/** Предсказуемый «случай» на день: подборка не меняется при перезапуске. */
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffleBy = <T,>(a: T[], r: () => number) => {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};
/** Без повторов, только доступные. */
const clean = (list: Track[], max: number) => {
  const ids = new Set<string>(), keys = new Set<string>();
  const out: Track[] = [];
  for (const t of list) {
    const k = trackKey(t);
    if (!t.url || ids.has(t.id) || keys.has(k)) continue;
    ids.add(t.id); keys.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
};

const GENRES: [number, string][] = [[3, "Рэп"], [2, "Поп"], [1, "Рок"], [5, "Электроника"], [21, "Альтернатива"], [17, "Инди"], [4, "Спокойное"]];

async function build(uid: number, library: Track[], day: string): Promise<Mix[]> {
  const r = rng(`${uid}:${day}`);
  const safe = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
  // Любимые исполнители: кого больше всего в «Моей музыке»
  const count = new Map<string, { name: string; n: number; tracks: Track[] }>();
  for (const t of library.slice(0, 1500)) {
    const name = trackArtists(t)[0] || t.artist;
    const k = norm(name);
    if (!k) continue;
    const c = count.get(k) ?? { name, n: 0, tracks: [] };
    c.n++;
    c.tracks.push(t);
    count.set(k, c);
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n);
  // Два исполнителя дня для «Похоже на…»: из первых 20 любимых, каждый день разные
  const pickable = shuffleBy(top.slice(0, 20).filter((a) => a.tracks.some((t) => t.url)), r);
  const seedA = pickable[0], seedB = pickable[1];
  const seedTrack = (a?: { tracks: Track[] }) => (a ? shuffleBy(a.tracks.filter((t) => t.url), r)[0] : undefined);
  const genre = GENRES[hash(day) % GENRES.length];
  const mineSet = new Set(library.flatMap((t) => trackArtists(t).map(norm)));

  const [recs1, recs2, simA, simB, pop, gen] = await Promise.all([
    safe(api.recommendations(), [] as Track[]),
    safe(api.recommendations(), [] as Track[]),
    seedA ? safe(api.similar(seedTrack(seedA)!), [] as Track[]) : Promise.resolve([] as Track[]),
    seedB ? safe(api.similar(seedTrack(seedB)!), [] as Track[]) : Promise.resolve([] as Track[]),
    safe(api.popular(0), [] as Track[]),
    safe(api.popular(genre[0]), [] as Track[]),
  ]);
  const recs = [...recs1, ...recs2];
  const mixes: Mix[] = [];
  const add = (m: Omit<Mix, "tracks">, tracks: Track[], min = 8) => { if (tracks.length >= min) mixes.push({ ...m, tracks }); };

  add({ id: "daily", title: "Микс дня", subtitle: "Новое и любимое под ваш вкус", hue: 262 },
    clean(shuffleBy([...recs.slice(0, 40), ...shuffleBy(library, r).slice(0, 12)], r), 50));
  add({ id: "discover", title: "Открытия дня", subtitle: "Исполнители, которых нет в вашей музыке", hue: 188 },
    clean(shuffleBy([...recs, ...simA, ...simB].filter((t) => !trackArtists(t).some((a) => mineSet.has(norm(a)))), r), 40));
  if (seedA) add({ id: "like-a", title: "Похоже на {name}", params: { name: seedA.name }, subtitle: "Похожие исполнители и их треки", hue: 330 }, clean(shuffleBy(simA, r), 40));
  if (seedB) add({ id: "like-b", title: "Похоже на {name}", params: { name: seedB.name }, subtitle: "Похожие исполнители и их треки", hue: 22 }, clean(shuffleBy(simB, r), 40));
  if (top.length >= 3) {
    const fav = top.slice(0, 8).flatMap((a) => shuffleBy(a.tracks, r).slice(0, 7));
    add({ id: "favorites", title: "Любимые исполнители", subtitle: top.slice(0, 3).map((a) => a.name).join(", "), hue: 350 }, clean(shuffleBy(fav, r), 50));
  }
  if (library.length >= 80) {
    add({ id: "forgotten", title: "Давно не слушали", subtitle: "Старые находки из вашей музыки", hue: 42 }, clean(shuffleBy(library.slice(Math.min(60, library.length >> 2)), r), 40));
  }
  add({ id: "genre", title: "Жанр дня: {name}", params: { name: genre[1] }, subtitle: "Лучшее в жанре прямо сейчас", hue: 148 }, clean(shuffleBy(gen, r), 40));
  add({ id: "charts", title: "Хиты сегодня", subtitle: "Что слушают во ВКонтакте", hue: 212 }, clean(pop, 40));
  return mixes;
}

type Store = { day: string; uid: number; mixes: Mix[]; loading: boolean };
let st: Store = { day: "", uid: 0, mixes: [], loading: false };
const subs = new Set<() => void>();
const emit = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const KEY = (uid: number) => `melo.mixes.${uid}`;
let pending: Promise<void> | null = null;

function ensure(uid: number, library: Track[], libReady: boolean) {
  const day = today();
  if (st.uid === uid && st.day === day && (st.mixes.length || st.loading)) return;
  if (st.uid !== uid || st.day !== day) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(uid)) || "null");
      if (saved?.day === day && saved.mixes?.length) return emit({ uid, day, mixes: saved.mixes, loading: false });
    } catch { /* соберём заново */ }
  }
  // Ждём, пока подгрузится «Моя музыка», — иначе подборки соберутся из пустоты
  if (!libReady || pending) return;
  emit({ uid, day, mixes: [], loading: true });
  pending = build(uid, library, day)
    .then((mixes) => {
      emit({ mixes, loading: false });
      try { localStorage.setItem(KEY(uid), JSON.stringify({ day, mixes })); } catch { /* места нет — не страшно */ }
    })
    .catch(() => emit({ loading: false }))
    .finally(() => { pending = null; });
}

/** Подборки дня для аккаунта; пересобираются в полночь. */
export function useMixes(uid: number | undefined, library: Track[], libReady: boolean) {
  const s = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);
  useEffect(() => {
    if (!uid) return;
    ensure(uid, library, libReady);
    const id = setInterval(() => ensure(uid, library, true), 60_000);
    return () => clearInterval(id);
  }, [uid, libReady, library.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return s.uid === uid ? s : { ...s, mixes: [], loading: true };
}

export const mixById = (id: string) => st.mixes.find((m) => m.id === id);
