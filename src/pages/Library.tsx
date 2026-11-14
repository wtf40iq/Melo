import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Play, Search, Shuffle } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useT } from "../store/settings";

type SortKey = "default" | "artist" | "title" | "duration";

export function Library() {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>(() => (localStorage.getItem("melo.libSort") as SortKey) || "default");
  const [desc, setDesc] = useState(() => localStorage.getItem("melo.libSortDesc") === "1");
  const [hideUnavailable, setHideUnavailable] = useState(() => localStorage.getItem("melo.libAvailable") === "1");
  useEffect(() => localStorage.setItem("melo.libSort", sort), [sort]);
  useEffect(() => localStorage.setItem("melo.libSortDesc", desc ? "1" : "0"), [desc]);
  useEffect(() => localStorage.setItem("melo.libAvailable", hideUnavailable ? "1" : "0"), [hideUnavailable]);
  const lib = useLibrary();
  const p = usePlayer();
  const t = useT();
  const sentinel = useRef<HTMLDivElement>(null);
  // loadMore меняется на каждом рендере провайдера; держим актуальную ссылку,
  // чтобы не пересоздавать IntersectionObserver без необходимости.
  const loadMoreRef = useRef(lib.loadMore);
  loadMoreRef.current = lib.loadMore;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = hideUnavailable ? lib.tracks.filter((t) => !!t.url) : lib.tracks.slice();
    if (f) list = list.filter((t) => `${t.artist} ${t.title}`.toLowerCase().includes(f));
    if (sort !== "default") {
      const cmp = (a: typeof list[number], b: typeof list[number]) => {
        if (sort === "duration") return a.duration - b.duration;
        if (sort === "artist") return a.artist.localeCompare(b.artist, "ru", { sensitivity: "base" });
        return a.title.localeCompare(b.title, "ru", { sensitivity: "base" });
      };
      list.sort(cmp);
      if (desc) list.reverse();
    }
    return list;
  }, [lib.tracks, filter, sort, desc, hideUnavailable]);

  // Подгружаем следующие треки при прокрутке вниз
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMoreRef.current(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Поиск по «Моей музыке» должен видеть все треки, а не только загруженные
  // страницы. Пока фильтр активен, неспешно догружаем остаток библиотеки.
  const needAll = filter.trim().length >= 2 || sort !== "default" || hideUnavailable;
  const autoLoadAt = useRef(-1);
  useEffect(() => {
    if (!needAll) { autoLoadAt.current = -1; return; }
    if (lib.loadingTracks || lib.tracks.length >= lib.total) return;
    // Одна неудачная страница не должна превращаться в бесконечный ретрай каждые 350 мс.
    if (autoLoadAt.current === lib.tracks.length) return;
    autoLoadAt.current = lib.tracks.length;
    const id = window.setTimeout(() => loadMoreRef.current(), 350);
    return () => clearTimeout(id);
  }, [needAll, lib.tracks.length, lib.total, lib.loadingTracks]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("Моя музыка")}</h1>
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
      </div>

      <div className="lib-sub">
        <span>{t("Треков: {n}", { n: lib.total })}</span>
        {!filter && lib.tracks.length > 1 && <span className="hint">{t("Перетаскивайте треки мышкой, чтобы поменять порядок")}</span>}
        {needAll && lib.tracks.length < lib.total && <span className="hint">{t("Ищем по всей музыке…")}</span>}
      </div>

      <div className="lib-filters">
        <span className="chips">
          {([
            ["default", "По умолчанию"],
            ["artist", "Артист"],
            ["title", "Название"],
            ["duration", "Длительность"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={`chip ${sort === id ? "active" : ""}`}
              onClick={() => {
                if (sort === id && id !== "default") setDesc((d) => !d);
                else { setSort(id); setDesc(false); }
              }}
            >
              {t(label)}
              {sort === id && id !== "default" && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
            </button>
          ))}
          <button className={`chip ${hideUnavailable ? "active" : ""}`} onClick={() => setHideUnavailable((v) => !v)}>
            {t("Только доступные")}
          </button>
        </span>
      </div>

      {lib.tracks.length === 0 && lib.loadingTracks ? <Loading /> :
        shown.length ? <TrackList tracks={shown} onMove={filter.trim() ? undefined : lib.moveTrack} /> :
          <Empty title={t(filter ? "Ничего не нашлось" : "Здесь пока пусто")} text={filter ? undefined : t("Нажимайте ♡ у треков, и они появятся здесь")} />}
      <div ref={sentinel} />
      {lib.loadingTracks && lib.tracks.length > 0 && <Loading rows={3} />}
    </div>
  );
}
