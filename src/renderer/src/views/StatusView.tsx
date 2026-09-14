import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import type { ServerStatus } from '@shared/types'

const POLL_MS = 2000

function fmtUptime(sec?: number): string {
  if (sec === undefined) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtMem(mb?: number): string {
  if (mb === undefined) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function pct(v: number): string {
  return `${Math.round(v)}%`
}

export default function StatusView() {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const serverLogs = useAppStore((s) => s.serverLogs)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const tick = async () => {
      try {
        const s = await window.zhumora.server.status()
        if (alive) setStatus(s)
      } catch {
        // ignore
      }
    }
    void tick()
    timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [])

  const refresh = () => void window.zhumora.server.status().then(setStatus).catch(() => undefined)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [serverLogs.length])

  const gpus = status?.gpus ?? []
  const cpu = status?.cpu
  const proc = status?.process
  const memTotal = cpu?.totalMB ?? 0
  const memUsed = cpu?.usedMB ?? 0
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('status.title')}</h2>
          <p>{t('status.desc')}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={refresh}>
            ↻
          </button>
        </div>
      </div>

      {/* 进程状态 + 资源 */}
      <div className="grid-3">
        <div className="stat-card">
          <span className="stat-label">{t('status.serverCpu')}</span>
          <strong className="stat-value">
            {proc?.cpu !== undefined ? pct(proc.cpu) : '—'}
          </strong>
          <span className="stat-sub">
            {t('status.uptime')} {fmtUptime(proc?.uptimeSec)}
            {proc?.pid ? ` · PID ${proc.pid}` : ''}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('status.serverMem')}</span>
          <strong className="stat-value">{fmtMem(proc?.memoryMB)}</strong>
          <span className="stat-sub">{t('status.workingSet')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t('status.sysCpu')}</span>
          <strong className="stat-value">{cpu?.load !== undefined ? pct(cpu.load) : '—'}</strong>
          <span className="stat-sub">
            {cpu?.cores ?? '—'} {t('status.cores')}
          </span>
        </div>
      </div>

      {/* 内存条 */}
      <div className="card">
        <div className="card-head">
          <h3>
            {t('status.ram')}
            <span className="sub">
              {fmtMem(memUsed)} / {fmtMem(memTotal)}
            </span>
          </h3>
          <span className="sub">{memPct.toFixed(0)}%</span>
        </div>
        <div className="card-body">
          <div className="progress" style={{ height: 10 }}>
            <div style={{ width: `${Math.min(100, memPct)}%` }} />
          </div>
        </div>
      </div>

      {/* GPU 多卡 */}
      <div className="card">
        <div className="card-head">
          <h3>
            {t('status.gpus')}
            <span className="sub">
              {gpus.length > 0 ? t('status.gpuCount', { n: String(gpus.length) }) : t('status.gpuNone')}
            </span>
          </h3>
          {status?.state.runtime && (
            <span className="badge badge-info" style={{ maxWidth: 420, overflow: 'hidden' }}>
              {status.state.runtime.version ? `${status.state.runtime.version} · ` : ''}
              {status.state.runtime.variant ?? ''}
            </span>
          )}
        </div>
        {gpus.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 28 }}>
            <div>
              <div className="mark">🎮</div>
              {t('status.gpuEmpty')}
            </div>
          </div>
        ) : (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>#{t('status.gpuIdx')}</th>
                <th>{t('status.gpuName')}</th>
                <th>{t('status.gpuMem')}</th>
                <th>{t('status.gpuUtil')}</th>
                <th>{t('status.gpuTemp')}</th>
                <th>{t('status.gpuPower')}</th>
                <th>{t('status.gpuDriver')}</th>
              </tr>
            </thead>
            <tbody>
              {gpus.map((g) => {
                const mp = g.memTotalMB > 0 ? (g.memUsedMB / g.memTotalMB) * 100 : 0
                return (
                  <tr key={g.index}>
                    <td className="mono">{g.index}</td>
                    <td style={{ fontWeight: 600 }}>{g.name}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress" style={{ width: 110, height: 7 }}>
                          <div
                            style={{
                              width: `${Math.min(100, mp)}%`,
                              background: mp > 90 ? 'var(--app-color-danger)' : mp > 70 ? 'var(--app-color-warn)' : 'var(--app-color-primary)'
                            }}
                          />
                        </div>
                        <span className="mono">
                          {fmtMem(g.memUsedMB)} / {fmtMem(g.memTotalMB)}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 650 }}>{pct(g.utilPct)}</td>
                    <td className="mono">{g.tempC}°C</td>
                    <td className="mono">{g.powerW > 0 ? `${g.powerW} W` : '—'}</td>
                    <td className="mono" style={{ color: 'var(--app-color-text-mute)' }}>{g.driver || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 日志（从服务页迁来） */}
      <div className="card">
        <div className="card-head">
          <h3>{t('status.logs')}</h3>
          <span className="sub">{t('status.logsSub')}</span>
        </div>
        <div className="log-view" ref={logRef}>
          {serverLogs.length === 0 ? (
            <span style={{ color: '#5c6a77' }}>{t('status.noLogs')}</span>
          ) : (
            serverLogs.map((l, i) => (
              <div key={i} className={l.startsWith('[err]') ? 'err' : undefined}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
