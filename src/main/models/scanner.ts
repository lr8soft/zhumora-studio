import { readdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { modelInfoFromPath } from './gguf'
import type { ModelInfo } from '@shared/types'
import type { ModelsRepo } from '../store/modelsRepo'

/** 扫描 models 目录下 *.gguf，解析入库。返回本次发现的模型列表。 */
export function scanModelsDir(dir: string, repo: ModelsRepo): ModelInfo[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const found: ModelInfo[] = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.gguf')) continue
    const filePath = join(dir, entry)
    const id = randomUUID()
    const model = modelInfoFromPath(filePath, id, Date.now())
    repo.upsert(model)
    found.push(model)
  }
  return found
}
