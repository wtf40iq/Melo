import { useEffect, useRef } from "react";
import { visualLoop } from "../visualActivity";

export function Stars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, t: Math.random() * Math.PI * 2,
    }));
    let accent = "#fff", nextColor = 0, pulseAt = -1;
    const onPulse = () => { pulseAt = performance.now(); };
    window.addEventListener("melo:bg-pulse", onPulse);
    const stop = visualLoop((now, dt) => {
      const w = window.innerWidth, h = window.innerHeight;
      // Resetting width/height every frame reallocates the backing surface and resets all state.
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.clearRect(0, 0, w, h);
      if (now >= nextColor) {
        accent = document.documentElement.style.getPropertyValue("--accent").trim() || "#fff";
        nextColor = now + 500;
      }
      // Короткий плавный импульс: звёзды успевают быстрее пролететь, но не «улетают» далеко.
      const age = pulseAt < 0 ? 9 : (now - pulseAt) / 1000;
      const b = age < 0.95 ? Math.sin(Math.PI * (age / 0.95)) : 0;
      g.lineCap = "round";
      for (const s of stars) {
        const speed = (0.0072 + b * 0.05) * s.z;
        s.y -= speed * dt;
        s.t += (1.2 + b * 0.9) * s.z * dt;
        if (s.y < 0) { s.y = 1; s.x = Math.random(); }
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.t));
        const px = s.x * w, py = s.y * h;
        const starColor = s.z > 0.85 ? accent : "#fff";
        // Шлейф мягко тает к хвосту, а не выглядит одинаковой полоской.
        if (b > 0.02) {
          const trail = Math.min(17, b * 16 * s.z);
          const tailY = Math.min(h, py + trail);
          const grad = g.createLinearGradient(px, py, px, tailY);
          grad.addColorStop(0, starColor);
          grad.addColorStop(0.45, starColor);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.strokeStyle = grad;
          // Широкое слабое свечение + тонкая яркая сердцевина.
          g.globalAlpha = Math.min(0.26, a * s.z * b * 0.55);
          g.lineWidth = Math.max(1.6, s.z * 2.6);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px, tailY); g.stroke();
          g.globalAlpha = Math.min(0.62, a * s.z * b * 1.15);
          g.lineWidth = Math.max(0.55, s.z * 0.95);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px, tailY); g.stroke();
        }
        g.globalAlpha = Math.min(1, a * s.z * (1 + b * 0.22));
        g.fillStyle = starColor;
        g.beginPath();
        g.arc(px, py, s.z * (1.6 + b * 0.3), 0, Math.PI * 2);
        g.fill();
      }
    }, 30);
    return () => { window.removeEventListener("melo:bg-pulse", onPulse); stop(); };
  }, []);
  return <canvas ref={ref} className="fx-stars" />;
}

