// Обязательный вход в аккаунт Melo: ВКонтакте (рекомендуем), почта или Google.
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Cloud, Loader2, Mail, RefreshCw, WifiOff } from "lucide-react";
import { Logo } from "../components/Logo";
import { Captcha } from "../components/Captcha";
import { LegalDialog } from "../components/LegalDialog";
import { acceptTerms, termsAccepted } from "../legal";
import { useAccount } from "../store/account";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";

const CODE_LEN = 6;

const VkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12.8 18.5C6.4 18.5 2.7 14.1 2.5 6.7h3.2c.1 5.4 2.5 7.7 4.4 8.2V6.7h3v4.7c1.9-.2 3.8-2.3 4.5-4.7h3c-.5 2.9-2.6 5-4.1 5.9 1.5.7 3.9 2.6 4.8 5.9h-3.3c-.7-2.2-2.5-3.9-4.9-4.2v4.2h-.3Z"/></svg>
);
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

type Step = "choose" | "email" | "code";

export function AccountLogin({ onVk }: { onVk: () => void }) {
  const acc = useAccount();
  const lib = useLibrary();
  const { t, lang } = useSettings();
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [, tick] = useState(0);
  const [agreed, setAgreed] = useState(termsAccepted);
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);
  const cfg = acc.config;
  const onToken = useCallback((v: string) => setCaptcha(v), []);

  useEffect(() => {
    if (step !== "code") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  const back = () => { acc.setError(null); setStep(step === "code" ? "email" : "choose"); setCode(""); };

  const vk = async () => {
    acc.setError(null);
    // Уже вошли в ВК (например, после выхода из Melo) — просто подтверждаем
    if (lib.profile) await acc.signInVk();
    else onVk();
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await acc.emailStart(email.trim(), captcha, lang);
    setBusy(false);
    setCaptcha("");
    setCaptchaReset((n) => n + 1);
    if (ok) { setStep("code"); setCode(""); setResendAt(Date.now() + 60_000); }
  };

  const onCode = async (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, CODE_LEN);
    setCode(digits);
    if (digits.length === CODE_LEN) {
      setBusy(true);
      const ok = await acc.emailVerify(email.trim(), digits);
      setBusy(false);
      if (!ok) setCode("");
    }
  };

  const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  const needCaptcha = !!cfg?.captcha;

  return (
    <div className="login">
      <div className="login-card auth-card">
        {step !== "choose" && (
          <button className="link-btn back-link" onClick={back}><ArrowLeft size={14} /> {t("Назад")}</button>
        )}
        <Logo size={64} className="big" />
        <h1>{t("Вход в Melo")}</h1>
        <p>{t("Один аккаунт для настроек, плейлистов и истории — на любом компьютере.")}</p>

        {!cfg && !acc.booting && (
          <div className="auth-offline">
            <WifiOff size={18} />
            <span>{t("Сервер Melo сейчас недоступен.")}</span>
            <button className="btn secondary sm-btn" onClick={acc.reloadConfig}><RefreshCw size={14} /> {t("Повторить")}</button>
            <button className="link-btn" onClick={acc.continueOffline}>{t("Продолжить без аккаунта")}</button>
          </div>
        )}

        {step === "choose" && (
          <div className="auth-methods">
            <button className="btn primary wide auth-vk" disabled={!agreed || acc.vkBusy || acc.googleWaiting} onClick={vk}>
              {acc.vkBusy ? <Loader2 size={18} className="spin" /> : <VkIcon />}
              {t(lib.profile ? "Продолжить с ВКонтакте" : "Войти через ВКонтакте")}
              <span className="auth-badge">{t("Рекомендуем")}</span>
            </button>
            {cfg?.email !== false && (
              <button className="btn secondary wide" disabled={!agreed || !cfg?.email || acc.googleWaiting} onClick={() => { acc.setError(null); setStep("email"); }}>
                <Mail size={18} /> {t("Войти по почте")}
              </button>
            )}
            {cfg?.google !== false && (
              acc.googleWaiting ? (
                <div className="auth-wait">
                  <Loader2 size={16} className="spin" /> {t("Подтвердите вход в открывшемся браузере…")}
                  <button className="link-btn" onClick={acc.cancelGoogle}>{t("Отмена")}</button>
                </div>
              ) : (
                <button className="btn secondary wide" disabled={!agreed || !cfg?.google} onClick={() => { acc.setError(null); acc.google(); }}>
                  <GoogleIcon /> {t("Войти через Google")}
                </button>
              )
            )}
          </div>
        )}

        {step === "email" && (
          <form className="auth-form" onSubmit={sendCode}>
            <label className="auth-label">{t("Почта")}</label>
            <input
              className="auth-input"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {needCaptcha && <Captcha lang={lang} onToken={onToken} resetKey={captchaReset} />}
            <button className="btn primary wide" disabled={busy || !/\S+@\S+\.\S+/.test(email) || (needCaptcha && !captcha)}>
              {busy ? <Loader2 size={18} className="spin" /> : <Mail size={18} />} {t("Получить код")}
            </button>
          </form>
        )}

        {step === "code" && (
          <div className="auth-form">
            <span className="code-hint">{t("Мы отправили 6-значный код на {email}", { email: email.trim() })}</span>
            <label className={`code-cells ${acc.error ? "bad" : ""}`}>
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" aria-label={t("Код из письма")}
                value={code} onChange={(e) => onCode(e.target.value)} disabled={busy} />
              {Array.from({ length: CODE_LEN }, (_, i) => (
                <span key={i} className={`cell ${i === Math.min(code.length, CODE_LEN - 1) && !busy ? "cur" : ""} ${code[i] ? "on" : ""}`}>{code[i] ?? ""}</span>
              ))}
            </label>
            {busy && <span className="code-status"><Loader2 size={14} className="spin" /> {t("Проверяем…")}</span>}
            {wait > 0 ? (
              <small>{t("Отправить снова можно через {n} с", { n: wait })}</small>
            ) : needCaptcha ? (
              <>
                <Captcha lang={lang} onToken={onToken} resetKey={captchaReset} />
                <button className="link-btn" disabled={!captcha} onClick={() => sendCode()}><RefreshCw size={13} /> {t("Отправить код ещё раз")}</button>
              </>
            ) : (
              <button className="link-btn" onClick={() => sendCode()}><RefreshCw size={13} /> {t("Отправить код ещё раз")}</button>
            )}
          </div>
        )}

        {acc.error && <div className="auth-error">{t(acc.error)}</div>}

        {step === "choose" && (
          <label className={`terms-check ${agreed ? "on" : ""}`}>
            <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); acceptTerms(e.target.checked); }} />
            <span className="terms-box">{agreed && <Check size={13} strokeWidth={3} />}</span>
            <span>
              {t("Я принимаю")}{" "}
              <button type="button" className="link-inline" onClick={(e) => { e.preventDefault(); setDoc("terms"); }}>{t("пользовательское соглашение")}</button>{" "}
              {t("и")}{" "}
              <button type="button" className="link-inline" onClick={(e) => { e.preventDefault(); setDoc("privacy"); }}>{t("политику конфиденциальности")}</button>
            </span>
          </label>
        )}
        {doc && <LegalDialog doc={doc} onClose={() => setDoc(null)} />}
        <small className="auth-foot"><Cloud size={13} /> {t("Пароли и ключи ВК не хранятся на сервере Melo.")}</small>
      </div>
    </div>
  );
}
