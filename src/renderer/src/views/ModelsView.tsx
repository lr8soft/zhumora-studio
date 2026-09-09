import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { HfFile, HfModel } from '@shared/types'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return bytes + ' B'
}

function fmtDownloads(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export default function ModelsView() {
  const models = useAppStore((s) => s.models)
  const downloads = useAppStore((s) => s.downloads)
  const loadModels = useAppStore((s) => s.loadModels)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HfModel[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [repo, setRepo] = useState<HfModel | null>(null)
  const [files, setFiles] = useState<HfFile[] | null>(null)

  const search = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError('')
    setRepo(null)
    setFiles(null)
    try {
      const r = await window.zhumora.models.search(q)
      setResults(r)
    } catch (e) {
      setSearchError((e as Error).message)
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  const openRepo = async (m: HfModel) => {
    setRepo(m)
    setFiles(null)
    try {
      const f = await window.zhumora.models.repoFiles(m.id)
      setFiles(f)
    } catch (e) {
      setFiles([])
      setSearchError((e as Error).message)
    }
  }

  const downloadFile = async (file: string) => {
    if (!repo) return
    try {
      await window.zhumora.models.download(repo.id, file)
    } catch (e) {
      // 错误走 model-error 事件
      void e
    }
  }

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

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>模型库</h2>
          <p>本地 GGUF 管理 + HuggingFace 搜索下载</p>
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

      {/* HF 搜索 */}
      <div className="card">
        <div className="card-head">
          <h3>
            HuggingFace 下载
            <span className="sub">搜索 GGUF 仓库，断点续传</span>
          </h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              style={{ flex: 1, minHeight: 34, padding: '6px 12px', border: '1px solid var(--app-color-border)', borderRadius: 6, background: 'var(--app-color-surface)' }}
              placeholder="搜索模型，如 qwen2.5 0.5b / llama 3.2 / gemma 3 vision"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
            <button className="btn btn-primary" onClick={() => void search()} disabled={searching || !query.trim()}>
              {searching ? '搜索中…' : '搜索'}
            </button>
          </div>
          {searchError && <div className="status-error" style={{ marginTop: 10 }}>{searchError}</div>}

          {/* 仓库搜索结果 */}
          {results && !repo && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {results.length === 0 && <div className="hint" style={{ padding: 12 }}>无结果，换个关键词试试</div>}
              {results.map((m) => (
                <div
                  key={m.id}
                  className="variant-card"
                  onClick={() => void openRepo(m)}
                >
                  <div>
                    <div className="name">{m.id}</div>
                    <div className="sub">{m.tags.filter((t) => !t.startsWith('license:')).slice(0, 6).join(' · ')}</div>
                  </div>
                  <div className="size">
                    ⬇ {fmtDownloads(m.downloads)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 仓库文件列表 */}
          {repo && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => { setRepo(null); setFiles(null) }}>
                  ← 返回
                </button>
                <strong style={{ fontSize: '0.867rem', wordBreak: 'break-all' }}>{repo.id}</strong>
                <a
                  href={`https://huggingface.co/${repo.id}`}
                  style={{ fontSize: '0.733rem', color: 'var(--app-color-primary)' }}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.zhumora.system.openPath(`https://huggingface.co/${repo.id}`)
                  }}
                >
                  在 HF 打开
                </a>
              </div>
              {!files ? (
                <div className="hint">加载文件列表…</div>
              ) : (
                <div style={{ display: 'grid', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
                  {files.length === 0 && <div className="hint" style={{ padding: 8 }}>该仓库没有 gguf 文件</div>}
                  {files.map((f) => {
                    const isMm = f.path.toLowerCase().startsWith('mmproj')
                    const dlId = `${repo.id}::${f.path}`
                    const dl = downloads[dlId]
                    return (
                      <div
                        key={f.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          border: '1px solid var(--app-color-border)',
                          borderRadius: 6
                        }}
                      >
                        {isMm && (
                          <span className="badge badge-info" style={{ flex: '0 0 auto' }}>mmproj</span>
                        )}
                        <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.path.split('/').pop()}
                        </span>
                        <span style={{ color: 'var(--app-color-text-mute)', fontSize: '0.767rem', whiteSpace: 'nowrap' }}>
                          {fmtSize(f.size)}
                        </span>
                        {dl ? (
                          dl.status === 'error' ? (
                            <span style={{ color: 'var(--app-color-danger)', fontSize: '0.733rem', whiteSpace: 'nowrap' }}>
                              {dl.message}
                            </span>
                          ) : (
                            <button className="btn btn-sm" onClick={() => void window.zhumora.models.cancelDownload(dlId)}>
                              {(dl.done / Math.max(1, dl.total)) * 100 > 0 &&
                                ((dl.done / dl.total) * 100).toFixed(0) + '% '}
                              取消
                            </button>
                          )
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => void downloadFile(f.path)}>
                            下载
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 进行中的下载 */}
          {activeDownloads.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {activeDownloads.map((dl) => {
                const pct = dl.total > 0 ? (dl.done / dl.total) * 100 : 0
                return (
                  <div key={dl.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.767rem', marginBottom: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {dl.repoId.split('/')[1]} / {dl.file}
                      </span>
                      <span style={{ color: 'var(--app-color-text-mute)' }}>
                        {fmtSize(dl.done)} / {fmtSize(dl.total)}
                      </span>
                    </div>
                    <div className="progress">
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 本地模型列表 */}
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
          <div className="empty-state">
            <div>
              <div className="mark">🗂</div>
              模型库为空 — 上方搜索 HF 下载，或导入本地 .gguf
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
