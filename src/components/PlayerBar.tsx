import {
  Heart, ListMusic, Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from "lucide-react";
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { formatTime } from "../types";
import { Cover } from "./Cover";
import { Visualizer } from "./Visualizer";
import { useSettings } from "../store/settings";
import { useT } from "../store/settings";
import { SlidersHorizontal } from "lucide-react";

function Slider({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input
      type="range" className="slider" min={0} max={max || 1} step={max <= 1 ? 0.01 : 1} value={value} aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ["--pct" as string]: `${pct}%` }}
    />
  );
}

export function PlayerBar() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const lastVol = useRef(0.7);
  const [volDrag, setVolDrag] = useState(false);
  const [volFlash, setVolFlash] = useState(false);
  const volTimer = useRef(0);
  const flashVol = () => {
    setVolFlash(true);
    clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolFlash(false), 900);
  };
  const tr = useT();
  const { visualizer } = useSettings();
  const t = p.current;
  const VolIcon = p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const liked = t ? lib.isMine(t) : false;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!t) return;
    const text = `${t.artist} - ${t.title}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    ui.toast("Скопировано: {text}", { text });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <footer className={`player ${p.playing ? "is-playing" : ""}`}>
      {visualizer && <Visualizer playing={p.playing} />}
      <div className="now">
        {t && (
          <>
            <div className="now-cover" key={`c-${t.id}`}>
              <Cover seed={t.title + t.artist} src={t.cover} size={52} radius={8} />
            </div>
            <div className="now-text" key={`t-${t.id}`}>
              <span className="now-text-row">
                <b title={t.title}>{t.title}</b>
              </span>
              <button className="artist-link" onClick={() => ui.setQuery(t.artist)}>{t.artist}</button>
            </div>
            <button
              className={`icon-btn sm copy-btn ${copied ? "done" : ""}`}
              onClick={copy}
              aria-label={tr("Скопировать «исполнитель - название»")}
              data-tip={tr("Скопировать «исполнитель - название»")}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button
              className={`icon-btn ${liked ? "liked" : ""}`}
              onClick={() => lib.toggleMine(t)}
              aria-label={tr(liked ? "Удалить из моей музыки" : "Добавить в мою музыку")}
                data-tip={tr(liked ? "Удалить из моей музыки" : "Добавить в мою музыку")}
            >
              <Heart key={String(liked)} className={liked ? "heart-pop" : ""} size={18} fill={liked ? "currentColor" : "none"} />
            </button>
          </>
        )}
      </div>

      <div className="controls">
        <div className="buttons">
          <button className={`icon-btn ${p.shuffle ? "on" : ""}`} onClick={p.toggleShuffle} aria-label={tr("Перемешать")} data-tip={tr("Перемешать")}>
            <Shuffle size={18} />
          </button>
          <button className="icon-btn" onClick={p.prev} disabled={!t} aria-label={tr("Предыдущий")}>
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className={`play-btn ${p.playing ? "is-playing" : ""}`} onClick={p.toggle} disabled={!t} aria-label={tr(p.playing ? "Пауза" : "Играть")}>
            <span className="play-icon" key={p.buffering && p.playing ? "b" : p.playing ? "pause" : "play"}>
              {p.buffering && p.playing ? <Loader2 size={20} className="spin" /> :
                p.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="nudge" />}
            </span>
          </button>
          <button className="icon-btn" onClick={p.next} disabled={!t} aria-label={tr("Следующий")}>
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button
            className={`icon-btn ${p.repeat !== "off" ? "on" : ""}`}
            onClick={p.cycleRepeat}
            aria-label={tr("Повтор")}
            data-tip={tr(p.repeat === "one" ? "Повтор трека" : p.repeat === "all" ? "Повтор очереди" : "Повтор выключен")}
          >
            {p.repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
        </div>
        <div className="progress">
          <span>{formatTime(p.position)}</span>
          <Slider value={p.position} max={p.duration} onChange={p.seek} label={tr("Перемотка")} />
          <span>{formatTime(p.duration)}</span>
        </div>
      </div>

      <div className="extras">
        <button
          className={`icon-btn ${ui.route.name === "settings" ? "on" : ""}`}
          onClick={() => ui.navigate({ name: "settings" })}
          aria-label={tr("Эквалайзер")}
          data-tip={tr("Эквалайзер")}
        >
          <SlidersHorizontal size={18} />
        </button>
        <button className={`icon-btn ${ui.queueOpen ? "on" : ""}`} onClick={() => ui.setQueueOpen(!ui.queueOpen)} aria-label={tr("Очередь")} data-tip={tr("Очередь")}>
          <ListMusic size={19} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            if (p.volume) { lastVol.current = p.volume; p.setVolume(0); } else p.setVolume(lastVol.current || 0.7);
          }}
          aria-label={tr("Звук")}
        >
          <VolIcon size={19} />
        </button>
        <div
          className="volume vol-wrap"
          style={{ ["--pct" as string]: `${p.volume * 100}%` }}
          onWheel={(e) => { p.setVolume(Math.round(Math.max(0, Math.min(1, p.volume - Math.sign(e.deltaY) * 0.02)) * 100) / 100); flashVol(); }}
          onPointerDown={() => { setVolDrag(true); window.addEventListener("pointerup", () => setVolDrag(false), { once: true }); }}
        >
          <Slider value={p.volume} max={1} onChange={(v) => { p.setVolume(v); flashVol(); }} label={tr("Громкость")} />
          {(volDrag || volFlash) && <span className="vol-bubble">{Math.round(p.volume * 100)}%</span>}
        </div>
      </div>
    </footer>
  );
}
