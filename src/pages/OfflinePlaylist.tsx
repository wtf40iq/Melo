import { useEffect, useRef, useState } from "react";
import { FilePlus2, FolderOpen, ImagePlus, MoreHorizontal, Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import { api } from "../api";
import { Cover } from "../components/Cover";
import { Dialog } from "../components/Dialog";
import { Empty, Loading } from "../components/Loading";
import { OfflineDialog } from "../components/OfflineDialog";
import { TrackList } from "../components/TrackList";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { OfflinePlaylist as Pl, Track } from "../types";

export function OfflinePlaylist({ id }: { id: string }) {
  const { t, tracks: tl } = useSettings();
  const ui = useUi();
  const p = usePlayer();
  const [pl, setPl] = useState<Pl | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [del, setDel] = useState<{ t: Track; i: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    try {
      const [info, list] = await Promise.all([api.offlinePlaylist(id), api.offlineTracks(id)]);
      setPl(info);
      setTracks(list);
    } catch (e) {
      ui.toast(errorText(e));
      setTracks([]);
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  // Вернулись в окно (например, после копирования файлов в проводнике) — обновляем список
  useEffect(() => {
    const f = () => reload();
    window.addEventListener("focus", f);
    window.addEventListener("melo-offline-changed", f);
    return () => { window.removeEventListener("focus", f); window.removeEventListener("melo-offline-changed", f); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const tm = setTimeout(() => window.addEventListener("mousedown", close));
    return () => { clearTimeout(tm); window.removeEventListener("mousedown", close); };
  }, [menu]);

  const list = tracks ?? [];
  const total = list.reduce((s, x) => s + x.duration, 0);

  const addFiles = async () => {
    setBusy(true);
    try {
      const n = await api.offlineAddFiles(id);
      if (n) { ui.toast("Добавлено файлов: {n}", { n }); await reload(); }
    } catch (e) {
      ui.toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pickCover = async () => {
    try { if (await api.offlinePickCover(id)) await reload(); } catch (e) { ui.toast(errorText(e)); }
  };

  return (
    <div className="page">
      <div className="pl-header">
        <button className="off-cover" onClick={pickCover} data-tip={t("Сменить обложку")} aria-label={t("Сменить обложку")}>
          <Cover seed={pl?.title ?? id} src={pl?.cover} size={176} radius={12} />
          <span className="off-cover-edit"><ImagePlus size={26} /></span>
        </button>
        <div className="pl-info">
          <small>{t("Офлайн-плейлист")}</small>
          <h1>{pl?.title ?? id}</h1>
          {pl?.description && <span className="off-text">{pl.description}</span>}
          <span className="muted">{tracks && [tl(list.length), t("{n} мин", { n: Math.round(total / 60) })].join(" · ")}</span>
          <div className="row-gap">
            <button className="btn primary" disabled={!list.length} onClick={() => p.playList(list)}><Play size={17} fill="currentColor" /> {t("Слушать")}</button>
            <button className="btn secondary" disabled={!list.length} onClick={() => p.playList([...list].sort(() => Math.random() - 0.5))}><Shuffle size={17} /> {t("Вперемешку")}</button>
            <button className="btn secondary" disabled={busy} onClick={addFiles}><FilePlus2 size={17} /> {t("Добавить файлы")}</button>
            <div className="pl-more" ref={menuRef}>
              <button className="icon-btn round-btn" onClick={() => setMenu(!menu)} aria-label={t("Ещё")} data-tip={t("Ещё")}><MoreHorizontal size={20} /></button>
              {menu && (
                <div className="menu pl-menu" role="menu">
                  <button onClick={() => { setMenu(false); api.offlineOpen(id).catch((e) => ui.toast(errorText(e))); }}><FolderOpen size={16} /> {t("Открыть папку")}</button>
                  <button onClick={() => { setMenu(false); setDialog("edit"); }}><Pencil size={16} /> {t("Изменить название и описание")}</button>
                  <button onClick={() => { setMenu(false); pickCover(); }}><ImagePlus size={16} /> {t("Сменить обложку")}</button>
                  <button className="danger" onClick={() => { setMenu(false); setDialog("delete"); }}><Trash2 size={16} /> {t("Удалить плейлист")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {tracks == null ? <Loading /> : list.length ? (
        <TrackList tracks={list} onRemove={(tr, i) => setDel({ t: tr, i })} removeLabel="Удалить файл" />
      ) : (
        <Empty title={t("В плейлисте пока нет музыки")} text={t("Нажмите «Добавить файлы» или скопируйте mp3 в папку плейлиста")} />
      )}

      {dialog === "edit" && pl && (
        <OfflineDialog edit title={pl.title} description={pl.description} onClose={() => setDialog(null)}
          onSave={async (title, description) => {
            try { await api.offlineUpdate(id, title, description); setDialog(null); await reload(); } catch (e) { ui.toast(errorText(e)); }
          }} />
      )}
      {dialog === "delete" && (
        <Dialog
          title="Удалить офлайн-плейлист?"
          text={t("Папка «{name}» и все файлы в ней удалятся с компьютера.", { name: pl?.title ?? id })}
          icon={<Trash2 size={22} />}
          danger
          confirm="Удалить"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try { await api.offlineDelete(id); setDialog(null); ui.toast("Плейлист удалён"); ui.navigate({ name: "offline" }); } catch (e) { ui.toast(errorText(e)); }
          }}
        />
      )}
      {del && (
        <Dialog
          title="Удалить файл?"
          text={t("«{name}» удалится с компьютера.", { name: `${del.t.artist} — ${del.t.title}` })}
          icon={<Trash2 size={22} />}
          danger
          confirm="Удалить"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            try {
              await api.offlineDeleteTrack(del.t);
              setTracks((l) => (l ?? []).filter((x) => x.id !== del.t.id));
              setDel(null);
            } catch (e) {
              ui.toast(errorText(e));
            }
          }}
        />
      )}
    </div>
  );
}
