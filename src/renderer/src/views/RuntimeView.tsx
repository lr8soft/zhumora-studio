import { useAppStore } from '../store'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
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
    { label: t('runtime.stepCheck'), state: 'checking' },
    { label: t('runtime.stepDetect'), state: 'detected' },
    { label: t('runtime.stepDownload'), state: 'downloading' },
    { label: t('runtime.stepExtract'), state: 'extracting' },
    { label: t('runtime.stepDone'), state: 'ready' }
  ]
  const stepIndex = { checking: 0, detected: 1, downloading: 2, extracting: 3, ready: 4, error: -1 }[
    runtime.state
  ]

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('runtime.title')}</h2>
          <p>{t('runtime.desc')}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy}>
            {t('runtime.refresh')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>
            {t('runtime.status')}
            <span className="sub">
              {runtime.version ? `${runtime.version} · ${runtime.variant}` : t('runtime.notInstalled')}
            </span>
          </h3>
          {runtime.state === 'ready' && (
            <span className="badge badge-ready">{t('runtime.ready')}</span>
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
                    ? t('runtime.extracting', { n: String(progress.done), total: String(progress.total) })
                    : `${fmtSize(progress.done)} / ${fmtSize(progress.total)} · ${fmtSpeed(
                        progress.speed
                      )}`}
                </span>
                <span>{runtime.state === 'downloading' ? `${pct.toFixed(1)}%` : ''}</span>
              </div>
              {runtime.state === 'downloading' && (
                <button className="btn btn-sm btn-danger" style={{ marginTop: 8 }} onClick={cancel}>
                  {t('runtime.cancel')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {runtime.detected && (
        <div className="card">
          <div className="card-head">
            <h3>{t('runtime.detected')}</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 6, fontSize: '0.833rem' }}>
            <div>
              {t('runtime.arch')}：<span className="mono">{runtime.detected.arch}</span>
            </div>
            <div>
              {t('runtime.gpu')}：
              {runtime.detected.adapters.length > 0
                ? runtime.detected.adapters.join('；')
                : t('runtime.noGpu')}
            </div>
            {runtime.detected.nvidiaDriver && (
              <div>
                {t('runtime.nvidiaDriver')}：<span className="mono">{runtime.detected.nvidiaDriver}</span>
              </div>
            )}
            {runtime.recommended && (
              <div>
                {t('runtime.recommended')}：<span className="badge badge-info">{runtime.recommended}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {runtime.assets && runtime.assets.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>
              {t('runtime.builds')}
              <span className="sub">
                {t('runtime.buildsSub', {
                  ver: String(runtime.version || '—'),
                  arch: String(runtime.detected?.arch ?? 'x64')
                })}
              </span>
            </h3>
          </div>
          <div className="card-body">
            <div className="variant-grid">
              {runtime.assets
                .filter((a) => a.arch === (runtime.detected?.arch ?? 'x64'))
                .sort((a, b) => {
                  // 推荐置顶
                  if (a.variant === runtime.recommended) return -1
                  if (b.variant === runtime.recommended) return 1
                  return a.variant.localeCompare(b.variant)
                })
                .map((a) => {
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
                        {a.variant === runtime.recommended && <span className="rec-tag">{t('runtime.rec')}</span>}
                        {selected && <span className="rec-tag" style={{ marginLeft: 8 }}>{t('runtime.installed')}</span>}
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
