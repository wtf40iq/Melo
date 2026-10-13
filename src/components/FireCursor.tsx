import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../api";
import { createPortal } from "react-dom";
import { CursorColor, useSettings } from "../store/settings";
import { onVisualActivity, visualsActive } from "../visualActivity";
import { arrowBox, blastSurface, CursorSkin, SHOCKS, SkinRefs } from "./CursorSkin";

/** Готовые цвета: [оттенок «горячего» ядра, оттенок хвоста, насыщенность 0…1]. */
export const CURSOR_PRESETS: Record<Exclude<CursorColor, "rainbow" | "accent" | "custom">, [number, number, number]> = {
  fire: [48, 2, 1],
  ember: [14, 350, 1],
  gold: [52, 36, 0.95],
  pink: [325, 298, 1],
  violet: [282, 252, 1],
  blue: [205, 228, 1],
  cyan: [182, 198, 1],
  green: [100, 150, 0.95],
  white: [210, 220, 0.1],
};

/** Как выглядит цвет в настройках. */
export const CURSOR_SWATCHES: [CursorColor, string, string][] = [
  ["fire", "Огонь", "linear-gradient(135deg, #ffe066, #ff7a1a 55%, #e0301e)"],
  ["ember", "Алый", "linear-gradient(135deg, #ff9a6b, #f0263c)"],
  ["gold", "Золото", "linear-gradient(135deg, #fff2a8, #f2b320)"],
  ["pink", "Розовый", "linear-gradient(135deg, #ffb3e6, #ee3fae)"],
  ["violet", "Фиолетовый", "linear-gradient(135deg, #e0b3ff, #8a3dff)"],
  ["blue", "Синий", "linear-gradient(135deg, #b3e4ff, #2b74ff)"],
  ["cyan", "Бирюзовый", "linear-gradient(135deg, #b3fff7, #10b8c9)"],
  ["green", "Зелёный", "linear-gradient(135deg, #e2ffb3, #2fbf5b)"],
  ["white", "Белый", "linear-gradient(135deg, #ffffff, #aeb7c6)"],
  ["rainbow", "Радуга", "conic-gradient(#ff4d4d, #ffb84d, #f5ff4d, #4dff88, #4dd2ff, #6d4dff, #ff4dd8, #ff4d4d)"],
];

// ---------- цвета ----------
let probe: CanvasRenderingContext2D | null = null;
function cssRgb(c: string): [number, number, number] | null {
  try {
    probe ??= document.createElement("canvas").getContext("2d");
    if (!probe) return null;
    probe.fillStyle = "#000001";
    probe.fillStyle = c.trim();
    const v = String(probe.fillStyle);
    if (v.startsWith("#")) {
      const n = parseInt(v.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = v.match(/[\d.]+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
  } catch {
    return null;
  }
}
function rgbHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, Math.min(1, s), l];
}

type Pal = { h1: number; h2: number; s: number };
/** Палитра из любого цвета: насыщенный — горит своим цветом, серый — светится серебром. */
function palFromCss(c: string): Pal {
  const rgb = cssRgb(c);
  if (!rgb) return { h1: 210, h2: 225, s: 1 };
  const [h, s] = rgbHsl(rgb);
  if (s < 0.16) return { h1: h, h2: h, s: 0.08 };
  return { h1: h, h2: h - 16, s: Math.max(0.78, s) };
}
const cssVar = (n: string) =>
  document.documentElement.style.getPropertyValue(n).trim() || getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Спрайты: мягкие светлые пятна от «горячего» к «остывающему». Кешируются по цвету. */
type Sprites = { steps: HTMLCanvasElement[]; core: HTMLCanvasElement; h: number; s: number };
const spriteCache = new Map<string, Sprites>();
function sprites(p: Pal): Sprites {
  const key = `${Math.round(p.h1 / 8)}|${Math.round(p.h2 / 8)}|${Math.round(p.s * 10)}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const N = 16, PX = 48;
  let dh = p.h2 - p.h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const sat = Math.round(p.s * 100);
  const make = (h: number, l: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = PX;
    const g = c.getContext("2d")!;
    const r = PX / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, `hsla(${h}, ${sat}%, ${l}%, 1)`);
    grd.addColorStop(0.35, `hsla(${h}, ${sat}%, ${Math.max(0, l - 12)}%, .55)`);
    grd.addColorStop(1, `hsla(${h}, ${sat}%, ${Math.max(0, l - 30)}%, 0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, PX, PX);
    return c;
  };
  const steps: HTMLCanvasElement[] = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    steps.push(make((p.h1 + dh * k + 360) % 360, (p.s < 0.2 ? 97 : 92) - k * 42));
  }
  const out = { steps, core: make(p.h1, p.s < 0.2 ? 99 : 94), h: p.h1, s: p.s };
  spriteCache.set(key, out);
  if (spriteCache.size > 48) spriteCache.delete(spriteCache.keys().next().value!);
  return out;
}

// ---------- что под курсором ----------
const TEXT_SEL = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable=""], [contenteditable="true"]';
const CLICK_SEL = 'button:not(:disabled), a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], input[type="range"], input[type="checkbox"], input[type="radio"], input[type="color"], select, summary, label.swatch, .card, .tl-row, .chip, .swatch';
type Hover = "none" | "click" | "text";
function hoverOf(el: Element | null): Hover {
  if (!el || !(el instanceof Element)) return "none";
  if (el.closest(TEXT_SEL)) return "text";
  if (el.closest(CLICK_SEL)) return "click";
  return "none";
}

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; sp: Sprites };
type Wave = { x: number; y: number; t: number; sp: Sprites; seed: number; started: number; slot: number };

/** Стрелка Bloom: скруглённая, как системная, но гладкая. Кончик — в (0, 0). */

// Последняя позиция мыши — переживает пересоздание эффекта (смена цвета, размера и т. п.)
const lastPos = { x: -100, y: -100, seen: false };
/**
 * Свои курсоры и эффекты мыши: огонёк со шлейфом, гладкий Bloom со свечением
 * и ударная волна при клике. Всё рисуется на одном прозрачном холсте поверх окна.
 */
export function FireCursor() {
  const s = useSettings();
  const ref = useRef<HTMLCanvasElement>(null);
  const style = s.cursorStyle === "fire" || s.cursorStyle === "bloom" ? s.cursorStyle : "system";
  const own = style !== "system";
  const on = own || s.clickWave;
  const skinEl = useRef<HTMLDivElement>(null);
  const sk = useRef<SkinRefs>({ heat: null, heat2: null, chrome: null, chromeShine: null, shocks: [], shockMaps: [], shockMaps2: [], shockImgs: [] });
  const S = 1.45 * s.fireSize;
  const material = s.cursorMaterial;
  const blast = s.clickWave && s.waveStyle === "blast";
  const shockSize = Math.round(200 * s.waveSize);

  useEffect(() => {
    if (!on) return;
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const mode = s.fireColor;
    const custom = s.cursorCustom;
    const trail = s.fireTrail;
    const size = s.fireSize;
    const waves = s.clickWave;
    const calm = s.animations === "off";
    const root = document.documentElement.classList;
    const mat = material;
    const isBlast = blast;
    const shockD = shockSize;
    const membrane = isBlast ? blastSurface() : null;
    const box = arrowBox(S);
    let shockN = 0;
    const shockExpiry: number[] = [];
    let disposed = false;
    // Snapshot belongs to this effect only; never clear a newly mounted renderer.
    const skin = skinEl.current;
    const shockEls = [...sk.current.shocks];
    const shockMaps = [...sk.current.shockMaps];
    const shockMaps2 = [...sk.current.shockMaps2];
    const resetShock = (slot: number) => {
      clearTimeout(shockExpiry[slot]);
      const el = shockEls[slot];
      if (el) {
        el.style.display = "none";
        el.style.backdropFilter = "none";
        el.style.opacity = "0";
        el.style.width = el.style.height = "0px";
      }
      shockMaps[slot]?.setAttribute("scale", "0");
      shockMaps2[slot]?.setAttribute("scale", "0");
    };
    const clearRenderer = () => {
      ctx.resetTransform();
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (skin) skin.style.opacity = "0";
      for (let i = 0; i < SHOCKS; i++) resetShock(i);
    };

    // Текущая палитра; «Акцент» и «Радуга» меняются со временем
    let accentSeen = "";
    let pal: Sprites = sprites({ h1: 48, h2: 2, s: 1 });
    const repaint = (t: number) => {
      if (mode === "rainbow") {
        const h = (t * 45) % 360;
        pal = sprites({ h1: h, h2: h + 35, s: 1 });
      } else if (mode === "accent") {
        const c = cssVar("--accent-vivid") || cssVar("--accent") || "#5e9fe8";
        if (c !== accentSeen) { accentSeen = c; pal = sprites(palFromCss(c)); }
      } else if (mode === "custom") {
        pal = sprites(palFromCss(custom || "#ff5cc8"));
      } else {
        const [a, b, sat] = CURSOR_PRESETS[mode as keyof typeof CURSOR_PRESETS] ?? CURSOR_PRESETS.fire;
        pal = sprites({ h1: a, h2: b, s: sat });
      }
    };
    repaint(0);
    let palSeen: Sprites | null = null;
    const skinColors = () => {
      const el = skinEl.current;
      if (!el || palSeen === pal) return;
      palSeen = pal;
      const sat = Math.round(pal.s * 100), h = Math.round(pal.h);
      el.style.setProperty("--c0", `hsl(${h} ${sat}% ${pal.s < 0.2 ? 97 : 90}%)`);
      el.style.setProperty("--c1", `hsl(${h} ${sat}% ${pal.s < 0.2 ? 80 : 64}%)`);
      el.style.setProperty("--c2", `hsl(${h} ${sat}% ${pal.s < 0.2 ? 52 : 42}%)`);
      el.style.setProperty("--cg", `hsl(${h} ${sat}% ${pal.s < 0.2 ? 85 : 62}% / .9)`);
    };
    const tint = (l: number, a: number, sp = pal) => `hsla(${sp.h}, ${Math.round(sp.s * 100)}%, ${l}%, ${a})`;

    const ps: P[] = [];
    const ws: Wave[] = [];
    // Настоящая позиция мыши и сглаженные: кончик стрелки (быстро) и свечение (мягко отстаёт)
    let x = lastPos.x, y = lastPos.y, px = x, py = y, visible = lastPos.seen, down = false;
    let bx = x, by = y, hx = x, hy = y, press = 0, hoverK = 0, textK = 0, tilt = 0;
    let hover: Hover = "none", lastTarget: EventTarget | null = null;
    const hist: { x: number; y: number; t: number }[] = [];
    let raf = 0, last = performance.now(), t = 0, frameN = 0, rendered = 0, canvasDirty = true;

    const resize = () => {
      const d = Math.min(1.5, window.devicePixelRatio || 1);
      cv.width = Math.round(innerWidth * d);
      cv.height = Math.round(innerHeight * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    resize();

    const spawn = (sx: number, sy: number, n: number, speed = 1) => {
      for (let i = 0; i < n && ps.length < 600; i++) {
        const max = (0.35 + Math.random() * 0.45) * trail;
        ps.push({
          x: sx + (Math.random() - 0.5) * 3 * size,
          y: sy + (Math.random() - 0.5) * 3 * size,
          vx: (Math.random() - 0.5) * 40 * speed,
          vy: (-20 - Math.random() * 50) * speed,
          life: max, max,
          size: (7 + Math.random() * 9) * size,
          sp: pal,
        });
      }
    };

    const kick = () => { if (!disposed && !raf && visualsActive()) { last = performance.now(); rendered = 0; raf = requestAnimationFrame(loop); } };
    const move = (e: PointerEvent) => {
      if (disposed) return;
      x = e.clientX; y = e.clientY;
      lastPos.x = x; lastPos.y = y; lastPos.seen = true;
      if (!visible) { px = bx = hx = x; py = by = hy = y; visible = true; }
      if (e.target !== lastTarget) { lastTarget = e.target; hover = hoverOf(e.target as Element); }
      if (style === "fire") {
        // Частицы по всей длине пути, чтобы шлейф был сплошным и при быстром движении
        const dist = Math.hypot(x - px, y - py);
        const steps = Math.min(30, Math.ceil(dist / 6));
        for (let i = 1; i <= steps; i++) spawn(px + ((x - px) * i) / steps, py + ((y - py) * i) / steps, 1);
      }
      px = x; py = y;
      if (own) kick();
    };
    const leave = () => { visible = false; lastPos.seen = false; hist.length = 0; kick(); };
    const pressDown = (e: PointerEvent) => {
      if (disposed) return;
      down = true; x = e.clientX; y = e.clientY;
      if (style === "fire" && !isBlast) spawn(x, y, 26, 2.6);
      if (waves && e.button === 0) {
        const slot = isBlast ? shockN++ % SHOCKS : -1;
        if (slot >= 0) {
          for (let i = ws.length - 1; i >= 0; i--) if (ws[i].slot === slot) ws.splice(i, 1);
          resetShock(slot);
        }
        const started = performance.now();
        ws.push({ x, y, t: 0, sp: pal, seed: Math.random() * Math.PI * 2, started, slot });
        if (slot >= 0) {
          shockExpiry[slot] = window.setTimeout(() => {
            if (disposed) return;
            const i = ws.findIndex((w) => w.slot === slot && w.started === started);
            if (i >= 0) {
              ws.splice(i, 1);
              resetShock(slot);
              kick();
            }
          }, 820);
        }
        if (ws.length > 8) ws.shift();
      }
      kick();
    };
    const release = () => { down = false; kick(); };

    let fails = 0;
    const loop = (now: number) => {
      raf = 0;
      if (disposed || !visualsActive()) return;
      // Keep the pointer responsive at 60 fps; stationary chrome needs only 30.
      const stationaryChrome = style === "bloom" && mat === "chrome" && !ws.length
        && Math.abs(x - bx) + Math.abs(y - by) < 0.05 && Math.abs(stV) < 0.02 && !down;
      const interval = stationaryChrome ? 1000 / 30 : 1000 / 60;
      if (rendered && now - rendered < interval - 0.5) { raf = requestAnimationFrame(loop); return; }
      rendered = now;
      try {
        const more = frame(now);
        fails = 0;
        // Класс мог слететь (перерисовка корня при входе) — возвращаем, пока курсор живой
        if (own && !root.contains("fire-cursor")) root.add("fire-cursor");
        if (more) raf = requestAnimationFrame(loop);
      } catch (e) {
        console.warn("Курсор сломался", e);
        spriteCache.clear();
        try { repaint(t); } catch { /* */ }
        ps.length = 0;
        ws.length = 0;
        clearRenderer();
        if (++fails > 30) { root.remove("fire-cursor"); return; }
        raf = requestAnimationFrame(loop);
      }
    };

    // Ударная волна «взрыв»: настоящее искажение того, что под ней (фильтр за элементом) + тонкая кромка
    const drawBlast = (w: Wave): boolean => {
      const el = sk.current.shocks[w.slot];
      const dm = sk.current.shockMaps[w.slot];
      const DUR = 0.8;
      const p = w.t / DUR;
      if (p >= 1) {
        resetShock(w.slot);
        return false;
      }
      // Fast pressure impulse, followed by a slower settling front.
      const e = (1 - Math.exp(-5.2 * p)) / (1 - Math.exp(-5.2));
      const sc = 0.018 + e * 0.982;
      // Элемент растёт по-настоящему (а не через scale) — карта искажения всегда в реальных пикселях
      const D = Math.max(8, shockD * sc);
      const onset = Math.min(1, p / 0.055);
      const amp = Math.min(34, D * 0.21) * onset * Math.pow(1 - p, 0.9);
      const fade = Math.pow(1 - p, 0.8);
      if (el) {
        el.style.display = "block";
        el.style.backdropFilter = `url(#mc-sh${w.slot})`;
        el.style.width = el.style.height = `${D.toFixed(1)}px`;
        el.style.transform = `translate3d(${(w.x - D / 2).toFixed(1)}px, ${(w.y - D / 2).toFixed(1)}px, 0)`;
        el.style.opacity = String(Math.min(1, onset) * fade);
      }
      const img = sk.current.shockImgs[w.slot];
      img?.setAttribute("width", D.toFixed(1));
      img?.setAttribute("height", D.toFixed(1));
      dm?.setAttribute("scale", amp.toFixed(1));
      // Optical pressure membrane, matching the refraction map; no sparks or rays.
      if (membrane) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = onset * Math.pow(1 - p, 1.15);
        ctx.drawImage(membrane, w.x - D / 2, w.y - D / 2, D, D);
        ctx.restore();
      }
      return true;
    };

    const drawWaves = (dt: number) => {
      const R = 62 * s.waveSize;
      for (let i = ws.length - 1; i >= 0; i--) {
        const w = ws[i];
        w.t = (performance.now() - w.started) / 1000;
        if (w.slot >= 0) { if (!drawBlast(w)) ws.splice(i, 1); continue; }
        const p = w.t / 0.62;
        if (p >= 1) { ws.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - p, 3);
        const fade = Math.pow(1 - p, 1.4);
        // вспышка в центре
        if (p < 0.35) {
          const fr = 10 + e * R * 0.5;
          ctx.globalAlpha = (1 - p / 0.35) * 0.55;
          ctx.drawImage(w.sp.core, w.x - fr, w.y - fr, fr * 2, fr * 2);
        }
        ctx.globalAlpha = 1;
        // основное кольцо
        ctx.beginPath();
        ctx.arc(w.x, w.y, 8 + e * R, 0, Math.PI * 2);
        ctx.lineWidth = 0.6 + 3 * (1 - p);
        ctx.strokeStyle = tint(w.sp.s < 0.2 ? 92 : 68, fade * 0.95, w.sp);
        ctx.stroke();
        // второе кольцо чуть позже и тоньше
        const p2 = Math.max(0, (w.t - 0.08) / 0.62);
        if (p2 > 0 && p2 < 1) {
          const e2 = 1 - Math.pow(1 - p2, 3);
          ctx.beginPath();
          ctx.arc(w.x, w.y, 4 + e2 * R * 0.66, 0, Math.PI * 2);
          ctx.lineWidth = 0.5 + 1.6 * (1 - p2);
          ctx.strokeStyle = tint(w.sp.s < 0.2 ? 96 : 80, Math.pow(1 - p2, 1.6) * 0.7, w.sp);
          ctx.stroke();
        }
        // искры по кругу
        ctx.fillStyle = tint(w.sp.s < 0.2 ? 98 : 84, fade, w.sp);
        for (let k = 0; k < 8; k++) {
          const a = w.seed + (k * Math.PI) / 4;
          const d = 10 + e * R * 1.08;
          ctx.beginPath();
          ctx.arc(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, 1.7 * (1 - p) + 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawFire = (dt: number) => {
      // Даже на месте огонёк чуть «дышит» и роняет искры
      if (visible && Math.random() < 0.5) spawn(x, y, 1, 0.6);
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        p.vy -= 30 * dt; // горячий воздух поднимается
        p.vx *= 0.96;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = 1 - p.life / p.max;
        const r = p.size * (1 - k * 0.75);
        ctx.globalAlpha = Math.min(1, (1 - k) * 1.4) * 0.8;
        const st = p.sp.steps;
        ctx.drawImage(st[Math.min(st.length - 1, Math.floor(k * st.length))], p.x - r, p.y - r, r * 2, r * 2);
      }
      if (visible) {
        const f = 1 + Math.sin(t * 17) * 0.08 + Math.sin(t * 29) * 0.05;
        const r = (down ? 16 : 13) * size * f;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(pal.steps[2], x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
        ctx.globalAlpha = 1;
        ctx.drawImage(pal.core, x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
        // Белая точка — точное место клика
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(x, y, 1.8 * Math.max(1, size * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.globalCompositeOperation = "lighter";
      }
    };

    let bloomBusy = false;
    // Пружина «желе»: растяжение вдоль движения с перехлёстом после остановки
    let st = 0, stV = 0, ang = 0, svx = 0, svy = 0, lastBx = x, lastBy = y;
    const wob = mat === "jelly" ? { k: 240, d: 9, amt: 1 } : mat === "glass" ? { k: 300, d: 15, amt: 0.6 } : { k: 420, d: 34, amt: 0.25 };
    const coloredHalo = mat === "glow" || mat === "neon" || mat === "jelly";
    const drawBloom = (dt: number, now: number) => {
      bloomBusy = false;
      const el = skinEl.current;
      if (!visible) { if (el) el.style.opacity = "0"; return; }
      // Пружины: кончик почти без задержки, свечение плавно догоняет
      const kTip = 1 - Math.exp(-dt * 46);
      const kHalo = 1 - Math.exp(-dt * 13);
      const vx = (x - bx) / Math.max(dt, 0.001);
      bx += (x - bx) * kTip; by += (y - by) * kTip;
      hx += (x - hx) * kHalo; hy += (y - hy) * kHalo;
      press += ((down ? 1 : 0) - press) * (1 - Math.exp(-dt * 22));
      hoverK += ((s.cursorHover && hover === "click" ? 1 : 0) - hoverK) * (1 - Math.exp(-dt * 16));
      textK += ((hover === "text" ? 1 : 0) - textK) * (1 - Math.exp(-dt * 20));
      tilt += (Math.max(-1, Math.min(1, vx / 2200)) * 0.16 - tilt) * (1 - Math.exp(-dt * 10));

      // Скорость кончика (сглаженная) → растяжение материала
      const kv = 1 - Math.exp(-dt * 18);
      if (Math.abs(bx - lastBx) + Math.abs(by - lastBy) > 300) svx = svy = 0;
      else {
        svx += ((bx - lastBx) / dt - svx) * kv;
        svy += ((by - lastBy) / dt - svy) * kv;
      }
      lastBx = bx; lastBy = by;
      const speed = Math.hypot(svx, svy);
      if (speed > 40) {
        let da = Math.atan2(svy, svx) - ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        ang += da * (1 - Math.exp(-dt * 14));
      }
      const target = calm ? 0 : Math.min(0.34, speed / 2600) * wob.amt;
      for (let left = dt; left > 0;) {
        const step = Math.min(left, 1 / 240);
        stV += ((target - st) * wob.k - stV * wob.d) * step;
        st = Math.max(-0.25, Math.min(0.42, st + stV * step));
        left -= step;
      }

      // Шлейф: мягкая светящаяся линия по недавнему пути (у света и неона)
      if (!calm && trail > 0.05 && (mat === "glow" || mat === "neon")) {
        const lh = hist[hist.length - 1];
        if (!lh || Math.hypot(lh.x - bx, lh.y - by) > 0.4) hist.push({ x: bx, y: by, t: now });
        const keep = 90 + trail * 110;
        while (hist.length && now - hist[0].t > keep) hist.shift();
        if (hist.length > 2) {
          ctx.lineCap = "round";
          for (let i = 1; i < hist.length; i++) {
            const k = i / hist.length;
            ctx.beginPath();
            ctx.moveTo(hist[i - 1].x, hist[i - 1].y);
            ctx.lineTo(hist[i].x, hist[i].y);
            ctx.lineWidth = (1 + k * 5) * size;
            ctx.strokeStyle = tint(pal.s < 0.2 ? 90 : 66, k * k * 0.32);
            ctx.stroke();
          }
        }
      } else hist.length = 0;

      // Ореол цвета вокруг стрелки — только у «светящихся» материалов
      if (coloredHalo) {
        const dx = x - hx, dy = y - hy;
        const sp = Math.min(1, Math.hypot(dx, dy) / 60);
        const gr = (24 + hoverK * 10 + press * 6) * size;
        ctx.save();
        ctx.translate(hx + 5 * size, hy + 8 * size);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.scale(1 + sp * 0.7, 1 - sp * 0.25);
        ctx.globalAlpha = (mat === "jelly" ? 0.22 : 0.42) + hoverK * 0.15 + press * 0.2;
        ctx.drawImage(pal.steps[3], -gr, -gr, gr * 2, gr * 2);
        ctx.restore();
      }

      // Кольцо над кнопками
      if (s.cursorHover && hoverK > 0.02) {
        const white = !coloredHalo || pal.s < 0.2;
        ctx.beginPath();
        ctx.arc(bx + 4 * size, by + 6 * size, (13 + hoverK * 6 - press * 3) * size, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = white ? `rgba(255,255,255,${(hoverK * 0.55).toFixed(3)})` : tint(76, hoverK * 0.75);
        ctx.stroke();
        ctx.fillStyle = white ? `rgba(255,255,255,${(hoverK * 0.06).toFixed(3)})` : tint(70, hoverK * 0.1);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      // Над полем ввода — тонкая текстовая каретка вместо стрелки
      if (textK > 0.5) {
        const h = 18 * size;
        ctx.save();
        ctx.translate(bx, by);
        ctx.shadowColor = coloredHalo ? tint(60, 0.9) : "rgba(0,0,0,.6)";
        ctx.shadowBlur = 10 * size;
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = Math.min(1, (textK - 0.5) * 2);
        const r = (ww: number, hh: number, ox: number, oy: number) => { ctx.beginPath(); ctx.roundRect(ox, oy, ww, hh, ww / 2); ctx.fill(); };
        r(2 * size, h, -size, -h / 2);
        r(7 * size, 1.8 * size, -3.5 * size, -h / 2 - 0.9 * size);
        r(7 * size, 1.8 * size, -3.5 * size, h / 2 - 0.9 * size);
        ctx.restore();
      }
      ctx.globalCompositeOperation = "lighter";

      // Сама стрелка — DOM-элемент из материала (стекло, желе, металл…)
      if (el) {
        skinColors();
        const jel = mat === "jelly";
        const px2 = 1 + press * (jel ? 0.1 : -0.1), py2 = 1 - press * (jel ? 0.16 : 0.1);
        el.style.opacity = String(Math.max(0, Math.min(1, (0.5 - textK) * 2)));
        el.style.transform =
          `translate3d(${(bx - box.ox).toFixed(2)}px, ${(by - box.oy).toFixed(2)}px, 0) rotate(${ang.toFixed(4)}rad) scale(${(1 + st).toFixed(4)}, ${(1 - st * 0.55).toFixed(4)}) rotate(${(-ang + tilt).toFixed(4)}rad) scale(${px2.toFixed(4)}, ${py2.toFixed(4)})`;
        if (mat === "chrome") {
          const phase = calm ? 0 : t * 2.1 + bx * 0.008 + by * 0.006;
          const slide = Math.sin(phase) * 16;
          const angle = Math.sin(phase * 0.61) * 32 + tilt * 100;
          sk.current.chrome?.setAttribute("gradientTransform", `translate(${slide.toFixed(2)} 0) rotate(${angle.toFixed(2)} 7 10)`);
          sk.current.chromeShine?.setAttribute("gradientTransform", `translate(${(-slide * 0.85).toFixed(2)} ${(Math.cos(phase) * 9).toFixed(2)}) rotate(${-angle} 7 10)`);
        }
        if (mat === "distort") {
          const a = (7 + Math.min(14, speed / 120)) * size;
          sk.current.heat?.setAttribute("scale", a.toFixed(1));
          sk.current.heat2?.setAttribute("scale", (a * 1.35).toFixed(1));
        }
        el.classList.toggle("hover", hoverK > 0.5);
      }

      // Всё догнало мышь и замерло — можно не перерисовывать, пока она не сдвинется
      bloomBusy = (mat === "chrome" && !calm) || hist.length > 0 || Math.abs(x - hx) + Math.abs(y - hy) > 0.3 || Math.abs(x - bx) + Math.abs(y - by) > 0.05
        || Math.abs(press - (down ? 1 : 0)) > 0.01 || Math.abs(hoverK - (s.cursorHover && hover === "click" ? 1 : 0)) > 0.01
        || Math.abs(textK - (hover === "text" ? 1 : 0)) > 0.01 || Math.abs(tilt) > 0.002
        || Math.abs(st) > 0.002 || Math.abs(stV) > 0.02 || speed > 2;
    };

    /** Кадр; false — рисовать больше нечего, цикл засыпает до следующего движения. */
    const frame = (now: number): boolean => {
      // При запуске окно ещё может иметь нулевой размер — догоняем реальный
      const d = Math.min(1.5, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(innerWidth * d) || cv.height !== Math.round(innerHeight * d)) resize();
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now; t += dt;
      if (mode === "rainbow" || (mode === "accent" && frameN++ % 20 === 0)) repaint(t);
      ctx.globalAlpha = 1;
      // Chrome/glass use a small DOM surface; don't repaint a full-window empty canvas.
      if (canvasDirty) ctx.clearRect(0, 0, innerWidth, innerHeight);
      const canvasUsed = ws.length > 0 || ps.length > 0 || (style === "fire" && visible)
        || (style === "bloom" && visible && (coloredHalo || hist.length > 0
          || textK > 0.01 || hover === "text" || (s.cursorHover && (hoverK > 0.01 || hover === "click"))));
      ctx.globalCompositeOperation = "lighter";
      if (style === "fire") drawFire(dt);
      else if (style === "bloom") drawBloom(dt, now);
      drawWaves(dt);
      canvasDirty = canvasUsed;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      return (style === "fire" && visible) || (style === "bloom" && bloomBusy) || ps.length > 0 || ws.length > 0;
    };

    // Пока тянут полосу прокрутки, движений мыши страница не получает — берём позицию у окна
    let sbDrag = false, asking = false, sbRaf = 0;
    const ask = () => {
      if (asking || !inTauri) return;
      asking = true;
      invoke<[number, number] | null>("cursor_client").then((c) => {
        if (!disposed && c) move({ clientX: c[0], clientY: c[1], target: lastTarget } as unknown as PointerEvent);
      }).catch(() => {}).finally(() => { asking = false; });
    };
    let pollUntil = 0, lastPoll = 0;
    const poll = () => {
      if (disposed || !visualsActive() || (!sbDrag && performance.now() > pollUntil)) { sbRaf = 0; return; }
      const now = performance.now();
      if (now - lastPoll >= 33) { lastPoll = now; ask(); }
      sbRaf = requestAnimationFrame(poll);
    };
    const onScrollbar = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      return (el.scrollHeight > el.clientHeight && e.clientX > r.left + el.clientLeft + el.clientWidth)
        || (el.scrollWidth > el.clientWidth && e.clientY > r.top + el.clientTop + el.clientHeight);
    };
    const sbDown = (e: PointerEvent) => {
      if (e.button === 0 && onScrollbar(e)) { sbDrag = true; if (!sbRaf) sbRaf = requestAnimationFrame(poll); }
    };
    const sbStop = (e: PointerEvent) => { if (sbDrag && (e.type === "pointerup" || e.buttons === 0)) sbDrag = false; };
    const onScroll = () => {
      // После прокрутки под курсором другой элемент
      lastTarget = null;
      pollUntil = performance.now() + 250;
      if (!sbRaf) sbRaf = requestAnimationFrame(poll);
    };
    const mouseUp = () => { sbDrag = false; };

    // Переключение раскладки, ввод с IME и т. п. иногда возвращают системную стрелку,
    // хотя мышь не двигалась. Чуть меняем значение cursor — браузер заново ставит «пустой» курсор.
    let flip = false;
    const reCursor = () => {
      flip = !flip;
      document.documentElement.style.setProperty("--fire-cur", flip ? "url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7) 0 0, none" : "none");
    };

    const opt = { passive: true } as const;
    const cap = { passive: true, capture: true } as const;
    if (own) {
      window.addEventListener("pointerdown", sbDown, cap);
      window.addEventListener("pointermove", sbStop, cap);
      window.addEventListener("pointerup", sbStop, cap);
      window.addEventListener("mouseup", mouseUp, cap);
      document.addEventListener("scroll", onScroll, cap);
      window.addEventListener("keydown", reCursor, cap);
      window.addEventListener("keyup", reCursor, cap);
      window.addEventListener("focus", reCursor);
      document.addEventListener("compositionend", reCursor, true);
      document.addEventListener("visibilitychange", reCursor);
    }
    window.addEventListener("pointermove", move, opt);
    window.addEventListener("pointerover", move, opt);
    window.addEventListener("pointerdown", pressDown, opt);
    window.addEventListener("pointerup", release, opt);
    document.documentElement.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", resize);
    if (visible) {
      const el = document.elementFromPoint(x, y);
      if (el) { lastTarget = el; hover = hoverOf(el); }
    }
    const offActivity = onVisualActivity((active) => {
      if (active) { resize(); kick(); }
      else {
        cancelAnimationFrame(raf); cancelAnimationFrame(sbRaf); raf = sbRaf = 0;
        sbDrag = false; pollUntil = 0;
        ps.length = ws.length = hist.length = 0;
        clearRenderer();
        cv.width = cv.height = 1;
      }
    });
    kick();
    // Системную стрелку прячем, только когда свой курсор реально рисуется
    if (own) root.add("fire-cursor");
    return () => {
      disposed = true;
      offActivity();
      clearRenderer();
      ps.length = ws.length = hist.length = 0;
      root.remove("fire-cursor");
      cancelAnimationFrame(raf);
      cancelAnimationFrame(sbRaf);
      raf = 0;
      window.removeEventListener("pointerdown", sbDown, true);
      window.removeEventListener("pointermove", sbStop, true);
      window.removeEventListener("pointerup", sbStop, true);
      window.removeEventListener("mouseup", mouseUp, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", reCursor, true);
      window.removeEventListener("keyup", reCursor, true);
      window.removeEventListener("focus", reCursor);
      document.removeEventListener("compositionend", reCursor, true);
      document.removeEventListener("visibilitychange", reCursor);
      document.documentElement.style.removeProperty("--fire-cur");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", move);
      window.removeEventListener("pointerdown", pressDown);
      window.removeEventListener("pointerup", release);
      document.documentElement.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", resize);
    };
  }, [on, own, style, s.fireColor, s.cursorCustom, s.fireTrail, s.fireSize, s.clickWave, s.animations, material, blast, S, shockSize, s.waveSize, s.cursorHover]);

  // Холст — прямо в body: внутри .app (isolation) он оказывался под диалогами и меню
  return on
    ? createPortal(
        <div key={`${style}:${material}:${blast}:${s.fireColor}:${s.cursorCustom}:${s.fireSize}:${s.fireTrail}:${s.waveSize}:${s.cursorHover}:${s.animations}`} className="cursor-layer" aria-hidden>
          <canvas ref={ref} className="fire-canvas" aria-hidden />
          <CursorSkin ref={skinEl} material={material} S={S} show={style === "bloom"} blast={blast} refs={sk.current} shockSize={shockSize} />
        </div>,
        document.body,
      )
    : null;
}
