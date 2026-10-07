import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Play, Shuffle, Trash2 , Link2, Link2Off} from "lucide-react";
import { api } from "../api";
import { melo } from "../api/melo";
import { Cover } from "../components/Cover";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { Dialog } from "../components/Dialog";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { errorText, useUi } from "../store/ui";
import { Playlist, Track } from "../types";
import { useAsync } from "../useAsync";
import { useSettings } from "../store/settings";

export function PlaylistPage({ playlist }: { playlist: Playlist }) {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const { t, tracks: tl } = useSettings();
  const { data, loading } = useAsync(() => api.playlistTracks(playlist), [playlist.id]);
  const [tracks, setTracks] = useState<Track[]>([]);
  useEffect(() => setTracks(data ?? []), [data]);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"delete" | "rename" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Название могло поменяться после переименования
  const pl = lib.playlists.find((x) => x.id === playlist.id) ?? playlist;
  const editable = !!pl.editable;
  const total = tracks.reduce((s, x) => s + x.duration, 0);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const id = setTimeout(() => window.addEventListener("mousedown", close));
    return () => { clearTimeout(id); window.removeEventListener("mousedown", close); };
  }, [menu]);

  const removeTrack = async (tr: Track, i: number) => {
    setTracks((list) => list.filter((_, k) => k !== i));
    try {
      await api.removeFromPlaylist(tr, pl);
      ui.toast("Удалено из «{name}»", { name: pl.title });
    } catch (e) {
      setTracks((list) => [...list.slice(0, i), tr, ...list.slice(i)]);
      ui.toast(errorText(e));
    }
  };

  return (
    <div className="page">
      <div className="pl-header">
        <Cover seed={pl.title} src={pl.cover} size={176} radius={12} />
        <div className="pl-info">
          <small>{t("Плейлист")}</small>
          <h1>{pl.title}</h1>
          <span className="muted">
            {[pl.subtitle, !loading && tl(tracks.length), !loading && t("{n} мин", { n: Math.round(total / 60) })]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <div className="row-gap">
            <button className="btn primary" disabled={!tracks.length} onClick={() => p.playList(tracks)}>
              <Play size={17} fill="currentColor" /> {t("Слушать")}
            </button>
            <button className="btn secondary" disabled={!tracks.length} onClick={() => p.playList([...tracks].sort(() => Math.random() - 0.5))}>
              <Shuffle size={17} /> {t("Вперемешку")}
            </button>
            {editable && (
              <div className="pl-more" ref={menuRef}>
                <button className="icon-btn round-btn" onClick={() => setMenu(!menu)} aria-label={t("Ещё")} data-tip={t("Ещё")}>
                  <MoreHorizontal size={20} />
                </button>
                {menu && (
                  <div className="menu pl-menu" role="menu">
                    <button onClick={() => { setMenu(false); setDialog("rename"); }}><Pencil size={16} /> {t("Переименовать")}</button>
                    {pl.cloud && (
                      <button onClick={async () => {
                        setMenu(false);
                        const p2 = await lib.sharePlaylist(pl, true);
                        if (p2?.shareSlug) {
                          await navigator.clipboard?.writeText(melo.shareUrl(p2.shareSlug)).catch(() => {});
                          ui.toast("Ссылка на плейлист скопирована");
                        }
                      }}><Link2 size={16} /> {t(pl.shareSlug ? "Скопировать ссылку" : "Поделиться ссылкой")}</button>
                    )}
                    {pl.cloud && pl.shareSlug && (
                      <button onClick={async () => { setMenu(false); if (await lib.sharePlaylist(pl, false)) ui.toast("Ссылка отключена"); }}>
                        <Link2Off size={16} /> {t("Отключить ссылку")}
                      </button>
                    )}
                    <button className="danger" onClick={() => { setMenu(false); setDialog("delete"); }}><Trash2 size={16} /> {t("Удалить плейлист")}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {editable && tracks.length > 0 && <small className="faint lib-hint">{t("Чтобы убрать трек из плейлиста — нажмите «⋯» у трека или правую кнопку мыши")}</small>}
      {loading ? <Loading /> : tracks.length ? <TrackList tracks={tracks} onRemove={editable ? removeTrack : undefined} /> : <Empty title={t("В плейлисте нет треков")} />}

      {dialog === "delete" && (
        <Dialog
          title="Удалить плейлист?"
          text={t(pl.cloud ? "«{name}» удалится из аккаунта Melo." : "«{name}» удалится из ВКонтакте. Сами треки останутся в «Моей музыке».", { name: pl.title })}
          icon={<Trash2 size={22} />}
          danger
          confirm="Удалить"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await lib.deletePlaylist(pl)) {
              setDialog(null);
              ui.toast("Плейлист удалён");
              ui.back();
            }
          }}
        />
      )}
      {dialog === "rename" && (
        <Dialog
          title="Переименовать плейлист"
          icon={<Pencil size={22} />}
          input={pl.title}
          confirm="Сохранить"
          onClose={() => setDialog(null)}
          onConfirm={async (v) => { if (await lib.renamePlaylist(pl, v)) setDialog(null); }}
        />
      )}
    </div>
  );
}
