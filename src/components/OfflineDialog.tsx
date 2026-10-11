import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, Pencil } from "lucide-react";
import { useT } from "../store/settings";

/** Создание и изменение офлайн-плейлиста: название и описание. */
export function OfflineDialog({ edit, title: t0 = "", description: d0 = "", onSave, onClose }: {
  edit?: boolean;
  title?: string;
  description?: string;
  onSave: (title: string, description: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(t0);
  const [desc, setDesc] = useState(d0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const ok = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    try { await onSave(title.trim(), desc.trim()); } finally { setBusy(false); }
  };
  return createPortal(
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upd-card dialog-card off-dialog" role="dialog">
        <span className="upd-icon">{edit ? <Pencil size={22} /> : <FolderPlus size={22} />}</span>
        <h3>{t(edit ? "Изменить офлайн-плейлист" : "Новый офлайн-плейлист")}</h3>
        <input className="dialog-input" autoFocus placeholder={t("Название")} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} maxLength={80} />
        <textarea className="dialog-input off-desc" placeholder={t("Описание (необязательно)")} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} rows={3} />
        {!edit && <p className="muted off-note">{t("В папке Offline появится папка с этим названием — кладите туда музыку прямо в проводнике или кнопкой «Добавить файлы»")}</p>}
        <div className="row-gap upd-actions">
          <button className="btn primary" disabled={busy || !title.trim()} onClick={ok}>{t(edit ? "Сохранить" : "Создать")}</button>
          <button className="btn secondary" onClick={onClose}>{t("Отмена")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
