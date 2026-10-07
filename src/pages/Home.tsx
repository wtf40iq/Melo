import { useEffect, useRef } from "react";
import { Play, Shuffle } from "lucide-react";
import { getAnalyser } from "../store/eq";
import { api } from "../api";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { useAsync } from "../useAsync";
import { useSettings, useT } from "../store/settings";

/** Свечение и столбики «Моей волны» двигаются под музыку. */
function useHeroBeat(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const bars = Array.from(el.querySelectorAll<HTMLElement>(".hero-art span"));
    let raf = 0;
    let beat = 0, avg = 0;
    const lv = bars.map(() => 0);
    let data = new Uint8Array(0);
    const loop = () => {
      const an = getAnalyser();
      if (an) {
        if (data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        // басы: первые ~150 Гц
        let low = 0;
        for (let i = 1; i < 7; i++) low += data[i];
        low /= 6 * 255;
        avg += (low - avg) * 0.05;
        const hit = Math.max(0, low - avg * 0.85) * 3.2 + low * 0.35;
        beat = hit > beat ? beat + (hit - beat) * 0.6 : beat * 0.9;
        el.style.setProperty("--beat", Math.min(1, beat).toFixed(3));
        bars.forEach((b, i) => {
          const idx = Math.floor(Math.pow((i + 1) / (bars.length + 1), 1.6) * data.length * 0.6);
          const v = data[idx] / 255;
          lv[i] += (v - lv[i]) * 0.35;
          b.style.transform = `scaleY(${(0.18 + lv[i] * 0.9).toFixed(3)})`;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    el.classList.add("beat");
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.classList.remove("beat");
      el.style.removeProperty("--beat");
      bars.forEach((b) => (b.style.transform = ""));
    };
  }, [ref, on]);
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
};

export function Home() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const t = useT();
  const s = useSettings();
  const shell = useRef<HTMLDivElement>(null);
  useHeroBeat(shell, s.heroBeat && p.playing && s.animations !== "off");
  const recs = useAsync(() => api.recommendations(), []);
  const first = lib.profile?.name.split(" ")[0];

  const playWave = () => {
    if (recs.data?.length) p.playList([...recs.data].sort(() => Math.random() - 0.5));
  };

  return (
    <div className="page">
      <h1 className="page-title">{t(greeting())}{first ? `, ${first}` : ""}</h1>

      <div className="hero-shell" ref={shell}>
      <div className="hero-glow" aria-hidden />
      <section className="hero">
        <div className="hero-blobs" aria-hidden><i /><i /><i /></div>
        <div className="hero-text">
          <small>{t("Подобрано для вас")}</small>
          <h2>{t("Моя волна")}</h2>
          <p>{t("Рекомендации ВКонтакте по вашему вкусу. Каждый раз в новом порядке.")}</p>
          <div className="row-gap">
            <button className="btn primary" disabled={!recs.data?.length} onClick={playWave}>
              <Play size={17} fill="currentColor" /> {t("Слушать")}
            </button>
            <button className="btn ghost" disabled={!lib.tracks.length} onClick={() => p.playList([...lib.tracks].sort(() => Math.random() - 0.5))}>
              <Shuffle size={17} /> {t("Моя музыка вперемешку")}
            </button>
          </div>
        </div>
        <div className={`hero-art ${p.playing ? "live" : ""}`} aria-hidden><span /><span /><span /><span /><span /><span /><span /></div>
      </section>
      </div>

      {lib.playlists.length > 0 && (
        <section>
          <div className="section-head">
            <h3>{t("Ваши плейлисты")}</h3>
            <button className="link" onClick={() => ui.navigate({ name: "playlists" })}>{t("Все")}</button>
          </div>
          <PlaylistGrid items={lib.playlists.slice(0, 5)} />
        </section>
      )}

      <section>
        <div className="section-head"><h3>{t("Рекомендации")}</h3></div>
        {recs.loading ? <Loading rows={5} /> : recs.data?.length ? <TrackList tracks={recs.data.slice(0, 15)} /> :
          <Empty title={t("Рекомендаций пока нет")} text={t("Слушайте больше — ВК подстроится под ваш вкус")} />}
      </section>
    </div>
  );
}
