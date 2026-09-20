import { useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import KeysView from './KeysView'
import UsageView from './UsageView'

/**
 * API 服务（面向集成者）：端点 / 密钥 / 用量。
 * 简洁模式下密钥与用量不再占独立导航项，统一收进本页的 tab。
 */
export default function ApiView() {
  const { t } = useTranslation()
  const serverState = useAppStore((s) => s.serverState)
  const keys = useAppStore((s) => s.keys)
  const [tab, setTab] = useState<'endpoint' | 'keys' | 'usage'>('endpoint')
  const [toast, setToast] = useState<string | null>(null)

  const endpoint = serverState.host ? `http://${serverState.host}:${serverState.port}/v1` : ''

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(t('api.copied'))
      setTimeout(() => setToast(null), 1800)
    } catch {
      // 忽略
    }
  }

  const curlExample = endpoint
    ? `curl ${endpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  ${keys.length > 0 ? '-H "Authorization: Bearer <your-api-key>" \\\n  ' : ''}-d '{"model": "local-model", "messages": [{"role": "user", "content": "你好"}]}'`
    : ''

  const pyExample = endpoint
    ? `import openai

client = openai.OpenAI(
    base_url="${endpoint}",
    api_key="${keys.length > 0 ? '<your-api-key>' : 'not-required'}"
)
resp = client.chat.completions.create(
    model="local-model",
    messages=[{"role": "user", "content": "你好"}]
)`
    : ''

  return (
    <div className="view api-view">
      <div className="view-header">
        <div>
          <h2>{t('api.title')}</h2>
          <p>{t('api.desc')}</p>
        </div>
        <div className="header-actions api-tabs">
          {(['endpoint', 'keys', 'usage'] as const).map((k) => (
            <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>
              {t(`api.tab.${k}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'endpoint' && (
        <div>
          <div className="card">
            <div className="card-head">
              <h3>{t('api.endpoint')}</h3>
              <span className={`badge ${serverState.state === 'ready' ? 'badge-ready' : 'badge-stopped'}`}>
                {serverState.state === 'ready' ? t('chat.connected') : t('chat.goStart')}
              </span>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 10 }}>
              <div className="field">
                <label>{t('api.endpointLabel')}</label>
                <div className="pick">
                  <input type="text" className="mono" readOnly value={endpoint || t('api.noServer')} />
                  <button className="btn" onClick={() => void copy(endpoint)} disabled={!endpoint}>
                    {t('api.copy')}
                  </button>
                </div>
                <div className="hint">{t('api.endpointHint')}</div>
              </div>
              <div className="field">
                <label>API Key</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${keys.length > 0 ? 'badge-info' : 'badge-stopped'}`}>
                    {keys.length > 0 ? t('server.keysCount', { n: String(keys.length) }) : t('server.keysNone')}
                  </span>
                  <button className="btn btn-sm" onClick={() => setTab('keys')}>
                    {t('api.manageKeys')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>{t('api.examples')}</h3>
              <span className="sub">{t('api.examplesSub')}</span>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="badge badge-info">cURL</span>
                  <button className="btn btn-sm" onClick={() => void copy(curlExample)} disabled={!endpoint}>
                    {t('api.copy')}
                  </button>
                </div>
                <pre className="readme-code">{endpoint ? curlExample : t('api.noServer')}</pre>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="badge badge-info">Python</span>
                  <button className="btn btn-sm" onClick={() => void copy(pyExample)} disabled={!endpoint}>
                    {t('api.copy')}
                  </button>
                </div>
                <pre className="readme-code">{endpoint ? pyExample : t('api.noServer')}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'keys' && (
        <div className="api-embed">
          <KeysView />
        </div>
      )}
      {tab === 'usage' && (
        <div className="api-embed">
          <UsageView />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
