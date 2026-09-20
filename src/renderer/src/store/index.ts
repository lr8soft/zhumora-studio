import { create } from 'zustand'
import type {
  ApiKeyInfo,
  ChatMessage,
  ChatSession,
  GlobalDownloadItem,
  LaunchParams,
  ModelInfo,
  ModelDownloadProgress,
  RuntimeStatus,
  ServerState,
  Settings
} from '@shared/types'
import { IpcEvent } from '@shared/ipc'
import { defaultParams } from '@shared/buildArgs'

// ---------- server / runtime ----------
interface ServerSlice {
  serverState: ServerState
  serverLogs: string[]
  runtime: RuntimeStatus
  setServerState: (s: ServerState) => void
  appendServerLog: (line: string) => void
  setRuntime: (r: RuntimeStatus) => void
}

// ---------- models ----------
interface ModelsSlice {
  models: ModelInfo[]
  setModels: (m: ModelInfo[]) => void
  downloads: Record<string, ModelDownloadState>
  setDownload: (p: ModelDownloadProgress) => void
  failDownload: (id: string, message: string, cancelled?: boolean) => void
  clearDownload: (id: string) => void
}

interface ModelDownload {
  id: string
  repoId: string
  file: string
  done: number
  total: number
  speed: number
}

interface ModelDownloadState extends ModelDownload {
  status: 'downloading' | 'error' | 'cancelled'
  message?: string
  cancelled?: boolean
}

// ---------- 全局下载队列（titlebar 铃铛面板） ----------
interface DownloadsSlice {
  /** id → 条目（进行中 + 最近完成的） */
  globalDownloads: Record<string, GlobalDownloadItem>
  setGlobalDownload: (item: GlobalDownloadItem) => void
  clearFinishedDownloads: () => Promise<void>
}

// ---------- chat ----------
interface ChatSlice {
  sessions: ChatSession[]
  activeSessionId: string | null
  messages: Record<string, ChatMessage[]>
  streaming: Record<string, { messageId: string; content: string }> // sessionId → 进行中
  setSessions: (s: ChatSession[]) => void
  setActiveSession: (id: string | null) => void
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void
  startStreaming: (sessionId: string, messageId: string) => void
  appendToken: (sessionId: string, messageId: string, delta: string) => void
  endStreaming: (sessionId: string, messageId: string) => void
}

// ---------- keys ----------
interface KeysSlice {
  keys: ApiKeyInfo[]
  setKeys: (k: ApiKeyInfo[]) => void
  loadKeys: () => Promise<void>
}

// ---------- settings ----------
interface SettingsSlice {
  settings: Settings | null
  setSettings: (s: Settings) => void
  paramDraft: LaunchParams
  setParamDraft: (p: LaunchParams) => void
  paramDirty: boolean
  setParamDirty: (d: boolean) => void
  /** 启动动作进行中的标记（launchModel 内部防重入） */
  launching: boolean
  /** 选模型 → 自动调参（尊重用户已改的值）→ 启动，一个动作 */
  launchModel: (path: string) => Promise<void>
}

interface AppStore extends ServerSlice, ModelsSlice, DownloadsSlice, ChatSlice, KeysSlice, SettingsSlice {
  init: () => Promise<void>
  loadModels: () => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  // server
  serverState: { state: 'stopped' },
  serverLogs: [],
  runtime: { state: 'checking' },
  setServerState: (serverState) => set({ serverState }),
  appendServerLog: (line) =>
    set((s) => {
      const logs = [...s.serverLogs, line]
      if (logs.length > 1000) logs.splice(0, logs.length - 1000)
      return { serverLogs: logs }
    }),
  setRuntime: (runtime) => set({ runtime }),

  // models
  models: [],
  setModels: (models) => set({ models }),
  downloads: {},
  setDownload: (p) =>
    set((s) => ({ downloads: { ...s.downloads, [p.id]: { ...p, status: 'downloading' } } })),
  failDownload: (id, message, cancelled) =>
    set((s) => {
      const cur = s.downloads[id]
      const prev: ModelDownload = cur
        ? { id: cur.id, repoId: cur.repoId, file: cur.file, done: cur.done, total: cur.total, speed: 0 }
        : { id, repoId: '', file: id, done: 0, total: 0, speed: 0 }
      const status: ModelDownloadState['status'] = cancelled ? 'cancelled' : 'error'
      return { downloads: { ...s.downloads, [id]: { ...prev, status, message, cancelled } } }
    }),
  clearDownload: (id) =>
    set((s) => {
      const downloads = { ...s.downloads }
      delete downloads[id]
      return { downloads }
    }),

  // 全局下载
  globalDownloads: {},
  setGlobalDownload: (item) =>
    set((s) => ({ globalDownloads: { ...s.globalDownloads, [item.id]: item } })),
  clearFinishedDownloads: async () => {
    await window.zhumora.downloads.clearFinished()
    set((s) => {
      const g: Record<string, GlobalDownloadItem> = {}
      for (const it of Object.values(s.globalDownloads)) {
        if (it.status === 'downloading') g[it.id] = it
      }
      return { globalDownloads: g }
    })
  },

  // chat
  sessions: [],
  activeSessionId: null,
  messages: {},
  streaming: {},
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  setMessages: (sessionId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [sessionId]: msgs } })),
  startStreaming: (sessionId, messageId) =>
    set((s) => ({ streaming: { ...s.streaming, [sessionId]: { messageId, content: '' } } })),
  appendToken: (sessionId, messageId, delta) =>
    set((s) => {
      const cur = s.streaming[sessionId]
      if (!cur || cur.messageId !== messageId) return s
      // 流式内容只存 streaming，不写入 messages（渲染层单独展示，避免重复气泡）
      return { streaming: { ...s.streaming, [sessionId]: { ...cur, content: cur.content + delta } } }
    }),
  endStreaming: (sessionId, messageId) =>
    set((s) => {
      const streaming = { ...s.streaming }
      delete streaming[sessionId]
      // 真实消息由 main 持久化后重拉校准，这里只清 streaming 状态
      return { streaming }
    }),

  // keys
  keys: [],
  setKeys: (keys) => set({ keys }),
  loadKeys: async () => set({ keys: await window.zhumora.keys.list() }),

  // settings
  settings: null,
  setSettings: (settings) => set({ settings }),
  paramDraft: defaultParams(),
  setParamDraft: (paramDraft) => set({ paramDraft }),
  paramDirty: false,
  setParamDirty: (paramDirty) => set({ paramDirty }),
  launching: false,
  launchModel: async (path: string) => {
    const st = get()
    if (st.launching) return
    set({ launching: true })
    try {
      // 1. 指定当前模型
      set({ paramDraft: { ...st.paramDraft, modelPath: path } })
      // 2. 默认自动调参（autoTuner 只覆盖用户没改过的默认值；用户手动拉过的不动）
      let draft: LaunchParams = { ...get().paramDraft }
      try {
        const res = await window.zhumora.server.suggestParams(path, draft)
        draft = { ...draft, ...res.patch }
      } catch {
        // 推演失败不阻塞启动（用现有参数）
      }
      set({ paramDraft: draft, paramDirty: true })
      // 3. 启动（运行中先停旧实例：ServerManager 拒绝重复 start，
      //    保证"换模型 = 一键切换"而不报错）
      const cur = get().serverState.state
      if (cur === 'ready' || cur === 'stopping' || cur === 'error') {
        await window.zhumora.server.stop()
      }
      await window.zhumora.server.start(draft)
      set({ paramDirty: false })
      // main 启动成功时已把 lastParams 落盘：重拉 settings，
      // 否则"参数已修改需重启"判定（dock 的 stale）会误报
      const next = await window.zhumora.settings.get()
      set({ settings: next })
    } finally {
      set({ launching: false })
    }
  },

  // actions
  init: async () => {
    const [settings, serverState, runtime, models, sessions, keys, globalDownloads] = await Promise.all([
      window.zhumora.settings.get(),
      window.zhumora.server.state(),
      window.zhumora.runtime.status(),
      window.zhumora.models.list(),
      window.zhumora.chat.sessions(),
      window.zhumora.keys.list(),
      window.zhumora.downloads.list()
    ])
    const gmap: Record<string, GlobalDownloadItem> = {}
    for (const item of globalDownloads) gmap[item.id] = item
    set({
      settings,
      serverState,
      runtime,
      models,
      sessions,
      keys,
      globalDownloads: gmap,
      paramDraft: { ...defaultParams(), ...(settings.lastParams as LaunchParams) }
    })
  },
  loadModels: async () => {
    const models = await window.zhumora.models.list()
    set({ models })
  }
}))

/** 订阅全部 main → renderer 事件，归并进 store。返回取消函数 */
export function subscribeMainEvents(): () => void {
  const offs = [
    window.zhumora.on(IpcEvent.serverState, (s) => useAppStore.getState().setServerState(s)),
    window.zhumora.on(IpcEvent.serverLog, (l) => useAppStore.getState().appendServerLog(l.line)),
    window.zhumora.on(IpcEvent.runtime, (r) => useAppStore.getState().setRuntime(r)),
    window.zhumora.on(IpcEvent.chatToken, (e) => {
      const st = useAppStore.getState()
      const active = st.streaming[e.sessionId]
      if (!active || active.messageId !== e.messageId) st.startStreaming(e.sessionId, e.messageId)
      st.appendToken(e.sessionId, e.messageId, e.delta)
    }),
    window.zhumora.on(IpcEvent.chatEnd, async (e) => {
      const st = useAppStore.getState()
      st.endStreaming(e.sessionId, e.messageId)
      // 与 DB 校准：重拉该会话消息
      const msgs = await window.zhumora.chat.messages(e.sessionId)
      useAppStore.getState().setMessages(e.sessionId, msgs)
      const sessions = await window.zhumora.chat.sessions()
      useAppStore.getState().setSessions(sessions)
    }),
    window.zhumora.on(IpcEvent.chatError, (e) => {
      const st = useAppStore.getState()
      st.endStreaming(e.sessionId, e.messageId ?? '')
      // 错误也作为一条 assistant 消息展示（不落库）；
      // 先重拉 DB（中止/出错时 main 可能已落盘部分内容），再追加错误气泡
      void window.zhumora.chat.messages(e.sessionId).then((msgs) => {
        const cur = useAppStore.getState()
        const list = [
          ...msgs,
          {
            id: `err-${Date.now()}`,
            role: 'assistant' as const,
            content: `⚠ ${e.message}`,
            createdAt: Date.now()
          }
        ]
        useAppStore.setState({ messages: { ...cur.messages, [e.sessionId]: list } })
      })
    }),
    window.zhumora.on(IpcEvent.modelProgress, (p) => useAppStore.getState().setDownload(p)),
    window.zhumora.on(IpcEvent.modelDone, async (d) => {
      useAppStore.getState().clearDownload(d.id)
      await useAppStore.getState().loadModels()
    }),
    window.zhumora.on(IpcEvent.modelError, (e) => useAppStore.getState().failDownload(e.id, e.message, e.cancelled)),
    window.zhumora.on(IpcEvent.downloadItem, (item) => useAppStore.getState().setGlobalDownload(item))
  ]
  return () => offs.forEach((off) => off())
}
