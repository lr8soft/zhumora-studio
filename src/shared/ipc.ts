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
  ModelDownloadDone,
  ModelDownloadError,
  ModelDownloadProgress,
  ModelInfo,
  RuntimeAsset,
  RuntimeStatus,
  ServerLogEvent,
  ServerState,
  Settings,
  UsageModel,
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
  runtimeStatus: 'runtime:status',
  runtimeAssets: 'runtime:assets',
  runtimeDownload: 'runtime:download',
  runtimeCancel: 'runtime:cancel',
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
  usageSummary: 'usage:summary',
  usageDaily: 'usage:daily',
  usageByModel: 'usage:by-model',
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
  modelError: 'ev:model-error'
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
}

export interface ApiUsage {
  summary(): Promise<UsageSummary>
  /** days: 统计最近多少天（含今天），默认 14 */
  daily(days?: number): Promise<UsageDaily[]>
  byModel(): Promise<UsageModel[]>
  reset(): Promise<void>
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
  settings: ApiSettings
  system: ApiSystem
  window: ApiWindow
  on<K extends IpcEventName>(event: K, cb: (payload: IpcEventPayloads[K]) => void): () => void
}
