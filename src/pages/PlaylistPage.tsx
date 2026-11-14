import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, MoreHorizontal, Pencil, Play, Search, Shuffle, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../api";
import { api } from "../api";
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
  const [filter, setFilter] = useState("");
  useEffect(() => setTracks(data ?? []), [data]);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"delete" | "rename" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Название могло поменяться после переименования
  const pl = lib.playlists.find((x) => x.id === playlist.id) ?? playlist;
  const editable = !!pl.editable;
  const total = tracks.reduce((s, x) => s + x.duration, 0);
  const shownTracks = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? tracks.filter((x) => `${x.artist} ${x.title}`.toLowerCase().includes(f)) : tracks;
  }, [tracks, filter]);

  // Если ВК отдал не все страницы, лучше сказать об этом, чем молча показать часть.
  useEffect(() => {
    if (!loading && data && pl.count > 0 && data.length < pl.count) {
      ui.toast(t("Загрузилась только часть плейлиста — проверьте соединение"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data, pl.count]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const id = setTimeout(() => window.addEventListener("mousedown", close));
    return () => { clearTimeout(id); window.removeEventListener("mousedown", close); };
  }, [menu]);

  const exportM3u = async () => {
    if (!inTauri) return;
    const NL = String.fromCharCode(10);
    const lines = ["#EXTM3U", ...tracks.map((tr) => `#EXTINF:${tr.duration},${tr.artist} - ${tr.title}${NL}https://vk.com/audio${tr.ownerId}_${tr.audioId}`)];
    try {
      if (await invoke<boolean>("save_text_file", { defaultName: `${pl.title}.m3u`, content: lines.join(NL) })) ui.toast(t("Экспортировано"));
    } catch (e) {
      ui.toast(errorText(e));
    }
  };

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
                    <button onClick={() => { setMenu(false); void exportM3u(); }}><FileDown size={16} /> {t("Экспорт M3U")}</button>
                    <button className="danger" onClick={() => { setMenu(false); setDialog("delete"); }}><Trash2 size={16} /> {t("Удалить плейлист")}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {tracks.length > 4 && (
        <label className="filter pl-filter">
          <Search size={15} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Найти в плейлисте")} />
          {filter && <button className="search-clear" onClick={() => setFilter("")} aria-label={t("Очистить")}><X size={13} /></button>}
        </label>
      )}
      {editable && tracks.length > 0 && !filter && <small className="faint lib-hint">{t("Чтобы убрать трек из плейлиста — нажмите «⋯» у трека или правую кнопку мыши")}</small>}
      {loading ? <Loading /> : shownTracks.length ? <TrackList tracks={shownTracks} onRemove={editable && !filter ? removeTrack : undefined} /> : <Empty title={t(filter ? "Ничего не нашлось" : "В плейлисте нет треков")} />}

      {dialog === "delete" && (
        <Dialog
          title="Удалить плейлист?"
          text={t("«{name}» удалится из ВКонтакте. Сами треки останутся в «Моей музыке».", { name: pl.title })}
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
