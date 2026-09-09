// 跨进程共享类型。禁止依赖 Electron / Node API。

export type ParamCategory = 'service' | 'model' | 'performance' | 'sampling'
export type ParamType = 'number' | 'select' | 'boolean' | 'string' | 'textarea'

export interface ParamOption {
  value: string
  label: string
}

export interface ParamSpec {
  key: string
  flag: string
  label: string
  category: ParamCategory
  type: ParamType
  default: number | string | boolean
  options?: ParamOption[]
  min?: number
  max?: number
  step?: number
  advanced?: boolean
  secret?: boolean
  hint?: string
  /** 独占整行（跨全部网格列），用于长路径 / 长参数 */
  fullWidth?: boolean
  /** 输入用等宽字体 */
  mono?: boolean
  /** 不进表单渲染（仍参与 buildArgs 序列化），如 apiKey 由“密钥”页注入 */
  hidden?: boolean
}

/** 启动参数值表：key 与 ParamSpec.key 对应。extraArgs 为透传原始参数。 */
export type LaunchParams = Record<string, number | string | boolean>

// ---------- server ----------

export type ServerStateName = 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'

export interface ServerState {
  state: ServerStateName
  pid?: number
  host?: string
  port?: number
  modelPath?: string
  error?: string
  logTail?: string[]
  startedAt?: number
}

export interface ServerLogEvent {
  stream: 'stdout' | 'stderr'
  line: string
}

// ---------- runtime（llama.cpp 下载） ----------

export type RuntimeStateName =
  | 'checking'
  | 'detected'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'error'

export interface GpuProbeResult {
  arch: 'x64' | 'arm64'
  adapters: string[]
  nvidiaDriver?: string
  error?: string
}

export interface RuntimeAsset {
  name: string
  version: string
  variant: string
  arch: string
  size: number
  sha256?: string
  url: string
}

export interface RuntimeProgress {
  done: number
  total: number
  speed: number
  phase: 'downloading' | 'extracting'
}

export interface RuntimeStatus {
  state: RuntimeStateName
  version?: string
  variant?: string
  binaryPath?: string
  detected?: GpuProbeResult
  recommended?: string
  assets?: RuntimeAsset[]
  progress?: RuntimeProgress
  error?: string
}

// ---------- models ----------

export type ModelKind = 'model' | 'mmproj'

export interface ModelInfo {
  id: string
  name: string
  path: string
  size: number
  kind: ModelKind
  arch?: string
  quant?: string
  addedAt: number
}

// ---------- huggingface 下载 ----------

export interface HfCapabilities {
  vision: boolean
  tool: boolean
  reasoning: boolean
}

export type HfSort = 'best' | 'likes' | 'updated'

export interface HfModel {
  id: string
  downloads: number
  likes: number
  tags: string[]
  pipelineTag?: string
  createdAt?: string
  lastModified?: string
  capabilities: HfCapabilities
  /** 参数量（从仓库名推断，如 "27B" / "30B · A3B 激活"），不确定时缺省 */
  params?: string
  /** 架构（来自仓库 gguf 元数据，仅详情有） */
  arch?: string
  /** 训练上下文长度（仅详情有） */
  contextLength?: number
  license?: string
  gated?: boolean
  /** 全部 gguf 文件总大小（仅详情有） */
  totalSize?: number
}

export interface HfFile {
  path: string
  size: number
}

/** 仓库详情（列表行 + gguf 元数据 + 文件 + README 预览），一次取齐 */
export interface HfModelDetail {
  model: HfModel
  shortDescription?: string
  readme?: string
  files: HfFile[]
}

export interface ModelDownloadProgress {
  id: string // `${repoId}::${file}`
  repoId: string
  file: string
  done: number
  total: number
  speed: number
}

export interface ModelDownloadDone {
  id: string
  repoId: string
  file: string
  /** 落入模型库后的路径 */
  path: string
}

export interface ModelDownloadError {
  id: string
  message: string
}

// ---------- chat ----------

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  usage?: { prompt: number; completion: number }
  tokensPerSec?: number
  /** 产生该回复的模型（文件路径），用量统计按此归组 */
  modelId?: string
  createdAt: number
}

export interface ChatSession {
  id: string
  title: string
  modelId: string
  createdAt: number
  updatedAt: number
}

export interface ChatSendRequest {
  sessionId: string
  /** 完整消息序列（含 system），由 renderer 维护顺序 */
  messages: { role: ChatRole; content: string }[]
  overrides?: {
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
  }
}

export interface ChatTokenEvent {
  sessionId: string
  messageId: string
  delta: string
}

export interface ChatEndEvent {
  sessionId: string
  messageId: string
  finishReason?: string
  usage?: { prompt: number; completion: number }
  tokensPerSec?: number
}

export interface ChatErrorEvent {
  sessionId: string
  messageId?: string
  message: string
}

// ---------- settings ----------

export type AppLang = 'auto' | 'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de'

// ---------- 密钥管理 ----------

export interface ApiKeyInfo {
  id: string
  name: string
  key: string
  createdAt: number
}

// ---------- 用量统计 ----------

export interface UsageSummary {
  requests: number
  prompt: number
  completion: number
  total: number
}

export interface UsageDaily {
  /** YYYY-MM-DD（本地时区） */
  day: string
  requests: number
  prompt: number
  completion: number
}

export interface UsageModel {
  modelId: string
  requests: number
  prompt: number
  completion: number
  total: number
  avgTps?: number
}

export interface Settings {
  schemaVersion: number
  modelsDir: string
  llamaBinary: string
  runtime: {
    version: string
    variant: string
    autoUpdate: boolean
  }
  lastParams: LaunchParams
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  lang: AppLang
}
