import { Track } from "../types";

/** Запомненные замены: id оригинала → выбранная версия без замазанных слов. */
const KEY = "melo.antiblur";
type Map_ = Record<string, Track>;
const read = (): Map_ => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const strip = (t: Track): Track => { const { url: _u, blurOrig: _o, ...rest } = t; return rest; };

export const antiBlur = {
  get(id: string): Track | undefined { return read()[id]; },
  set(orig: Track, alt: Track) {
    const m = read();
    m[orig.id] = strip(alt);
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* */ }
  },
  forget(id: string) {
    const m = read();
    delete m[id];
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* */ }
  },
};
