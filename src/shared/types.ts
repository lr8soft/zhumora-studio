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

export interface HfModel {
  id: string
  downloads: number
  likes: number
  tags: string[]
}

export interface HfFile {
  path: string
  size: number
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
}
