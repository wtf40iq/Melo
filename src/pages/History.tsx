import { Trash2 } from "lucide-react";
import { Empty } from "../components/Loading";
import { TrackList } from "../components/TrackList";
import { clearPlayed, usePlayed } from "../store/played";
import { useT } from "../store/settings";
import { useUi } from "../store/ui";

export function History() {
  const played = usePlayed();
  const t = useT();
  const ui = useUi();
  const tracks = played.map((x) => x.track);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("История")}</h1>
        {tracks.length > 0 && (
          <button
            className="btn secondary"
            onClick={() => { clearPlayed(); ui.toast(t("История очищена")); }}
          >
            <Trash2 size={16} /> {t("Очистить историю")}
          </button>
        )}
      </div>
      <div className="lib-sub">
        <span>{t("Треков: {n}", { n: tracks.length })}</span>
        {tracks.length > 0 && <span className="hint">{t("История хранится только на этом компьютере")}</span>}
      </div>
      {tracks.length
        ? <TrackList tracks={tracks} />
        : <Empty title={t("История пока пуста")} text={t("Включите музыку — она появится здесь")} />}
    </div>
  );
}
