import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { Settings } from '@shared/types'

export default function SettingsView() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings && Object.keys(draft).length === 0) setDraft({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const val = <K extends keyof Settings>(k: K): Settings[K] => draft[k] ?? settings?.[k] ?? ({} as Settings)[k]

  const save = async () => {
    const next = await window.zhumora.settings.save(draft)
    setSettings(next)
    setDraft({})
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const pickDir = async () => {
    const p = await window.zhumora.system.pickDirectory()
    if (p) setDraft((d) => ({ ...d, modelsDir: p }))
  }

  const pickBinary = async () => {
    const p = await window.zhumora.system.pickBinary()
    if (p) setDraft((d) => ({ ...d, llamaBinary: p }))
  }

  const openModelsDir = async () => {
    await window.zhumora.system.openPath(settings?.modelsDir ?? '')
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>设置</h2>
          <p>模型目录 / llama-server 二进制 / 外观</p>
        </div>
        <div className="header-actions">
          {saved && <span className="badge badge-ready">已保存</span>}
          <button className="btn btn-primary" onClick={() => void save()}>
            保存设置
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>模型目录</h3></div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="mono"
              style={{ flex: 1, minHeight: 32, padding: '5px 10px', border: '1px solid var(--app-color-border)', borderRadius: 6, background: 'var(--app-color-surface)' }}
              value={String(val('modelsDir'))}
              onChange={(e) => setDraft((d) => ({ ...d, modelsDir: e.target.value }))}
            />
            <button className="btn" onClick={() => void pickDir()}>浏览…</button>
            <button className="btn btn-ghost" onClick={() => void openModelsDir()}>打开</button>
          </div>
          <div className="hint" style={{ fontSize: '0.733rem', color: 'var(--app-color-text-mute)' }}>
            导入的 .gguf 会复制到此目录；更换后到"模型库"页重新扫描
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>llama-server 二进制</h3>
          <span className="sub">留空 = 使用"运行时"页下载的构建</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="mono"
              style={{ flex: 1, minHeight: 32, padding: '5px 10px', border: '1px solid var(--app-color-border)', borderRadius: 6, background: 'var(--app-color-surface)' }}
              value={String(val('llamaBinary'))}
              placeholder="（空 = 自动使用已下载 runtime）"
              onChange={(e) => setDraft((d) => ({ ...d, llamaBinary: e.target.value }))}
            />
            <button className="btn" onClick={() => void pickBinary()}>浏览…</button>
          </div>
          <div style={{ fontSize: '0.733rem', color: 'var(--app-color-text-mute)', lineHeight: 1.5 }}>
            离线环境或想用自定义 CUDA/Vulkan 构建时，在此指定 llama-server.exe 的完整路径，优先级高于自动下载的 runtime。
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>外观</h3></div>
        <div className="card-body">
          <div className="form-row">
            <div className="field">
              <label>主题</label>
              <select
                value={String(val('theme'))}
                onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as Settings['theme'] }))}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
            <div className="field">
              <label>字体大小（px）</label>
              <select
                value={String(val('fontSize'))}
                onChange={(e) => setDraft((d) => ({ ...d, fontSize: Number(e.target.value) }))}
              >
                {[13, 14, 15, 16, 17, 18].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>关于</h3></div>
        <div className="card-body" style={{ fontSize: '0.8rem', color: 'var(--app-color-text-soft)', lineHeight: 1.7 }}>
          <p>Zhumora Studio v0.1.0 — 本地 LLM 工作室（llama.cpp server 可视化封装）</p>
          <p>
            server 启动后提供 OpenAI 兼容端点（<span className="mono">/v1/chat/completions</span> 等），
            地址与 API key 见"服务与参数"页状态卡，可复制给外部应用接入。
          </p>
        </div>
      </div>
    </div>
  )
}
