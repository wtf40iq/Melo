import { Play } from "lucide-react";
import { Playlist } from "../types";
import { Cover } from "./Cover";
import { useSettings } from "../store/settings";

export function Card({ item, onOpen, onPlay, index = 0 }: { item: Playlist; onOpen: () => void; onPlay: () => void; index?: number }) {
  const { t, tracks } = useSettings();
  return (
    <div className="card" style={{ ["--i" as string]: Math.min(index, 24) }} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="card-cover">
        <Cover seed={item.title} src={item.cover} radius={10} fill />
        <button
          className="card-play"
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          aria-label={`${t("Играть")}: ${item.title}`}
        >
          <Play size={20} fill="currentColor" className="nudge" />
        </button>
      </div>
      <b>{item.title}</b>
      <small>{item.subtitle || tracks(item.count)}</small>
    </div>
  );
}
