import { useState } from "react";
import { Music2 } from "lucide-react";

// Если обложки нет — градиент, вычисленный из названия.
const palettes = [
  ["#5E9FE8", "#1E3A5F"], ["#BF8EDA", "#3B2450"], ["#72BC8F", "#1E3D2D"], ["#DE9255", "#4A2A14"],
  ["#DF84A8", "#4A1E30"], ["#4FB9C9", "#163C42"], ["#EAC26B", "#4A3A14"], ["#E97366", "#4A1C17"],
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

type Props = { seed: string; size?: number; radius?: number; src?: string; fill?: boolean };

export function Cover({ seed, size = 40, radius = 6, src, fill }: Props) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [a, b] = palettes[hash(seed) % palettes.length];
  const style = {
    width: fill ? "100%" : size,
    height: fill ? "auto" : size,
    aspectRatio: "1",
    borderRadius: radius,
    background: `linear-gradient(${hash(seed + "a") % 360}deg, ${a}, ${b})`,
  };
  return (
    <div className="cover" style={style} aria-hidden>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" draggable={false} className={loaded ? "loaded" : ""} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      ) : (
        <Music2 size={Math.round((fill ? 168 : size) * 0.36)} className="cover-icon" />
      )}
    </div>
  );
}
