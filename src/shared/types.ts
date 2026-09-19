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
  /** 二进制解析结果（runtime 页的 manifest 信息），运行状态页展示 */
  runtime?: { version?: string; variant?: string }
}

/** 运行状态快照：server 进程 + 本机硬件（CPU / 内存 / GPU 实时占用） */
export interface ServerStatus {
  state: ServerState
  process: {
    pid?: number
    /** 进程 CPU 占用（% 单核基准，多核可超 100） */
    cpu?: number
    /** 工作集（MB） */
    memoryMB?: number
    /** 运行时长（秒） */
    uptimeSec?: number
  }
  cpu: {
    /** 总 CPU 占用 % */
    load?: number
    cores: number
    /** 物理内存总量 MB */
    totalMB: number
    /** 已用物理内存 MB */
    usedMB: number
  }
  /** GPU 实时状态（多厂商；不可用时为空） */
  gpus: {
    index: number
    name: string
    driver: string
    memUsedMB: number
    memTotalMB: number
    utilPct: number
    tempC: number
    powerW: number
  }[]
  error?: string
}

export interface ServerLogEvent {
  stream: 'stdout' | 'stderr'
  line: string
}

// ---------- 全局下载队列（titlebar 铃铛面板） ----------

export type DownloadKind = 'runtime' | 'model'
export type DownloadStatus = 'downloading' | 'done' | 'failed'

/** 全局下载队列中的单项：llama.cpp 运行时与模型文件统一口径 */
export interface GlobalDownloadItem {
  /** 唯一 id：model = `repoId::file`；runtime = `runtime:<version>-<variant>` */
  id: string
  kind: DownloadKind
  name: string
  detail?: string
  done: number
  total: number
  speed: number
  status: DownloadStatus
  message?: string
}

// ---------- 启动参数自动推演（autoTuner） ----------

/** 实时 GPU 信息（与 ServerStatus.gpus 对齐的子集） */
export interface GpuInfo {
  index: number
  name: string
  memUsedMB: number
  memTotalMB: number
}

/** GGUF 模型元数据（GGUF 头解析得到，用于 VRAM/RAM 推演） */
export interface ModelMeta {
  arch?: string
  name?: string
  /** block_count（transformer 层数） */
  blockCount?: number
  /** n_head（注意力头数） */
  nHead?: number
  /** n_head_kv（KV 头数；GQA/MQA 小于 n_head，缺省按 n_head） */
  nHeadKV?: number
  /** n_embd（嵌入维度） */
  nEmbed?: number
  /** 训练上下文长度 */
  contextLength?: number
}

export interface AutoParamsResult {
  /** 应写进 paramDraft 的参数补丁（只含推荐值；用户可再改） */
  patch: LaunchParams
  model?: ModelMeta
  gpus: GpuInfo[]
  ramTotalMB: number
  /** 没有 GPU / 装不下等约束说明（UI 展示用） */
  reason?: string
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
  /** 构建下载用平台标识：win / linux / macos */
  platform: 'win' | 'linux' | 'macos'
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
  /** CUDA 变体的运行时 dll 伴生包（cudart/cublas），需与主包解到同一目录 */
  companion?: { name: string; url: string; size: number; sha256?: string }
}

export interface RuntimeProgress {
  done: number
  total: number
  speed: number
  phase: 'downloading' | 'extracting'
}

/** 本机已安装的 llama.cpp 运行时（多版本共存，供 UI 判断能否升级） */
export interface InstalledRuntime {
  version: string
  variant: string
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
  /** 非阻塞提示（如：更新 build 的资产还在上传，当前展示的是稍旧 build） */
  info?: string
  /** 比当前 asset 列表更新、但资产还在上传中的 build 号 */
  skippedNewer?: string[]
  /** 本机全部已安装 runtime（磁盘 manifest 为准）；含当前激活的 version/variant */
  installed?: InstalledRuntime[]
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
  /** GGUF 头解析的模型元数据（推演启动参数用；老库记录可能缺省） */
  meta?: ModelMeta
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
  /** 用户主动取消（.part 已保留，可断点续传）；false/缺省 = 真实错误 */
  cancelled?: boolean
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

/** 按 API key 维度的聚合（key 为空 = 本地应用/未鉴权调用） */
export interface UsageByKey {
  key: string
  name: string
  requests: number
  prompt: number
  completion: number
  total: number
}

/** 调用记录：哪个 ip + 哪个 api key 在什么时候调用的 */
export interface UsageRequest {
  id: number
  ip: string
  key: string
  name: string
  endpoint: string
  status: number
  createdAt: number
  prompt?: number
  completion?: number
  /** 请求耗时 ms（用于计算速度） */
  durationMs?: number
}

export interface Settings {
  schemaVersion: number
  modelsDir: string
  llamaBinary: string
  runtime: {
    version: string
    variant: string
    autoUpdate: boolean
    /** 首次启动（未安装 runtime）时自动下载推荐构建，默认开 */
    autoDownload: boolean
  }
  lastParams: LaunchParams
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  lang: AppLang
  /** 关闭主窗口时隐藏到托盘，或直接退出整个应用。 */
  closeBehavior: 'tray' | 'quit'
}
