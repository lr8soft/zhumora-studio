import { BrowserWindow, Tray, app, shell } from 'electron'
import { join } from 'path'
import { IpcEvent } from '@shared/ipc'
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
import { DownloadHub } from './download/DownloadHub'
import { registerIpcHandlers, bootSequence, type AppContext } from './ipc/handlers'
import { createAppTray } from './tray'

export interface AppServices {
  ctx: AppContext
  createWindow: () => BrowserWindow
  showWindow: () => void
  createTray: () => boolean
  dispose: () => Promise<void>
}

export function createAppServices(isQuitting: () => boolean): AppServices {
  let win: BrowserWindow | null = null
  let tray: Tray | null = null
  let disposed = false

  const settings = new SettingsStore(app.getPath('userData'))
  const db = openDatabase()
  const models = new ModelsRepo(db)
  const chat = new ChatRepo(db)
  const keys = new KeysRepo(db)
  const usage = new UsageRepo(db)
  const requestLog = new RequestLogRepo(db)
  const server = new ServerManager(() => settings.get())
  const chatProxy = new ChatProxy(chat, () => server.getState())
  const downloadHub = new DownloadHub()
  const runtime = new RuntimeManager(join(app.getPath('userData'), 'llama'), downloadHub)
  const modelDownloader = new ModelDownloader(() => settings.get(), downloadHub)

  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // 全局下载队列 → renderer（titlebar 下载面板）
  downloadHub.onItem((item) => send(IpcEvent.downloadItem, item))

  const ctx: AppContext = { settings, models, chat, keys, usage, requestLog, server, chatProxy, runtime, modelDownloader, downloadHub, send }

  const createWindow = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win

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
    win.on('close', (event) => {
      if (isQuitting()) return

      event.preventDefault()
      if (settings.get().closeBehavior === 'quit') {
        app.quit()
        return
      }

      // Linux 某些桌面没有可用托盘；此时退回普通最小化，避免窗口无入口可恢复。
      if (!tray) {
        win?.minimize()
        return
      }

      win?.hide()
      if (process.platform === 'darwin') void app.dock?.hide()
    })
    win.on('closed', () => {
      win = null
    })
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

  const showWindow = (): void => {
    const current = win && !win.isDestroyed() ? win : createWindow()
    if (process.platform === 'darwin') void app.dock?.show()
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
  }

  const createTray = (): boolean => {
    if (tray && !tray.isDestroyed()) return true
    try {
      tray = createAppTray(showWindow)
      return true
    } catch (error) {
      console.error('无法创建系统托盘，将使用普通最小化：', error)
      tray = null
      return false
    }
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    chatProxy.abort()
    runtime.cancel()
    modelDownloader.cancelAll()
    downloadHub.cancelAll()
    try {
      await server.stop()
    } finally {
      tray?.destroy()
      tray = null
      db.close()
    }
  }

  registerIpcHandlers(ctx, () => win)
  return { ctx, createWindow, showWindow, createTray, dispose }
}
