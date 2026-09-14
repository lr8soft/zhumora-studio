import { BrowserWindow, app, shell } from 'electron'
import { join } from 'path'
import { SettingsStore } from './settings/store'
import { openDatabase } from './store/db'
import { ModelsRepo } from './store/modelsRepo'
import { ChatRepo } from './store/chatRepo'
import { KeysRepo } from './store/keysRepo'
import { UsageRepo } from './store/usageRepo'
import { RequestLogRepo } from './store/requestLogRepo'
import { ServerManager } from './server/ServerManager'
import { ChatProxy } from './chat/ChatProxy'
import { RuntimeManager } from './runtime/RuntimeManager'
import { ModelDownloader } from './models/downloader'
import { registerIpcHandlers, bootSequence, type AppContext } from './ipc/handlers'

export interface AppServices {
  ctx: AppContext
  createWindow: () => BrowserWindow
  dispose: () => void
}

export function createAppServices(): AppServices {
  let win: BrowserWindow | null = null

  const settings = new SettingsStore(app.getPath('userData'))
  const db = openDatabase()
  const models = new ModelsRepo(db)
  const chat = new ChatRepo(db)
  const keys = new KeysRepo(db)
  const usage = new UsageRepo(db)
  const requestLog = new RequestLogRepo(db)
  const server = new ServerManager(() => settings.get())
  const chatProxy = new ChatProxy(chat, () => server.getState())
  const runtime = new RuntimeManager(join(app.getPath('userData'), 'llama'))
  const modelDownloader = new ModelDownloader(() => settings.get())

  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const ctx: AppContext = { settings, models, chat, keys, usage, requestLog, server, chatProxy, runtime, modelDownloader, send }

  const createWindow = (): BrowserWindow => {
    win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#f5f6f8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    win.on('ready-to-show', () => win?.show())
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'))
    }
    return win
  }

  const dispose = (): void => {
    chatProxy.abort()
    void server.stop()
    db.close()
  }

  registerIpcHandlers(ctx, () => win)
  return { ctx, createWindow, dispose }
}
