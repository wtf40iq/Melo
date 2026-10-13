import { Play, Shuffle } from "lucide-react";
import { MixCover, useMixTitle } from "../components/MixCard";
import { TrackList } from "../components/TrackList";
import { Empty } from "../components/Loading";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { hoursLeft, mixById } from "../store/mixes";

export function MixPage({ id }: { id: string }) {
  const p = usePlayer();
  const { t, tracks: tl } = useSettings();
  const title = useMixTitle();
  const mix = mixById(id);
  if (!mix) return <div className="page"><Empty title={t("Подборка обновилась")} text={t("Загляните на главную — там уже новые подборки дня")} /></div>;
  const total = mix.tracks.reduce((s, x) => s + x.duration, 0);
  return (
    <div className="page">
      <div className="pl-header">
        <div className="mix-head-cover"><MixCover mix={mix} big /></div>
        <div className="pl-info">
          <small>{t("Подборка дня")}</small>
          <h1>{title(mix)}</h1>
          <span className="muted">{[t(mix.subtitle), tl(mix.tracks.length), t("{n} мин", { n: Math.round(total / 60) }), t("Новые через {n} ч", { n: hoursLeft() })].join(" · ")}</span>
          <div className="row-gap">
            <button className="btn primary" onClick={() => p.playList(mix.tracks)}><Play size={17} fill="currentColor" /> {t("Слушать")}</button>
            <button className="btn secondary" onClick={() => p.playList([...mix.tracks].sort(() => Math.random() - 0.5))}><Shuffle size={17} /> {t("Вперемешку")}</button>
          </div>
        </div>
      </div>
      <TrackList tracks={mix.tracks} />
    </div>
  );
}
