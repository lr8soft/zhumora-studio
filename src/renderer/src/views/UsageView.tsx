import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageDaily, UsageByKey, UsageModel, UsageRequest, UsageSummary } from '@shared/types'

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k'
  return n.toLocaleString()
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** key 选择值：'__all__' = 全部；'' = 本地/无 key；其他 = 实际 key */
const ALL = '__all__'

export default function UsageView({ bare }: { bare?: boolean } = {}) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [daily, setDaily] = useState<UsageDaily[]>([])
  const [byModel, setByModel] = useState<UsageModel[]>([])
  const [byKey, setByKey] = useState<UsageByKey[]>([])
  const [requests, setRequests] = useState<UsageRequest[]>([])
  const [selected, setSelected] = useState<string>(ALL)

  const load = useCallback(
    async (sel: string) => {
      const kf = sel === ALL ? undefined : sel
      const [s, d, m, k, req] = await Promise.all([
        window.zhumora.usage.summary(kf),
        window.zhumora.usage.daily(14, kf),
        window.zhumora.usage.byModel(kf),
        window.zhumora.usage.byKey(),
        window.zhumora.usage.requests(200)
      ])
      setSummary(s)
      setDaily(d)
      setByModel(m)
      setByKey(k)
      setRequests(req)
    },
    []
  )

  // 选中 key 变化（含首次）重拉数据
  useEffect(() => {
    void load(selected)
  }, [selected, load])

  const reset = async () => {
    if (!window.confirm(t('usage.resetConfirm'))) return
    await window.zhumora.usage.reset()
    await load(ALL)
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
  const keyLabel = (k: UsageByKey) => (k.key ? (k.name ? `${k.name} · ${maskKey(k.key)}` : maskKey(k.key)) : t('usage.local'))

  return (
    <div className={bare ? 'api-bare' : 'view'}>
      {!bare && (
        <div className="view-header">
          <div>
            <h2>{t('usage.title')}</h2>
            <p>{t('usage.desc')}</p>
          </div>
          <div className="header-actions">
            {/* 按 API key 筛选 */}
            <select
            className="field-input"
            style={{ width: 260, flex: 'none' }}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            title={t('usage.filterKeyTitle')}
          >
            <option value={ALL}>{t('usage.allKeys')}</option>
            <option value="">{t('usage.local')}</option>
            {byKey
              .filter((k) => k.key !== '')
              .map((k) => (
                <option key={k.key} value={k.key}>
                  {keyLabel(k)}
                </option>
              ))}
          </select>
            <button className="btn btn-ghost" onClick={() => void load(selected)}>
              ↻
            </button>
            <button className="btn btn-danger" onClick={() => void reset()} disabled={!summary || summary.requests === 0}>
              {t('usage.reset')}
            </button>
          </div>
        </div>
      )}

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
                  <div className={`usage-bar ${total > 0 ? 'on' : ''}`} style={{ height: `${h}px` }} />
                  <span className="usage-bar-label">{dayLabel(new Date(start.getTime() - (13 - i) * 86400000))}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 按 API key */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            {t('usage.byKey')}
            <span className="sub">{t('usage.byKeyHint')}</span>
          </h3>
        </div>
        {byKey.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 28 }}>
            <div>
              <div className="mark">🔑</div>
              {t('usage.empty')}
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('usage.thKey')}</th>
                <th>{t('usage.thReq')}</th>
                <th>{t('usage.thPrompt')}</th>
                <th>{t('usage.thComp')}</th>
                <th>{t('usage.thTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {byKey.map((k) => {
                const isSel = (selected === ALL ? undefined : selected) === k.key
                return (
                  <tr key={k.key || 'local'} style={isSel ? { background: 'var(--app-active-bg)' } : undefined}>
                    <td
                      className="mono"
                      style={{ fontWeight: 600, cursor: 'pointer' }}
                      onClick={() => setSelected(selected === k.key && selected !== ALL ? ALL : k.key)}
                      title={t('usage.filterKeyTitle')}
                    >
                      {keyLabel(k)}
                    </td>
                    <td>{fmtNum(k.requests)}</td>
                    <td>{fmtNum(k.prompt)}</td>
                    <td>{fmtNum(k.completion)}</td>
                    <td style={{ fontWeight: 650 }}>{fmtNum(k.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
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
                  <td className="mono" style={{ wordBreak: 'break-all', fontWeight: 600 }}>
                    {modelLabel(m.modelId)}
                  </td>
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

      {/* 调用记录：ip + api key + 时间 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>
            {t('usage.requests2')}
            <span className="sub">{t('usage.requestsHint')}</span>
          </h3>
        </div>
        {requests.length === 0 ? (
          <div className="empty-state" style={{ flex: 'none', padding: 28 }}>
            <div>
              <div className="mark">📡</div>
              {t('usage.reqEmpty')}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('usage.thTime')}</th>
                  <th>{t('usage.thIp')}</th>
                  <th>{t('usage.thKey')}</th>
                  <th>{t('usage.thEndpoint')}</th>
                  <th>{t('usage.thStatus')}</th>
                  <th>{t('usage.thTokens')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--app-color-text-mute)' }}>
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className="mono">{r.ip}</td>
                    <td style={{ fontWeight: 600 }}>
                      {r.key ? (
                        <span>
                          {r.name ? `${r.name} · ` : ''}
                          <span className="mono">{maskKey(r.key)}</span>
                        </span>
                      ) : (
                        <span className="badge badge-stopped">{t('usage.local')}</span>
                      )}
                    </td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {r.endpoint}
                    </td>
                    <td>
                      <span className={`badge ${r.status < 400 ? 'badge-ready' : 'badge-error'}`}>{r.status}</span>
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {r.completion !== undefined || r.prompt !== undefined
                        ? `${fmtNum(r.prompt ?? 0)} + ${fmtNum(r.completion ?? 0)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
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
