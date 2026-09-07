import type Database from 'better-sqlite3'
import type { ModelInfo } from '@shared/types'

interface ModelRow {
  id: string
  name: string
  path: string
  size: number
  arch: string | null
  quant: string | null
  added_at: number
}

function toModel(row: ModelRow): ModelInfo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    size: row.size,
    arch: row.arch ?? undefined,
    quant: row.quant ?? undefined,
    addedAt: row.added_at
  }
}

export class ModelsRepo {
  constructor(private db: Database.Database) {}

  list(): ModelInfo[] {
    const rows = this.db.prepare('SELECT * FROM models ORDER BY added_at DESC').all() as ModelRow[]
    return rows.map(toModel)
  }

  upsert(model: ModelInfo): void {
    this.db
      .prepare(
        `INSERT INTO models (id, name, path, size, arch, quant, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, size = excluded.size,
           arch = COALESCE(excluded.arch, models.arch),
           quant = COALESCE(excluded.quant, models.quant)`
      )
      .run(model.id, model.name, model.path, model.size, model.arch ?? null, model.quant ?? null, model.addedAt)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM models WHERE id = ?').run(id)
  }
}
