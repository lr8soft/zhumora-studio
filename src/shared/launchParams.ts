import type { ParamSpec } from './types.ts'

/**
 * llama-server 启动参数 schema（单一数据源）。
 * ParamForm 按本表渲染表单；buildArgs 按本表生成 CLI 参数。
 *
 * 默认值均按 b10835 源码核实（common/common.h、common/arg.cpp）：
 * - temp 0.8 / top_k 40 / top_p 0.95 / min_p 0.05 / repeat_penalty 1.0(disabled) / seed -1(随机)
 * - n_batch 2048 / n_ubatch 512 / n_ctx 0(模型训练值)
 * - b10835 的 server 没有 --system 启动参数：system prompt 走 /v1/chat/completions
 *   请求的 messages，由聊天页会话设置注入（ChatProxy 负责）。
 * - -np/-c 联动逻辑复杂（auto = 4 slots + kv_unified），不进表单，用 extraArgs 透传。
 */
export const LAUNCH_PARAMS: ParamSpec[] = [
  // ---------- service ----------
  {
    key: 'host',
    flag: '--host',
    label: '监听地址',
    category: 'service',
    type: 'string',
    default: '127.0.0.1'
  },
  {
    key: 'port',
    flag: '--port',
    label: '端口',
    category: 'service',
    type: 'number',
    default: 1234,
    min: 1,
    max: 65535
  },
  {
    key: 'apiKey',
    flag: '--api-key',
    label: 'API Keys',
    category: 'service',
    type: 'string',
    default: '',
    secret: true,
    hint: '逗号分隔多个 key；留空 = 无鉴权（本机直连）'
  },
  {
    key: 'corsOrigins',
    flag: '--cors-origins',
    label: 'CORS Origins',
    category: 'service',
    type: 'string',
    default: '',
    advanced: true,
    hint: '允许跨域来源（供浏览器/外部应用访问），逗号分隔；* = 全部（必须配合 API key）'
  },
  {
    key: 'threadsHttp',
    flag: '--threads-http',
    label: 'HTTP 线程数',
    category: 'service',
    type: 'number',
    default: -1,
    min: -1,
    advanced: true,
    hint: '-1 = 自动'
  },

  // ---------- model ----------
  {
    key: 'modelPath',
    flag: '-m',
    label: '模型文件',
    category: 'model',
    type: 'string',
    default: '',
    hint: '从模型库选择，或手动输入 .gguf 路径'
  },
  {
    key: 'jinja',
    flag: '--jinja',
    label: 'Jinja 模板',
    category: 'model',
    type: 'boolean',
    default: true,
    hint: '使用模型内置 chat template（推荐开启）'
  },
  {
    key: 'ctxSize',
    flag: '-c',
    label: '上下文长度',
    category: 'model',
    type: 'number',
    default: 0,
    min: 0,
    step: 512,
    advanced: true,
    hint: '0 = 使用模型训练的上下文长度；与 -np 联动时注意 KV 池大小'
  },
  {
    key: 'mmproj',
    flag: '--mmproj',
    label: '多模态投影 mmproj',
    category: 'model',
    type: 'string',
    default: '',
    hint: '视觉模型（Qwen-VL / LLaVA 等）的投影文件（.gguf）；非视觉模型留空',
    fullWidth: true,
    mono: true
  },
  {
    key: 'chatTemplate',
    flag: '--chat-template',
    label: 'Chat Template',
    category: 'model',
    type: 'string',
    default: '',
    advanced: true,
    hint: '覆盖内置 jinja 模板，一般留空'
  },

  // ---------- performance ----------
  {
    key: 'nGpuLayers',
    flag: '--n-gpu-layers',
    label: 'GPU 层数',
    category: 'performance',
    type: 'number',
    default: 0,
    min: 0,
    max: 999,
    hint: '0 = 全部 CPU；999 = 全部 GPU（需对应 GPU 构建）'
  },
  {
    key: 'threads',
    flag: '--threads',
    label: 'CPU 线程数',
    category: 'performance',
    type: 'number',
    default: 0,
    min: 0,
    hint: '0 = 自动（物理核心数）'
  },
  {
    key: 'batchSize',
    flag: '--batch-size',
    label: '批大小 (n_batch)',
    category: 'performance',
    type: 'number',
    default: 2048,
    min: 1,
    advanced: true
  },
  {
    key: 'ubatchSize',
    flag: '--ubatch-size',
    label: '微批大小 (n_ubatch)',
    category: 'performance',
    type: 'number',
    default: 512,
    min: 1,
    advanced: true
  },
  {
    key: 'splitMode',
    flag: '--split-mode',
    label: 'GPU 拆分方式 (split-mode)',
    category: 'performance',
    type: 'select',
    default: '',
    options: [
      { value: '', label: '自动' },
      { value: 'none', label: '不拆分' },
      { value: 'layer', label: '按层 (layer)' },
      { value: 'row', label: '按行 (row)' },
      { value: 'tensor', label: '按张量 (tensor)' }
    ],
    hint: '多 GPU 时各卡如何切分权重；单卡可忽略'
  },
  {
    key: 'tensorSplit',
    flag: '--tensor-split',
    label: '张量切分权重 (tensor-split)',
    category: 'performance',
    type: 'string',
    default: '',
    hint: '逗号分隔，每 GPU 权重占比，如 4,2,1 或 0.7,0.3；总和无需为 1'
  },
  {
    key: 'mainGpu',
    flag: '--main-gpu',
    label: '主 GPU (main-gpu)',
    category: 'performance',
    type: 'number',
    default: 0,
    min: 0,
    hint: '主 GPU 索引；split 模式下该卡多承担一些计算'
  },
  {
    key: 'flashAttention',
    flag: '--flash-attn',
    label: 'Flash Attention',
    category: 'performance',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: '自动' },
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' }
    ],
    advanced: true
  },
  {
    key: 'cacheK',
    flag: '--cache-type-k',
    label: 'K Cache 类型',
    category: 'performance',
    type: 'select',
    default: '',
    options: [
      { value: '', label: '自动 (f16)' },
      { value: 'f16', label: 'f16' },
      { value: 'q8_0', label: 'q8_0' },
      { value: 'q4_0', label: 'q4_0' }
    ],
    advanced: true
  },
  {
    key: 'cacheV',
    flag: '--cache-type-v',
    label: 'V Cache 类型',
    category: 'performance',
    type: 'select',
    default: '',
    options: [
      { value: '', label: '自动 (f16)' },
      { value: 'f16', label: 'f16' },
      { value: 'q8_0', label: 'q8_0' }
    ],
    advanced: true
  },
  {
    key: 'mlock',
    flag: '--mlock',
    label: '锁定内存 (mlock)',
    category: 'performance',
    type: 'boolean',
    default: false,
    advanced: true
  },
  {
    key: 'noMmap',
    flag: '--no-mmap',
    label: '禁用 mmap',
    category: 'performance',
    type: 'boolean',
    default: false,
    advanced: true
  },
  {
    key: 'numa',
    flag: '--numa',
    label: 'NUMA',
    category: 'performance',
    type: 'select',
    default: '',
    options: [
      { value: '', label: '自动' },
      { value: 'disable', label: '禁用' },
      { value: 'numa', label: '隔离' },
      { value: 'dual', label: '双路' },
      { value: 'interleave', label: '交错' }
    ],
    advanced: true
  },

  // ---------- sampling（server 级默认值，请求级可在聊天高级项覆盖） ----------
  {
    key: 'temp',
    flag: '--temp',
    label: 'Temperature',
    category: 'sampling',
    type: 'number',
    default: 0.8,
    min: 0,
    max: 2,
    step: 0.1
  },
  {
    key: 'topK',
    flag: '--top-k',
    label: 'Top-k',
    category: 'sampling',
    type: 'number',
    default: 40,
    min: -1,
    advanced: true,
    hint: '-1 = 使用词表大小'
  },
  {
    key: 'topP',
    flag: '--top-p',
    label: 'Top-p',
    category: 'sampling',
    type: 'number',
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
    hint: '1.0 = 禁用'
  },
  {
    key: 'minP',
    flag: '--min-p',
    label: 'Min-p',
    category: 'sampling',
    type: 'number',
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
    hint: '0.0 = 禁用'
  },
  {
    key: 'repeatPenalty',
    flag: '--repeat-penalty',
    label: '重复惩罚',
    category: 'sampling',
    type: 'number',
    default: 1.0,
    min: 0,
    max: 2,
    step: 0.05,
    advanced: true,
    hint: '1.0 = 禁用'
  },
  {
    key: 'seed',
    flag: '--seed',
    label: '随机种子',
    category: 'sampling',
    type: 'number',
    default: -1,
    advanced: true,
    hint: '-1 = 每次随机'
  },
  {
    key: 'ignoreEos',
    flag: '--ignore-eos',
    label: '忽略 EOS',
    category: 'sampling',
    type: 'boolean',
    default: false,
    advanced: true
  }
]

export const PARAM_CATEGORIES: { id: string; label: string; order: ParamSpec['category'][] }[] = [
  { id: 'service', label: '服务', order: ['service'] },
  { id: 'model', label: '模型', order: ['model'] },
  { id: 'performance', label: '性能', order: ['performance'] },
  { id: 'sampling', label: '采样', order: ['sampling'] }
]

/** schema 中所有 key（含 extraArgs） */
export const EXTRA_ARGS_KEY = 'extraArgs'

export function allParamKeys(): string[] {
  return [...LAUNCH_PARAMS.map((p) => p.key), EXTRA_ARGS_KEY]
}
