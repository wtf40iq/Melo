import { ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "../store/settings";

/** Горизонтальная полка карточек с кнопками прокрутки — как подборки во ВКонтакте. */
export function Shelf({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: true, right: true });
  const check = () => {
    const el = row.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft < 4, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    check();
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  const go = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className="shelf">
      <div className="section-head">
        <div className="shelf-title">
          <h3>{title}</h3>
          {hint && <small>{hint}</small>}
        </div>
        <div className="shelf-nav">
          {action}
          {!(edge.left && edge.right) && (
            <>
              <button className="icon-btn sm" disabled={edge.left} onClick={() => go(-1)} aria-label={t("Назад")}><ChevronLeft size={18} /></button>
              <button className="icon-btn sm" disabled={edge.right} onClick={() => go(1)} aria-label={t("Вперёд")}><ChevronRight size={18} /></button>
            </>
          )}
        </div>
      </div>
      <div className="shelf-row" ref={row} onScroll={check}>{children}</div>
    </section>
  );
}
