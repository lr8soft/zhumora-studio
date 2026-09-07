export default function TitleBar() {
  return (
    <header className="window-titlebar">
      <div className="window-identity">
        <div className="brand-mark" style={{ width: 20, height: 20, borderRadius: 5 }}>
          Z
        </div>
        <span>Zhumora Studio</span>
      </div>
      <div className="window-drag-space" />
      <div className="window-controls">
        <button title="最小化" onClick={() => void window.zhumora.window.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 5.5h9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button title="最大化" onClick={() => void window.zhumora.window.maximize()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="window-close" title="关闭" onClick={() => void window.zhumora.window.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </header>
  )
}
