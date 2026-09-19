import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import type { GlobalDownloadItem } from '@shared/types'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes > 0) return Math.round(bytes / 1024) + ' KB'
  return ''
}
function fmtSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s'
  if (bps > 0) return Math.round(bps / 1024) + ' KB/s'
  return ''
}

/**
 * titlebar 右上角的全局下载入口（参考 LM Studio 的 Downloads 托盘）：
 * 铃铛图标 + 进行中数量角标，点开是下载面板（llama.cpp 运行时 / 模型文件统一列表）。
 */
export default function DownloadBell() {
  const { t } = useTranslation()
  const items = useAppStore((s) => s.globalDownloads)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const list = Object.values(items)
  const ongoing = list.filter((i) => i.status === 'downloading')
  const finished = list.filter((i) => i.status !== 'downloading')

  // 点面板外关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="dl-bell-wrap" ref={ref}>
      <button
        className="dl-bell"
        title={t('downloads.title')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5v8.5M8 10l-3-3M8 10l3-3M2.5 11.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {ongoing.length > 0 && <span className="dl-bell-badge">{ongoing.length}</span>}
      </button>

      {open && (
        <div className="dl-panel">
          <div className="dl-panel-head">
            <strong>{t('downloads.title')}</strong>
            <button className="dl-panel-x" onClick={() => setOpen(false)} aria-label="close">
              ×
            </button>
          </div>

          <div className="dl-panel-section">
            <div className="dl-panel-label">
              {t('downloads.ongoing')}
              {ongoing.length > 0 && ` · ${ongoing.length}`}
            </div>
            {ongoing.length === 0 && <div className="dl-panel-empty">{t('downloads.emptyOngoing')}</div>}
            {ongoing.map((it) => (
              <DlRow key={it.id} it={it} t={t} onCancel={() => void window.zhumora.downloads.cancel(it.id)} />
            ))}
          </div>

          {finished.length > 0 && (
            <div className="dl-panel-section">
              <div className="dl-panel-label">
                {t('downloads.finished')}
                <button className="dl-clear" onClick={() => void useAppStore.getState().clearFinishedDownloads()}>
                  {t('downloads.clear')}
                </button>
              </div>
              {finished.map((it) => (
                <DlRow key={it.id} it={it} t={t} />
              ))}
            </div>
          )}

          {list.length === 0 && (
            <div className="dl-panel-empty" style={{ padding: '16px 12px' }}>
              {t('downloads.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DlRow({
  it,
  t,
  onCancel
}: {
  it: GlobalDownloadItem
  t: (k: string, v?: Record<string, string | number>) => string
  onCancel?: () => void
}) {
  const pct = it.total > 0 ? Math.min(100, (it.done / it.total) * 100) : 0
  const downloading = it.status === 'downloading'
  const kindLabel = it.kind === 'runtime' ? t('downloads.kindRuntime') : t('downloads.kindModel')
  return (
    <div className={`dl-item ${it.status}`}>
      <div className="dl-item-top">
        <span className="dl-item-name" title={it.detail ? `${it.name} · ${it.detail}` : it.name}>
          {it.name}
        </span>
        {downloading && onCancel && (
          <button className="dl-item-cancel" title={t('downloads.cancel')} onClick={onCancel}>
            ×
          </button>
        )}
        {it.status === 'done' && <span className="dl-item-done">✓</span>}
        {it.status === 'failed' && <span className="dl-item-fail" title={it.message}>!</span>}
      </div>
      {it.detail && <div className="dl-item-detail">{it.detail}</div>}
      {downloading ? (
        <>
          <div className="progress" style={{ height: 5 }}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="dl-item-meta">
            <span>
              {fmtSize(it.done)}
              {it.total > 0 ? ` / ${fmtSize(it.total)}` : ''}
              {fmtSpeed(it.speed) ? ` · ${fmtSpeed(it.speed)}` : ''}
            </span>
            {it.total > 0 && <span>{pct.toFixed(0)}%</span>}
          </div>
        </>
      ) : (
        <div className="dl-item-meta">
          <span className={it.status === 'failed' ? 'dl-item-msg' : ''} title={it.message}>
            {it.status === 'failed' ? (it.message ?? t('downloads.failed')) : t('downloads.done')}
          </span>
          <span>{fmtSize(it.total)}</span>
        </div>
      )}
      <div className="dl-item-kind">{kindLabel}</div>
    </div>
  )
}
