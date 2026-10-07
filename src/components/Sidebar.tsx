import { useEffect, useRef, useState } from "react";
import { Check, Compass, Home, Library, ListMusic, LogOut, Settings, UserPlus, X } from "lucide-react";
import { useSettings } from "../store/settings";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { Route, useUi } from "../store/ui";
import { Cover } from "./Cover";

const nav = [
  { name: "home", label: "Главная", icon: Home },
  { name: "library", label: "Моя музыка", icon: Library },
  { name: "playlists", label: "Плейлисты", icon: ListMusic },
  { name: "explore", label: "Обзор", icon: Compass },
] as const;

function Avatar({ photo, name, size = 32 }: { photo?: string; name?: string; size?: number }) {
  return photo ? (
    <img className="avatar" src={photo} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar" style={{ width: size, height: size }}>{(name || "?")[0]}</span>
  );
}

export function Sidebar() {
  const ui = useUi();
  const lib = useLibrary();
  const p = usePlayer();
  const { t, sideCover } = useSettings();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const r = ui.route;
  const cur = p.current;

  useEffect(() => {
    if (!menu) return;
    lib.reloadAccounts();
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  return (
    <aside className="sidebar">
      <nav className="nav">
        {nav.map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            className={`nav-item ${r.name === name && !ui.query ? "active" : ""}`}
            onClick={() => ui.navigate({ name } as Route)}
          >
            <Icon size={19} />
            {t(label)}
          </button>
        ))}
      </nav>

      <div className="sidebar-fill" />

      {cur && sideCover && (
        <div className="side-now" key={cur.id}>
          <div className="side-now-cover">
            <Cover seed={cur.title + cur.artist} src={cur.cover} radius={10} fill />
          </div>
          <b title={cur.title}>{cur.title}</b>
          <small title={cur.artist}>{cur.artist}</small>
        </div>
      )}

      <div className="profile" ref={menuRef}>
        <button className="profile-btn" onClick={() => setMenu((m) => !m)}>
          <Avatar photo={lib.profile?.photo} name={lib.profile?.name} />
          <span className="profile-name">{lib.profile?.name}</span>
        </button>
        {menu && (
          <div className="menu profile-menu">
            <div className="menu-label">{t("Аккаунты")}</div>
            {lib.accounts.map((a) => (
              <div key={a.user_id} className={`acc-row ${a.active ? "active" : ""}`}>
                <button
                  className="acc-main"
                  onClick={() => { setMenu(false); lib.switchAccount(a.user_id); }}
                >
                  <Avatar photo={a.photo} name={a.name} size={26} />
                  <span className="acc-name">{a.name || `id${a.user_id}`}</span>
                  {a.active && <Check size={15} className="acc-check" />}
                </button>
                {!a.active && (
                  <button
                    className="acc-remove"
                    aria-label={t("Убрать аккаунт")}
                    title={t("Убрать аккаунт")}
                    onClick={() => lib.removeAccount(a.user_id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button onClick={() => { setMenu(false); lib.addAccount(); }}><UserPlus size={16} /> {t("Добавить аккаунт")}</button>
            <div className="menu-sep" />
            <button onClick={() => { setMenu(false); ui.navigate({ name: "settings" }); }}><Settings size={16} /> {t("Настройки")}</button>
            <button onClick={() => { setMenu(false); lib.logout(); }}><LogOut size={16} /> {t("Выйти из аккаунта")}</button>
          </div>
        )}
      </div>
    </aside>
  );
}
