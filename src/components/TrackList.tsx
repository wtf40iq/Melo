import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clock3, GripVertical, Heart, MoreHorizontal, Pause, Play } from "lucide-react";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { Track, formatTime } from "../types";
import { Cover } from "./Cover";
import { TrackMenu } from "./TrackMenu";
import { useSettings } from "../store/settings";

type Props = {
  tracks: Track[];
  showAlbum?: boolean;
  /** Если задано — строки можно перетаскивать мышкой. */
  onMove?: (from: number, to: number) => void;
  /** Если задано — в меню трека есть «Удалить из плейлиста». */
  onRemove?: (t: Track, index: number) => void;
};

/** Сколько строк рисуем сверх видимых сверху и снизу. */
const OVERSCAN = 10;

type RowProps = {
  t: Track;
  i: number;
  current: boolean;
  playing: boolean;
  liked: boolean;
  showAlbum: boolean;
  sortable: boolean;
  top: number;
  intro: number;
  tr: (k: string) => string;
  h: Handlers;
};

type Handlers = {
  press: (e: React.PointerEvent, i: number) => void;
  play: (i: number) => void;
  like: (i: number) => void;
  menu: (i: number, x: number, y: number) => void;
};

const Row = memo(function Row({ t, i, current, playing, liked, showAlbum, sortable, top, intro, tr, h }: RowProps) {
  return (
    <div
      role="row"
      data-index={i}
      className={`tl-row ${current ? "current" : ""} ${t.url ? "" : "unavailable"}`}
      style={{ top, ["--i" as string]: intro }}
      onPointerDown={(e) => h.press(e, i)}
      onDoubleClick={() => h.play(i)}
      onContextMenu={(e) => { e.preventDefault(); h.menu(i, e.clientX, e.clientY); }}
    >
      <span className="tl-num">
        {sortable && <GripVertical size={14} className="grip" aria-hidden />}
        <span className="num" key={playing ? "eq" : "n"}>{playing ? <Eq /> : i + 1}</span>
        <button className="row-play" onClick={() => h.play(i)} aria-label={tr("Играть")}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
      </span>
      <span className="tl-title">
        <Cover seed={t.title + t.artist} src={t.cover} size={40} />
        <span className="tl-title-text">
          <b>{t.title}</b>
          <small>
            {t.explicit && <em className="explicit">E</em>}
            {t.artist}
          </small>
        </span>
      </span>
      {showAlbum && <span className="tl-album">{t.album ?? ""}</span>}
      <span className="tl-like">
        <button
          className={`icon-btn sm ${liked ? "liked" : ""}`}
          onClick={() => h.like(i)}
          aria-label={tr(liked ? "Удалить из моей музыки" : "Добавить в мою музыку")}
          data-tip={tr(liked ? "Удалить из моей музыки" : "Добавить в мою музыку")}
        >
          <Heart key={String(liked)} className={liked ? "heart-pop" : ""} size={16} fill={liked ? "currentColor" : "none"} />
        </button>
      </span>
      <span className="tl-time">{formatTime(t.duration)}</span>
      <span className="tl-more">
        <button
          className="icon-btn sm"
          aria-label={tr("Ещё")}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            h.menu(i, r.right - 220, r.bottom + 4);
          }}
        >
          <MoreHorizontal size={17} />
        </button>
      </span>
    </div>
  );
});

export function TrackList({ tracks, showAlbum = true, onMove, onRemove }: Props) {
  const p = usePlayer();
  const lib = useLibrary();
  const s = useSettings();
  const tr = s.t;
  const rowH = s.compact ? 44 : 56;
  const [menu, setMenu] = useState<{ track: Track; i: number; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 40]);
  const [intro, setIntro] = useState(true);
  const dragging = useRef(false);
  const justDragged = useRef(false);

  // Свежие значения для стабильных обработчиков (строки мемоизированы)
  const live = useRef({ tracks, onMove, p, lib, rowH });
  live.current = { tracks, onMove, p, lib, rowH };

  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return tracks.map((t) => {
      const dup = seen.get(t.id) ?? 0;
      seen.set(t.id, dup + 1);
      return dup ? `${t.id}#${dup}` : t.id;
    });
  }, [tracks]);

  // ---------- Виртуализация: рисуем только видимые строки ----------
  const measure = useCallback(() => {
    const body = bodyRef.current;
    const sc = body?.closest(".main") as HTMLElement | null;
    const n = live.current.tracks.length;
    const h = live.current.rowH;
    if (!body || !sc) return setRange([0, n]);
    const top = body.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    const a = Math.max(0, Math.floor(-top / h) - OVERSCAN);
    const b = Math.min(n, Math.ceil((sc.clientHeight - top) / h) + OVERSCAN);
    setRange((r) => (r[0] === a && r[1] === b ? r : [a, Math.max(a, b)]));
  }, []);

  useLayoutEffect(measure, [measure, tracks.length, rowH]);
  useEffect(() => {
    const sc = bodyRef.current?.closest(".main") as HTMLElement | null;
    if (!sc) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    sc.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(sc);
    const id = setTimeout(() => setIntro(false), 700);
    return () => { sc.removeEventListener("scroll", on); ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(id); };
  }, [measure]);

  // ---------- Перетаскивание: всё через DOM, без перерисовок React ----------
  const press = useCallback((e: React.PointerEvent, from: number) => {
    if (!live.current.onMove || e.button !== 0 || (e.target as Element).closest("button")) return;
    const row = e.currentTarget as HTMLElement;
    const list = listRef.current!;
    const body = bodyRef.current!;
    const scroller = list.closest(".main") as HTMLElement | null;
    const h = live.current.rowH;
    const n = live.current.tracks.length;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    let lastY = sy;
    let target = from;
    let raf = 0;
    let ghost: HTMLDivElement | null = null;
    let gl = 0, gy = 0;

    const slotAt = (y: number) => {
      const rel = y - body.getBoundingClientRect().top;
      let k = Math.max(0, Math.ceil((rel - h / 2) / h));
      if (k === from) k = from + 1;
      return Math.min(n, k);
    };
    const shiftOf = (i: number) => {
      if (i === from) return 0;
      if (target > from && i > from && i < target) return -h;
      if (target <= from && i >= target && i < from) return h;
      return 0;
    };
    const applyShifts = () => {
      body.querySelectorAll<HTMLElement>(".tl-row").forEach((r) => {
        const i = Number(r.dataset.index);
        if (i === from) { r.classList.add("drag-src"); return; }
        const v = String(shiftOf(i));
        if (r.dataset.shift !== v) { r.dataset.shift = v; r.style.transform = v === "0" ? "" : `translateY(${v}px)`; }
      });
    };
    const tick = () => {
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const edge = 70;
        if (lastY < r.top + edge) scroller.scrollTop -= Math.ceil((r.top + edge - lastY) / 5);
        else if (lastY > r.bottom - edge) scroller.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 5);
      }
      target = slotAt(lastY);
      applyShifts();
      if (ghost) ghost.style.transform = `translate3d(${gl}px, ${lastY - gy}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      started = true;
      dragging.current = true;
      const r = row.getBoundingClientRect();
      gl = r.left; gy = sy - r.top;
      ghost = document.createElement("div");
      ghost.className = `${list.className.replace("intro", "")} drag-ghost`;
      ghost.style.setProperty("--cols", getComputedStyle(list).getPropertyValue("--cols"));
      ghost.style.width = `${r.width}px`;
      ghost.style.transform = `translate3d(${gl}px, ${r.top}px, 0)`;
      const clone = row.cloneNode(true) as HTMLElement;
      clone.removeAttribute("style");
      ghost.appendChild(clone);
      document.body.appendChild(ghost);
      list.classList.add("dragging");
      document.body.classList.add("is-dragging");
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (!started && Math.hypot(ev.clientX - sx, lastY - sy) >= 5) begin();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cancelAnimationFrame(raf);
      if (!started) return;
      document.body.classList.remove("is-dragging");
      ghost?.remove();
      // Мгновенно: снимаем сдвиги без анимации и сразу переставляем
      list.classList.add("no-trans");
      list.classList.remove("dragging");
      body.querySelectorAll<HTMLElement>(".tl-row").forEach((r) => {
        r.classList.remove("drag-src");
        r.style.transform = "";
        delete r.dataset.shift;
      });
      dragging.current = false;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 60);
      const to = target > from ? target - 1 : target;
      if (to !== from) live.current.onMove?.(from, to);
      requestAnimationFrame(() => requestAnimationFrame(() => list.classList.remove("no-trans")));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  const handlers = useMemo<Handlers>(() => ({
    press,
    play: (i) => {
      if (justDragged.current) return;
      const { tracks, p } = live.current;
      p.playTrack(tracks[i], tracks);
    },
    like: (i) => live.current.lib.toggleMine(live.current.tracks[i]),
    menu: (i, x, y) => setMenu({ track: live.current.tracks[i], i, x, y }),
  }), [press]);

  const [a, b] = range;
  const curId = p.current?.id;
  const rows = [];
  for (let i = a; i < Math.min(b, tracks.length); i++) {
    const t = tracks[i];
    const current = curId === t.id;
    rows.push(
      <Row
        key={keys[i]} t={t} i={i} current={current} playing={current && p.playing} liked={lib.isMine(t)}
        showAlbum={showAlbum} sortable={!!onMove} top={i * rowH} intro={intro ? Math.min(i - a, 30) : 0} tr={tr} h={handlers}
      />,
    );
  }

  return (
    <div ref={listRef} className={`tracklist ${showAlbum ? "" : "no-album"} ${onMove ? "sortable" : ""} ${intro ? "intro" : ""}`} role="table">
      <div className="tl-head" role="row">
        <span>#</span>
        <span>{tr("Название")}</span>
        {showAlbum && <span>{tr("Альбом")}</span>}
        <span />
        <span className="tl-time"><Clock3 size={15} /></span>
        <span />
      </div>
      <div ref={bodyRef} className="tl-body" style={{ height: tracks.length * rowH }}>
        {rows}
      </div>
      {menu && <TrackMenu track={menu.track} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onRemove={onRemove ? () => onRemove(menu.track, menu.i) : undefined} />}
    </div>
  );
}

function Eq() {
  return <span className="eq" aria-hidden><i /><i /><i /></span>;
}
