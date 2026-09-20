import { useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import type { ApiKeyInfo } from '@shared/types'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

export default function KeysView({ bare }: { bare?: boolean } = {}) {
  const { t } = useTranslation()
  const keys = useAppStore((s) => s.keys)
  const serverState = useAppStore((s) => s.serverState)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const generate = async () => {
    setError('')
    try {
      const k = await window.zhumora.keys.generate()
      setKey(k)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const add = async () => {
    const k = key.trim()
    if (k.length < 4) {
      setError(t('keys.errShort'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const list = await window.zhumora.keys.add(name.trim(), k)
      useAppStore.getState().setKeys(list)
      setName('')
      setKey('')
    } catch (e) {
      const msg = (e as Error).message
      setError(msg === 'KEY_EXISTS' ? t('keys.duplicate') : msg)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (k: ApiKeyInfo) => {
    if (!window.confirm(t('keys.confirmDelete'))) return
    const list = await window.zhumora.keys.remove(k.id)
    useAppStore.getState().setKeys(list)
  }

  const copy = async (k: ApiKeyInfo) => {
    try {
      await navigator.clipboard.writeText(k.key)
    } catch {
      // 忽略
    }
    setCopiedId(k.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className={bare ? 'api-bare' : 'view'}>
      {!bare && (
        <div className="view-header">
          <div>
            <h2>{t('keys.title')}</h2>
            <p>{t('keys.desc')}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>
            {t('keys.title')}
            <span className="sub">{t('keys.count', { n: String(keys.length) })}</span>
          </h3>
          {serverState.state === 'ready' && keys.length > 0 && (
            <span className="badge badge-ready">{t('keys.active')}</span>
          )}
        </div>
        <div className="card-body">
          {/* 添加行 */}
          <div className="keys-add">
            <input
              type="text"
              className="field-input"
              style={{ width: 160, flex: 'none' }}
              placeholder={t('keys.namePh')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="text"
              className="field-input mono"
              style={{ flex: 1 }}
              placeholder={t('keys.keyPh')}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <button className="btn" onClick={() => void generate()} title={t('keys.generate')}>
              ⚄ {t('keys.generate')}
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void add()}>
              {t('keys.add')}
            </button>
          </div>
          {error && <div className="status-error" style={{ marginTop: 10 }}>{error}</div>}

          {keys.length === 0 ? (
            <div className="empty-state" style={{ flex: 'none', padding: 28 }}>
              <div>
                <div className="mark">🔑</div>
                {t('keys.empty')}
              </div>
            </div>
          ) : (
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>{t('keys.thName')}</th>
                  <th>{t('keys.thKey')}</th>
                  <th style={{ width: 150 }}>{t('keys.thAdded')}</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}>{k.name || '—'}</td>
                    <td>
                      <span className="mono">{maskKey(k.key)}</span>
                    </td>
                    <td style={{ color: 'var(--app-color-text-mute)', fontSize: '0.767rem' }}>{fmtDate(k.createdAt)}</td>
                    <td>
                      <div className="cell-actions">
                        <button className="btn btn-sm" onClick={() => void copy(k)}>
                          {copiedId === k.id ? t('keys.copied') : t('keys.copy')}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => void remove(k)}>
                          {t('keys.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="hint" style={{ marginTop: 12 }}>{t('keys.hint')}</div>
        </div>
      </div>
    </div>
  )
}
