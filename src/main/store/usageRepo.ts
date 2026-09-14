import type Database from 'better-sqlite3'
import type { UsageByKey, UsageDaily, UsageModel, UsageSummary } from '@shared/types'

/**
 * 用量统计：以 usage_requests（反向代理逐请求捕获）为源，
 * 因而可按 api-key 区分。key = '' 表示本地 / 无 key（应用内或无鉴权直连）。
 */
export class UsageRepo {
  constructor(private db: Database.Database) {}

  summary(key?: KeyFilter): UsageSummary {
    const k = keyClause(key)
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion
          FROM usage_requests
          WHERE 1=1${k.sql}`
      )
      .get(...k.params) as { requests: number; prompt: number; completion: number }
    return {
      requests: row.requests,
      prompt: row.prompt,
      completion: row.completion,
      total: row.prompt + row.completion
    }
  }

  /** 近 days 天（含今天）每日聚合，按日期升序 */
  daily(days: number, key?: KeyFilter): UsageDaily[] {
    const k = keyClause(key)
    const now = Date.now()
    const startDay = new Date(now)
    startDay.setHours(0, 0, 0, 0)
    const from = startDay.getTime() - (days - 1) * 86400000
    const rows = this.db
      .prepare(
        `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion
          FROM usage_requests
          WHERE created_at >= ?${k.sql}
          GROUP BY day
          ORDER BY day ASC`
      )
      .all(from, ...k.params) as { day: string; requests: number; prompt: number; completion: number }[]
    return rows.map((r) => ({ day: r.day, requests: r.requests, prompt: r.prompt, completion: r.completion }))
  }

  byModel(key?: KeyFilter): UsageModel[] {
    const k = keyClause(key)
    const rows = this.db
      .prepare(
        `SELECT COALESCE(model, '') AS model,
                COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion,
                COALESCE(AVG(CASE WHEN duration_ms > 0 AND completion_tokens > 0
                        THEN completion_tokens / (duration_ms / 1000.0) END), 0) AS tps
          FROM usage_requests
          WHERE 1=1${k.sql}
          GROUP BY model
          ORDER BY (SUM(prompt_tokens) + SUM(completion_tokens)) DESC`
      )
      .all(...k.params) as { model: string; requests: number; prompt: number; completion: number; tps: number }[]
    return rows.map((r) => ({
      modelId: r.model,
      requests: r.requests,
      prompt: r.prompt,
      completion: r.completion,
      total: r.prompt + r.completion,
      avgTps: r.tps > 0 ? r.tps : undefined
    }))
  }

  /** 按 API key 聚合（含本地/无 key 的空串桶），按合计降序 */
  byKey(): UsageByKey[] {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(api_key, '') AS api_key,
                COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion
          FROM usage_requests
          GROUP BY api_key
          ORDER BY (SUM(prompt_tokens) + SUM(completion_tokens)) DESC`
      )
      .all() as { api_key: string; requests: number; prompt: number; completion: number }[]
    const names = this.db.prepare('SELECT key, name FROM api_keys').all() as { key: string; name: string | null }[]
    const nameOf = new Map(names.map((n) => [n.key, n.name ?? '']))
    return rows.map((r) => ({
      key: r.api_key,
      name: r.api_key ? nameOf.get(r.api_key) ?? '' : '',
      requests: r.requests,
      prompt: r.prompt,
      completion: r.completion,
      total: r.prompt + r.completion
    }))
  }

  /** 清空统计：删除全部调用记录 */
  clear(): void {
    this.db.prepare('DELETE FROM usage_requests').run()
  }
}

/** key 过滤：undefined = 全部；'' = 本地/无 key；其他 = 指定 key */
export type KeyFilter = string | undefined

function keyClause(key: KeyFilter): { sql: string; params: unknown[] } {
  if (key === undefined) return { sql: '', params: [] }
  if (key === '') return { sql: " AND COALESCE(api_key, '') = ''", params: [] }
  return { sql: ' AND api_key = ?', params: [key] }
}
