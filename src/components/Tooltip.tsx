import { memo, useEffect, useRef, useState } from "react";

// The text changes rarely; pointer motion belongs to a DOM frame, not a React render.
export const Tooltip = memo(function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const node = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const target = useRef<Element | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = node.current;
      if (!el) return;
      const { x, y } = pos.current;
      el.style.left = `${Math.min(x + 14, window.innerWidth - 260)}px`;
      el.style.top = `${y + 22 > window.innerHeight - 40 ? y - 36 : y + 20}px`;
    };
    const move = (e: MouseEvent) => {
      pos.current.x = e.clientX; pos.current.y = e.clientY;
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el !== target.current) {
        target.current = el;
        clearTimeout(timer.current);
        setTip(null);
        if (el) timer.current = window.setTimeout(() => {
          const text = el.getAttribute("data-tip");
          if (text && el.isConnected && target.current === el) setTip({ text, ...pos.current });
        }, 380);
      } else if (el && node.current && !raf) raf = requestAnimationFrame(place);
    };
    const hide = () => {
      clearTimeout(timer.current); cancelAnimationFrame(raf); raf = 0;
      target.current = null; setTip(null);
    };
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", hide);
    window.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("mouseleave", hide);
    return () => {
      clearTimeout(timer.current); cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", hide);
      window.removeEventListener("wheel", hide);
      window.removeEventListener("blur", hide);
      document.removeEventListener("mouseleave", hide);
    };
  }, []);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 260);
  const top = tip.y + 22 > window.innerHeight - 40 ? tip.y - 36 : tip.y + 20;
  return <div ref={node} className="cursor-tip" style={{ left, top }}>{tip.text}</div>;
});
