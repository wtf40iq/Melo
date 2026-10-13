/** Visual work sleeps while the main window is hidden/minimized, never the audio. */
let background = false;
const listeners = new Set<(active: boolean) => void>();
export const visualsActive = () => !document.hidden && !background;
const notify = () => {
  const active = visualsActive();
  document.documentElement.classList.toggle("visuals-paused", !active);
  listeners.forEach((fn) => fn(active));
};
document.addEventListener("visibilitychange", notify);
window.addEventListener("melo:background", ((e: CustomEvent<boolean>) => {
  background = !!e.detail;
  notify();
}) as EventListener);
export function onVisualActivity(fn: (active: boolean) => void) {
  listeners.add(fn);
  fn(visualsActive());
  return () => { listeners.delete(fn); };
}
/** Reuses one scheduled frame; false means settled until a new instance is started. */
export function visualLoop(draw: (now: number, dt: number) => void | boolean, fps = 60) {
  let raf = 0, last = 0, ended = false;
  const frame = (now: number) => {
    raf = 0;
    if (ended || !visualsActive()) return;
    const elapsed = now - last;
    if (last && elapsed < 1000 / fps - 0.5) { raf = requestAnimationFrame(frame); return; }
    const dt = last ? Math.min(0.05, elapsed / 1000) : 1 / fps;
    last = now;
    if (draw(now, dt) === false) { ended = true; return; }
    raf = requestAnimationFrame(frame);
  };
  const off = onVisualActivity((active) => {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (active && !ended) raf = requestAnimationFrame(frame);
  });
  return () => { ended = true; cancelAnimationFrame(raf); off(); };
}
