import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timer, X } from "lucide-react";
import { usePlayer } from "../store/player";
import { useT } from "../store/settings";
import { formatTime } from "../types";

const MINUTES = [15, 30, 45, 60];

/** Таймер сна: пауза через время или после нескольких треков. */
export function SleepMenu() {
  const p = usePlayer();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const active = p.sleepAt != null || p.sleepTracks != null;

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Меряем реальную высоту: иначе меню уезжает слишком высоко к центру экрана.
    const width = box.current?.offsetWidth || 300;
    const height = box.current?.offsetHeight || 240;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const above = r.top - height - 10;
    setPos({ left, top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, r.bottom + 10) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [open]);

  const pick = (fn: () => void) => () => { fn(); setOpen(false); };
  const left = p.sleepAt ? Math.max(0, Math.ceil((p.sleepAt - now) / 1000)) : 0;

  return (
    <>
      <button
        ref={btn}
        className={`icon-btn ${active ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Таймер сна")}
        data-tip={active ? t("Таймер сна включён") : t("Таймер сна")}
      >
        <Timer size={18} />
      </button>
      {open && createPortal(
        <div ref={box} className="eq-pop sleep-pop" style={{ left: pos.left, top: pos.top, right: "auto", bottom: "auto" }} role="dialog" aria-label={t("Таймер сна")}>
          <div className="eq-pop-head">
            <h3>{t("Таймер сна")}</h3>
            <span className="grow" />
            <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label={t("Закрыть")}><X size={16} /></button>
          </div>
          {p.sleepAt && <p className="muted sleep-now">{t("Пауза через")} <b>{formatTime(left)}</b></p>}
          {p.sleepTracks != null && <p className="muted sleep-now">{t("Осталось треков: {n}", { n: p.sleepTracks })}</p>}
          <div className="sleep-grid">
            {MINUTES.map((m) => (
              <button key={m} className="btn secondary sm-btn" onClick={pick(() => p.setSleepTimer(m))}>
                {t("{n} мин", { n: m })}
              </button>
            ))}
            <button className="btn secondary sm-btn" onClick={pick(() => p.setSleepAfterTracks(1))}>{t("После текущего трека")}</button>
            <button className="btn secondary sm-btn" onClick={pick(() => p.setSleepAfterTracks(5))}>{t("После 5 треков")}</button>
          </div>
          {active && <button className="link-btn" onClick={pick(p.clearSleep)}>{t("Выключить таймер")}</button>}
        </div>,
        document.body,
      )}
    </>
  );
}
