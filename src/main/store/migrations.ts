import type Database from 'better-sqlite3'

export const SCHEMA_VERSION = 5

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
          kind TEXT NOT NULL DEFAULT 'model',
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
    if (current < 2) {
      // v1 老库的 models 表补 kind 列
      const hasKind = db.prepare(`SELECT 1 FROM pragma_table_info('models') WHERE name = 'kind'`).get()
      if (!hasKind) {
        db.exec(`ALTER TABLE models ADD COLUMN kind TEXT NOT NULL DEFAULT 'model'`)
      }
    }
    if (current < 3) {
      // 密钥表 + messages 记录产生回复的模型（用量统计按模型归组）
      db.exec(`
        CREATE TABLE api_keys (
          id TEXT PRIMARY KEY,
          name TEXT,
          key TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
      `)
      const hasModelId = db.prepare(`SELECT 1 FROM pragma_table_info('messages') WHERE name = 'model_id'`).get()
      if (!hasModelId) {
        db.exec(`ALTER TABLE messages ADD COLUMN model_id TEXT`)
      }
    }
    if (current < 4) {
      // 调用记录（ip / key / 端点 / 时间 / token）——反向代理捕获所有请求，
      // 用量统计改为以本表为源，从而可按 api-key 区分
      db.exec(`
        CREATE TABLE IF NOT EXISTS usage_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          api_key TEXT NOT NULL DEFAULT '',
          endpoint TEXT NOT NULL DEFAULT '',
          status INTEGER NOT NULL,
          model TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_usage_requests_time ON usage_requests(created_at DESC);
        CREATE INDEX idx_usage_requests_key ON usage_requests(api_key);
      `)
      // 回填：v3 及以前的本地聊天 token 记录 → usage_requests（key = ''，来源 = 应用内）
      db.exec(
        `INSERT INTO usage_requests (ip, api_key, endpoint, status, model, prompt_tokens, completion_tokens, duration_ms, created_at)
         SELECT 'local', '', 'POST /v1/chat/completions', 200, model_id,
                prompt_tokens, completion_tokens,
                CASE WHEN tokens_per_sec > 0 AND completion_tokens > 0
                     THEN CAST(completion_tokens / tokens_per_sec * 1000 AS INTEGER) END,
                created_at
         FROM messages
         WHERE role = 'assistant' AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)`
      )
    }
    if (current < 5) {
      // models 表补 GGUF 元数据列（启动参数推演用：block_count / n_head / n_embd 等 JSON）
      const hasMeta = db.prepare(`SELECT 1 FROM pragma_table_info('models') WHERE name = 'meta'`).get()
      if (!hasMeta) {
        db.exec(`ALTER TABLE models ADD COLUMN meta TEXT`)
      }
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    )
  })
  migrate()
}
