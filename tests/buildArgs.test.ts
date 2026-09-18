import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArgs, defaultParams, paramsEqual, sanitizeParams } from '../src/shared/buildArgs.ts'
import { LAUNCH_PARAMS } from '../src/shared/launchParams.ts'
import { pickVariant } from '../src/main/runtime/detect.ts'
import { assetRe, CUDART_RE } from '../src/main/runtime/github.ts'
import { compareVersions, buildNum } from '../src/shared/version.ts'
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
  p.ignoreEos = true
  assert.ok(buildArgs(p).includes('--ignore-eos'))
})

test('buildArgs: chatTemplateFile 序列化 / 空值省略', () => {
  const p = defaultParams()
  assert.ok(!buildArgs(p).includes('--chat-template-file'))
  p.chatTemplateFile = 'D:/templates/tpl.jinja'
  const args = buildArgs(p)
  assert.equal(args[args.indexOf('--chat-template-file') + 1], 'D:/templates/tpl.jinja')
})

test('buildArgs: loadMode select 序列化 / 空值省略', () => {
  const p = defaultParams()
  assert.ok(!buildArgs(p).includes('--load-mode')) // 默认空 → 不出现
  p.loadMode = 'mmap+mlock'
  const args = buildArgs(p)
  assert.equal(args[args.indexOf('--load-mode') + 1], 'mmap+mlock')
  p.loadMode = 'mlock'
  assert.equal(buildArgs(p)[buildArgs(p).indexOf('--load-mode') + 1], 'mlock')
})

test('buildArgs: numa 仅接受合法值', () => {
  const p = defaultParams()
  p.numa = 'isolate'
  const args = buildArgs(p)
  assert.equal(args[args.indexOf('--numa') + 1], 'isolate')
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

test('pickVariant: Windows NVIDIA 高驱动 → cuda-13', () => {
  const probe: GpuProbeResult = { arch: 'x64', platform: 'win', adapters: ['NVIDIA GeForce RTX 4060'], nvidiaDriver: '580.97' }
  const assets = mkAssets(['cuda-13.3', 'cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(probe, assets), 'cuda-13.3')
})

test('pickVariant: Windows NVIDIA 中驱动 → cuda-12.4', () => {
  const probe: GpuProbeResult = { arch: 'x64', platform: 'win', adapters: ['NVIDIA GeForce RTX 3060'], nvidiaDriver: '551.86' }
  const assets = mkAssets(['cuda-13.3', 'cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(probe, assets), 'cuda-12.4')
})

test('pickVariant: Linux NVIDIA 官方构建无 cuda → 落到 vulkan', () => {
  const probe: GpuProbeResult = { arch: 'x64', platform: 'linux', adapters: ['NVIDIA GeForce RTX 3090'], nvidiaDriver: '580.97' }
  const assets = mkAssets(['vulkan', 'cpu'])
  assert.equal(pickVariant(probe, assets), 'vulkan')
  // vulkan 也不可用时落到 cpu
  assert.equal(pickVariant(probe, mkAssets(['cpu'])), 'cpu')
})

test('pickVariant: AMD → vulkan；无独显 → cpu', () => {
  const amd: GpuProbeResult = { arch: 'x64', platform: 'win', adapters: ['AMD Radeon RX 7800 XT'] }
  const none: GpuProbeResult = { arch: 'x64', platform: 'win', adapters: ['Microsoft Basic Render Driver'] }
  const assets = mkAssets(['cuda-12.4', 'vulkan', 'cpu'])
  assert.equal(pickVariant(amd, assets), 'vulkan')
  assert.equal(pickVariant(none, assets), 'cpu')
})

test('pickVariant: arm64 架构过滤', () => {
  const probe: GpuProbeResult = { arch: 'arm64', platform: 'macos', adapters: ['Apple M3'] }
  const assets = [
    mkAsset('cpu', 'arm64'),
    mkAsset('vulkan', 'arm64')
  ]
  // Apple 非 AMD/Intel/NVIDIA → 落到 cpu（arm64 池里没有 vulkan 偏好路径）
  assert.ok(['cpu', 'vulkan'].includes(pickVariant(probe, assets)))
})

test('assetRe: Linux 用 ubuntu 段解析，无变体段 = cpu（含全部官方 nightly 命名）', () => {
  const cases: Array<[string, string, string]> = [
    // [文件名, 期望 variant, 期望 arch]
    ['llama-b10951-bin-ubuntu-x64.tar.gz', 'cpu', 'x64'],
    ['llama-b10951-bin-ubuntu-arm64.tar.gz', 'cpu', 'arm64'],
    ['llama-b10951-bin-ubuntu-vulkan-x64.tar.gz', 'vulkan', 'x64'],
    ['llama-b10951-bin-ubuntu-vulkan-arm64.tar.gz', 'vulkan', 'arm64'],
    ['llama-b10951-bin-ubuntu-rocm-10.0-x64.tar.gz', 'rocm-10.0', 'x64'],
    ['llama-b10951-bin-ubuntu-openvino-2026.3.1-x64.tar.gz', 'openvino-2026.3.1', 'x64'],
    ['llama-b10951-bin-ubuntu-sycl-fp32-x64.tar.gz', 'sycl-fp32', 'x64'],
    ['llama-b10951-bin-ubuntu-s390x.tar.gz', 'cpu', 's390x']
  ]
  const re = assetRe('linux')
  for (const [name, variant, arch] of cases) {
    const m = name.match(re)
    assert.ok(m, `linux 正则未匹配 ${name}`)
    assert.equal(m![2] ?? 'cpu', variant) // 组 2=变体段（无则 undefined→cpu）
    assert.equal(m![3], arch)
  }
  // 不属于 linux 的 asset 不得误匹配
  assert.equal('llama-b10951-bin-win-cpu-x64.zip'.match(re), null)
  assert.equal('llama-b10951-ui.tar.gz'.match(re), null)
})

test('assetRe: win / macos 命名解析不变', () => {
  const win = assetRe('win')
  assert.equal('llama-b10951-bin-win-cuda-12.4-x64.zip'.match(win)?.[2], 'cuda-12.4')
  assert.equal('llama-b10951-bin-win-cpu-x64.zip'.match(win)?.[2], 'cpu')
  assert.equal('llama-b10951-bin-win-opencl-adreno-arm64.zip'.match(win)?.[2], 'opencl-adreno')
  const mac = assetRe('macos')
  assert.equal('llama-b10951-bin-macos-arm64.tar.gz'.match(mac)?.[2], undefined) // 无变体段
  assert.equal('llama-b10951-bin-macos-arm64.tar.gz'.match(mac)?.[3], 'arm64')
  assert.equal('llama-b10951-bin-macos-x64.tar.gz'.match(mac)?.[3], 'x64')
})

test('CUDART_RE: 真实 cudart 伴生包命名（文件名不带 build 号）', () => {
  const g1 = 'cudart-llama-bin-win-cuda-12.4-x64.zip'.match(CUDART_RE)
  assert.ok(g1)
  assert.equal(g1![1], '12.4')
  assert.equal(g1![2], 'x64')
  const g2 = 'cudart-llama-bin-win-cuda-13.4-arm64.zip'.match(CUDART_RE)
  assert.ok(g2)
  assert.equal(g2![1], '13.4')
  assert.equal(g2![2], 'arm64')
  // 主构建包 / 非 cuda 不误匹配
  assert.equal('llama-b10951-bin-win-cuda-12.4-x64.zip'.match(CUDART_RE), null)
})

test('compareVersions: build 号比较（判断 runtime 是否有更新）', () => {
  assert.ok(compareVersions('b10951', 'b10936') > 0) // 更新
  assert.ok(compareVersions('b10936', 'b10951') < 0) // 更旧
  assert.equal(compareVersions('b10951', 'b10951'), 0) // 相同
  assert.equal(buildNum('b10951'), 10951)
  assert.equal(buildNum('v2.1.0'), 2) // 首个数字
  assert.equal(buildNum(''), 0)
  assert.equal(buildNum(null), 0)
  assert.equal(buildNum(undefined), 0)
})

function mkAsset(variant: string, arch = 'x64'): RuntimeAsset {
  return {
    name: `llama-b10936-bin-win-${variant}-${arch}.zip`,
    version: 'b10936',
    variant,
    arch,
    size: 1,
    url: 'http://example'
  }
}
function mkAssets(variants: string[]): RuntimeAsset[] {
  return variants.map((v) => mkAsset(v))
}
