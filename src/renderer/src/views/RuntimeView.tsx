import { useAppStore } from '../store'
import { useState } from 'react'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return bytes + ' B'
}

function fmtSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s'
  if (bps > 0) return (bps / 1024).toFixed(0) + ' KB/s'
  return ''
}

export default function RuntimeView() {
  const runtime = useAppStore((s) => s.runtime)
  const [busy, setBusy] = useState(false)

  const download = async (variant: string) => {
    setBusy(true)
    try {
      await window.zhumora.runtime.download(variant)
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => void window.zhumora.runtime.cancel()
  const refresh = async () => {
    setBusy(true)
    try {
      await window.zhumora.runtime.assets()
    } finally {
      setBusy(false)
    }
  }

  const progress = runtime.progress
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0

  const steps = [
    { label: '检查本地已安装的 runtime', state: 'checking' },
    { label: '探测 GPU / CPU 架构', state: 'detected' },
    { label: '下载匹配的 bin-win 构建（可断点续传）', state: 'downloading' },
    { label: '解压 + sha256 校验 + 写 manifest', state: 'extracting' },
    { label: '就绪，可在"服务与参数"页启动 server', state: 'ready' }
  ]
  const stepIndex = { checking: 0, detected: 1, downloading: 2, extracting: 3, ready: 4, error: -1 }[
    runtime.state
  ]

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>llama.cpp 运行时</h2>
          <p>首启自动从 GitHub 获取匹配本机构建，不随应用打包</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy}>
            刷新构建列表
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>
            状态
            <span className="sub">
              {runtime.version ? `${runtime.version} · ${runtime.variant}` : '未安装'}
            </span>
          </h3>
          {runtime.state === 'ready' && (
            <span className="badge badge-ready">ready</span>
          )}
        </div>
        <div className="card-body">
          <div className="runtime-steps">
            {steps.map((s, i) => (
              <div
                key={s.state}
                className={`runtime-step ${i < stepIndex ? 'done' : ''} ${
                  i === stepIndex ? 'active' : ''
                }`}
              >
                <span className="idx">{i < stepIndex ? '✓' : i + 1}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          {runtime.state === 'error' && runtime.error && (
            <div className="status-error">{runtime.error}</div>
          )}

          {(runtime.state === 'downloading' || runtime.state === 'extracting') && progress && (
            <div style={{ marginTop: 16 }}>
              <div className="progress">
                <div
                  style={{
                    width: runtime.state === 'extracting' ? '100%' : `${pct}%`
                  }}
                />
              </div>
              <div className="progress-meta">
                <span>
                  {progress.phase === 'extracting'
                    ? `解压中 ${progress.done}/${progress.total} 文件`
                    : `${fmtSize(progress.done)} / ${fmtSize(progress.total)} · ${fmtSpeed(
                        progress.speed
                      )}`}
                </span>
                <span>{runtime.state === 'downloading' ? `${pct.toFixed(1)}%` : ''}</span>
              </div>
              {runtime.state === 'downloading' && (
                <button className="btn btn-sm btn-danger" style={{ marginTop: 8 }} onClick={cancel}>
                  取消（保留进度，可续传）
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {runtime.detected && (
        <div className="card">
          <div className="card-head">
            <h3>本机探测</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 6, fontSize: '0.833rem' }}>
            <div>
              架构：<span className="mono">{runtime.detected.arch}</span>
            </div>
            <div>
              显卡：
              {runtime.detected.adapters.length > 0
                ? runtime.detected.adapters.join('；')
                : '未检测到（或探测失败）'}
            </div>
            {runtime.detected.nvidiaDriver && (
              <div>
                NVIDIA 驱动：<span className="mono">{runtime.detected.nvidiaDriver}</span>
              </div>
            )}
            {runtime.recommended && (
              <div>
                推荐构建：<span className="badge badge-info">{runtime.recommended}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {runtime.assets && runtime.assets.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>
              可下载构建
              <span className="sub">{runtime.version} · 点选下载</span>
            </h3>
          </div>
          <div className="card-body">
            <div className="variant-grid">
              {runtime.assets.map((a) => {
                const selected =
                  runtime.state === 'ready' && runtime.variant === a.variant
                return (
                  <div
                    key={a.name}
                    className={`variant-card ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      if (!selected) void download(a.variant)
                    }}
                  >
                    <div>
                      <div className="name">
                        {a.variant}
                        {a.variant === runtime.recommended && <span className="rec-tag">推荐</span>}
                        {selected && <span className="rec-tag" style={{ marginLeft: 8 }}>已安装</span>}
                      </div>
                      <div className="sub">
                        {a.name} · {a.arch}
                      </div>
                    </div>
                    <div className="size">{fmtSize(a.size)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
