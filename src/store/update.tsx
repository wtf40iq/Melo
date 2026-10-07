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

export function UpdateProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async (manual = false) => {
    if (!inTauri || busy.current) return;
    busy.current = true;
    setStatus("checking");
    setError("");
    try {
      const i = await invoke<UpdateInfo>("update_check");
      setInfo(i);
      setStatus(i.available ? "available" : "latest");
      // автоматически показываем каждую версию один раз; вручную — всегда
      if (i.available && (manual || localStorage.getItem("melo.update.skip") !== i.version)) setOpen(true);
    } catch (e) {
      setError(String(e));
      setStatus("error");
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

  // Тихая проверка вскоре после запуска и раз в 6 часов
  useEffect(() => {
    if (!inTauri || !s.autoUpdate) return;
    const first = setTimeout(() => check(), 5000);
    const every = setInterval(() => check(), 6 * 3600 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [s.autoUpdate, check]);

  return <C.Provider value={{ status, info, error, progress, open, setOpen, check, install }}>{children}</C.Provider>;
}

export const useUpdate = () => {
  const v = useContext(C);
  if (!v) throw new Error("useUpdate вне UpdateProvider");
  return v;
};
