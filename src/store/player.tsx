import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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
  removeAt: (i: number) => void;
  stop: () => void;
  /** Восстановить очередь и позицию, сохранённые для этого аккаунта. */
  restore: (userId: number) => void;
};

const Ctx = createContext<PlayerState | null>(null);
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
  const [position, setPosition] = useState(0);
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
  const volRef = useRef(volume);
  volRef.current = volume;
  const loadSeq = useRef(0);
  const retried = useRef(false);
  const playingTrack = useRef<Track | null>(null);

  // Подменяет трек в очереди (например, после обновления ссылки)
  const patchQueue = (t: Track) => {
    const q = state.current.queue.map((x) => (x.id === t.id ? t : x));
    state.current.queue = q;
    setQueue(q);
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
          toast("«{name}» недоступен для прослушивания", { name: t.title });
          return false;
        }
      }
      playingTrack.current = track;

      const src = api.streamUrl(track.url!);
      if (track.url!.includes(".m3u8") && Hls.isSupported()) {
        const h = new Hls({ enableWorker: true, maxBufferLength: 30 });
        h.on(Hls.Events.ERROR, (_, d) => {
          if (!d.fatal || seq !== loadSeq.current) return;
          if (!retried.current) load(t, autoplay, true);
          else {
            toast("Не удалось загрузить трек: {e}", { e: `${d.details}${d.response?.code ? ` (${d.response.code})` : ""}` });
            setBuffering(false);
            setPlaying(false);
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
      setIndex(i);
      state.current.index = i;
      const ok = await load(q[i], autoplay);
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
    el.volume = volume;
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
            el.play();
          } else next();
        },
      ],
      [
        "error",
        () => {
          if (hls.current || !el.getAttribute("src") || !playingTrack.current) return;
          if (!retried.current) load(playingTrack.current, true, true); // ссылка протухла — пробуем свежую
          else {
            setBuffering(false);
            toast("Не удалось загрузить трек: {e}", { e: `media ${el.error?.code ?? "?"}` });
          }
        },
      ],
    ];
    handlers.forEach(([e, f]) => on(e, f));
    return () => handlers.forEach(([e, f]) => el.removeEventListener(e, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, toast, load]);

  useEffect(() => { audio.current.volume = volume; localStorage.setItem("melo.volume", JSON.stringify(volume)); }, [volume]);
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
    const save = () => {
      if (!state.current.queue.length) return;
      const i = state.current.index;
      const q = state.current.queue;
      const from = Math.max(0, i - 100);
      localStorage.setItem(key, JSON.stringify({ queue: q.slice(from, from + 300), index: i - from, position: audio.current.currentTime }));
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
    if (el.currentTime > 3 || index <= 0) el.currentTime = 0;
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

  const value: PlayerState = {
    queue,
    index,
    current,
    playing,
    buffering,
    position,
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
      setQueue((q) => [...q.slice(0, index + 1), t, ...q.slice(index + 1)]);
      toast("Сыграет следующим");
    },
    enqueue: (t) => {
      if (!current) return startList([t], 0);
      setQueue((q) => [...q, t]);
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
      resumeKey.current = null;
      loadSeq.current++;
      hls.current?.destroy();
      hls.current = null;
      audio.current.pause();
      audio.current.removeAttribute("src");
      state.current.queue = [];
      setQueue([]);
      setIndex(-1);
      setPosition(0);
    },
    removeAt: (i) => {
      if (i === index) return;
      setQueue((q) => q.filter((_, k) => k !== i));
      if (i < index) setIndex((x) => x - 1);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePlayer = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer вне PlayerProvider");
  return v;
};
