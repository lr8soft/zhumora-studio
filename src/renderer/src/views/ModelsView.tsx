import { useEffect } from 'react'
import { useAppStore } from '../store'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return bytes + ' B'
}

export default function ModelsView() {
  const models = useAppStore((s) => s.models)
  const loadModels = useAppStore((s) => s.loadModels)

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const importModel = async () => {
    await window.zhumora.models.import()
    await loadModels()
  }

  const removeModel = async (id: string) => {
    if (!window.confirm('删除该模型文件？')) return
    await window.zhumora.models.remove(id)
    await loadModels()
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>模型库</h2>
          <p>扫描 settings.modelsDir 下的 *.gguf 并解析元数据</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => void importModel()}>
            导入 GGUF…
          </button>
          <button className="btn btn-ghost" onClick={() => void loadModels()}>
            重新扫描
          </button>
        </div>
      </div>

      <div className="card">
        {models.length === 0 ? (
          <div className="empty-state">
            <div>
              <div className="mark">🗂</div>
              模型库为空
              <br />
              点"导入 GGUF…"把 .gguf 文件复制进来，或在设置里更换模型目录
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>名称</th>
                <th>架构</th>
                <th>量化</th>
                <th>大小</th>
                <th>路径</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.arch ?? '—'}</td>
                  <td>{m.quant ? <span className="badge badge-info">{m.quant}</span> : '—'}</td>
                  <td>{fmtSize(m.size)}</td>
                  <td className="mono" style={{ color: 'var(--app-color-text-mute)', wordBreak: 'break-all' }}>
                    {m.path}
                  </td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-sm btn-danger" onClick={() => void removeModel(m.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
