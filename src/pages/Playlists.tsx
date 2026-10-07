import { useState } from "react";
import { Cloud, Link2, Plus } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { useAccount } from "../store/account";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

export function Playlists() {
  const lib = useLibrary();
  const ui = useUi();
  const { t } = useSettings();
  const acc = useAccount();
  const [creating, setCreating] = useState<false | "melo" | "vk">(false);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState("");

  const create = async () => {
    const name = title.trim();
    const where = creating;
    setCreating(false);
    setTitle("");
    if (!name || !where) return;
    const pl = await lib.createPlaylist(name, where === "melo");
    if (pl) ui.navigate({ name: "playlist", playlist: pl });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("Плейлисты")}</h1>
        <div className="row-gap">
          {creating ? (
            <input
              className="new-pl-input"
              autoFocus
              placeholder={t(creating === "melo" ? "Название плейлиста Melo" : "Название плейлиста в ВК")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
              onBlur={create}
            />
          ) : (
            <>
              {acc.user && (
                <button className="btn secondary" onClick={() => setImporting(true)} data-tip={t("Плейлист Melo, которым с вами поделились")}>
                  <Link2 size={17} /> {t("Импорт по ссылке")}
                </button>
              )}
              {acc.user && (
                <button className="btn primary" onClick={() => setCreating("melo")} data-tip={t("Хранится в аккаунте Melo")}>
                  <Cloud size={17} /> {t("Плейлист Melo")}
                </button>
              )}
              <button className={`btn ${acc.user ? "secondary" : "primary"}`} onClick={() => setCreating("vk")}>
                <Plus size={17} /> {t(acc.user ? "Плейлист в ВК" : "Создать плейлист")}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="lib-sub"><span>{t("Плейлистов: {n}", { n: lib.playlists.length })}</span></div>
      {lib.playlistsLoading ? <Loading /> : lib.playlists.length ? <PlaylistGrid items={lib.playlists} /> :
        <Empty title={t("Плейлистов пока нет")} text={t("Создайте первый кнопкой «Создать плейлист»")} />}
      {importing && (
        <Dialog title="Импорт плейлиста" text={t("Вставьте ссылку на плейлист Melo")} input="" confirm="Импортировать"
          onClose={() => setImporting(false)}
          onConfirm={async (v) => {
            const pl = await lib.importPlaylist(v);
            if (pl) { setImporting(false); ui.navigate({ name: "playlist", playlist: pl }); }
          }} />
      )}
    </div>
  );
}
