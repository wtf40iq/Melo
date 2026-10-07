import { useEffect, useRef, useState } from "react";
import { Welcome } from "./pages/Welcome";
import { UpdateProvider } from "./store/update";
import { UpdateDialog } from "./components/UpdateDialog";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Toasts } from "./components/Toasts";
import { Tooltip } from "./components/Tooltip";
import { Effects } from "./components/Effects";
import { Home } from "./pages/Home";
import { Playlists } from "./pages/Playlists";
import { Library } from "./pages/Library";
import { Explore } from "./pages/Explore";
import { PlaylistPage } from "./pages/PlaylistPage";
import { SearchPage } from "./pages/SearchPage";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { SettingsProvider, useSettings } from "./store/settings";
import { LibraryProvider, useLibrary } from "./store/library";
import { PlayerProvider, usePlayer } from "./store/player";
import { UiProvider, useUi } from "./store/ui";

function Shell() {
  const ui = useUi();
  const lib = useLibrary();
  const player = usePlayer();
  const settings = useSettings();
  const mainRef = useRef<HTMLElement>(null);
  const r = ui.route;
  // Первый запуск — приветствие (его можно открыть снова из настроек)
  const [welcome, setWelcome] = useState(() => !localStorage.getItem("melo.onboarded"));
  useEffect(() => {
    const on = () => setWelcome(true);
    window.addEventListener("melo:welcome", on);
    return () => window.removeEventListener("melo:welcome", on);
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [r, ui.query]);

  // Горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if ((e.ctrlKey && e.code === "KeyF") || (!typing && e.key === "/")) {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      } else if (typing) return;
      else if (e.altKey && e.code === "ArrowLeft") ui.back();
      else if (e.altKey && e.code === "ArrowRight") ui.forward();
      else if (e.code === "Space") { e.preventDefault(); player.toggle(); }
      else if (e.ctrlKey && e.code === "ArrowRight") player.next();
      else if (e.ctrlKey && e.code === "ArrowLeft") player.prev();
      else if (e.code === "ArrowRight") player.seek(Math.min(player.duration, player.position + 5));
      else if (e.code === "ArrowLeft") player.seek(Math.max(0, player.position - 5));
      else if (e.code === "ArrowUp") { e.preventDefault(); player.setVolume(Math.min(1, player.volume + 0.05)); }
      else if (e.code === "ArrowDown") { e.preventDefault(); player.setVolume(Math.max(0, player.volume - 0.05)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, ui]);

  // После выхода останавливаем музыку
  useEffect(() => {
    player.stop();
    if (lib.profile) player.restore(lib.profile.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.profile?.id]);

  // Трей: кнопки меню и подсказка с текущим треком
  const trayActions = useRef(player);
  trayActions.current = player;
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let off: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("tray", (e) => {
        const p = trayActions.current;
        if (e.payload === "toggle") p.toggle();
        else if (e.payload === "next") p.next();
        else if (e.payload === "prev") p.prev();
      }).then((u) => (off = u)),
    );
    return () => off?.();
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const c = player.current;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("tray_update", { title: c?.title ?? null, artist: c?.artist ?? null, cover: c?.cover ?? null, playing: player.playing }).catch(() => {}),
    );
  }, [player.current, player.playing]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_close_to_tray", { value: settings.closeToTray }).catch(() => {}));
  }, [settings.closeToTray]);

  if (welcome) {
    return (
      <div className="app logged-out">
        <TitleBar query="" onQuery={() => {}} canBack={false} canForward={false} onBack={() => {}} onForward={() => {}} showSearch={false} />
        <Effects />
        <Welcome onDone={() => { localStorage.setItem("melo.onboarded", "1"); setWelcome(false); }} />
      </div>
    );
  }

  if (!lib.profile) {
    return (
      <div className="app logged-out">
        <TitleBar query="" onQuery={() => {}} canBack={false} canForward={false} onBack={() => {}} onForward={() => {}} showSearch={false} />
        <Effects />
        <Login />
        <Toasts />
        <Tooltip />
      </div>
    );
  }

  const page = () => {
    if (ui.query.trim()) return <SearchPage query={ui.query} />;
    if (r.name === "home") return <Home />;
    if (r.name === "library") return <Library />;
    if (r.name === "playlists") return <Playlists />;
    if (r.name === "explore") return <Explore />;
    if (r.name === "settings") return <Settings />;
    return <PlaylistPage key={r.playlist.id} playlist={r.playlist} />;
  };

  return (
    <div className="app app-in">
      <Effects />
      <TitleBar
        query={ui.query}
        onQuery={ui.setQuery}
        canBack={ui.canBack}
        canForward={ui.canForward}
        onBack={ui.back}
        onForward={ui.forward}
      />
      <Sidebar />
      <main className="main" ref={mainRef}>
        <div className="page-anim" key={ui.query.trim() ? "search" : r.name === "playlist" ? `pl-${r.playlist.id}` : r.name}>
          {page()}
        </div>
      </main>
      <QueuePanel />
      <PlayerBar />
      <Toasts />
      <Tooltip />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <UiProvider>
        <LibraryProvider>
          <PlayerProvider>
            <UpdateProvider>
              <Shell />
              <UpdateDialog />
            </UpdateProvider>
          </PlayerProvider>
        </LibraryProvider>
      </UiProvider>
    </SettingsProvider>
  );
}
