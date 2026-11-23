-- Urządzenia z włączonymi powiadomieniami (subskrypcje Web Push)
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_uid ON subscriptions (uid);

-- Najbliższe przypomnienia (kopia z aplikacji – źródłem prawdy są zadania w Firestore)
CREATE TABLE IF NOT EXISTS reminders (
  uid TEXT NOT NULL,
  task_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, task_id)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (sent, at);
