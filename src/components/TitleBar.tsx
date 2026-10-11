import { Logo } from "./Logo";
import { ChevronLeft, ChevronRight, History, Minus, Search, SlidersHorizontal, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import { searchHistory, useSearchHistory } from "../store/history";
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
  /** Открыть точный поиск */
  onDeep?: () => void;
};

export function TitleBar({ query, onQuery, canBack, canForward, onBack, onForward, showSearch = true, onDeep }: Props) {
  const history = useSearchHistory();
  const [focus, setFocus] = useState(false);
  const [hl, setHl] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const shown = history.filter((h) => !q || (h.toLowerCase().includes(q) && h.toLowerCase() !== q)).slice(0, 8);
  const open = focus && shown.length > 0;
  const pick = (h: string) => { onQuery(h); setFocus(false); inputRef.current?.blur(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (open && hl >= 0 && shown[hl]) { e.preventDefault(); pick(shown[hl]); }
      else if (query.trim()) { searchHistory.add(query); setFocus(false); }
    } else if (e.key === "ArrowDown" && open) { e.preventDefault(); setHl((i) => (i + 1) % shown.length); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); setHl((i) => (i <= 0 ? shown.length - 1 : i - 1)); }
    else if (e.key === "Escape") { setFocus(false); inputRef.current?.blur(); }
  };
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
          ref={inputRef}
          id="global-search"
          type="text"
          autoComplete="off"
          autoCorrect="off"
          name="melo-q"
          value={query}
          onFocus={() => { setFocus(true); setHl(-1); }}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          onKeyDown={onKey}
          onChange={(e) => { onQuery(e.target.value); setHl(-1); setFocus(true); }}
          placeholder={t("Треки, исполнители, плейлисты")}
          spellCheck={false}
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery("")} aria-label={t("Очистить")}>
            <X size={14} />
          </button>
        )}
        {onDeep && (
          <button className="search-deep" onClick={(e) => { e.preventDefault(); onDeep(); }} aria-label={t("Точный поиск")} data-tip={t("Точный поиск")}>
            <SlidersHorizontal size={14} />
          </button>
        )}
        {open && (
          <div className="search-history" onMouseDown={(e) => e.preventDefault()}>
            <div className="sh-head">
              <span>{t("Недавние запросы")}</span>
              <button className="link-btn" onClick={() => searchHistory.clear()}>{t("Очистить всё")}</button>
            </div>
            {shown.map((h, i) => (
              <div key={h} className={`sh-item ${i === hl ? "hl" : ""}`} onMouseEnter={() => setHl(i)}>
                <button className="sh-text" onClick={() => pick(h)}><History size={14} /> <span>{h}</span></button>
                <button className="sh-del" onClick={() => searchHistory.remove(h)} aria-label={t("Удалить из истории")}><X size={13} /></button>
              </div>
            ))}
          </div>
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
