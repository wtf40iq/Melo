import { Play, Shuffle } from "lucide-react";
import { api } from "../api";
import { Cover } from "../components/Cover";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { usePlayer } from "../store/player";
import { Playlist } from "../types";
import { useAsync } from "../useAsync";
import { useSettings } from "../store/settings";

export function PlaylistPage({ playlist }: { playlist: Playlist }) {
  const p = usePlayer();
  const { t, tracks: tl } = useSettings();
  const { data, loading } = useAsync(() => api.playlistTracks(playlist), [playlist.id]);
  const tracks = data ?? [];
  const total = tracks.reduce((s, t) => s + t.duration, 0);

  return (
    <div className="page">
      <div className="pl-header">
        <Cover seed={playlist.title} src={playlist.cover} size={176} radius={12} />
        <div className="pl-info">
          <small>{t("Плейлист")}</small>
          <h1>{playlist.title}</h1>
          <span className="muted">
            {[playlist.subtitle, !loading && tl(tracks.length), !loading && t("{n} мин", { n: Math.round(total / 60) })]
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
          </div>
        </div>
      </div>
      {loading ? <Loading /> : tracks.length ? <TrackList tracks={tracks} /> : <Empty title={t("В плейлисте нет треков")} />}
    </div>
  );
}
