import { useEffect, useRef, useState } from "react";
import { FolderPlus, HardDriveDownload, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useT } from "../store/settings";
import { errorText, useUi } from "../store/ui";
import { OfflinePlaylist } from "../types";
import { Cover } from "./Cover";
import { OfflineDialog } from "./OfflineDialog";

const AUDIO = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|wma|alac|aiff?)$/i;
/** Музыка или папка (у папки обычно нет расширения) */
const looksUseful = (paths: string[]) => paths.some((p) => AUDIO.test(p) || !/\.[a-z0-9]{2,5}$/i.test(p));
export const OFFLINE_CHANGED = "melo-offline-changed";

/**
 * Перетаскивание музыки из проводника в окно Melo.
 * На странице офлайн-плейлиста файлы сразу попадают в него, в остальных местах — спрашиваем куда
 * (или предлагаем создать плейлист, если их ещё нет).
 */
export function OfflineDrop() {
  const ui = useUi();
  const t = useT();
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const [lists, setLists] = useState<OfflinePlaylist[] | null>(null);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const route = useRef(ui.route);
  route.current = ui.route;

  const add = async (id: string, paths: string[]) => {
    setBusy(true);
    try {
      const n = await api.offlineAddPaths(id, paths);
      ui.toast(n ? "Добавлено файлов: {n}" : "Среди файлов нет музыки", { n });
      window.dispatchEvent(new Event(OFFLINE_CHANGED));
      if (n && !(route.current.name === "offline-pl" && route.current.id === id)) ui.navigate({ name: "offline-pl", id });
    } catch (e) {
      ui.toast(errorText(e));
    } finally {
      setBusy(false);
      setPending(null);
      setCreate(false);
    }
  };

  const dropped = async (paths: string[]) => {
    setOver(false);
    if (!paths.length || !looksUseful(paths)) return;
    const r = route.current;
    if (r.name === "offline-pl") return add(r.id, paths);
    setPending(paths);
    try {
      const l = await api.offlineList();
      setLists(l);
      if (!l.length) setCreate(true);
    } catch (e) {
      ui.toast(errorText(e));
      setPending(null);
    }
  };
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) {
      let un: (() => void) | undefined;
      let alive = true;
      import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter") setOver(looksUseful(p.paths));
          else if (p.type === "leave") setOver(false);
          else if (p.type === "drop") droppedRef.current(p.paths);
        }).then((f) => (alive ? (un = f) : f())),
      ).catch(() => {});
      return () => { alive = false; un?.(); };
    }
    // В браузере (демо) — обычный HTML-drop, вместо путей имена файлов
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => { if (has(e)) { e.preventDefault(); setOver(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); droppedRef.current([...(e.dataTransfer?.files ?? [])].map((f) => f.name)); };
    window.addEventListener("dragover", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, []);

  const inPl = ui.route.name === "offline-pl";
  return (
    <>
      {over && createPortal(
        <div className="drop-zone"><div>
          <HardDriveDownload size={40} />
          <b>{t(inPl ? "Отпустите, чтобы добавить в этот плейлист" : "Отпустите, чтобы добавить в офлайн")}</b>
          <span className="muted">{t("Музыка скопируется в папку Offline")}</span>
        </div></div>,
        document.body,
      )}
      {pending && !create && lists && createPortal(
        <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && setPending(null)}>
          <div className="upd-card dialog-card off-dialog" role="dialog">
            <span className="upd-icon"><HardDriveDownload size={22} /></span>
            <h3>{t("Куда добавить музыку?")}</h3>
            <p className="muted">{t("Файлов: {n}", { n: pending.length })}</p>
            <div className="drop-pick">
              {lists.map((l) => (
                <button key={l.id} disabled={busy} onClick={() => add(l.id, pending)}>
                  <Cover seed={l.title} src={l.cover} size={36} radius={6} />
                  <span>{l.title}</span>
                  <small>{l.count}</small>
                </button>
              ))}
            </div>
            <div className="row-gap upd-actions">
              <button className="btn primary" disabled={busy} onClick={() => setCreate(true)}>
                {busy ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />} {t("Новый плейлист")}
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => setPending(null)}>{t("Отмена")}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {pending && create && (
        <OfflineDialog
          onClose={() => { setCreate(false); if (!lists?.length) setPending(null); }}
          onSave={async (title, description) => {
            try {
              const id = await api.offlineCreate(title, description);
              await add(id, pending);
            } catch (e) {
              ui.toast(errorText(e));
            }
          }}
        />
      )}
    </>
  );
}
