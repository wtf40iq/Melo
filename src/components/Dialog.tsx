import { createPortal } from "react-dom";
import { ReactNode, useEffect, useState } from "react";
import { useT } from "../store/settings";

type Props = {
  title: string;
  text?: string;
  icon?: ReactNode;
  confirm: string;
  danger?: boolean;
  /** Если задано — в окне есть поле ввода с этим значением. */
  input?: string;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
};

/** Небольшое окно подтверждения или ввода. */
export function Dialog({ title, text, icon, confirm, danger, input, onConfirm, onClose }: Props) {
  const t = useT();
  const [value, setValue] = useState(input ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const ok = async () => {
    if (busy || (input != null && !value.trim())) return;
    setBusy(true);
    try { await onConfirm(value.trim()); } finally { setBusy(false); }
  };
  return createPortal(
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upd-card dialog-card" role="dialog" aria-label={t(title)}>
        {icon && <span className={`upd-icon ${danger ? "danger" : ""}`}>{icon}</span>}
        <h3>{t(title)}</h3>
        {text && <p className="muted">{text}</p>}
        {input != null && (
          <input className="dialog-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} maxLength={128} />
        )}
        <div className="row-gap upd-actions">
          <button className={`btn ${danger ? "danger" : "primary"}`} disabled={busy} onClick={ok}>{t(confirm)}</button>
          <button className="btn secondary" onClick={onClose}>{t("Отмена")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
