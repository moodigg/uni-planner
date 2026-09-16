-- Uni Planner push: one row per phone/browser that turned notifications on.
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,           -- random id chosen by the server
  token_hash   TEXT NOT NULL,              -- sha-256 of the device's secret token
  endpoint     TEXT NOT NULL UNIQUE,       -- push service URL for this browser
  p256dh       TEXT NOT NULL,              -- browser's public key (base64url)
  auth         TEXT NOT NULL,              -- browser's auth secret (base64url)
  tz           TEXT NOT NULL,              -- IANA time zone, e.g. Asia/Dubai
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_test_at INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0
);

-- What to notify about. Replaced wholesale on every sync from the app.
--   kind 'class': weekly, fires CLASS_LEAD_MIN before `start_min` on weekday `day` (device local time)
--   kind 'once' : fires at absolute time `at` (ms since epoch)
CREATE TABLE IF NOT EXISTS rules (
  device_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  day        INTEGER,
  start_min  INTEGER,
  at         INTEGER,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT NOT NULL,
  ttl        INTEGER NOT NULL DEFAULT 900,
  created_at INTEGER NOT NULL DEFAULT 0   -- when this alert first appeared (see ruleStatements)
);
CREATE INDEX IF NOT EXISTS rules_device ON rules(device_id);
CREATE INDEX IF NOT EXISTS rules_kind_at ON rules(kind, at);

-- Delivered notifications, so a minute-by-minute check never sends the same one twice.
CREATE TABLE IF NOT EXISTS sent (
  device_id TEXT NOT NULL,
  tag       TEXT NOT NULL,
  fire_at   INTEGER NOT NULL,
  sent_at   INTEGER NOT NULL,
  PRIMARY KEY (device_id, tag, fire_at)
);
CREATE INDEX IF NOT EXISTS sent_at_idx ON sent(sent_at);

-- last scheduled run, for /health monitoring
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
