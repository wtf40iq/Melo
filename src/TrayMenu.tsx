import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ExternalLink, Pause, Play, Power, SkipBack, SkipForward } from "lucide-react";
import { Lang, translate } from "./i18n";
import { Logo } from "./components/Logo";
import { Stars } from "./components/Effects";

type State = { title?: string | null; artist?: string | null; cover?: string | null; playing: boolean };

const readJson = (k: string) => {
  try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; }
};
const readSettings = () => ({ ...readJson("melo.settings"), live: readJson("melo.live") });

/** Меню у значка в трее: отдельное маленькое прозрачное окно. */
export function TrayMenu() {
  const [st, setSt] = useState<State>({ playing: false });
  const [cfg, setCfg] = useState(readSettings);
  const [open, setOpen] = useState(0);
  const lang: Lang = cfg.lang === "en" ? "en" : "ru";
  const t = (k: string) => translate(lang, k);
  const act = (action: string) => invoke("tray_action", { action }).catch(() => {});

  useEffect(() => {
    document.documentElement.classList.add("tray-mode");
    invoke<State>("tray_state").then(setSt).catch(() => {});
    const offs = [
      listen<State>("tray-state", (e) => setSt(e.payload)),
      listen("tray-open", () => { setCfg(readSettings()); setOpen((n) => n + 1); }),
    ];
    const key = (e: KeyboardEvent) => e.key === "Escape" && act("hide");
    window.addEventListener("keydown", key);
    window.addEventListener("storage", () => setCfg(readSettings()));
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => { offs.forEach((p) => p.then((u) => u())); window.removeEventListener("keydown", key); };
  }, []);

  const glass = cfg.glass && cfg.glass !== "off";
  const bg: string = cfg.bgEffect || "none";
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", cfg.live?.accent || cfg.accent || "#5E9FE8");
    root.style.setProperty("--on-accent", cfg.live?.onAccent || "#ffffff");
    root.style.setProperty("--glass-a", String(cfg.glassOpacity ?? 0.55));
    root.classList.toggle("tray-glass", !!glass);
  }, [cfg, glass]);

  return (
    <div className="tray-card" key={open}>
      {bg !== "none" && (
        <div className={`tray-bg fx-${bg}`} aria-hidden>
          {bg === "aurora" && <><i /><i /><i /><i /></>}
          {bg === "cover" && st.cover && <div className="fx-cover" style={{ backgroundImage: `url("${st.cover}")` }} />}
          {bg === "stars" && <Stars />}
        </div>
      )}
      <div className="tray-now">
        {st.cover ? <img src={st.cover} alt="" /> : <span className="tray-cover-empty"><Logo size={26} /></span>}
        <span className="tray-text">
          <b>{st.title || "Melo"}</b>
          <small>{st.title ? st.artist : t("Ничего не играет")}</small>
        </span>
        {st.playing && <span className="eq" aria-hidden><i /><i /><i /></span>}
      </div>
      <div className="tray-controls">
        <button onClick={() => act("prev")} aria-label={t("Предыдущий")}><SkipBack size={18} fill="currentColor" /></button>
        <button className="tray-play" onClick={() => act("toggle")} aria-label={t("Играть")}>
          {st.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button onClick={() => act("next")} aria-label={t("Следующий")}><SkipForward size={18} fill="currentColor" /></button>
      </div>
      <div className="tray-sep" />
      <button className="tray-item" onClick={() => act("show")}><ExternalLink size={16} /> {t("Открыть Melo")}</button>
      <button className="tray-item danger" onClick={() => act("quit")}><Power size={16} /> {t("Выход")}</button>
    </div>
  );
}
