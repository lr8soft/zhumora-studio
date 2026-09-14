import type Database from 'better-sqlite3'
import type { UsageRequest } from '@shared/types'

const MAX_ROWS = 10000

interface RequestRow {
  id: number
  ip: string
  api_key: string
  endpoint: string
  status: number
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  created_at: number
}

export interface LogEntry {
  ip: string
  apiKey: string
  endpoint: string
  status: number
  model?: string
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
}

/** 外部 API 调用记录：哪个 ip + 哪个 api key 在什么时候调用了哪个端点（反向代理捕获） */
export class RequestLogRepo {
  constructor(private db: Database.Database) {}

  log(entry: LogEntry): void {
    this.db
      .prepare(
        `INSERT INTO usage_requests (ip, api_key, endpoint, status, model, prompt_tokens, completion_tokens, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.ip,
        entry.apiKey,
        entry.endpoint,
        entry.status,
        entry.model ?? null,
        entry.promptTokens ?? null,
        entry.completionTokens ?? null,
        entry.durationMs ?? null,
        Date.now()
      )
    // 控制行数
    this.db
      .prepare('DELETE FROM usage_requests WHERE id NOT IN (SELECT id FROM usage_requests ORDER BY id DESC LIMIT ?)')
      .run(MAX_ROWS)
  }

  /** 最近 limit 条（新→旧），附带 key 名称 */
  recent(limit: number): UsageRequest[] {
    const rows = this.db.prepare('SELECT * FROM usage_requests ORDER BY id DESC LIMIT ?').all(limit) as RequestRow[]
    const names = this.db.prepare('SELECT key, name FROM api_keys').all() as { key: string; name: string | null }[]
    const nameOf = new Map(names.map((n) => [n.key, n.name ?? '']))
    return rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      key: r.api_key,
      name: r.api_key ? nameOf.get(r.api_key) ?? '' : '',
      endpoint: r.endpoint,
      status: r.status,
      prompt: r.prompt_tokens ?? undefined,
      completion: r.completion_tokens ?? undefined,
      durationMs: r.duration_ms ?? undefined,
      createdAt: r.created_at
    }))
  }
}
