import { Logo } from "./Logo";
import { ChevronLeft, ChevronRight, Minus, Search, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "../api";
import { useT } from "../store/settings";
const win = () => (inTauri ? getCurrentWindow() : null);

type Props = {
  query: string;
  onQuery: (q: string) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  showSearch?: boolean;
};

export function TitleBar({ query, onQuery, canBack, canForward, onBack, onForward, showSearch = true }: Props) {
  const t = useT();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <Logo size={26} />
        Melo
      </div>

      {showSearch && <>
      <div className="titlebar-nav">
        <button className="icon-btn" disabled={!canBack} onClick={onBack} aria-label={t("Назад")}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn" disabled={!canForward} onClick={onForward} aria-label={t("Вперёд")}>
          <ChevronRight size={18} />
        </button>
      </div>

      <label className="search">
        <Search size={16} />
        <input
          id="global-search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("Треки, исполнители, плейлисты")}
          spellCheck={false}
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery("")} aria-label={t("Очистить")}>
            <X size={14} />
          </button>
        )}
      </label>
      </>}

      <div className="spacer" data-tauri-drag-region />

      <div className="window-controls">
        <button onClick={() => win()?.minimize()} aria-label={t("Свернуть")}>
          <Minus size={16} />
        </button>
        <button onClick={() => win()?.toggleMaximize()} aria-label={t("Развернуть")}>
          <Square size={13} />
        </button>
        <button className="close" onClick={() => win()?.close()} aria-label={t("Закрыть")}>
          <X size={17} />
        </button>
      </div>
    </header>
  );
}
