import { visualLoop } from "../visualActivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Shuffle, Sparkles } from "lucide-react";
import { getAnalyser } from "../store/eq";
import { api } from "../api";
import { Card } from "../components/Card";
import { MixCard } from "../components/MixCard";
import { Shelf } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { errorText, useUi } from "../store/ui";
import { useAsync } from "../useAsync";
import { useSettings } from "../store/settings";
import { hoursLeft, Mix, useMixes } from "../store/mixes";
import { setWaveMode, startWave, useWave, WAVE_MODES, waveActive, WaveMode } from "../store/wave";
import { Playlist } from "../types";

/** «Моя волна» дышит под басы: --beat от 0 до 1. */
function useBeat(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    let beat = 0, avg = 0;
    let data = new Uint8Array(0);
    const stop = visualLoop(() => {
      const an = getAnalyser();
      if (an) {
        if (data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        let low = 0;
        for (let i = 1; i < 7; i++) low += data[i];
        low /= 6 * 255;
        avg += (low - avg) * 0.05;
        const hit = Math.max(0, low - avg * 0.85) * 3.2 + low * 0.35;
        beat = hit > beat ? beat + (hit - beat) * 0.6 : beat * 0.9;
        el.style.setProperty("--beat", Math.min(1, beat).toFixed(3));
      }
    });
    el.classList.add("beat");
    return () => {
      stop();
      el.classList.remove("beat");
      el.style.removeProperty("--beat");
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

function WaveHero() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const s = useSettings();
  const t = s.t;
  const wave = useWave();
  const box = useRef<HTMLElement>(null);
  const active = waveActive(p.queue);
  const live = active && p.playing;
  useBeat(box, s.heroBeat && live && s.animations !== "off");
  const mode = WAVE_MODES.find((m) => m.id === wave.mode) ?? WAVE_MODES[0];

  const run = async (m?: WaveMode) => {
    try {
      if (!(await startWave(p, lib.tracks, m))) ui.toast("Не удалось собрать волну — попробуйте другое настроение");
    } catch (e) {
      ui.toast(errorText(e));
    }
  };
  const main = () => (active ? p.toggle() : run());
  const pickMode = (m: WaveMode) => {
    if (m === wave.mode && active) return;
    setWaveMode(m);
    if (active) run(m);
  };

  return (
    <section ref={box} className={`wave ${active ? "on" : ""} ${live ? "live" : ""}`}>
      <div className="wave-aura" aria-hidden><i /><i /><i /></div>
      <div className="wave-body">
        <span className="wave-kicker"><Sparkles size={14} /> {t("Подобрано для вас")}</span>
        <h2>{t("Моя волна")}</h2>
        <p className="wave-sub">
          {active && p.current ? (
            <>{t("Сейчас играет")}: <b>{p.current.title}</b> — {p.current.artist}</>
          ) : t(mode.hint)}
        </p>
        <div className="wave-modes" role="tablist" aria-label={t("Настроение волны")}>
          {WAVE_MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={wave.mode === m.id} className={`wave-mode ${wave.mode === m.id ? "on" : ""}`} onClick={() => pickMode(m.id)} data-tip={t(m.hint)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <div className="row-gap">
          <button className="btn primary wave-play" disabled={wave.loading} onClick={main}>
            {wave.loading ? <Loader2 size={17} className="spin" /> : live ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            {live ? t("Пауза") : active ? t("Продолжить") : t("Слушать волну")}
          </button>
          <button className="btn ghost" disabled={!lib.tracks.length} onClick={() => p.playList([...lib.tracks].sort(() => Math.random() - 0.5))}>
            <Shuffle size={17} /> {t("Моя музыка вперемешку")}
          </button>
        </div>
      </div>
      <button className="wave-orb" onClick={main} aria-label={live ? t("Пауза") : t("Слушать волну")} disabled={wave.loading}>
        <span className="orb-rings" aria-hidden><i /><i /><i /></span>
        <span className="orb-glow" aria-hidden />
        <span className="orb-core" aria-hidden />
        <span className="orb-icon">
          {wave.loading ? <Loader2 size={34} className="spin" /> : live ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" className="nudge" />}
        </span>
      </button>
    </section>
  );
}

const homeRequests = new Map<string, { until: number; promise: Promise<unknown> }>();
function homeRequest<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const hit = homeRequests.get(key);
  if (hit && hit.until > Date.now()) return hit.promise as Promise<T>;
  const promise = fetch();
  const entry = { until: Date.now() + 60_000, promise };
  homeRequests.set(key, entry);
  promise.catch(() => { if (homeRequests.get(key) === entry) homeRequests.delete(key); });
  while (homeRequests.size > 6) homeRequests.delete(homeRequests.keys().next().value!);
  return promise;
}

export function Home() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const { t, lang } = useSettings();
  const feedKey = `${lib.profile?.id}:${lang}`;
  // Cache only the landing page; infinite-wave requests remain fresh.
  const recs = useAsync(() => homeRequest(`recs:${feedKey}`, () => api.recommendations()), [feedKey]);
  const shelves = useAsync(() => homeRequest(`shelves:${feedKey}`, () => api.vkShelves().catch(() => [])), [feedKey]);
  const first = lib.profile?.name.split(" ")[0];
  // Подборки собираются, когда подгрузилась «Моя музыка» (или через пару секунд, если её нет)
  const [grace, setGrace] = useState(false);
  useEffect(() => { const id = setTimeout(() => setGrace(true), 4000); return () => clearTimeout(id); }, []);
  const libReady = lib.tracks.length > 0 ? !lib.loadingTracks || lib.tracks.length >= 200 : grace && !lib.loadingTracks;
  const mixes = useMixes(lib.profile?.id, lib.tracks, libReady);
  // Полки ВК без ваших же плейлистов (они ниже, в «Ваших плейлистах»)
  const vkShelves = useMemo(() => {
    const mine = new Set(lib.playlists.map((x) => x.id));
    const me = lib.profile?.id;
    const mineNames = new Set(lib.playlists.map((p) => `${p.title.trim().toLowerCase()}:${p.count}`));
    return (shelves.data ?? [])
      .map((sh) => {
        const items = sh.items.filter((x) => !mine.has(x.id) && x.ownerId !== me && !mineNames.has(`${x.title.trim().toLowerCase()}:${x.count}`));
        // «Собрано алгоритмами»: обложки ВК — голый градиент, подписываем их сами
        const algo = /алгоритм|algorithm|для вас|for you/i.test(sh.title) || items.filter((x) => /^(для вас|открытия|новинки|плейлист дня|микс|for you|discover)/i.test(x.title)).length >= 2;
        return { ...sh, items, algo };
      })
      .filter((sh) => sh.items.length >= 2);
  }, [shelves.data, lib.playlists, lib.profile?.id]);

  const playMix = (m: Mix) => p.playList(m.tracks);
  const playPl = async (pl: Playlist) => {
    try {
      const tracks = await api.playlistTracks(pl);
      if (!tracks.length) return ui.toast("Плейлист пуст");
      p.playList(tracks);
    } catch (e) {
      ui.toast(errorText(e));
    }
  };

  return (
    <div className="page home">
      <h1 className="page-title">{t(greeting())}{first ? `, ${first}` : ""}</h1>

      <WaveHero />

      {(mixes.loading || mixes.mixes.length > 0) && (
        <Shelf title={t("Подборки дня")} hint={t("Новые через {n} ч", { n: hoursLeft() })}>
          {mixes.mixes.length
            ? mixes.mixes.map((m, i) => (
                <MixCard key={m.id} mix={m} index={i} onOpen={() => ui.navigate({ name: "mix", id: m.id })} onPlay={() => playMix(m)} />
              ))
            : Array.from({ length: 5 }, (_, i) => <div key={i} className="card skeleton-card"><div className="sk-cover" /><div className="sk-line" /><div className="sk-line short" /></div>)}
        </Shelf>
      )}

      {vkShelves.map((sh) => (
        <Shelf key={sh.title} title={t(sh.title)}>
          {sh.items.map((pl, i) => (
            <Card key={pl.id} index={i} item={pl} label={sh.algo ? t("Для вас") : undefined} onOpen={() => ui.navigate({ name: "playlist", playlist: pl })} onPlay={() => playPl(pl)} />
          ))}
        </Shelf>
      ))}

      {lib.playlists.length > 0 && (
        <Shelf title={t("Ваши плейлисты")} action={<button className="link" onClick={() => ui.navigate({ name: "playlists" })}>{t("Все")}</button>}>
          {lib.playlists.slice(0, 20).map((pl, i) => (
            <Card key={pl.id} index={i} item={pl} onOpen={() => ui.navigate({ name: "playlist", playlist: pl })} onPlay={() => playPl(pl)} />
          ))}
        </Shelf>
      )}

      <section>
        <div className="section-head"><h3>{t("Рекомендации")}</h3></div>
        {recs.loading ? <Loading rows={5} /> : recs.data?.length ? <TrackList tracks={recs.data.slice(0, 15)} /> :
          <Empty title={t("Рекомендаций пока нет")} text={t("Слушайте больше — ВК подстроится под ваш вкус")} />}
      </section>
    </div>
  );
}
