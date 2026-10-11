import { useEffect, useRef, useState } from "react";
import { Mic, Music2, Search, X } from "lucide-react";
import { api } from "../api";
import { TrackList } from "../components/TrackList";
import { Empty, Loading } from "../components/Loading";
import { useSettings } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { Track } from "../types";

/** Точный поиск: исполнитель и название вводятся отдельно. */
export function DeepSearch({ artist: a0 = "", title: t0 = "" }: { artist?: string; title?: string }) {
  const { t } = useSettings();
  const ui = useUi();
  const [artist, setArtist] = useState(a0);
  const [title, setTitle] = useState(t0);
  const [res, setRes] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const a = artist.trim(), ti = title.trim();
    if (!a && !ti) { setRes(null); setLoading(false); return; }
    setLoading(true);
    const my = ++seq.current;
    const id = setTimeout(() => {
      api.deepSearch(a, ti)
        .then((r) => my === seq.current && setRes(r))
        .catch((e) => my === seq.current && ui.toast(errorText(e)))
        .finally(() => my === seq.current && setLoading(false));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist, title]);

  const field = (icon: React.ReactNode, value: string, set: (v: string) => void, ph: string, auto?: boolean) => (
    <label className="deep-field">
      {icon}
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={t(ph)} spellCheck={false} autoFocus={auto} />
      {value && <button className="search-clear" onClick={() => set("")} aria-label={t("Очистить")}><X size={14} /></button>}
    </label>
  );

  return (
    <div className="page">
      <h1 className="page-title">{t("Точный поиск")}</h1>
      <p className="muted deep-hint">{t("Введите исполнителя и название отдельно — Melo найдёт именно этот трек, даже если обычный поиск путается")}</p>
      <div className="deep-form">
        {field(<Mic size={16} />, artist, setArtist, "Исполнитель", !a0)}
        {field(<Music2 size={16} />, title, setTitle, "Название трека", !!a0)}
      </div>
      {loading && !res ? <Loading /> : res == null ? (
        <Empty title={t("Заполните хотя бы одно поле")} text={t("Можно искать только по исполнителю — покажем все его треки")} />
      ) : !res.length ? (
        <Empty title={t("Ничего не нашлось")} text={t("Проверьте написание или оставьте одно поле")} />
      ) : (
        <section className={loading ? "dim-load" : ""}>
          <div className="section-head"><h3><Search size={16} /> {t("Найдено: {n}", { n: res.length })}</h3></div>
          <TrackList tracks={res} />
        </section>
      )}
    </div>
  );
}
