import { useEffect, useRef } from "react";

/** Фокус остаётся внутри модального окна, а Tab не уходит на страницу под ним. */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((x) => x.offsetParent !== null);
    const first = focusables()[0];
    (first ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); el.focus(); return; }
      const firstEl = list[0], lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return ref;
}
