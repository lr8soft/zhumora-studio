import { create } from 'zustand'
import type {
  ChatMessage,
  ChatSession,
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
  downloads: Record<string, ModelDownload & { status: 'downloading' | 'error' }>
  setDownload: (p: ModelDownloadProgress) => void
  failDownload: (id: string, message: string) => void
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

// ---------- settings ----------
interface SettingsSlice {
  settings: Settings | null
  setSettings: (s: Settings) => void
  paramDraft: LaunchParams
  setParamDraft: (p: LaunchParams) => void
  paramDirty: boolean
  setParamDirty: (d: boolean) => void
}

interface AppStore extends ServerSlice, ModelsSlice, ChatSlice, SettingsSlice {
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
  failDownload: (id, message) =>
    set((s) => {
      const cur = s.downloads[id]
      const prev: ModelDownload = cur
        ? { id: cur.id, repoId: cur.repoId, file: cur.file, done: cur.done, total: cur.total, speed: 0 }
        : { id, repoId: '', file: id, done: 0, total: 0, speed: 0 }
      return { downloads: { ...s.downloads, [id]: { ...prev, status: 'error', message } } }
    }),
  clearDownload: (id) =>
    set((s) => {
      const downloads = { ...s.downloads }
      delete downloads[id]
      return { downloads }
    }),

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
      const messages = { ...s.messages }
      const list = messages[sessionId] ?? []
      // 流式消息以临时 ID 挂最后，token 追加
      const last = list[list.length - 1]
      if (last && last.id === `pending-${messageId}`) {
        list[list.length - 1] = { ...last, content: last.content + delta }
      } else {
        list.push({
          id: `pending-${messageId}`,
          role: 'assistant',
          content: delta,
          createdAt: Date.now()
        })
      }
      messages[sessionId] = list
      return { messages, streaming: { ...s.streaming, [sessionId]: { ...cur, content: cur.content + delta } } }
    }),
  endStreaming: (sessionId, messageId) =>
    set((s) => {
      const streaming = { ...s.streaming }
      delete streaming[sessionId]
      const messages = { ...s.messages }
      const list = messages[sessionId]
      if (list) {
        // 用最终内容替换 pending 占位（真实消息由 main 持久化后重拉校准）
        const pending = list.findIndex((m) => m.id === `pending-${messageId}`)
        if (pending >= 0) {
          list.splice(pending, 1)
        }
        messages[sessionId] = list
      }
      return { streaming, messages }
    }),

  // settings
  settings: null,
  setSettings: (settings) => set({ settings }),
  paramDraft: defaultParams(),
  setParamDraft: (paramDraft) => set({ paramDraft }),
  paramDirty: false,
  setParamDirty: (paramDirty) => set({ paramDirty }),

  // actions
  init: async () => {
    const [settings, serverState, runtime, models, sessions] = await Promise.all([
      window.zhumora.settings.get(),
      window.zhumora.server.state(),
      window.zhumora.runtime.status(),
      window.zhumora.models.list(),
      window.zhumora.chat.sessions()
    ])
    set({
      settings,
      serverState,
      runtime,
      models,
      sessions,
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
      // 错误也作为一条 assistant 消息展示（不落库）
      const messages = { ...st.messages }
      const list = messages[e.sessionId] ?? []
      list.push({
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠ ${e.message}`,
        createdAt: Date.now()
      })
      messages[e.sessionId] = list
      useAppStore.setState({ messages })
    }),
    window.zhumora.on(IpcEvent.modelProgress, (p) => useAppStore.getState().setDownload(p)),
    window.zhumora.on(IpcEvent.modelDone, async (d) => {
      useAppStore.getState().clearDownload(d.id)
      await useAppStore.getState().loadModels()
    }),
    window.zhumora.on(IpcEvent.modelError, (e) => useAppStore.getState().failDownload(e.id, e.message))
  ]
  return () => offs.forEach((off) => off())
}
