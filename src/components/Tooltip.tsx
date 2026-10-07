import { useEffect, useRef, useState } from "react";

// Подсказка возле курсора для любых элементов с атрибутом data-tip.
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const target = useRef<Element | null>(null);
  const pos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const move = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el !== target.current) {
        target.current = el;
        clearTimeout(timer.current);
        setTip(null);
        if (el) {
          timer.current = window.setTimeout(() => {
            const text = el.getAttribute("data-tip");
            if (text && target.current === el) setTip({ text, ...pos.current });
          }, 380);
        }
      } else if (el) {
        setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
      }
    };
    const hide = () => {
      clearTimeout(timer.current);
      target.current = null;
      setTip(null);
    };
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", hide);
    window.addEventListener("wheel", hide, { passive: true });
    document.addEventListener("mouseleave", hide);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", hide);
      window.removeEventListener("wheel", hide);
      document.removeEventListener("mouseleave", hide);
    };
  }, []);

  if (!tip) return null;
  // Не даём подсказке вылезти за край окна
  const left = Math.min(tip.x + 14, window.innerWidth - 260);
  const top = tip.y + 22 > window.innerHeight - 40 ? tip.y - 36 : tip.y + 20;
  return <div className="cursor-tip" style={{ left, top }}>{tip.text}</div>;
}
