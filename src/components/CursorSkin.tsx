import { forwardRef, memo, useMemo } from "react";
import { CursorMaterial } from "../store/settings";

/** Стрелка курсора: кончик — в (0, 0) исходных координат. */
export const ARROW = "M0.5 0.8 L0.5 17.6 Q0.5 18.9 1.6 18.1 L5.4 14.6 L8.3 21 Q8.8 22 9.8 21.6 L11.6 20.8 Q12.6 20.3 12.1 19.3 L9.3 13.1 L14.3 13.1 Q15.6 13.1 14.7 12.1 L1.9 0 Q0.5 -0.7 0.5 0.8 Z";
export const PAD = 1.2;
const BW = 15.6 + PAD * 2, BH = 22 + PAD * 2;
/** Размер элемента стрелки и точка кончика внутри него (в пикселях). */
export const arrowBox = (S: number) => ({ w: Math.ceil(BW * S), h: Math.ceil(BH * S), ox: PAD * S, oy: PAD * S });
const scaled = (S: number) =>
  ARROW.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_, a: string, b: string) => `${((+a + PAD) * S).toFixed(2)} ${((+b + PAD) * S).toFixed(2)}`);

export const MATERIALS: { id: CursorMaterial; label: string; hint: string }[] = [
  { id: "glass", label: "Жидкое стекло", hint: "Прозрачная линза: преломляет и подсвечивает то, что под ней" },
  { id: "glow", label: "Свечение", hint: "Стрелка из света со светящимся шлейфом" },
  { id: "neon", label: "Неон", hint: "Светящийся контур, как неоновая трубка" },
  { id: "distort", label: "Искажение", hint: "Почти невидимое марево, которое искажает всё под собой" },
  { id: "jelly", label: "Желе", hint: "Цветное мягкое желе: тянется и пружинит при движении" },
  { id: "chrome", label: "Жидкий металл", hint: "Зеркальный хром, блики бегают при движении" },
];

// ---------- карты смещения для фильтров ----------
const lensCache = new Map<number, string>();
/** Линза по форме стрелки: у краёв картинка «затягивается» внутрь, как в толстом стекле. */
export function lensMap(S: number): string {
  const key = Math.round(S * 100);
  const hit = lensCache.get(key);
  if (hit) return hit;
  const { w, h } = arrowBox(S);
  const m = document.createElement("canvas");
  m.width = w; m.height = h;
  const g = m.getContext("2d")!;
  g.filter = `blur(${Math.max(1.5, 2.4 * S)}px)`;
  g.fillStyle = "#fff";
  g.fill(new Path2D(scaled(S)));
  const a = g.getImageData(0, 0, w, h).data;
  const out = g.createImageData(w, h);
  const A = (x: number, y: number) => a[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + 3] / 255;
  let max = 0.0001;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gx[i] = A(x + 1, y) - A(x - 1, y);
    gy[i] = A(x, y + 1) - A(x, y - 1);
    max = Math.max(max, Math.hypot(gx[i], gy[i]));
  }
  for (let i = 0; i < w * h; i++) {
    // Берём картинку снаружи края — она изгибается внутрь линзы
    out.data[i * 4] = 128 - (gx[i] / max) * 127;
    out.data[i * 4 + 1] = 128 - (gy[i] / max) * 127;
    out.data[i * 4 + 2] = 128;
    out.data[i * 4 + 3] = 255;
  }
  g.filter = "none";
  g.putImageData(out, 0, 0);
  const url = m.toDataURL();
  lensCache.set(key, url);
  if (lensCache.size > 24) lensCache.delete(lensCache.keys().next().value!);
  return url;
}

let ringUrl = "";
let pressureSurface: HTMLCanvasElement | null = null;
export const RING = 256;
/** Compressed-air front with a rarefaction wake; the center and outside stay neutral. */
export function ringMap(): string {
  if (ringUrl) return ringUrl;
  const N = RING;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const im = g.createImageData(N, N);
  const surface = document.createElement("canvas");
  surface.width = surface.height = N;
  const sg = surface.getContext("2d")!;
  const skin = sg.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5 - N / 2) / (N / 2), dy = (y + 0.5 - N / 2) / (N / 2);
    const r = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    // Slightly uneven air membrane, not a perfect graphic circle.
    const front = 0.8 + 0.009 * Math.sin(angle * 5) + 0.005 * Math.sin(angle * 9 + 0.6);
    const u = (r - front) / 0.033;
    const wake = (r - front + 0.125) / 0.026;
    const taper = Math.min(1, Math.max(0, (0.95 - r) * 18));
    const k = (-u * Math.exp(-u * u) * 2.15 - wake * Math.exp(-wake * wake) * 0.44) * taper;
    const nx = r ? dx / r : 0, ny = r ? dy / r : 0;
    const o = (y * N + x) * 4;
    im.data[o] = 128 + nx * k * 120;
    im.data[o + 1] = 128 + ny * k * 120;
    im.data[o + 2] = 128;
    im.data[o + 3] = 255;
    // Broad specular reflection and a dark pressure lip: a transparent glass-like wall.
    // No particles, radial rays or separated glints.
    const facing = 0.25 + 0.75 * Math.pow(Math.max(0, Math.cos(angle + 2.3)), 2);
    const light = (0.40 * Math.exp(-Math.pow((r - front - 0.005) / 0.009, 2))
      + 0.08 * Math.exp(-Math.pow((r - front + 0.040) / 0.033, 2))) * facing;
    const echo = 0.085 * Math.exp(-Math.pow((r - front + 0.125) / 0.012, 2)) * facing;
    const dark = 0.17 * Math.exp(-Math.pow((r - front + 0.014) / 0.011, 2));
    const alpha = light + echo + dark;
    if (alpha > 0.001) {
      skin.data[o] = ((light + echo) * 222 + dark * 12) / alpha;
      skin.data[o + 1] = ((light + echo) * 238 + dark * 17) / alpha;
      skin.data[o + 2] = ((light + echo) * 255 + dark * 24) / alpha;
      skin.data[o + 3] = Math.min(0.65, alpha) * 255;
    }
  }
  g.putImageData(im, 0, 0);
  sg.putImageData(skin, 0, 0);
  pressureSurface = surface;
  return (ringUrl = c.toDataURL());
}

export function blastSurface(): HTMLCanvasElement {
  ringMap();
  return pressureSurface!;
}

export const SHOCKS = 4;

export type SkinRefs = {
  heat: SVGFEDisplacementMapElement | null;
  heat2: SVGFEDisplacementMapElement | null;
  chrome: SVGLinearGradientElement | null;
  chromeShine: SVGLinearGradientElement | null;
  shocks: (HTMLDivElement | null)[];
  shockMaps: (SVGFEDisplacementMapElement | null)[];
  shockMaps2: (SVGFEDisplacementMapElement | null)[];
  shockImgs: (SVGFEImageElement | null)[];
};

/** DOM-стрелка из «материала» + фильтры для неё и для ударных волн. */
export const CursorSkin = memo(forwardRef<HTMLDivElement, { material: CursorMaterial; S: number; show: boolean; blast: boolean; refs: SkinRefs; shockSize: number }>(
  function CursorSkin({ material, S, show, blast, refs, shockSize }, ref) {
    const { w, h, ox, oy } = arrowBox(S);
    const d = useMemo(() => scaled(S), [S]);
    const lens = useMemo(() => (show && material === "glass" ? lensMap(S) : ""), [show, material, S]);
    const ring = useMemo(() => (blast ? ringMap() : ""), [blast]);
    const vb = `${-PAD} ${-PAD} ${BW} ${BH}`;
    return (
      <>
        <svg className="mc-defs" width="0" height="0" aria-hidden>
          <defs>
            {lens && (
              <filter id="mc-lens" colorInterpolationFilters="sRGB">
                <feImage href={lens} x="0" y="0" width={w} height={h} preserveAspectRatio="none" result="m" />
                <feDisplacementMap in="SourceGraphic" in2="m" scale={9 * S} xChannelSelector="R" yChannelSelector="G" />
              </filter>
            )}
            {show && material === "distort" && (
              <filter id="mc-heat" colorInterpolationFilters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.07 0.1" numOctaves="2" seed="4" result="n">
                  <animate attributeName="baseFrequency" dur="5s" values="0.07 0.1;0.1 0.07;0.07 0.1" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap ref={(e) => { refs.heat = e; }} in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" result="d1" />
                <feDisplacementMap ref={(e) => { refs.heat2 = e; }} in="SourceGraphic" in2="n" scale="14" xChannelSelector="G" yChannelSelector="R" result="d2" />
                <feColorMatrix in="d1" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
                <feColorMatrix in="d2" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
                <feBlend in="r" in2="gb" mode="screen" />
              </filter>
            )}
            {ring && Array.from({ length: SHOCKS }, (_, i) => (
              <filter key={i} id={`mc-sh${i}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                <feImage ref={(e) => { refs.shockImgs[i] = e; }} href={ring} x="0" y="0" width={shockSize} height={shockSize} preserveAspectRatio="none" result="m" />
                <feDisplacementMap ref={(e) => { refs.shockMaps[i] = e; }} in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            ))}
          </defs>
        </svg>
        {ring && Array.from({ length: SHOCKS }, (_, i) => (
          <div key={i} ref={(e) => { refs.shocks[i] = e; }} className="mc-shock" style={{ display: "none" }} aria-hidden />
        ))}
        {show && (
          <div ref={ref} className={`mc mc-${material}`} style={{ width: w, height: h, transformOrigin: `${ox}px ${oy}px` }} aria-hidden>
            {(material === "glass" || material === "distort" || material === "jelly") && (
              <div className="mc-back" style={{ clipPath: `path("${d}")` }} />
            )}
            <svg className="mc-skin" width={w} height={h} viewBox={vb}>
              <defs>
                <linearGradient id="mcg-body" x1="0" y1="0" x2="0.7" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--c0)" }} />
                  <stop offset="0.55" style={{ stopColor: "var(--c1)" }} />
                  <stop offset="1" style={{ stopColor: "var(--c2)" }} />
                </linearGradient>
                <linearGradient id="mcg-rim" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity=".95" />
                  <stop offset="0.45" stopColor="#fff" stopOpacity=".18" />
                  <stop offset="0.8" stopColor="#fff" stopOpacity=".1" />
                  <stop offset="1" stopColor="#fff" stopOpacity=".7" />
                </linearGradient>
                <linearGradient id="mcg-chrome" ref={(e) => { refs.chrome = e; }} gradientUnits="userSpaceOnUse" x1="-12" y1="0" x2="25" y2="22" spreadMethod="reflect">
                  <stop offset="0" stopColor="#fdfeff" />
                  <stop offset="0.22" stopColor="#a9b1bf" />
                  <stop offset="0.38" stopColor="#2a2f3a" />
                  <stop offset="0.5" stopColor="#f4f7fc" />
                  <stop offset="0.62" style={{ stopColor: "var(--c1)" }} />
                  <stop offset="0.78" stopColor="#3b414e" />
                  <stop offset="1" stopColor="#e9edf4" />
                </linearGradient>
                <linearGradient id="mcg-metal-shine" ref={(e) => { refs.chromeShine = e; }} gradientUnits="userSpaceOnUse" x1="-10" y1="-8" x2="18" y2="20">
                  <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
                  <stop offset="0.47" stopColor="#fff" stopOpacity=".95" />
                  <stop offset="0.51" stopColor="#fff" stopOpacity=".5" />
                  <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="mcg-shine" cx="0.25" cy="0.2" r="0.5">
                  <stop offset="0" stopColor="#fff" stopOpacity=".9" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
                <clipPath id="mcg-in"><path d={ARROW} /></clipPath>
                <filter id="mcg-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.6" /></filter>
              </defs>
              {material === "glow" && <>
                <path d={ARROW} fill="url(#mcg-body)" opacity=".9" />
                <path d={ARROW} fill="none" style={{ stroke: "var(--c0)" }} strokeWidth="1.6" strokeLinejoin="round" clipPath="url(#mcg-in)" filter="url(#mcg-soft)" />
                <path d="M2.2 3.6 L2.2 13.4" stroke="#fff" strokeOpacity=".85" strokeWidth="1.1" strokeLinecap="round" filter="url(#mcg-soft)" />
              </>}
              {material === "neon" && <>
                <path d={ARROW} style={{ fill: "var(--c2)", stroke: "var(--c1)" }} fillOpacity=".14" strokeWidth="1.5" strokeLinejoin="round" />
                <path d={ARROW} fill="none" style={{ stroke: "var(--c0)" }} strokeWidth=".55" strokeLinejoin="round" />
              </>}
              {material === "glass" && <>
                <path d={ARROW} style={{ fill: "var(--c1)" }} fillOpacity=".08" />
                <path d={ARROW} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="1.4" strokeLinejoin="round" clipPath="url(#mcg-in)" filter="url(#mcg-soft)" />
                <path d={ARROW} fill="none" stroke="url(#mcg-rim)" strokeWidth=".75" strokeLinejoin="round" />
                <ellipse cx="3.6" cy="5.4" rx="2" ry="3.6" fill="url(#mcg-shine)" opacity=".75" clipPath="url(#mcg-in)" />
              </>}
              {material === "distort" && <>
                <path d={ARROW} fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth=".55" strokeLinejoin="round" />
              </>}
              {material === "jelly" && <>
                <path d={ARROW} fill="url(#mcg-body)" fillOpacity=".62" />
                <path d={ARROW} fill="none" style={{ stroke: "var(--c2)" }} strokeOpacity=".9" strokeWidth="2.2" strokeLinejoin="round" clipPath="url(#mcg-in)" filter="url(#mcg-soft)" />
                <path d={ARROW} fill="none" style={{ stroke: "var(--c0)" }} strokeOpacity=".7" strokeWidth=".5" strokeLinejoin="round" />
                <ellipse cx="3.4" cy="6" rx="1.6" ry="3.8" fill="#fff" opacity=".7" clipPath="url(#mcg-in)" filter="url(#mcg-soft)" />
                <circle cx="8.6" cy="11.4" r=".75" fill="#fff" opacity=".8" />
              </>}
              {material === "chrome" && <>
                <path d={ARROW} fill="url(#mcg-chrome)" />
                <path d={ARROW} fill="url(#mcg-metal-shine)" />
                <path d={ARROW} fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth=".45" strokeLinejoin="round" />
                <path d={ARROW} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" strokeLinejoin="round" clipPath="url(#mcg-in)" filter="url(#mcg-soft)" />
              </>}
            </svg>
          </div>
        )}
      </>
    );
  },
));
