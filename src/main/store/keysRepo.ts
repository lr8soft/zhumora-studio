import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ApiKeyInfo } from '@shared/types'

interface KeyRow {
  id: string
  name: string | null
  key: string
  created_at: number
}

export class KeysRepo {
  constructor(private db: Database.Database) {}

  list(): ApiKeyInfo[] {
    const rows = this.db.prepare('SELECT id, name, key, created_at FROM api_keys ORDER BY created_at ASC').all() as KeyRow[]
    return rows.map((r) => ({ id: r.id, name: r.name ?? '', key: r.key, createdAt: r.created_at }))
  }

  add(name: string, key: string): ApiKeyInfo {
    const info: ApiKeyInfo = { id: randomUUID(), name, key, createdAt: Date.now() }
    this.db.prepare('INSERT INTO api_keys (id, name, key, created_at) VALUES (?, ?, ?, ?)').run(info.id, name, key, info.createdAt)
    return info
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id)
  }

  /** 注入 server 的 key 列表（逗号分隔前的数组） */
  activeKeys(): string[] {
    const rows = this.db.prepare('SELECT key FROM api_keys ORDER BY created_at ASC').all() as { key: string }[]
    return rows.map((r) => r.key)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }
    return row.n
  }
}
