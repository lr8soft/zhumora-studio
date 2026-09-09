import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppStore } from '../store'
import { quantFromPath } from '@shared/hfutil'
import type { HfCapabilities, HfModel, HfModelDetail, HfSort } from '@shared/types'

// ---------- 格式化 ----------
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes > 0) return Math.round(bytes / 1024) + ' KB'
  return '—'
}
function fmtDownloads(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
function fmtCtx(n?: number): string {
  if (!n) return ''
  if (n >= 1024) return (n / 1024).toFixed(n % 1024 === 0 ? 0 : 1) + 'k'
  return String(n)
}
function relTime(iso?: string): string {
  if (!iso) return ''
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return '今天'
  if (d < 30) return `${Math.floor(d)} 天前`
  if (d < 365) return `${Math.floor(d / 30)} 个月前`
  return `${Math.floor(d / 365)} 年前`
}
const authorOf = (id: string) => id.split('/')[0]
const shortName = (id: string) => id.split('/')[1] ?? id

const CAPS: { key: keyof HfCapabilities; label: string; icon: string }[] = [
  { key: 'vision', label: 'Vision', icon: '👁' },
  { key: 'tool', label: 'Tool Use', icon: '🛠' },
  { key: 'reasoning', label: 'Reasoning', icon: '🧠' }
]
function capIcons(c: HfCapabilities): ReactNode {
  return (
    <>
      {CAPS.filter((x) => c[x.key]).map((x) => (
        <span key={x.key} className="cap-ico" title={x.label} style={{ marginLeft: 4 }}>
          {x.icon}
        </span>
      ))}
    </>
  )
}

// ---------- README 轻量渲染（安全，不用 innerHTML） ----------
interface Block {
  type: 'h' | 'p' | 'li' | 'code'
  level?: number
  text: string
}
function stripInline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]/g, '')
    .trim()
}
function parseBlocks(md: string): Block[] {
  const out: Block[] = []
  let inCode = false
  let codeBuf: string[] = []
  for (const raw of md.split('\n')) {
    if (/^```/.test(raw)) {
      if (inCode) {
        out.push({ type: 'code', text: codeBuf.join('\n') })
        codeBuf = []
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }
    const line = raw
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ type: 'h', level: h[1].length, text: stripInline(h[2]) })
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const t = stripInline(line.replace(/^\s*[-*+]\s+/, ''))
      if (t) out.push({ type: 'li', text: t })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const t = stripInline(line.replace(/^\s*\d+\.\s+/, ''))
      if (t) out.push({ type: 'li', text: t })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) continue // 表格：跳过
    if (/^\s*<[^>]+>/.test(line)) continue // 原始 HTML：跳过
    const t = stripInline(line)
    if (t) out.push({ type: 'p', text: t })
  }
  return out
}
function Readme({ md }: { md: string }) {
  const blocks = useMemo(() => parseBlocks(md), [md])
  return (
    <div className="readme">
      {blocks.map((b, i) => {
        if (b.type === 'code')
          return (
            <pre key={i} className="readme-code">
              {b.text}
            </pre>
          )
        if (b.type === 'li')
          return (
            <div key={i} className="readme-li">
              <span className="readme-bullet" />
              {b.text}
            </div>
          )
        const level = b.type === 'h' ? (b.level ?? 2) : 0
        return (
          <div key={i} className={`readme-${b.type} readme-l${level}`}>
            {b.text}
          </div>
        )
      })}
    </div>
  )
}

// ---------- 下载选项行 ----------
function DownloadRow({
  repoId,
  path,
  size,
  downloaded,
  dl,
  onDownload
}: {
  repoId: string
  path: string
  size: number
  downloaded: boolean
  dl?: { status: 'downloading' | 'error'; done: number; total: number; message?: string }
  onDownload: () => void
}) {
  const base = path.split('/').pop() ?? path
  const quant = quantFromPath(path)
  const isMm = base.toLowerCase().startsWith('mmproj')
  const pct = dl && dl.total > 0 ? (dl.done / dl.total) * 100 : 0
  return (
    <div className="dl-row">
      <div className="dl-main">
        <span className="mono">{base}</span>
        {quant && <span className="badge badge-info">{quant}</span>}
        {isMm && <span className="badge badge-stopped">mmproj</span>}
      </div>
      <span className="dl-size">{fmtSize(size)}</span>
      {dl ? (
        dl.status === 'error' ? (
          <span className="dl-err" title={dl.message}>
            失败 · {(dl.message ?? '').slice(0, 14)}
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => void window.zhumora.models.cancelDownload(`${repoId}::${path}`)}>
            {pct > 0 ? pct.toFixed(0) + '% ' : ''}取消
          </button>
        )
      ) : downloaded ? (
        <span className="dl-done">✓ 已下载</span>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={onDownload}>
          下载
        </button>
      )}
      {dl && dl.status === 'downloading' && (
        <div className="progress" style={{ width: '100%' }}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

// ---------- 主视图 ----------
export default function ModelsView() {
  const models = useAppStore((s) => s.models)
  const downloads = useAppStore((s) => s.downloads)
  const loadModels = useAppStore((s) => s.loadModels)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<HfSort>('best')
  const [results, setResults] = useState<HfModel[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HfModelDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const reqSeq = useRef(0)

  const runSearch = async (q: string, s: HfSort) => {
    setSearching(true)
    setSearchError('')
    try {
      const r = await window.zhumora.models.search(q, s)
      setResults(r)
    } catch (e) {
      setSearchError((e as Error).message)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const openModel = async (m: HfModel) => {
    if (selectedId === m.id) return
    const seq = ++reqSeq.current
    setSelectedId(m.id)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const d = await window.zhumora.models.detail(m.id)
      if (seq === reqSeq.current) setDetail(d) // 仅最新请求生效，防竞态
    } catch (e) {
      if (seq === reqSeq.current) setDetailError((e as Error).message)
    } finally {
      if (seq === reqSeq.current) setDetailLoading(false)
    }
  }

  // 初始：精选
  useEffect(() => {
    void runSearch('', 'best')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isTrending = query.trim() === '' && sort === 'best'
  const listLabel = isTrending ? '精选模型' : `搜索结果 · ${results.length}`

  const importedNames = useMemo(() => {
    const set = new Set<string>()
    for (const m of models) set.add(m.path.split(/[\\/]/).pop()?.toLowerCase() ?? '')
    return set
  }, [models])

  const importModel = async () => {
    await window.zhumora.models.import()
    await loadModels()
  }
  const removeModel = async (id: string) => {
    if (!window.confirm('删除该模型文件？')) return
    await window.zhumora.models.remove(id)
    await loadModels()
  }

  const list = models.filter((m) => m.kind === 'model')
  const mmprojs = models.filter((m) => m.kind === 'mmproj')
  const activeDownloads = Object.values(downloads)
  const detailModel = detail?.model

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>模型广场</h2>
          <p>发现、浏览并下载 HuggingFace 上的 GGUF 模型，支持断点续传</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => void importModel()}>
            导入本地 GGUF…
          </button>
          <button className="btn btn-ghost" onClick={() => void loadModels()}>
            重新扫描
          </button>
        </div>
      </div>

      {/* 双栏市场 */}
      <div className="market">
        {/* 左：搜索 + 列表 */}
        <div className="card market-list">
          <div className="market-search">
            <div className="market-search-row">
              <input
                type="text"
                placeholder="在 Hugging Face 上搜索模型…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void runSearch(query, sort)}
              />
              <select
                value={sort}
                onChange={(e) => {
                  const s = e.target.value as HfSort
                  setSort(s)
                  void runSearch(query, s)
                }}
                title="排序"
              >
                <option value="best">最佳匹配</option>
                <option value="likes">最多点赞</option>
                <option value="updated">最新更新</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => void runSearch(query, sort)} disabled={searching}>
                {searching ? '…' : '搜索'}
              </button>
            </div>
            <div className="market-list-label">
              {isTrending && <span className="market-refresh" title="刷新" onClick={() => void runSearch('', sort)}>↻</span>}
              {listLabel}
            </div>
          </div>

          <div className="market-rows">
            {searchError && <div className="status-error" style={{ margin: '0 8px 8px' }}>{searchError}</div>}
            {!searching && results.length === 0 && (
              <div className="hint" style={{ padding: 16 }}>无结果，换个关键词试试</div>
            )}
            {searching && results.length === 0 && <div className="hint" style={{ padding: 16 }}>搜索中…</div>}
            {results.map((m) => (
              <button
                key={m.id}
                className={`mrow${selectedId === m.id ? ' active' : ''}`}
                onClick={() => void openModel(m)}
              >
                <div className="mrow-logo">
                  <span>{shortName(m.id).charAt(0).toUpperCase()}</span>
                  {m.capabilities.vision && <span className="mrow-vision" title="视觉">👁</span>}
                </div>
                <div className="mrow-main">
                  <div className="mrow-name">
                    {shortName(m.id)}
                    {m.gated && <span className="mrow-locked" title="受限仓库">🔒</span>}
                    {capIcons(m.capabilities)}
                  </div>
                  <div className="mrow-sub">
                    {[authorOf(m.id), m.params, `⬇ ${fmtDownloads(m.downloads)}`, relTime(m.lastModified)]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* 进行中下载（紧凑） */}
          {activeDownloads.length > 0 && (
            <div className="market-active">
              {activeDownloads.map((dl) => {
                const pct = dl.total > 0 ? (dl.done / dl.total) * 100 : 0
                return (
                  <div key={dl.id} className="market-active-item">
                    <div className="market-active-top">
                      <span className="mono" title={`${dl.repoId}/${dl.file}`}>
                        {dl.file}
                      </span>
                      <button className="dl-cancel" onClick={() => void window.zhumora.models.cancelDownload(dl.id)}>
                        取消
                      </button>
                    </div>
                    <div className="progress" style={{ height: 5 }}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                    <div className="market-active-meta">
                      {fmtSize(dl.done)} / {fmtSize(dl.total)} · {dl.speed > 0 ? fmtSize(dl.speed) + '/s' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 右：详情 */}
        <div className="card market-detail">
          {!detailModel && !detailLoading && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div>
                <div className="mark">🔍</div>
                从左侧选择一个模型查看详情
              </div>
            </div>
          )}

          {detailLoading && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div>
                <div className="mark" style={{ animation: 'pulse 1.2s infinite' }}>⏳</div>
                正在解析模型详情…
              </div>
            </div>
          )}

          {detailError && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div>
                <div className="mark">⚠</div>
                {detailError}
              </div>
            </div>
          )}

          {detailModel && detail && (
            <div className="detail-scroll">
              {/* 头部 */}
              <div className="detail-head">
                <div className="detail-logo">
                  <span>{shortName(detailModel.id).charAt(0).toUpperCase()}</span>
                </div>
                <div className="detail-title-wrap" style={{ flex: 1, minWidth: 0 }}>
                  <div className="detail-title">
                    {detailModel.id}
                    {detailModel.gated && <span className="mrow-locked" title="受限仓库">🔒</span>}
                  </div>
                  <div className="mrow-sub">
                    {[authorOf(detailModel.id), detailModel.pipelineTag].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <a
                  className="btn btn-sm"
                  onClick={(e) => {
                    e.preventDefault()
                    void window.zhumora.system.openPath(`https://huggingface.co/${detailModel.id}`)
                  }}
                  href={`https://huggingface.co/${detailModel.id}`}
                >
                  在 HF 打开 ↗
                </a>
              </div>

              {/* 统计 */}
              <div className="detail-stats">
                <div className="dstat">
                  <span className="dstat-ico">⬇</span>
                  <strong>{fmtDownloads(detailModel.downloads)}</strong>
                  <span>下载</span>
                </div>
                <div className="dstat">
                  <span className="dstat-ico">★</span>
                  <strong>{fmtDownloads(detailModel.likes)}</strong>
                  <span>点赞</span>
                </div>
                <div className="dstat">
                  <span className="dstat-ico">🕘</span>
                  <strong>{relTime(detailModel.lastModified) || '—'}</strong>
                  <span>更新</span>
                </div>
                {isTrending && detailModel.id === results[0]?.id && (
                  <div className="dstat dstat-badge">
                    <span className="dstat-ico">⭐</span>
                    <span>精选</span>
                  </div>
                )}
              </div>

              {detail.shortDescription && <p className="detail-desc">{detail.shortDescription}</p>}

              {/* 元信息 chips */}
              <div className="detail-meta">
                <Meta label="参数" value={detailModel.params} />
                <Meta label="架构" value={detailModel.arch} mono />
                <Meta label="上下文" value={fmtCtx(detailModel.contextLength)} mono />
                <Meta label="格式" value="GGUF" mono />
                <Meta label="许可" value={detailModel.license} mono />
              </div>

              {/* 能力 */}
              {(detailModel.capabilities.vision || detailModel.capabilities.tool || detailModel.capabilities.reasoning) && (
                <div className="detail-caps">
                  {CAPS.filter((c) => detailModel.capabilities[c.key]).map((c) => (
                    <span key={c.key} className="cap-chip">
                      <span className="cap-dot" />
                      {c.label}
                    </span>
                  ))}
                </div>
              )}

              {/* 下载选项 */}
              <div className="detail-section">
                <div className="detail-section-title">下载选项</div>
                {detail.files.length > 0 ? (
                  <div className="dl-list">
                    {detail.files.map((f) => (
                      <DownloadRow
                        key={f.path}
                        repoId={detailModel.id}
                        path={f.path}
                        size={f.size}
                        downloaded={importedNames.has(f.path.split('/').pop()?.toLowerCase() ?? '')}
                        dl={downloads[`${detailModel.id}::${f.path}`]}
                        onDownload={() => void window.zhumora.models.download(detailModel.id, f.path).catch(() => {})}
                      />
                    ))}
                  </div>
                ) : detailModel.gated ? (
                  <div className="hint" style={{ padding: '12px 0' }}>
                    该仓库为受限（gated）仓库，请先在 Hugging Face 上授权后，再用“导入本地 GGUF”或直接下载。
                  </div>
                ) : (
                  <div className="hint" style={{ padding: '12px 0' }}>该仓库没有可下载的 GGUF 文件。</div>
                )}
              </div>

              {/* README */}
              {detail.readme && (
                <div className="detail-section">
                  <div className="detail-section-title">README</div>
                  <Readme md={detail.readme} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 本地模型 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            本地模型
            <span className="sub">
              {list.length} 个模型{mmprojs.length > 0 ? ` · ${mmprojs.length} 个 mmproj` : ''}
            </span>
          </h3>
        </div>
        {models.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 32 }}>
            <div>
              <div className="mark">🗂</div>
              模型库为空 — 在上方广场搜索下载，或导入本地 .gguf
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '36%' }}>名称</th>
                <th>类型</th>
                <th>架构</th>
                <th>量化</th>
                <th>大小</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600, wordBreak: 'break-all' }}>{m.name}</td>
                  <td>
                    {m.kind === 'mmproj' ? (
                      <span className="badge badge-info">mmproj</span>
                    ) : (
                      <span className="badge badge-stopped">model</span>
                    )}
                  </td>
                  <td>{m.arch ?? '—'}</td>
                  <td>{m.quant ? <span className="mono">{m.quant}</span> : '—'}</td>
                  <td>{fmtSize(m.size)}</td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-sm btn-danger" onClick={() => void removeModel(m.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="meta-chip">
      <span className="meta-label">{label}</span>
      <span className={`meta-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  )
}
