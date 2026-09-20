import { useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'

/**
 * 视图 ID：
 * - 主导航（简洁模式默认）: chat / models / settings
 * - 次级（"更多"菜单 / 完整模式）: api / server / status / runtime / keys / usage
 */
export type ViewId = 'chat' | 'models' | 'settings' | 'api' | 'server' | 'status' | 'runtime' | 'keys' | 'usage'

const NAV_SIMPLE: { id: ViewId; labelKey: string }[] = [
  { id: 'chat', labelKey: 'sidebar.chat' },
  { id: 'models', labelKey: 'sidebar.models' },
  { id: 'settings', labelKey: 'sidebar.settings' }
]

const NAV_MORE: { id: ViewId; labelKey: string }[] = [
  { id: 'api', labelKey: 'sidebar.api' },
  { id: 'server', labelKey: 'sidebar.server' },
  { id: 'status', labelKey: 'sidebar.status' },
  { id: 'runtime', labelKey: 'sidebar.runtime' }
]

const NAV_FULL: { id: ViewId; labelKey: string }[] = [
  { id: 'chat', labelKey: 'sidebar.chat' },
  { id: 'models', labelKey: 'sidebar.models' },
  { id: 'server', labelKey: 'sidebar.server' },
  { id: 'status', labelKey: 'sidebar.status' },
  { id: 'runtime', labelKey: 'sidebar.runtime' },
  { id: 'api', labelKey: 'sidebar.api' },
  { id: 'keys', labelKey: 'sidebar.keys' },
  { id: 'usage', labelKey: 'sidebar.usage' },
  { id: 'settings', labelKey: 'sidebar.settings' }
]

export default function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const runtime = useAppStore((s) => s.runtime)
  const settings = useAppStore((s) => s.settings)
  const [moreOpen, setMoreOpen] = useState(false)

  const uiMode = settings?.uiMode ?? 'simple'
  // 完整模式保留全部入口（含密钥/用量独立页）；简洁模式 = 3 主项 + 更多
  const primary = uiMode === 'full' ? NAV_FULL : NAV_SIMPLE
  const moreVisible = uiMode === 'full' ? [] : NAV_MORE
  const isSecondary = (id: ViewId) => uiMode !== 'full' && (NAV_MORE.some((n) => n.id === id) || id === 'keys' || id === 'usage')

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
        {primary.map((item) => {
          const dot =
            item.id === 'server' || item.id === 'status' || item.id === 'api'
              ? serverState.state
              : item.id === 'runtime'
                ? runtime.state
                : null
          const activeDot =
            item.id === 'server' || item.id === 'status' || item.id === 'api'
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

      {/* "更多" 放在滚动 nav 之外：否则 .side-nav 的 overflow:auto 会裁掉弹出的面板 */}
      {moreVisible.length > 0 && (
        <div className="side-more-wrap">
          <div className="side-more">
            <button
              className={moreOpen || isSecondary(view) ? 'active' : ''}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span className="nav-dot" style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block' }} />
              {t('sidebar.more')}
            </button>
            {moreOpen && (
              <>
                <div className="side-more-backdrop" onClick={() => setMoreOpen(false)} />
                <div className="side-more-panel">
                  {moreVisible.map((item) => (
                    <button
                      key={item.id}
                      className={view === item.id ? 'active' : ''}
                      onClick={() => {
                        setMoreOpen(false)
                        onNavigate(item.id)
                      }}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
