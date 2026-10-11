export type Track = {
  id: string; // `${ownerId}_${audioId}`
  ownerId: number;
  audioId: number;
  accessKey?: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration: number;
  explicit?: boolean;
  url?: string;
  /** У трека есть текст в ВК */
  hasLyrics?: boolean;
  lyricsId?: number;
  /** Исполнители с id ВК — для перехода на страницу артиста */
  artists?: Artist[];
  /** Анти-блюр: оригинал, вместо которого играет эта версия */
  blurOrig?: Track;
};

export type Artist = { id?: string; name: string; photo?: string };

export type ArtistPage = { artist: Artist; tracks: Track[]; albums: Playlist[] };

/** Офлайн-плейлист — папка с музыкой рядом с Melo. */
export type OfflinePlaylist = { id: string; title: string; description: string; cover?: string; count: number };

export const isOffline = (t: Track) => t.id.startsWith("off:");

export type SearchExtras = { playlists: Playlist[]; artists: Artist[] };

export type Playlist = {
  id: string; // `${ownerId}_${playlistId}`
  ownerId: number;
  playlistId: number;
  accessKey?: string;
  title: string;
  subtitle: string;
  count: number;
  cover?: string;
  editable?: boolean;
};

export type Profile = { id: number; name: string; photo?: string };

export type Page<T> = { items: T[]; total: number };

export const formatTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Ключ для сравнения одинаковых треков с разными id (копии в «Моей музыке»). */
export const trackKey = (t: Track) => `${t.artist}|${t.title}`.toLowerCase().replace(/\s+/g, " ").trim();

export type Lyrics = { synced: boolean; lines: { time?: number; text: string }[] };
