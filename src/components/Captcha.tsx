// Проверка Cloudflare Turnstile. Виджет живёт на странице сервера Melo
// (у приложения нет своего домена), а токен приходит через postMessage.
import { useEffect, useRef } from "react";
import { MELO_API } from "../api/melo";

export function Captcha({ lang, onToken, resetKey }: { lang: string; onToken: (t: string) => void; resetKey: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const origin = new URL(MELO_API).origin;

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.source !== "melo-turnstile") return;
      onToken(typeof e.data.token === "string" ? e.data.token : "");
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [origin, onToken]);

  useEffect(() => {
    if (resetKey) ref.current?.contentWindow?.postMessage("melo-turnstile-reset", origin);
  }, [resetKey, origin]);

  return <iframe ref={ref} className="captcha-frame" title="Captcha" src={`${MELO_API}/turnstile?lang=${lang}`} />;
}
