import { useTranslation } from 'react-i18next'

export default function TitleBar() {
  const { t } = useTranslation()
  return (
    <header className="window-titlebar">
      <div className="window-identity">
        <div className="brand-mark" style={{ width: 20, height: 20, borderRadius: 5 }}>
          Z
        </div>
        <span>{t('app.name')}</span>
      </div>
      <div className="window-drag-space" />
      <div className="window-controls">
        <button title={t('window.min')} onClick={() => void window.zhumora.window.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 5.5h9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button title={t('window.max')} onClick={() => void window.zhumora.window.maximize()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="window-close" title={t('window.close')} onClick={() => void window.zhumora.window.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </header>
  )
}
