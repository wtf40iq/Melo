import { Logo } from "../components/Logo";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Globe, KeyRound, Loader2, Lock, RefreshCw, Smartphone } from "lucide-react";
import { acceptTerms, termsAccepted } from "../legal";
import { LegalDialog } from "../components/LegalDialog";
import { createQR } from "@vkontakte/vk-qr";
import { api } from "../api";
import { QrCode } from "../api/types";
import { useLibrary } from "../store/library";
import { useT } from "../store/settings";
import { errorText } from "../store/ui";

type Phase = "loading" | "waiting" | "scanned" | "code" | "expired" | "error" | "done";

const CODE_LEN = 6;

export function Login({ onBack, note, account }: { onBack?: () => void; note?: string; account?: { name: string; onLogout: () => void } } = {}) {
  const lib = useLibrary();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [code, setCode] = useState<(QrCode & { until: number }) | null>(null);
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const done = useRef(false);
  const [agreed, setAgreed] = useState(termsAccepted);
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);
  const agree = (v: boolean) => { setAgreed(v); acceptTerms(v); };

  const finish = async () => {
    if (done.current) return;
    done.current = true;
    setPhase("done");
    await lib.finishLogin();
  };

  // Получаем QR-код и опрашиваем ВК, пока вход не подтвердят
  useEffect(() => {
    if (!agreed) return;
    let alive = true;
    let timer: number | undefined;
    setPhase("loading");
    setOtp("");
    setOtpError("");

    const start = async () => {
      try {
        const c = await api.qrStart();
        if (!alive) return;
        const now = Date.now() / 1000;
        const until = c.expires_at > now ? c.expires_at : now + 300;
        setCode({ ...c, until });
        setPhase("waiting");

        const poll = async () => {
          if (!alive || done.current) return;
          try {
            const st = await api.qrCheck(c.hash);
            if (!alive) return;
            if (st.state === "ok") return finish();
            if (st.state === "error") {
              setError(String(st.raw ?? ""));
              setPhase("error");
              return;
            }
            if (st.state === "scanned" && phaseRef.current === "waiting") setPhase("scanned");
            if (st.state === "need_code" && phaseRef.current !== "code") setPhase("code");
            if (st.state === "declined" || st.state === "expired") {
              if (phaseRef.current === "waiting") return start();
              setPhase("expired");
              return;
            }
          } catch {
            /* временная ошибка сети — пробуем дальше */
          }
          if (Date.now() / 1000 > until) {
            // QR устарел: если его ещё не сканировали — тихо меняем, иначе предлагаем кнопку
            if (phaseRef.current === "waiting") return start();
            setPhase("expired");
            return;
          }
          timer = window.setTimeout(poll, 2000);
        };
        timer = window.setTimeout(poll, 2000);
      } catch (e) {
        if (!alive) return;
        setError(errorText(e));
        setPhase("error");
      }
    };
    start();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, agreed]);

  const submitOtp = async (value: string) => {
    if (!code || value.length < CODE_LEN || sending) return;
    setSending(true);
    setOtpError("");
    try {
      const r = await api.qrSubmit(code.hash, value);
      if (r.state === "ok") return finish();
      if (r.state === "incorrect") {
        setOtp("");
        setOtpError(t("Неверный код. Проверьте его и попробуйте ещё раз."));
        return;
      }
      if (r.state === "expired") {
        setPhase("expired");
        return;
      }
      if (r.state !== "accepted") {
        setOtpError(`${t("ВК не принял код.")} (VK: ${JSON.stringify(r.raw)})`);
        return;
      }
      // Код принят — ключ придёт при одной из следующих проверок
      for (let i = 0; i < 15 && !done.current; i++) {
        if (phaseRef.current !== "code") return; // основной опрос уже обработал результат
        await new Promise((res) => setTimeout(res, 1000));
      }
    } catch (err) {
      setOtpError(t(errorText(err)));
    } finally {
      setSending(false);
    }
  };

  const onOtp = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, CODE_LEN);
    setOtp(v);
    setOtpError("");
    if (v.length === CODE_LEN) submitOtp(v);
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitOtp(otp);
  };

  return (
    <div className="login">
      <div className="login-card wide-card">
        <div className="login-side">
          {onBack && lib.returnTo == null && (
            <button className="link-btn back-link" onClick={onBack}>
              <ArrowLeft size={14} /> {t("Другие способы входа")}
            </button>
          )}
          {lib.returnTo != null && (
            <button className="link-btn back-link" onClick={() => lib.cancelAdd()}>
              <ArrowLeft size={14} /> {t("Вернуться к текущему аккаунту")}
            </button>
          )}
          <Logo size={64} className="big" />
          <h1>{lib.returnTo != null ? t("Ещё один аккаунт") : "Melo"}</h1>
          <p>{t("Ваша музыка из ВКонтакте — без рекламы и лишнего.")}</p>
          {note && <div className="auth-note">{t(note)}</div>}

          <ol className="login-steps">
            <li><Smartphone size={16} /> {t("Откройте камеру или приложение ВК на телефоне")}</li>
            <li><span className="qr-mini" /> {t("Наведите на QR-код справа")}</li>
            <li><Check size={16} /> {t("Подтвердите вход на телефоне")}</li>
          </ol>

          <div className="login-or"><span>{t("или")}</span></div>
          <button
            className="btn secondary wide"
            disabled={busy || lib.booting || !agreed}
            onClick={async () => { setBusy(true); await lib.login(); setBusy(false); }}
          >
            {busy ? <Loader2 size={18} className="spin" /> : <Globe size={18} />}
            {t(busy ? "Ждём вход в окне ВК…" : "Войти через страницу ВК")}
          </button>
          <label className={`terms-check ${agreed ? "on" : ""}`}>
            <input type="checkbox" checked={agreed} onChange={(e) => agree(e.target.checked)} />
            <span className="terms-box">{agreed && <Check size={13} strokeWidth={3} />}</span>
            <span>
              {t("Я принимаю")}{" "}
              <button type="button" className="link-inline" onClick={(e) => { e.preventDefault(); setDoc("terms"); }}>{t("пользовательское соглашение")}</button>{" "}
              {t("и")}{" "}
              <button type="button" className="link-inline" onClick={(e) => { e.preventDefault(); setDoc("privacy"); }}>{t("политику конфиденциальности")}</button>
            </span>
          </label>
          {doc && <LegalDialog doc={doc} onClose={() => setDoc(null)} />}
          <small>
            {t(api.demo ? "Сейчас открыт демо-режим: данные ненастоящие." : "Вход идёт на официальной странице ВК. Пароль приложение не видит.")}
          </small>
          {account && (
            <small className="login-account">
              {t("Аккаунт Melo: {name}", { name: account.name })} ·{" "}
              <button type="button" className="link-inline" onClick={account.onLogout}>{t("Выйти из Melo")}</button>
            </small>
          )}
        </div>

        <div className="qr-box">
          {!agreed && (
            <div className="qr-placeholder locked">
              <Lock size={26} />
              <span>{t("Примите соглашение слева, чтобы появился QR-код")}</span>
            </div>
          )}
          {agreed && phase === "code" && (
            <form className="code-card" onSubmit={onFormSubmit}>
              <span className="code-icon"><KeyRound size={22} /></span>
              <b>{t("Введите код с телефона")}</b>
              <span className="code-hint">{t("ВК показал его после сканирования QR-кода")}</span>
              <label className={`code-cells ${otpError ? "bad" : ""}`}>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={t("Код с телефона")}
                  value={otp}
                  onChange={(e) => onOtp(e.target.value)}
                  disabled={sending}
                />
                {Array.from({ length: CODE_LEN }, (_, i) => (
                  <span key={i} className={`cell ${i === Math.min(otp.length, CODE_LEN - 1) && !sending ? "cur" : ""} ${otp[i] ? "on" : ""}`}>
                    {otp[i] ?? ""}
                  </span>
                ))}
              </label>
              <span className={`code-status ${otpError ? "err" : ""}`}>
                {sending ? <><Loader2 size={14} className="spin" /> {t("Проверяем…")}</> : otpError}
              </span>
              <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>
                <RefreshCw size={13} /> {t("Новый QR-код")}
              </button>
            </form>
          )}

          {agreed && (phase === "waiting" || phase === "scanned" || phase === "expired") && code && (
            <div className="qr-wrap">
              <div
                className={`qr ${phase !== "waiting" ? "dim" : ""}`}
                dangerouslySetInnerHTML={{ __html: createQR(code.url, { qrSize: 220, isShowLogo: true, foregroundColor: "#121212" }) }}
              />
              {phase === "scanned" && <div className="qr-overlay"><Check size={36} /><b>{t("Подтвердите вход на телефоне")}</b></div>}
              {phase === "expired" && (
                <div className="qr-overlay">
                  <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={16} /> {t("Новый QR-код")}</button>
                </div>
              )}
            </div>
          )}
          {agreed && (phase === "loading" || phase === "done") && <div className="qr-placeholder"><Loader2 size={28} className="spin" /></div>}
          {agreed && phase === "error" && (
            <div className="qr-placeholder error">
              <span>{t(error)}</span>
              <button className="btn secondary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={16} /> {t("Повторить")}</button>
            </div>
          )}

          {agreed && phase === "done" && <small className="qr-caption">{t("Входим…")}</small>}
          {agreed && (phase === "waiting" || phase === "scanned") && (
            <button type="button" className="link-btn" onClick={() => { setOtp(""); setOtpError(""); setPhase("code"); }}>
              {t("Телефон показал код?")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
