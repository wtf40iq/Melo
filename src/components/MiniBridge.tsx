import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";

type Action = { action: string; value?: number };

/** Передаёт состояние основного плеера в мини-окно и принимает его команды. */
export function MiniBridge() {
  const p = usePlayer();
  const settings = useSettings();
  const live = useRef(p);
  live.current = p;
  const styleRef = useRef(settings.miniStyle);
  styleRef.current = settings.miniStyle;

  useEffect(() => {
    // Даже если мини-плеер закрыт, запоминаем выбранный вид для следующего открытия.
    void invoke("mini_set_style", { compact: settings.miniStyle === "compact" }).catch(() => {});
  }, [settings.miniStyle]);

  useEffect(() => {
    let alive = true;
    let offAction: (() => void) | undefined;
    let offReady: (() => void) | undefined;
    const emit = () => {
      const pl = live.current;
      const c = pl.current;
      const root = document.documentElement.style;
      void emitTo("mini", "mini-state", {
        title: c?.title,
        artist: c?.artist,
        cover: c?.cover,
        playing: pl.playing,
        buffering: pl.buffering,
        position: pl.position,
        duration: pl.duration,
        volume: pl.volume,
        style: styleRef.current,
        accent: root.getPropertyValue("--accent").trim() || undefined,
        accent2: root.getPropertyValue("--accent-2").trim() || undefined,
        accent3: root.getPropertyValue("--accent-3").trim() || undefined,
        onAccent: root.getPropertyValue("--on-accent").trim() || undefined,
      }).catch(() => {});
    };
    listen<Action>("mini-action", (e) => {
      if (!alive) return;
      const pl = live.current;
      const { action, value } = e.payload || { action: "" };
      if (action === "toggle") pl.toggle();
      else if (action === "next") pl.next();
      else if (action === "prev") pl.prev();
      else if (action === "seek" && typeof value === "number") pl.seek(value);
      else if (action === "volume" && typeof value === "number") pl.setVolume(value);
    }).then((u) => { if (alive) offAction = u; else u(); });
    listen("mini-ready", () => emit()).then((u) => { if (alive) offReady = u; else u(); });
    const id = window.setInterval(emit, 500);
    return () => { alive = false; offAction?.(); offReady?.(); clearInterval(id); };
  }, []);

  return null;
}
