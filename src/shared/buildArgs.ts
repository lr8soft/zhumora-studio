import { LAUNCH_PARAMS, EXTRA_ARGS_KEY } from './launchParams.ts'
import type { LaunchParams, ParamSpec } from './types.ts'

/** 按 schema 生成默认参数值表 */
export function defaultParams(): LaunchParams {
  const p: LaunchParams = {}
  for (const spec of LAUNCH_PARAMS) {
    p[spec.key] = spec.default
  }
  p[EXTRA_ARGS_KEY] = ''
  return p
}

function serialize(spec: ParamSpec, value: number | string | boolean | undefined): string[] {
  if (value === undefined) return []
  // flag 为空的 spec（纯 UI 参数）不参与启动命令
  if (!spec.flag) return []
  switch (spec.type) {
    case 'boolean':
      return value ? [spec.flag] : []
    case 'number':
      if (!Number.isFinite(value as number)) return []
      return [spec.flag, String(value)]
    default:
      if (typeof value !== 'string' || value.trim() === '') return []
      return [spec.flag, value]
  }
}

/** extraArgs 按空白分词（demo 版不支持引号转义） */
function tokenizeExtra(raw: string): string[] {
  return raw.trim().length ? raw.trim().split(/\s+/) : []
}

/** 纯函数：LaunchParams → llama-server CLI args */
export function buildArgs(params: LaunchParams): string[] {
  const args: string[] = []
  for (const spec of LAUNCH_PARAMS) {
    args.push(...serialize(spec, params[spec.key]))
  }
  const extra = params[EXTRA_ARGS_KEY]
  if (typeof extra === 'string') {
    args.push(...tokenizeExtra(extra))
  }
  return args
}

/** 语义比较：key 顺序无关，值相关（用于判断是否需要重启） */
export function paramsEqual(a: LaunchParams, b: LaunchParams): boolean {
  if (buildArgs(a).join('\u0000') !== buildArgs(b).join('\u0000')) return false
  return true
}

/** 脱敏：secret 参数替换为 ***（用于日志 / 展示） */
export function sanitizeParams(params: LaunchParams): LaunchParams {
  const out: LaunchParams = { ...params }
  for (const spec of LAUNCH_PARAMS) {
    if (spec.secret && typeof out[spec.key] === 'string' && out[spec.key] !== '') {
      out[spec.key] = '***'
    }
  }
  return out
}
