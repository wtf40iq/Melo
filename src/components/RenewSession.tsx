import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createQR } from "@vkontakte/vk-qr";
import { Clock, Loader2, RefreshCw, Smartphone, X } from "lucide-react";
import { api, inTauri } from "../api";
import { QrCode } from "../api/types";
import { useLibrary } from "../store/library";
import { useT } from "../store/settings";
import { errorText, useUi } from "../store/ui";

export type SessionInfo = {
  user_id: number | null;
  client: string | null;
  expires_at: number | null;
  has_refresh: boolean;
  expired: boolean;
  diag: Record<string, unknown>;
};

export const sessionInfo = () =>
  import("@tauri-apps/api/core").then(({ invoke }) => invoke<SessionInfo>("vk_session_info"));

type Phase = "loading" | "waiting" | "scanned" | "code" | "error";

/**
 * Продление входа без выхода из аккаунта. Если ключ ВК истёк и тихо продлить его не вышло,
 * поверх приложения появляется окно с QR-кодом: музыка доигрывает, всё остальное остаётся.
 * За 15 минут до конца срока (если ключа продления нет) — ненавязчивая плашка.
 */
export function RenewSession() {
  const lib = useLibrary();
  const ui = useUi();
  const t = useT();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  // Отказ от окна не должен пересоздавать интервал и подписку на событие
  const dismissed = useRef(false);
  const [now, setNow] = useState(Date.now() / 1000);

  const refresh = useCallback(() => {
    if (!inTauri) return;
    sessionInfo().then((i) => {
      setInfo(i);
      if (i.expired) setOpen((o) => o || !dismissed.current);
    }).catch(() => {});
  }, []);

  // После выхода или смены аккаунта окно продления не должно оставаться открытым
  // от прошлой сессии: иначе сразу после успешного входа снова показывается старый QR.
  useLayoutEffect(() => {
    setOpen(false);
    dismissed.current = false;
    setInfo(null);
    if (lib.profile) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.profile?.id, refresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { setNow(Date.now() / 1000); refresh(); }, 30_000);
    let off: (() => void) | undefined;
    let disposed = false;
    if (inTauri) {
      import("@tauri-apps/api/event").then(({ listen }) =>
        listen("vk-session-expired", () => { dismissed.current = false; setOpen(true); refresh(); })
          .then((u) => { if (disposed) u(); else off = u; }),
      );
    }
    return () => { disposed = true; clearInterval(id); off?.(); };
  }, [refresh]);

  if (!lib.profile || !info) return null;
  const left = info.expires_at ? info.expires_at - now : Infinity;
  const soon = !info.expired && !info.has_refresh && left < 15 * 60;

  return (
    <>
      {(info.expired || soon) && !open && (
        <button className="renew-pill" onClick={() => setOpen(true)}>
          <Clock size={14} />
          {info.expired ? t("Сессия ВК закончилась — продлить") : t("Вход в ВК скоро закончится — продлить")}
        </button>
      )}
      {open && (
        <RenewDialog
          expired={info.expired}
          onClose={() => { setOpen(false); dismissed.current = true; }}
          onDone={async (uid) => {
            setOpen(false);
            dismissed.current = false;
            refresh();
            if (uid == null) {
              ui.toast(t("Не удалось продлить вход — попробуйте ещё раз"));
              return;
            }
            const same = uid === lib.profile?.id;
            try {
              // Даже для того же аккаунта профиль перезагружаем заново: это обновляет
              // me в API-слое и запускает перезагрузку треков/плейлистов.
              await lib.finishLogin();
              if (same) ui.toast(t("Вход продлён"));
            } catch (e) {
              ui.toast(errorText(e));
              // Сессия могла обновиться, даже если загрузка профиля моргнула.
              lib.reloadLibrary();
            }
          }}
        />
      )}
    </>
  );
}

function RenewDialog({ expired, onClose, onDone }: { expired: boolean; onClose: () => void; onDone: (uid: number | null) => void }) {
  const t = useT();
  const lib = useLibrary();
  const [code, setCode] = useState<QrCode | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [attempt, setAttempt] = useState(0);
  const finished = useRef(false);

  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    const { invoke } = await import("@tauri-apps/api/core");
    const uid = await invoke<number | null>("vk_session").catch(() => null);
    onDone(uid);
  }, [onDone]);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    setPhase("loading");
    setError("");
    setOtp("");
    (async () => {
      try {
        const c = await api.qrStart();
        if (!alive) return;
        setCode(c);
        setPhase("waiting");
        const until = (c.expires_at > Date.now() / 1000 ? c.expires_at : Date.now() / 1000 + 300) * 1000;
        const poll = async () => {
          if (!alive || finished.current) return;
          if (Date.now() > until) { setAttempt((a) => a + 1); return; }
          try {
            const st = await api.qrCheck(c.hash);
            if (!alive) return;
            if (st.state === "ok") return finish();
            if (st.state === "error") { setError(t(String(st.raw ?? ""))); setPhase("error"); return; }
            if (st.state === "scanned") setPhase((p) => (p === "waiting" ? "scanned" : p));
            if (st.state === "need_code") setPhase("code");
            if (st.state === "declined" || st.state === "expired") { setAttempt((a) => a + 1); return; }
          } catch { /* сеть моргнула — пробуем дальше */ }
          timer = window.setTimeout(poll, 2000);
        };
        timer = window.setTimeout(poll, 2000);
      } catch (e) {
        if (alive) { setError(t(errorText(e))); setPhase("error"); }
      }
    })();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const submit = async (v: string) => {
    if (!code || v.length < 6) return;
    try {
      const r = await api.qrSubmit(code.hash, v);
      if (r.state === "ok") return finish();
      if (r.state === "incorrect") { setOtp(""); setError(t("Неверный код. Проверьте его и попробуйте ещё раз.")); }
      if (r.state === "expired") setAttempt((a) => a + 1);
    } catch (e) {
      setError(t(errorText(e)));
    }
  };

  return (
    <div className="upd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upd-card renew-card" role="dialog" aria-modal="true" aria-label={t("Продлите вход ВКонтакте")}>
        <button className="icon-btn sm upd-close" onClick={onClose} aria-label={t("Закрыть")}><X size={16} /></button>
        <h3>{expired ? t("Продлите вход ВКонтакте") : t("Вход в ВК скоро закончится")}</h3>
        <p className="muted">
          {t("Музыка продолжит играть. Наведите камеру телефона на QR-код и подтвердите вход — это займёт пару секунд.")}
        </p>
        <div className="renew-qr">
          {code && phase !== "loading" && phase !== "error" ? (
            <div className="qr" dangerouslySetInnerHTML={{ __html: createQR(code.url, { qrSize: 220, isShowLogo: true, foregroundColor: "#000000" }) }} />
          ) : phase === "error" ? (
            <div className="renew-err">{error || t("Не удалось получить QR-код")}</div>
          ) : (
            <Loader2 className="spin" size={28} />
          )}
        </div>
        {phase === "scanned" && <p className="renew-status"><Smartphone size={15} /> {t("Подтвердите вход на телефоне")}</p>}
        {phase === "code" && (
          <input className="dialog-input code-input" autoFocus inputMode="numeric" autoComplete="off" placeholder={t("Код с телефона")}
            value={otp} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setOtp(v); setError(""); if (v.length === 6) submit(v); }} />
        )}
        {error && phase !== "error" && <p className="renew-err">{error}</p>}
        <div className="row-gap upd-actions">
          <button className="btn secondary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={15} /> {t("Новый QR-код")}</button>
          <button className="link-btn" onClick={() => lib.logout()}>{t("Выйти из аккаунта")}</button>
        </div>
      </div>
    </div>
  );
}
