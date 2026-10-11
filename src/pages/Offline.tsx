import { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, HardDrive, Play, RefreshCw } from "lucide-react";
import { api } from "../api";
import { Cover } from "../components/Cover";
import { Empty, Loading } from "../components/Loading";
import { OfflineDialog } from "../components/OfflineDialog";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { useAsync } from "../useAsync";

export function Offline() {
  const { t, tracks: tl } = useSettings();
  const ui = useUi();
  const p = usePlayer();
  const [tick, setTick] = useState(0);
  const { data, loading } = useAsync(() => api.offlineList(), [tick]);
  const root = useAsync(() => api.offlineRoot(), []);
  const [create, setCreate] = useState(false);
  const list = data ?? [];
  useEffect(() => {
    const f = () => setTick((x) => x + 1);
    window.addEventListener("melo-offline-changed", f);
    return () => window.removeEventListener("melo-offline-changed", f);
  }, []);

  const play = async (id: string) => {
    try {
      const tracks = await api.offlineTracks(id);
      if (!tracks.length) return ui.toast("Плейлист пуст");
      p.playList(tracks);
    } catch (e) {
      ui.toast(errorText(e));
    }
  };

  return (
    <div className="page">
      <div className="search-head">
        <h1 className="page-title">{t("Офлайн")}</h1>
        <div className="row-gap">
          <button className="icon-btn round-btn" onClick={() => setTick((x) => x + 1)} aria-label={t("Обновить")} data-tip={t("Обновить")}><RefreshCw size={18} /></button>
          <button className="btn secondary" onClick={() => api.offlineOpen().catch((e) => ui.toast(errorText(e)))}><FolderOpen size={17} /> {t("Открыть папку")}</button>
          <button className="btn primary" onClick={() => setCreate(true)}><FolderPlus size={17} /> {t("Создать плейлист")}</button>
        </div>
      </div>
      <p className="muted deep-hint off-path" title={root.data ?? ""}>
        <HardDrive size={14} /> {t("Музыка без интернета из папки на компьютере. Одна папка — один плейлист.")} {root.data && <code>{root.data}</code>}
      </p>

      {loading && !data ? <Loading rows={3} /> : !list.length ? (
        <Empty title={t("Офлайн-плейлистов пока нет")} text={t("Создайте плейлист кнопкой сверху или просто перетащите музыку из проводника в окно Melo")} />
      ) : (
        <div className="grid">
          {list.map((pl, i) => (
            <div key={pl.id} className="card" style={{ ["--i" as string]: Math.min(i, 24) }} tabIndex={0}
              onClick={() => ui.navigate({ name: "offline-pl", id: pl.id })}
              onKeyDown={(e) => e.key === "Enter" && ui.navigate({ name: "offline-pl", id: pl.id })}>
              <div className="card-cover">
                <Cover seed={pl.title} src={pl.cover} radius={10} fill />
                <span className="off-badge"><HardDrive size={13} /></span>
                <button className="card-play" onClick={(e) => { e.stopPropagation(); play(pl.id); }} aria-label={`${t("Играть")}: ${pl.title}`}>
                  <Play size={20} fill="currentColor" className="nudge" />
                </button>
              </div>
              <b>{pl.title}</b>
              <small>{pl.description || tl(pl.count)}</small>
            </div>
          ))}
        </div>
      )}

      {create && (
        <OfflineDialog
          onClose={() => setCreate(false)}
          onSave={async (title, description) => {
            try {
              const id = await api.offlineCreate(title, description);
              setCreate(false);
              ui.navigate({ name: "offline-pl", id });
            } catch (e) {
              ui.toast(errorText(e));
            }
          }}
        />
      )}
    </div>
  );
}
