import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Sparkles, LogOut, RotateCcw, UserPlus, X } from "lucide-react";
import { api } from "../api";
import { AppInfo } from "../api/types";
import { useUi } from "../store/ui";
import { Lang } from "../i18n";
import { EQ_BANDS, EQ_PRESETS } from "../store/eq";
import { useLibrary } from "../store/library";
import { ACCENTS, useSettings } from "../store/settings";
import { useUpdate } from "../store/update";

const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  const t = useSettings().t;
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

function Range({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range" className="slider set-slider" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }}
    />
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const t = useSettings().t;
  return (
    <div className="set-row">
      <span className="set-text">
        {t(title)}
        {hint && <small>{t(hint)}</small>}
      </span>
      {children}
    </div>
  );
}

export function Settings() {
  const s = useSettings();
  const lib = useLibrary();
  const ui = useUi();
  const upd = useUpdate();
  const t = s.t;
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
    lib.reloadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    ui.toast("Скопировано");
  };

  const setBand = (i: number, v: number) => {
    const g = [...s.eqGains];
    g[i] = v;
    s.set({ eqGains: g, eqPreset: "custom", eqEnabled: true });
  };

  return (
    <div className="page settings">
      <h1 className="page-title">{t("Настройки")}</h1>

      <section className="set-card">
        <h3>{t("Воспроизведение")}</h3>
        <Row title="Выравнивать громкость" hint="Тихие и громкие треки звучат одинаково">
          <Toggle checked={s.normalize} onChange={(v) => s.set({ normalize: v })} label={t("Выравнивать громкость")} />
        </Row>
        <Row title="Плавная пауза" hint="Звук мягко затухает и нарастает при паузе и старте">
          <Toggle checked={s.fade} onChange={(v) => s.set({ fade: v })} label={t("Плавная пауза")} />
        </Row>
        <Row title="Пропускать недоступные треки" hint="Если ВК не отдаёт трек, сразу включается следующий">
          <Toggle checked={s.skipUnavailable} onChange={(v) => s.set({ skipUnavailable: v })} label={t("Пропускать недоступные треки")} />
        </Row>
        <Row title="Продолжать с того же места" hint="После перезапуска очередь и позиция трека сохраняются">
          <Toggle checked={s.resume} onChange={(v) => s.set({ resume: v })} label={t("Продолжать с того же места")} />
        </Row>
        <Row title="Скорость воспроизведения">
          <div className="segmented">
            {[0.75, 1, 1.25, 1.5].map((v) => (
              <button key={v} className={s.speed === v ? "active" : ""} onClick={() => s.set({ speed: v })}>
                {v}×
              </button>
            ))}
          </div>
        </Row>
      </section>

      <section className="set-card">
        <h3>{t("Эквалайзер")}</h3>
        <div className="set-row">
          <span>{t("Включить эквалайзер")}</span>
          <Toggle checked={s.eqEnabled} onChange={(v) => s.set({ eqEnabled: v })} label={t("Включить эквалайзер")} />
        </div>
        <div className={`eq-panel ${s.eqEnabled ? "" : "off"}`}>
          <div className="chips">
            {Object.keys(EQ_PRESETS).map((name) => (
              <button
                key={name}
                className={`chip ${s.eqPreset === name ? "active" : ""}`}
                onClick={() => s.set({ eqPreset: name, eqGains: EQ_PRESETS[name], eqEnabled: true })}
              >
                {t(name)}
              </button>
            ))}
            {s.eqPreset === "custom" && <span className="chip active static">{t("Своя настройка")}</span>}
          </div>
          <div className="eq-bands">
            {EQ_BANDS.map((f, i) => (
              <div key={f} className="eq-band">
                <span className="eq-val">{s.eqGains[i] > 0 ? "+" : ""}{s.eqGains[i]}</span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={s.eqGains[i]}
                  aria-label={`${freqLabel(f)} Hz`}
                  onChange={(e) => setBand(i, Number(e.target.value))}
                  onDoubleClick={() => setBand(i, 0)}
                  style={{ ["--pct" as string]: `${((s.eqGains[i] + 12) / 24) * 100}%` }}
                />
                <span className="eq-freq">{freqLabel(f)}</span>
              </div>
            ))}
          </div>
          <button className="btn secondary sm-btn" onClick={() => s.set({ eqPreset: "Обычный", eqGains: EQ_PRESETS["Обычный"] })}>
            <RotateCcw size={15} /> {t("Сбросить")}
          </button>
        </div>
      </section>

      <section className="set-card">
        <h3>{t("Внешний вид")}</h3>
        <div className="set-row">
          <span>{t("Цвет акцента")}</span>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => s.set({ accent: c })} aria-label={c}>
                {s.accent.toLowerCase() === c.toLowerCase() && <Check size={15} />}
              </button>
            ))}
            <label className="swatch custom" title={t("Свой цвет")} style={{ background: ACCENTS.includes(s.accent) ? undefined : s.accent }}>
              <input type="color" value={s.accent} onChange={(e) => s.set({ accent: e.target.value })} aria-label={t("Свой цвет")} />
            </label>
          </div>
        </div>
        <div className="set-row">
          <span>{t("Язык")}</span>
          <div className="segmented">
            {(["ru", "en"] as Lang[]).map((l) => (
              <button key={l} className={s.lang === l ? "active" : ""} onClick={() => s.set({ lang: l })}>
                {l === "ru" ? "Русский" : "English"}
              </button>
            ))}
          </div>
        </div>
        <Row title="Анимации">
          <div className="segmented">
            {([["full", "Все"], ["reduced", "Меньше"], ["off", "Выкл."]] as const).map(([v, label]) => (
              <button key={v} className={s.animations === v ? "active" : ""} onClick={() => s.set({ animations: v })}>
                {t(label)}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Плавная прокрутка" hint="Колесико мыши крутит страницы мягко и гладко">
          <Toggle checked={s.smoothScroll} onChange={(v) => s.set({ smoothScroll: v })} label={t("Плавная прокрутка")} />
        </Row>
        <Row title="Компактный список треков" hint="Больше треков помещается на экране">
          <Toggle checked={s.compact} onChange={(v) => s.set({ compact: v })} label={t("Компактный список треков")} />
        </Row>
        <Row title="Обложка в боковой панели" hint="Большая обложка текущего трека слева">
          <Toggle checked={s.sideCover} onChange={(v) => s.set({ sideCover: v })} label={t("Обложка в боковой панели")} />
        </Row>
      </section>

      <section className="set-card">
        <h3>{t("Эффекты и кастомизация")}</h3>
        <Row title="Прозрачное окно (стекло)" hint={s.glass === "acrylic" ? "Акрил — матовое стекло. На некоторых ПК окно может тормозить при перетаскивании" : "Слюда — оттенок обоев (Windows 11), Акрил — матовое стекло"}>
          <Seg value={s.glass} onChange={(v) => s.set({ glass: v })} options={[["off", "Выкл."], ["mica", "Слюда"], ["tabbed", "Слюда+"], ["acrylic", "Акрил"]]} />
        </Row>
        {s.glass !== "off" && (
          <Row title="Плотность стекла">
            <input
              type="range" className="slider set-slider" min={0.15} max={0.9} step={0.05} value={s.glassOpacity}
              onChange={(e) => s.set({ glassOpacity: Number(e.target.value) })}
              style={{ ["--pct" as string]: `${((s.glassOpacity - 0.15) / 0.75) * 100}%` }}
            />
          </Row>
        )}
        <Row title="Живой фон" hint="Эффект за панелями приложения">
          <Seg value={s.bgEffect} onChange={(v) => s.set({ bgEffect: v })} options={[["none", "Нет"], ["aurora", "Аврора"], ["cover", "Обложка"], ["stars", "Звёзды"], ["grain", "Плёнка"]]} />
        </Row>
        <Row title="Свечение за курсором" hint="Мягкий свет акцентного цвета следует за мышью">
          <Toggle checked={s.cursorGlow} onChange={(v) => s.set({ cursorGlow: v })} label={t("Свечение за курсором")} />
        </Row>
        {s.cursorGlow && (
          <div className="set-sub">
            <Row title="Радиус"><Range value={s.glowSize} min={100} max={500} step={10} onChange={(v) => s.set({ glowSize: v })} /></Row>
            <Row title="Мягкость"><Range value={s.glowSoft} min={0.2} max={1} step={0.02} onChange={(v) => s.set({ glowSoft: v })} /></Row>
            <Row title="Яркость"><Range value={s.glowPower} min={0.05} max={0.8} step={0.01} onChange={(v) => s.set({ glowPower: v })} /></Row>
          </div>
        )}
        <Row title="«Моя волна» в такт музыке" hint="Свечение вокруг «Моей волны» пульсирует под басы">
          <Toggle checked={s.heroBeat} onChange={(v) => s.set({ heroBeat: v })} label={t("«Моя волна» в такт музыке")} />
        </Row>
        <Row title="Цвет из обложки" hint="Акцентный цвет подстраивается под обложку играющего трека">
          <Toggle checked={s.dynamicAccent} onChange={(v) => s.set({ dynamicAccent: v })} label={t("Цвет из обложки")} />
        </Row>
        <Row title="Визуализатор" hint="Спектр музыки тонкой полосой над плеером">
          <Toggle checked={s.visualizer} onChange={(v) => s.set({ visualizer: v })} label={t("Визуализатор")} />
        </Row>
        <Row title="Обложка-пластинка" hint="Обложка в плеере круглая и крутится, пока играет музыка">
          <Toggle checked={s.vinyl} onChange={(v) => s.set({ vinyl: v })} label={t("Обложка-пластинка")} />
        </Row>
        <Row title="3D-наклон карточек" hint="Плейлисты наклоняются и бликуют за курсором">
          <Toggle checked={s.tilt} onChange={(v) => s.set({ tilt: v })} label={t("3D-наклон карточек")} />
        </Row>
        <Row title="Скругление углов">
          <Seg value={s.radius} onChange={(v) => s.set({ radius: v })} options={[["sharp", "Острые"], ["normal", "Обычные"], ["round", "Круглые"]]} />
        </Row>
        <Row title="Масштаб интерфейса">
          <Seg value={String(s.scale)} onChange={(v) => s.set({ scale: Number(v) })} options={[["0.9", "90%"], ["1", "100%"], ["1.1", "110%"], ["1.25", "125%"]]} />
        </Row>
      </section>

      <section className="set-card">
        <h3>{t("Окно")}</h3>
        <Row title="Сворачивать в трей при закрытии" hint="Музыка продолжит играть, Melo останется у часов. Выйти — через значок в трее">
          <Toggle checked={s.closeToTray} onChange={(v) => s.set({ closeToTray: v })} label={t("Сворачивать в трей при закрытии")} />
        </Row>
      </section>

      <section className="set-card">
        <h3>{t("Аккаунты ВКонтакте")}</h3>
        <div className="acc-list">
          {lib.accounts.map((a) => (
            <div key={a.user_id} className={`acc-item ${a.active ? "active" : ""}`}>
              {a.photo ? <img className="avatar" src={a.photo} alt="" /> : <span className="avatar">{(a.name || "?")[0]}</span>}
              <span className="set-text">
                {a.name || `id${a.user_id}`}
                <small>{a.active ? t("Сейчас используется") : `id${a.user_id}`}</small>
              </span>
              {!a.active && (
                <button className="btn secondary sm-btn" onClick={() => lib.switchAccount(a.user_id)}>{t("Переключиться")}</button>
              )}
              {a.active ? (
                <button className="btn secondary sm-btn" onClick={lib.logout}><LogOut size={15} /> {t("Выйти")}</button>
              ) : (
                <button className="icon-btn sm" onClick={() => lib.removeAccount(a.user_id)} aria-label={t("Убрать аккаунт")} title={t("Убрать аккаунт")}>
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="btn secondary sm-btn self-start" onClick={lib.addAccount}><UserPlus size={15} /> {t("Добавить аккаунт")}</button>
      </section>

      <section className="set-card">
        <h3>{t("Горячие клавиши")}</h3>
        <div className="keys">
          {([
            ["Space", "Играть / пауза"],
            ["Ctrl + →", "Следующий трек"],
            ["Ctrl + ←", "Предыдущий трек"],
            ["→ / ←", "Перемотка на 5 секунд"],
            ["↑ / ↓", "Громкость"],
            ["Ctrl + F", "Поиск"],
            ["Alt + ← / →", "Назад / вперёд"],
          ] as const).map(([k, label]) => (
            <div key={k} className="key-row"><span>{t(label)}</span><kbd>{k}</kbd></div>
          ))}
        </div>
        <small className="faint">{t("Медиаклавиши клавиатуры и плашка Windows тоже работают")}</small>
      </section>

      <section className="set-card">
        <h3>{t("О приложении")}</h3>
        <div className="info-grid">
          <span>{t("Версия")}</span><b>{info?.version ?? "—"}</b>
          <span>{t("Вход через")}</span><b>{info?.client === "vk_android" ? "VK Android (QR)" : info?.client === "kate" ? "Kate Mobile" : info?.client ?? "—"}</b>
          <span>{t("Версия API ВК")}</span><b>{info?.api_version ?? "—"}</b>
          <span>{t("Сервер воспроизведения")}</span><b>{info?.stream || "—"}</b>
          <span>{t("Папка данных")}</span>
          <b className="path">
            <span title={info?.data_dir}>{info?.data_dir ?? "—"}</span>
            {info?.data_dir && (
              <button className="icon-btn sm" onClick={() => copy(info.data_dir)} aria-label={t("Скопировать")}><Copy size={14} /></button>
            )}
          </b>
        </div>
        <Row title="Проверять обновления" hint="Melo сам узнаёт о новой версии на GitHub и предлагает обновиться">
          <Toggle checked={s.autoUpdate} onChange={(v) => s.set({ autoUpdate: v })} label={t("Проверять обновления")} />
        </Row>
        <div className="row-gap upd-row">
          <button className="btn secondary sm-btn" disabled={upd.status === "checking" || upd.status === "downloading"} onClick={() => upd.check(true)}>
            <RefreshCw size={15} className={upd.status === "checking" ? "spin" : ""} /> {t("Проверить обновления")}
          </button>
          <small className="faint">
            {upd.status === "latest" && t("У вас последняя версия")}
            {upd.status === "available" && upd.info && t("Доступна версия {v}", { v: upd.info.version })}
            {upd.status === "error" && upd.error}
          </small>
        </div>
        <small className="faint">
          {t("Ключи входа хранятся только на этом компьютере, в папке данных. Melo не собирает статистику и не отправляет ничего, кроме запросов к ВКонтакте.")}
        </small>
        <button className="btn secondary sm-btn self-start" onClick={() => window.dispatchEvent(new Event("melo:welcome"))}>
          <Sparkles size={15} /> {t("Показать приветствие")}
        </button>
        <button className="btn secondary sm-btn self-start" onClick={() => { s.reset(); ui.toast("Настройки сброшены"); }}>
          <RotateCcw size={15} /> {t("Сбросить все настройки")}
        </button>
      </section>
    </div>
  );
}
