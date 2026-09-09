import type { HfFile, HfModel } from '@shared/types'

const API = 'https://huggingface.co/api'
const UA = { 'User-Agent': 'zhumora-studio' }

interface GhModelRow {
  id: string
  downloads: number
  likes: number
  tags: string[]
}

interface TreeRow {
  path: string
  size?: number
  lfs?: { size?: number }
}

/** 搜索 GGUF 模型（按下载量排序） */
export async function searchModels(query: string, limit = 30): Promise<HfModel[]> {
  const q = query.trim()
  const url = `${API}/models?filter=gguf&search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=${limit}`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`HF 搜索失败: HTTP ${res.status}`)
  const rows = (await res.json()) as GhModelRow[]
  return rows.map((r) => ({
    id: r.id,
    downloads: r.downloads ?? 0,
    likes: r.likes ?? 0,
    tags: r.tags ?? []
  }))
}

/** 列出仓库内全部 gguf 文件（模型 + mmproj） */
export async function repoFiles(repoId: string): Promise<HfFile[]> {
  const res = await fetch(`${API}/models/${repoId}/tree/main?recursive=true`, { headers: UA })
  if (!res.ok) throw new Error(`HF 文件列表失败: HTTP ${res.status}`)
  const rows = (await res.json()) as TreeRow[]
  const files: HfFile[] = []
  for (const r of rows) {
    if (!r.path.toLowerCase().endsWith('.gguf')) continue
    const size = r.lfs?.size ?? r.size ?? 0
    files.push({ path: r.path, size })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/** 文件下载 URL（302 到 CDN，支持 Range） */
export function fileUrl(repoId: string, filePath: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

/** 从路径推断量化标签 */
export function quantFromPath(filePath: string): string | undefined {
  const base = filePath.split('/').pop() ?? ''
  const m = base.match(/\b(f16|f32|bf16|q[2-8]_[a-z0-9]+|iq[2-8]_[a-z0-9]+)\b/i)
  return m ? m[1].toLowerCase() : undefined
}

/** 是否为多模态投影文件 */
export function isMmprojPath(filePath: string): boolean {
  const base = (filePath.split('/').pop() ?? '').toLowerCase()
  return base.startsWith('mmproj') || base.includes('projector') || base.includes('clip')
}
