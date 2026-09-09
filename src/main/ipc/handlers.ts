import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from 'fs'
import { join, basename } from 'path'
import { Ipc, IpcEvent } from '@shared/ipc'
import { defaultParams } from '@shared/buildArgs'
import { LAUNCH_PARAMS, EXTRA_ARGS_KEY } from '@shared/launchParams'
import type { ChatMessage, ChatRole, LaunchParams, Settings } from '@shared/types'
import { SettingsStore } from '../settings/store'
import { openDatabase } from '../store/db'
import { ModelsRepo } from '../store/modelsRepo'
import { ChatRepo } from '../store/chatRepo'
import { scanModelsDir } from '../models/scanner'
import { ServerManager } from '../server/ServerManager'
import { ChatProxy } from '../chat/ChatProxy'
import { RuntimeManager } from '../runtime/RuntimeManager'
import { ModelDownloader } from '../models/downloader'
import { searchModels, getModelDetail, getOwnerAvatar } from '../models/huggingface'
import type { HfSort } from '@shared/types'

/** 输入校验：LaunchParams 按 schema 收敛（只保留已知 key + 类型） */
function validateParams(raw: unknown): LaunchParams {
  const base = defaultParams()
  const r = (raw ?? {}) as Record<string, unknown>
  for (const spec of LAUNCH_PARAMS) {
    const v = r[spec.key]
    if (v === undefined) continue
    if (spec.type === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      base[spec.key] = v
    } else if ((spec.type === 'string' || spec.type === 'textarea') && typeof v === 'string') {
      base[spec.key] = v
    } else if (spec.type === 'boolean' && typeof v === 'boolean') {
      base[spec.key] = v
    } else if (spec.type === 'select' && typeof v === 'string' && (spec.options?.some((o) => o.value === v) ?? false)) {
      base[spec.key] = v
    }
  }
  if (typeof r[EXTRA_ARGS_KEY] === 'string') base[EXTRA_ARGS_KEY] = r[EXTRA_ARGS_KEY].slice(0, 2000)
  return base
}

export interface AppContext {
  settings: SettingsStore
  models: ModelsRepo
  chat: ChatRepo
  server: ServerManager
  chatProxy: ChatProxy
  runtime: RuntimeManager
  modelDownloader: ModelDownloader
  send: (channel: string, payload: unknown) => void
}

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  const { settings, models, chat, server, chatProxy, runtime, modelDownloader, send } = ctx

  // 接线事件 → renderer（事件通道用 IpcEvent，不是 invoke 的 Ipc）
  server.onState((s) => send(IpcEvent.serverState, s))
  server.onLog((l) => send(IpcEvent.serverLog, l))
  runtime.onStatus((s) => send(IpcEvent.runtime, s))
  chatProxy.onToken((e) => send(IpcEvent.chatToken, e))
  chatProxy.onEnd((e) => send(IpcEvent.chatEnd, e))
  chatProxy.onError((e) => send(IpcEvent.chatError, e))
  modelDownloader.onProgress((p) => send(IpcEvent.modelProgress, p))
  modelDownloader.onDone((d) => {
    // 落库：扫描器识别 kind（模型 / mmproj）
    scanModelsDir(settings.get().modelsDir, models)
    send(IpcEvent.modelDone, d)
  })
  modelDownloader.onError((e) => send(IpcEvent.modelError, e))

  // ---------- models ----------
  ipcMain.handle(Ipc.modelsList, async () => {
    const dir = settings.get().modelsDir
    scanModelsDir(dir, models)
    return models.list()
  })

  ipcMain.handle(Ipc.modelsImport, async () => {
    const win = getWindow()
    if (!win) return []
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入 GGUF 模型',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    if (canceled) return []
    const dir = settings.get().modelsDir
    mkdirSync(dir, { recursive: true })
    for (const src of filePaths) {
      const dest = join(dir, basename(src))
      if (!existsSync(dest)) {
        try {
          copyFileSync(src, dest)
        } catch {
          // 复制失败跳过（UI 层以扫描结果为准）
        }
      }
    }
    scanModelsDir(dir, models)
    return models.list()
  })

  ipcMain.handle(Ipc.modelsRemove, async (_e, id: string) => {
    const model = models.list().find((m) => m.id === id)
    if (!model) return
    const dir = settings.get().modelsDir
    // 只允许删除 models 目录内的文件
    if (model.path.startsWith(dir) && existsSync(model.path)) {
      try {
        unlinkSync(model.path)
      } catch {
        // 忽略删除失败
      }
    }
    models.remove(id)
  })

  // ---------- huggingface 搜索 / 下载 ----------
  ipcMain.handle(Ipc.modelsSearch, async (_e, query: string, sort?: HfSort) => {
    if (typeof query !== 'string') return []
    const s: HfSort = sort === 'likes' || sort === 'updated' ? sort : 'best'
    return searchModels(query, s)
  })

  ipcMain.handle(Ipc.modelsDetail, async (_e, repoId: string) => {
    if (typeof repoId !== 'string' || !repoId) throw new Error('非法的仓库 ID')
    return getModelDetail(repoId)
  })

  ipcMain.handle(Ipc.modelsAvatar, async (_e, owner: string) => {
    if (typeof owner !== 'string' || !owner || owner.length > 80) return null
    return getOwnerAvatar(owner)
  })

  ipcMain.handle(Ipc.modelsDownload, async (_e, repoId: string, file: string) => {
    await modelDownloader.download(repoId, file)
    return scanModelsDir(settings.get().modelsDir, models)
  })

  ipcMain.handle(Ipc.modelsCancelDownload, async (_e, id: string) => {
    if (typeof id === 'string') modelDownloader.cancel(id)
  })

  // ---------- server ----------
  ipcMain.handle(Ipc.serverState, async () => server.getState())
  ipcMain.handle(Ipc.serverStart, async (_e, rawParams: unknown) => {
    const params = validateParams(rawParams)
    await server.start(params, runtime.getStatus().binaryPath)
    // 启动后注入 API key（若设置了）
    const key = params.apiKey
    chatProxy.setApiKey(typeof key === 'string' && key ? key.split(',')[0].trim() : undefined)
    settings.save({ lastParams: params })
  })
  ipcMain.handle(Ipc.serverStop, async () => server.stop())
  ipcMain.handle(Ipc.serverLogs, async () => server.getLogs())

  // ---------- runtime ----------
  ipcMain.handle(Ipc.runtimeStatus, async () => runtime.getStatus())
  ipcMain.handle(Ipc.runtimeAssets, async () => runtime.refreshAssets())
  ipcMain.handle(Ipc.runtimeDownload, async (_e, variant: string) => runtime.download(variant))
  ipcMain.handle(Ipc.runtimeCancel, async () => runtime.cancel())

  // ---------- chat ----------
  ipcMain.handle(Ipc.chatSessions, async () => chat.sessions())
  ipcMain.handle(Ipc.chatCreateSession, async (_e, modelId: string) => {
    const session = {
      id: randomUUID(),
      title: '新会话',
      modelId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    chat.createSession(session)
    return session
  })
  ipcMain.handle(Ipc.chatDeleteSession, async (_e, id: string) => chat.deleteSession(id))
  ipcMain.handle(Ipc.chatMessages, async (_e, sessionId: string) => chat.messages(sessionId))

  ipcMain.handle(Ipc.chatSend, async (_e, req) => {
    const session = chat.sessions().find((s) => s.id === req.sessionId)
    if (!session) throw new Error('会话不存在')
    // 持久化本条 user 消息
    const last = req.messages[req.messages.length - 1]
    if (last?.role === 'user') {
      const userMsg: ChatMessage = {
        id: randomUUID(),
        role: last.role as ChatRole,
        content: last.content,
        createdAt: Date.now()
      }
      chat.saveMessage(session.id, userMsg)
      if (session.title === '新会话') {
        // 首条消息作为标题
        const title = last.content.slice(0, 30) + (last.content.length > 30 ? '…' : '')
        chat.renameSession(session.id, title)
      }
    }
    chat.touchSession(session.id)
    await chatProxy.send(session, req)
  })
  ipcMain.handle(Ipc.chatAbort, async () => chatProxy.abort())

  // ---------- settings ----------
  ipcMain.handle(Ipc.settingsGet, async () => settings.get())
  ipcMain.handle(Ipc.settingsSave, async (_e, patch: Partial<Settings>) => settings.save(patch))

  // ---------- chat:save-message（renderer 校准用，demo 预留） ----------
  ipcMain.handle(Ipc.chatSaveMessage, async (_e, sessionId: string, message: ChatMessage) => {
    chat.saveMessage(sessionId, message)
  })

  // ---------- system ----------
  ipcMain.handle(Ipc.systemPickModel, async () => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择 GGUF 模型',
      properties: ['openFile'],
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    if (canceled || filePaths.length === 0) return null
    // 选外部文件：复制进 models 目录后返回路径
    const dir = settings.get().modelsDir
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, basename(filePaths[0]))
    if (!existsSync(dest)) copyFileSync(filePaths[0], dest)
    scanModelsDir(dir, models)
    return dest
  })

  ipcMain.handle(Ipc.systemPickDirectory, async () => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择模型目录',
      properties: ['openDirectory']
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  ipcMain.handle(Ipc.systemPickBinary, async () => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择 llama-server 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }, { name: 'All', extensions: ['*'] }]
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  ipcMain.handle(Ipc.systemOpenPath, async (_e, p: string) => {
    if (typeof p === 'string' && p.length > 0) void shell.openPath(p)
  })

  // ---------- window ----------
  ipcMain.handle(Ipc.windowMinimize, () => getWindow()?.minimize())
  ipcMain.handle(Ipc.windowMaximize, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(Ipc.windowClose, () => getWindow()?.close())
}

/** 启动时恢复：runtime 自检 + server 状态（stopped） */
export function bootSequence(ctx: AppContext): void {
  const { settings, server, runtime, chatProxy } = ctx
  void runtime.check()
  // 恢复 API key（上次启动参数里有的话）
  const last = settings.get().lastParams
  const key = last?.apiKey
  chatProxy.setApiKey(typeof key === 'string' && key ? key.split(',')[0].trim() : undefined)
}
