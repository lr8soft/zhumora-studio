import type { AutoParamsResult, GpuInfo, LaunchParams, ModelMeta } from './types.ts'

/**
 * 启动参数推演：给定模型 GGUF 元数据 + 本机 GPU/RAM，算出能装得下的
 * nGpuLayers 与 ctxSize。
 *
 * 方法参考 oobabooga/text-generation-webui（实证 19517 组 VRAM 测量回归出的公式，
 * 本文 https://oobabooga.github.io/blog/posts/gguf-vram-formula/）：
 * - 每层权重 ≈ 文件大小 / n_layer（按层均摊）
 * - KV cache（fp16）= 2 × ctx × n_kv_heads × head_dim × 2 bytes；GQA 下 n_kv_heads < n_head
 * - 二分找最大可装层数 / 最大上下文；加 ~577MB 安全余量（原文 95% 置信度）
 *
 * 本模块是纯函数，只依赖入参，便于单测。
 */

const MB = 1024 * 1024

/** 权重之外的固定开销：运行缓冲 + ~577MB 安全余量（原文 95% 置信缓冲） */
const GPU_OVERHEAD_MB = 800
/** 每 token 的激活/工作区预留（小模型占比大，取 max(512MB, 4×单层)） */
const ACTIVATION_BASE_MB = 512
/** GPU 保留给系统/桌面 compositor 的最低余量（MB），避免把卡吃满导致桌面掉帧 */
const DESKTOP_RESERVE_MB = 512
/** KV cache 上限（token 数），防止无头狂奔 */
const CTX_CAP = 262144
/** 上下文步长（llama.cpp 的 -c 建议按 128 对齐） */
const CTX_STEP = 128
/** 模型元数据缺失时的兜底假设 */
const DEFAULT_LAYERS = 32
const DEFAULT_KV_HEADS = 32
const DEFAULT_HEAD_DIM = 128
const DEFAULT_TRAIN_CTX = 4096
const MIN_TRAIN_CTX = 2048
/** 系统 RAM 可给 llama 的预算比例（其余留给桌面 + 其他进程） */
const RAM_BUDGET_RATIO = 0.7

export interface AutoTunerInput {
  model: ModelMeta
  modelSize: number
  gpus: GpuInfo[]
  ramTotalMB: number
}

export interface TunerOption {
  /** 用户在 paramDraft 里已显式设置过的值；autoTune 只覆盖"用户没动过"的默认值 */
  userCtx?: number
  userLayers?: number
}

/** 模型单层权重（bytes）：文件大小按 n_layer 均摊 */
function bytesPerLayer(input: AutoTunerInput): number {
  const layers = input.model.blockCount ?? DEFAULT_LAYERS
  return input.modelSize / Math.max(1, layers)
}

/** KV cache 每 token 字节数：2(k+v) × n_kv_heads × head_dim × 2(fp16) */
function kvBytesPerToken(input: AutoTunerInput): number {
  const kv = input.model.nHeadKV ?? input.model.nHead ?? DEFAULT_KV_HEADS
  const headDim = input.model.nEmbed && input.model.nHead
    ? Math.max(16, input.model.nEmbed / input.model.nHead)
    : DEFAULT_HEAD_DIM
  return 2 * kv * headDim * 2
}

/** 训练上下文（-c 0 时的实际值），元数据缺失时给个保守默认 */
function trainCtx(input: AutoTunerInput): number {
  const c = input.model.contextLength
  if (c && c > 0) return Math.floor(c / CTX_STEP) * CTX_STEP
  return DEFAULT_TRAIN_CTX
}

/** 给定可用显存（bytes）与每 token 开销（bytes）能容纳的最大 ctx（token 数，按 CTX_STEP 对齐） */
function ctxForBudget(bytesPerToken: number, budgetBytes: number): number {
  const ctx = Math.floor(budgetBytes / Math.max(1, bytesPerToken))
  return Math.max(0, Math.floor(ctx / CTX_STEP) * CTX_STEP)
}

/**
 * 主推演入口。
 *
 * 返回 patch（要写进 paramDraft 的参数）+ 展示信息。
 * 永远返回合法 LaunchParams（number 类型，符合 schema 约束）。
 */
export function autoTune(input: AutoTunerInput, opts: TunerOption = {}): AutoParamsResult {
  const patch: LaunchParams = {}
  const { model } = input
  const bpl = bytesPerLayer(input)
  const kvPerTok = kvBytesPerToken(input)
  const tc = trainCtx(input)
  const reasons: string[] = []

  // ---------- 单卡场景（多卡走 llama.cpp 的 split，先给"主卡吃满"的策略） ----------
  const gpus = input.gpus.filter((g) => g.memTotalMB > 0)
  // 主卡 = 显存最大的那张
  const main = gpus.length > 0 ? [...gpus].sort((a, b) => b.memTotalMB - a.memTotalMB)[0] : undefined

  const totalLayers = model.blockCount ?? DEFAULT_LAYERS
  // "用户已改过" = 与 schema 默认值不同（ctx 默认 0 = 模型训练值；layers 默认 0 = 全 CPU）。
  // 推演只覆盖用户没动过的默认值，尊重手动调整。
  const userTouchedCtx = typeof opts.userCtx === 'number' && opts.userCtx !== 0
  const userTouchedLayers = typeof opts.userLayers === 'number' && opts.userLayers !== 0

  if (!main) {
    // ---------- 无可用 GPU：全 CPU，上下文按 RAM 预算推演 ----------
    if (!userTouchedLayers) patch.nGpuLayers = 0
    if (!userTouchedCtx) {
      // 全层在 CPU：RAM 要装权重 + 全部层的 KV。每 token 的 KV = 层数 × 单层 KV
      const budget = Math.max(0, input.ramTotalMB * MB * RAM_BUDGET_RATIO - input.modelSize)
      const cpuKvPerTok = totalLayers * kvPerTok
      patch.ctxSize = clampCtx(ctxForBudget(cpuKvPerTok, budget), tc, cpuKvPerTok, budget)
    }
    reasons.unshift('No usable GPU detected — CPU-only (weights mmap into system RAM)')
    if (input.modelSize > input.ramTotalMB * MB * RAM_BUDGET_RATIO) {
      reasons.push('Model file alone exceeds the RAM budget — consider a lower quant')
    }
    return { patch, model, gpus: input.gpus, ramTotalMB: input.ramTotalMB, reason: reasons.slice(0, 3).join(' · ') }
  }

  // ---------- 有 GPU：在"层数 × 上下文"二维空间里找可行解 ----------
  // nvidia-smi 的 memUsed 已含桌面 compositor 等占用；再额外留一点余量
  const freeBytes = Math.max(0, (main.memTotalMB - main.memUsedMB) * MB - DESKTOP_RESERVE_MB * MB)
  // 固定开销（运行缓冲 + 577MB 安全余量）+ 激活预留（小模型占比大，取 max(512MB, 4×单层)）
  const fixed = GPU_OVERHEAD_MB * MB + Math.max(ACTIVATION_BASE_MB * MB, bpl * 4)
  // 部分层上 GPU 时，剩余层的 KV 落在 CPU → 占系统 RAM（权重 mmap 也吃 RAM）。
  // RAM 未知（=0）时不约束，只按显存推演。
  const hasRam = input.ramTotalMB > 0
  const ramBudget = hasRam ? Math.max(0, input.ramTotalMB * MB * RAM_BUDGET_RATIO - input.modelSize) : Number.MAX_SAFE_INTEGER

  // 可行性：GPU 端（L 层权重 + L 层 KV）≤ 显存预算，且 CPU 端（其余层 KV）≤ RAM 预算
  const fits = (L: number, ctx: number): boolean =>
    L * bpl + L * kvPerTok * ctx <= freeBytes - fixed &&
    (totalLayers - L) * kvPerTok * ctx <= ramBudget

  // 目标上下文：不超过训练上下文的 2 倍（再往外质量差），封顶 CTX_CAP
  const targetCtx = Math.min(tc * 2, CTX_CAP)

  // 给定 L 层（GPU）时的最大 ctx：显存侧与 RAM 侧取严，按 CTX_STEP 对齐
  const maxCtxForLayers = (L: number, cap: number): number => {
    const cVram = ctxForBudget(Math.max(1, L * kvPerTok), Math.max(0, freeBytes - fixed - L * bpl))
    const cRam = L < totalLayers ? ctxForBudget(Math.max(1, (totalLayers - L) * kvPerTok), ramBudget) : cap
    return Math.min(cap, cVram, cRam)
  }

  let gpuLayers: number
  let ctx: number
  let allOnGpu = false

  if (userTouchedLayers) {
    // 用户指定了层数：只在该层数下推演 ctx
    gpuLayers = opts.userLayers as number
    const eff = Math.min(gpuLayers === 999 ? totalLayers : gpuLayers, totalLayers)
    if (!userTouchedCtx) ctx = maxCtxForLayers(eff, targetCtx)
    else ctx = opts.userCtx as number
  } else {
    // 优先级：① 全层上卡 + 目标 ctx → ② 全层上卡 + 收缩 ctx（层数优先，GPU 层多推理快）
    //       → ③ 部分层（最大层数，ctx 保底 MIN_TRAIN_CTX）→ ④ 全 CPU
    if (fits(totalLayers, targetCtx)) {
      gpuLayers = 999
      ctx = targetCtx
      allOnGpu = true
    } else if (maxCtxForLayers(totalLayers, targetCtx) >= MIN_TRAIN_CTX) {
      gpuLayers = 999
      ctx = maxCtxForLayers(totalLayers, targetCtx)
      allOnGpu = true
    } else {
      // 部分层：可行性闭式解。
      // 显存侧：L·(bpl + MIN·kv) ≤ free-fixed → L ≤ a
      // RAM 侧：(total-L)·MIN·kv ≤ ramBudget → L ≥ b
      const a = Math.max(0, Math.floor((freeBytes - fixed) / (bpl + MIN_TRAIN_CTX * kvPerTok)))
      const b = hasRam ? Math.max(0, totalLayers - Math.floor(ramBudget / (MIN_TRAIN_CTX * kvPerTok))) : 0
      const L = Math.min(totalLayers, a)
      if (L >= Math.max(1, b)) {
        gpuLayers = L
        ctx = maxCtxForLayers(L, targetCtx)
      } else {
        // 连保底上下文都放不下：全 CPU（提示换量化/换卡），ctx 按 RAM 预算（全部层 KV 在 RAM）
        gpuLayers = 0
        reasons.push(`Model does not fit on ${main.name} (${(main.memTotalMB / 1024).toFixed(1)} GB) — falls back to CPU; try a lower quant or more VRAM`)
        if (!userTouchedCtx) ctx = clampCtx(ctxForBudget(totalLayers * kvPerTok, ramBudget), tc, totalLayers * kvPerTok, ramBudget)
        else ctx = opts.userCtx as number
      }
    }
  }

  if (!userTouchedLayers) patch.nGpuLayers = gpuLayers
  if (!userTouchedCtx && ctx > 0) patch.ctxSize = ctx

  const effectiveLayers = Math.min(gpuLayers === 999 ? totalLayers : gpuLayers, totalLayers)

  // ---------- flashAttention：全层上卡 + 长上下文 → on；部分层 → off（FA 只加速 GPU 层） ----------
  if (allOnGpu && ctx >= 4096) patch.flashAttention = 'on'
  else if (effectiveLayers > 0 && effectiveLayers < totalLayers) patch.flashAttention = 'off'

  // ---------- 推理链说明 ----------
  if (allOnGpu) {
    reasons.unshift(`All ${totalLayers} layers on ${main.name} (${(main.memTotalMB / 1024).toFixed(1)} GB total, ${((main.memTotalMB - main.memUsedMB) / 1024).toFixed(1)} GB free)`)
  } else if (effectiveLayers > 0) {
    reasons.unshift(`${effectiveLayers}/${totalLayers} layers on ${main.name}, rest on CPU`)
  }
  if (ctx > 0) {
    // 全 CPU 时 KV 覆盖全部层；否则覆盖上 GPU 的层
    const kvLayers = gpuLayers === 0 ? totalLayers : effectiveLayers
    reasons.unshift(`Context ${ctx} tokens (KV cache ≈ ${((kvLayers * kvPerTok * ctx) / MB).toFixed(0)} MB fp16)`)
  }
  if (reasons.length === 0) reasons.push('No adjustment needed')

  return {
    patch,
    model,
    gpus: input.gpus,
    ramTotalMB: input.ramTotalMB,
    reason: reasons.slice(0, 3).join(' · ')
  }
}

/**
 * ctx 收敛：不超训练上下文 2 倍（外推质量差）、按 CTX_STEP 对齐。
 * 若可用预算连目标值都塞不下：退让到预算允许的最大值（哪怕很小，也别给个必炸的值）。
 */
function clampCtx(raw: number, trainCtx: number, perTokBytes: number, budgetBytes: number): number {
  let c = Math.min(raw, trainCtx * 2, CTX_CAP)
  c = Math.floor(c / CTX_STEP) * CTX_STEP
  const affordable = Math.floor(budgetBytes / Math.max(1, perTokBytes))
  if (c > affordable) c = Math.max(0, Math.floor(affordable / CTX_STEP) * CTX_STEP)
  return c
}

/** 快速判断"这个模型在本机能跑吗"（用于模型库里的徽标） */
export function canRun(input: AutoTunerInput): { ok: boolean; reason: string } {
  const { model } = input
  const bpl = bytesPerLayer(input)
  const totalLayers = model.blockCount ?? DEFAULT_LAYERS
  // 全层 KV（每 token）：层数 × 单层 KV；2048 token 起步
  const minKv = 2048 * totalLayers * kvBytesPerToken(input)
  const fixed = (GPU_OVERHEAD_MB + ACTIVATION_BASE_MB) * MB + minKv
  const main = input.gpus.filter((g) => g.memTotalMB > 0).sort((a, b) => b.memTotalMB - a.memTotalMB)[0]
  if (main) {
    const free = Math.max(0, (main.memTotalMB - main.memUsedMB) * MB - DESKTOP_RESERVE_MB * MB)
    const weightBudget = Math.max(0, free - fixed)
    const fit = Math.floor(weightBudget / Math.max(1, bpl))
    if (fit >= totalLayers) return { ok: true, reason: `Fits fully on ${main.name}` }
    if (fit >= 1) return { ok: true, reason: `Partial offload (${fit}/${totalLayers} layers) on ${main.name}` }
  }
  // 无 GPU / GPU 塞不下：看系统 RAM 能否全 CPU 跑（装模型 + 2048 KV）
  const ramBytes = input.ramTotalMB * MB * RAM_BUDGET_RATIO
  if (input.modelSize + minKv <= ramBytes) return { ok: true, reason: 'CPU-only (fits in system RAM)' }
  return { ok: false, reason: `Too large for ${main ? main.name : 'this machine'}` }
}

/** 导出供 main 侧做日志/调试 */
export const TUNER_CONSTS = { GPU_OVERHEAD_MB, DESKTOP_RESERVE_MB, RAM_BUDGET_RATIO, CTX_CAP, CTX_STEP, MIN_TRAIN_CTX }
