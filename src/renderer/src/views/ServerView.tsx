import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import ParamForm from '../components/ParamForm'
import { useTranslation } from 'react-i18next'
import { quantFromPath } from '@shared/hfutil'
import type { LaunchParams } from '@shared/types'
import { buildArgs } from '@shared/buildArgs'

export default function ServerView() {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const models = useAppStore((s) => s.models)
  const mmprojs = models.filter((m) => m.kind === 'mmproj')
  const runtime = useAppStore((s) => s.runtime)
  const paramDraft = useAppStore((s) => s.paramDraft)
  const setParamDraft = useAppStore((s) => s.setParamDraft)
  const setParamDirty = useAppStore((s) => s.setParamDirty)
  const settings = useAppStore((s) => s.settings)
  const keys = useAppStore((s) => s.keys)
  const [toast, setToast] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const serverLogs = useAppStore((s) => s.serverLogs)

  const running = serverState.state === 'starting' || serverState.state === 'ready'
  const stale =
    serverState.state === 'ready' &&
    JSON.stringify(buildArgs(paramDraft)) !== JSON.stringify(buildArgs(settings?.lastParams ?? paramDraft))
  // 密钥变更需重启（与上次启动参数中的 key 集合比较）
  const lastKeys = String((settings?.lastParams as LaunchParams | undefined)?.apiKey ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',')
  const keysStale =
    serverState.state === 'ready' && keys.map((k) => k.key).sort().join(',') !== lastKeys

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [serverLogs.length])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const start = async () => {
    try {
      await window.zhumora.server.start(paramDraft)
      setParamDirty(false)
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const stop = async () => {
    try {
      await window.zhumora.server.stop()
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const pickModelFile = async () => {
    const p = await window.zhumora.system.pickModel()
    if (p) {
      setParamDraft({ ...paramDraft, modelPath: p })
      setParamDirty(true)
      useAppStore.getState().loadModels()
    }
  }

  const pickMmprojFile = async () => {
    const p = await window.zhumora.system.pickModel()
    if (p) {
      setParam('mmproj', p)
      useAppStore.getState().loadModels()
    }
  }

  const setParam = (key: keyof LaunchParams, v: LaunchParams[string]) => {
    setParamDraft({ ...paramDraft, [key]: v })
    setParamDirty(true)
  }

  // 模型库下拉：按量化过滤（quant 参数，纯 UI）
  const quantFilter = String(paramDraft.quant ?? '').trim().toLowerCase()
  const modelChoices = useMemo(() => {
    const all = models.filter((m) => m.kind === 'model')
    if (!quantFilter) return all
    return all.filter((m) => (m.quant ?? quantFromPath(m.path) ?? '').toLowerCase() === quantFilter)
  }, [models, quantFilter])

  const endpoint = serverState.host ? `http://${serverState.host}:${serverState.port}/v1` : ''

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('server.title')}</h2>
          <p>{t('server.desc')}</p>
        </div>
        <div className="header-actions">
          {running ? (
            <button className="btn btn-danger" onClick={() => void stop()}>
              {t('server.stop')}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={runtime.state !== 'ready' || !paramDraft.modelPath}
              title={
                runtime.state !== 'ready'
                  ? t('server.needRuntime')
                  : !paramDraft.modelPath
                    ? t('server.needModel')
                    : undefined
              }
            >
              {serverState.state === 'error' ? t('server.restart') : t('server.start')}
            </button>
          )}
        </div>
      </div>

      {/* 状态卡 */}
      <div className="card">
        <div className="status-hero">
          <div className="big">
            <span
              className={`dot ${
                serverState.state === 'ready'
                  ? 'dot-ready'
                  : serverState.state === 'starting'
                    ? 'dot-starting'
                    : serverState.state === 'error'
                      ? 'dot-error'
                      : 'dot-stopped'
              }`}
            />
            <span className={`badge badge-${serverState.state}`}>
              {t(`server.state.${serverState.state}`)}
            </span>
          </div>
          <div className="meta">
            {serverState.state === 'ready' ? (
              <>
                <span>
                  {t('server.endpoint')} <span className="mono">{endpoint}</span>
                </span>
                {serverState.modelPath && (
                  <span>
                    {t('server.model')}{' '}
                    <span className="mono" style={{ wordBreak: 'break-all' }}>{serverState.modelPath}</span>
                  </span>
                )}
                {stale && <span style={{ color: 'var(--app-color-warn)' }}>{t('server.stale')}</span>}
                {keysStale && <span style={{ color: 'var(--app-color-warn)' }}>{t('server.keysStale')}</span>}
              </>
            ) : serverState.state === 'starting' ? (
              <span>{t('server.startingWait')}</span>
            ) : (
              <span>
                {t('server.binary')}{' '}
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {settings?.llamaBinary || runtime.binaryPath || t('server.noBinary')}
                </span>
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gap: 6, justifyContent: 'end' }}>
            {serverState.state === 'ready' && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint)
                  showToast(t('server.copied'))
                }}
              >
                {t('server.copyEndpoint')}
              </button>
            )}
            <span className={`badge ${keys.length > 0 ? 'badge-info' : 'badge-stopped'}`}>
              {keys.length > 0
                ? t('server.keysCount', { n: String(keys.length) })
                : t('server.keysNone')}
            </span>
          </div>
        </div>
        {serverState.error && <div className="status-error" style={{ margin: '0 20px 16px' }}>{serverState.error}</div>}
      </div>

      {/* 参数表单 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            {t('server.params')}
            <span className="sub">
              {buildArgs(paramDraft).length > 0 ? t('server.flags', { n: String(buildArgs(paramDraft).length) }) : ''}
            </span>
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
          {/* 模型文件特判：-m 与 --mmproj 同组（模型设定） */}
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
                  {modelChoices
                    .map((m) => (
                      <option key={m.id} value={m.path}>
                        {m.name}
                        {m.quant ? ` (${m.quant})` : ''}
                      </option>
                    ))}
                  {quantFilter && modelChoices.length === 0 && (
                    <option value="" disabled>
                      — {quantFilter} —
                    </option>
                  )}
                </select>
                <button className="btn" onClick={() => void pickModelFile()}>
                  {t('server.browse')}
                </button>
              </div>
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

      {/* 日志 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>{t('server.logs')}</h3>
          <span className="sub">{t('server.logsSub')}</span>
        </div>
        <div className="log-view" ref={logRef}>
          {serverLogs.length === 0 ? (
            <span style={{ color: '#5c6a77' }}>{t('server.noLogs')}</span>
          ) : (
            serverLogs.map((l, i) => (
              <div key={i} className={l.startsWith('[err]') ? 'err' : undefined}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
