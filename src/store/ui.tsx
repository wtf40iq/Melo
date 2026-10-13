import { createContext, ReactNode, useCallback, useContext, useRef, useState, useMemo, useEffect } from "react";
import { Artist, Playlist } from "../types";

export type Route =
  | { name: "home" }
  | { name: "library" }
  | { name: "playlists" }
  | { name: "explore" }
  | { name: "settings" }
  | { name: "playlist"; playlist: Playlist }
  | { name: "artist"; artist: Artist }
  | { name: "deep"; artist?: string; title?: string }
  | { name: "offline" }
  | { name: "offline-pl"; id: string }
  | { name: "mix"; id: string };

export type ToastParams = Record<string, string | number>;
export type ToastOptions = { action?: { label: string; run: () => void }; duration?: number };
type Toast = { id: number; text: string; params?: ToastParams; action?: ToastOptions["action"]; duration: number };

type UiState = {
  route: Route;
  canBack: boolean;
  canForward: boolean;
  navigate: (r: Route) => void;
  back: () => void;
  forward: () => void;
  query: string;
  setQuery: (q: string) => void;
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
  lyricsOpen: boolean;
  setLyricsOpen: (v: boolean) => void;
  toast: (text: string, params?: ToastParams, opts?: ToastOptions) => void;
  dismissToast: (id: number) => void;
};

const Ctx = createContext<UiState | null>(null);
const ToastCtx = createContext<{ toasts: Toast[]; dismissToast: (id: number) => void } | null>(null);
export const useToasts = () => {
  const value = useContext(ToastCtx);
  if (!value) throw new Error("useToasts вне UiProvider");
  return value;
};
const same = (a: Route, b: Route) =>
  a.name === b.name &&
  (a.name !== "playlist" || (b.name === "playlist" && a.playlist.id === b.playlist.id)) &&
  (a.name !== "artist" || (b.name === "artist" && (a.artist.id ?? a.artist.name) === (b.artist.id ?? b.artist.name))) &&
  (a.name !== "offline-pl" || (b.name === "offline-pl" && a.id === b.id)) &&
  (a.name !== "mix" || (b.name === "mix" && a.id === b.id)) &&
  a.name !== "deep";

export function UiProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Route[]>([{ name: "home" }]);
  const [pos, setPos] = useState(0);
  const [query, setQuery] = useState("");
  const [queueOpen, setQueueOpenRaw] = useState(false);
  const [lyricsOpen, setLyricsOpenRaw] = useState(false);
  // Очередь и текст песни открываются на одном месте справа — одно закрывает другое
  const setQueueOpen = useCallback((v: boolean) => { setQueueOpenRaw(v); if (v) setLyricsOpenRaw(false); }, []);
  const setLyricsOpen = useCallback((v: boolean) => { setLyricsOpenRaw(v); if (v) setQueueOpenRaw(false); }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, params?: ToastParams, opts?: ToastOptions) => {
    const id = nextId.current++;
    const duration = opts?.duration ?? (opts?.action ? 5000 : 3200);
    setToasts((t) => [...t.slice(-2), { id, text, params, action: opts?.action, duration }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, duration);
    timers.current.add(timer);
  }, []);

  const route = history[pos];
  const value = useMemo<UiState>(() => ({
    route,
    canBack: pos > 0,
    canForward: pos < history.length - 1,
    navigate: (r) => {
      setQuery("");
      if (same(r, route)) return;
      setHistory((h) => [...h.slice(0, pos + 1), r]);
      setPos(pos + 1);
    },
    back: () => { setQuery(""); setPos((p) => Math.max(0, p - 1)); },
    forward: () => { setQuery(""); setPos((p) => Math.min(history.length - 1, p + 1)); },
    query,
    setQuery,
    queueOpen,
    setQueueOpen,
    lyricsOpen,
    setLyricsOpen,
    toast,
    dismissToast,
  }), [route, history, pos, query, queueOpen, lyricsOpen, setQueueOpen, setLyricsOpen, toast, dismissToast]);
  const notices = useMemo(() => ({ toasts, dismissToast }), [toasts, dismissToast]);
  return <Ctx.Provider value={value}><ToastCtx.Provider value={notices}>{children}</ToastCtx.Provider></Ctx.Provider>;
}

export const useUi = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi вне UiProvider");
  return v;
};

export const errorText = (e: unknown) => {
  const s = String((e as Error)?.message ?? e);
  if (s.includes("session_expired")) return "Сессия ВК закончилась — продлите вход";
  if (s.includes("not_authorized")) return "Сессия истекла, войдите снова";
  return s;
};
