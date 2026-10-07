// Слой поверх источника музыки (ВК): добавляет плейлисты Melo из облака
// и копирует лайки в избранное аккаунта Melo.
import { Playlist, Track } from "../types";
import { MusicApi } from "./types";
import { CloudPlaylist, fromRef, hasToken, melo, toRef } from "./melo";

const PREFIX = "melo_";
export const isCloud = (pl: Pick<Playlist, "id">) => pl.id.startsWith(PREFIX);
const cloudId = (pl: Pick<Playlist, "id">) => pl.id.slice(PREFIX.length);

export const cloudToPlaylist = (p: CloudPlaylist): Playlist => ({
  id: PREFIX + p.id,
  ownerId: 0,
  playlistId: 0,
  title: p.title,
  subtitle: "Melo",
  count: p.count,
  cover: p.cover ?? undefined,
  editable: true,
  cloud: true,
  shareSlug: p.share_slug,
});

export type CloudApi = MusicApi & {
  createCloudPlaylist(title: string): Promise<Playlist>;
  shareCloudPlaylist(pl: Playlist, enabled: boolean): Promise<Playlist>;
  importCloudPlaylist(link: string): Promise<Playlist>;
};

export function withCloud(base: MusicApi): CloudApi {
  const tracksOf = async (pl: Playlist) => (await melo.playlist(cloudId(pl))).tracks ?? [];
  const quiet = (p: Promise<unknown>) => p.catch(() => {});

  return {
    ...base,

    async myPlaylists() {
      const [cloud, own] = await Promise.all([
        hasToken() ? melo.playlists().catch(() => []) : Promise.resolve([] as CloudPlaylist[]),
        base.myPlaylists(),
      ]);
      return [...cloud.map(cloudToPlaylist), ...own];
    },

    async playlistTracks(pl) {
      if (!isCloud(pl)) return base.playlistTracks(pl);
      return (await tracksOf(pl)).map((r) => fromRef(r, base.demo));
    },

    async addToPlaylist(t, pl) {
      if (!isCloud(pl)) return base.addToPlaylist(t, pl);
      const tracks = await tracksOf(pl);
      if (tracks.some((x) => x.id === t.id)) return;
      await melo.updatePlaylist(cloudId(pl), { tracks: [...tracks, toRef(t)] });
    },

    async removeFromPlaylist(t, pl) {
      if (!isCloud(pl)) return base.removeFromPlaylist(t, pl);
      const tracks = await tracksOf(pl);
      await melo.updatePlaylist(cloudId(pl), { tracks: tracks.filter((x) => x.id !== t.id) });
    },

    async deletePlaylist(pl) {
      if (!isCloud(pl)) return base.deletePlaylist(pl);
      await melo.deletePlaylist(cloudId(pl));
    },

    async renamePlaylist(pl, title) {
      if (!isCloud(pl)) return base.renamePlaylist(pl, title);
      await melo.updatePlaylist(cloudId(pl), { title });
    },

    async createCloudPlaylist(title) {
      return cloudToPlaylist(await melo.createPlaylist(title));
    },

    async shareCloudPlaylist(pl, enabled) {
      return cloudToPlaylist(await melo.sharePlaylist(cloudId(pl), enabled));
    },

    async importCloudPlaylist(link) {
      return cloudToPlaylist(await melo.importPlaylist(link.trim()));
    },

    // Лайк в ВК → копия в избранном Melo (не мешает, если сервер недоступен)
    async add(t: Track) {
      const copy = await base.add(t);
      if (hasToken()) quiet(melo.addFavorite(toRef(t)));
      return copy;
    },

    async remove(t: Track) {
      await base.remove(t);
      if (hasToken()) quiet(melo.removeFavorite(t.artist, t.title));
    },

    async undoRemove(t: Track) {
      await base.undoRemove(t);
      if (hasToken()) quiet(melo.addFavorite(toRef(t)));
    },
  };
}
