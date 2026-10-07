import { useEffect, useRef } from "react";
import { getAnalyser } from "../store/eq";

// Спектр музыки тонкой полосой над плеером.
export function Visualizer({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    let raf = 0;
    let level: number[] = [];
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const an = getAnalyser();
      const bars = Math.max(24, Math.floor(w / 9));
      const data = new Uint8Array(an ? an.frequencyBinCount : 0);
      if (an && playing) an.getByteFrequencyData(data);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5e9fe8";
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, "rgba(255,255,255,0.9)");
      g.fillStyle = grad;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        // логарифмическая шкала: больше полос под басы и середину
        const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.7) * data.length * 0.85));
        const v = data.length ? data[idx] / 255 : 0;
        level[i] = (level[i] ?? 0) * 0.72 + v * 0.28;
        const bh = Math.max(1.5, level[i] * h);
        g.globalAlpha = 0.35 + level[i] * 0.6;
        g.beginPath();
        g.roundRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh, 2);
        g.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); level = []; };
  }, [playing]);
  return <canvas ref={ref} className="visualizer" aria-hidden />;
}
