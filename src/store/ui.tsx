import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Playlist } from "../types";

export type Route =
  | { name: "home" }
  | { name: "library" }
  | { name: "playlists" }
  | { name: "explore" }
  | { name: "settings" }
  | { name: "playlist"; playlist: Playlist };

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
  toast: (text: string, params?: ToastParams, opts?: ToastOptions) => void;
  dismissToast: (id: number) => void;
  toasts: Toast[];
};

const Ctx = createContext<UiState | null>(null);
const same = (a: Route, b: Route) =>
  a.name === b.name && (a.name !== "playlist" || (b.name === "playlist" && a.playlist.id === b.playlist.id));

export function UiProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Route[]>([{ name: "home" }]);
  const [pos, setPos] = useState(0);
  const [query, setQuery] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, params?: ToastParams, opts?: ToastOptions) => {
    const id = nextId.current++;
    const duration = opts?.duration ?? (opts?.action ? 5000 : 3200);
    setToasts((t) => [...t.slice(-2), { id, text, params, action: opts?.action, duration }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration);
  }, []);

  const route = history[pos];
  const value: UiState = {
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
    toast,
    dismissToast,
    toasts,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useUi = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi вне UiProvider");
  return v;
};

export const errorText = (e: unknown) => {
  const s = String((e as Error)?.message ?? e);
  if (s.includes("not_authorized")) return "Сессия истекла, войдите снова";
  return s;
};
