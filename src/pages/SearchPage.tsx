import { useEffect, useState } from "react";
import { api } from "../api";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { Tabs } from "../components/Tabs";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useAsync } from "../useAsync";
import { useT } from "../store/settings";

type TabId = "all" | "tracks" | "playlists";

export function SearchPage({ query }: { query: string }) {
  const [tab, setTab] = useState<TabId>("all");
  const [q, setQ] = useState(query.trim());
  const t = useT();

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 350); // ждём, пока человек допечатает
    return () => clearTimeout(id);
  }, [query]);

  const res = useAsync(() => api.search(q), [q]);
  const tracks = res.data?.tracks ?? [];
  const pls = res.data?.playlists ?? [];

  return (
    <div className="page">
      <h1 className="page-title">{t("Поиск: «{q}»", { q: query.trim() })}</h1>
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "all", label: t("Всё") },
          { id: "tracks", label: t("Треки"), count: res.loading ? undefined : tracks.length },
          { id: "playlists", label: t("Плейлисты"), count: res.loading ? undefined : pls.length },
        ]}
      />
      {res.loading ? <Loading /> : (
        <>
          {!tracks.length && !pls.length && <Empty title={t("Ничего не нашлось")} text={t("Попробуйте другое название или исполнителя")} />}
          {tab !== "playlists" && tracks.length > 0 && (
            <section>
              {tab === "all" && <div className="section-head"><h3>{t("Треки")}</h3></div>}
              <TrackList tracks={tab === "all" ? tracks.slice(0, 10) : tracks} />
            </section>
          )}
          {tab !== "tracks" && pls.length > 0 && (
            <section>
              {tab === "all" && <div className="section-head"><h3>{t("Плейлисты")}</h3></div>}
              <PlaylistGrid items={tab === "all" ? pls.slice(0, 5) : pls} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
