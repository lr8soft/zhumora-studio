import { app } from 'electron'
import { createAppServices } from './composition'
import { bootSequence } from './ipc/handlers'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let services: ReturnType<typeof createAppServices> | null = null

  app.on('second-instance', () => {
    // demo 版单实例：聚焦主窗口（窗口重建逻辑后续扩展）
  })

  app.whenReady().then(() => {
    services = createAppServices()
    bootSequence(services.ctx)
    services.createWindow()
  })

  app.on('before-quit', (e) => {
    // 优雅停止 server，避免孤儿进程占端口
    if (services && (services.ctx.server.getState().state === 'starting' || services.ctx.server.getState().state === 'ready')) {
      e.preventDefault()
      void services.ctx.server.stop().finally(() => {
        services?.dispose()
        app.quit()
      })
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
