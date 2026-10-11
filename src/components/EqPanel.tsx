import { useEffect, useRef, useState } from "react";
import { RotateCcw, Settings2, X } from "lucide-react";
import { EQ_BANDS, EQ_PRESETS } from "../store/eq";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

/** Пресеты и 10 полос — общий для настроек и всплывающей панели. */
export function EqEditor({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const t = s.t;
  const setBand = (i: number, v: number) => {
    const g = [...s.eqGains];
    g[i] = v;
    s.set({ eqGains: g, eqPreset: "custom", eqEnabled: true });
  };
  return (
    <div className={`eq-panel ${s.eqEnabled ? "" : "off"} ${compact ? "compact" : ""}`}>
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
      {!compact && (
        <button className="btn secondary sm-btn" onClick={() => s.set({ eqPreset: "Обычный", eqGains: EQ_PRESETS["Обычный"] })}>
          <RotateCcw size={15} /> {t("Сбросить")}
        </button>
      )}
    </div>
  );
}

/** Панель эквалайзера, выезжающая над кнопкой в плеере. */
export function EqPopover({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement> }) {
  const s = useSettings();
  const ui = useUi();
  const t = s.t;
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);

  // Плавное закрытие: сначала анимация, потом убираем из DOM
  useEffect(() => {
    if (open) { setShown(true); setLeaving(false); return; }
    if (!shown) return;
    setLeaving(true);
    const id = setTimeout(() => { setShown(false); setLeaving(false); }, 200);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const el = e.target as Node;
      if (box.current?.contains(el) || anchor.current?.contains(el)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [open, onClose]);

  if (!shown) return null;
  return (
    <div ref={box} className={`eq-pop ${leaving ? "leaving" : ""}`} role="dialog" aria-label={t("Эквалайзер")}>
      <div className="eq-pop-head">
        <h3>{t("Эквалайзер")}</h3>
        <Switch checked={s.eqEnabled} onChange={(v) => s.set({ eqEnabled: v })} label={t("Включить эквалайзер")} />
        <span className="grow" />
        <button className="icon-btn sm" onClick={() => s.set({ eqPreset: "Обычный", eqGains: EQ_PRESETS["Обычный"] })} aria-label={t("Сбросить")} data-tip={t("Сбросить")}>
          <RotateCcw size={15} />
        </button>
        <button className="icon-btn sm" onClick={() => { onClose(); ui.navigate({ name: "settings" }); }} aria-label={t("Настройки")} data-tip={t("Настройки")}>
          <Settings2 size={15} />
        </button>
        <button className="icon-btn sm" onClick={onClose} aria-label={t("Закрыть")}>
          <X size={16} />
        </button>
      </div>
      <EqEditor compact />
      <div className="eq-pop-foot">
        <span>{t("Выравнивать громкость")}</span>
        <Switch checked={s.normalize} onChange={(v) => s.set({ normalize: v })} label={t("Выравнивать громкость")} />
      </div>
    </div>
  );
}
