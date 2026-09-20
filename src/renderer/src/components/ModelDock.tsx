import { useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import type { ViewId } from './Sidebar'
import { buildArgs } from '@shared/buildArgs'
import type { LaunchParams } from '@shared/types'

/**
 * 全局模型坞：当前模型 + 启动/停止 + 端点。
 * 取代原"服务"页的状态卡与启停按钮，吸顶常驻，任何页面都能控制 server。
 */
export default function ModelDock({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const models = useAppStore((s) => s.models)
  const runtime = useAppStore((s) => s.runtime)
  const settings = useAppStore((s) => s.settings)
  const keys = useAppStore((s) => s.keys)
  const paramDraft = useAppStore((s) => s.paramDraft)
  const launching = useAppStore((s) => s.launching)
  const [toast, setToast] = useState<string | null>(null)

  const modelChoices = models.filter((m) => m.kind === 'model')
  const hasCustomBinary = Boolean(settings?.llamaBinary?.trim())
  const binaryReady = runtime.state === 'ready' || hasCustomBinary
  const running = serverState.state === 'starting' || serverState.state === 'ready'

  // 参数与上次启动不一致（运行中改参/换模型）→ 需重启生效
  const stale =
    serverState.state === 'ready' &&
    JSON.stringify(buildArgs(paramDraft)) !== JSON.stringify(buildArgs(settings?.lastParams ?? paramDraft))

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const start = async () => {
    try {
      await window.zhumora.server.start(paramDraft)
      useAppStore.getState().setParamDirty(false)
      // 同步 main 侧已落盘的 lastParams，避免 stale 判定误报
      const next = await window.zhumora.settings.get()
      useAppStore.getState().setSettings(next)
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

  // 下拉换模型 = 选模型 + 自动调参 + 启动（一条链）
  const pickModel = async (path: string) => {
    try {
      await useAppStore.getState().launchModel(path)
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const pickModelFile = async () => {
    const p = await window.zhumora.system.pickModel()
    if (p) {
      useAppStore.getState().loadModels()
      void pickModel(p)
    }
  }

  const endpoint = serverState.host ? `http://${serverState.host}:${serverState.port}/v1` : ''

  const copyEndpoint = async () => {
    if (!endpoint) return
    try {
      await navigator.clipboard.writeText(endpoint)
      showToast(t('server.copied'))
    } catch {
      // 忽略
    }
  }

  const currentName = (() => {
    if (!paramDraft.modelPath) return ''
    const m = modelChoices.find((x) => x.path === paramDraft.modelPath)
    if (m) return m.quant ? `${m.name} (${m.quant})` : m.name
    return (paramDraft.modelPath as string).split(/[\\/]/).pop() ?? ''
  })()

  const dotCls =
    serverState.state === 'ready'
      ? 'dot-ready'
      : serverState.state === 'starting'
        ? 'dot-starting'
        : serverState.state === 'error'
          ? 'dot-error'
          : 'dot-stopped'

  const btnTitle = !binaryReady
    ? t('server.needRuntime')
    : !paramDraft.modelPath
      ? t('server.needModel')
      : undefined

  return (
    <div className="model-dock">
      <span className={`dot ${dotCls}`} title={t(`server.state.${serverState.state}`)} />

      {/* 当前模型 */}
      <select
        className="dock-model"
        value={modelChoices.some((m) => m.path === paramDraft.modelPath) ? (paramDraft.modelPath as string) : ''}
        disabled={running}
        onChange={(e) => {
          if (e.target.value) void pickModel(e.target.value)
        }}
        title={currentName || t('dock.noModel')}
      >
        <option value="">{t('dock.noModel')}</option>
        {modelChoices.map((m) => (
          <option key={m.id} value={m.path}>
            {m.name}
            {m.quant ? ` (${m.quant})` : ''}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost btn-sm" onClick={() => void pickModelFile()} disabled={running} title={t('dock.browse')}>
        {t('dock.browse')}
      </button>
      {modelChoices.length === 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('models')}>
          {t('dock.getModels')}
        </button>
      )}

      <span className="dock-spacer" />

      {/* 状态提示（需重启 / 运行时未就绪） */}
      {stale && <span className="badge badge-starting" title={t('server.stale')}>{t('server.stale')}</span>}
      {!binaryReady && (
        <button
          className="badge badge-error dock-badge-btn"
          onClick={() => onNavigate('runtime')}
          title={t('server.needRuntime')}
        >
          {runtime.state === 'downloading' || runtime.state === 'extracting'
            ? t('sidebar.downloading')
            : t('dock.runtimeNotReady')}
        </button>
      )}
      {serverState.state === 'ready' && (
        <span className={`badge ${keys.length > 0 ? 'badge-info' : 'badge-stopped'}`}>
          {keys.length > 0 ? t('server.keysCount', { n: String(keys.length) }) : t('server.keysNone')}
        </span>
      )}

      {/* 端点 */}
      {serverState.state === 'ready' && (
        <button className="dock-endpoint" onClick={() => void copyEndpoint()} title={`${t('sidebar.url')}: ${endpoint}`}>
          <span className="mono">{endpoint}</span>
          <span className="dock-copy" title={t('server.copyEndpoint')}>⧉</span>
        </button>
      )}

      {/* 主按钮 */}
      {launching ? (
        <button className="btn btn-primary dock-action" disabled>
          {t('dock.launching')}
        </button>
      ) : serverState.state === 'starting' ? (
        <button className="btn dock-action" disabled>
          {t('server.state.starting')}
        </button>
      ) : serverState.state === 'ready' ? (
        stale ? (
          <button className="btn btn-primary dock-action" onClick={() => void start()}>
            {t('dock.restartApply')}
          </button>
        ) : (
          <button className="btn btn-danger dock-action" onClick={() => void stop()}>
            {t('dock.stop')}
          </button>
        )
      ) : (
        <button
          className="btn btn-primary dock-action"
          onClick={() => void start()}
          disabled={!binaryReady || !paramDraft.modelPath}
          title={btnTitle}
        >
          {serverState.state === 'error' ? t('server.restart') : t('server.start')}
        </button>
      )}

      {serverState.state === 'error' && serverState.error && (
        <span className="dock-error" title={serverState.error}>
          ⚠ {serverState.error.length > 60 ? serverState.error.slice(0, 60) + '…' : serverState.error}
        </span>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
