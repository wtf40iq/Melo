import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import { coverage, rankTracks, switchLayout } from "../api/match";
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
  // Запрос в другой раскладке, если по исходному почти ничего нет («ghbdtn» → «привет»)
  const [fixed, setFixed] = useState<string | null>(null);
  const [asTyped, setAsTyped] = useState(false);
  const [sort, setSort] = useState<"relevance" | "artist" | "title" | "duration">("relevance");
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 220); // ждём, пока человек допечатает
    return () => clearTimeout(id);
  }, [query]);

  // Треки и остальное грузятся отдельно: треки показываем, как только пришли
  useEffect(() => {
    let alive = true;
    setTracks(null);
    setExtras(null);
    setFixed(null);
    if (!q) return;
    if (q.length < 2) {
      // Одна буква — это не поиск: не дёргаем ВК десятками запросов.
      setTracks([]);
      setExtras({ playlists: [], artists: [] });
      return;
    }
    const alt = asTyped ? null : switchLayout(q);
    const extras = (x: string) => api.searchExtras(x).then((r) => alive && setExtras(r)).catch(() => alive && setExtras({ playlists: [], artists: [] }));
    let extrasFor = q;
    // Сначала показываем первую быструю страницу, полную выдачу догружаем следом.
    api.searchTracksFast(q).then((r) => { if (alive && r.length) setTracks(r); }).catch(() => {});
    const fullTimer = window.setTimeout(() => {
    api.searchTracks(q)
      .then(async (r) => {
        if (!alive) return;
        if (alt && r.length < 5) {
          const r2 = await api.searchTracks(alt).catch(() => [] as Track[]);
          // Берём другую раскладку, только если по ней реально нашлось то, что набрано (а не мусор ВК)
          const hits = (list: Track[], x: string) => list.filter((tr) => coverage(x, `${tr.artist} ${tr.title}`) >= 1).length;
          const h2 = hits(r2, alt), h1 = hits(r, q);
          if (alive && h2 >= 3 && h2 > h1 * 2 + 1) {
            setFixed(alt);
            setTracks(r2);
            if (extrasFor !== alt) { extrasFor = alt; setExtras(null); extras(alt); }
            return;
          }
        }
        if (alive) setTracks(r);
      })
      .catch((e) => { if (alive) { setTracks((prev) => prev ?? []); ui.toast(errorText(e)); } });
    }, 250);
    extras(q);
    return () => { alive = false; clearTimeout(fullTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, asTyped]);
  useEffect(() => setAsTyped(false), [query]);

  // Запрос попадает в историю, когда человек задержался на результатах
  useEffect(() => {
    if (!q || q.length < 2 || tracks == null) return;
    const id = setTimeout(() => searchHistory.add(q), 1500);
    return () => clearTimeout(id);
  }, [q, tracks]);

  // Мгновенно: совпадения в «Моей музыке»
  const mine = useMemo(() => {
    const s = query.trim();
    if (s.length < 2) return [];
    return rankTracks(lib.tracks.filter((x) => coverage(s, `${x.artist} ${x.title}`) >= 1), { any: s }).slice(0, 5);
  }, [query, lib.tracks]);

  const list = useMemo(() => {
    let out = onlyAvailable ? (tracks ?? []).filter((x) => !!x.url) : (tracks ?? []).slice();
    if (sort === "artist") out.sort((a, b) => a.artist.localeCompare(b.artist, "ru", { sensitivity: "base" }));
    if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title, "ru", { sensitivity: "base" }));
    if (sort === "duration") out.sort((a, b) => a.duration - b.duration);
    return out;
  }, [tracks, sort, onlyAvailable]);
  const pls = extras?.playlists ?? [];
  const artists = extras?.artists ?? [];
  const loading = tracks == null;
  const short = q.length > 0 && q.length < 2;
  const deep = () => ui.navigate({ name: "deep", ...split(query.trim()) });

  if (short) {
    return (
      <div className="page">
        <div className="search-head">
          <h1 className="page-title">{t("Поиск: «{q}»", { q: query.trim() })}</h1>
          <button className="btn secondary sm-btn" onClick={deep}><SlidersHorizontal size={15} /> {t("Точный поиск")}</button>
        </div>
        <Empty title={t("Введите хотя бы 2 символа")} text={t("Так ВК не получит лишние десятки запросов")} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="search-head">
        <h1 className="page-title">{t("Поиск: «{q}»", { q: query.trim() })}</h1>
        <button className="btn secondary sm-btn" onClick={deep}><SlidersHorizontal size={15} /> {t("Точный поиск")}</button>
      </div>
      {fixed && (
        <p className="search-fix">
          {t("Показаны результаты по запросу «{q}».", { q: fixed })}{" "}
          <button className="link-inline" onClick={() => setAsTyped(true)}>{t("Искать «{q}»", { q: query.trim() })}</button>
        </p>
      )}
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
      {tab === "playlists" && pls.length > 0 && (
        <section>
          <PlaylistGrid items={pls} />
        </section>
      )}
      {(tab === "all" || tab === "tracks") && !loading && (
        <div className="search-filters chips">
          {([
            ["relevance", "По релевантности"],
            ["artist", "Артист"],
            ["title", "Название"],
            ["duration", "Длительность"],
          ] as const).map(([id, label]) => (
            <button key={id} className={`chip ${sort === id ? "active" : ""}`} onClick={() => setSort(id)}>{t(label)}</button>
          ))}
          <button className={`chip ${onlyAvailable ? "active" : ""}`} onClick={() => setOnlyAvailable((v) => !v)}>{t("Только доступные")}</button>
        </div>
      )}
      {(tab === "all" || tab === "tracks") && (loading ? <Loading /> : list.length > 0 && (
        <section>
          {tab === "all" && <div className="section-head"><h3>{t("Треки")}</h3></div>}
          <TrackList tracks={list} />
        </section>
      ))}
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
