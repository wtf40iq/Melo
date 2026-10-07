// Одноразовый показ кода восстановления пароля (после регистрации, сброса или по запросу).
import { createPortal } from "react-dom";
import { useState } from "react";
import { Check, Copy, Download, KeyRound } from "lucide-react";
import { useT } from "../store/settings";

export function RecoveryCodeDialog({ code, login, onClose }: { code: string; login: string; onClose: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const text = `Melo — ${t("код восстановления")}\n${t("Логин")}: ${login}\n${code}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "melo-recovery.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return createPortal(
    <div className="upd-backdrop">
      <div className="upd-card dialog-card" role="dialog" aria-label={t("Код восстановления")}>
        <span className="upd-icon"><KeyRound size={22} /></span>
        <h3>{t("Сохраните код восстановления")}</h3>
        <p className="muted">{t("Если забудете пароль, по этому коду можно задать новый. Код показывается один раз — без него и без привязанного ВК доступ к аккаунту не вернуть.")}</p>
        <code className="recovery-code">{code}</code>
        <div className="row-gap">
          <button className="btn secondary sm-btn" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? "Скопировано" : "Копировать")}</button>
          <button className="btn secondary sm-btn" onClick={download}><Download size={14} /> {t("Сохранить в файл")}</button>
        </div>
        <label className={`terms-check ${saved ? "on" : ""}`}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span className="terms-box">{saved && <Check size={13} strokeWidth={3} />}</span>
          <span>{t("Я сохранил код")}</span>
        </label>
        <div className="row-gap upd-actions">
          <button className="btn primary" disabled={!saved} onClick={onClose}>{t("Готово")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
