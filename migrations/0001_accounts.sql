PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  details TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(user_id,id)
);
CREATE INDEX IF NOT EXISTS flights_user_date_idx ON flights(user_id,date DESC);
CREATE TABLE IF NOT EXISTS flight_sources (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, flight_id TEXT NOT NULL,
  name TEXT NOT NULL, original_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,flight_id) REFERENCES flights(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sources_user_flight_idx ON flight_sources(user_id,flight_id);
CREATE TABLE IF NOT EXISTS auth_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
