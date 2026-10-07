-- Пользователи Melo
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  avatar      TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- Способы входа: vk / email / google. Один пользователь — несколько способов.
CREATE TABLE identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- Сессии: храним только SHA-256 от токена
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Коды входа по почте
CREATE TABLE email_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  sent_at     INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Ожидающие входы через браузер (Google)
CREATE TABLE login_requests (
  id          TEXT PRIMARY KEY,
  poll_hash   TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  link_user   TEXT,
  user_id     TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Ограничение частоты запросов
CREATE TABLE rate_limits (
  key         TEXT PRIMARY KEY,
  win_start   INTEGER NOT NULL,
  count       INTEGER NOT NULL
);

-- Настройки приложения (JSON)
CREATE TABLE settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Свои плейлисты Melo: треки из любых источников (JSON-массив)
CREATE TABLE playlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  tracks      TEXT NOT NULL DEFAULT '[]',
  share_slug  TEXT UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX playlists_user ON playlists(user_id, updated_at);

-- Избранное (не зависит от источника)
CREATE TABLE favorites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_key   TEXT NOT NULL,
  track       TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key)
);

-- История прослушиваний — для статистики и «итогов года»
CREATE TABLE history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_key   TEXT NOT NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  source      TEXT NOT NULL,
  seconds     INTEGER NOT NULL,
  played_at   INTEGER NOT NULL
);
CREATE INDEX history_user_time ON history(user_id, played_at);
