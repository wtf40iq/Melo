import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Search, Shuffle } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useT } from "../store/settings";

export function Library() {
  const tab = "tracks";
  const [filter, setFilter] = useState("");
  const lib = useLibrary();
  const p = usePlayer();
  const t = useT();
  const sentinel = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? lib.tracks.filter((t) => `${t.artist} ${t.title}`.toLowerCase().includes(f)) : lib.tracks;
  }, [lib.tracks, filter]);

  // Подгружаем следующие треки при прокрутке вниз
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && lib.loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [lib.loadMore]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("Моя музыка")}</h1>
        {tab === "tracks" && (
          <div className="row-gap">
            <label className="filter">
              <Search size={15} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Найти в моей музыке")} />
            </label>
            <button className="btn primary" disabled={!shown.length} onClick={() => p.playList(shown)}>
              <Play size={17} fill="currentColor" /> {t("Слушать")}
            </button>
            <button
              className="btn secondary"
              disabled={!shown.length}
              onClick={() => p.playList([...shown].sort(() => Math.random() - 0.5))}
            >
              <Shuffle size={17} /> {t("Вперемешку")}
            </button>
          </div>
        )}
      </div>

      <div className="lib-sub">
        <span>{t("Треков: {n}", { n: lib.total })}</span>
        {!filter && lib.tracks.length > 1 && <span className="hint">{t("Перетаскивайте треки мышкой, чтобы поменять порядок")}</span>}
      </div>

      {tab === "tracks" &&
        (lib.tracks.length === 0 && lib.loadingTracks ? <Loading /> :
          shown.length ? <TrackList tracks={shown} onMove={filter.trim() ? undefined : lib.moveTrack} /> :
            <Empty title={t(filter ? "Ничего не нашлось" : "Здесь пока пусто")} text={filter ? undefined : t("Нажимайте ♡ у треков, и они появятся здесь")} />)}
      {tab === "tracks" && <div ref={sentinel} />}
      {tab === "tracks" && lib.loadingTracks && lib.tracks.length > 0 && <Loading rows={3} />}

    </div>
  );
}
