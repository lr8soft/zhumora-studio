import type { HfCapabilities, HfFile, HfModel, HfModelDetail, HfSort } from '@shared/types'

const API = 'https://huggingface.co/api'
const UA = { 'User-Agent': 'zhumora-studio', Accept: 'application/json' }

interface Row {
  id: string
  downloads?: number
  likes?: number
  tags?: string[]
  pipeline_tag?: string
  createdAt?: string
  lastModified?: string
  gated?: boolean
  gguf?: {
    architecture?: string
    context_length?: number
    total?: number
  }
}

// ---------- 列表 / 详情 行 → HfModel ----------

function capabilitiesFrom(id: string, tags: string[], pipeline: string | undefined, arch?: string): HfCapabilities {
  const name = id.toLowerCase()
  return {
    vision:
      tags.includes('image-text-to-text') ||
      pipeline === 'image-text-to-text' ||
      (arch ? /vl|vision|video|image/i.test(arch) : false) ||
      /-vl|vision|video|image/i.test(name),
    tool: tags.includes('function-calling') || tags.includes('tool-use'),
    reasoning:
      tags.includes('reasoning') ||
      /thinking|qwen3|deepseek-r1|(^|[^a-z])r1([^a-z]|$)|reason/i.test(name)
  }
}

/** 从仓库名推断参数量："Qwen3-Coder-30B-A3B" → "30B · A3B 激活"；"gemma-7b" → "7B" */
function paramsFromName(id: string): string | undefined {
  const name = id.toLowerCase()
  const total = name.match(/(\d+(?:\.\d+)?)\s?b\b/)
  if (!total) return undefined
  const active = name.match(/-a(\d+(?:\.\d+)?)\s?b\b/)
  const t = `${total[1]}B`
  return active ? `${t} · A${active[1]}B 激活` : t
}

function licenseFromTags(tags: string[]): string | undefined {
  const l = tags.find((t) => t.startsWith('license:'))
  return l ? l.slice('license:'.length) : undefined
}

function mapModel(r: Row): HfModel {
  const id = r.id
  const tags = r.tags ?? []
  const arch = r.gguf?.architecture
  const lastModified = r.lastModified ?? r.createdAt
  return {
    id,
    downloads: r.downloads ?? 0,
    likes: r.likes ?? 0,
    tags,
    pipelineTag: r.pipeline_tag,
    createdAt: r.createdAt,
    lastModified,
    capabilities: capabilitiesFrom(id, tags, r.pipeline_tag, arch),
    params: paramsFromName(id),
    arch,
    contextLength: r.gguf?.context_length,
    license: licenseFromTags(tags),
    gated: r.gated ?? false,
    totalSize: r.gguf?.total
  }
}

const SORTS: Record<HfSort, string> = {
  best: 'downloads',
  likes: 'likes',
  updated: 'lastModified'
}

/** 搜索 GGUF 模型。空 query + best = 精选/热门列表 */
export async function searchModels(query: string, sort: HfSort = 'best', limit = 24): Promise<HfModel[]> {
  const q = query.trim()
  const url = `${API}/models?filter=gguf${
    q ? `&search=${encodeURIComponent(q)}` : ''
  }&sort=${SORTS[sort]}&direction=-1&limit=${limit}`
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`HF 搜索失败: HTTP ${res.status}`)
  const rows = (await res.json()) as Row[]
  return rows.map(mapModel)
}

// ---------- 文件 / README ----------

interface TreeRow {
  path: string
  size?: number
  lfs?: { size?: number }
}

/** 列出仓库内全部 gguf 文件（模型 + mmproj），按文件名排序 */
export async function repoFiles(repoId: string): Promise<HfFile[]> {
  const res = await fetch(`${API}/models/${repoId}/tree/main?recursive=true`, { headers: UA })
  if (res.status === 401) return []
  if (!res.ok) throw new Error(`HF 文件列表失败: HTTP ${res.status}`)
  const rows = (await res.json()) as TreeRow[]
  const files: HfFile[] = []
  for (const r of rows) {
    if (!r.path.toLowerCase().endsWith('.gguf')) continue
    files.push({ path: r.path, size: r.lfs?.size ?? r.size ?? 0 })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

/** 拉取仓库 README（raw），失败返回空串。截断到 maxLen 字符 */
export async function fetchReadme(repoId: string, maxLen = 6000): Promise<string> {
  for (const name of ['README.md', 'README']) {
    const res = await fetch(`https://huggingface.co/${repoId}/raw/main/${name}`, { headers: UA })
    if (res.ok) {
      const text = await res.text()
      return text.length > maxLen ? text.slice(0, maxLen) : text
    }
  }
  return ''
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 拉取仓库元数据。404 → null；401(gated) → 占位；其它错误 → 抛出 */
async function fetchRepoModel(repoId: string): Promise<HfModel | null> {
  const res = await fetch(`${API}/models/${repoId}`, { headers: UA })
  if (res.status === 404) return null
  if (res.status === 401) {
    return {
      id: repoId,
      downloads: 0,
      likes: 0,
      tags: [],
      capabilities: capabilitiesFrom(repoId, [], undefined),
      params: paramsFromName(repoId),
      gated: true
    }
  }
  if (!res.ok) throw new Error(`HF 详情失败: HTTP ${res.status}`)
  return mapModel((await res.json()) as Row)
}

/** 仓库详情：元数据 + 文件 + README 预览，一次取齐（容错：gated/404 不抛；元数据失败重试一次） */
export async function getModelDetail(repoId: string): Promise<HfModelDetail> {
  let model: HfModel | null = null
  try {
    model = await fetchRepoModel(repoId)
  } catch {
    model = null
  }

  // 元数据为空（多为瞬时限流/网络抖动）→ 重试一次
  if (!model || (model.downloads === 0 && model.likes === 0 && !model.arch && !model.license)) {
    await sleep(400)
    try {
      const retry = await fetchRepoModel(repoId)
      if (retry && (retry.downloads > 0 || retry.arch || retry.license)) model = retry
    } catch {
      // 保持现状
    }
  }

  const [files, readme] = await Promise.all([
    repoFiles(repoId).catch(() => [] as HfFile[]),
    fetchReadme(repoId).catch(() => '')
  ])

  const m: HfModel = model ?? {
    id: repoId,
    downloads: 0,
    likes: 0,
    tags: [],
    capabilities: capabilitiesFrom(repoId, [], undefined),
    params: paramsFromName(repoId),
    gated: true
  }
  m.totalSize = files.reduce((s, f) => s + f.size, 0)

  return { model: m, shortDescription: shortDescription(readme), readme, files }
}

/** 从 README 提取首段描述（跳过 front-matter/标题/元数据），供详情页展示 */
export function shortDescription(readme: string, maxLen = 220): string | undefined {
  let text = readme.trim()
  // 去掉 YAML front-matter（HF 仓库自动生成的 license/pipeline_tag 等）
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
  const lines = text.split('\n')
  const buf: string[] = []
  let started = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (started) break
      continue
    }
    // 跳过标题、图片、表格、链接、徽章、引用、列表
    if (/^#|!\[|\[|^\||^>|^<|^\-|^\*/.test(line)) continue
    if (/^[\w.\/-]+\.(png|jpg|gif|svg|md|txt)$/i.test(line)) continue
    started = true
    buf.push(line)
    if (buf.join(' ').length >= maxLen) break
  }
  const out = buf.join(' ').replace(/[*_`]/g, '').trim()
  return out || undefined
}

/** 文件下载 URL（302 到 CDN，支持 Range） */
export function fileUrl(repoId: string, filePath: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

// ---------- 作者头像 ----------
// HF 无轻量 JSON 端点，头像 URL 嵌在 owner 页面 HTML 里（cdn-avatars.huggingface.co）。
// 抓取页面提取 + 内存缓存（60 分钟）+ 并发限制（3），避免对 HF 造成压力。

const AVATAR_TTL = 60 * 60 * 1000
const AVATAR_NEG_TTL = 5 * 60 * 1000
const avatarCache = new Map<string, { url: string | null; at: number }>()
let avatarInflight = 0

function extractOwnerAvatar(html: string, owner: string): string | null {
  const h = html.replace(/&quot;/g, '"')
  // 组织：{"org":{"avatarUrl":"...","fullname":"...","name":"Qwen","type":"org"...
  let m = h.match(/"org":\{"avatarUrl":"(https:\/\/cdn-avatars\.huggingface\.co\/[^"]+)"/)
  if (m) return m[1]
  // 用户：页面内 "name":"owner" 附近的 avatarUrl
  const idx = h.indexOf(`"name":"${owner}"`)
  if (idx > -1) {
    const seg = h.slice(Math.max(0, idx - 400), idx + 400)
    const am = seg.match(/"avatarUrl":"(https:\/\/cdn-avatars\.huggingface\.co\/[^"]+)"/)
    if (am) return am[1]
  }
  return null
}

/** 取作者头像 URL；没有/失败返回 null。带缓存与并发限制 */
export async function getOwnerAvatar(owner: string): Promise<string | null> {
  const hit = avatarCache.get(owner)
  if (hit && Date.now() - hit.at < AVATAR_TTL) return hit.url
  // 并发保护：最多 3 个同时抓
  while (avatarInflight >= 3) await sleep(120)
  avatarInflight++
  try {
    const res = await fetch(`https://huggingface.co/${owner}`, {
      headers: { 'User-Agent': 'zhumora-studio', Accept: 'text/html' }
    })
    if (!res.ok) throw new Error(`HF owner 页失败: HTTP ${res.status}`)
    const url = extractOwnerAvatar(await res.text(), owner)
    avatarCache.set(owner, { url, at: Date.now() })
    return url
  } catch {
    // 失败短缓存 5 分钟，避免反复打
    avatarCache.set(owner, { url: null, at: Date.now() - (AVATAR_TTL - AVATAR_NEG_TTL) })
    return null
  } finally {
    avatarInflight--
  }
}
