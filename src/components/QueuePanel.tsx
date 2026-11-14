import { useRef, useState } from "react";
import { Save, Search, Trash2, X } from "lucide-react";
import { api } from "../api";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { errorText, useUi } from "../store/ui";
import { formatTime } from "../types";
import { Cover } from "./Cover";
import { ArtistLinks } from "./ArtistLinks";
import { useT } from "../store/settings";

export function QueuePanel() {
  const p = usePlayer();
  const ui = useUi();
  const lib = useLibrary();
  const t = useT();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const drag = useRef<number | null>(null);
  const [dragAt, setDragAt] = useState<number | null>(null);
  if (!ui.queueOpen) return null;

  const upcomingCount = Math.max(0, p.queue.length - p.index - 1);
  const allUpcoming = p.queue.slice(p.index + 1, p.index + 201).map((tr, j) => ({ tr, i: p.index + 1 + j }));
  const q = query.trim().toLowerCase();
  const upcoming = q
    ? allUpcoming.filter(({ tr }) => `${tr.artist} ${tr.title}`.toLowerCase().includes(q))
    : allUpcoming;

  const clear = () => {
    const old = p.queue.slice(p.index + 1);
    if (!old.length) return;
    p.clearUpcoming();
    ui.toast(t("Очередь очищена"), undefined, {
      action: { label: t("Вернуть"), run: () => p.append(old) },
    });
  };

  const saveQueue = async () => {
    if (saving) return;
    const tracks = p.queue.slice(p.index + 1).filter((tr) => !tr.id.startsWith("off:"));
    if (!tracks.length) return ui.toast(t("В очереди нет треков для сохранения"));
    setSaving(true);
    const title = `${t("Очередь")} ${new Date().toLocaleDateString()}`;
    try {
      const pl = await lib.createPlaylist(title);
      if (!pl) return;
      for (const tr of tracks) await api.addToPlaylist(tr, pl).catch(() => {});
      ui.toast(t("Очередь сохранена в «{name}»", { name: pl.title }));
      lib.reloadPlaylists();
    } catch (e) {
      ui.toast(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="queue">
      <div className="queue-head">
        <h3>{t("Очередь")}</h3>
        <span className="grow" />
        <button className="icon-btn sm" onClick={saveQueue} disabled={saving || upcomingCount === 0} aria-label={t("Сохранить очередь как плейлист")} data-tip={t("Сохранить очередь как плейлист")}>
          <Save size={16} />
        </button>
        <button className="icon-btn sm" onClick={clear} disabled={upcomingCount === 0} aria-label={t("Очистить очередь")} data-tip={t("Очистить очередь")}>
          <Trash2 size={16} />
        </button>
        <button className="icon-btn sm" onClick={() => ui.setQueueOpen(false)} aria-label={t("Закрыть")}><X size={17} /></button>
      </div>
      {p.current && (
        <>
          <small className="queue-label">{t("Сейчас играет")}</small>
          <div className="q-row current">
            <Cover seed={p.current.title + p.current.artist} src={p.current.cover} size={40} />
            <span className="q-text"><b>{p.current.title}</b><small><ArtistLinks track={p.current} /></small></span>
          </div>
        </>
      )}
      <small className="queue-label">{t("Далее · {n}", { n: upcomingCount })}</small>
      {upcomingCount > 3 && (
        <label className="filter q-filter">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Найти в очереди")} />
          {query && <button className="search-clear" onClick={() => setQuery("")} aria-label={t("Очистить")}><X size={13} /></button>}
        </label>
      )}
      <div className="queue-list">
        {upcoming.length === 0 && <span className="muted queue-empty">{q ? t("Ничего не нашлось") : t("Очередь пуста")}</span>}
        {upcoming.slice(0, 200).map(({ tr, i }) => (
          <div
            key={tr.id + i}
            className={`q-row q-drag ${dragAt === i ? "dragging" : ""}`}
            draggable
            onDragStart={(e) => { drag.current = i; setDragAt(i); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { drag.current = null; setDragAt(null); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag.current != null) p.moveInQueue(drag.current, i);
              drag.current = null;
              setDragAt(null);
            }}
            onDoubleClick={() => p.jump(i)}
          >
            <button className="q-main" onClick={() => p.jump(i)}>
              <Cover seed={tr.title + tr.artist} src={tr.cover} size={40} />
              <span className="q-text"><b>{tr.title}</b><small>{tr.artist}</small></span>
            </button>
            <span className="q-time">{formatTime(tr.duration)}</span>
            <button className="icon-btn sm q-remove" onClick={() => p.removeAt(i)} aria-label={t("Убрать из очереди")}><X size={15} /></button>
          </div>
        ))}
      </div>
    </aside>
  );
}
