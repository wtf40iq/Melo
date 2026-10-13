import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, WandSparkles } from "lucide-react";
import { uncensoredMark, censoredMark } from "../api/match";
import { api } from "../api";
import { antiBlur } from "../store/antiblur";
import { usePlayer } from "../store/player";
import { useT } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { formatTime, Track } from "../types";
import { Cover } from "./Cover";

/**
 * Анти-блюр: в ВК у многих песен замазаны слова. Ищем другие загрузки той же песни
 * (то же название, исполнитель и длина) и подменяем играющий трек, не сбивая позицию.
 */
export function AntiBlur() {
  const p = usePlayer();
  const ui = useUi();
  const t = useT();
  const cur = p.current;
  const orig = cur?.blurOrig ?? cur;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<{ id: string; items: Track[] } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!box.current?.contains(el) && !btn.current?.contains(el)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [open]);
  // Сменился трек — список вариантов больше не актуален
  useEffect(() => { if (orig && list && list.id !== orig.id) setOpen(false); }, [orig?.id]);

  if (!cur || !orig || cur.id.startsWith("off:")) return null;

  const pick = (v: Track) => {
    if (v.id === cur.id) return;
    if (v.id === orig.id) {
      antiBlur.forget(orig.id);
      p.swapCurrent(orig);
      ui.toast("Вернул оригинал");
    } else {
      antiBlur.set(orig, v);
      p.swapCurrent({ ...v, blurOrig: orig });
    }
  };

  const run = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (list?.id === orig.id) return;
    setBusy(true);
    try {
      const items = await api.variants(orig);
      setList({ id: orig.id, items });
      if (!items.length) return;
      // Сразу ставим лучший вариант, если ещё ничего не выбрано
      if (!cur.blurOrig) {
        antiBlur.set(orig, items[0]);
        p.swapCurrent({ ...items[0], blurOrig: orig });
        ui.toast("Играет другая версия «{name}» — выберите в списке, если эта не подошла", { name: orig.title });
      }
    } catch (e) {
      ui.toast(errorText(e));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const rows = list?.id === orig.id ? [orig, ...list.items] : [];
  return (
    <>
      <button
        ref={btn}
        className={`icon-btn ${cur.blurOrig ? "on" : ""} ${busy ? "busy" : ""}`}
        onClick={run}
        aria-label={t("Анти-блюр")}
        data-tip={open ? undefined : cur.blurOrig ? t("Анти-блюр: играет другая версия") : t("Анти-блюр — найти версию без замазанных слов")}
      >
        {busy ? <Loader2 size={18} className="spin" /> : <WandSparkles size={18} />}
      </button>
      {open && (
        <div ref={box} className="eq-pop ab-pop" role="dialog" aria-label={t("Анти-блюр")}>
          <div className="eq-pop-head">
            <h3>{t("Анти-блюр")}</h3>
            <span className="grow" />
            {cur.blurOrig && (
              <button className="btn secondary ab-orig" onClick={() => pick(orig)}><RotateCcw size={14} /> {t("Оригинал")}</button>
            )}
          </div>
          <p className="muted ab-note">{t("Другие загрузки этой песни в ВК. Melo запомнит выбор и в следующий раз сразу включит его.")}</p>
          {busy ? (
            <div className="ab-empty"><Loader2 size={18} className="spin" /> {t("Ищу версии…")}</div>
          ) : rows.length <= 1 ? (
            <div className="ab-empty">{t("Других версий этой песни не нашлось")}</div>
          ) : (
            <div className="ab-list">
              {rows.map((v, i) => (
                <button key={v.id} className={`ab-row ${v.id === cur.id ? "on" : ""}`} onClick={() => pick(v)}>
                  <Cover seed={v.title} src={v.cover} size={36} radius={6} />
                  <span className="ab-text">
                    <b>{v.title}{v.explicit && <em className="explicit">E</em>}</b>
                    <small>{v.artist}{i === 0 ? ` · ${t("оригинал")}` : ""}{uncensoredMark(v) ? ` · ${t("Без цензуры")}` : censoredMark(v) ? ` · ${t("С цензурой")}` : ""}</small>
                  </span>
                  <span className="ab-time">{formatTime(v.duration)}</span>
                  <span className="ab-check">{v.id === cur.id && <Check size={16} />}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
