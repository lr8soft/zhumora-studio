import type { GlobalDownloadItem } from '@shared/types'

type ItemListener = (item: GlobalDownloadItem) => void

interface Managed {
  item: GlobalDownloadItem
  cancel: () => void
}

/**
 * 全局下载队列：llama.cpp 运行时与模型文件统一登记在这里，
 * titlebar 的下载面板（DownloadBell）通过 `downloads:list` + `ev:download-item` 消费。
 *
 * 进度事件由 RuntimeManager / ModelDownloader 调 update 上报；
 * 本类只做"登记 + 转发"，不碰网络（网络仍在各自的 manager 里，保留断点续传语义）。
 */
export class DownloadHub {
  private items = new Map<string, Managed>()
  private finished: GlobalDownloadItem[] = []
  private listeners: ItemListener[] = []

  onItem(cb: ItemListener): void {
    this.listeners.push(cb)
  }

  offItem(cb: ItemListener): void {
    this.listeners = this.listeners.filter((l) => l !== cb)
  }

  /** 全部条目：进行中 + 最近完成的（面板展示用） */
  list(): GlobalDownloadItem[] {
    return [...[...this.items.values()].map((m) => ({ ...m.item })), ...this.finished]
  }

  activeCount(): number {
    return this.items.size
  }

  /** 登记一个新下载；cancel 是取消句柄（对应 AbortController.abort）。同 id 重新登记 = 覆盖（续传/重试） */
  add(id: string, item: Omit<GlobalDownloadItem, 'id'>, cancel: () => void): void {
    const entry: GlobalDownloadItem = { ...item, id }
    this.items.set(id, { item: entry, cancel })
    this.emit(entry)
  }

  /** 更新进度 / 文本 */
  update(id: string, patch: Partial<Omit<GlobalDownloadItem, 'id' | 'status'>>): void {
    const m = this.items.get(id)
    if (!m) return
    m.item = { ...m.item, ...patch }
    this.emit(m.item)
  }

  /** 结束（成功或失败）：从进行中移到完成列表（完成列表有上限，FIFO 淘汰） */
  finish(id: string, ok: boolean, message?: string): void {
    const m = this.items.get(id)
    if (!m) return
    const done: GlobalDownloadItem = { ...m.item, status: ok ? 'done' : 'failed', speed: 0, message }
    this.items.delete(id)
    this.finished.push(done)
    if (this.finished.length > 20) this.finished.shift()
    this.emit(done)
  }

  /** 用户点"清除已完成" */
  clearFinished(): void {
    this.finished = []
  }

  cancel(id: string): void {
    this.items.get(id)?.cancel()
  }

  cancelAll(): void {
    for (const m of this.items.values()) m.cancel()
  }

  private emit(item: GlobalDownloadItem): void {
    for (const l of this.listeners) {
      try {
        l({ ...item })
      } catch {
        // 单个监听器异常不阻塞其他
      }
    }
  }
}
