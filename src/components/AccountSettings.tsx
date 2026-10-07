// Раздел настроек «Аккаунт Melo»: способы входа, итоги года, управление аккаунтом.
import { FormEvent, useCallback, useEffect, useState } from "react";
import { BarChart3, Link2, Loader2, LogOut, Mail, Pencil, ShieldOff, Trash2, Unlink } from "lucide-react";
import { melo, Stats } from "../api/melo";
import { useAccount } from "../store/account";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { Captcha } from "./Captcha";
import { Dialog } from "./Dialog";

const NAMES: Record<string, string> = { vk: "ВКонтакте", email: "Почта", google: "Google" };

function EmailLink({ onDone }: { onDone: () => void }) {
  const acc = useAccount();
  const { t, lang } = useSettings();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((v: string) => setCaptcha(v), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (!sent) setSent(await acc.emailStart(email.trim(), captcha, lang));
    else if (await acc.emailVerify(email.trim(), code)) onDone();
    setBusy(false);
  };
  return (
    <form className="acc-link-form" onSubmit={submit}>
      {!sent ? (
        <>
          <input className="auth-input" type="email" autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {acc.config?.captcha && <Captcha lang={lang} onToken={onToken} resetKey={0} />}
        </>
      ) : (
        <input className="auth-input" inputMode="numeric" autoFocus placeholder={t("Код из письма")} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      )}
      <button className="btn primary sm-btn" disabled={busy || (sent ? code.length !== 6 : !email.includes("@") || (!!acc.config?.captcha && !captcha))}>
        {busy && <Loader2 size={14} className="spin" />} {t(sent ? "Подтвердить" : "Получить код")}
      </button>
    </form>
  );
}

function YearStats() {
  const { t } = useSettings();
  const year = new Date().getFullYear();
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { melo.stats(year).then(setS).catch(() => {}); }, [year]);
  if (!s) return null;
  const minutes = Math.round(s.total.seconds / 60);
  if (!s.total.plays) return <small className="faint">{t("Здесь появятся ваши итоги года — просто слушайте музыку.")}</small>;
  return (
    <div className="stats">
      <div className="stats-nums">
        <div><b>{minutes.toLocaleString()}</b><small>{t("минут")}</small></div>
        <div><b>{s.total.plays.toLocaleString()}</b><small>{t("прослушиваний")}</small></div>
        <div><b>{s.total.artists.toLocaleString()}</b><small>{t("исполнителей")}</small></div>
      </div>
      <div className="stats-cols">
        <div>
          <small className="stats-h">{t("Топ исполнителей")}</small>
          <ol>{s.top_artists.slice(0, 5).map((a) => <li key={a.artist}><span>{a.artist}</span><small>{a.plays}</small></li>)}</ol>
        </div>
        <div>
          <small className="stats-h">{t("Топ треков")}</small>
          <ol>{s.top_tracks.slice(0, 5).map((x) => <li key={x.artist + x.title}><span>{x.title}<small> — {x.artist}</small></span><small>{x.plays}</small></li>)}</ol>
        </div>
      </div>
    </div>
  );
}

export function AccountSettings() {
  const acc = useAccount();
  const lib = useLibrary();
  const ui = useUi();
  const { t } = useSettings();
  const [dialog, setDialog] = useState<"rename" | "delete" | "history" | null>(null);
  const [linkEmail, setLinkEmail] = useState(false);
  const u = acc.user;

  if (!u) {
    return (
      <section className="set-card">
        <h3>{t("Аккаунт Melo")}</h3>
        <small className="faint">{t("Нет связи с сервером Melo — синхронизация включится после перезапуска.")}</small>
      </section>
    );
  }

  const has = (p: string) => u.identities.find((i) => i.provider === p);
  const methods = (["vk", "email", "google"] as const).filter((p) => has(p) || acc.config?.[p]);

  return (
    <>
      <section className="set-card">
        <h3>{t("Аккаунт Melo")}</h3>
        <div className="acc-item active">
          {u.avatar ? <img className="avatar" src={u.avatar} alt="" /> : <span className="avatar">{(u.name || "M")[0].toUpperCase()}</span>}
          <span className="set-text">
            {u.name || t("Без имени")}
            <small>{t("В Melo с {date}", { date: new Date(u.created_at * 1000).toLocaleDateString() })} · {t("Настройки, плейлисты Melo и история синхронизируются")}</small>
          </span>
          <button className="icon-btn sm" onClick={() => setDialog("rename")} aria-label={t("Изменить имя")} data-tip={t("Изменить имя")}><Pencil size={15} /></button>
        </div>

        <small className="stats-h">{t("Способы входа")}</small>
        <div className="acc-list">
          {methods.map((p) => {
            const id = has(p);
            return (
              <div key={p} className="acc-item">
                <span className="set-text">
                  {t(NAMES[p])}
                  <small>{id ? id.label || t("Привязан") : t("Не привязан")}</small>
                </span>
                {id ? (
                  u.identities.length > 1 && (
                    <button className="btn secondary sm-btn" onClick={() => acc.unlink(p).then((ok) => ok && ui.toast("Способ входа отвязан"))}>
                      <Unlink size={14} /> {t("Отвязать")}
                    </button>
                  )
                ) : p === "vk" ? (
                  <button className="btn secondary sm-btn" disabled={!lib.profile || acc.vkBusy} onClick={() => acc.signInVk().then((ok) => ok && ui.toast("ВКонтакте привязан"))}>
                    <Link2 size={14} /> {t("Привязать текущий ВК")}
                  </button>
                ) : p === "email" ? (
                  <button className="btn secondary sm-btn" onClick={() => setLinkEmail(!linkEmail)}><Mail size={14} /> {t("Привязать")}</button>
                ) : (
                  <button className="btn secondary sm-btn" disabled={acc.googleWaiting} onClick={() => acc.google(true).then((ok) => ok && ui.toast("Google привязан"))}>
                    {acc.googleWaiting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} {t("Привязать")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {linkEmail && !has("email") && <EmailLink onDone={() => { setLinkEmail(false); ui.toast("Почта привязана"); }} />}
        {acc.error && <div className="auth-error">{t(acc.error)}</div>}

        <div className="row-gap wrap">
          <button className="btn secondary sm-btn" onClick={() => acc.logout()}><LogOut size={15} /> {t("Выйти из Melo")}</button>
          <button className="btn secondary sm-btn" onClick={() => melo.logoutAll().then(() => acc.logout())}><ShieldOff size={15} /> {t("Выйти на всех устройствах")}</button>
          <button className="btn secondary sm-btn" onClick={() => setDialog("history")}><Trash2 size={15} /> {t("Очистить историю")}</button>
          <button className="btn secondary sm-btn danger" onClick={() => setDialog("delete")}><Trash2 size={15} /> {t("Удалить аккаунт")}</button>
        </div>
      </section>

      <section className="set-card">
        <h3><BarChart3 size={18} className="h-icon" /> {t("Итоги {year}", { year: new Date().getFullYear() })}</h3>
        <YearStats />
      </section>

      {dialog === "rename" && (
        <Dialog title="Как вас называть?" input={u.name ?? ""} confirm="Сохранить" onClose={() => setDialog(null)}
          onConfirm={async (v) => { if (await acc.rename(v)) setDialog(null); }} />
      )}
      {dialog === "history" && (
        <Dialog title="Очистить историю?" text={t("История прослушиваний и итоги года будут удалены.")} danger confirm="Очистить"
          icon={<Trash2 size={22} />} onClose={() => setDialog(null)}
          onConfirm={async () => { await melo.clearHistory().catch(() => {}); setDialog(null); ui.toast("История очищена"); }} />
      )}
      {dialog === "delete" && (
        <Dialog title="Удалить аккаунт Melo?" danger confirm="Удалить навсегда" icon={<Trash2 size={22} />}
          text={t("Удалятся настройки в облаке, плейлисты Melo, избранное и история. Аккаунт ВКонтакте и «Моя музыка» в ВК не пострадают.")}
          onClose={() => setDialog(null)}
          onConfirm={async () => { if (await acc.deleteAccount()) setDialog(null); }} />
      )}
    </>
  );
}
