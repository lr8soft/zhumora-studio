import type Database from 'better-sqlite3'
import type { UsageDaily, UsageModel, UsageSummary } from '@shared/types'

/** 用量统计：对 messages 表的 token 列做聚合（只统计有 usage 的 assistant 消息 = 一次请求） */
export class UsageRepo {
  constructor(private db: Database.Database) {}

  summary(): UsageSummary {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion
         FROM messages
         WHERE role = 'assistant' AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)`
      )
      .get() as { requests: number; prompt: number; completion: number }
    return {
      requests: row.requests,
      prompt: row.prompt,
      completion: row.completion,
      total: row.prompt + row.completion
    }
  }

  /** 近 days 天（含今天）每日聚合，按日期升序 */
  daily(days: number): UsageDaily[] {
    const now = Date.now()
    const startDay = new Date(now)
    startDay.setHours(0, 0, 0, 0)
    const from = startDay.getTime() - (days - 1) * 86400000
    const rows = this.db
      .prepare(
        `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
                model_id,
                COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion
         FROM messages
         WHERE role = 'assistant'
           AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
           AND created_at >= ?
         GROUP BY day, model_id
         ORDER BY day ASC`
      )
      .all(from) as { day: string; model_id: string; requests: number; prompt: number; completion: number }[]
    const map = new Map<string, UsageDaily>()
    for (const r of rows) {
      const cur =
        map.get(r.day) ?? { day: r.day, requests: 0, prompt: 0, completion: 0 }
      cur.requests += r.requests
      cur.prompt += r.prompt
      cur.completion += r.completion
      map.set(r.day, cur)
    }
    return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  }

  byModel(): UsageModel[] {
    const rows = this.db
      .prepare(
        `SELECT model_id,
                COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion,
                COALESCE(AVG(tokens_per_sec), 0) AS tps
         FROM messages
         WHERE role = 'assistant'
           AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
         GROUP BY model_id
         ORDER BY (SUM(prompt_tokens) + SUM(completion_tokens)) DESC`
      )
      .all() as { model_id: string; requests: number; prompt: number; completion: number; tps: number }[]
    return rows.map((r) => ({
      modelId: r.model_id,
      requests: r.requests,
      prompt: r.prompt,
      completion: r.completion,
      total: r.prompt + r.completion,
      avgTps: r.tps > 0 ? r.tps : undefined
    }))
  }

  /** 清空统计：只置空 token 计数，保留会话与消息内容 */
  clear(): void {
    this.db
      .prepare('UPDATE messages SET prompt_tokens = NULL, completion_tokens = NULL, tokens_per_sec = NULL WHERE role = \'assistant\'')
      .run()
  }
}
