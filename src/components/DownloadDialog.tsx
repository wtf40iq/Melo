import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Download, FolderPlus, Loader2, X } from "lucide-react";
import { api, inTauri } from "../api";
import { useT } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { OfflinePlaylist, Track } from "../types";
import { Cover } from "./Cover";
import { OfflineDialog } from "./OfflineDialog";

/** Выбор офлайн-плейлиста для скачивания трека из ВК. */
export function DownloadDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const t = useT();
  const ui = useUi();
  const [lists, setLists] = useState<OfflinePlaylist[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [create, setCreate] = useState(false);

  useEffect(() => {
    api.offlineList().then(setLists).catch(() => setLists([]));
  }, []);

  const download = async (id: string, name: string) => {
    if (!inTauri || busy) return;
    setBusy(true);
    try {
      let url = track.url;
      if (!url || url.includes(".m3u8")) {
        const fresh = await api.refresh(track);
        url = fresh?.url;
      }
      if (!url) throw new Error(t("ВК не отдал ссылку на этот трек"));
      if (url.includes(".m3u8")) throw new Error(t("HLS-поток пока нельзя скачать в офлайн"));
      await invoke("offline_download", {
        url,
        playlistId: id,
        title: track.title,
        artist: track.artist,
        cover: track.cover ?? null,
      });
      ui.toast(t("Скачано в «{name}»", { name }));
      window.dispatchEvent(new Event("melo-offline-changed"));
      onClose();
    } catch (e) {
      ui.toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="upd-card dialog-card off-dialog" role="dialog" aria-modal="true">
        <button className="icon-btn sm upd-close" onClick={onClose} aria-label={t("Закрыть")}><X size={16} /></button>
        <span className="upd-icon"><Download size={22} /></span>
        <h3>{t("Скачать в офлайн")}</h3>
        <p className="muted">{track.artist} — {track.title}</p>
        {lists == null ? (
          <div className="ab-empty"><Loader2 size={18} className="spin" /> {t("Загрузка")}</div>
        ) : (
          <div className="drop-pick">
            {lists.map((l) => (
              <button key={l.id} disabled={busy} onClick={() => download(l.id, l.title)}>
                <Cover seed={l.title} src={l.cover} size={36} radius={6} />
                <span>{l.title}</span>
                <small>{l.count}</small>
              </button>
            ))}
          </div>
        )}
        <div className="row-gap upd-actions">
          <button className="btn primary" disabled={busy} onClick={() => setCreate(true)}>
            {busy ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />} {t("Новый плейлист")}
          </button>
          <button className="btn secondary" disabled={busy} onClick={onClose}>{t("Отмена")}</button>
        </div>
      </div>
      {create && (
        <OfflineDialog
          onClose={() => setCreate(false)}
          onSave={async (title, description) => {
            try {
              const id = await api.offlineCreate(title, description);
              setCreate(false);
              await download(id, title);
            } catch (e) {
              ui.toast(errorText(e));
            }
          }}
        />
      )}
    </div>,
    document.body,
  );
}
