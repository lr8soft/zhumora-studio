import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArgs, defaultParams, paramsEqual, sanitizeParams } from '../src/shared/buildArgs.ts'
import { LAUNCH_PARAMS } from '../src/shared/launchParams.ts'
import { pickVariant } from '../src/main/runtime/detect.ts'
import type { GpuProbeResult, RuntimeAsset } from '../src/shared/types.ts'

test('defaultParams 覆盖全部 schema key + extraArgs', () => {
  const p = defaultParams()
  for (const spec of LAUNCH_PARAMS) {
    assert.ok(spec.key in p, `缺少 ${spec.key}`)
    assert.deepEqual(p[spec.key], spec.default)
  }
  assert.equal(p.extraArgs, '')
})

test('buildArgs: 默认值生成 --port 1234 且不含空串参数', () => {
  const args = buildArgs(defaultParams())
  const i = args.indexOf('--port')
  assert.ok(i >= 0)
  assert.equal(args[i + 1], '1234')
  // apiKey 默认空 → 不出现
  assert.ok(!args.includes('--api-key'))
  // jinja 默认 true → 出现 flag
  assert.ok(args.includes('--jinja'))
})

test('buildArgs: boolean false 省略 / true 出现', () => {
  const p = defaultParams()
  p.jinja = false
  const args = buildArgs(p)
  assert.ok(!args.includes('--jinja'))
  p.jinja = true
  assert.ok(buildArgs(p).includes('--jinja'))
  p.noMmap = true
  assert.ok(buildArgs(p).includes('--no-mmap'))
})

test('buildArgs: extraArgs 空白分词追加在末尾', () => {
  const p = defaultParams()
  p.extraArgs = '  -np 2   --log-verbosity 2 '
  const args = buildArgs(p)
  assert.deepEqual(args.slice(-4), ['-np', '2', '--log-verbosity', '2'])
})

test('buildArgs: 数字序列化（temp/top-k）', () => {
  const p = defaultParams()
  p.temp = 0.7
  p.topK = 50
  const args = buildArgs(p)
  assert.equal(args[args.indexOf('--temp') + 1], '0.7')
  assert.equal(args[args.indexOf('--top-k') + 1], '50')
})

test('paramsEqual: key 顺序无关，值相关', () => {
  const a = { temp: 0.8, port: 1234 }
  const b = { port: 1234, temp: 0.8 }
  assert.ok(paramsEqual(a as never, b as never))
  b.temp = 0.9
  assert.ok(!paramsEqual(a as never, b as never))
})

test('sanitizeParams: secret 参数脱敏（apiKey）', () => {
  const p = defaultParams()
  p.apiKey = 'sk-123,sk-456'
  const s = sanitizeParams(p)
  assert.equal(s.apiKey, '***')
  assert.equal(s.port, 1234) // 非 secret 不变
})

test('pickVariant: NVIDIA 高驱动 → cuda-13', () => {
  const probe: GpuProbeResult = { arch: 'x64', adapters: ['NVIDIA GeForce RTX 4060'], nvidiaDriver: '580.97' }
  const assets = mkAssets(['cuda-13.3', 'cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(probe, assets), 'cuda-13.3')
})

test('pickVariant: NVIDIA 中驱动 → cuda-12.4', () => {
  const probe: GpuProbeResult = { arch: 'x64', adapters: ['NVIDIA GeForce RTX 3060'], nvidiaDriver: '551.86' }
  const assets = mkAssets(['cuda-13.3', 'cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(probe, assets), 'cuda-12.4')
})

test('pickVariant: AMD → vulkan；无独显 → cpu', () => {
  const amd: GpuProbeResult = { arch: 'x64', adapters: ['AMD Radeon RX 7800 XT'] }
  const none: GpuProbeResult = { arch: 'x64', adapters: ['Microsoft Basic Render Driver'] }
  const assets = mkAssets(['cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(amd, assets), 'vulkan')
  assert.equal(pickVariant(none, assets), 'cpu')
})

test('pickVariant: arm64 架构过滤', () => {
  const probe: GpuProbeResult = { arch: 'arm64', adapters: ['Apple M3'] }
  const assets = [
    mkAsset('cpu', 'arm64'),
    mkAsset('vulkan', 'arm64')
  ]
  // Apple 非 AMD/Intel/NVIDIA → 落到 cpu（arm64 池里没有 vulkan 偏好路径）
  assert.ok(['cpu', 'vulkan'].includes(pickVariant(probe, assets)))
})

function mkAsset(variant: string, arch = 'x64'): RuntimeAsset {
  return {
    name: `llama-b10835-bin-win-${variant}-${arch}.zip`,
    version: 'b10835',
    variant,
    arch,
    size: 1,
    url: 'http://example'
  }
}
function mkAssets(variants: string[]): RuntimeAsset[] {
  return variants.map((v) => mkAsset(v))
}
