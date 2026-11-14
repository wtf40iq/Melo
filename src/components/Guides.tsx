import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Guide = { v: number | null; h: number | null };

/** Полностью прозрачный слой поверх экрана с линиями центра/краёв. */
export function Guides() {
  const [guide, setGuide] = useState<Guide>({ v: null, h: null });
  useEffect(() => {
    document.documentElement.classList.add("guides-mode");
    let alive = true;
    let off: (() => void) | undefined;
    listen<Guide>("guides", (e) => {
      if (alive) setGuide(e.payload || { v: null, h: null });
    }).then((u) => { if (alive) off = u; else u(); });
    return () => { alive = false; off?.(); document.documentElement.classList.remove("guides-mode"); };
  }, []);
  return (
    <div className="guides-layer" aria-hidden>
      {guide.v != null && <i className="guides-v" style={{ left: `${guide.v * 100}%` }} />}
      {guide.h != null && <i className="guides-h" style={{ top: `${guide.h * 100}%` }} />}
    </div>
  );
}
