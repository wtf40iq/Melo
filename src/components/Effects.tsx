import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { Stars } from "./Stars";
import { FireCursor } from "./FireCursor";
import { onVisualActivity, visualsActive } from "../visualActivity";

const inTauri = "__TAURI_INTERNALS__" in window;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });

const hsl2hex = (h: number, s: number, l: number) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const hexToHsl = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min;
  if (!c) return [0, 0, l];
  const s = c / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [(h * 60 + 360) % 360, s, l];
};

const MONO = "#dfe3ea";

/** Главный «живой» цвет обложки: самый весомый оттенок, яркий и насыщенный для акцента. */
const colorCache = new Map<string, Promise<string | null>>();
function dominantColor(src: string): Promise<string | null> {
  const hit = colorCache.get(src);
  if (hit) return hit;
  const result = extractColor(src);
  colorCache.set(src, result);
  if (colorCache.size > 24) colorCache.delete(colorCache.keys().next().value!);
  result.then((value) => { if (!value && colorCache.get(src) === result) colorCache.delete(src); });
  return result;
}
async function extractColor(src: string): Promise<string | null> {
  const tries = inTauri && src.startsWith("http") ? [api.streamUrl(src), src] : [src];
  for (const url of tries) {
    try {
      const img = await loadImage(url);
      const N = 40;
      const c = document.createElement("canvas");
      c.width = c.height = N;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      // гистограмма по оттенку: 24 корзины, вес = насыщенность × яркость
      const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0, l: 0, x: 0, y: 0 }));
      let total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
        const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
        const l = (max + min) / 2;
        const ch = max - min;
        if (ch < 0.06 || l < 0.08 || l > 0.97) continue;
        const sat = ch / (1 - Math.abs(2 * l - 1));
        let h = max === r ? ((gg - b) / ch) % 6 : max === gg ? (b - r) / ch + 2 : (r - gg) / ch + 4;
        h = (h * 60 + 360) % 360;
        const w = sat * sat * Math.min(1, l * 2.5);
        const bin = bins[Math.floor(h / 15) % 24];
        bin.w += w; bin.s += sat * w; bin.l += l * w;
        bin.x += Math.cos((h * Math.PI) / 180) * w; bin.y += Math.sin((h * Math.PI) / 180) * w;
        total += w;
      }
      // чёрно-белая обложка: доля цветных пикселей мала — берём нейтральный светлый «серебряный»
      let colorful = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
        if (max - min > 40 && max > 50) colorful++;
      }
      if (colorful < N * N * 0.06 || total < N * N * 0.01) return MONO;
      // соседние корзины суммируем, чтобы не дробить один цвет
      let best = 0, bestW = -1;
      for (let i = 0; i < 24; i++) {
        const w = bins[i].w + 0.5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
        if (w > bestW) { bestW = w; best = i; }
      }
      const pick = [bins[(best + 23) % 24], bins[best], bins[(best + 1) % 24]];
      const W = pick.reduce((a, p) => a + p.w, 0) || 1;
      const hx = pick.reduce((a, p) => a + p.x, 0), hy = pick.reduce((a, p) => a + p.y, 0);
      const hue = ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360;
      const sat = pick.reduce((a, p) => a + p.s, 0) / W;
      const light = pick.reduce((a, p) => a + p.l, 0) / W;
      // акцент на тёмном фоне: насыщенный и достаточно светлый
      return hsl2hex(hue, Math.max(0.55, Math.min(0.9, sat)), Math.max(0.52, Math.min(0.68, light)));
    } catch {
      /* пробуем следующий адрес */
    }
  }
  return null;
}

// Фоновые эффекты, свечение за курсором, наклон карточек, стекло и цвет из обложки.
export function Effects() {
  const s = useSettings();
  const p = usePlayer();
  const glow = useRef<HTMLDivElement>(null);
  const [coverColor, setCoverColor] = useState<string | null>(null);
  const cover = p.current?.cover;

  // Классы и переменные на <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("glass", s.glass !== "off");
    root.classList.toggle("fx-bg", s.bgEffect !== "none" || s.glass !== "off");
    root.classList.toggle("vinyl", s.vinyl);
    root.dataset.radius = s.radius;
    root.style.setProperty("--glass-a", String(s.glassOpacity));
  }, [s.glass, s.bgEffect, s.vinyl, s.radius, s.glassOpacity]);

  // Масштаб интерфейса — встроенным зумом окна, чтобы координаты мыши не ломались
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      if (!alive) return;
      await getCurrentWebview().setZoom(s.scale);
      if (alive) window.dispatchEvent(new Event("melo:zoom"));
    }).catch(() => {});
    return () => { alive = false; };
  }, [s.scale]);

  // Системное стекло Windows
  useEffect(() => {
    if (!inTauri) return;
    invoke("set_window_effect", { kind: s.glass === "off" ? "none" : s.glass }).catch(() => {});
  }, [s.glass]);

  // Цвет из обложки — для акцента и фона «Обложка»
  useEffect(() => {
    let alive = true;
    if (!cover || (!s.dynamicAccent && s.bgEffect !== "cover")) return setCoverColor(null);
    dominantColor(cover).then((c) => alive && setCoverColor(c));
    return () => { alive = false; };
  }, [cover, s.dynamicAccent, s.bgEffect]);

  useEffect(() => {
    const root = document.documentElement.style;
    const c = s.dynamicAccent && coverColor ? coverColor : s.accent;
    const n = parseInt(c.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    root.setProperty("--accent", c);
    // два соседних оттенка для градиентов — в той же гамме, без «чужих» цветов
    const [h, sat, l] = hexToHsl(c);
    const mono = sat < 0.15;
    document.documentElement.classList.toggle("accent-mono", mono);
    root.setProperty("--accent-2", mono ? "#8a93a6" : hsl2hex((h + 32) % 360, sat, Math.min(0.7, l)));
    root.setProperty("--accent-3", mono ? "#3b4252" : hsl2hex((h + 328) % 360, sat, Math.max(0.4, l - 0.08)));
    root.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
    root.setProperty("--on-accent", 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b1a2b" : "#ffffff");
    // меню в трее берёт тот же цвет
    try { localStorage.setItem("melo.live", JSON.stringify({ accent: c, onAccent: 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b1a2b" : "#ffffff" })); } catch { /* */ }
  }, [coverColor, s.dynamicAccent, s.accent]);

  // Свечение за курсором
  useEffect(() => {
    if (!s.cursorGlow) return;
    let raf = 0;
    let x = -999, y = -999, cx = x, cy = y, last = 0;
    const loop = (now: number) => {
      raf = 0;
      if (!visualsActive()) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const k = 1 - Math.exp(-12 * dt);
      cx += (x - cx) * k; cy += (y - cy) * k;
      const moving = Math.abs(x - cx) + Math.abs(y - cy) > 0.15;
      if (!moving) { cx = x; cy = y; }
      glow.current?.style.setProperty("transform", `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`);
      if (moving) raf = requestAnimationFrame(loop);
    };
    const move = (e: MouseEvent) => {
      x = e.clientX; y = e.clientY;
      if (cx < -900) { cx = x; cy = y; }
      if (!raf && visualsActive()) { last = 0; raf = requestAnimationFrame(loop); }
    };
    const off = onVisualActivity((active) => {
      if (!active) { cancelAnimationFrame(raf); raf = 0; }
      else if (x > -900 && !raf) { last = 0; raf = requestAnimationFrame(loop); }
    });
    window.addEventListener("mousemove", move, { passive: true });
    return () => { off(); window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, [s.cursorGlow]);

  // Плавная прокрутка колесиком
  useEffect(() => {
    if (!s.smoothScroll || s.animations === "off") return;
    type St = { pos: number; seen: number; target: number; raf: number };
    const states = new WeakMap<HTMLElement, St>();
    const activeFrames = new Set<St>();
    const scrollable = (el: Element | null): HTMLElement | null => {
      for (let e = el as HTMLElement | null; e && e !== document.body; e = e.parentElement) {
        if (e.scrollHeight > e.clientHeight + 1) {
          const oy = getComputedStyle(e).overflowY;
          if (oy === "auto" || oy === "scroll") return e;
        }
      }
      return null;
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const el = scrollable(e.target as Element);
      if (!el) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      // тачпад и так плавный: мелкие дробные шаги не трогаем
      if (e.deltaMode === 0 && Math.abs(dy) < 30 && !Number.isInteger(e.deltaY)) return;
      e.preventDefault();
      const max = el.scrollHeight - el.clientHeight;
      let st = states.get(el);
      if (!st || !st.raf || Math.abs(el.scrollTop - st.seen) > 1.5) {
        if (st?.raf) cancelAnimationFrame(st.raf);
        st = { pos: el.scrollTop, seen: el.scrollTop, target: el.scrollTop, raf: 0 };
        states.set(el, st);
      }
      st.target = Math.max(0, Math.min(max, st.target + dy * 1.1));
      const cur = st;
      const step = () => {
        if (!el.isConnected || !visualsActive()) { cur.raf = 0; activeFrames.delete(cur); return; }
        // если прокрутку двинул кто-то ещё (перетаскивание, скроллбар) — уступаем
        if (Math.abs(el.scrollTop - cur.seen) > 1.5) { cur.raf = 0; activeFrames.delete(cur); return; }
        cur.pos += (cur.target - cur.pos) * 0.15;
        if (Math.abs(cur.target - cur.pos) < 0.4) cur.pos = cur.target;
        el.scrollTop = cur.pos;
        cur.seen = el.scrollTop;
        cur.raf = cur.pos === cur.target ? 0 : requestAnimationFrame(step);
        if (!cur.raf) activeFrames.delete(cur);
      };
      if (!cur.raf) { activeFrames.add(cur); cur.raf = requestAnimationFrame(step); }
    };
    window.addEventListener("wheel", wheel, { passive: false });
    return () => { window.removeEventListener("wheel", wheel); activeFrames.forEach((st) => cancelAnimationFrame(st.raf)); activeFrames.clear(); };
  }, [s.smoothScroll, s.animations]);

  // Наклон карточек за курсором
  useEffect(() => {
    if (!s.tilt) return;
    let last: HTMLElement | null = null, pending: MouseEvent | null = null;
    let raf = 0;
    const reset = () => {
      if (!last) return;
      ["--rx", "--ry", "--mx", "--my"].forEach((key) => last?.style.removeProperty(key));
      last.classList.remove("tilting");
      last = null;
    };
    const draw = () => {
      raf = 0;
      const e = pending;
      if (!e || !visualsActive()) return;
      const card = (e.target as Element)?.closest?.(".card") as HTMLElement | null;
      if (last && last !== card) { last.style.removeProperty("--rx"); last.style.removeProperty("--ry"); last.classList.remove("tilting"); }
      last = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add("tilting");
      card.style.setProperty("--rx", `${(-py * 10).toFixed(2)}deg`);
      card.style.setProperty("--ry", `${(px * 12).toFixed(2)}deg`);
      card.style.setProperty("--mx", `${((px + 0.5) * 100).toFixed(1)}%`);
      card.style.setProperty("--my", `${((py + 0.5) * 100).toFixed(1)}%`);
    };
    const move = (e: MouseEvent) => { pending = e; if (!raf) raf = requestAnimationFrame(draw); };
    window.addEventListener("mousemove", move, { passive: true });
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); reset(); };
  }, [s.tilt]);

  return (
    <>
      {s.bgEffect !== "none" && (
        <div className={`fx-bg-layer fx-${s.bgEffect}`} aria-hidden>
          {s.bgEffect === "aurora" && <><i /><i /><i /><i /></>}
          {s.bgEffect === "cover" && cover && (
            <div key={cover} className="fx-cover" style={{ backgroundImage: `url("${cover}")`, ["--cc" as string]: coverColor ?? "var(--accent)" }} />
          )}
          {s.bgEffect === "stars" && <Stars />}
        </div>
      )}
      {s.cursorGlow && (
        <div
          ref={glow}
          className="cursor-glow"
          aria-hidden
          style={{ ["--glow-r" as string]: `${s.glowSize}px`, ["--glow-soft" as string]: `${Math.round(s.glowSoft * 100)}%`, opacity: s.glowPower * 0.45 }}
        />
      )}
      <FireCursor />
    </>
  );
}
