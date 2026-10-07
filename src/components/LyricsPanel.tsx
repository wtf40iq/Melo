import { useEffect, useRef, useState } from "react";
import { Loader2, Mic2, X } from "lucide-react";
import { api } from "../api";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { useT } from "../store/settings";
import { Lyrics } from "../types";
import { Cover } from "./Cover";

/** Текст песни справа; строки с таймкодами подсвечиваются в такт. */
export function LyricsPanel() {
  const p = usePlayer();
  const ui = useUi();
  const t = useT();
  const cur = p.current;
  const [data, setData] = useState<{ id: string; lyrics: Lyrics | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = ui.lyricsOpen;

  useEffect(() => {
    if (!open || !cur || data?.id === cur.id) return;
    let alive = true;
    setData(null);
    api.lyrics(cur).then((l) => alive && setData({ id: cur.id, lyrics: l })).catch(() => alive && setData({ id: cur.id, lyrics: null }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cur?.id]);

  const lyrics = data?.id === cur?.id ? data?.lyrics : undefined;
  let active = -1;
  if (lyrics?.synced) {
    for (let i = 0; i < lyrics.lines.length; i++) if ((lyrics.lines[i].time ?? 0) <= p.position + 0.25) active = i;
  }

  // Текущая строка — по центру
  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (!open) return null;
  return (
    <aside className="queue lyrics-panel">
      <div className="queue-head">
        <h3>{t("Текст песни")}</h3>
        <button className="icon-btn sm" onClick={() => ui.setLyricsOpen(false)} aria-label={t("Закрыть")}><X size={17} /></button>
      </div>
      {cur && (
        <div className="q-row current">
          <Cover seed={cur.title + cur.artist} src={cur.cover} size={40} />
          <span className="q-text"><b>{cur.title}</b><small>{cur.artist}</small></span>
        </div>
      )}
      <div className={`lyrics ${lyrics?.synced ? "synced" : ""}`} ref={listRef}>
        {!cur ? (
          <div className="lyrics-empty"><Mic2 size={28} /><span>{t("Включите трек")}</span></div>
        ) : lyrics === undefined ? (
          <div className="lyrics-empty"><Loader2 size={24} className="spin" /></div>
        ) : lyrics === null ? (
          <div className="lyrics-empty"><Mic2 size={28} /><span>{t("У этого трека нет текста в ВК")}</span></div>
        ) : (
          lyrics.lines.map((l, i) => (
            <p
              key={i}
              data-line={i}
              className={`${l.text.trim() ? "" : "gap"} ${i === active ? "on" : ""} ${active >= 0 && i < active ? "past" : ""}`}
              onClick={() => l.time != null && p.seek(l.time)}
            >
              {l.text || "♪"}
            </p>
          ))
        )}
      </div>
    </aside>
  );
}
