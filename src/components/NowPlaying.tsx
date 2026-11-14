import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Heart, ListMusic, Loader2, Maximize2, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X,
} from "lucide-react";
import { api } from "../api";
import { useLibrary } from "../store/library";
import { usePlayer, usePlaybackPosition } from "../store/player";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { formatTime, isOffline, Lyrics } from "../types";
import { ArtistLinks } from "./ArtistLinks";
import { Cover } from "./Cover";
import { Visualizer } from "./Visualizer";

const cssUrl = (u: string) => `url("${u.replace(/["\\\n\r]/g, "")}")`;

/** Полноэкранный «Сейчас играет»: большая обложка, текст песни и управление. */
export function NowPlaying() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const s = useSettings();
  const t = s.t;
  const position = usePlaybackPosition();
  const track = p.current;
  const [lyrics, setLyrics] = useState<{ id: string; data: Lyrics | null } | null>(null);
  const lyricBox = useRef<HTMLDivElement>(null);
  const lastVol = useRef(0.7);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") ui.setNowOpen(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ui]);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    setLyrics(null);
    api.lyrics(track).then((data) => alive && setLyrics({ id: track.id, data })).catch(() => alive && setLyrics({ id: track.id, data: null }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const lines = lyrics && lyrics.id === track?.id ? lyrics.data?.lines : undefined;
  const active = useMemo(() => {
    if (!lines || !lyrics || !lyrics.data?.synced) return -1;
    let at = -1;
    for (let i = 0; i < lines.length; i++) if ((lines[i].time ?? 0) <= position + 0.2) at = i;
    return at;
  }, [lines, lyrics?.data?.synced, position]);

  useEffect(() => {
    if (active < 0) return;
    lyricBox.current?.querySelector<HTMLElement>(`[data-line="${active}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (!track) {
    return createPortal(
      <div className="now-full">
        <button className="now-full-close" onClick={() => ui.setNowOpen(false)} aria-label={t("Закрыть")}><X size={20} /></button>
        <div className="now-empty">{t("Ничего не играет")}</div>
      </div>,
      document.body,
    );
  }

  const liked = lib.isMine(track);
  const VolIcon = p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const pct = p.duration ? Math.min(100, (position / p.duration) * 100) : 0;

  return createPortal(
    <div
      className="now-full"
      style={track.cover ? { ["--now-bg" as string]: cssUrl(track.cover) } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t("Сейчас играет")}
    >
      <div className="now-full-bg" aria-hidden />
      <div className="now-full-top">
        <span className="now-full-kicker"><Maximize2 size={14} /> {t("Сейчас играет")}</span>
        <button className="now-full-close" onClick={() => ui.setNowOpen(false)} aria-label={t("Закрыть")}><X size={20} /></button>
      </div>

      <div className="now-full-body">
        <div className={`now-full-art ${s.vinyl ? "vinyl" : ""}`}>
          <Cover seed={track.title + track.artist} src={track.cover} radius={18} fill />
          {s.visualizer && <Visualizer playing={p.playing} />}
        </div>
        <div className="now-full-info">
          <h1>{track.title}</h1>
          <div className="now-full-artist"><ArtistLinks track={track} /></div>
          <span className="now-full-meta">
            {[track.album, track.explicit ? "E" : "", p.duration ? formatTime(p.duration) : ""].filter(Boolean).join(" · ")}
          </span>

          <div className="now-full-progress">
            <span>{formatTime(position)}</span>
            <input
              type="range" className="slider" min={0} max={p.duration || 1} step={p.duration <= 1 ? 0.01 : 1}
              value={Math.min(position, p.duration || position)} aria-label={t("Перемотка")}
              onChange={(e) => p.seek(Number(e.target.value))}
              style={{ ["--pct" as string]: `${pct}%` }}
            />
            <span>{formatTime(p.duration)}</span>
          </div>

          <div className="now-full-controls">
            <button className={`icon-btn ${p.shuffle ? "on" : ""}`} onClick={p.toggleShuffle} aria-label={t("Перемешать")}><Shuffle size={20} /></button>
            <button className="icon-btn" onClick={p.prev} aria-label={t("Предыдущий")}><SkipBack size={25} fill="currentColor" /></button>
            <button className={`play-btn now-full-play ${p.playing ? "is-playing" : ""}`} onClick={p.toggle} aria-label={t(p.playing ? "Пауза" : "Играть")}>
              {p.buffering && p.playing ? <Loader2 size={27} className="spin" /> : p.playing ? <Pause size={27} fill="currentColor" /> : <Play size={27} fill="currentColor" />}
            </button>
            <button className="icon-btn" onClick={p.next} aria-label={t("Следующий")}><SkipForward size={25} fill="currentColor" /></button>
            <button className={`icon-btn ${p.repeat !== "off" ? "on" : ""}`} onClick={p.cycleRepeat} aria-label={t("Повтор")}>
              {p.repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          <div className="now-full-tools">
            {!isOffline(track) && (
              <button className={`icon-btn ${liked ? "liked" : ""}`} onClick={() => lib.toggleMine(track)} aria-label={t(liked ? "Удалить из моей музыки" : "Добавить в мою музыку")}>
                <Heart size={19} fill={liked ? "currentColor" : "none"} />
              </button>
            )}
            <button className="icon-btn" onClick={() => { ui.setNowOpen(false); ui.setQueueOpen(true); }} aria-label={t("Очередь")}><ListMusic size={19} /></button>
            <button className="icon-btn" onClick={() => { ui.setNowOpen(false); ui.setLyricsOpen(true); }} aria-label={t("Текст песни")}><Mic2 size={19} /></button>
            <button
              className="icon-btn"
              onClick={() => {
                if (p.volume) { lastVol.current = p.volume; p.setVolume(0); } else p.setVolume(lastVol.current || 0.7);
              }}
              aria-label={t("Звук")}
            >
              <VolIcon size={19} />
            </button>
            <div className="volume now-full-volume" style={{ ["--pct" as string]: `${p.volume * 100}%` }}>
              <input
                type="range" className="slider" min={0} max={1} step={0.01} value={p.volume}
                onChange={(e) => p.setVolume(Number(e.target.value))} aria-label={t("Громкость")}
              />
            </div>
          </div>
        </div>

        <div className="now-full-lyrics" ref={lyricBox}>
          {!lines ? (
            <div className="now-lyrics-empty">{lyrics === null ? <Loader2 className="spin" size={22} /> : t("У этого трека нет текста в ВК")}</div>
          ) : (
            lines.map((line, i) => (
              <p key={i} data-line={i} className={`${i === active ? "on" : ""} ${active >= 0 && i < active ? "past" : ""} ${line.text.trim() ? "" : "gap"}`} onClick={() => line.time != null && p.seek(line.time)}>
                {line.text || "♪"}
              </p>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
