import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TrayMenu } from "./TrayMenu";
import "./styles.css";

// Меню браузера по правому клику не нужно — у треков своё меню
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
});

const isTray = location.hash === "#tray";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isTray ? <TrayMenu /> : <App />}
  </React.StrictMode>,
);
