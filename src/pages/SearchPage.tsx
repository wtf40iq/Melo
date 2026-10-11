import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import { coverage, rankTracks } from "../api/match";
import { ArtistRow } from "../components/ArtistRow";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { Tabs } from "../components/Tabs";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { searchHistory } from "../store/history";
import { useSettings } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { SearchExtras, Track } from "../types";

type TabId = "all" | "tracks" | "artists" | "playlists";

/** Разбивает «Исполнитель - Название» для точного поиска. */
const split = (q: string) => {
  const m = q.split(/\s+[-–—]\s+/);
  return m.length >= 2 ? { artist: m[0], title: m.slice(1).join(" - ") } : { artist: "", title: q };
};

export function SearchPage({ query }: { query: string }) {
  const [tab, setTab] = useState<TabId>("all");
  const [q, setQ] = useState(query.trim());
  const { t } = useSettings();
  const ui = useUi();
  const lib = useLibrary();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [extras, setExtras] = useState<SearchExtras | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 220); // ждём, пока человек допечатает
    return () => clearTimeout(id);
  }, [query]);

  // Треки и остальное грузятся отдельно: треки показываем, как только пришли
  useEffect(() => {
    let alive = true;
    setTracks(null);
    setExtras(null);
    if (!q) return;
    api.searchTracks(q).then((r) => alive && setTracks(r)).catch((e) => { if (alive) { setTracks([]); ui.toast(errorText(e)); } });
    api.searchExtras(q).then((r) => alive && setExtras(r)).catch(() => alive && setExtras({ playlists: [], artists: [] }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Запрос попадает в историю, когда человек задержался на результатах
  useEffect(() => {
    if (!q || tracks == null) return;
    const id = setTimeout(() => searchHistory.add(q), 1500);
    return () => clearTimeout(id);
  }, [q, tracks]);

  // Мгновенно: совпадения в «Моей музыке»
  const mine = useMemo(() => {
    const s = query.trim();
    if (s.length < 2) return [];
    return rankTracks(lib.tracks.filter((x) => coverage(s, `${x.artist} ${x.title}`) >= 1), { any: s }).slice(0, 5);
  }, [query, lib.tracks]);

  const list = tracks ?? [];
  const pls = extras?.playlists ?? [];
  const artists = extras?.artists ?? [];
  const loading = tracks == null;
  const deep = () => ui.navigate({ name: "deep", ...split(query.trim()) });

  return (
    <div className="page">
      <div className="search-head">
        <h1 className="page-title">{t("Поиск: «{q}»", { q: query.trim() })}</h1>
        <button className="btn secondary sm-btn" onClick={deep}><SlidersHorizontal size={15} /> {t("Точный поиск")}</button>
      </div>
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "all", label: t("Всё") },
          { id: "tracks", label: t("Треки"), count: loading ? undefined : list.length },
          { id: "artists", label: t("Исполнители"), count: extras ? artists.length : undefined },
          { id: "playlists", label: t("Плейлисты"), count: extras ? pls.length : undefined },
        ]}
      />
      {tab === "all" && mine.length > 0 && (
        <section>
          <div className="section-head"><h3>{t("В моей музыке")}</h3></div>
          <TrackList tracks={mine} />
        </section>
      )}
      {(tab === "all" || tab === "artists") && artists.length > 0 && (
        <section>
          {tab === "all" && <div className="section-head"><h3>{t("Исполнители")}</h3></div>}
          <ArtistRow items={artists} />
        </section>
      )}
      {(tab === "all" || tab === "tracks") && (loading ? <Loading /> : list.length > 0 && (
        <section>
          {tab === "all" && <div className="section-head"><h3>{t("Треки")}</h3>{list.length > 10 && <button className="link-btn" onClick={() => setTab("tracks")}>{t("Показать все")}</button>}</div>}
          <TrackList tracks={tab === "all" ? list.slice(0, 10) : list} />
        </section>
      ))}
      {(tab === "all" || tab === "playlists") && pls.length > 0 && (
        <section>
          {tab === "all" && <div className="section-head"><h3>{t("Плейлисты")}</h3></div>}
          <PlaylistGrid items={tab === "all" ? pls.slice(0, 5) : pls} />
        </section>
      )}
      {!loading && extras && !list.length && !pls.length && !artists.length && !mine.length && (
        <Empty title={t("Ничего не нашлось")} text={t("Попробуйте точный поиск: исполнитель и название отдельно")} />
      )}
      {!loading && (
        <button className="deep-banner" onClick={deep}>
          <SlidersHorizontal size={18} />
          <span><b>{t("Не нашли нужный трек?")}</b><small>{t("Точный поиск: исполнитель и название отдельно")}</small></span>
        </button>
      )}
    </div>
  );
}
