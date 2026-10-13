import { useEffect, useRef } from "react";
import { visualLoop } from "../visualActivity";
import { getAnalyser } from "../store/eq";

// Спектр музыки тонкой полосой над плеером.
export function Visualizer({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    let level: number[] = [];
    let data = new Uint8Array(0), gradient: CanvasGradient | null = null;
    let oldAccent = "", nextColor = 0;
    return visualLoop((now, dt) => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = c.clientWidth, h = c.clientHeight;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; gradient = null; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const an = getAnalyser();
      const bars = Math.max(24, Math.floor(w / 9));
      const n = an?.frequencyBinCount ?? 0;
      if (data.length !== n) data = new Uint8Array(n);
      if (an && playing) an.getByteFrequencyData(data);
      if (now >= nextColor || !gradient) {
        const accent = document.documentElement.style.getPropertyValue("--accent").trim() || "#5e9fe8";
        if (accent !== oldAccent || !gradient) {
          gradient = g.createLinearGradient(0, h, 0, 0);
          gradient.addColorStop(0, accent); gradient.addColorStop(1, "rgba(255,255,255,0.9)");
          oldAccent = accent;
        }
        nextColor = now + 500;
      }
      g.fillStyle = gradient!;
      const bw = w / bars, smoothing = Math.pow(0.72, dt * 60);
      for (let i = 0; i < bars; i++) {
        const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.7) * data.length * 0.85));
        const v = data.length && playing ? data[idx] / 255 : 0;
        level[i] = (level[i] ?? 0) * smoothing + v * (1 - smoothing);
        const bh = Math.max(1.5, level[i] * h);
        g.globalAlpha = 0.35 + level[i] * 0.6;
        g.beginPath(); g.roundRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh, 2); g.fill();
      }
      return playing;
    }, 30);
  }, [playing]);
  return <canvas ref={ref} className="visualizer" aria-hidden />;
}
