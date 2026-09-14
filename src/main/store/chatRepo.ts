import type Database from 'better-sqlite3'
import type { ChatMessage, ChatSession } from '@shared/types'

interface SessionRow {
  id: string
  title: string
  model_id: string
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  prompt_tokens: number | null
  completion_tokens: number | null
  tokens_per_sec: number | null
  model_id: string | null
  api_key: string | null
  created_at: number
}

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    usage:
      row.prompt_tokens != null || row.completion_tokens != null
        ? { prompt: row.prompt_tokens ?? 0, completion: row.completion_tokens ?? 0 }
        : undefined,
    tokensPerSec: row.tokens_per_sec ?? undefined,
    modelId: row.model_id ?? undefined,
    createdAt: row.created_at
  }
}

export class ChatRepo {
  constructor(private db: Database.Database) {}

  sessions(): ChatSession[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]
    return rows.map(toSession)
  }

  createSession(session: ChatSession): void {
    this.db
      .prepare('INSERT INTO sessions (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, session.title, session.modelId, session.createdAt, session.updatedAt)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  touchSession(id: string): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  renameSession(id: string, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
  }

  /** 清空消息的 token 计数（用量统计已迁到 usage_requests；此为旧列清理） */
  clearUsage(): void {
    this.db
      .prepare('UPDATE messages SET prompt_tokens = NULL, completion_tokens = NULL, tokens_per_sec = NULL WHERE role = \'assistant\'')
      .run()
  }

  messages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(sessionId) as MessageRow[]
    return rows.map(toMessage)
  }

  saveMessage(sessionId: string, message: ChatMessage): void {
    const usage = message.usage
    this.db
      .prepare(
        `INSERT OR REPLACE INTO messages
         (id, session_id, role, content, prompt_tokens, completion_tokens, tokens_per_sec, model_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        sessionId,
        message.role,
        message.content,
        usage?.prompt ?? null,
        usage?.completion ?? null,
        message.tokensPerSec ?? null,
        message.modelId ?? null,
        message.createdAt
      )
  }
}
