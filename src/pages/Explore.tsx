import { useState } from "react";
import { Play } from "lucide-react";
import { api } from "../api";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { usePlayer } from "../store/player";
import { useAsync } from "../useAsync";
import { useT } from "../store/settings";

// Жанры ВК для audio.getPopular
const genres = [
  { id: 0, label: "Всё" },
  { id: 3, label: "Рэп" },
  { id: 2, label: "Поп" },
  { id: 1, label: "Рок" },
  { id: 5, label: "Электроника" },
  { id: 21, label: "Альтернатива" },
  { id: 4, label: "Спокойное" },
  { id: 17, label: "Инди" },
];

export function Explore() {
  const [genre, setGenre] = useState(0);
  const p = usePlayer();
  const t = useT();
  const pop = useAsync(() => api.popular(genre), [genre]);
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("Обзор")}</h1>
        <button className="btn primary" disabled={!pop.data?.length} onClick={() => pop.data && p.playList(pop.data)}>
          <Play size={17} fill="currentColor" /> {t("Слушать всё")}
        </button>
      </div>
      <div className="chips">
        {genres.map((g) => (
          <button key={g.id} className={`chip ${genre === g.id ? "active" : ""}`} onClick={() => setGenre(g.id)}>{t(g.label)}</button>
        ))}
      </div>
      <section>
        <div className="section-head"><h3>{t("Популярное сейчас")}</h3></div>
        {pop.loading ? <Loading /> : pop.data?.length ? <TrackList tracks={pop.data} /> : <Empty title={t("Не удалось загрузить")} text={t("Попробуйте другой жанр")} />}
      </section>
    </div>
  );
}
