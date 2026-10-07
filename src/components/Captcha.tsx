// Проверка Cloudflare Turnstile. Виджет живёт на странице сервера Melo
// (у приложения нет своего домена), а токен приходит через postMessage.
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useT } from "../store/settings";
import { MELO_API } from "../api/melo";

export function Captcha({ lang, onToken, resetKey }: { lang: string; onToken: (t: string) => void; resetKey: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const origin = new URL(MELO_API).origin;
  const t = useT();
  // Виджет скрыт, пока Cloudflare не попросит действия (режим interaction-only)
  const [show, setShow] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.source !== "melo-turnstile") return;
      if (typeof e.data.show === "boolean") setShow(e.data.show);
      if ("token" in e.data) {
        const tok = typeof e.data.token === "string" ? e.data.token : "";
        setOk(!!tok);
        onToken(tok);
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [origin, onToken]);

  useEffect(() => {
    if (!resetKey) return;
    setOk(false);
    ref.current?.contentWindow?.postMessage("melo-turnstile-reset", origin);
  }, [resetKey, origin]);

  return (
    <div className={`captcha ${show ? "show" : ""}`}>
      <iframe ref={ref} className="captcha-frame" title="Captcha" src={`${MELO_API}/turnstile?lang=${lang}`} />
      {!show && (
        <span className={`captcha-status ${ok ? "ok" : ""}`}>
          {ok ? <ShieldCheck size={14} /> : <Loader2 size={14} className="spin" />}
          {t(ok ? "Проверка на робота пройдена" : "Проверяем, что вы не робот…")}
        </span>
      )}
    </div>
  );
}
