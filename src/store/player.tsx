import { antiBlur } from "./antiblur";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState, useMemo, useSyncExternalStore } from "react";
import type Hls from "hls.js";
// Don't parse the HLS engine for login, navigation, local files or MP3 playback.
const loadHls = () => import("hls.js").then((module) => module.default);
import { api } from "../api";
import { Track } from "../types";
import { useUi } from "./ui";
import { applyEq, attachEq, resumeEq } from "./eq";
import { useSettings } from "./settings";

export type Repeat = "off" | "all" | "one";

type PlayerState = {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  playList: (tracks: Track[], startIndex?: number) => void;
  playTrack: (track: Track, list: Track[]) => void;
  jump: (i: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playNext: (t: Track) => void;
  enqueue: (t: Track) => void;
  /** Тихо дописать треки в конец очереди (без повторов) — для бесконечной «Моей волны». */
  append: (tracks: Track[]) => void;
  /** Заменить всё, что играет после текущего трека. */
  replaceUpcoming: (tracks: Track[]) => void;
  /** Подменить играющий трек другой версией, сохранив позицию. */
  swapCurrent: (t: Track) => void;
  removeAt: (i: number) => void;
  stop: () => void;
  /** Восстановить очередь и позицию, сохранённые для этого аккаунта. */
  restore: (userId: number) => void;
};

const Ctx = createContext<PlayerState | null>(null);
// Playback ticks must not invalidate every page, list and effect consumer.
function createClock() {
  let position = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => position,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set: (value: number) => {
      if (!Number.isFinite(value) || value === position) return;
      position = value;
      listeners.forEach((fn) => fn());
    },
  };
}
const ClockCtx = createContext<ReturnType<typeof createClock> | null>(null);
const noSubscribe = () => () => {};
export function usePlaybackPosition(enabled = true) {
  const clock = useContext(ClockCtx);
  if (!clock) throw new Error("usePlaybackPosition вне PlayerProvider");
  return useSyncExternalStore(enabled ? clock.subscribe : noSubscribe, clock.get, clock.get);
}
const saved = <T,>(key: string, def: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
};

const shuffled = <T,>(arr: T[], first: T) => {
  const rest = arr.filter((x) => x !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { toast } = useUi();
  const settings = useSettings();
  const audio = useRef<HTMLAudioElement>(null as unknown as HTMLAudioElement);
  if (!audio.current) {
    audio.current = new Audio();
    audio.current.crossOrigin = "anonymous"; // нужно для эквалайзера (поток идёт через свой прокси)
    audio.current.preload = "auto";
  }
  const hls = useRef<Hls | null>(null);
  const original = useRef<Track[]>([]); // порядок до перемешивания

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [clock] = useState(createClock);
  const setPosition = clock.set;
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => saved("melo.volume", 0.7));
  const [shuffle, setShuffle] = useState<boolean>(() => saved("melo.shuffle", false));
  const [repeat, setRepeat] = useState<Repeat>(() => saved("melo.repeat", "off"));

  const current = queue[index] ?? null;
  const state = useRef({ queue, index, repeat });
  state.current = { queue, index, repeat };

  const skipRef = useRef(settings.skipUnavailable);
  skipRef.current = settings.skipUnavailable;
  const resumeKey = useRef<string | null>(null);
  const fadeTimer = useRef<number | undefined>(undefined);
  // Предел громкости из настроек: ползунок 0–100% даёт 0–volumeMax реальной громкости
  const volMax = Math.min(1, Math.max(0.05, settings.volumeMax ?? 1));
  const volRef = useRef(volume * volMax);
  volRef.current = volume * volMax;
  const loadSeq = useRef(0);
  const retried = useRef(false);
  const playingTrack = useRef<Track | null>(null);

  // Подменяет трек в очереди (например, после обновления ссылки)
  const patchQueue = (t: Track) => {
    const q = state.current.queue.map((x) => (x.id === t.id ? t : x));
    state.current.queue = q;
    setQueue(q);
  };

  // Трек не грузится даже по свежей ссылке (ВК отдаёт 500 и т. п.) — играем другую загрузку той же песни
  const altTried = useRef(new Map<string, Set<string>>());
  const altRef = useRef<(t: Track, autoplay: boolean, why: string) => Promise<boolean>>(async () => false);
  altRef.current = async (t, autoplay, why) => {
    const orig = t.blurOrig ?? t;
    const tried = altTried.current.get(orig.id) ?? new Set<string>([orig.id]);
    tried.add(t.id);
    altTried.current.set(orig.id, tried);
    if (altTried.current.size > 64) altTried.current.delete(altTried.current.keys().next().value!);
    if (t.id.startsWith("off:") || tried.size > 6) {
      setBuffering(false);
      toast("Не удалось загрузить трек: {e}", { e: why });
      return false;
    }
    setBuffering(true);
    const seq = loadSeq.current;
    const list = await api.variants(orig).catch(() => [] as Track[]);
    if (seq !== loadSeq.current) return true; // уже включили другой трек
    // Следующая ещё не пробованная загрузка; если и она не пойдёт — попробуем ещё одну
    const alt = list.find((x) => x.url && !tried.has(x.id));
    if (!alt) {
      setBuffering(false);
      toast("Не удалось загрузить трек: {e}", { e: why });
      return false;
    }
    const next = { ...alt, blurOrig: orig };
    const i = state.current.index;
    const q = state.current.queue.slice();
    if (q[i]?.id === t.id) {
      q[i] = next;
      state.current.queue = q;
      setQueue(q);
    }
    toast("«{name}» не загрузился — включил другую загрузку этой песни", { name: orig.title });
    return load(next, autoplay);
  };

  // Загрузка трека в <audio>. Если ссылки нет или она протухла — берём свежую.
  const load = useCallback(
    async (t: Track, autoplay: boolean, isRetry = false): Promise<boolean> => {
      const seq = ++loadSeq.current;
      const el = audio.current;
      hls.current?.destroy();
      hls.current = null;
      el.removeAttribute("src");
      setPosition(0);
      setDuration(t.duration);
      retried.current = isRetry;

      let track = t;
      if (!track.url || isRetry) {
        setBuffering(true);
        const fresh = await api.refresh(t).catch(() => null);
        if (seq !== loadSeq.current) return true;
        setBuffering(false);
        if (fresh?.url) {
          track = { ...t, url: fresh.url };
          patchQueue(track);
        } else if (isRetry || !track.url) {
          return altRef.current(t, autoplay, "нет ссылки");
        }
      }
      playingTrack.current = track;

      const src = api.streamUrl(track.url!);
      let HlsEngine: Awaited<ReturnType<typeof loadHls>> | null = null;
      if (track.url!.includes(".m3u8")) {
        setBuffering(true);
        try { HlsEngine = await loadHls(); }
        catch { return altRef.current(track, autoplay, "не удалось загрузить движок HLS"); }
        if (seq !== loadSeq.current) return true;
      }
      if (HlsEngine?.isSupported()) {
        const h = new HlsEngine({ enableWorker: true, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 15, maxBufferSize: 20 * 1000 * 1000 });
        h.on(HlsEngine.Events.ERROR, (_, d) => {
          if (!d.fatal || seq !== loadSeq.current) return;
          if (!retried.current) load(t, autoplay, true);
          else {
            setPlaying(false);
            altRef.current(t, autoplay, `${d.details}${d.response?.code ? ` (${d.response.code})` : ""}`);
          }
        });
        h.loadSource(src);
        h.attachMedia(el);
        hls.current = h;
      } else {
        el.src = src;
      }
      if (autoplay) {
        attachEq(el);
        resumeEq();
        el.play().catch(() => {});
        // Если за 20 секунд звук так и не пошёл — говорим, что случилось, а не крутим спиннер вечно
        window.setTimeout(() => {
          if (seq !== loadSeq.current || el.readyState >= 3 || !el.paused) return;
          const kind = hls.current ? "hls" : "mp3";
          const err = el.error ? `media ${el.error.code}` : `net ${el.networkState}, ready ${el.readyState}`;
          setBuffering(false);
          toast("Не удалось загрузить трек: {e}", { e: `${kind}, ${err}` });
        }, 20000);
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );

  const goTo = useCallback(
    async (i: number, autoplay = true) => {
      const q = state.current.queue;
      if (i < 0 || i >= q.length) return;
      // Анти-блюр: для этого трека уже выбрана версия без замазки
      const alt = !q[i].blurOrig && antiBlur.get(q[i].id);
      if (alt) {
        const nq = q.slice();
        nq[i] = { ...alt, blurOrig: q[i] };
        state.current.queue = nq;
        setQueue(nq);
      }
      setIndex(i);
      state.current.index = i;
      const ok = await load(state.current.queue[i], autoplay);
      if (!ok && autoplay && skipRef.current && i + 1 < state.current.queue.length && state.current.index === i) {
        setTimeout(() => goTo(i + 1), 600); // пропускаем недоступный
      }
    },
    [load],
  );

  const next = useCallback(() => {
    const { queue: q, index: i, repeat: r } = state.current;
    if (i + 1 < q.length) goTo(i + 1);
    else if (r === "all" && q.length) goTo(0);
    else {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
  }, [goTo]);

  // События <audio>
  useEffect(() => {
    const el = audio.current;
    el.volume = volRef.current;
    const on = (ev: string, fn: () => void) => el.addEventListener(ev, fn);
    const handlers: [string, () => void][] = [
      ["play", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["waiting", () => setBuffering(true)],
      ["playing", () => setBuffering(false)],
      ["canplay", () => setBuffering(false)],
      ["timeupdate", () => setPosition(el.currentTime)],
      ["durationchange", () => isFinite(el.duration) && setDuration(el.duration)],
      [
        "ended",
        () => {
          if (state.current.repeat === "one") {
            el.currentTime = 0;
            setPosition(0);
            el.play().catch(() => {});
          } else next();
        },
      ],
      [
        "error",
        () => {
          if (hls.current || !el.getAttribute("src") || !playingTrack.current) return;
          if (!retried.current) load(playingTrack.current, true, true); // ссылка протухла — пробуем свежую
          else altRef.current(playingTrack.current, true, `media ${el.error?.code ?? "?"}`);
        },
      ],
    ];
    handlers.forEach(([e, f]) => on(e, f));
    return () => handlers.forEach(([e, f]) => el.removeEventListener(e, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, toast, load]);

  useEffect(() => { audio.current.volume = volume * volMax; localStorage.setItem("melo.volume", JSON.stringify(volume)); }, [volume, volMax]);
  useEffect(() => localStorage.setItem("melo.shuffle", JSON.stringify(shuffle)), [shuffle]);
  useEffect(() => localStorage.setItem("melo.repeat", JSON.stringify(repeat)), [repeat]);

  // Эквалайзер и выравнивание громкости
  useEffect(() => {
    applyEq(settings.eqEnabled, settings.eqGains, settings.normalize);
  }, [settings.eqEnabled, settings.eqGains, settings.normalize, playing]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!current) return;
    attachEq(el);
    resumeEq();
    clearInterval(fadeTimer.current);
    const target = volRef.current;
    if (!settings.fade) {
      el.volume = target;
      if (el.paused) el.play().catch(() => {});
      else el.pause();
      return;
    }
    // Плавно: громкость за ~250 мс
    const ramp = (from: number, to: number, done?: () => void) => {
      const start = performance.now();
      el.volume = from;
      fadeTimer.current = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / 250);
        el.volume = from + (to - from) * k;
        if (k >= 1) {
          clearInterval(fadeTimer.current);
          done?.();
        }
      }, 16);
    };
    if (el.paused) {
      el.play().catch(() => {});
      ramp(0, target);
    } else ramp(el.volume, 0, () => { el.pause(); el.volume = target; });
  }, [current, settings.fade]);

  // Скорость воспроизведения
  useEffect(() => {
    audio.current.playbackRate = settings.speed;
    audio.current.defaultPlaybackRate = settings.speed;
  }, [settings.speed, current]);

  // Запоминаем очередь и позицию, чтобы продолжить после перезапуска
  useEffect(() => {
    const key = resumeKey.current;
    if (!key || !settings.resume) return;
    if (!queue.length) return;
    const from = Math.max(0, index - 100);
    const prefix = JSON.stringify({ queue: queue.slice(from, from + 300), index: index - from }).slice(0, -1);
    let lastSaved = -1;
    const save = () => {
      const pos = audio.current.currentTime;
      if (pos === lastSaved) return;
      try { localStorage.setItem(key, `${prefix},"position":${Number.isFinite(pos) ? pos : 0}}`); lastSaved = pos; }
      catch { /* Full storage must not interrupt playback. */ }
    };
    save();
    const timer = window.setInterval(save, 5000);
    window.addEventListener("beforeunload", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", save);
    };
  }, [index, queue, settings.resume]);

  const prev = useCallback(() => {
    const el = audio.current;
    if (el.currentTime > 3 || index <= 0) { el.currentTime = 0; setPosition(0); }
    else goTo(index - 1);
  }, [index, goTo]);

  // Медиаклавиши и плашка Windows
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (current) {
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album ?? "",
        artwork: current.cover ? [{ src: current.cover, sizes: "135x135" }] : [],
      });
    }
    ms.setActionHandler("play", toggle);
    ms.setActionHandler("pause", toggle);
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", prev);
  }, [current, toggle, next, prev]);

  const startList = (list: Track[], start: number) => {
    original.current = list;
    const q = shuffle ? shuffled(list, list[start]) : list;
    const i = shuffle ? 0 : start;
    state.current.queue = q;
    setQueue(q);
    goTo(i);
  };

  const value = useMemo<PlayerState>(() => ({
    queue,
    index,
    current,
    playing,
    buffering,
    get position() { return clock.get(); },
    duration,
    volume,
    shuffle,
    repeat,
    playList: (list, start = 0) => list.length && startList(list, start),
    playTrack: (track, list) => {
      if (current?.id === track.id) return toggle();
      const i = list.findIndex((x) => x.id === track.id);
      startList(list, Math.max(0, i));
    },
    jump: (i) => goTo(i),
    toggle,
    next,
    prev,
    seek: (s) => {
      audio.current.currentTime = s;
      setPosition(s);
    },
    setVolume: setVolumeState,
    toggleShuffle: () => {
      const on = !shuffle;
      setShuffle(on);
      if (!current) return;
      const q = on ? shuffled(queue, current) : original.current.length ? original.current : queue;
      const i = q.findIndex((x) => x.id === current.id);
      state.current.queue = q;
      setQueue(q);
      setIndex(Math.max(0, i));
    },
    cycleRepeat: () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    playNext: (t) => {
      if (!current) return startList([t], 0);
      const q = [...state.current.queue.slice(0, index + 1), t, ...state.current.queue.slice(index + 1)];
      original.current = [...original.current.slice(0, original.current.findIndex((x) => x.id === current.id) + 1), t, ...original.current.slice(original.current.findIndex((x) => x.id === current.id) + 1)];
      state.current.queue = q;
      setQueue(q);
      toast("Сыграет следующим");
    },
    replaceUpcoming: (list) => {
      if (!current) return startList(list, 0);
      const q = [...state.current.queue.slice(0, index + 1), ...list.filter((x) => x.id !== current.id)];
      original.current = q;
      state.current.queue = q;
      setQueue(q);
    },
    swapCurrent: (t) => {
      const i = state.current.index;
      const q = state.current.queue.slice();
      if (!q[i]) return;
      const el = audio.current;
      const pos = el.currentTime || 0;
      const wasPlaying = !el.paused;
      const old = q[i];
      q[i] = t;
      state.current.queue = q;
      setQueue(q);
      original.current = original.current.map((x) => (x.id === old.id ? t : x));
      load(t, wasPlaying).then((ok) => {
        if (!ok) return;
        const apply = () => { el.currentTime = Math.min(pos, Math.max(0, (el.duration || t.duration) - 1)); setPosition(el.currentTime); };
        if (el.readyState >= 1) apply();
        else el.addEventListener("loadedmetadata", apply, { once: true });
      });
    },
    append: (list) => {
      if (!current) return list.length ? startList(list, 0) : undefined;
      const have = new Set(state.current.queue.map((x) => x.id));
      const add = list.filter((x) => !have.has(x.id) && (have.add(x.id), true));
      if (!add.length) return;
      original.current = [...original.current, ...add];
      const q = [...state.current.queue, ...add];
      state.current.queue = q;
      setQueue(q);
    },
    enqueue: (t) => {
      if (!current) return startList([t], 0);
      const q = [...state.current.queue, t];
      original.current = [...original.current, t];
      state.current.queue = q;
      setQueue(q);
      toast("Добавлено в очередь");
    },
    restore: (userId) => {
      resumeKey.current = `melo.resume.${userId}`;
      if (!settings.resume) return;
      try {
        const r = JSON.parse(localStorage.getItem(resumeKey.current) || "null");
        if (!r?.queue?.length) return;
        const q: Track[] = r.queue;
        const i = Math.min(Math.max(0, r.index | 0), q.length - 1);
        original.current = q;
        state.current.queue = q;
        state.current.index = i;
        setQueue(q);
        setIndex(i);
        load(q[i], false).then(() => {
          const el = audio.current;
          const pos = Number(r.position) || 0;
          const apply = () => { el.currentTime = pos; setPosition(pos); };
          if (el.readyState >= 1) apply();
          else el.addEventListener("loadedmetadata", apply, { once: true });
        });
      } catch {
        /* повреждённые данные — просто начинаем с чистого листа */
      }
    },
    stop: () => {
      clearInterval(fadeTimer.current);
      resumeKey.current = null;
      loadSeq.current++;
      hls.current?.destroy();
      hls.current = null;
      audio.current.pause();
      audio.current.removeAttribute("src");
      audio.current.load();
      original.current = [];
      altTried.current.clear();
      playingTrack.current = null;
      state.current.queue = [];
      state.current.index = -1;
      setPlaying(false);
      setBuffering(false);
      setDuration(0);
      setQueue([]);
      setIndex(-1);
      setPosition(0);
    },
    removeAt: (i) => {
      const previous = state.current.queue;
      if (i === state.current.index || i < 0 || i >= previous.length) return;
      const removed = previous[i], at = original.current.indexOf(removed);
      if (at >= 0) original.current = original.current.filter((_, k) => k !== at);
      const q = previous.filter((_, k) => k !== i);
      state.current.queue = q;
      setQueue(q);
      if (i < state.current.index) { state.current.index--; setIndex(state.current.index); }
    },
  }), [queue, index, current, playing, buffering, duration, volume, shuffle, repeat, toggle, next, prev, goTo, load, toast, settings.resume, clock]);

  useEffect(() => () => {
    loadSeq.current++;
    clearInterval(fadeTimer.current);
    hls.current?.destroy();
    audio.current.pause();
    audio.current.removeAttribute("src");
    audio.current.load();
  }, []);

  return <ClockCtx.Provider value={clock}><Ctx.Provider value={value}>{children}</Ctx.Provider></ClockCtx.Provider>;
}

export const usePlayer = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer вне PlayerProvider");
  return v;
};
