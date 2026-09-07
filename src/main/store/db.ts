import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { runMigrations } from './migrations'

export function openDatabase(): Database.Database {
  const file = join(app.getPath('userData'), 'zhumora-studio.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
  return db
}
