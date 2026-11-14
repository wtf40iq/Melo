import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { useT } from "../store/settings";

const PRESETS = [
  "#ff4d4d", "#ff7a1a", "#ffb020", "#ffe066", "#b8e986", "#72bc8f", "#4fb9c9", "#5e9fe8", "#8b7cf6",
  "#c084fc", "#e36fa8", "#ff5cc8", "#ffffff", "#dfe3ea", "#aeb7c6", "#6b7280", "#3b4252", "#121212",
];

type Rgb = [number, number, number];

function rgb(hex: string): Rgb | null {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl(hex: string): [number, number, number] {
  const c = rgb(hex);
  if (!c) return [0, 0.7, 0.6];
  const [r0, g0, b0] = c;
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const p = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
  onOpen?: () => void;
  children?: ReactNode;
};

/** Свой цвет: палитра и ползунки в стиле Melo вместо системного выбора цвета. */
export function ColorPickerButton({ value, onChange, label, className, style, onOpen, children }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 292, height = 332;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = r.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 8) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !btn.current?.contains(target)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const away = () => setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        style={style}
        onClick={() => { onOpen?.(); setOpen((o) => !o); }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={label}
      >
        {children}
      </button>
      {open && createPortal(
        <div ref={pop} className="color-pop" style={pos} role="dialog" aria-label={label}>
          <div className="color-pop-head">
            <h3>{label}</h3>
            <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label={t("Готово")}><X size={15} /></button>
          </div>
          <ColorPanel value={value} onChange={onChange} />
        </div>,
        document.body,
      )}
    </>
  );
}

function ColorPanel({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const [hex, setHex] = useState(value.toUpperCase());
  const [h, s, l] = toHsl(value);

  useEffect(() => { setHex(value.toUpperCase()); }, [value]);

  const apply = (nh: number, ns: number, nl: number) => onChange(toHex(nh, ns, nl));
  const slider = "color-slider";
  const hueBg = "linear-gradient(90deg, #f33, #ff3, #3f3, #3ff, #33f, #f3f, #f33)";
  const satBg = `linear-gradient(90deg, ${toHex(h, 0, l)}, ${toHex(h, 1, l)})`;
  const lightBg = `linear-gradient(90deg, ${toHex(h, s, 0.08)}, ${toHex(h, s, 0.5)}, ${toHex(h, s, 0.92)})`;

  return (
    <div className="color-body">
      <div className="color-preview">
        <span className="color-preview-dot" style={{ background: value }} />
        <input
          className="dialog-input color-hex"
          value={hex}
          spellCheck={false}
          maxLength={7}
          aria-label={t("Цвет")}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (rgb(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setHex(value.toUpperCase())}
        />
      </div>

      <label className="color-slider-row">
        <span>{t("Оттенок")}</span>
        <input className={slider} type="range" min={0} max={360} step={1} value={Math.round(h)} style={{ background: hueBg }} onChange={(e) => apply(Number(e.target.value), s, l)} />
      </label>
      <label className="color-slider-row">
        <span>{t("Насыщенность")}</span>
        <input className={slider} type="range" min={0} max={100} step={1} value={Math.round(s * 100)} style={{ background: satBg }} onChange={(e) => apply(h, Number(e.target.value) / 100, l)} />
      </label>
      <label className="color-slider-row">
        <span>{t("Светлота")}</span>
        <input className={slider} type="range" min={8} max={92} step={1} value={Math.round(l * 100)} style={{ background: lightBg }} onChange={(e) => apply(h, s, Number(e.target.value) / 100)} />
      </label>

      <span className="color-label">{t("Палитра")}</span>
      <div className="color-presets">
        {PRESETS.map((c) => (
          <button
            key={c}
            className={`color-preset ${value.toLowerCase() === c ? "on" : ""}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
          >
            {value.toLowerCase() === c && <Check size={11} />}
          </button>
        ))}
      </div>
    </div>
  );
}
