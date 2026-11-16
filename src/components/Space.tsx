import { useEffect, useRef } from "react";
import { visualLoop } from "../visualActivity";

type Star = {
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
  speed: number;
  flare: boolean;
  rot: number;
};

type Constellation = {
  points: { x: number; y: number; r: number; phase: number }[];
  lines: [number, number][];
  center: { x: number; y: number };
  phase: number;
  speed: number;
  depth: number;
  age: number;
  life: number;
};

type Meteor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  len: number;
  width: number;
};

type Sparkle = {
  x: number;
  y: number;
  life: number;
  max: number;
  size: number;
  rot: number;
};

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Спрайт мягкой звезды: яркое ядро и широкое свечение вместо плоского кружка. */
function makeDot() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const h = size / 2;
  const grd = x.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.06, "rgba(255,255,255,.98)");
  grd.addColorStop(0.18, "rgba(255,255,255,.42)");
  grd.addColorStop(0.46, "rgba(255,255,255,.1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = grd;
  x.fillRect(0, 0, size, size);
  return c;
}

/** Спрайт яркой звезды с четырьмя тонкими лучами-дифракцией. */
function makeFlare() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const h = size / 2;
  const grd = x.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.045, "rgba(255,255,255,.96)");
  grd.addColorStop(0.14, "rgba(255,255,255,.3)");
  grd.addColorStop(0.42, "rgba(255,255,255,.07)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = grd;
  x.fillRect(0, 0, size, size);
  x.globalCompositeOperation = "lighter";
  const ray = (dx: number, dy: number, len: number, width: number, strength: number) => {
    const grad = x.createLinearGradient(h, h, h + dx * len, h + dy * len);
    grad.addColorStop(0, `rgba(255,255,255,${strength})`);
    grad.addColorStop(0.16, `rgba(255,255,255,${strength * 0.5})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${strength * 0.1})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    x.strokeStyle = grad;
    x.lineWidth = width;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(h, h);
    x.lineTo(h + dx * len, h + dy * len);
    x.stroke();
  };
  ray(1, 0, h * 0.94, 1.7, 0.95);
  ray(-1, 0, h * 0.94, 1.7, 0.95);
  ray(0, 1, h * 0.94, 1.7, 0.95);
  ray(0, -1, h * 0.94, 1.7, 0.95);
  ray(0.7, 0.7, h * 0.52, 1.05, 0.42);
  ray(-0.7, 0.7, h * 0.52, 1.05, 0.42);
  ray(0.7, -0.7, h * 0.52, 1.05, 0.42);
  ray(-0.7, -0.7, h * 0.52, 1.05, 0.42);
  return c;
}

/** Монохромный OLED-космос: чёрный фон, объёмные звёзды, живые созвездия и падающие звёзды. */
export function Space() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d", { alpha: true })!;
    const dot = makeDot();
    const flare = makeFlare();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    let dust: { x: number; y: number; a: number; phase: number }[] = [];
    let constellations: Constellation[] = [];
    let meteors: Meteor[] = [];
    let sparkles: Sparkle[] = [];
    let tx = 0;
    let ty = 0;
    let mx = 0;
    let my = 0;
    let lastMeteor = 0;
    let meteorGap = rnd(3900, 7200);
    let lastSparkle = 0;
    let sparkleGap = rnd(500, 1500);

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const makeStars = () => {
      stars = Array.from({ length: 430 }, () => {
        const z = rnd(0.15, 1);
        return {
          x: Math.random(),
          y: Math.random(),
          z,
          r: rnd(0.35, 1.55) * (0.7 + z * 0.7),
          phase: rnd(0, Math.PI * 2),
          speed: rnd(0.3, 1.7),
          flare: Math.random() < 0.1 || z > 0.9,
          rot: rnd(0, Math.PI),
        };
      });
    };

    // Очень бледная звёздная пыль — глубина без цветной туманности.
    const makeDust = () => {
      dust = Array.from({ length: 250 }, () => {
        const t = Math.random();
        return {
          x: 0.06 + t * 0.9 + rnd(-0.07, 0.07),
          y: 0.78 - t * 0.52 + rnd(-0.055, 0.055),
          a: rnd(0.035, 0.13),
          phase: rnd(0, Math.PI * 2),
        };
      });
    };

    /** Новое созвездие: случайная форма, место без наложения и короткий жизненный цикл. */
    const makeConstellation = (skipIndex = -1): Constellation => {
      const count = Math.floor(rnd(5, 8));
      const minDistance = 0.30;
      let center = { x: rnd(0.16, 0.84), y: rnd(0.18, 0.8) };
      for (let attempt = 0; attempt < 40; attempt++) {
        const candidate = { x: rnd(0.16, 0.84), y: rnd(0.18, 0.8) };
        const clear = constellations.every((c, i) => i === skipIndex || Math.hypot(c.center.x - candidate.x, c.center.y - candidate.y) > minDistance);
        center = candidate;
        if (clear) break;
      }
      const base = rnd(0, Math.PI * 2);
      const radius = rnd(0.05, 0.105);
      const points = Array.from({ length: count }, (_, i) => {
        const angle = base + (i / count) * Math.PI * 2 + rnd(-0.24, 0.24);
        const r = radius * rnd(0.58, 1.16);
        return {
          x: clamp(center.x + Math.cos(angle) * r, 0.03, 0.97),
          y: clamp(center.y + Math.sin(angle) * r * 0.8, 0.05, 0.88),
          r: rnd(1.1, 2.4),
          phase: rnd(0, Math.PI * 2),
        };
      });
      // Только цепочка, без пересекающихся хорд — фигура выглядит аккуратно.
      const lines: [number, number][] = [];
      for (let i = 0; i < count - 1; i++) lines.push([i, i + 1]);
      return {
        points,
        lines,
        center,
        phase: rnd(0, Math.PI * 2),
        speed: rnd(0.35, 0.9),
        depth: rnd(0.25, 0.7),
        age: 0,
        life: rnd(18, 26),
      };
    };

    const resetConstellations = () => {
      constellations = [];
      for (let i = 0; i < 4; i++) {
        const c = makeConstellation();
        // Стартуют не одновременно: одни уже собраны, другие только появляются.
        c.age = rnd(0, c.life * 0.72);
        constellations.push(c);
      }
    };

    const spawnMeteor = (burst = false) => {
      meteors.push({
        x: rnd(burst ? 0.34 : 0.58, burst ? 0.92 : 1.02) * w,
        y: rnd(burst ? -0.02 : -0.1, burst ? 0.26 : 0.16) * h,
        vx: -rnd(480, 840),
        vy: rnd(280, 520),
        life: 0,
        max: rnd(0.85, 1.4),
        len: rnd(80, 180),
        width: rnd(0.65, 1.55),
      });
    };

    const spawnSparkle = () => {
      sparkles.push({
        x: rnd(0.04, 0.96) * w,
        y: rnd(0.04, 0.86) * h,
        life: 0,
        max: rnd(0.65, 1.15),
        size: rnd(1, 2.5),
        rot: rnd(0, Math.PI),
      });
    };

    const onPulse = () => {
      spawnMeteor(true);
      spawnMeteor(true);
      lastMeteor = performance.now();
      meteorGap = rnd(3900, 7200);
    };

    const onMove = (e: MouseEvent) => {
      tx = (e.clientX / Math.max(1, w) - 0.5) * 2;
      ty = (e.clientY / Math.max(1, h) - 0.5) * 2;
    };

    const drawSprite = (sprite: HTMLCanvasElement, x: number, y: number, size: number, rot = 0) => {
      if (rot) {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.drawImage(sprite, -size / 2, -size / 2, size, size);
        g.restore();
      } else {
        g.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
    };

    resize();
    makeStars();
    makeDust();
    resetConstellations();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("melo:bg-pulse", onPulse);

    const stop = visualLoop((now, dt) => {
      if (!w || !h) resize();
      mx += (tx - mx) * Math.min(1, dt * 2.4);
      my += (ty - my) * Math.min(1, dt * 2.4);
      g.clearRect(0, 0, w, h);

      // Пыль Млечного Пути: только серые точки, без цветного свечения.
      for (const d of dust) {
        const twinkle = 0.55 + 0.45 * Math.sin(now * 0.0011 + d.phase);
        g.globalAlpha = d.a * twinkle;
        g.fillStyle = "#ffffff";
        const px = (d.x + mx * 0.0025) * w;
        const py = (d.y + my * 0.002) * h;
        g.fillRect(px, py, 0.85, 0.85);
      }

      // Живые созвездия: одни собираются по линиям, другие растворяются,
      // затем на их месте появляется новая случайная фигура.
      for (let ci = 0; ci < constellations.length; ci++) {
        const c = constellations[ci];
        c.age += dt;
        if (c.age >= c.life) {
          constellations[ci] = makeConstellation(ci);
          continue;
        }
        const assembleTime = 3.0;
        const disassembleTime = 2.4;
        let assemble = Math.min(1, c.age / assembleTime);
        if (c.age > c.life - disassembleTime) {
          assemble *= clamp((c.life - c.age) / disassembleTime, 0, 1);
        }
        const fade = Math.min(1, c.age / 0.65, (c.life - c.age) / 0.9);
        if (fade <= 0.01) continue;

        const angle = Math.sin(now * 0.00004 * c.speed + c.phase) * 0.075;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ox = Math.sin(now * 0.00003 * c.speed + c.phase) * 0.006 + mx * 0.004 * c.depth;
        const oy = Math.cos(now * 0.000025 * c.speed + c.phase) * 0.005 + my * 0.003 * c.depth;
        const pts = c.points.map((p) => {
          const dx = p.x - c.center.x;
          const dy = p.y - c.center.y;
          return {
            ...p,
            px: (c.center.x + dx * cos - dy * sin + ox) * w,
            py: (c.center.y + dx * sin + dy * cos + oy) * h,
          };
        });

        const total = c.lines.length;
        const reveal = assemble * total;
        g.globalCompositeOperation = "source-over";
        g.strokeStyle = "#ffffff";
        for (let i = 0; i < total; i++) {
          const [a, b] = c.lines[i];
          const from = pts[a];
          const to = pts[b];
          if (!from || !to) continue;
          const part = clamp(reveal - i, 0, 1);
          if (part <= 0) continue;
          const ex = from.px + (to.px - from.px) * part;
          const ey = from.py + (to.py - from.py) * part;
          g.globalAlpha = fade * 0.2;
          g.lineWidth = 2.7;
          g.beginPath();
          g.moveTo(from.px, from.py);
          g.lineTo(ex, ey);
          g.stroke();
          g.globalAlpha = fade * 0.76;
          g.lineWidth = 0.74;
          g.beginPath();
          g.moveTo(from.px, from.py);
          g.lineTo(ex, ey);
          g.stroke();
        }

        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const pointFade = clamp(reveal - i + 1, 0, 1);
          if (pointFade <= 0) continue;
          const twinkle = 0.5 + 0.5 * Math.sin(now * 0.0013 + p.phase);
          const pointSize = 11 + p.r * 3.8 + twinkle * 4;
          g.globalAlpha = fade * pointFade * (0.55 + twinkle * 0.35);
          drawSprite(flare, p.px, p.py, pointSize, p.phase);
          g.globalAlpha = fade * pointFade * (0.06 + twinkle * 0.06);
          drawSprite(dot, p.px, p.py, pointSize * 2.1);
        }
      }

      // Звёзды: мягкие диски для слабых и лучистые вспышки для ярких.
      g.globalCompositeOperation = "lighter";
      for (const s of stars) {
        s.x += (0.0014 + s.z * 0.003) * dt;
        s.y -= (0.0005 + s.z * 0.0013) * dt;
        if (s.x > 1) s.x -= 1;
        if (s.y < 0) s.y += 1;

        const px = ((((s.x + mx * s.z * 0.009) % 1) + 1) % 1) * w;
        const py = ((((s.y + my * s.z * 0.006) % 1) + 1) % 1) * h;
        const twinkle = 0.5 + 0.5 * Math.sin(now * 0.0012 * s.speed + s.phase);
        const alpha = (0.14 + 0.82 * twinkle) * (0.32 + s.z * 0.68);
        const size = (s.flare ? 16 : 9) * (0.46 + s.z * 0.8) * (0.82 + twinkle * 0.32);
        g.globalAlpha = alpha;
        drawSprite(s.flare ? flare : dot, px, py, size, s.flare ? s.rot : 0);
      }

      // Вспышки-искры.
      if (now - lastSparkle > sparkleGap) {
        spawnSparkle();
        lastSparkle = now;
        sparkleGap = rnd(500, 1800);
      }
      sparkles = sparkles.filter((s) => s.life < s.max);
      for (const s of sparkles) {
        s.life += dt;
        const k = Math.max(0, 1 - s.life / s.max);
        const grow = 0.75 + (1 - k) * 0.65;
        g.globalAlpha = 0.86 * k;
        drawSprite(flare, s.x, s.y, s.size * 12 * grow, s.rot + (1 - k) * 0.35);
      }

      // Падающие звёзды: мягкое свечение головы и затухающий белый хвост.
      if (now - lastMeteor > meteorGap) {
        spawnMeteor();
        lastMeteor = now;
        meteorGap = rnd(3900, 7200);
      }
      meteors = meteors.filter((m) => m.life < m.max);
      for (const m of meteors) {
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = Math.max(0, 1 - m.life / m.max);
        const speed = Math.hypot(m.vx, m.vy) || 1;
        const tailX = m.x - (m.vx / speed) * m.len * (0.45 + k * 0.55);
        const tailY = m.y - (m.vy / speed) * m.len * (0.45 + k * 0.55);
        const grad = g.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
        grad.addColorStop(0.3, `rgba(210,210,210,${0.38 * k})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.globalAlpha = 0.16 * k;
        g.strokeStyle = grad;
        g.lineWidth = m.width * 3;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.lineTo(tailX, tailY);
        g.stroke();
        g.globalAlpha = 0.92 * k;
        g.lineWidth = m.width;
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.lineTo(tailX, tailY);
        g.stroke();
        g.globalAlpha = 0.7 * k;
        drawSprite(dot, m.x, m.y, 11 + m.width * 3);
      }

      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }, 30);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("melo:bg-pulse", onPulse);
    };
  }, []);

  return (
    <div className="fx-space" aria-hidden>
      <canvas ref={ref} />
      <div className="fx-space-vignette" />
    </div>
  );
}
