import { Undo2 } from "lucide-react";
import { useT } from "../store/settings";
import { useUi } from "../store/ui";

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  const t = useT();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div
          key={x.id}
          className={`toast ${x.action ? "with-action" : ""}`}
          style={{ ["--life" as string]: `${x.duration}ms` }}
        >
          <span>{t(x.text, x.params)}</span>
          {x.action && (
            <button
              className="toast-action"
              onClick={() => { x.action!.run(); dismissToast(x.id); }}
            >
              <Undo2 size={15} /> {t(x.action.label)}
            </button>
          )}
          {x.action && <i className="toast-timer" />}
        </div>
      ))}
    </div>
  );
}
