import { Page, Playlist, Profile, Track } from "../types";

export type QrCode = { url: string; hash: string; expires_at: number };
export type QrStatus = {
  state: "waiting" | "scanned" | "need_code" | "declined" | "expired" | "accepted" | "incorrect" | "error" | "ok";
  raw: unknown;
};

export type Account = { user_id: number; name?: string; photo?: string; active: boolean };
export type AppInfo = { version: string; data_dir: string; stream: string; client?: string; api_version: string };

export interface MusicApi {
  demo: boolean;
  restore(): Promise<Profile | null>;
  login(): Promise<Profile>;
  /** Новый QR-код для входа через приложение ВК. */
  qrStart(): Promise<QrCode>;
  /** Статус QR-кода; при "ok" вход выполнен. */
  qrCheck(hash: string): Promise<QrStatus>;
  /** Отправить код, который показал телефон. */
  qrSubmit(hash: string, code: string): Promise<QrStatus>;
  /** Свежая ссылка на трек (ссылки ВК живут около суток). */
  refresh(t: Track): Promise<Track | null>;
  logout(): Promise<void>;
  myTracks(offset: number, count: number): Promise<Page<Track>>;
  myPlaylists(): Promise<Playlist[]>;
  playlistTracks(pl: Playlist): Promise<Track[]>;
  recommendations(): Promise<Track[]>;
  popular(genreId?: number): Promise<Track[]>;
  search(q: string): Promise<{ tracks: Track[]; playlists: Playlist[] }>;
  /** Добавить в «Мою музыку». Возвращает копию трека с новым id. */
  add(t: Track): Promise<Track>;
  remove(t: Track): Promise<void>;
  /** Вернуть только что удалённый трек (ВК хранит его какое-то время). */
  undoRemove(t: Track): Promise<void>;
  addToPlaylist(t: Track, pl: Playlist): Promise<void>;
  createPlaylist(title: string): Promise<Playlist>;
  /** Переставить трек в «Моей музыке»: соседи после перестановки. */
  reorder(t: Track, after?: Track, before?: Track): Promise<void>;
  accounts(): Promise<Account[]>;
  switchAccount(userId: number): Promise<void>;
  removeAccount(userId: number): Promise<void>;
  /** Выйти в экран входа, не удаляя текущий аккаунт (для добавления ещё одного). */
  detach(): Promise<void>;
  info(): Promise<AppInfo>;
  /** Превращает адрес трека в то, что можно отдать плееру. */
  streamUrl(url: string): string;
}
