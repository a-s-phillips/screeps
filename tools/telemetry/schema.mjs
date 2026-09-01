// Shared schema setup for the telemetry sqlite db, used by both the live poller
// and tests (so tests exercise the exact same schema/indexes as production).
export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      event TEXT NOT NULL,
      data TEXT,
      seen_at INTEGER NOT NULL,
      UNIQUE(tick, event, data)
    );
    CREATE INDEX IF NOT EXISTS idx_logs_event_seen_at ON logs(event, seen_at);
  `);
}
