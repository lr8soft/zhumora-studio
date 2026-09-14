import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync } from 'fs'
import { Ipc, IpcEvent } from '@shared/ipc'
import { defaultParams } from '@shared/buildArgs'
import { LAUNCH_PARAMS, EXTRA_ARGS_KEY } from '@shared/launchParams'
import type { ChatMessage, ChatRole, LaunchParams, Settings } from '@shared/types'
import { SettingsStore } from '../settings/store'
import { openDatabase } from '../store/db'
import { ModelsRepo } from '../store/modelsRepo'
import { ChatRepo } from '../store/chatRepo'
import { KeysRepo } from '../store/keysRepo'
import { UsageRepo } from '../store/usageRepo'
import { RequestLogRepo } from '../store/requestLogRepo'
import { scanModelsDir } from '../models/scanner'
import { modelInfoFromPath } from '../models/gguf'
import { ServerManager } from '../server/ServerManager'
import { collectServerStatus } from '../server/status'
import { ChatProxy } from '../chat/ChatProxy'
import { RuntimeManager } from '../runtime/RuntimeManager'
import { ModelDownloader } from '../models/downloader'
import { searchModels, getModelDetail, getOwnerAvatar } from '../models/huggingface'
import { generateApiKeyUnique } from '@shared/keygen'
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
  keys: KeysRepo
  usage: UsageRepo
  requestLog: RequestLogRepo
  server: ServerManager
  chatProxy: ChatProxy
  runtime: RuntimeManager
  modelDownloader: ModelDownloader
  send: (channel: string, payload: unknown) => void
}

/** 密钥表 → 注入 ChatProxy 的 Authorization（启动/增删密钥后调用） */
function syncProxyKey(ctx: AppContext): void {
  const ks = ctx.keys.activeKeys()
  ctx.chatProxy.setApiKey(ks.length > 0 ? ks[0] : undefined)
}

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  const { settings, models, chat, keys, usage, requestLog, server, chatProxy, runtime, modelDownloader, send } = ctx

  // 接线事件 → renderer（事件通道用 IpcEvent，不是 invoke 的 Ipc）
  server.onState((s) => send(IpcEvent.serverState, s))
  server.onLog((l) => send(IpcEvent.serverLog, l))
  // 反向代理捕获的每个外部请求 → 调用记录
  server.onRequestLog((entry) => {
    try {
      requestLog.log(entry)
    } catch {
      // 落库失败不阻断代理
    }
  })
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
    if (canceled || filePaths.length === 0) return []
    // 外部模型不复制：直接用原路径注册（models 目录只放应用自己下载的）
    for (const p of filePaths) {
      models.upsert(modelInfoFromPath(p, randomUUID(), Date.now()))
    }
    scanModelsDir(settings.get().modelsDir, models)
    return models.list()
  })

  ipcMain.handle(Ipc.modelsRemove, async (_e, id: string) => {
    const model = models.list().find((m) => m.id === id)
    if (!model) return
    const dir = settings.get().modelsDir
    // 删除动作不移动/不复制文件：models 目录内的（应用下载的）删文件，
    // 外部导入的（用户自己的）只移除库记录，原文件保持不动
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
  ipcMain.handle(Ipc.serverStatus, async () => {
    return collectServerStatus(server.getState())
  })
  ipcMain.handle(Ipc.serverStart, async (_e, rawParams: unknown) => {
    const params = validateParams(rawParams)
    // 密钥管理页的 key 注入 --api-key（逗号分隔，任一可用）
    const ks = keys.activeKeys()
    if (ks.length > 0) params.apiKey = ks.join(',')
    const rt = runtime.getStatus()
    await server.start(params, rt.binaryPath, { version: rt.version, variant: rt.variant })
    // 启动后注入 API key（ChatProxy 调用本地 server 用）
    syncProxyKey(ctx)
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
  ipcMain.handle(Ipc.settingsSave, async (_e, patch: Partial<Settings>) => {
    const next = settings.save(patch)
    return next
  })

  // ---------- chat:save-message（renderer 校准用，demo 预留） ----------
  ipcMain.handle(Ipc.chatSaveMessage, async (_e, sessionId: string, message: ChatMessage) => {
    chat.saveMessage(sessionId, message)
  })

  // ---------- 密钥管理 ----------
  ipcMain.handle(Ipc.keysList, async () => keys.list())
  ipcMain.handle(Ipc.keysAdd, async (_e, name: unknown, key: unknown) => {
    const n = typeof name === 'string' ? name.trim().slice(0, 60) : ''
    const k = typeof key === 'string' ? key.trim() : ''
    if (k.length < 4) throw new Error('KEY_TOO_SHORT')
    if (keys.list().some((x) => x.key === k)) throw new Error('KEY_EXISTS')
    keys.add(n, k)
    syncProxyKey(ctx)
    return keys.list()
  })
  ipcMain.handle(Ipc.keysRemove, async (_e, id: string) => {
    if (typeof id === 'string') keys.remove(id)
    syncProxyKey(ctx)
    return keys.list()
  })
  ipcMain.handle(Ipc.keysGenerate, async () => {
    return generateApiKeyUnique((k) => keys.list().some((x) => x.key === k))
  })

  // ---------- 用量统计（源 = 反向代理捕获的调用记录，可按 api-key 区分） ----------
  const keyArg = (v: unknown): string | undefined =>
    typeof v === 'string' || v === null ? (v as string | undefined) : undefined
  ipcMain.handle(Ipc.usageSummary, async (_e, key?: unknown) => usage.summary(keyArg(key)))
  ipcMain.handle(Ipc.usageDaily, async (_e, days?: unknown, key?: unknown) => {
    const d = typeof days === 'number' && days >= 1 && days <= 90 ? days : 14
    return usage.daily(d, keyArg(key))
  })
  ipcMain.handle(Ipc.usageByModel, async (_e, key?: unknown) => usage.byModel(keyArg(key)))
  ipcMain.handle(Ipc.usageByKey, async () => usage.byKey())
  ipcMain.handle(Ipc.usageRequests, async (_e, limit?: unknown) => {
    const n = typeof limit === 'number' && limit >= 1 && limit <= 1000 ? Math.floor(limit) : 200
    return requestLog.recent(n)
  })
  ipcMain.handle(Ipc.usageReset, async () => {
    usage.clear()
    // 同步清掉 messages 的 token 列（旧数据源残留）
    chat.clearUsage()
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
    // 外部文件不复制：原路径注册进库 + 扫描 models 目录（下载中的模型）
    const p = filePaths[0]
    models.upsert(modelInfoFromPath(p, randomUUID(), Date.now()))
    scanModelsDir(settings.get().modelsDir, models)
    return p
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
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executable', extensions: ['exe'] }, { name: 'All', extensions: ['*'] }]
          : [{ name: 'All', extensions: ['*'] }]
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

/** 启动时恢复：runtime 自检 + server 状态（stopped）+ 密钥同步到 ChatProxy */
export function bootSequence(ctx: AppContext): void {
  const { settings, server, runtime } = ctx
  void runtime.check()
  // 恢复 API key（密钥管理表为准）
  syncProxyKey(ctx)
}
