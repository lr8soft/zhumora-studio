import type {
  ApiKeyInfo,
  UsageDaily,
  ChatErrorEvent,
  ChatEndEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSession,
  ChatTokenEvent,
  HfModel,
  HfModelDetail,
  HfSort,
  LaunchParams,
  AutoParamsResult,
  GlobalDownloadItem,
  ModelDownloadDone,
  ModelDownloadError,
  ModelDownloadProgress,
  ModelInfo,
  RuntimeAsset,
  RuntimeStatus,
  ServerLogEvent,
  ServerState,
  ServerStatus,
  Settings,
  UsageByKey,
  UsageModel,
  UsageRequest,
  UsageSummary
} from './types.ts'

// ---------- invoke 通道 ----------
export const Ipc = {
  modelsList: 'models:list',
  modelsImport: 'models:import',
  modelsRemove: 'models:remove',
  modelsSearch: 'models:search',
  modelsDetail: 'models:detail',
  modelsAvatar: 'models:avatar',
  modelsDownload: 'models:download',
  modelsCancelDownload: 'models:cancel-download',
  serverState: 'server:state',
  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverLogs: 'server:logs',
  serverStatus: 'server:status',
  runtimeStatus: 'runtime:status',
  runtimeAssets: 'runtime:assets',
  runtimeDownload: 'runtime:download',
  runtimeCancel: 'runtime:cancel',
  downloadsList: 'downloads:list',
  downloadsCancel: 'downloads:cancel',
  downloadsClearFinished: 'downloads:clear-finished',
  serverSuggestParams: 'server:suggest-params',
  chatSend: 'chat:send',
  chatAbort: 'chat:abort',
  chatSessions: 'chat:sessions',
  chatCreateSession: 'chat:create-session',
  chatDeleteSession: 'chat:delete-session',
  chatMessages: 'chat:messages',
  chatSaveMessage: 'chat:save-message',
  keysList: 'keys:list',
  keysAdd: 'keys:add',
  keysRemove: 'keys:remove',
  keysGenerate: 'keys:generate',
  usageSummary: 'usage:summary',
  usageDaily: 'usage:daily',
  usageByModel: 'usage:by-model',
  usageByKey: 'usage:by-key',
  usageRequests: 'usage:requests',
  usageReset: 'usage:reset',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  systemPickModel: 'system:pick-model',
  systemPickDirectory: 'system:pick-directory',
  systemPickBinary: 'system:pick-binary',
  systemOpenPath: 'system:open-path',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close'
} as const

export type IpcChannel = (typeof Ipc)[keyof typeof Ipc]

// ---------- 事件通道（main → renderer） ----------
export const IpcEvent = {
  serverState: 'ev:server-state',
  serverLog: 'ev:server-log',
  runtime: 'ev:runtime',
  chatToken: 'ev:chat-token',
  chatEnd: 'ev:chat-end',
  chatError: 'ev:chat-error',
  modelProgress: 'ev:model-progress',
  modelDone: 'ev:model-done',
  modelError: 'ev:model-error',
  downloadItem: 'ev:download-item'
} as const

export type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]

/** 事件名 → 载荷 的映射（preload / renderer 共用） */
export interface IpcEventPayloads {
  [IpcEvent.serverState]: ServerState
  [IpcEvent.serverLog]: ServerLogEvent
  [IpcEvent.runtime]: RuntimeStatus
  [IpcEvent.chatToken]: ChatTokenEvent
  [IpcEvent.chatEnd]: ChatEndEvent
  [IpcEvent.chatError]: ChatErrorEvent
  [IpcEvent.modelProgress]: ModelDownloadProgress
  [IpcEvent.modelDone]: ModelDownloadDone
  [IpcEvent.modelError]: ModelDownloadError
  [IpcEvent.downloadItem]: GlobalDownloadItem
}

// ---------- invoke 请求/响应契约 ----------
export interface ApiModels {
  list(): Promise<ModelInfo[]>
  import(): Promise<ModelInfo[]>
  remove(id: string): Promise<void>
  search(query: string, sort?: HfSort): Promise<HfModel[]>
  detail(repoId: string): Promise<HfModelDetail>
  ownerAvatar(owner: string): Promise<string | null>
  download(repoId: string, file: string): Promise<void>
  cancelDownload(id: string): Promise<void>
}

export interface ApiServer {
  state(): Promise<ServerState>
  start(params: LaunchParams): Promise<void>
  stop(): Promise<void>
  logs(): Promise<string[]>
  /** 运行状态快照（server 进程 + 硬件：CPU / 内存 / GPU） */
  status(): Promise<ServerStatus>
  /**
   * 按本机 VRAM/RAM + 模型 GGUF 元数据推演推荐启动参数（nGpuLayers / ctxSize 等）。
   * currentParams = 当前参数草稿：用户已改过的 ctx/层数会被保留，只补没动过的默认值。
   */
  suggestParams(modelPath: string, currentParams: LaunchParams): Promise<AutoParamsResult>
}

export interface ApiRuntime {
  status(): Promise<RuntimeStatus>
  assets(): Promise<RuntimeAsset[]>
  download(variant: string): Promise<void>
  cancel(): Promise<void>
}

export interface ApiChat {
  send(req: ChatSendRequest): Promise<void>
  abort(): Promise<void>
  sessions(): Promise<ChatSession[]>
  createSession(modelId: string): Promise<ChatSession>
  deleteSession(id: string): Promise<void>
  messages(sessionId: string): Promise<ChatMessage[]>
  saveMessage(sessionId: string, message: ChatMessage): Promise<void>
}

export interface ApiKeys {
  list(): Promise<ApiKeyInfo[]>
  add(name: string, key: string): Promise<ApiKeyInfo[]>
  remove(id: string): Promise<ApiKeyInfo[]>
  /** 生成随机 key（不落库），供“生成”按钮回填 */
  generate(): Promise<string>
}

export interface ApiUsage {
  /** key: undefined = 全部；'' = 本地/无 key；其他 = 指定 api key */
  summary(key?: string): Promise<UsageSummary>
  /** days: 统计最近多少天（含今天），默认 14 */
  daily(days?: number, key?: string): Promise<UsageDaily[]>
  byModel(key?: string): Promise<UsageModel[]>
  byKey(): Promise<UsageByKey[]>
  /** 调用记录：ip + key + 时间，limit 默认 200 */
  requests(limit?: number): Promise<UsageRequest[]>
  reset(): Promise<void>
}

export interface ApiDownloads {
  list(): Promise<GlobalDownloadItem[]>
  cancel(id: string): Promise<void>
  clearFinished(): Promise<void>
}

export interface ApiSettings {
  get(): Promise<Settings>
  save(patch: Partial<Settings>): Promise<Settings>
}

export interface ApiSystem {
  pickModel(): Promise<string | null>
  pickDirectory(): Promise<string | null>
  pickBinary(): Promise<string | null>
  openPath(p: string): Promise<void>
}

export interface ApiWindow {
  minimize(): Promise<void>
  maximize(): Promise<void>
  close(): Promise<void>
}

export interface ZhumoraApi {
  models: ApiModels
  server: ApiServer
  runtime: ApiRuntime
  chat: ApiChat
  keys: ApiKeys
  usage: ApiUsage
  downloads: ApiDownloads
  settings: ApiSettings
  system: ApiSystem
  window: ApiWindow
  on<K extends IpcEventName>(event: K, cb: (payload: IpcEventPayloads[K]) => void): () => void
}
