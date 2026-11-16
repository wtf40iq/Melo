import { createContext, ReactNode, useContext, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Lang, translate, tracksLabel } from "../i18n";
import { EQ_PRESETS } from "./eq";

/** Из чего сделана стрелка Bloom. */
export type CursorMaterial = "glow" | "neon" | "glass" | "distort" | "jelly" | "chrome";
export type WaveStyle = "ring" | "blast";
export type CursorColor = "fire" | "ember" | "gold" | "pink" | "violet" | "blue" | "cyan" | "green" | "white" | "rainbow" | "accent" | "custom";

export const ACCENTS = ["#5E9FE8", "#8B7CF6", "#E36FA8", "#E97366", "#DE9255", "#E2B84B", "#72BC8F", "#4FB9C9"];

type Settings = {
  lang: Lang;
  theme: "dark" | "oled";
  accent: string;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  /** Пользовательские пресеты эквалайзера */
  eqSaved: { name: string; gains: number[] }[];
  normalize: boolean;
  /** Пропускать треки, которые нельзя послушать */
  skipUnavailable: boolean;
  /** Продолжать с того же места после перезапуска */
  resume: boolean;
  /** Плавная пауза и старт */
  fade: boolean;
  /** Короткое затухание при смене трека */
  smoothTracks: boolean;
  speed: number;
  /** Предел громкости: сколько даёт ползунок громкости на 100%, 0.05–1 */
  volumeMax: number;
  closeToTray: boolean;
  /** Вид мини-плеера */
  miniStyle: "full" | "compact";
  animations: "full" | "reduced" | "off";
  compact: boolean;
  sideCover: boolean;
  /** Свечение, которое следует за курсором */
  cursorGlow: boolean;
  /** Радиус свечения, px */
  glowSize: number;
  /** Мягкость края, 0.2–1 */
  glowSoft: number;
  /** Яркость, 0.05–0.8 */
  glowPower: number;
  /** Курсор вместо системного: огонёк со шлейфом или гладкий Bloom */
  cursorStyle: "system" | "fire" | "bloom";
  /** Цвет курсора (огонёк, Bloom и волна при клике) */
  fireColor: CursorColor;
  /** Свой цвет курсора из палитры */
  cursorCustom: string;
  /** Ударная волна от курсора при клике */
  clickWave: boolean;
  cursorMaterial: CursorMaterial;
  waveStyle: WaveStyle;
  /** Максимальный размер волны, независимо от курсора. */
  waveSize: number;
  cursorHover: boolean;
  /** Длина шлейфа, 0.4–2 */
  fireTrail: number;
  /** Размер огонька, 0.6–1.8 */
  fireSize: number;
  /** Свечение «Моей волны» пульсирует в такт */
  heroBeat: boolean;
  /** Живой фон за интерфейсом */
  bgEffect: "none" | "aurora" | "cover" | "stars" | "grain";
  /** Отдельный фон для OLED: старые эффекты в OLED отключены. */
  oledBg: "none" | "space";
  /** Прозрачность окна: системное стекло Windows под интерфейсом */
  glass: "off" | "acrylic" | "mica" | "tabbed";
  /** Насколько плотные панели в режиме стекла, 0.2–0.9 */
  glassOpacity: number;
  /** Акцентный цвет берётся из обложки текущего трека */
  dynamicAccent: boolean;
  /** Спектр музыки над плеером */
  visualizer: boolean;
  /** Обложка в плеере крутится как пластинка */
  vinyl: boolean;
  /** Карточки наклоняются за курсором */
  tilt: boolean;
  radius: "sharp" | "normal" | "round";
  scale: number;
  /** Проверять обновления на GitHub */
  autoUpdate: boolean;
  /** Показывать трек в Discord */
  discordRpc: boolean;
  /** Глобальные горячие клавиши */
  globalHotkeys: boolean;
  hotkeyPlay: string;
  hotkeyNext: string;
  hotkeyPrev: string;
  hotkeyLike: string;
  /** Плавная прокрутка колесиком */
  smoothScroll: boolean;
  /** Версия формата — для переноса старых настроек */
  v: number;
};

const defaults: Settings = {
  lang: navigator.language?.startsWith("ru") ? "ru" : "en",
  theme: "dark",
  accent: ACCENTS[0],
  eqEnabled: false,
  eqPreset: "Обычный",
  eqGains: EQ_PRESETS["Обычный"],
  eqSaved: [],
  normalize: false,
  skipUnavailable: true,
  resume: true,
  fade: true,
  smoothTracks: true,
  speed: 1,
  volumeMax: 1,
  closeToTray: false,
  miniStyle: "full",
  animations: "full",
  compact: false,
  sideCover: false,
  cursorGlow: true,
  glowSize: 260,
  glowSoft: 0.62,
  glowPower: 0.35,
  cursorStyle: "system",
  fireColor: "fire",
  cursorCustom: "#ff5cc8",
  clickWave: false,
  cursorMaterial: "glass",
  waveStyle: "ring",
  waveSize: 1,
  cursorHover: true,
  fireTrail: 1,
  fireSize: 1,
  heroBeat: true,
  bgEffect: "stars",
  oledBg: "space",
  glass: "off",
  glassOpacity: 0.55,
  dynamicAccent: false,
  visualizer: false,
  vinyl: false,
  tilt: false,
  radius: "normal",
  scale: 1,
  smoothScroll: true,
  autoUpdate: true,
  discordRpc: false,
  globalHotkeys: false,
  hotkeyPlay: "CommandOrControl+Alt+Space",
  hotkeyNext: "CommandOrControl+Alt+ArrowRight",
  hotkeyPrev: "CommandOrControl+Alt+ArrowLeft",
  hotkeyLike: "CommandOrControl+Alt+L",
  v: 4,
};

export const DEFAULT_SETTINGS = defaults;

type Ctx = Settings & {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tracks: (n: number) => string;
};

const C = createContext<Ctx | null>(null);

const load = (): Settings => {
  try {
    const saved = JSON.parse(localStorage.getItem("melo.settings") || "{}");
    // v1 → v2: большая обложка слева теперь по умолчанию выключена
    if ((saved.v ?? 1) < 2) saved.sideCover = false;
    // v2 → v3: «Размытие» убрано (ломало перетаскивание окна), свечение курсора — переключатель
    if (saved.glass === "blur") saved.glass = "mica";
    if (typeof saved.cursorGlow === "string") saved.cursorGlow = saved.cursorGlow !== "off";
    // v3 → v4: переключатель огонька стал выбором курсора
    if (typeof saved.fireCursor === "boolean") {
      saved.cursorStyle = saved.fireCursor ? "fire" : "system";
      delete saved.fireCursor;
    }
    saved.waveSize = Math.max(0.2, Math.min(3, Number(saved.waveSize) || 1));
    if (saved.oledBg !== "none" && saved.oledBg !== "space") delete saved.oledBg;
    if (saved.theme !== "oled") saved.theme = "dark";
    if (saved.miniStyle !== "compact") saved.miniStyle = "full";
    return { ...defaults, ...saved, v: 4 };
  } catch {
    return defaults;
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(load);
  const latest = useRef(s);
  latest.current = s;
  const write = (value: Settings) => {
    // Переполнение хранилища не должно ронять приложение
    try { localStorage.setItem("melo.settings", JSON.stringify(value)); } catch { /* ignore */ }
  };

  useEffect(() => {
    // Ползунки меняют состояние десятки раз в секунду — пишем не на каждое движение,
    // а когда пользователь остановился.
    const id = setTimeout(() => write(latest.current), 150);
    return () => clearTimeout(id);
  }, [s]);
  useEffect(() => () => write(latest.current), []);
  useEffect(() => {
    // Сам акцентный цвет ставит компонент Effects (он умеет брать цвет из обложки)
    document.documentElement.lang = s.lang;
  }, [s.accent, s.lang]);
  useEffect(() => {
    const cl = document.documentElement.classList;
    cl.toggle("anim-reduced", s.animations === "reduced");
    cl.toggle("anim-off", s.animations === "off");
    cl.toggle("compact", s.compact);
  }, [s.animations, s.compact]);

  const t = useCallback<Ctx["t"]>((key, params) => translate(s.lang, key, params), [s.lang]);
  const tracks = useCallback((n: number) => tracksLabel(s.lang, n), [s.lang]);
  const set = useCallback((patch: Partial<Settings>) => setS((prev) =>
    Object.entries(patch).every(([k, v]) => Object.is(prev[k as keyof Settings], v)) ? prev : { ...prev, ...patch }), []);
  const value = useMemo<Ctx>(() => ({
    ...s,
    set,
    reset: () => setS({ ...defaults, lang: s.lang }),
    t, tracks,
  }), [s, set, t, tracks]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useSettings = () => {
  const v = useContext(C);
  if (!v) throw new Error("useSettings вне SettingsProvider");
  return v;
};

/** Короткий доступ к переводу. */
export const useT = () => useSettings().t;
