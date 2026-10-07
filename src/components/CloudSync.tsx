// Фоновая синхронизация с аккаунтом Melo: настройки и история прослушиваний.
import { useEffect, useRef } from "react";
import { melo, toRef, TrackRef } from "../api/melo";
import { useAccount } from "../store/account";
import { DEFAULT_SETTINGS, useSettings } from "../store/settings";
import { usePlayer } from "../store/player";

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[];
const SYNCED_AT = "melo.settings.syncedAt";
const QUEUE = "melo.history.queue";

type Play = { track: TrackRef; seconds: number; played_at: number };
const readQueue = (): Play[] => {
  try { return JSON.parse(localStorage.getItem(QUEUE) || "[]"); } catch { return []; }
};
const writeQueue = (q: Play[]) => localStorage.setItem(QUEUE, JSON.stringify(q.slice(-1000)));

export function CloudSync() {
  const acc = useAccount();
  const settings = useSettings();
  const player = usePlayer();
  const userId = acc.user?.id ?? null;

  // ---------- Настройки ----------
  const snapshot = () => Object.fromEntries(KEYS.map((k) => [k, settings[k]])) as Record<string, unknown>;
  const current = JSON.stringify(snapshot());
  const lastSynced = useRef<string | null>(null);
  const ready = useRef(false);

  // При входе: берём более свежую версию — с сервера или локальную
  useEffect(() => {
    ready.current = false;
    lastSynced.current = null;
    if (!userId) return;
    let cancelled = false;
    melo.getSettings().then(async (r) => {
      if (cancelled) return;
      const localAt = Number(localStorage.getItem(`${SYNCED_AT}.${userId}`) || 0);
      if (r.data && r.updated_at > localAt) {
        const patch = Object.fromEntries(KEYS.filter((k) => k in r.data!).map((k) => [k, r.data![k]]));
        settings.set(patch as never);
        lastSynced.current = JSON.stringify({ ...snapshot(), ...patch });
        localStorage.setItem(`${SYNCED_AT}.${userId}`, String(r.updated_at));
      } else {
        const { updated_at } = await melo.putSettings(snapshot());
        lastSynced.current = current;
        localStorage.setItem(`${SYNCED_AT}.${userId}`, String(updated_at));
      }
      ready.current = true;
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Изменили настройку — сохраняем через 3 секунды тишины
  useEffect(() => {
    if (!userId || !ready.current || current === lastSynced.current) return;
    const id = setTimeout(() => {
      melo.putSettings(JSON.parse(current)).then(({ updated_at }) => {
        lastSynced.current = current;
        localStorage.setItem(`${SYNCED_AT}.${userId}`, String(updated_at));
      }).catch(() => {});
    }, 3000);
    return () => clearTimeout(id);
  }, [current, userId]);

  // ---------- История прослушиваний ----------
  const listened = useRef<{ key: string; track: TrackRef; seconds: number; started: number } | null>(null);
  const cur = player.current;
  const playing = player.playing;

  const commit = () => {
    const l = listened.current;
    listened.current = null;
    if (!l || !userId) return;
    // Засчитываем прослушивание от 30 секунд (или половины короткого трека)
    const need = Math.min(30, Math.max(10, (l.track.duration || 60) / 2));
    if (l.seconds < need) return;
    writeQueue([...readQueue(), { track: l.track, seconds: Math.round(l.seconds), played_at: l.started }]);
  };

  useEffect(() => {
    commit();
    if (cur) listened.current = { key: cur.id, track: toRef(cur), seconds: 0, started: Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => { if (listened.current) listened.current.seconds += 1; }, 1000);
    return () => clearInterval(id);
  }, [playing]);

  // Отправляем накопленное раз в 2 минуты и при закрытии
  useEffect(() => {
    if (!userId) return;
    const flush = (keepalive = false) => {
      const q = readQueue();
      if (!q.length) return;
      const batch = q.slice(0, 200);
      writeQueue(q.slice(batch.length));
      melo.pushHistory(batch, keepalive).catch(() => writeQueue([...batch, ...readQueue()]));
    };
    const id = setInterval(() => flush(), 120_000);
    const onHide = () => { commit(); flush(true); };
    const onVis = () => document.visibilityState === "hidden" && flush(true);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVis);
    flush();
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return null;
}
