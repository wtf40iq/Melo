import { X } from "lucide-react";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { formatTime } from "../types";
import { Cover } from "./Cover";
import { useT } from "../store/settings";

export function QueuePanel() {
  const p = usePlayer();
  const ui = useUi();
  const t = useT();
  if (!ui.queueOpen) return null;
  const upcoming = p.queue.map((t, i) => ({ t, i })).slice(p.index + 1);

  return (
    <aside className="queue">
      <div className="queue-head">
        <h3>{t("Очередь")}</h3>
        <button className="icon-btn sm" onClick={() => ui.setQueueOpen(false)} aria-label={t("Закрыть")}><X size={17} /></button>
      </div>
      {p.current && (
        <>
          <small className="queue-label">{t("Сейчас играет")}</small>
          <div className="q-row current">
            <Cover seed={p.current.title + p.current.artist} src={p.current.cover} size={40} />
            <span className="q-text"><b>{p.current.title}</b><small>{p.current.artist}</small></span>
          </div>
        </>
      )}
      <small className="queue-label">{t("Далее · {n}", { n: upcoming.length })}</small>
      <div className="queue-list">
        {upcoming.length === 0 && <span className="muted queue-empty">{t("Очередь пуста")}</span>}
        {upcoming.slice(0, 200).map(({ t: tr, i }) => (
          <div key={tr.id + i} className="q-row" onDoubleClick={() => p.jump(i)}>
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
