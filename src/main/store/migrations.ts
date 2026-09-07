import type Database from 'better-sqlite3'

export const SCHEMA_VERSION = 1

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined
  const current = row ? Number(row.value) : 0

  const migrate = db.transaction(() => {
    if (current < 1) {
      db.exec(`
        CREATE TABLE models (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          size INTEGER NOT NULL,
          arch TEXT,
          quant TEXT,
          added_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          model_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          tokens_per_sec REAL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_messages_session ON messages(session_id, created_at);
      `)
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    )
  })
  migrate()
}
