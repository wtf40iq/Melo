// Тексты пользовательского соглашения и политики конфиденциальности.
// При существенных изменениях поднимите LEGAL_VERSION — пользователи примут условия заново.
export const LEGAL_VERSION = "2026-10-08";

type Doc = { title: string; sections: { h: string; p: string[] }[] };

const ru: { terms: Doc; privacy: Doc } = {
  terms: {
    title: "Пользовательское соглашение",
    sections: [
      { h: "1. Что такое Melo", p: [
        "Melo — бесплатная программа с открытым исходным кодом для прослушивания музыки из вашего аккаунта ВКонтакте на компьютере с Windows. Исходный код опубликован на GitHub: github.com/wtf40iq/Melo.",
        "Melo — неофициальный клиент. Программа не связана с ООО «В Контакте» (VK) и не одобрена ею. «ВКонтакте» и VK — товарные знаки их правообладателей.",
      ] },
      { h: "2. Принятие условий", p: [
        "Отмечая галочку на экране входа и пользуясь программой, вы соглашаетесь с этим соглашением и Политикой конфиденциальности. Если вы не согласны — не пользуйтесь программой.",
      ] },
      { h: "3. Аккаунт ВКонтакте", p: [
        "Для работы нужен ваш аккаунт ВКонтакте. Вход выполняется через официальные страницы и механизмы ВК (QR-код или страница входа ВК). Melo не видит и не хранит ваш пароль.",
        "Вы обязуетесь соблюдать Правила пользования сайтом ВКонтакте и не использовать Melo для нарушения этих правил.",
      ] },
      { h: "4. Музыка и авторские права", p: [
        "Вся музыка, обложки и тексты песен принадлежат их правообладателям и предоставляются сервисом ВКонтакте. Melo только воспроизводит то, что доступно вашему аккаунту.",
        "Программа предназначена для личного некоммерческого использования. Запрещено использовать Melo для скачивания, распространения или иного нарушения прав на музыку.",
      ] },
      { h: "5. Бесплатность", p: [
        "Melo распространяется бесплатно, без рекламы и платных функций. Если кто-то продаёт вам Melo — это не оригинал.",
      ] },
      { h: "6. Обновления", p: [
        "Программа может сама проверять наличие новой версии на GitHub и с вашего согласия устанавливать её. Автопроверку можно отключить в настройках.",
      ] },
      { h: "7. Отказ от гарантий", p: [
        "Программа предоставляется «как есть». Автор не гарантирует её бесперебойную работу: ВКонтакте может в любой момент изменить свои сервисы так, что часть функций перестанет работать.",
        "Автор не несёт ответственности за любой прямой или косвенный ущерб, блокировку аккаунта или потерю данных, связанные с использованием программы, в пределах, допустимых законом.",
      ] },
      { h: "8. Изменения соглашения", p: [
        "Соглашение может обновляться вместе с программой. При существенных изменениях Melo попросит принять новые условия ещё раз.",
      ] },
    ],
  },
  privacy: {
    title: "Политика конфиденциальности",
    sections: [
      { h: "Коротко", p: [
        "Melo не продаёт и не передаёт ваши данные третьим лицам. В Melo нет рекламы, аналитики и трекеров.",
        "Для работы нужен аккаунт Melo. Он хранится на сервере Melo (Cloudflare Workers и база данных Cloudflare D1) и нужен только для синхронизации ваших настроек, плейлистов Melo, избранного и истории прослушиваний между компьютерами.",
      ] },
      { h: "Какие данные хранятся и где", p: [
        "Ключ доступа (токен) ВКонтакте, ваше имя и аватар — чтобы не входить каждый раз. Хранятся только на вашем компьютере, в папке данных Melo (её путь указан в «Настройки → О приложении»).",
        "Настройки, громкость, очередь и место, на котором вы остановились, — в локальном хранилище программы на вашем компьютере.",
        "Пароль от ВКонтакте Melo не получает и не хранит: вы вводите его только на официальной странице ВК.",
        "На сервере Melo хранятся: способ входа (ID аккаунта ВКонтакте, логин, адрес почты или ID аккаунта Google), имя и аватар; настройки приложения; ваши плейлисты Melo; избранное; история прослушиваний (название и исполнитель трека, сколько секунд слушали, когда) — для статистики и «итогов года».",
        "Ключ доступа ВКонтакте на сервер не сохраняется: при входе через ВК сервер один раз спрашивает у ВК, чей это аккаунт, и сразу забывает ключ. Сессия Melo хранится на сервере только в виде хеша.",
        "Пароль и код восстановления хранятся только в виде необратимого хеша (PBKDF2/SHA-256) — сам пароль никто, включая разработчика, не видит. Коды входа по почте хранятся 10 минут в виде хеша. Технические записи для защиты от перебора — до 2 суток.",
      ] },
      { h: "С кем общается программа", p: [
        "С серверами ВКонтакте (api.vk.com, id.vk.com, login.vk.com и серверами музыки ВК) — чтобы показать вашу музыку и воспроизвести её. Обработка данных на стороне ВК регулируется политикой конфиденциальности ВКонтакте.",
        "С GitHub (api.github.com) — только чтобы проверить и скачать обновления. При этом GitHub не получает никаких данных о вашем аккаунте ВК.",
        "Музыка воспроизводится через маленький локальный сервер на 127.0.0.1, доступный только с вашего компьютера.",
        "С сервером Melo — для входа и синхронизации. Сервер работает на инфраструктуре Cloudflare, данные могут храниться за пределами вашей страны.",
        "С Cloudflare Turnstile — проверка «не робот» при входе и регистрации. С сервисом Resend — чтобы отправить письмо с кодом. С Google — только если вы выбрали вход через Google.",
      ] },
      { h: "Ваш контроль", p: [
        "Выйти из аккаунта можно в меню профиля или в настройках — ключ доступа удалится с компьютера. Удалив папку данных Melo, вы удалите всё, что программа хранила.",
        "Отозвать доступ также можно в настройках безопасности ВКонтакте («Приложения и сайты» / «Активные сеансы»).",
        "В «Настройки → Аккаунт Melo» можно очистить историю прослушиваний, выйти на всех устройствах или удалить аккаунт Melo — тогда с сервера сразу удаляются все связанные с ним данные.",
      ] },
      { h: "Дети", p: [
        "Melo не предназначена для сбора данных детей и не собирает их. Возрастные ограничения на использование ВКонтакте определяются правилами ВК.",
      ] },
      { h: "Контакты", p: [
        "Вопросы и сообщения о проблемах — в разделе Issues репозитория github.com/wtf40iq/Melo.",
      ] },
    ],
  },
};

const en: typeof ru = {
  terms: {
    title: "Terms of Use",
    sections: [
      { h: "1. What Melo is", p: [
        "Melo is a free, open-source Windows app for listening to music from your VK account. The source code is on GitHub: github.com/wtf40iq/Melo.",
        "Melo is an unofficial client. It is not affiliated with or endorsed by VK. “VK” and “VKontakte” are trademarks of their respective owners.",
      ] },
      { h: "2. Accepting the terms", p: ["By ticking the box on the sign-in screen and using the app you agree to these Terms and the Privacy Policy. If you do not agree, do not use the app."] },
      { h: "3. Your VK account", p: [
        "You need a VK account. Sign-in happens through official VK pages and mechanisms (QR code or the VK sign-in page). Melo never sees or stores your password.",
        "You agree to follow VK's terms of service and not to use Melo to violate them.",
      ] },
      { h: "4. Music and copyright", p: [
        "All music, artwork and lyrics belong to their rights holders and are provided by VK. Melo only plays what is available to your account.",
        "The app is for personal, non-commercial use. Using Melo to download, redistribute or otherwise infringe rights to music is prohibited.",
      ] },
      { h: "5. Free of charge", p: ["Melo is free, with no ads or paid features. If someone sells you Melo, it is not the original."] },
      { h: "6. Updates", p: ["The app may check GitHub for new versions and install them with your consent. Automatic checks can be turned off in Settings."] },
      { h: "7. No warranty", p: [
        "The app is provided “as is”. VK may change its services at any time, and some features may stop working.",
        "To the extent permitted by law, the author is not liable for any direct or indirect damage, account restrictions or data loss related to using the app.",
      ] },
      { h: "8. Changes", p: ["These Terms may be updated together with the app. After significant changes Melo will ask you to accept them again."] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      { h: "In short", p: [
        "Melo does not sell or share your data with third parties. There are no ads, analytics or trackers.",
        "Melo requires a Melo account. It is stored on the Melo server (Cloudflare Workers and Cloudflare D1) and is used only to sync your settings, Melo playlists, favorites and listening history between computers.",
      ] },
      { h: "What is stored and where", p: [
        "Your VK access token, name and avatar, so you don't have to sign in every time. They are stored only on your computer, in Melo's data folder (shown in Settings → About).",
        "Settings, volume, queue and playback position are kept in the app's local storage on your computer.",
        "Melo never receives or stores your VK password: you enter it only on the official VK page.",
        "The Melo server stores: your sign-in method (VK account ID, username, email address or Google account ID), name and avatar; app settings; your Melo playlists; favorites; listening history (track title and artist, how many seconds you listened and when) for stats and your year in music.",
        "Your VK access token is never saved on the server: when you sign in with VK, the server asks VK once whose account it is and immediately forgets the token. Melo sessions are stored on the server only as a hash.",
        "Your password and recovery code are stored only as an irreversible hash (PBKDF2/SHA-256) — nobody, including the developer, can see the password. Email sign-in codes are kept for 10 minutes as a hash. Technical anti-abuse records are kept for up to 2 days.",
      ] },
      { h: "Who the app talks to", p: [
        "VK servers (api.vk.com, id.vk.com, login.vk.com and VK music servers) to show and play your music. VK's own privacy policy applies to data processed by VK.",
        "GitHub (api.github.com) only to check for and download updates. GitHub receives no information about your VK account.",
        "Music plays through a tiny local server on 127.0.0.1 that is reachable only from your computer.",
        "The Melo server, for sign-in and sync. It runs on Cloudflare infrastructure; data may be stored outside your country.",
        "Cloudflare Turnstile for the robot check on sign-in and sign-up, Resend to deliver the code email, and Google only if you choose Google sign-in.",
      ] },
      { h: "Your control", p: [
        "Sign out from the profile menu or Settings and the token is removed from your computer. Deleting Melo's data folder removes everything the app stored.",
        "You can also revoke access in VK security settings (apps and active sessions).",
        "In Settings → Melo account you can clear your listening history, sign out everywhere or delete your Melo account — all related data is then removed from the server immediately.",
      ] },
      { h: "Children", p: ["Melo is not designed to collect children's data and does not collect it. Age limits for VK are set by VK's rules."] },
      { h: "Contact", p: ["Questions and bug reports: Issues on github.com/wtf40iq/Melo."] },
    ],
  },
};

export const legal = (lang: string) => (lang === "en" ? en : ru);
export const termsAccepted = () => localStorage.getItem("melo.terms") === LEGAL_VERSION;
export const acceptTerms = (v: boolean) => (v ? localStorage.setItem("melo.terms", LEGAL_VERSION) : localStorage.removeItem("melo.terms"));
