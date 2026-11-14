import { useEffect } from "react";
import { api } from "../api";
import { useFollowed, updateFollowedKnown } from "../store/follow";
import { useT } from "../store/settings";
import { useUi } from "../store/ui";

/** Раз в полчаса проверяет новые треки у артистов, на которых подписались. */
export function NewReleases() {
  const followed = useFollowed();
  const ui = useUi();
  const t = useT();

  useEffect(() => {
    if (!followed.length) return;
    let alive = true;
    const check = async () => {
      for (const f of followed.slice(0, 12)) {
        if (!alive) return;
        const list = await api.artistTracks({ id: f.id, name: f.name }).catch(() => []);
        if (!alive || !list.length) continue;
        const ids = list.slice(0, 10).map((x) => x.id);
        if (!f.known.length) {
          updateFollowedKnown(f.key, ids);
          continue;
        }
        const fresh = list.filter((x) => !f.known.includes(x.id)).slice(0, 2);
        if (fresh.length) {
          updateFollowedKnown(f.key, [...ids, ...f.known]);
          ui.toast(t("У {name} новый трек: {title}", { name: f.name, title: fresh[0].title }), undefined, {
            action: { label: t("Открыть"), run: () => ui.navigate({ name: "artist", artist: { id: f.id, name: f.name } }) },
          });
        }
      }
    };
    const first = window.setTimeout(check, 10_000);
    const timer = window.setInterval(check, 30 * 60_000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed.length]);

  return null;
}
