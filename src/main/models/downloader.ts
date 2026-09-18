import { basename, join } from 'path'
import { mkdirSync } from 'fs'
import { downloadFile } from '../download/Downloader'
import { isMmprojPath } from '@shared/hfutil'
import { fileUrl } from './huggingface'
import type {
  ModelDownloadDone,
  ModelDownloadError,
  ModelDownloadProgress,
  Settings
} from '@shared/types'

type ProgressListener = (p: ModelDownloadProgress) => void
type DoneListener = (d: ModelDownloadDone) => void
type ErrorListener = (e: ModelDownloadError) => void

interface Task {
  id: string
  abort: AbortController
}

/**
 * 模型下载：HF resolve URL → models 目录（.part 续传）→ 完成后返回路径。
 * 支持多任务并发（按 repoId::file 去重）。
 */
export class ModelDownloader {
  private tasks = new Map<string, Task>()
  private progressCb: ProgressListener | null = null
  private doneCb: DoneListener | null = null
  private errorCb: ErrorListener | null = null

  constructor(private getSettings: () => Settings) {}

  onProgress(cb: ProgressListener): void {
    this.progressCb = cb
  }
  onDone(cb: DoneListener): void {
    this.doneCb = cb
  }
  onError(cb: ErrorListener): void {
    this.errorCb = cb
  }

  activeCount(): number {
    return this.tasks.size
  }

  async download(repoId: string, file: string): Promise<void> {
    const id = `${repoId}::${file}`
    if (this.tasks.has(id)) throw new Error('该文件正在下载中')
    if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(repoId)) {
      throw new Error('非法的仓库 ID')
    }
    if (!file.toLowerCase().endsWith('.gguf')) {
      throw new Error('只支持下载 .gguf 文件')
    }

    const dir = this.getSettings().modelsDir
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, basename(file))
    const abort = new AbortController()
    this.tasks.set(id, { id, abort })

    try {
      await downloadFile({
        url: fileUrl(repoId, file),
        dest,
        signal: abort.signal,
        onProgress: (p) =>
          this.progressCb?.({ id, repoId, file: basename(file), done: p.done, total: p.total, speed: p.speed })
      })
      this.tasks.delete(id)
      this.doneCb?.({ id, repoId, file: basename(file), path: dest })
    } catch (err) {
      this.tasks.delete(id)
      const msg = (err as Error).message
      if (msg === 'ABORTED') {
        this.errorCb?.({ id, message: '已取消（保留进度，可续传）', cancelled: true })
      } else {
        this.errorCb?.({ id, message: msg })
      }
      if (msg !== 'ABORTED') throw err
    }
  }

  cancel(id: string): void {
    this.tasks.get(id)?.abort.abort()
  }

  /** 下载完成后由 scanner 识别 kind（模型 / mmproj） */
  kindFor(file: string): 'model' | 'mmproj' {
    return isMmprojPath(file) ? 'mmproj' : 'model'
  }
}
