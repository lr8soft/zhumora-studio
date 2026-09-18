import { app } from 'electron'
import { createAppServices } from './composition'
import { bootSequence } from './ipc/handlers'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let services: ReturnType<typeof createAppServices> | null = null
  let isQuitting = false
  let cleanupFinished = false
  let cleanupPromise: Promise<void> | null = null

  app.on('second-instance', () => {
    services?.showWindow()
  })

  app.whenReady().then(() => {
    services = createAppServices(() => isQuitting)
    bootSequence(services.ctx)
    services.createWindow()
    services.createTray()

    app.on('activate', () => {
      services?.showWindow()
    })
  })

  app.on('before-quit', (e) => {
    isQuitting = true
    if (!services || cleanupFinished) return

    // 第一次 quit 先等待 server 与持久化资源清理；第二次才让 Electron 真正退出。
    e.preventDefault()
    cleanupPromise ??= services
      .dispose()
      .catch((error) => {
        console.error('应用退出清理失败：', error)
      })
      .finally(() => {
        cleanupFinished = true
        app.quit()
      })
  })

  app.on('window-all-closed', () => {
    // 托盘模式下即使没有窗口也保持主进程和 llama-server 运行。
  })
}
