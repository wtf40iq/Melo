import { Download, Loader2, X } from "lucide-react";
import { useUpdate } from "../store/update";
import { useT } from "../store/settings";

const mb = (n: number) => `${(n / 1048576).toFixed(1)} МБ`;

/** Окно «Доступна новая версия». */
export function UpdateDialog() {
  const u = useUpdate();
  const t = useT();
  if (!u.open || !u.info) return null;
  const downloading = u.status === "downloading";
  const later = () => {
    localStorage.setItem("melo.update.skip", u.info!.version);
    u.setOpen(false);
  };
  return (
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !downloading && later()}>
      <div className="upd-card" role="dialog" aria-label={t("Доступно обновление")}>
        {!downloading && (
          <button className="icon-btn sm upd-close" onClick={later} aria-label={t("Закрыть")}><X size={16} /></button>
        )}
        <span className="upd-icon"><Download size={22} /></span>
        <h3>{t("Доступна версия {v}", { v: u.info.version })}</h3>
        <p className="muted">{t("Сейчас установлена {v}. Обновление скачается с GitHub и Melo перезапустится.", { v: u.info.current })}</p>
        {u.info.notes.trim() && <div className="upd-notes">{u.info.notes.trim()}</div>}
        {downloading ? (
          <div className="upd-progress">
            <div className="upd-bar"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>
            <small>{t("Скачивание…")} {Math.round(u.progress * 100)}%{u.info.size ? ` · ${mb(u.info.size)}` : ""}</small>
          </div>
        ) : (
          <>
            {u.status === "error" && <p className="upd-error">{u.error}</p>}
            <div className="row-gap upd-actions">
              <button className="btn primary" onClick={u.install}>
                {u.status === "error" ? t("Попробовать снова") : t("Обновить сейчас")}
              </button>
              <button className="btn secondary" onClick={later}>{t("Позже")}</button>
            </div>
          </>
        )}
        {downloading && <Loader2 className="spin upd-spin" size={16} />}
      </div>
    </div>
  );
}
