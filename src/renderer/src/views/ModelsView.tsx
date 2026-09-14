import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppStore } from '../store'
import { quantFromPath } from '@shared/hfutil'
import type { HfCapabilities, HfModel, HfModelDetail, HfSort, ModelInfo } from '@shared/types'
import { useTranslation } from 'react-i18next'

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
type TFunc = (k: string, v?: Record<string, string | number>) => string
function relTime(iso?: string, t?: TFunc): string {
  if (!iso || !t) return ''
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return t('models.today')
  if (d < 30) return t('models.daysAgo', { n: Math.floor(d) })
  if (d < 365) return t('models.monthsAgo', { n: Math.floor(d / 30) })
  return t('models.yearsAgo', { n: Math.floor(d / 365) })
}
const authorOf = (id: string) => id.split('/')[0]
const shortName = (id: string) => id.split('/')[1] ?? id

const CAPS: { key: keyof HfCapabilities; labelKey: string; icon: string }[] = [
  { key: 'vision', labelKey: 'models.capVision', icon: '👁' },
  { key: 'tool', labelKey: 'models.capTool', icon: '🛠' },
  { key: 'reasoning', labelKey: 'models.capReasoning', icon: '🧠' }
]
function capIcons(c: HfCapabilities, t: TFunc): ReactNode {
  return (
    <>
      {CAPS.filter((x) => c[x.key]).map((x) => (
        <span key={x.key} className="cap-ico" title={t(x.labelKey)} style={{ marginLeft: 4 }}>
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
      const txt = stripInline(line.replace(/^\s*[-*+]\s+/, ''))
      if (txt) out.push({ type: 'li', text: txt })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const txt = stripInline(line.replace(/^\s*\d+\.\s+/, ''))
      if (txt) out.push({ type: 'li', text: txt })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) continue // 表格：跳过
    if (/^\s*<[^>]+>/.test(line)) continue // 原始 HTML：跳过
    const txt = stripInline(line)
    if (txt) out.push({ type: 'p', text: txt })
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
  onDownload,
  t
}: {
  repoId: string
  path: string
  size: number
  downloaded: boolean
  dl?: { status: 'downloading' | 'error'; done: number; total: number; message?: string }
  onDownload: () => void
  t: TFunc
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
            {t('models.fail', { msg: (dl.message ?? '').slice(0, 14) })}
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => void window.zhumora.models.cancelDownload(`${repoId}::${path}`)}>
            {pct > 0 ? pct.toFixed(0) + '% ' : ''}
            {t('models.cancel')}
          </button>
        )
      ) : downloaded ? (
        <span className="dl-done">{t('models.downloaded')}</span>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={onDownload}>
          {t('models.download')}
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
  const { t } = useTranslation()
  const models = useAppStore((s) => s.models)
  const downloads = useAppStore((s) => s.downloads)
  const loadModels = useAppStore((s) => s.loadModels)
  const settings = useAppStore((s) => s.settings)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<HfSort>('best')
  const [results, setResults] = useState<HfModel[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HfModelDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [avatars, setAvatars] = useState<Record<string, string>>({})
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

  // 结果更新后预取作者头像（最多 10 个；主进程带缓存+并发限制，取不到为 null → 回退首字母）
  useEffect(() => {
    let cancelled = false
    const owners = [...new Set(results.map((m) => authorOf(m.id)))].slice(0, 10)
    void Promise.all(owners.map(async (o) => {
      const url = await window.zhumora.models.ownerAvatar(o).catch(() => null)
      if (cancelled || !url) return
      setAvatars((prev) => (prev[o] ? prev : { ...prev, [o]: url }))
    }))
    return () => { cancelled = true }
  }, [results])

  const isTrending = query.trim() === '' && sort === 'best'
  const listLabel = isTrending ? t('models.trending') : t('models.results', { n: String(results.length) })

  const importedNames = useMemo(() => {
    const set = new Set<string>()
    for (const m of models) set.add(m.path.split(/[\\/]/).pop()?.toLowerCase() ?? '')
    return set
  }, [models])

  const importModel = async () => {
    await window.zhumora.models.import()
    await loadModels()
  }
  /** 外部导入的模型（原文件不在 models 目录）：删除时只移除库记录，不碰原文件 */
  const isExternal = (m: ModelInfo) =>
    !settings?.modelsDir || !m.path.startsWith(settings.modelsDir)

  const removeModel = async (m: ModelInfo) => {
    const msg = isExternal(m) ? t('models.confirmDeleteExternal') : t('models.confirmDelete')
    if (!window.confirm(msg)) return
    await window.zhumora.models.remove(m.id)
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
          <h2>{t('models.title')}</h2>
          <p>{t('models.desc')}</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => void importModel()}>
            {t('models.import')}
          </button>
          <button className="btn btn-ghost" onClick={() => void loadModels()}>
            {t('models.rescan')}
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
                placeholder={t('models.searchIn')}
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
                title={t('models.sort')}
              >
                <option value="best">{t('models.sortBest')}</option>
                <option value="likes">{t('models.sortLikes')}</option>
                <option value="updated">{t('models.sortUpdated')}</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => void runSearch(query, sort)} disabled={searching}>
                {searching ? '…' : t('models.search')}
              </button>
            </div>
            <div className="market-list-label">
              {isTrending && <span className="market-refresh" title={t('models.refresh')} onClick={() => void runSearch('', sort)}>↻</span>}
              {listLabel}
            </div>
          </div>

          <div className="market-rows">
            {searchError && <div className="status-error" style={{ margin: '0 8px 8px' }}>{searchError}</div>}
            {!searching && results.length === 0 && (
              <div className="hint" style={{ padding: 16 }}>{t('models.noResults')}</div>
            )}
            {searching && results.length === 0 && <div className="hint" style={{ padding: 16 }}>{t('models.searching')}</div>}
            {results.map((m) => (
              <button
                key={m.id}
                className={`mrow${selectedId === m.id ? ' active' : ''}`}
                onClick={() => void openModel(m)}
              >
                <div className="mrow-logo">
                  {avatars[authorOf(m.id)] ? (
                    <img src={avatars[authorOf(m.id)]} alt="" loading="lazy" />
                  ) : (
                    <span>{shortName(m.id).charAt(0).toUpperCase()}</span>
                  )}
                  {m.capabilities.vision && <span className="mrow-vision" title={t('models.vision')}>👁</span>}
                </div>
                <div className="mrow-main">
                  <div className="mrow-name">
                    {shortName(m.id)}
                    {m.gated && <span className="mrow-locked" title={t('models.gated')}>🔒</span>}
                    {capIcons(m.capabilities, t)}
                  </div>
                  <div className="mrow-sub">
                    {[authorOf(m.id), m.params, `⬇ ${fmtDownloads(m.downloads)}`, relTime(m.lastModified, t)]
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
                        {t('models.cancel')}
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
                {t('models.detailPick')}
              </div>
            </div>
          )}

          {detailLoading && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div>
                <div className="mark" style={{ animation: 'pulse 1.2s infinite' }}>⏳</div>
                {t('models.detailLoading')}
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
                  {avatars[authorOf(detailModel.id)] ? (
                    <img src={avatars[authorOf(detailModel.id)]} alt="" />
                  ) : (
                    <span>{shortName(detailModel.id).charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="detail-title-wrap" style={{ flex: 1, minWidth: 0 }}>
                  <div className="detail-title">
                    {detailModel.id}
                    {detailModel.gated && <span className="mrow-locked" title={t('models.gated')}>🔒</span>}
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
                  {t('models.openHf')}
                </a>
              </div>

              {/* 统计 */}
              <div className="detail-stats">
                <div className="dstat">
                  <span className="dstat-ico">⬇</span>
                  <strong>{fmtDownloads(detailModel.downloads)}</strong>
                  <span>{t('models.downloads')}</span>
                </div>
                <div className="dstat">
                  <span className="dstat-ico">★</span>
                  <strong>{fmtDownloads(detailModel.likes)}</strong>
                  <span>{t('models.likes')}</span>
                </div>
                <div className="dstat">
                  <span className="dstat-ico">🕘</span>
                  <strong>{relTime(detailModel.lastModified, t) || '—'}</strong>
                  <span>{t('models.updated')}</span>
                </div>
                {isTrending && detailModel.id === results[0]?.id && (
                  <div className="dstat dstat-badge">
                    <span className="dstat-ico">⭐</span>
                    <span>{t('models.picked')}</span>
                  </div>
                )}
              </div>

              {detail.shortDescription && <p className="detail-desc">{detail.shortDescription}</p>}

              {/* 元信息 chips */}
              <div className="detail-meta">
                <Meta label={t('models.params')} value={detailModel.params} />
                <Meta label={t('models.arch')} value={detailModel.arch} mono />
                <Meta label={t('models.context')} value={fmtCtx(detailModel.contextLength)} mono />
                <Meta label={t('models.format')} value="GGUF" mono />
                <Meta label={t('models.license')} value={detailModel.license} mono />
              </div>

              {/* 能力 */}
              {(detailModel.capabilities.vision || detailModel.capabilities.tool || detailModel.capabilities.reasoning) && (
                <div className="detail-caps">
                  {CAPS.filter((c) => detailModel.capabilities[c.key]).map((c) => (
                    <span key={c.key} className="cap-chip">
                      <span className="cap-dot" />
                      {t(c.labelKey)}
                    </span>
                  ))}
                </div>
              )}

              {/* 下载选项 */}
              <div className="detail-section">
                <div className="detail-section-title">{t('models.dlOptions')}</div>
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
                        t={t}
                      />
                    ))}
                  </div>
                ) : detailModel.gated ? (
                  <div className="hint" style={{ padding: '12px 0' }}>
                    {t('models.gatedHint')}
                  </div>
                ) : (
                  <div className="hint" style={{ padding: '12px 0' }}>{t('models.noGguf')}</div>
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
            {t('models.local')}
            <span className="sub">
              {t('models.localSub', {
                n: String(list.length),
                mm: mmprojs.length > 0 ? t('models.localSubMm', { n: String(mmprojs.length) }) : ''
              })}
            </span>
          </h3>
        </div>
        {models.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 32 }}>
            <div>
              <div className="mark">🗂</div>
              {t('models.empty')}
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '36%' }}>{t('models.thName')}</th>
                <th>{t('models.thKind')}</th>
                <th>{t('models.thArch')}</th>
                <th>{t('models.thQuant')}</th>
                <th>{t('models.thSize')}</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const ext = isExternal(m)
                return (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600, wordBreak: 'break-all' }}>
                      {m.name}
                      {ext && <span className="badge badge-info" style={{ marginLeft: 8 }}>{t('models.external')}</span>}
                    </td>
                    <td>
                      {m.kind === 'mmproj' ? (
                        <span className="badge badge-info">mmproj</span>
                      ) : (
                        <span className="badge badge-stopped">model</span>
                      )}
                    </td>
                    <td>{m.arch ?? '—'}</td>
                    <td>{m.quant ? <span className="mono">{m.quant}</span> : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{fmtSize(m.size)}</span>
                        {ext && (
                          <span
                            className="mono"
                            style={{ fontSize: '0.75rem', color: 'var(--app-color-text-mute)', wordBreak: 'break-all' }}
                          >
                            {m.path}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="cell-actions">
                        <button className="btn btn-sm btn-danger" onClick={() => void removeModel(m)}>
                          {ext ? t('models.unlink') : t('models.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
