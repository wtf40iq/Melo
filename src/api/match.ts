import { Track } from "../types";

/** Нормализация для сравнения: регистр, ё→е, без знаков и лишних пробелов. */
export const norm = (s: string) =>
  (s || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** Доля слов запроса, найденных в тексте (0…1). Короткое слово засчитывается и как начало слова. */
export function coverage(query: string, text: string): number {
  const q = words(query);
  if (!q.length) return 1;
  const hay = ` ${norm(text)} `;
  const tw = hay.trim().split(" ");
  let hit = 0;
  for (const w of q) {
    if (hay.includes(` ${w} `)) hit += 1;
    else if (tw.some((x) => x.startsWith(w) || (w.length > 3 && x.includes(w)))) hit += 0.75;
  }
  return hit / q.length;
}

/** Исполнители трека: из данных ВК или разбором строки «A, B feat. C». */
export const trackArtists = (t: Track) =>
  t.artists?.length ? t.artists.map((a) => a.name) : t.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\/)\s*/i).filter(Boolean);

/** Пересортировка выдачи ВК: сначала то, что точно совпадает с запросом, затем порядок ВК. */
export function rankTracks(list: Track[], q: { any?: string; artist?: string; title?: string }, strict = false, keepAll = false): Track[] {
  const scored = list.map((t, i) => {
    let s = 0;
    const full = `${t.artist} ${t.title}`;
    if (q.any) {
      const qa = q.any;
      const c = coverage(qa, full);
      s += c * 10;
      if (norm(full) === norm(qa) || norm(`${t.title} ${t.artist}`) === norm(qa)) s += 4;
      // Исполнитель трека целиком есть в запросе, а остаток запроса — это ровно название:
      // так находится оригинал, а не перезалив «Исполнитель - Название» от случайного человека
      const arts = trackArtists(t);
      const artHit = arts.some((a) => norm(a) && coverage(a, qa) >= 1) || coverage(t.artist, qa) >= 1;
      if (artHit) {
        s += 4;
        const aw = new Set([...arts.flatMap(words), ...words(t.artist)]);
        const rest = words(qa).filter((w) => !aw.has(w)).join(" ");
        const nt = norm(baseTitle(t.title));
        if (rest && nt === rest) s += 8;
        else if (rest && nt.startsWith(`${rest} `)) s += 2;
      }
      if (norm(t.title) === norm(qa)) s += artHit ? 3 : 0.5;
      if (t.explicit) s += 0.3;
      if (t.album) s += 0.3;
    }
    if (q.artist) {
      const c = Math.max(coverage(q.artist, t.artist), ...trackArtists(t).map((a) => (norm(a) === norm(q.artist!) ? 1 : 0)));
      s += c * 8 + (norm(t.artist) === norm(q.artist) ? 3 : 0);
      if (strict && c < 0.5) s -= 100;
    }
    if (q.title) {
      const c = coverage(q.title, t.title);
      const nt = norm(t.title), nq = norm(q.title);
      s += c * 8 + (nt === nq ? 6 : nt.startsWith(nq) ? 3 : 0);
      if (strict && c < 0.5) s -= 100;
    }
    if (!t.url) s -= 6; // недоступные — в конец
    // Ремиксы и ускоренные версии чуть ниже оригинала, если их не искали
    const ask = norm(`${q.any ?? ""} ${q.title ?? ""}`);
    if (/\b(speed up|sped up|slowed|remix|nightcore\w*|reverb|cover|karaoke|минус)\b/.test(norm(t.title)) && !/\b(speed|sped|slowed|remix|nightcore|reverb|cover|karaoke|минус)\b/.test(ask)) s -= 1.5;
    return { t, s, i };
  });
  return scored
    .filter((x) => keepAll || x.s > -50)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

/** Убирает дубли: тот же трек (исполнитель + название + почти та же длина) и одинаковые id. */
export function dedupeTracks(list: Track[]): Track[] {
  const ids = new Set<string>();
  const keys = new Map<string, number[]>();
  const out: Track[] = [];
  for (const t of list) {
    if (ids.has(t.id)) continue;
    ids.add(t.id);
    const k = `${norm(t.artist)}|${norm(t.title)}`;
    const ds = keys.get(k) ?? [];
    if (ds.some((d) => Math.abs(d - t.duration) <= 2)) continue;
    ds.push(t.duration);
    keys.set(k, ds);
    out.push(t);
  }
  return out;
}

/** Убирает только повторы одного и того же файла (одинаковый id) — разные загрузки остаются, как в ВК. */
export function uniqueTracks(list: Track[]): Track[] {
  const ids = new Set<string>();
  return list.filter((t) => (ids.has(t.id) ? false : (ids.add(t.id), true)));
}

const UNCENSORED = /(без цензур|uncensor|не цензур|без мата|без запикив|без блюр|explicit|dirty|18\+)/i;
const CENSORED = /(\bclean\b|censor|цензур|radio edit|запикан|блюр|\bbeep)/i;
/** Название без пометок вроде «(Explicit)», «[без цензуры]», «(Clean)». */
export const baseTitle = (s: string) =>
  s.replace(/[([{][^)\]}]*[)\]}]/g, (m) => (UNCENSORED.test(m) || CENSORED.test(m) || /original|оригинал|full|полная/i.test(m) ? " " : m)).trim();

/** Та же песня: то же название, общий исполнитель и почти та же длина. */
export function isSameSong(a: Track, b: Track): boolean {
  if (Math.abs(a.duration - b.duration) > 6) return false;
  const ta = norm(baseTitle(a.title)), tb = norm(baseTitle(b.title));
  const aa = trackArtists(a).map(norm), bb = trackArtists(b).map(norm);
  if (ta === tb) return aa.some((x) => bb.includes(x)) || coverage(a.artist, b.artist) >= 0.6 || coverage(b.artist, a.artist) >= 0.6;
  // Перезаливы: «Исполнитель - Название» целиком в названии, а в исполнителях — кто попало
  return isSongText(a, `${b.artist} ${baseTitle(b.title)}`) || isSongText(b, `${a.artist} ${baseTitle(a.title)}`);
}

/** В тексте есть исполнитель и название трека t, а лишнего — не больше пары слов (ник залившего). */
function isSongText(t: Track, text: string): boolean {
  const tw = words(baseTitle(t.title));
  if (!tw.length) return false;
  const all = words(text);
  const left = [...all];
  const take = (ws: string[]) => ws.every((w) => { const i = left.indexOf(w); if (i < 0) return false; left.splice(i, 1); return true; });
  const artistOk = trackArtists(t).some((a) => { const snap = [...left]; if (take(words(a))) return true; left.splice(0, left.length, ...snap); return false; });
  if (!artistOk || !take(tw)) return false;
  return left.length <= 2;
}

/** Мусор в выдаче: в треке нет и трёх четвертей слов запроса. */
export function relevant(list: Track[], q: string): Track[] {
  const keep = list.filter((t) => coverage(q, `${t.artist} ${t.title} ${t.album ?? ""}`) >= 0.75);
  // Если строгий фильтр выкинул почти всё (опечатка, транслит) — оставляем выдачу ВК как есть
  return keep.length >= Math.min(5, list.length) ? keep : list;
}

/** Насколько вариант похож на версию без замазанных слов. */
export function variantScore(orig: Track, v: Track): number {
  let s = 0;
  if (UNCENSORED.test(v.title)) s += 6;
  else if (CENSORED.test(v.title)) s -= 10;
  if (v.explicit) s += 4;
  if (v.ownerId !== orig.ownerId) s += 1;
  if (!v.url) s -= 3;
  s -= Math.abs(v.duration - orig.duration) * 0.4;
  return s;
}
