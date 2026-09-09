import { useMemo } from 'react'
import { LAUNCH_PARAMS, PARAM_CATEGORIES, EXTRA_ARGS_KEY } from '@shared/launchParams'
import type { LaunchParams, ParamSpec } from '@shared/types'

interface Props {
  value: LaunchParams
  onChange: (next: LaunchParams) => void
  disabled?: boolean
  /** 是否显示"高级"折叠项，默认显示 */
  showAdvanced?: boolean
}

/** 由 launchParams schema 驱动的动态参数表单 */
export default function ParamForm({ value, onChange, disabled, showAdvanced = true }: Props) {
  // modelPath / mmproj 由调用方特判渲染（模型库下拉 + 浏览），不在通用表单里重复
  const byCategory = useMemo(() => {
    const map = new Map<string, ParamSpec[]>()
    for (const c of PARAM_CATEGORIES) map.set(c.id, [])
    for (const spec of LAUNCH_PARAMS) {
      if (spec.key === 'modelPath' || spec.key === 'mmproj') continue
      map.get(spec.category)?.push(spec)
    }
    return map
  }, [])

  const set = (key: string, v: number | string | boolean) => onChange({ ...value, [key]: v })

  return (
    <div>
      {PARAM_CATEGORIES.map((cat) => {
        const specs = byCategory.get(cat.id) ?? []
        if (specs.length === 0) return null
        const basic = showAdvanced ? specs.filter((s) => !s.advanced) : specs
        const advanced = showAdvanced ? specs.filter((s) => s.advanced) : []
        return (
          <div className="form-section" key={cat.id}>
            <div className="form-section-title">
              {cat.label}
              <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {cat.id === 'sampling' ? 'server 级默认值，可在对话高级项覆盖' : ''}
              </span>
            </div>
            <div className="form-row">
              {basic.map((spec) => (
                <Field key={spec.key} spec={spec} value={value[spec.key]} disabled={disabled} onChange={(v) => set(spec.key, v)} />
              ))}
            </div>
            {advanced.length > 0 && (
              <details className="advanced">
                <summary>高级（{advanced.length} 项）</summary>
                <div className="form-row">
                  {advanced.map((spec) => (
                    <Field key={spec.key} spec={spec} value={value[spec.key]} disabled={disabled} onChange={(v) => set(spec.key, v)} />
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}
      <div className="form-section">
        <div className="form-row">
          <div className="field field-full">
            <label>原始参数（extra）</label>
            <input
              type="text"
              className="mono"
              placeholder="空格分隔，原样追加到命令末尾，如 --log-verbosity 2 -np 2"
              value={String(value[EXTRA_ARGS_KEY] ?? '')}
              disabled={disabled}
              onChange={(e) => set(EXTRA_ARGS_KEY, e.target.value)}
            />
            <div className="hint">schema 未覆盖的 flag 从这里透传；与表单参数同时存在时按命令行顺序生效</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  spec,
  value,
  disabled,
  onChange
}: {
  spec: ParamSpec
  value: number | string | boolean | undefined
  disabled?: boolean
  onChange: (v: number | string | boolean) => void
}) {
  const cls = (base: string) => (spec.fullWidth ? `${base} field-full` : base)
  switch (spec.type) {
    case 'boolean':
      return (
        <label className={cls('check-line')}>
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{spec.label}</span>
          {spec.hint && <span className="hint">（{spec.hint}）</span>}
        </label>
      )
    case 'select':
      return (
        <div className={cls('field')}>
          <label>{spec.label}</label>
          <select
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {(spec.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {spec.hint && <div className="hint">{spec.hint}</div>}
        </div>
      )
    case 'number':
      return (
        <div className={cls('field')}>
          <label>{spec.label}</label>
          <input
            type="number"
            value={typeof value === 'number' ? value : Number(value ?? spec.default) || 0}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? (Number.isInteger(spec.default as number) ? 1 : 0.1)}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(n)
            }}
          />
          {spec.hint && <div className="hint">{spec.hint}</div>}
        </div>
      )
    case 'textarea':
      return (
        <div className="field field-full">
          <label>{spec.label}</label>
          <textarea
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {spec.hint && <div className="hint">{spec.hint}</div>}
        </div>
      )
    default:
      // string
      return (
        <div className={cls('field')}>
          <label>{spec.label}</label>
          <input
            type={spec.secret ? 'password' : 'text'}
            className={spec.secret ? undefined : spec.mono ? 'mono' : undefined}
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {spec.hint && <div className="hint">{spec.hint}</div>}
        </div>
      )
  }
}
