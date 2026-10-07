import { api } from "../api";
import { usePlayer } from "../store/player";
import { errorText, useUi } from "../store/ui";
import { Playlist } from "../types";
import { Card } from "./Card";

export function PlaylistGrid({ items }: { items: Playlist[] }) {
  const ui = useUi();
  const player = usePlayer();
  const play = async (pl: Playlist) => {
    try {
      const tracks = await api.playlistTracks(pl);
      if (!tracks.length) return ui.toast("Плейлист пуст");
      player.playList(tracks);
    } catch (e) {
      ui.toast(errorText(e));
    }
  };
  return (
    <div className="grid">
      {items.map((pl, i) => (
        <Card key={pl.id} index={i} item={pl} onOpen={() => ui.navigate({ name: "playlist", playlist: pl })} onPlay={() => play(pl)} />
      ))}
    </div>
  );
}
