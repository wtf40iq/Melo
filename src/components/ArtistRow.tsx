import { User } from "lucide-react";
import { useUi } from "../store/ui";
import { Artist } from "../types";

/** Горизонтальный ряд исполнителей с круглыми фото. */
export function ArtistRow({ items }: { items: Artist[] }) {
  const ui = useUi();
  return (
    <div className="artist-row">
      {items.map((a, i) => (
        <button key={`${a.id ?? a.name}-${i}`} className="artist-chip" style={{ ["--i" as string]: i }} onClick={() => ui.navigate({ name: "artist", artist: a })}>
          <span className="artist-ava">{a.photo ? <img src={a.photo} alt="" loading="lazy" /> : <User size={30} />}</span>
          <b>{a.name}</b>
        </button>
      ))}
    </div>
  );
}
