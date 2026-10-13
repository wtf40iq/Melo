import { Play } from "lucide-react";
import { Mix } from "../store/mixes";
import { useSettings } from "../store/settings";

/** Название подборки на языке приложения (жанр в названии тоже переводится). */
export const useMixTitle = () => {
  const { t } = useSettings();
  return (m: Mix) => t(m.title, m.params && Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, t(v)])));
};

/** Обложка подборки: цвет подборки и коллаж из обложек её треков. */
export function MixCover({ mix, big }: { mix: Mix; big?: boolean }) {
  const { t } = useSettings();
  const title = useMixTitle();
  const covers = [...new Set(mix.tracks.map((x) => x.cover).filter(Boolean))].slice(0, 4) as string[];
  return (
    <div className={`mix-cover ${big ? "big" : ""}`} style={{ ["--h" as string]: mix.hue }}>
      <div className={`mix-collage n${covers.length}`} aria-hidden>
        {covers.map((c) => <img key={c} src={c} alt="" loading="lazy" draggable={false} />)}
      </div>
      <div className="mix-shade" aria-hidden />
      <div className="mix-label">
        <small>{t("Подборка дня")}</small>
        <b>{title(mix)}</b>
      </div>
    </div>
  );
}

export function MixCard({ mix, index, onOpen, onPlay }: { mix: Mix; index: number; onOpen: () => void; onPlay: () => void }) {
  const { t, tracks } = useSettings();
  const title = useMixTitle();
  return (
    <div className="card mix-card" style={{ ["--i" as string]: Math.min(index, 24) }} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="card-cover">
        <MixCover mix={mix} />
        <button className="card-play" onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label={`${t("Играть")}: ${title(mix)}`}>
          <Play size={20} fill="currentColor" className="nudge" />
        </button>
      </div>
      <b>{title(mix)}</b>
      <small>{t(mix.subtitle)} · {tracks(mix.tracks.length)}</small>
    </div>
  );
}
