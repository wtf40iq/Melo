import React from "react";
import ReactDOM from "react-dom/client";
const App = React.lazy(() => import("./App"));
const TrayMenu = React.lazy(() => import("./TrayMenu").then((module) => ({ default: module.TrayMenu })));
import "./styles.css";

// Меню браузера по правому клику не нужно — у треков своё меню
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
});

// Никаких «Сохранённых сведений» браузера в полях ввода — у поиска своя история
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
}, true);

const isTray = location.hash === "#tray";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>{isTray ? <TrayMenu /> : <App />}</React.Suspense>
  </React.StrictMode>,
);
