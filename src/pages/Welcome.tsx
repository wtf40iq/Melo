import { useEffect, useState } from "react";
import { ArrowRight, Feather, Gift, HardDrive, ShieldCheck } from "lucide-react";
import { Logo } from "../components/Logo";
import { useSettings } from "../store/settings";

const HELLO = [
  "Привет", "Hello", "Hola", "Bonjour", "Ciao", "Hallo", "Olá", "Merhaba", "Cześć", "Привіт",
  "こんにちは", "你好", "안녕하세요", "Hej", "Salut", "Sälem",
];

/** Первый запуск: «привет» на разных языках, затем коротко о Melo. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const s = useSettings();
  const t = s.t;
  const [step, setStep] = useState(0);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (step !== 0) return;
    const id = setInterval(() => setI((n) => (n + 1) % HELLO.length), 1700);
    return () => clearInterval(id);
  }, [step]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (step === 0) setStep(1);
      else onDone();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step, onDone]);

  if (step === 0) {
    return (
      <div className="welcome" key="hello">
        <div className="hello-word" key={i}>{HELLO[i]}</div>
        <button className="welcome-btn" onClick={() => setStep(1)}>
          {t("Продолжить")} <ArrowRight size={18} />
        </button>
      </div>
    );
  }

  const items = [
    { icon: Gift, title: "Полностью бесплатно", text: "Без подписок, рекламы и платных функций. Навсегда." },
    { icon: ShieldCheck, title: "Не собирает данные", text: "Никакой статистики и слежки. Melo общается только с ВКонтакте." },
    { icon: HardDrive, title: "Всё хранится у вас", text: "Ключ входа лежит только на этом компьютере. Пароль приложение не видит." },
    { icon: Feather, title: "Лёгкое и быстрое", text: "Маленький размер, мало памяти, музыка из вашей ВК." },
  ];

  return (
    <div className="welcome info" key="info">
      <div className="welcome-lang segmented">
        {(["ru", "en"] as const).map((l) => (
          <button key={l} className={s.lang === l ? "active" : ""} onClick={() => s.set({ lang: l })}>{l === "ru" ? "Русский" : "English"}</button>
        ))}
      </div>
      <Logo size={72} className="welcome-logo" />
      <h1>{t("Добро пожаловать в Melo")}</h1>
      <p className="welcome-sub">{t("Музыка ВКонтакте в красивом и лёгком приложении")}</p>
      <div className="welcome-list">
        {items.map((it, n) => (
          <div className="welcome-item" key={it.title} style={{ ["--i" as string]: n }}>
            <span className="welcome-icon"><it.icon size={20} /></span>
            <span>
              <b>{t(it.title)}</b>
              <small>{t(it.text)}</small>
            </span>
          </div>
        ))}
      </div>
      <button className="welcome-btn" onClick={onDone}>
        {t("Начать")} <ArrowRight size={18} />
      </button>
    </div>
  );
}
