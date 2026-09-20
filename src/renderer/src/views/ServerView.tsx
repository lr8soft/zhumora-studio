import { useState } from 'react'
import { useAppStore } from '../store'
import ParamForm from '../components/ParamForm'
import { useTranslation } from 'react-i18next'
import type { LaunchParams } from '@shared/types'

/**
 * 服务与启动参数（次级视图）。
 * 启停与当前模型已上移顶部"模型坞"；本页专注参数表单与 server 错误/日志入口。
 */
export default function ServerView() {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const models = useAppStore((s) => s.models)
  const mmprojs = models.filter((m) => m.kind === 'mmproj')
  const paramDraft = useAppStore((s) => s.paramDraft)
  const setParamDraft = useAppStore((s) => s.setParamDraft)
  const setParamDirty = useAppStore((s) => s.setParamDirty)
  const settings = useAppStore((s) => s.settings)
  const keys = useAppStore((s) => s.keys)
  const [toast, setToast] = useState<string | null>(null)
  const [tuneNote, setTuneNote] = useState('')

  const running = serverState.state === 'starting' || serverState.state === 'ready'

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const setParam = (key: keyof LaunchParams, v: LaunchParams[string]) => {
    setParamDraft({ ...paramDraft, [key]: v })
    setParamDirty(true)
  }

  const pickMmprojFile = async () => {
    const p = await window.zhumora.system.pickModel()
    if (p) {
      setParam('mmproj', p)
      useAppStore.getState().loadModels()
    }
  }

  const modelChoices = models.filter((m) => m.kind === 'model')

  // 自动配置：按本机 VRAM/RAM + 模型 GGUF 元数据推演 nGpuLayers / ctxSize 等。
  // 默认调参由选模型/启动链路自动触发（store.launchModel）；这里是手动重算入口。
  const [tuning, setTuning] = useState(false)
  const applyTune = async () => {
    if (!paramDraft.modelPath) return
    setTuning(true)
    setTuneNote('')
    try {
      const res = await window.zhumora.server.suggestParams(String(paramDraft.modelPath), paramDraft)
      setParamDraft({ ...paramDraft, ...res.patch })
      setParamDirty(true)
      if (res.reason) {
        setTuneNote(res.reason)
        setTimeout(() => setTuneNote(''), 8000)
      }
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setTuning(false)
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('server.title')}</h2>
          <p>{t('server.desc')}</p>
        </div>
      </div>

      {/* 运行中改参需重启的提示（按钮在模型坞） */}
      {running && (
        <div className="tune-bar" style={{ marginBottom: 14 }}>
          <span>
            {serverState.state === 'starting' ? t('server.startingWait') : t('server.paramsLive')}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className={`badge ${keys.length > 0 ? 'badge-info' : 'badge-stopped'}`}>
            {keys.length > 0
              ? t('server.keysCount', { n: String(keys.length) })
              : t('server.keysNone')}
          </span>
        </div>
      )}

      {serverState.error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="status-hero">
            <div className="big">
              <span className="dot dot-error" />
              <span className="badge badge-error">{t(`server.state.${serverState.state}`)}</span>
            </div>
            <div className="meta">
              <span>{t('server.errorWhere')}</span>
            </div>
          </div>
          <div className="status-error" style={{ margin: '0 20px 16px' }}>{serverState.error}</div>
        </div>
      )}

      {/* 参数表单 */}
      <div className="card">
        <div className="card-head">
          <h3>
            {t('server.params')}
          </h3>
          {paramDraft.modelPath ? (
            <span className="badge badge-ready" style={{ maxWidth: 420, overflow: 'hidden' }}>
              {(paramDraft.modelPath as string).split(/[\\/]/).pop()}
            </span>
          ) : (
            <span className="badge badge-stopped">{t('server.noModel')}</span>
          )}
        </div>
        <div className="card-body">
          {/* 自动配置条：置顶，手动重算入口 */}
          {paramDraft.modelPath && (
            <div className="tune-bar" style={{ marginBottom: 14 }}>
              <button className="btn btn-sm" onClick={() => void applyTune()} disabled={tuning}>
                {tuning ? t('server.tuning') : t('server.autoTune')}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {t('server.autoTuneHint')}
              </span>
              {tuneNote && (
                <span style={{ color: 'var(--app-color-success)', fontSize: '0.767rem' }}>✓ {tuneNote}</span>
              )}
            </div>
          )}

          {/* 模型文件（-m 主模型 + --mmproj 投影） */}
          <div className="form-section" style={{ marginTop: 0 }}>
            <div className="form-section-title">
              {t('server.modelFiles')}
              <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {t('server.modelFilesSub')}
              </span>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>{t('server.mainModel')}</label>
              <div className="pick">
                <select
                  value={models.some((m) => m.path === paramDraft.modelPath) ? (paramDraft.modelPath as string) : ''}
                  onChange={(e) => setParam('modelPath', e.target.value)}
                >
                  <option value="">{t('server.pickFromLib')}</option>
                  {modelChoices.map((m) => (
                    <option key={m.id} value={m.path}>
                      {m.name}
                      {m.quant ? ` (${m.quant})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hint">{t('server.dockHint')}</div>
            </div>
            <div className="field">
              <label>{t('server.mmproj')}</label>
              <div className="pick">
                <input
                  type="text"
                  className="mono"
                  placeholder={t('server.mmprojPh')}
                  value={typeof paramDraft.mmproj === 'string' ? paramDraft.mmproj : ''}
                  disabled={running}
                  onChange={(e) => setParam('mmproj', e.target.value)}
                />
                <button className="btn" onClick={() => void pickMmprojFile()} disabled={running}>
                  {t('server.browse')}
                </button>
              </div>
              {mmprojs.length > 0 && (
                <div className="hint">
                  {t('server.mmprojLib')}
                  {mmprojs.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="hint-link"
                      onClick={() => setParam('mmproj', m.path)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <ParamForm value={paramDraft} onChange={(p) => { setParamDraft(p); setParamDirty(true) }} disabled={running} />
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
