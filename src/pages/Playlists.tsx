import { useState } from "react";
import { Plus } from "lucide-react";
import { PlaylistGrid } from "../components/PlaylistGrid";
import { Empty, Loading } from "../components/Loading";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

export function Playlists() {
  const lib = useLibrary();
  const ui = useUi();
  const { t } = useSettings();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const create = async () => {
    const name = title.trim();
    setCreating(false);
    setTitle("");
    if (!name) return;
    const pl = await lib.createPlaylist(name);
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
              placeholder={t("Название плейлиста")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
              onBlur={create}
            />
          ) : (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={17} /> {t("Создать плейлист")}
            </button>
          )}
        </div>
      </div>
      <div className="lib-sub"><span>{t("Плейлистов: {n}", { n: lib.playlists.length })}</span></div>
      {lib.playlistsLoading ? <Loading /> : lib.playlists.length ? <PlaylistGrid items={lib.playlists} /> :
        <Empty title={t("Плейлистов пока нет")} text={t("Создайте первый кнопкой «Создать плейлист»")} />}
    </div>
  );
}
