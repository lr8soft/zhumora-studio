import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import type { ViewId } from '../components/Sidebar'
import type { HfModel } from '@shared/types'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return bytes > 0 ? Math.round(bytes / 1024) + ' KB' : '—'
}

function fmtDownloads(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/**
 * 首启引导（settings.onboarded === false 时全屏展示）：
 * 运行时状态（后台自动下载）→ 本地模型一键启动 / 热门模型入口 → 跳过。
 * 引导不阻塞：任何入口随时可跳过进主界面。
 */
export default function OnboardingView({
  onDone,
  onNavigate
}: {
  onDone: () => void
  onNavigate: (v: ViewId, focusModelId?: string) => void
}) {
  const { t } = useTranslation()
  const runtime = useAppStore((s) => s.runtime)
  const models = useAppStore((s) => s.models)
  const settings = useAppStore((s) => s.settings)
  const launching = useAppStore((s) => s.launching)
  const [trending, setTrending] = useState<HfModel[]>([])
  const [trendingErr, setTrendingErr] = useState('')
  const [launchErr, setLaunchErr] = useState('')

  // 热门模型（HF best 排序前 6 个）
  useEffect(() => {
    let alive = true
    void window.zhumora.models
      .search('', 'best')
      .then((r) => {
        if (alive) setTrending(r.slice(0, 6))
      })
      .catch((e) => {
        if (alive) setTrendingErr((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [])

  const localModels = models.filter((m) => m.kind === 'model')
  const hasCustomBinary = Boolean(settings?.llamaBinary?.trim())
  const binaryReady = runtime.state === 'ready' || hasCustomBinary
  const runtimeBusy = runtime.state === 'downloading' || runtime.state === 'extracting'
  const progress = runtime.progress
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0

  const finish = () => {
    void window.zhumora.settings
      .save({ onboarded: true })
      .then((next) => useAppStore.getState().setSettings(next))
      .catch(() => undefined)
    onDone()
  }

  const startModel = async (path: string) => {
    setLaunchErr('')
    try {
      await useAppStore.getState().launchModel(path)
      finish()
      onNavigate('chat')
    } catch (e) {
      setLaunchErr((e as Error).message)
    }
  }

  const dotCls =
    binaryReady || runtime.state === 'ready'
      ? 'dot-ready'
      : runtime.state === 'downloading' || runtime.state === 'extracting'
        ? 'dot-starting'
        : runtime.state === 'error'
          ? 'dot-error'
          : 'dot-starting'

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="onboard-head">
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: '1.2rem' }}>Z</div>
          <div>
            <h1>{t('onboard.title')}</h1>
            <p>{t('onboard.desc')}</p>
          </div>
        </div>

        {/* 1. 运行时（后台自动，用户只需知道进度） */}
        <div className="card onboard-step">
          <div className="onboard-step-head">
            <span className="onboard-step-idx">1</span>
            <strong>{t('onboard.runtime')}</strong>
            <span className={`dot ${dotCls}`} />
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {runtime.state === 'ready' || hasCustomBinary ? (
              <div>
                <span className="badge badge-ready">{t('onboard.runtimeReady')}</span>
                {runtime.version && (
                  <span className="hint" style={{ marginLeft: 10 }}>
                    {runtime.version} · {runtime.variant}
                  </span>
                )}
              </div>
            ) : (
              <div>
                <div>
                  {runtimeBusy ? t('onboard.runtimeDownloading') : runtime.state === 'error' ? t('onboard.runtimeError') : t('onboard.runtimeChecking')}
                </div>
                {runtime.error && <div className="status-error" style={{ marginTop: 8 }}>{runtime.error}</div>}
                {runtimeBusy && progress && progress.total > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="progress">
                      <div style={{ width: runtime.state === 'extracting' ? '100%' : `${pct}%` }} />
                    </div>
                    <div className="progress-meta">
                      <span>{runtime.state === 'extracting' ? t('onboard.runtimeExtracting') : `${pct.toFixed(0)}%`}</span>
                      <span>
                        {fmtSize(progress.done)} / {fmtSize(progress.total)}
                      </span>
                    </div>
                  </div>
                )}
                {runtime.state === 'error' && (
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void window.zhumora.runtime.assets()}>
                    {t('onboard.runtimeRetry')}
                  </button>
                )}
              </div>
            )}
            <div className="hint">{t('onboard.runtimeHint')}</div>
          </div>
        </div>

        {/* 2. 选模型 */}
        <div className="card onboard-step">
          <div className="onboard-step-head">
            <span className="onboard-step-idx">2</span>
            <strong>{t('onboard.model')}</strong>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            {localModels.length > 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="onboard-sub">{t('onboard.localTitle')}</div>
                {localModels.slice(0, 5).map((m) => (
                  <div key={m.id} className="onboard-model-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                        {m.quant && <span className="hint"> ({m.quant})</span>}
                      </div>
                      <div className="hint">{fmtSize(m.size)}</div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!binaryReady || launching}
                      title={!binaryReady ? t('server.needRuntime') : t('onboard.launchHint')}
                      onClick={() => void startModel(m.path)}
                    >
                      {launching ? t('dock.launching') : t('onboard.launch')}
                    </button>
                  </div>
                ))}
                {localModels.length > 5 && (
                  <div className="hint">
                    {t('onboard.localMore', { n: String(localModels.length - 5) })}
                  </div>
                )}
              </div>
            ) : (
              <div className="hint" style={{ padding: '10px 12px', border: '1px dashed var(--app-color-border-strong)', borderRadius: 7 }}>
                {t('onboard.noLocal')}
              </div>
            )}

            <div>
              <div className="onboard-sub">{t('onboard.trendingTitle')}</div>
              {trendingErr ? (
                <div className="hint">{trendingErr}</div>
              ) : trending.length === 0 ? (
                <div className="hint">{t('onboard.trendingLoading')}</div>
              ) : (
                <div className="onboard-trending">
                  {trending.map((m) => (
                    <button
                      key={m.id}
                      className="onboard-tcard"
                      onClick={() => {
                        finish()
                        onNavigate('models', m.id)
                      }}
                    >
                      <div className="onboard-tname">{m.id.split('/')[1] ?? m.id}</div>
                      <div className="hint">
                        {m.id.split('/')[0]} · {m.params ?? 'GGUF'} · ⬇ {fmtDownloads(m.downloads)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button className="btn" style={{ marginTop: 10 }} onClick={() => { finish(); onNavigate('models') }}>
                {t('onboard.browseAll')}
              </button>            </div>

            {launchErr && <div className="status-error">{launchErr}</div>}
          </div>
        </div>

        {/* 3. 完成 */}
        <div className="card onboard-step">
          <div className="onboard-step-head">
            <span className="onboard-step-idx">3</span>
            <strong>{t('onboard.chat')}</strong>
          </div>
          <div className="card-body">
            <div className="hint" style={{ lineHeight: 1.6 }}>
              {t('onboard.chatHint')}
            </div>
          </div>
        </div>

        <div className="onboard-actions">
          <button className="btn" onClick={() => { finish(); onNavigate('models') }}>
            {t('onboard.getModels')}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={finish}>
            {t('onboard.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
