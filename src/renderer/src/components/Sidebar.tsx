import { useAppStore } from '../store'

export type ViewId = 'runtime' | 'models' | 'server' | 'chat' | 'settings'

const NAV: { id: ViewId; label: string }[] = [
  { id: 'runtime', label: '运行时' },
  { id: 'models', label: '模型库' },
  { id: 'server', label: '服务与参数' },
  { id: 'chat', label: '对话' },
  { id: 'settings', label: '设置' }
]

export default function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  const serverState = useAppStore((s) => s.serverState)
  const runtime = useAppStore((s) => s.runtime)

  const dotClass =
    runtime.state === 'ready'
      ? 'dot-ready'
      : runtime.state === 'downloading' || runtime.state === 'extracting'
        ? 'dot-downloading'
        : runtime.state === 'error'
          ? 'dot-error'
          : 'dot-stopped'
  const dotLabel =
    runtime.state === 'ready'
      ? `llama ${runtime.version ?? ''} · ${runtime.variant ?? ''}`
      : runtime.state === 'downloading'
        ? 'llama.cpp 下载中…'
        : runtime.state === 'error'
          ? '运行时错误'
          : '运行时未就绪'

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Z</div>
        <div>
          <strong>Zhumora Studio</strong>
          <small>本地 LLM 工作室</small>
        </div>
      </div>
      <nav className="side-nav">
        {NAV.map((item) => {
          const dot =
            item.id === 'server' ? serverState.state : item.id === 'runtime' ? runtime.state : null
          const activeDot =
            item.id === 'server'
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
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="side-footer">
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
                server 运行中
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
