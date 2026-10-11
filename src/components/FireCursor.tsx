import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../store/settings";

/** Палитры огонька: оттенок «горячего» ядра → оттенок угасающего хвоста. */
export const FIRE_COLORS = {
  fire: [48, 2],
  blue: [195, 228],
  violet: [285, 255],
  green: [95, 150],
  accent: [0, 0],
} as const;
export type FireColor = keyof typeof FIRE_COLORS;

let probe: CanvasRenderingContext2D | null = null;
function accentHue(): number {
  let c = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5e9fe8";
  // Любой формат цвета (rgb(), hsl(), имя) приводим к #rrggbb через canvas
  try {
    probe ??= document.createElement("canvas").getContext("2d");
    if (probe) { probe.fillStyle = "#5e9fe8"; probe.fillStyle = c; c = String(probe.fillStyle); }
  } catch { /* */ }
  const n = parseInt(c.replace("#", ""), 16);
  if (!Number.isFinite(n)) return 210;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 210;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Светлое пятно с мягким краем — из таких спрайтов складывается пламя. */
function makeSprites(h1: number, h2: number, steps = 24): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  for (let i = 0; i < steps; i++) {
    const k = steps > 1 ? i / (steps - 1) : 0; // 0 — горячо, 1 — остывает
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const h = (h1 + dh * k + 360) % 360;
    const l = 92 - k * 42;
    grd.addColorStop(0, `hsla(${h}, 100%, ${l}%, 1)`);
    grd.addColorStop(0.35, `hsla(${h}, 100%, ${l - 12}%, .55)`);
    grd.addColorStop(1, `hsla(${h}, 100%, ${l - 30}%, 0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    out.push(c);
  }
  return out;
}

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };

/** Курсор-огонёк: вместо системной стрелки — горящая искра со шлейфом. */
export function FireCursor() {
  const s = useSettings();
  const ref = useRef<HTMLCanvasElement>(null);
  const on = s.fireCursor;

  useEffect(() => {
    if (!on) return;
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const accentMode = s.fireColor === "accent";
    let sprites: HTMLCanvasElement[] = [];
    let core: HTMLCanvasElement;
    let accentSeen = "";
    const paint = () => {
      const [a, b] = accentMode ? (() => { const h = accentHue(); return [h, h + 25]; })() : FIRE_COLORS[s.fireColor as FireColor] ?? FIRE_COLORS.fire;
      sprites = makeSprites(a, b);
      core = makeSprites(a, a, 1)[0];
    };
    const readAccent = () => document.documentElement.style.getPropertyValue("--accent") || getComputedStyle(document.documentElement).getPropertyValue("--accent");
    accentSeen = readAccent();
    try { paint(); } catch { sprites = makeSprites(...FIRE_COLORS.fire); core = makeSprites(48, 48, 1)[0]; }
    // Акцент может меняться сам (цвет из обложки) — перекрашиваем огонёк вслед за ним
    const watch = accentMode
      ? new MutationObserver(() => {
          const c = readAccent();
          if (c !== accentSeen) { accentSeen = c; try { paint(); } catch { /* */ } }
        })
      : null;
    watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    const root = document.documentElement.classList;
    const trail = s.fireTrail;
    const size = s.fireSize;
    const ps: P[] = [];
    let x = -100, y = -100, px = x, py = y, visible = false, down = false;
    let raf = 0, last = performance.now(), t = 0;

    const resize = () => {
      const d = window.devicePixelRatio || 1;
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
        });
      }
    };

    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      if (!visible) { px = x; py = y; visible = true; }
      // Частицы по всей длине пути, чтобы шлейф был сплошным и при быстром движении
      const dist = Math.hypot(x - px, y - py);
      const steps = Math.min(30, Math.ceil(dist / 6));
      for (let i = 1; i <= steps; i++) spawn(px + ((x - px) * i) / steps, py + ((y - py) * i) / steps, 1);
      px = x; py = y;
    };
    const leave = () => { visible = false; };
    const press = (e: PointerEvent) => { down = true; x = e.clientX; y = e.clientY; spawn(x, y, 26, 2.6); };
    const release = () => { down = false; };

    let fails = 0;
    const loop = (now: number) => {
      try {
        frame(now);
        fails = 0;
        // Класс мог слететь (перерисовка корня при входе) — возвращаем, пока огонёк живой
        if (!root.contains("fire-cursor")) root.add("fire-cursor");
      } catch (e) {
        console.warn("Огонёк сломался", e);
        // Одна ошибка — не повод сдаваться: пересобираем спрайты и пробуем снова
        try { paint(); } catch { /* */ }
        ps.length = 0;
        if (++fails > 30) { root.remove("fire-cursor"); return; }
      }
      raf = requestAnimationFrame(loop);
    };
    const frame = (now: number) => {
      // При запуске окно ещё может иметь нулевой размер — догоняем реальный
      const d = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(innerWidth * d) || cv.height !== Math.round(innerHeight * d)) resize();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalCompositeOperation = "lighter";
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
        ctx.drawImage(sprites[Math.min(sprites.length - 1, Math.floor(k * sprites.length))], p.x - r, p.y - r, r * 2, r * 2);
      }
      if (visible) {
        const f = 1 + Math.sin(t * 17) * 0.08 + Math.sin(t * 29) * 0.05;
        const r = (down ? 16 : 13) * size * f;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sprites[4], x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
        ctx.globalAlpha = 1;
        ctx.drawImage(core, x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
        // Белая точка — точное место клика
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(x, y, 1.8 * Math.max(1, size * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", move, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    // Системную стрелку прячем, только когда огонёк реально рисуется
    document.documentElement.classList.add("fire-cursor");
    return () => {
      document.documentElement.classList.remove("fire-cursor");
      watch?.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      document.documentElement.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", resize);
    };
  }, [on, s.fireColor, s.fireTrail, s.fireSize]);

  // Холст — прямо в body: внутри .app (isolation) он оказывался под диалогами и меню
  return on ? createPortal(<canvas ref={ref} className="fire-canvas" aria-hidden />, document.body) : null;
}
