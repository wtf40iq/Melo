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
    let accent = "#fff", nextColor = 0;
    return visualLoop((now, dt) => {
      const w = window.innerWidth, h = window.innerHeight;
      // Resetting width/height every frame reallocates the backing surface and resets all state.
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.clearRect(0, 0, w, h);
      if (now >= nextColor) {
        accent = document.documentElement.style.getPropertyValue("--accent").trim() || "#fff";
        nextColor = now + 500;
      }
      for (const s of stars) {
        s.y -= 0.0072 * s.z * dt;
        s.t += 1.2 * s.z * dt;
        if (s.y < 0) { s.y = 1; s.x = Math.random(); }
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.t));
        g.globalAlpha = a * s.z;
        g.fillStyle = s.z > 0.85 ? accent : "#fff";
        g.beginPath();
        g.arc(s.x * w, s.y * h, s.z * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }, 30);
  }, []);
  return <canvas ref={ref} className="fx-stars" />;
}

