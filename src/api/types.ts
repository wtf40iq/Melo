import { Artist, ArtistPage, Lyrics, OfflinePlaylist, Page, Playlist, Profile, SearchExtras, Track } from "../types";

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
  /** Вход в окне ВК внутри приложения; fresh — заново выбрать аккаунт. */
  login(fresh?: boolean): Promise<Profile>;
  /** Вход через браузер пользователя: ждём адрес с ключом в буфере обмена. */
  browserLogin(): Promise<Profile>;
  /** Вставленный вручную адрес страницы после «Разрешить». */
  browserSubmit(text: string): Promise<number | null>;
  /** Вход по номеру/почте и паролю. Профиль приходит, когда state === "ok". */
  directLogin(p: DirectLoginParams): Promise<DirectAuth & { profile?: Profile }>;
  browserReopen(): Promise<void>;
  browserCancel(): Promise<void>;
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
  /** Поиск треков (быстрый, отдельно от остального). */
  searchTracks(q: string): Promise<Track[]>;
  /** Плейлисты и исполнители по запросу. */
  searchExtras(q: string): Promise<SearchExtras>;
  /** Точный поиск: исполнитель и название отдельно. */
  deepSearch(artist: string, title: string): Promise<Track[]>;
  /** Другие загрузки той же песни — для «Анти-блюра». */
  variants(t: Track): Promise<Track[]>;
  /** Страница исполнителя: треки и альбомы. */
  artist(a: Artist): Promise<ArtistPage>;
  /** То же по частям — чтобы страница показывалась сразу. */
  artistInfo(a: Artist): Promise<Artist>;
  artistTracks(a: Artist): Promise<Track[]>;
  artistAlbums(a: Artist): Promise<Playlist[]>;

  // ---------- Офлайн ----------
  offlineRoot(): Promise<string>;
  offlineList(): Promise<OfflinePlaylist[]>;
  offlinePlaylist(id: string): Promise<OfflinePlaylist>;
  offlineTracks(id: string): Promise<Track[]>;
  offlineCreate(title: string, description: string): Promise<string>;
  offlineUpdate(id: string, title: string, description: string): Promise<void>;
  offlineDelete(id: string): Promise<void>;
  offlineDeleteTrack(t: Track): Promise<void>;
  /** Выбрать файлы на компьютере; возвращает, сколько добавлено. */
  offlineAddFiles(id: string): Promise<number>;
  offlineAddPaths(id: string, paths: string[]): Promise<number>;
  offlinePickCover(id: string): Promise<boolean>;
  offlineOpen(id?: string): Promise<void>;
  /** Добавить в «Мою музыку». Возвращает копию трека с новым id. */
  add(t: Track): Promise<Track>;
  remove(t: Track): Promise<void>;
  /** Вернуть только что удалённый трек (ВК хранит его какое-то время). */
  undoRemove(t: Track): Promise<void>;
  addToPlaylist(t: Track, pl: Playlist): Promise<void>;
  createPlaylist(title: string): Promise<Playlist>;
  deletePlaylist(pl: Playlist): Promise<void>;
  renamePlaylist(pl: Playlist, title: string): Promise<void>;
  removeFromPlaylist(t: Track, pl: Playlist): Promise<void>;
  /** Текст песни; null — текста нет. */
  lyrics(t: Track): Promise<Lyrics | null>;
  /** Похожие треки. */
  similar(t: Track): Promise<Track[]>;
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

export type DirectLoginParams = { login: string; password: string; code?: string; sms?: boolean; captchaSid?: string; captchaKey?: string };
export type DirectAuth = { state: "ok" | "code" | "captcha" | "error"; uid?: number; sid?: string; img?: string; phone?: string; kind?: "sms" | "app"; msg?: string };
