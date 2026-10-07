import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Account } from "../api/types";
import { Playlist, Profile, Track, trackKey } from "../types";
import { errorText, useUi } from "./ui";

type LibraryState = {
  profile: Profile | null;
  booting: boolean;
  login: () => Promise<void>;
  /** Вызывается после успешного входа по QR. */
  finishLogin: () => Promise<void>;
  logout: () => Promise<void>;
  tracks: Track[];
  total: number;
  loadingTracks: boolean;
  loadMore: () => void;
  playlists: Playlist[];
  playlistsLoading: boolean;
  reloadPlaylists: () => void;
  isMine: (t: Track) => boolean;
  toggleMine: (t: Track) => Promise<void>;
  createPlaylist: (title: string) => Promise<Playlist | null>;
  /** Перенести трек в «Моей музыке» с позиции from на позицию to (навсегда, через ВК). */
  moveTrack: (from: number, to: number) => Promise<void>;
  accounts: Account[];
  reloadAccounts: () => void;
  switchAccount: (userId: number) => Promise<void>;
  removeAccount: (userId: number) => Promise<void>;
  /** Открыть экран входа для ещё одного аккаунта. */
  addAccount: () => Promise<void>;
  /** id аккаунта, к которому можно вернуться с экрана входа (если добавляем ещё один). */
  returnTo: number | null;
  cancelAdd: () => Promise<void>;
};

const Ctx = createContext<LibraryState | null>(null);
const PAGE = 200;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { toast } = useUi();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const reloadAccounts = useCallback(() => {
    api.accounts().then(setAccounts).catch(() => {});
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      toast(errorText(e));
      if (String(e).includes("not_authorized")) setProfile(null);
    },
    [toast],
  );

  const loadPage = useCallback(
    async (offset: number) => {
      setLoadingTracks(true);
      try {
        const page = await api.myTracks(offset, PAGE);
        setTracks((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch (e) {
        fail(e);
      } finally {
        setLoadingTracks(false);
      }
    },
    [fail],
  );

  const reloadPlaylists = useCallback(() => {
    setPlaylistsLoading(true);
    api.myPlaylists().then(setPlaylists).catch(fail).finally(() => setPlaylistsLoading(false));
  }, [fail]);

  useEffect(() => {
    api
      .restore()
      .then(setProfile)
      .catch(fail)
      .finally(() => setBooting(false));
  }, [fail]);

  useEffect(() => {
    reloadAccounts();
    if (!profile) return;
    setReturnTo(null);
    setTracks([]);
    setTotal(0);
    loadPage(0);
    reloadPlaylists();
  }, [profile, loadPage, reloadPlaylists, reloadAccounts]);

  const clear = () => {
    setTracks([]);
    setTotal(0);
    setPlaylists([]);
  };

  const switchAccount = async (userId: number) => {
    if (profile?.id === userId) return;
    try {
      await api.switchAccount(userId);
      clear();
      setProfile(await api.login());
    } catch (e) {
      fail(e);
    }
  };

  const mineKeys = useMemo(() => new Map(tracks.map((t) => [trackKey(t), t])), [tracks]);
  const isMine = useCallback(
    (t: Track) => (profile ? t.ownerId === profile.id : false) || mineKeys.has(trackKey(t)),
    [profile, mineKeys],
  );

  const toggleMine = async (t: Track) => {
    try {
      if (isMine(t)) {
        const copy = profile && t.ownerId === profile.id ? t : mineKeys.get(trackKey(t));
        if (!copy) return;
        await api.remove(copy);
        let at = 0;
        setTracks((prev) => {
          at = Math.max(0, prev.findIndex((x) => x.id === copy.id));
          return prev.filter((x) => x.id !== copy.id);
        });
        setTotal((n) => n - 1);
        toast("«{name}» удалён из моей музыки", { name: copy.title }, {
          action: {
            label: "Вернуть",
            run: async () => {
              try {
                await api.undoRemove(copy);
                setTracks((prev) => (prev.some((x) => x.id === copy.id) ? prev : [...prev.slice(0, at), copy, ...prev.slice(at)]));
                setTotal((n) => n + 1);
                toast("Трек возвращён");
              } catch (e) {
                fail(e);
              }
            },
          },
        });
      } else {
        const copy = await api.add(t);
        setTracks((prev) => [copy, ...prev]);
        setTotal((n) => n + 1);
        toast("Добавлено в мою музыку");
      }
    } catch (e) {
      fail(e);
    }
  };

  const value: LibraryState = {
    profile,
    booting,
    login: async () => {
      try {
        setProfile(await api.login());
      } catch (e) {
        if (!String(e).includes("отменён")) fail(e);
      }
    },
    finishLogin: async () => {
      try {
        setProfile(await api.login());
      } catch (e) {
        fail(e);
      }
    },
    logout: async () => {
      await api.logout();
      clear();
      const rest = await api.accounts().catch(() => [] as Account[]);
      setAccounts(rest);
      if (rest.length) {
        await api.switchAccount(rest[0].user_id);
        setProfile(await api.login().catch(() => null));
      } else setProfile(null);
    },
    accounts,
    reloadAccounts,
    switchAccount,
    removeAccount: async (userId) => {
      if (userId === profile?.id) return value.logout();
      await api.removeAccount(userId);
      reloadAccounts();
    },
    addAccount: async () => {
      const prev = profile?.id ?? null;
      await api.detach();
      clear();
      setReturnTo(prev);
      setProfile(null);
    },
    returnTo,
    cancelAdd: async () => {
      if (returnTo == null) return;
      const id = returnTo;
      setReturnTo(null);
      await api.switchAccount(id);
      setProfile(await api.login().catch(() => null));
    },
    moveTrack: async (from, to) => {
      if (from === to) return;
      const next = [...tracks];
      const [t] = next.splice(from, 1);
      next.splice(to, 0, t);
      setTracks(next);
      try {
        await api.reorder(t, next[to - 1], next[to + 1]);
      } catch (e) {
        setTracks(tracks); // вернуть как было
        fail(e);
      }
    },
    tracks,
    total,
    loadingTracks,
    loadMore: () => {
      if (!loadingTracks && tracks.length < total) loadPage(tracks.length);
    },
    playlists,
    playlistsLoading,
    reloadPlaylists,
    isMine,
    toggleMine,
    createPlaylist: async (title) => {
      try {
        const p = await api.createPlaylist(title);
        setPlaylists((prev) => [p, ...prev]);
        return p;
      } catch (e) {
        fail(e);
        return null;
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLibrary = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLibrary вне LibraryProvider");
  return v;
};
