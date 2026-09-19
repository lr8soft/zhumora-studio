import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoTune, canRun } from '../src/shared/autoTuner.ts'
import type { GpuInfo, ModelMeta } from '../src/shared/types.ts'

const MB = 1024 * 1024

/** LaunchParams 的值是 string|number|boolean，断言时收敛成 number */
const num = (v: string | number | boolean | undefined): number => (v === undefined ? -1 : Number(v))

/**
 * 仿 Qwen3-8B：36 层、n_head 32、n_embd 4096（head_dim 128）、GQA n_head_kv 8、训练 ctx 40960
 * 单层 KV（fp16）= 2 × 8 × 128 × 2 = 4096 B/tok
 */
function qwen8(meta: Partial<ModelMeta> = {}): ModelMeta {
  return {
    arch: 'qwen2',
    name: 'Qwen3-8B',
    blockCount: 36,
    nHead: 32,
    nHeadKV: 8,
    nEmbed: 4096,
    contextLength: 40960,
    ...meta
  }
}

/** 24GB 卡，freeGb = 剩余显存（GB） */
function gpu24(freeGb = 23): GpuInfo[] {
  return [
    { index: 0, name: 'NVIDIA GeForce RTX 4090', memTotalMB: 24 * 1024, memUsedMB: (24 - freeGb) * 1024 }
  ]
}

// 8B Q4_K_M ≈ 5GiB 文件；bpl ≈ 142MB/层
const SIZE_8B = 5 * 1024 * MB

test('autoTune: 显存充足 → 全层 999 + ctx = 训练 ctx 的 2 倍（81920）', () => {
  const r = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(23), ramTotalMB: 32 * 1024 })
  assert.equal(r.patch.nGpuLayers, 999)
  assert.equal(r.patch.ctxSize, 81920)
  assert.equal(r.patch.flashAttention, 'on')
})

test('autoTune: 显存装得下全层但装不下目标 ctx → 全层 + 收缩 ctx（层数优先）', () => {
  // 14GB 卡：5GiB 权重 + 36 层 KV @81920 ≈ 16.3GiB 装不下，但权重 + 收缩 ctx 装得下
  const gpus: GpuInfo[] = [{ index: 0, name: 'mid', memTotalMB: 14 * 1024, memUsedMB: 256 }]
  const r = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus, ramTotalMB: 32 * 1024 })
  assert.equal(r.patch.nGpuLayers, 999)
  assert.ok(num(r.patch.ctxSize) >= 2048 && num(r.patch.ctxSize) < 81920, `ctx=${r.patch.ctxSize}`)
})

test('autoTune: 显存装不下全层 → 部分层上卡 + 剩余层 KV 走 RAM', () => {
  // 4GB 卡：5GiB 权重都装不全 → 部分层
  const gpus: GpuInfo[] = [{ index: 0, name: 'small', memTotalMB: 4 * 1024, memUsedMB: 256 }]
  const r = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus, ramTotalMB: 16 * 1024 })
  const L = num(r.patch.nGpuLayers)
  assert.ok(L > 0 && L < 36, `期望部分层，得到 ${L}`)
  assert.ok(num(r.patch.ctxSize) >= 2048)
  assert.equal(r.patch.flashAttention, 'off')
})

test('autoTune: RAM 约束会压低 ctx（部分层时 CPU 侧 KV 吃 RAM）', () => {
  const gpus: GpuInfo[] = [{ index: 0, name: 'small', memTotalMB: 4 * 1024, memUsedMB: 256 }]
  const bigRam = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus, ramTotalMB: 64 * 1024 })
  const smallRam = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus, ramTotalMB: 16 * 1024 })
  assert.ok(
    num(bigRam.patch.ctxSize) >= num(smallRam.patch.ctxSize),
    `RAM 大的 ctx 应更大：${bigRam.patch.ctxSize} vs ${smallRam.patch.ctxSize}`
  )
})

test('autoTune: 显存极小 → 回退全 CPU + RAM 预算 ctx + 提示语', () => {
  const gpus: GpuInfo[] = [{ index: 0, name: 'tiny', memTotalMB: 512, memUsedMB: 448 }]
  const r = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus, ramTotalMB: 32 * 1024 })
  assert.equal(r.patch.nGpuLayers, 0)
  assert.ok(num(r.patch.ctxSize) > 0)
  assert.match(r.reason ?? '', /falls back to CPU|lower quant/i)
})

test('autoTune: 无 GPU → 全 CPU，ctx ≤ 训练 ctx 2 倍', () => {
  const r = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus: [], ramTotalMB: 32 * 1024 })
  assert.equal(r.patch.nGpuLayers, 0)
  assert.ok(num(r.patch.ctxSize) <= 40960 * 2)
  assert.ok(num(r.patch.ctxSize) > 0)
})

test('autoTune: 用户已改过 ctx → 保留，只补层数', () => {
  const r1 = autoTune(
    { model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(23), ramTotalMB: 32 * 1024 },
    { userCtx: 8192, userLayers: 0 }
  )
  assert.equal(r1.patch.ctxSize, undefined, '用户 ctx 应保留')
  assert.equal(r1.patch.nGpuLayers, 999)
})

test('autoTune: 用户已改过层数 → 保留，只补 ctx（且 ctx 按该层数推演）', () => {
  const r2 = autoTune(
    { model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(23), ramTotalMB: 16 * 1024 },
    { userCtx: 0, userLayers: 20 }
  )
  assert.equal(r2.patch.nGpuLayers, undefined, '用户层数应保留')
  assert.ok(num(r2.patch.ctxSize) > 0)
  // 20 层占用更多 → ctx 不应超过全层场景
  const full = autoTune({ model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(23), ramTotalMB: 16 * 1024 })
  assert.ok(num(r2.patch.ctxSize) <= num(full.patch.ctxSize))
})

test('autoTune: GQA（少 KV 头）比 MHA 更省显存 → ctx 不小于 MHA', () => {
  const gpus: GpuInfo[] = [{ index: 0, name: 'mid', memTotalMB: 14 * 1024, memUsedMB: 256 }]
  const mha = autoTune({ model: qwen8({ nHeadKV: 32 }), modelSize: SIZE_8B, gpus, ramTotalMB: 32 * 1024 })
  const gqa = autoTune({ model: qwen8({ nHeadKV: 8 }), modelSize: SIZE_8B, gpus, ramTotalMB: 32 * 1024 })
  assert.ok(num(gqa.patch.ctxSize) >= num(mha.patch.ctxSize))
})

test('autoTune: 元数据缺失 → 兜底假设仍能给出合法值', () => {
  const r = autoTune({ model: {}, modelSize: 3 * 1024 * MB, gpus: gpu24(23), ramTotalMB: 16 * 1024 })
  assert.ok(num(r.patch.nGpuLayers) >= 0)
  assert.ok(r.patch.ctxSize === undefined || num(r.patch.ctxSize) > 0)
})

test('canRun: 各显存/RAM 档位', () => {
  const ok = canRun({ model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(23), ramTotalMB: 32 * 1024 })
  assert.equal(ok.ok, true)

  // 卡太小 + RAM 也不够 → false
  const tiny = canRun({ model: qwen8(), modelSize: SIZE_8B, gpus: gpu24(0.5), ramTotalMB: 4 * 1024 })
  assert.equal(tiny.ok, false)

  const cpuOnly = canRun({ model: qwen8(), modelSize: SIZE_8B, gpus: [], ramTotalMB: 32 * 1024 })
  assert.equal(cpuOnly.ok, true)
})
