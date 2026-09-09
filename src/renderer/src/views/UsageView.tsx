import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageDaily, UsageModel, UsageSummary } from '@shared/types'

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k'
  return n.toLocaleString()
}

export default function UsageView() {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [daily, setDaily] = useState<UsageDaily[]>([])
  const [byModel, setByModel] = useState<UsageModel[]>([])

  const load = useCallback(async () => {
    const [s, d, m] = await Promise.all([
      window.zhumora.usage.summary(),
      window.zhumora.usage.daily(14),
      window.zhumora.usage.byModel()
    ])
    setSummary(s)
    setDaily(d)
    setByModel(m)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reset = async () => {
    if (!window.confirm(t('usage.resetConfirm'))) return
    await window.zhumora.usage.reset()
    await load()
  }

  // 近 14 天日历：补全没有记录的天（高度归一化用）
  const days: (UsageDaily | null)[] = []
  const now = Date.now()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const dayMap = new Map(daily.map((d) => [d.day, d]))
  for (let i = 13; i >= 0; i--) {
    const ts = start.getTime() - i * 86400000
    const key = dayKey(ts)
    days.push(dayMap.get(key) ?? null)
  }
  const maxTotal = Math.max(1, ...days.map((d) => (d ? d.prompt + d.completion : 0)))
  const activeDays = days.filter(Boolean).length

  const modelLabel = (id: string) => (id ? id.split(/[\\/]/).pop() ?? id : t('usage.unknown'))

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('usage.title')}</h2>
          <p>{t('usage.desc')}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => void load()}>↻</button>
          <button className="btn btn-danger" onClick={() => void reset()} disabled={!summary || summary.requests === 0}>
            {t('usage.reset')}
          </button>
        </div>
      </div>

      {/* 汇总卡 */}
      <div className="grid-4">
        <StatCard label={t('usage.requests')} value={summary ? fmtNum(summary.requests) : '—'} />
        <StatCard label={t('usage.prompt')} value={summary ? fmtNum(summary.prompt) : '—'} />
        <StatCard label={t('usage.completion')} value={summary ? fmtNum(summary.completion) : '—'} />
        <StatCard label={t('usage.total')} value={summary ? fmtNum(summary.total) : '—'} accent />
      </div>

      {/* 近 14 天 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            {t('usage.daily')}
            <span className="sub">{t('usage.dailyHint', { n: String(activeDays) })}</span>
          </h3>
        </div>
        <div className="card-body">
          <div className="usage-bars">
            {days.map((d, i) => {
              const total = d ? d.prompt + d.completion : 0
              const h = Math.max(total > 0 ? 6 : 2, (total / maxTotal) * 84)
              return (
                <div
                  key={i}
                  className="usage-bar-wrap"
                  title={
                    d
                      ? `${d.day} · ${fmtNum(d.prompt)} + ${fmtNum(d.completion)} · ${d.requests} req`
                      : dayLabel(new Date(start.getTime() - (13 - i) * 86400000))
                  }
                >
                  <div
                    className={`usage-bar ${total > 0 ? 'on' : ''}`}
                    style={{ height: `${h}px` }}
                  />
                  <span className="usage-bar-label">{dayLabel(new Date(start.getTime() - (13 - i) * 86400000))}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 按模型 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>{t('usage.byModel')}</h3>
        </div>
        {byModel.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 28 }}>
            <div>
              <div className="mark">📊</div>
              {t('usage.empty')}
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('usage.thModel')}</th>
                <th>{t('usage.thReq')}</th>
                <th>{t('usage.thPrompt')}</th>
                <th>{t('usage.thComp')}</th>
                <th>{t('usage.thTotal')}</th>
                <th>{t('usage.thTps')}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.modelId || 'unknown'}>
                  <td className="mono" style={{ wordBreak: 'break-all', fontWeight: 600 }}>{modelLabel(m.modelId)}</td>
                  <td>{fmtNum(m.requests)}</td>
                  <td>{fmtNum(m.prompt)}</td>
                  <td>{fmtNum(m.completion)}</td>
                  <td style={{ fontWeight: 650 }}>{fmtNum(m.total)}</td>
                  <td>{m.avgTps ? `${m.avgTps.toFixed(1)} tok/s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat-card${accent ? ' accent' : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  )
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`
}
