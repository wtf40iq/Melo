import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { FileText, ShieldCheck, X } from "lucide-react";
import { legal } from "../legal";
import { useSettings } from "../store/settings";

/** Окно с соглашением и политикой конфиденциальности. */
export function LegalDialog({ doc, onClose }: { doc: "terms" | "privacy"; onClose: () => void }) {
  const s = useSettings();
  const [tab, setTab] = useState(doc);
  const docs = legal(s.lang);
  const d = docs[tab];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upd-card legal-card" role="dialog" aria-label={d.title}>
        <button className="icon-btn sm upd-close" onClick={onClose} aria-label={s.t("Закрыть")}><X size={16} /></button>
        <div className="segmented legal-tabs">
          <button className={tab === "terms" ? "active" : ""} onClick={() => setTab("terms")}><FileText size={14} /> {docs.terms.title}</button>
          <button className={tab === "privacy" ? "active" : ""} onClick={() => setTab("privacy")}><ShieldCheck size={14} /> {docs.privacy.title}</button>
        </div>
        <div className="legal-body" key={tab}>
          <h3>{d.title}</h3>
          {d.sections.map((sec) => (
            <section key={sec.h}>
              <b>{sec.h}</b>
              {sec.p.map((p, i) => <p key={i}>{p}</p>)}
            </section>
          ))}
        </div>
        <button className="btn primary self-start" onClick={onClose}>{s.t("Понятно")}</button>
      </div>
    </div>,
    document.body,
  );
}
