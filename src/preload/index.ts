import { contextBridge, ipcRenderer } from 'electron'
import {
  Ipc,
  IpcEvent,
  type IpcEventName,
  type IpcEventPayloads,
  type ZhumoraApi
} from '../shared/ipc.ts'

function on<K extends IpcEventName>(
  event: K,
  cb: (payload: IpcEventPayloads[K]) => void
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: IpcEventPayloads[K]): void => {
    cb(payload)
  }
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

const api: ZhumoraApi = {
  models: {
    list: () => ipcRenderer.invoke(Ipc.modelsList),
    import: () => ipcRenderer.invoke(Ipc.modelsImport),
    remove: (id: string) => ipcRenderer.invoke(Ipc.modelsRemove, id),
    search: (query: string) => ipcRenderer.invoke(Ipc.modelsSearch, query),
    repoFiles: (repoId: string) => ipcRenderer.invoke(Ipc.modelsRepoFiles, repoId),
    download: (repoId: string, file: string) => ipcRenderer.invoke(Ipc.modelsDownload, repoId, file),
    cancelDownload: (id: string) => ipcRenderer.invoke(Ipc.modelsCancelDownload, id)
  },
  server: {
    state: () => ipcRenderer.invoke(Ipc.serverState),
    start: (params) => ipcRenderer.invoke(Ipc.serverStart, params),
    stop: () => ipcRenderer.invoke(Ipc.serverStop),
    logs: () => ipcRenderer.invoke(Ipc.serverLogs)
  },
  runtime: {
    status: () => ipcRenderer.invoke(Ipc.runtimeStatus),
    assets: () => ipcRenderer.invoke(Ipc.runtimeAssets),
    download: (variant: string) => ipcRenderer.invoke(Ipc.runtimeDownload, variant),
    cancel: () => ipcRenderer.invoke(Ipc.runtimeCancel)
  },
  chat: {
    send: (req) => ipcRenderer.invoke(Ipc.chatSend, req),
    abort: () => ipcRenderer.invoke(Ipc.chatAbort),
    sessions: () => ipcRenderer.invoke(Ipc.chatSessions),
    createSession: (modelId: string) => ipcRenderer.invoke(Ipc.chatCreateSession, modelId),
    deleteSession: (id: string) => ipcRenderer.invoke(Ipc.chatDeleteSession, id),
    messages: (sessionId: string) => ipcRenderer.invoke(Ipc.chatMessages, sessionId),
    saveMessage: (sessionId: string, message) => ipcRenderer.invoke(Ipc.chatSaveMessage, sessionId, message)
  },
  settings: {
    get: () => ipcRenderer.invoke(Ipc.settingsGet),
    save: (patch) => ipcRenderer.invoke(Ipc.settingsSave, patch)
  },
  system: {
    pickModel: () => ipcRenderer.invoke(Ipc.systemPickModel),
    pickDirectory: () => ipcRenderer.invoke(Ipc.systemPickDirectory),
    pickBinary: () => ipcRenderer.invoke(Ipc.systemPickBinary),
    openPath: (p: string) => ipcRenderer.invoke(Ipc.systemOpenPath, p)
  },
  window: {
    minimize: () => ipcRenderer.invoke(Ipc.windowMinimize),
    maximize: () => ipcRenderer.invoke(Ipc.windowMaximize),
    close: () => ipcRenderer.invoke(Ipc.windowClose)
  },
  on
}

contextBridge.exposeInMainWorld('zhumora', api)

declare global {
  interface Window {
    zhumora: ZhumoraApi
  }
}
