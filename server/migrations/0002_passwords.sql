-- Вход по логину и паролю. В базе только хеш пароля (PBKDF2-SHA256 с солью)
-- и хеш кода восстановления; сами пароль и код не хранятся.
CREATE TABLE passwords (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  login         TEXT NOT NULL UNIQUE,
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  iters         INTEGER NOT NULL,
  recovery_hash TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
