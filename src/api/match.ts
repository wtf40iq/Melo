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

const UNCENSORED = /(без\s*цензур|uncensor|un-censor|не\s*цензур|нецензур|без\s*мата|с\s*матом|без\s*запикив|без\s*блюр|без\s*пиканий|explicit|dirty|\b18\s*\+|\bnsfw\b)/i;
const CENSORED = /(\bclean\b|(?<!un)(?<!un-)censor|(?<!без\s?)(?<!не\s?)цензур|radio\s*edit|запикан|\bблюр|\bbeep|\bзамазан)/i;
/** Другая аранжировка — это уже не та же запись, даже если название совпало. */
const VERSION = /\b(speed\s*up|sped\s*up|spedup|slowed|ускоренн\w*|замедленн\w*|remix|ремикс|rmx|nightcore\w*|reverb|8d|bass\s*boost\w*|cover|кавер|karaoke|караоке|минус|instrumental|инструментал|acoustic|акустик\w*|live|концерт\w*|mashup|мэшап|edit|phonk\s*remix|tiktok\s*version|piano|lofi|lo\s*fi|vip)\b/gi;
/** Пометки, которые не меняют саму песню. */
const NOISE = /^(?:\s*(?:без\s*цензур\w*|uncensor\w*|не\s*цензур\w*|нецензур\w*|без\s*мата|с\s*матом|без\s*запикиван\w*|без\s*блюр\w*|explicit(?:\s*version)?|dirty(?:\s*version)?|18\s*\+|nsfw|clean(?:\s*version)?|censor\w*|цензур\w*|radio\s*edit|запикан\w*|original(?:\s*(?:mix|version|audio))?|оригинал\w*|full(?:\s*(?:version|song|track))?|полная(?:\s*версия)?|official(?:\s*(?:audio|video|music\s*video|lyric\s*video))?|lyrics?(?:\s*video)?|текст\w*|премьера\w*|премьера\s*трека|new|новинка|new\s*\d{4}|\d{4}|hq|hd|hi-?fi|flac|\d{3}\s*kbps|mp3|audio|ауди\w*|prod\.?.*|feat\.?.*|ft\.?.*|при\s*уч\.?.*|при\s*участии.*|by\s.*|from\s.*|ost.*|из\s.*)\s*[,;/|+&-]?)+$/i;

/** Название без пометок вроде «(Explicit)», «[без цензуры]», «feat. X», «| 18+». */
export const baseTitle = (s: string) => {
  let r = (s || "").replace(/[([{【「]([^)\]}】」]*)[)\]}】」]/g, (m, inner: string) => (NOISE.test(inner.trim()) || UNCENSORED.test(inner) || CENSORED.test(inner) ? " " : m));
  // Хвосты без скобок: «Песня feat. X», «Песня | без цензуры», «Песня 18+», «Песня *uncensored*»
  r = r.replace(/\s+(?:feat\.?|ft\.?|при\s+уч\.?)\s+.*$/i, " ");
  r = r.replace(/\s*[|/*#•~]+\s*$/, " ");
  for (let k = 0; k < 3; k++) {
    const m = r.match(/^(.*?\S)\s*(?:[|*#•~,–—-]+\s*)?((?:без\s*цензуры|uncensored|explicit|dirty|18\s*\+|clean|original|оригинал|full\s*version|полная\s*версия|official\s*audio|new|hq|lyrics))\s*[!*|#.]*\s*$/i);
    if (!m) break;
    r = m[1];
  }
  r = r.replace(/^\s*(?:new|новинка|премьера|#\S+)\s*[!:|-]+\s*/i, "");
  return r.replace(/\s+/g, " ").trim() || (s || "").trim();
};

// Кириллица → латиница и «скелет» слова: так совпадают «Kizaru» и «Кизару», «Скриптонит» и «Skriptonit»
const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "i", є: "e", ґ: "g" };
export const skel = (s: string) =>
  norm(s).replace(/[а-яёіїєґ]/g, (c) => TR[c] ?? c)
    .replace(/kh/g, "h").replace(/ph/g, "f").replace(/ck|q|c(?=[aouklrt\s]|$)/g, "k").replace(/c/g, "s").replace(/x/g, "ks")
    .replace(/w/g, "v").replace(/[yj]/g, "i").replace(/ee/g, "i").replace(/oo/g, "u").replace(/(.)\1+/g, "$1").replace(/\s+/g, "");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Тексты совпадают с точностью до регистра, знаков, транслита и мелкой опечатки. */
export function sameText(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.replace(/ /g, "") === nb.replace(/ /g, "")) return true;
  const sa = skel(a), sb = skel(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const L = Math.max(sa.length, sb.length);
  return Math.min(sa.length, sb.length) >= 6 && lev(sa, sb) <= Math.floor(L * 0.12);
}

const splitArtists = (s: string) => (s || "").split(/\s*(?:,|;|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bх\b|\bvs\.?|\bпри уч\.?|\/)\s*/i).map((x) => x.trim()).filter((x) => norm(x));
const SEP = /\s+[-–—~|]+\s+|\s*[–—]\s*|\s+-|-\s+/;
const versionTags = (s: string) => [...new Set((norm(s).match(VERSION) ?? []).map((x) => skel(x)))].sort().join(",");

type Pair = { a: string[]; t: string; weak?: boolean };
/** Все правдоподобные разборы «исполнитель / название» для загрузки — с учётом перепутанных и склеенных полей. */
function readings(x: Track): Pair[] {
  const out: Pair[] = [];
  const add = (a: string[], t: string, weak = false) => { const bt = baseTitle(t); if (a.length && norm(bt)) out.push({ a, t: bt, weak }); };
  const arts = x.artists?.length ? x.artists.map((a) => a.name) : splitArtists(x.artist);
  const title = baseTitle(x.title);
  add(arts, title);
  // «Исполнитель - Песня» в названии (а в исполнителе — кто залил или то же самое)
  const ts = title.split(SEP).map((p) => p.trim()).filter(Boolean);
  if (ts.length >= 2) {
    add(splitArtists(ts[0]), ts.slice(1).join(" "));
    add(splitArtists(ts[ts.length - 1]), ts.slice(0, -1).join(" "));
  }
  // «Исполнитель - Песня» в поле исполнителя
  const as = (x.artist || "").split(SEP).map((p) => p.trim()).filter(Boolean);
  if (as.length >= 2) {
    add(splitArtists(as[0]), as.slice(1).join(" "));
    add(splitArtists(as[0]), title);
  }
  // Поля перепутаны: в исполнителе — название песни, в названии — исполнитель
  add(splitArtists(title), x.artist);
  // «Песня (Исполнитель)» / «Песня [Исполнитель]»
  const br = (x.title || "").match(/^(.+?)\s*[([]([^)\]]+)[)\]]\s*$/);
  if (br) add(splitArtists(br[2]), br[1], true);
  return out;
}

const artistsMeet = (a: string[], b: string[]) =>
  a.some((x) => b.some((y) => sameText(x, y) || (norm(x).length >= 3 && norm(y).length >= 3 && (coverage(x, y) >= 1 || coverage(y, x) >= 1))));

/** Насколько уверенно b — та же песня, что и a (0 — другая). */
export function sameSongScore(a: Track, b: Track): number {
  const dd = Math.abs(a.duration - b.duration);
  if (dd > 8) return 0;
  if (versionTags(a.title) !== versionTags(b.title)) return 0;
  const ra = readings(a), rb = readings(b);
  let best = 0;
  for (const pa of ra) for (const pb of rb) {
    if (!sameText(pa.t, pb.t)) continue;
    if (artistsMeet(pa.a, pb.a)) best = Math.max(best, pa.weak || pb.weak ? 2 : 3);
  }
  if (best) return dd > 5 ? best - 1 : best;
  // Перезаливы: «Исполнитель - Название» целиком в одном поле, а в исполнителях — кто попало
  if (isSongText(a, `${b.artist} ${baseTitle(b.title)}`) || isSongText(b, `${a.artist} ${baseTitle(a.title)}`)) return dd > 5 ? 1 : 2;
  // Залито без исполнителя: длинное и редкое название, длина почти до секунды
  const ta = baseTitle(a.title), tb = baseTitle(b.title);
  if (dd <= 2 && sameText(ta, tb) && norm(ta).length >= 12 && words(ta).length >= 3) return 1;
  return 0;
}

/** Та же песня: то же название (с точностью до пометок и транслита), общий исполнитель и почти та же длина. */
export const isSameSong = (a: Track, b: Track) => sameSongScore(a, b) > 0;

/** В тексте есть исполнитель и название трека t, а лишнего — не больше пары слов (ник залившего). */
function isSongText(t: Track, text: string): boolean {
  const tw = words(baseTitle(t.title));
  if (!tw.length) return false;
  const all = words(text);
  const left = [...all];
  const take = (ws: string[]) => ws.every((w) => { const i = left.indexOf(w); if (i < 0) return false; left.splice(i, 1); return true; });
  const artistOk = trackArtists(t).some((a) => { const snap = [...left]; if (take(words(a))) return true; left.splice(0, left.length, ...snap); return false; });
  if (!artistOk || !take(tw)) return false;
  return left.length <= 2 && !left.some((w) => new RegExp(VERSION.source, "i").test(w));
}

/** Мусор в выдаче: в треке нет и трёх четвертей слов запроса. */
export function relevant(list: Track[], q: string): Track[] {
  const keep = list.filter((t) => coverage(q, `${t.artist} ${t.title} ${t.album ?? ""}`) >= 0.75);
  // Если строгий фильтр выкинул почти всё (опечатка, транслит) — оставляем выдачу ВК как есть
  return keep.length >= Math.min(5, list.length) ? keep : list;
}

/** Есть ли пометка «без цензуры» / «цензура» в названии или исполнителе. */
export const uncensoredMark = (t: Track) => UNCENSORED.test(`${t.title} ${t.artist}`);
export const censoredMark = (t: Track) => !uncensoredMark(t) && CENSORED.test(`${t.title} ${t.artist}`);

/** Насколько вариант похож на версию без замазанных слов. */
export function variantScore(orig: Track, v: Track, match = 3): number {
  let s = match * 1.5;
  if (uncensoredMark(v)) s += 7;
  else if (censoredMark(v)) s -= 12;
  if (v.explicit) s += 4;
  else if (orig.explicit) s -= 1.5; // у оригинала есть мат, а у этой загрузки флага нет — вероятно, тоже «чистая»
  if (v.ownerId !== orig.ownerId) s += 1;
  if (v.album) s += 0.5;
  if (!v.url) s -= 4;
  s -= Math.abs(v.duration - orig.duration) * 0.4;
  return s;
}

// Запрос, набранный не в той раскладке: «ghbdtn» → «привет», «ьфсршту» → «machine»
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
export function switchLayout(q: string): string | null {
  const s = q.toLowerCase();
  const lat = /[a-z]/.test(s), cyr = /[а-яё]/.test(s);
  if (lat === cyr) return null; // смешанный или без букв
  const from = lat ? EN : RU, to = lat ? RU : EN;
  let out = "";
  for (const ch of s) { const i = from.indexOf(ch); out += i >= 0 ? to[i] : ch; }
  out = out.replace(/\s+/g, " ").trim();
  if (out === s.trim() || !/[\p{L}]{3,}/u.test(out)) return null;
  // Набранное латиницей «по-русски» почти всегда даёт невозможные сочетания — проверяем гласные
  if (lat && !/[аеёиоуыэюя]/.test(out)) return null;
  if (!lat && !/[aeiouy]/.test(out)) return null;
  return out;
}
