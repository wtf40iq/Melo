import { useMemo, useState } from "react";
import { Bell, BellOff, Play, Shuffle, User } from "lucide-react";
import { api } from "../api";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { ArtistRow } from "../components/ArtistRow";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { Artist } from "../types";
import { useAsync } from "../useAsync";
import { followArtist, isFollowed, unfollowArtist, useFollowed } from "../store/follow";

export function ArtistPage({ artist }: { artist: Artist }) {
  const p = usePlayer();
  const { t, tracks: tl } = useSettings();
  // Три запроса параллельно и независимо: что пришло — то сразу и показываем
  const key = artist.id ?? artist.name;
  const info = useAsync(() => api.artistInfo(artist), [key]);
  const tr = useAsync(() => api.artistTracks(artist), [key]);
  const al = useAsync(() => api.artistAlbums(artist), [key]);
  const [all, setAll] = useState(false);
  const tracks = tr.data ?? [];
  const albums = al.data ?? [];
  const a = { ...artist, ...(info.data ?? {}) };
  if (!a.photo) a.photo = albums[0]?.cover || tracks.find((x) => x.cover)?.cover;
  const loading = tr.loading;
  useFollowed();
  const following = isFollowed(a);
  const sim = useAsync(() => (tracks[0] ? api.similar(tracks[0]) : Promise.resolve([])), [tracks[0]?.id]);
  const similarArtists = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const tr of sim.data ?? []) {
      for (const ar of tr.artists ?? []) {
        const k = (ar.id ?? ar.name).toLowerCase();
        if (k === (a.id ?? a.name).toLowerCase() || seen.has(k)) continue;
        seen.add(k);
        out.push(ar);
        if (out.length >= 8) return out;
      }
    }
    return out;
  }, [sim.data, a.id, a.name]);

  return (
    <div className="page artist-page">
      <div className="artist-hero" style={a.photo ? { ["--hero" as string]: `url("${a.photo}")` } : undefined}>
        <span className="artist-ava big">{a.photo ? <img src={a.photo} alt="" /> : <User size={64} />}</span>
        <div className="pl-info">
          <small>{t("Исполнитель")}</small>
          <h1>{a.name}</h1>
          <span className="muted">
            {[!loading && tl(tracks.length), !al.loading && albums.length > 0 && t("Альбомов: {n}", { n: albums.length })].filter(Boolean).join(" · ")}
          </span>
          <div className="row-gap">
            <button className="btn primary" disabled={!tracks.length} onClick={() => p.playList(tracks)}>
              <Play size={17} fill="currentColor" /> {t("Слушать")}
            </button>
            <button className="btn secondary" disabled={!tracks.length} onClick={() => p.playList([...tracks].sort(() => Math.random() - 0.5))}>
              <Shuffle size={17} /> {t("Вперемешку")}
            </button>
            <button
              className={`btn ${following ? "secondary" : "ghost"}`}
              onClick={() => following ? unfollowArtist(a) : followArtist(a, tracks.slice(0, 10).map((x) => x.id))}
            >
              {following ? <BellOff size={16} /> : <Bell size={16} />}
              {t(following ? "Вы подписаны" : "Следить")}
            </button>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : (
        <>
          {!tracks.length && !albums.length && !al.loading && <Empty title={t("Ничего не нашлось")} text={t("ВК не отдал треки этого исполнителя")} />}
          {tracks.length > 0 && (
            <section>
              <div className="section-head">
                <h3>{t("Треки")}</h3>
                {tracks.length > 10 && <button className="link-btn" onClick={() => setAll(!all)}>{t(all ? "Свернуть" : "Показать все")}</button>}
              </div>
              <TrackList tracks={all ? tracks : tracks.slice(0, 10)} />
            </section>
          )}
          {al.loading && <Loading rows={2} />}
          {albums.length > 0 && (
            <section>
              <div className="section-head"><h3>{t("Альбомы")}</h3></div>
              <PlaylistGrid items={albums} />
            </section>
          )}
          {similarArtists.length > 0 && (
            <section>
              <div className="section-head"><h3>{t("Похожие исполнители")}</h3></div>
              <ArtistRow items={similarArtists} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
