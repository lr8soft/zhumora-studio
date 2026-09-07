import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import ParamForm from '../components/ParamForm'
import type { LaunchParams } from '@shared/types'
import { buildArgs } from '@shared/buildArgs'

const STATE_LABEL: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  ready: '运行中',
  stopping: '停止中',
  error: '错误'
}

export default function ServerView() {
  const serverState = useAppStore((s) => s.serverState)
  const models = useAppStore((s) => s.models)
  const runtime = useAppStore((s) => s.runtime)
  const paramDraft = useAppStore((s) => s.paramDraft)
  const setParamDraft = useAppStore((s) => s.setParamDraft)
  const setParamDirty = useAppStore((s) => s.setParamDirty)
  const settings = useAppStore((s) => s.settings)
  const [toast, setToast] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const serverLogs = useAppStore((s) => s.serverLogs)

  const running = serverState.state === 'starting' || serverState.state === 'ready'
  const stale =
    serverState.state === 'ready' &&
    JSON.stringify(buildArgs(paramDraft)) !== JSON.stringify(buildArgs(settings?.lastParams ?? paramDraft))

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [serverLogs.length])

  const showToast = (msg: string, isError = false) => {
    setToast(msg)
    setTimeout(() => setToast(null), isError ? 5000 : 2500)
    void isError
  }

  const start = async () => {
    try {
      await window.zhumora.server.start(paramDraft)
      setParamDirty(false)
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }

  const stop = async () => {
    try {
      await window.zhumora.server.stop()
    } catch (e) {
      showToast((e as Error).message, true)
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

  const setParam = (key: keyof LaunchParams, v: LaunchParams[string]) => {
    setParamDraft({ ...paramDraft, [key]: v })
    setParamDirty(true)
  }

  const endpoint = serverState.host ? `http://${serverState.host}:${serverState.port}/v1` : ''

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>服务与启动参数</h2>
          <p>参数由 schema 驱动，改完点启动即生效（运行中修改需重启）</p>
        </div>
        <div className="header-actions">
          {running ? (
            <button className="btn btn-danger" onClick={() => void stop()}>
              停止 server
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={runtime.state !== 'ready' || !paramDraft.modelPath}
              title={
                runtime.state !== 'ready'
                  ? '请先在"运行时"页下载 llama.cpp'
                  : !paramDraft.modelPath
                    ? '请先选择模型文件'
                    : undefined
              }
            >
              {serverState.state === 'error' ? '重新启动' : '启动 server'}
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
              {STATE_LABEL[serverState.state] ?? serverState.state}
            </span>
          </div>
          <div className="meta">
            {serverState.state === 'ready' ? (
              <>
                <span>
                  端点 <span className="mono">{endpoint}</span>
                </span>
                {serverState.modelPath && (
                  <span>
                    模型 <span className="mono" style={{ wordBreak: 'break-all' }}>{serverState.modelPath}</span>
                  </span>
                )}
                {stale && <span style={{ color: 'var(--app-color-warn)' }}>参数已修改，需重启生效</span>}
              </>
            ) : serverState.state === 'starting' ? (
              <span>等待 /health 就绪（大模型加载可能需要 1-2 分钟）…</span>
            ) : (
              <span>
                二进制{' '}
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {settings?.llamaBinary || runtime.binaryPath || '未找到（下载 runtime 或设置中指定）'}
                </span>
              </span>
            )}
          </div>
          <div>
            {serverState.state === 'ready' && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint)
                  showToast('端点已复制')
                }}
              >
                复制端点
              </button>
            )}
          </div>
        </div>
        {serverState.error && <div className="status-error" style={{ margin: '0 20px 16px' }}>{serverState.error}</div>}
      </div>

      {/* 参数表单 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            启动参数
            <span className="sub">
              {buildArgs(paramDraft).length > 0 ? `${buildArgs(paramDraft).length} 个 flag` : ''}
            </span>
          </h3>
          {paramDraft.modelPath ? (
            <span className="badge badge-ready" style={{ maxWidth: 420, overflow: 'hidden' }}>
              {(paramDraft.modelPath as string).split(/[\\/]/).pop()}
            </span>
          ) : (
            <span className="badge badge-stopped">未选模型</span>
          )}
        </div>
        <div className="card-body">
          {/* 模型选择特判 */}
          <div className="field" style={{ marginBottom: 14, maxWidth: 720 }}>
            <label>模型文件（-m）</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                style={{ flex: 1 }}
                value={models.some((m) => m.path === paramDraft.modelPath) ? (paramDraft.modelPath as string) : ''}
                onChange={(e) => setParam('modelPath', e.target.value)}
              >
                <option value="">— 从模型库选择 —</option>
                {models.map((m) => (
                  <option key={m.id} value={m.path}>
                    {m.name}
                    {m.quant ? ` (${m.quant})` : ''}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => void pickModelFile()}>
                浏览…
              </button>
            </div>
          </div>

          <ParamForm value={paramDraft} onChange={(p) => { setParamDraft(p); setParamDirty(true) }} disabled={running} />
        </div>
      </div>

      {/* 日志 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>server 日志</h3>
          <span className="sub">stdout / stderr 实时</span>
        </div>
        <div className="log-view" ref={logRef}>
          {serverLogs.length === 0 ? (
            <span style={{ color: '#5c6a77' }}>（暂无日志）</span>
          ) : (
            serverLogs.map((l, i) => (
              <div key={i} className={l.startsWith('[err]') ? 'err' : undefined}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>

      {toast && <div className={`toast ${toast ? '' : ''}`}>{toast}</div>}
    </div>
  )
}
