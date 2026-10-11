import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./settings";

const inTauri = "__TAURI_INTERNALS__" in window;

export type UpdateInfo = {
  available: boolean; current: string; version: string; notes: string; url: string; size: number; digest?: string | null; page: string;
};
type Status = "idle" | "checking" | "latest" | "available" | "downloading" | "error";

type Ctx = {
  status: Status;
  info: UpdateInfo | null;
  error: string;
  progress: number;
  /** Диалог «Доступна новая версия» открыт */
  open: boolean;
  setOpen: (v: boolean) => void;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);

/** «Позже» откладывает напоминание о версии на 12 часов, а не навсегда. */
const SNOOZE_KEY = "melo.update.snooze";
const snoozed = (v: string) => {
  try {
    const x = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "null");
    return x?.v === v && Date.now() < x.until;
  } catch {
    return false;
  }
};
export const snoozeUpdate = (v: string) => localStorage.setItem(SNOOZE_KEY, JSON.stringify({ v, until: Date.now() + 12 * 3600_000 }));

export function UpdateProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  const lastCheck = useRef(0);
  const fails = useRef(0);
  const check = useCallback(async (manual = false) => {
    if (!inTauri || busy.current) return;
    busy.current = true;
    lastCheck.current = Date.now();
    if (manual) setStatus("checking");
    setError("");
    try {
      const i = await invoke<UpdateInfo>("update_check");
      fails.current = 0;
      setInfo(i);
      setStatus(i.available ? "available" : "latest");
      if (i.available && (manual || !snoozed(i.version))) setOpen(true);
    } catch (e) {
      fails.current++;
      // Тихая проверка не пугает ошибкой — просто попробуем ещё раз позже
      if (manual) { setError(String(e)); setStatus("error"); }
      else setStatus((st) => (st === "checking" ? "idle" : st));
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (!info?.available) return;
    setStatus("downloading");
    setProgress(0);
    try {
      await invoke("update_install", { url: info.url, digest: info.digest ?? null });
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [info]);

  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<[number, number]>("update-progress", (e) => {
        const [done, total] = e.payload;
        setProgress(total ? done / total : 0);
      }).then((u) => (off = u)),
    );
    return () => off?.();
  }, []);

  // Тихая проверка: вскоре после запуска, потом каждый час. Если не получилось (нет сети,
  // лимит GitHub) — повтор через 2, 5, 15, 30 минут. Плюс при разворачивании окна и
  // появлении сети, если давно не проверяли.
  useEffect(() => {
    if (!inTauri || !s.autoUpdate) return;
    let timer = 0;
    const plan = () => {
      clearTimeout(timer);
      const retry = [2, 5, 15, 30][Math.min(fails.current, 3)] * 60_000;
      timer = window.setTimeout(run, fails.current ? retry : 60 * 60_000);
    };
    const run = () => { check().finally(plan); };
    timer = window.setTimeout(run, 4000);
    const stale = () => { if (Date.now() - lastCheck.current > 20 * 60_000) run(); };
    const vis = () => { if (!document.hidden) stale(); };
    window.addEventListener("online", run);
    window.addEventListener("focus", stale);
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", stale);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [s.autoUpdate, check]);

  return <C.Provider value={{ status, info, error, progress, open, setOpen, check, install }}>{children}</C.Provider>;
}

export const useUpdate = () => {
  const v = useContext(C);
  if (!v) throw new Error("useUpdate вне UpdateProvider");
  return v;
};

/** Можно звать где угодно: вне UpdateProvider вернёт null. */
export const useUpdateMaybe = () => useContext(C);
