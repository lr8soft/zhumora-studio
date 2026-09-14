import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LAUNCH_PARAMS, PARAM_CATEGORIES, EXTRA_ARGS_KEY } from '@shared/launchParams'
import type { LaunchParams, ParamSpec } from '@shared/types'

interface Props {
  value: LaunchParams
  onChange: (next: LaunchParams) => void
  disabled?: boolean
  /** 是否显示"高级"折叠项，默认显示 */
  showAdvanced?: boolean
}

/** select 选项值 → 翻译 key 的映射（无映射的选项原样显示） */
const OPTION_TKEYS: Record<string, Record<string, string>> = {
  splitMode: { auto: 'params.splitModes.auto', none: 'params.splitModes.none', layer: 'params.splitModes.layer', row: 'params.splitModes.row', tensor: 'params.splitModes.tensor' },
  flashAttention: { auto: 'params.flash.auto', on: 'params.flash.on', off: 'params.flash.off' },
  numa: { auto: 'params.numa.auto', distribute: 'params.numa.distribute', isolate: 'params.numa.isolate', numactl: 'params.numa.numactl' },
  loadMode: { auto: 'params.loadMode.auto', none: 'params.loadMode.none', mmap: 'params.loadMode.mmap', mlock: 'params.loadMode.mlock', 'mmap+mlock': 'params.loadMode.mmapMlock', dio: 'params.loadMode.dio' }
}

/** 由 launchParams schema 驱动的动态参数表单（文案走 i18n，schema 文案兜底） */
export default function ParamForm({ value, onChange, disabled, showAdvanced = true }: Props) {
  const { t } = useTranslation()
  // modelPath / mmproj 由调用方特判渲染（模型库下拉 + 浏览），不在通用表单里重复
  const byCategory = useMemo(() => {
    const map = new Map<string, ParamSpec[]>()
    for (const c of PARAM_CATEGORIES) map.set(c.id, [])
    for (const spec of LAUNCH_PARAMS) {
      if (spec.key === 'modelPath' || spec.key === 'mmproj' || spec.hidden) continue
      map.get(spec.category)?.push(spec)
    }
    return map
  }, [])

  const set = (key: string, v: number | string | boolean) => onChange({ ...value, [key]: v })

  const labelOf = (spec: ParamSpec): string => t(`params.labels.${spec.key}`, { defaultValue: spec.label })
  const hintOf = (spec: ParamSpec): string => (spec.hint ? t(`params.hints.${spec.key}`, { defaultValue: spec.hint }) : '')

  const optionLabel = (spec: ParamSpec, o: { value: string; label: string }): string => {
    if (o.value === '' && (spec.key === 'cacheK' || spec.key === 'cacheV')) return t('params.cacheAuto')
    const k = OPTION_TKEYS[spec.key]?.[o.value]
    return k ? t(k) : o.label
  }

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
              {t(`params.${cat.id}`)}
              <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {cat.id === 'sampling' ? t('params.samplingSub') : ''}
              </span>
            </div>
            <div className="form-row">
              {basic.map((spec) => (
                <Field
                  key={spec.key}
                  spec={spec}
                  label={labelOf(spec)}
                  hint={hintOf(spec)}
                  optionLabel={optionLabel}
                  value={value[spec.key]}
                  disabled={disabled}
                  onChange={(v) => set(spec.key, v)}
                />
              ))}
            </div>
            {advanced.length > 0 && (
              <details className="advanced">
                <summary>{t('params.advanced', { n: advanced.length })}</summary>
                <div className="form-row">
                  {advanced.map((spec) => (
                    <Field
                      key={spec.key}
                      spec={spec}
                      label={labelOf(spec)}
                      hint={hintOf(spec)}
                      optionLabel={optionLabel}
                      value={value[spec.key]}
                      disabled={disabled}
                      onChange={(v) => set(spec.key, v)}
                    />
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
            <label>{t('params.extraLabel')}</label>
            <input
              type="text"
              className="mono"
              placeholder={t('params.extraPh')}
              value={String(value[EXTRA_ARGS_KEY] ?? '')}
              disabled={disabled}
              onChange={(e) => set(EXTRA_ARGS_KEY, e.target.value)}
            />
            <div className="hint">{t('params.extraHint')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  spec,
  label,
  hint,
  optionLabel,
  value,
  disabled,
  onChange
}: {
  spec: ParamSpec
  label: string
  hint: string
  optionLabel: (spec: ParamSpec, o: { value: string; label: string }) => string
  value: number | string | boolean | undefined
  disabled?: boolean
  onChange: (v: number | string | boolean) => void
}) {
  const { t } = useTranslation()
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
          <span>{label}</span>
          {hint && <span className="hint">（{hint}）</span>}
        </label>
      )
    case 'select':
      return (
        <div className={cls('field')}>
          <label>{label}</label>
          <select
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {(spec.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {optionLabel(spec, o)}
              </option>
            ))}
          </select>
          {hint && <div className="hint">{hint}</div>}
        </div>
      )
    case 'number':
      return (
        <div className={cls('field')}>
          <label>{label}</label>
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
          {hint && <div className="hint">{hint}</div>}
        </div>
      )
    case 'textarea':
      return (
        <div className="field field-full">
          <label>{label}</label>
          <textarea
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {hint && <div className="hint">{hint}</div>}
        </div>
      )
    default:
      // string
      return (
        <div className={cls('field')}>
          <label>{label}</label>
          <input
            type={spec.secret ? 'password' : 'text'}
            className={spec.secret ? undefined : spec.mono ? 'mono' : undefined}
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {hint && <div className="hint">{hint}</div>}
        </div>
      )
  }
}
