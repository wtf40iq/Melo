import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, Copy, ListEnd, ListPlus, ListStart, ListX, Plus, Radio, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { errorText, useUi } from "../store/ui";
import { Track } from "../types";
import { useT } from "../store/settings";

type Props = { track: Track; x: number; y: number; onClose: () => void; onRemove?: () => void; removeLabel?: string };

export function TrackMenu({ track, x, y, onClose, onRemove, removeLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"main" | "playlists">("main");
  const [pos, setPos] = useState({ left: x, top: y });
  const lib = useLibrary();
  const player = usePlayer();
  const ui = useUi();
  const mine = lib.isMine(track);
  const t = useT();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
    });
  }, [x, y, view]);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const timer = setTimeout(() => window.addEventListener("mousedown", close));
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => { fn(); onClose(); };
  const editable = lib.playlists.filter((p) => p.editable);

  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {view === "main" ? (
        <>
          <button onClick={act(() => player.playNext(track))}><ListStart size={16} /> {t("Играть следующим")}</button>
          <button onClick={act(() => player.enqueue(track))}><ListEnd size={16} /> {t("В конец очереди")}</button>
          <div className="menu-sep" />
          <button onClick={act(() => lib.toggleMine(track))}>
            {mine ? <><Trash2 size={16} /> {t("Удалить из моей музыки")}</> : <><Plus size={16} /> {t("Добавить в мою музыку")}</>}
          </button>
          <button onClick={() => setView("playlists")}><ListPlus size={16} /> {t("Добавить в плейлист…")}</button>
          {onRemove && (
            <button className="danger" onClick={act(onRemove)}><ListX size={16} /> {t(removeLabel ?? "Удалить из плейлиста")}</button>
          )}
          <button onClick={act(() => api.similar(track).then((list) => {
            if (!list.length) return ui.toast("Похожих треков не нашлось");
            player.playList([track, ...list]);
            ui.toast("Играет похожее на «{name}»", { name: track.title });
          }).catch((e) => ui.toast(errorText(e))))}><Radio size={16} /> {t("Слушать похожее")}</button>
          <div className="menu-sep" />
          <button onClick={act(() => ui.setQuery(track.artist))}><Search size={16} /> {t("Найти исполнителя")}</button>
          <button onClick={act(() => navigator.clipboard?.writeText(`${track.artist} — ${track.title}`))}>
            <Copy size={16} /> {t("Скопировать название")}
          </button>
        </>
      ) : (
        <>
          <button className="menu-back" onClick={() => setView("main")}><ChevronLeft size={16} /> {t("Назад")}</button>
          <div className="menu-sep" />
          <div className="menu-scroll">
            {editable.length === 0 && <span className="menu-empty">{t("Нет своих плейлистов")}</span>}
            {editable.map((pl) => (
              <button
                key={pl.id}
                onClick={act(() =>
                  api.addToPlaylist(track, pl).then(() => ui.toast("Добавлено в «{name}»", { name: pl.title })).catch((e) => ui.toast(errorText(e))),
                )}
              >
                {pl.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
