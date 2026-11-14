import { useEffect } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { inTauri } from "../api";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

/** Глобальные горячие клавиши, работающие даже когда Melo свёрнут. */
export function GlobalHotkeys() {
  const p = usePlayer();
  const lib = useLibrary();
  const s = useSettings();
  const ui = useUi();

  useEffect(() => {
    if (!inTauri || !s.globalHotkeys) return;
    let alive = true;
    const map = new Map<string, () => void>();
    const add = (combo: string, fn: () => void) => {
      const c = combo.trim();
      if (c && !map.has(c)) map.set(c, fn);
    };
    add(s.hotkeyPlay, () => p.toggle());
    add(s.hotkeyNext, () => p.next());
    add(s.hotkeyPrev, () => p.prev());
    add(s.hotkeyLike, () => { if (p.current) void lib.toggleMine(p.current); });
    const combos = [...map.keys()];
    if (!combos.length) return;
    register(combos, (e) => {
      if (e.state !== "Pressed") return;
      map.get(e.shortcut)?.();
    }).catch((e) => { if (alive) ui.toast(String(e)); });
    return () => {
      alive = false;
      void unregisterAll().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.globalHotkeys, s.hotkeyPlay, s.hotkeyNext, s.hotkeyPrev, s.hotkeyLike]);

  return null;
}
