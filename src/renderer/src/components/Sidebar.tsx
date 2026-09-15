import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'

export type ViewId = 'runtime' | 'models' | 'server' | 'status' | 'chat' | 'keys' | 'usage' | 'settings'

const NAV: { id: ViewId; labelKey: string }[] = [
  { id: 'runtime', labelKey: 'sidebar.runtime' },
  { id: 'models', labelKey: 'sidebar.models' },
  { id: 'server', labelKey: 'sidebar.server' },
  { id: 'status', labelKey: 'sidebar.status' },
  { id: 'chat', labelKey: 'sidebar.chat' },
  { id: 'keys', labelKey: 'sidebar.keys' },
  { id: 'usage', labelKey: 'sidebar.usage' },
  { id: 'settings', labelKey: 'sidebar.settings' }
]

export default function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const runtime = useAppStore((s) => s.runtime)
  const settings = useAppStore((s) => s.settings)

  // 用户已指定自定义 llama-server 时，即使自动下载的 runtime 处于 error/detected，
  // 二进制也真正可用（ServerManager 优先用自定义路径），侧栏应显示为就绪而非报错。
  const hasCustomBinary = Boolean(settings?.llamaBinary?.trim())

  const dotClass = hasCustomBinary
    ? 'dot-ready'
    : runtime.state === 'ready'
      ? 'dot-ready'
      : runtime.state === 'downloading' || runtime.state === 'extracting'
        ? 'dot-downloading'
        : runtime.state === 'error'
          ? 'dot-error'
          : 'dot-stopped'
  const dotLabel = hasCustomBinary
    ? t('runtime.customTitle')
    : runtime.state === 'ready'
      ? `llama ${runtime.version ?? ''} · ${runtime.variant ?? ''}`
      : runtime.state === 'downloading'
        ? t('sidebar.downloading')
        : runtime.state === 'error'
          ? t('sidebar.error')
          : t('sidebar.notReady')

  const url = serverState.host ? `http://${serverState.host}:${serverState.port}` : ''

  const copyUrl = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // 忽略
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Z</div>
        <div>
          <strong>{t('app.name')}</strong>
          <small>{t('app.sub')}</small>
        </div>
      </div>
      <nav className="side-nav">
        {NAV.map((item) => {
          const dot =
            item.id === 'server' || item.id === 'status'
              ? serverState.state
              : item.id === 'runtime'
                ? runtime.state
                : null
          const activeDot =
            item.id === 'server' || item.id === 'status'
              ? dot === 'ready'
                ? 'dot-ready'
                : dot === 'starting'
                  ? 'dot-starting'
                  : dot === 'error'
                    ? 'dot-error'
                    : 'dot-stopped'
              : item.id === 'runtime'
                ? dotClass
                : null
          return (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => onNavigate(item.id)}
            >
              <span className={activeDot ?? 'nav-dot'} style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: activeDot ? 'currentColor' : undefined }} />
              {t(item.labelKey)}
            </button>
          )
        })}
      </nav>
      <div className="side-footer">
        {/* 接口地址（URL）— 点一下复制 */}
        {url && (
          <button
            className="side-url"
            title={`${t('sidebar.url')}: ${url}/v1`}
            onClick={() => void copyUrl()}
          >
            <span className="url-label">{t('sidebar.url')}</span>
            <span className="url-value mono">{url}</span>
          </button>
        )}
        <div className="server-pill">
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
          <span style={{ minWidth: 0 }}>
            {serverState.state === 'ready' ? (
              <>
                {t('sidebar.ready')}
                <br />
                <span className="mono">
                  {serverState.host}:{serverState.port}
                </span>
              </>
            ) : (
              dotLabel
            )}
          </span>
        </div>
      </div>
    </aside>
  )
}
