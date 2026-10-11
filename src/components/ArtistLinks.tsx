import { Fragment } from "react";
import { useUi } from "../store/ui";
import { Artist, Track } from "../types";
import { api } from "../api";
import { trackArtists } from "../api/match";

let hoverTimer = 0;
/** Наводим на имя — заранее грузим страницу артиста, чтобы она открылась мгновенно. */
function prefetch(a: Artist) {
  clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    api.artistTracks(a).catch(() => {});
    api.artistInfo(a).catch(() => {});
    api.artistAlbums(a).catch(() => {});
  }, 180);
}

/** Исполнители трека — каждый кликается и открывает свою страницу, как в ВК. */
export function ArtistLinks({ track, className = "artist-link" }: { track: Track; className?: string }) {
  const ui = useUi();
  if (track.id.startsWith("off:")) return <span className="artist-links">{track.artist}</span>;
  const list = track.artists?.length ? track.artists : trackArtists(track).map((name) => ({ name, id: undefined as string | undefined }));
  return (
    <span className="artist-links">
      {list.map((a, i) => (
        <Fragment key={`${a.id ?? a.name}-${i}`}>
          {i > 0 && <span className="artist-sep">, </span>}
          <button
            className={className}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseEnter={() => prefetch({ id: a.id, name: a.name })}
            onClick={(e) => { e.stopPropagation(); ui.navigate({ name: "artist", artist: { id: a.id, name: a.name } }); }}
          >
            {a.name}
          </button>
        </Fragment>
      ))}
    </span>
  );
}
