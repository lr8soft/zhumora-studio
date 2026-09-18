import { Menu, Tray, nativeImage } from 'electron'

// 托盘图标内嵌在主进程 bundle 中，避免开发/打包环境的资源路径差异。
// Windows/Linux 使用紫底白色 Z；macOS 使用透明单色 Template Image。
const COLOR_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhUlEQVR4nO3XsQ2AMAxE0QzKCOzNGNDRgA6d+XGMiKV0kf6Tq6Q1Meuy7cRRjW7REKZ3XCKy4reI7PgF8W/AqPiJeLpAzAQoRP0NuMeJ4wA3jgLcMAqIxl8DIivHAEQ8DCDCYQAZtwDUym0AMd8FUFN7A8OfZBNQ4mNS4muWhZDxXhjVOAAOpsq7USJLXgAAAABJRU5ErkJggg=='
const MAC_TEMPLATE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIElEQVR4nGNgGAXYwH8iMG0NIGTwENQ8MLYOzmgcpAAA/LMs1G1s9JUAAAAASUVORK5CYII='

export function createAppTray(showWindow: () => void): Tray {
  const image = nativeImage.createFromDataURL(
    process.platform === 'darwin' ? MAC_TEMPLATE_ICON : COLOR_ICON
  )
  if (process.platform === 'darwin') image.setTemplateImage(true)

  const tray = new Tray(image)
  tray.setToolTip('Zhumora Studio')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Zhumora Studio', click: showWindow },
      { type: 'separator' },
      { role: 'quit' }
    ])
  )

  // macOS 单击状态栏图标时保留原生菜单行为；Windows/Linux activation 直接恢复窗口。
  if (process.platform !== 'darwin') tray.on('click', showWindow)
  return tray
}
