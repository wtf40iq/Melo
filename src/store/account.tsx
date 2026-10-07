// Аккаунт Melo: вход (ВК / почта / Google), хранение сессии и привязка ВК.
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { MeloConfig, MeloError, MeloSession, MeloUser, loadSession, melo, openExternal, saveSession, setToken, vkProof } from "../api/melo";
import { useLibrary } from "./library";

type AccountState = {
  /** Пока читаем сохранённую сессию */
  booting: boolean;
  user: MeloUser | null;
  config: MeloConfig | null;
  /** Сервер недоступен, работаем без аккаунта до перезапуска */
  offline: boolean;
  /** Идёт вход через ВК (после входа в ВК — автоматически) */
  vkBusy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  reloadConfig: () => Promise<void>;
  signInVk: () => Promise<boolean>;
  emailStart: (email: string, captcha: string, lang: string) => Promise<boolean>;
  emailVerify: (email: string, code: string) => Promise<boolean>;
  /** Вход/привязка Google: открывает браузер и ждёт подтверждения. */
  google: (link?: boolean) => Promise<boolean>;
  cancelGoogle: () => void;
  googleWaiting: boolean;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
  unlink: (provider: string) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  continueOffline: () => void;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<AccountState | null>(null);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AccountProvider({ children }: { children: ReactNode }) {
  const lib = useLibrary();
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<MeloSession | null>(null);
  const [config, setConfig] = useState<MeloConfig | null>(null);
  const [offline, setOffline] = useState(false);
  const [vkBusy, setVkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleWaiting, setGoogleWaiting] = useState(false);
  const googleCancel = useRef(false);

  const apply = useCallback(async (s: MeloSession | null) => {
    setToken(s?.token ?? null);
    setSession(s);
    await saveSession(s);
  }, []);

  const updateUser = useCallback((user: MeloUser) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user };
      saveSession(next);
      return next;
    });
  }, []);

  const reloadConfig = useCallback(async () => {
    try {
      setConfig(await melo.config());
      setOffline(false);
    } catch {
      setConfig(null);
    }
  }, []);

  // Старт: сохранённая сессия + проверка, что она ещё жива
  useEffect(() => {
    (async () => {
      const s = await loadSession();
      if (s?.token) {
        setToken(s.token);
        setSession(s);
        try {
          const { user } = await melo.me();
          updateUser(user);
        } catch (e) {
          // 401 — сессия отозвана; без сети — работаем с сохранённой
          if (e instanceof MeloError && e.status === 401) await apply(null);
        }
      }
      setBooting(false);
      reloadConfig();
    })();
  }, [apply, updateUser, reloadConfig]);

  const finish = useCallback(async (r: { token: string | null; user: MeloUser }) => {
    if (r.token) await apply({ token: r.token, user: r.user });
    else updateUser(r.user);
    setError(null);
    return true;
  }, [apply, updateUser]);

  const fail = useCallback((e: unknown) => {
    setError(errText(e));
    return false;
  }, []);

  /** Вход (или привязка) по уже выполненному входу в ВК. */
  const signInVk = useCallback(async () => {
    const proof = await vkProof();
    if (!proof) return api.demo ? fail(new Error("В демо-режиме вход через ВК недоступен — используйте почту")) : false;
    setVkBusy(true);
    try {
      return await finish(await melo.authVk(proof.token, proof.client));
    } catch (e) {
      // Аккаунт ВК уже привязан к другому аккаунту Melo — при привязке это не ошибка
      if (e instanceof MeloError && e.code === "identity_taken") return false;
      if (e instanceof MeloError && e.offline) setOffline(true);
      return fail(e);
    } finally {
      setVkBusy(false);
    }
  }, [fail, finish]);

  // Вошли в ВК, а аккаунта Melo ещё нет — создаём/входим автоматически.
  // Уже есть аккаунт без ВК — привязываем этот ВК (один раз за запуск).
  const linkedFor = useRef<number | null>(null);
  useEffect(() => {
    const vkId = lib.profile?.id;
    if (booting || !vkId || api.demo) return;
    if (!session) {
      if (!offline && linkedFor.current !== vkId) {
        linkedFor.current = vkId;
        signInVk();
      }
      return;
    }
    const hasVk = session.user.identities.some((i) => i.provider === "vk");
    if (!hasVk && linkedFor.current !== vkId) {
      linkedFor.current = vkId;
      signInVk().then(() => setError(null));
    }
  }, [booting, lib.profile?.id, session, offline, signInVk]);

  // Плейлисты Melo зависят от аккаунта — перечитываем при входе/выходе
  const tokenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const t = session?.token ?? null;
    if (tokenRef.current !== undefined && tokenRef.current !== t && lib.profile) lib.reloadPlaylists();
    tokenRef.current = t;
  }, [session?.token, lib]);

  const googleFlow = async (link: boolean) => {
    const secret = crypto.getRandomValues(new Uint8Array(24)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    try {
      if (!link) setToken(null);
      const init = await melo.googleInit(secret);
      if (!link && session) setToken(session.token);
      await openExternal(init.url);
      googleCancel.current = false;
      setGoogleWaiting(true);
      const until = Date.now() + init.expires_in * 1000;
      while (Date.now() < until && !googleCancel.current) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await melo.googlePoll(init.id, secret).catch(() => ({ state: "waiting" as const }));
        if (r.state === "ok" && r.user) return await finish({ token: r.token ?? null, user: r.user });
        if (r.state === "error") return fail(new Error(r.message || "Не удалось войти через Google"));
        if (r.state === "expired") break;
      }
      return googleCancel.current ? false : fail(new Error("Время на вход истекло, попробуйте ещё раз"));
    } catch (e) {
      return fail(e);
    } finally {
      setGoogleWaiting(false);
    }
  };

  const value: AccountState = {
    booting,
    user: session?.user ?? null,
    config,
    offline,
    vkBusy,
    error,
    setError,
    reloadConfig,
    signInVk,
    emailStart: async (email, captcha, lang) => {
      try {
        await melo.emailStart(email, captcha, lang);
        setError(null);
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    emailVerify: async (email, code) => {
      try {
        return await finish(await melo.emailVerify(email, code));
      } catch (e) {
        return fail(e);
      }
    },
    google: (link = false) => googleFlow(link),
    cancelGoogle: () => { googleCancel.current = true; },
    googleWaiting,
    logout: async () => {
      await melo.logout().catch(() => {});
      linkedFor.current = lib.profile?.id ?? null; // не входить снова автоматически
      await apply(null);
    },
    deleteAccount: async () => {
      try {
        await melo.deleteAccount();
        linkedFor.current = lib.profile?.id ?? null;
        await apply(null);
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    unlink: async (provider) => {
      try {
        updateUser((await melo.unlink(provider)).user);
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    rename: async (name) => {
      try {
        updateUser((await melo.rename(name)).user);
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    continueOffline: () => setOffline(true),
    refreshMe: async () => {
      try {
        updateUser((await melo.me()).user);
      } catch { /* */ }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAccount = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount вне AccountProvider");
  return v;
};
