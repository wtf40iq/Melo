import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { Loader2, Pause, Pin, PinOff, Play, SkipBack, SkipForward, SquareArrowOutUpRight, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { Cover } from "./Cover";
import { formatTime } from "../types";

type MiniStyle = "full" | "compact";
type MiniState = {
  title?: string;
  artist?: string;
  cover?: string;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  volume: number;
  style?: MiniStyle;
  accent?: string;
  accent2?: string;
  accent3?: string;
  onAccent?: string;
};

const empty: MiniState = { playing: false, buffering: false, position: 0, duration: 0, volume: 0.7 };

/** Окно мини-плеера: управляет основным окном через события. */
export function MiniPlayer() {
  const [st, setSt] = useState<MiniState>(empty);
  const [pos, setPos] = useState(0);
  const [vol, setVol] = useState(0.7);
  const [pinned, setPinned] = useState(true);
  const [miniStyle, setMiniStyle] = useState<MiniStyle>("full");
  const lastGuide = useRef("");
  const lastVol = useRef(0.7);
  const seeking = useRef(false);
  const volDragging = useRef(false);
  const drag = useRef<null | {
    id: number;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    dpr: number;
    lastX: number;
    lastY: number;
    sf: number;
    size: { width: number; height: number };
    area: { x: number; y: number; width: number; height: number };
    win: ReturnType<typeof getCurrentWindow>;
  }>(null);
  const dragRaf = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add("mini-mode");
    let alive = true;
    let off: (() => void) | undefined;
    listen<MiniState>("mini-state", (e) => {
      if (!alive) return;
      setSt(e.payload);
      setMiniStyle(e.payload.style === "compact" ? "compact" : "full");
      const root = document.documentElement.style;
      if (e.payload.accent) root.setProperty("--accent", e.payload.accent);
      if (e.payload.accent2) root.setProperty("--accent-2", e.payload.accent2);
      if (e.payload.accent3) root.setProperty("--accent-3", e.payload.accent3);
      if (e.payload.onAccent) root.setProperty("--on-accent", e.payload.onAccent);
      if (!seeking.current) setPos(e.payload.position || 0);
      if (!volDragging.current) {
        setVol(e.payload.volume);
        if (e.payload.volume > 0) lastVol.current = e.payload.volume;
      }
    }).then((u) => { if (alive) off = u; else u(); });
    void emitTo("main", "mini-ready", {}).catch(() => {});
    return () => { alive = false; off?.(); document.documentElement.classList.remove("mini-mode"); };
  }, []);

  // Размер окна следует выбранному виду. Пользователь всё равно может растянуть его руками.
  useEffect(() => {
    const compact = miniStyle === "compact";
    void invoke("mini_set_style", { compact }).catch(() => {});
    // Дублируем размер через window API: так стиль применяется даже если команда
    // почему-то не успела до открытия окна.
    void getCurrentWindow().setSize(new LogicalSize(compact ? 300 : 440, compact ? 76 : 158)).catch(() => {});
  }, [miniStyle]);

  const snapInfo = (x: number, y: number, size: { width: number; height: number }, area: { x: number; y: number; width: number; height: number }, sf: number) => {
    const show = 22 * sf;
    const stick = 8 * sf;
    const edge = 16 * sf;
    const cx = area.x + (area.width - size.width) / 2;
    const cy = area.y + (area.height - size.height) / 2;
    const right = area.x + area.width - size.width - edge;
    const bottom = area.y + area.height - size.height - edge;
    const nearest = (value: number, targets: number[]) => {
      let best: number | null = null;
      for (const target of targets) if (Math.abs(value - target) < show && (best == null || Math.abs(value - target) < Math.abs(value - best))) best = target;
      return best;
    };
    const tx = nearest(x, [cx, area.x + edge, right]);
    const ty = nearest(y, [cy, area.y + edge, bottom]);
    return {
      tx,
      ty,
      sx: tx != null && Math.abs(x - tx) <= stick ? tx : null,
      sy: ty != null && Math.abs(y - ty) <= stick ? ty : null,
      v: tx == null ? null : (tx + size.width / 2 - area.x) / area.width,
      h: ty == null ? null : (ty + size.height / 2 - area.y) / area.height,
    };
  };
  const sendGuide = (v: number | null, h: number | null) => {
    const key = `${v ?? "n"}|${h ?? "n"}`;
    if (key === lastGuide.current) return;
    lastGuide.current = key;
    void emitTo("guides", "guides", { v, h }).catch(() => {});
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(dragRaf.current);
    dragRaf.current = 0;
    const info = snapInfo(d.lastX, d.lastY, d.size, d.area, d.sf);
    if (info.sx != null || info.sy != null) {
      const nx = info.sx ?? d.lastX;
      const ny = info.sy ?? d.lastY;
      void d.win.setPosition(new PhysicalPosition(Math.round(nx), Math.round(ny))).catch(() => {});
    }
    window.setTimeout(() => { sendGuide(null, null); lastGuide.current = ""; }, 800);
  };
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("button, input, textarea, select, a")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const win = getCurrentWindow();
    void (async () => {
      const [pos, size, mon] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()]);
      if (!mon || drag.current) return;
      const area = mon.workArea;
      drag.current = {
        id: e.pointerId,
        startX: e.screenX,
        startY: e.screenY,
        winX: pos.x,
        winY: pos.y,
        dpr: window.devicePixelRatio || 1,
        lastX: pos.x,
        lastY: pos.y,
        sf: mon.scaleFactor || 1,
        size: { width: size.width, height: size.height },
        area: { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height },
        win,
      };
    })();
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const nx = d.winX + Math.round((e.screenX - d.startX) * d.dpr);
    const ny = d.winY + Math.round((e.screenY - d.startY) * d.dpr);
    d.lastX = nx;
    d.lastY = ny;
    if (!dragRaf.current) {
      dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = 0;
        const cur = drag.current;
        if (!cur) return;
        void cur.win.setPosition(new PhysicalPosition(cur.lastX, cur.lastY)).catch(() => {});
      });
    }
    const info = snapInfo(nx, ny, d.size, d.area, d.sf);
    if (info.v != null || info.h != null) sendGuide(info.v, info.h);
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current && e.pointerId === drag.current.id) endDrag();
  };

  const act = (action: string, value?: number) => { void emitTo("main", "mini-action", { action, value }).catch(() => {}); };
  const VolIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
  const pct = st.duration ? Math.min(100, (pos / st.duration) * 100) : 0;
  const setVolume = (v: number) => {
    const next = Math.max(0, Math.min(1, v));
    setVol(next);
    if (next > 0) lastVol.current = next;
    act("volume", next);
  };

  return (
    <div className={`mini-player ${miniStyle}`} onWheel={(e) => { e.preventDefault(); setVolume(vol - Math.sign(e.deltaY) * 0.03); }}>
      <div
        className="mini-body"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={() => endDrag()}
      >
        <Cover seed={(st.title ?? "") + (st.artist ?? "")} src={st.cover} size={62} radius={10} />
        <div className="mini-info">
          <b title={st.title}>{st.title || "Melo"}</b>
          <small title={st.artist}>{st.artist || ""}</small>
          <div className="mini-progress">
            <span>{formatTime(pos)}</span>
            <input
              type="range" className="slider" min={0} max={st.duration || 1} step={st.duration <= 1 ? 0.01 : 1}
              value={Math.min(pos, st.duration || pos)} aria-label="Seek"
              style={{ ["--pct" as string]: `${pct}%` }}
              onPointerDown={() => { seeking.current = true; window.addEventListener("pointerup", () => { seeking.current = false; }, { once: true }); }}
              onChange={(e) => { const v = Number(e.target.value); setPos(v); act("seek", v); }}
            />
            <span>{formatTime(st.duration)}</span>
          </div>
          <div className="mini-vol" style={{ ["--pct" as string]: `${vol * 100}%` }}>
            <button onClick={() => setVolume(vol ? 0 : lastVol.current || 0.7)} aria-label="Volume">
              <VolIcon size={13} />
            </button>
            <input
              type="range" className="slider" min={0} max={1} step={0.01} value={vol} aria-label="Volume"
              onPointerDown={() => { volDragging.current = true; window.addEventListener("pointerup", () => { volDragging.current = false; }, { once: true }); }}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="mini-controls">
          <button onClick={() => act("prev")} aria-label="Previous"><SkipBack size={16} fill="currentColor" /></button>
          <button className="mini-play" onClick={() => act("toggle")} aria-label="Play">
            {st.buffering && st.playing ? <Loader2 size={18} className="spin" /> : st.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button onClick={() => act("next")} aria-label="Next"><SkipForward size={16} fill="currentColor" /></button>
        </div>
        <div className="mini-extra">
          <button onClick={() => { const next = !pinned; setPinned(next); void invoke("mini_set_pinned", { value: next }); }} aria-label={pinned ? "Unpin" : "Pin"} className={pinned ? "on" : ""}>
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button className="mini-open" onClick={() => { void invoke("tray_action", { action: "show" }); }} aria-label="Open Melo"><SquareArrowOutUpRight size={15} /></button>
          <button onClick={() => { void invoke("mini_hide"); }} aria-label="Close"><X size={16} /></button>
        </div>
      </div>
      <button
        className="mini-resize"
        aria-label="Resize"
        onPointerDown={(e) => { e.preventDefault(); void getCurrentWindow().startResizeDragging("SouthEast"); }}
      />
    </div>
  );
}
