import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import yauzl from 'yauzl'
import { downloadFile } from '../download/Downloader'
import { fetchWinAssets } from './github'
import { pickVariant, probeGpu } from './detect'
import type { RuntimeAsset, RuntimeStatus } from '@shared/types'

const LAMA_BINARY_NAME = 'llama-server.exe'

interface Manifest {
  version: string
  variant: string
  sha256?: string
  binary: string
  installedAt: number
}

type RuntimeListener = (status: RuntimeStatus) => void

/**
 * llama.cpp 运行时获取：check → detect → download → extract → ready。
 * 安装目录：%APPDATA%/zhumora-studio/llama/<version>-<variant>/
 */
export class RuntimeManager {
  private status: RuntimeStatus = { state: 'checking' }
  private listener: RuntimeListener | null = null
  private abort: AbortController | null = null
  private busy = false

  constructor(private baseDir: string) {}

  onStatus(cb: RuntimeListener): void {
    this.listener = cb
  }

  getStatus(): RuntimeStatus {
    return this.status
  }

  private emit(patch: Partial<RuntimeStatus>): void {
    this.status = { ...this.status, ...patch }
    this.listener?.(this.status)
  }

  private installDir(version: string, variant: string): string {
    return join(this.baseDir, `${version}-${variant}`)
  }

  /** 启动自检：已有 manifest + 二进制可运行则直接 ready */
  async check(): Promise<RuntimeStatus> {
    if (!existsSync(this.baseDir)) return this.needDownload()
    // 找最新安装的目录
    let latest: { dir: string; manifest: Manifest } | null = null
    for (const entry of readdirSync(this.baseDir)) {
      const dir = join(this.baseDir, entry)
      const manifestFile = join(dir, 'manifest.json')
      if (!existsSync(manifestFile)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
        if (!latest || manifest.installedAt > latest.manifest.installedAt) {
          latest = { dir, manifest }
        }
      } catch {
        // 损坏 manifest 跳过
      }
    }
    if (latest) {
      const bin = join(latest.dir, latest.manifest.binary)
      if (existsSync(bin)) {
        this.status = {
          state: 'ready',
          version: latest.manifest.version,
          variant: latest.manifest.variant,
          binaryPath: bin
        }
        this.listener?.(this.status)
        return this.status
      }
    }
    return this.needDownload()
  }

  private async needDownload(): Promise<RuntimeStatus> {
    this.emit({ state: 'checking', progress: undefined })
    const probe = await probeGpu()
    let assets: RuntimeAsset[]
    try {
      ;({ assets } = await fetchWinAssets())
    } catch (e) {
      this.emit({
        state: 'error',
        detected: probe,
        error: `获取 GitHub release 失败: ${(e as Error).message}。可离线使用：在设置中手动指定 llama-server 路径。`
      })
      return this.status
    }
    const recommended = pickVariant(probe, assets)
    this.emit({ state: 'detected', detected: probe, recommended, assets })
    return this.status
  }

  /** 下载 + 解压指定变体（或推荐变体） */
  async download(variant?: string): Promise<void> {
    if (this.busy) throw new Error('已有下载任务进行中')
    const asset =
      (this.status.assets ?? []).find((a) => a.variant === (variant ?? this.status.recommended)) ??
      (this.status.assets ?? [])[0]
    if (!asset) throw new Error('没有可下载的构建，请先刷新')

    this.busy = true
    this.abort = new AbortController()
    try {
      const dir = this.installDir(asset.version, asset.variant)
      mkdirSync(dir, { recursive: true })
      const zipPath = join(dir, asset.name)

      this.emit({ state: 'downloading', progress: { done: 0, total: asset.size, speed: 0, phase: 'downloading' } })
      await downloadFile({
        url: asset.url,
        dest: zipPath,
        expectedSha256: asset.sha256,
        signal: this.abort.signal,
        onProgress: (p) => this.emit({ progress: { ...p, phase: 'downloading' } })
      })

      this.emit({ state: 'extracting', progress: { done: 0, total: 0, speed: 0, phase: 'extracting' } })
      await extractZip(zipPath, dir, (done, total) =>
        this.emit({ progress: { done, total, speed: 0, phase: 'extracting' } })
      )
      try {
        unlinkSync(zipPath)
      } catch {
        // ignore
      }

      const binary = findBinary(dir)
      if (!binary) throw new Error('解压完成但未找到 llama-server.exe')
      const manifest: Manifest = {
        version: asset.version,
        variant: asset.variant,
        sha256: asset.sha256,
        binary: relativeSafe(dir, binary),
        installedAt: Date.now()
      }
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      this.status = {
        state: 'ready',
        version: asset.version,
        variant: asset.variant,
        binaryPath: binary,
        detected: this.status.detected,
        recommended: this.status.recommended,
        assets: this.status.assets
      }
      this.listener?.(this.status)
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'ABORTED') {
        this.emit({ state: 'detected', progress: undefined, error: '下载已取消，可断点续传' })
      } else {
        this.emit({ state: 'error', progress: undefined, error: msg })
      }
    } finally {
      this.busy = false
      this.abort = null
    }
  }

  cancel(): void {
    this.abort?.abort()
  }

  /** 刷新 asset 列表（不下载） */
  async refreshAssets(): Promise<RuntimeAsset[]> {
    try {
      const { assets } = await fetchWinAssets()
      const probe = this.status.detected ?? (await probeGpu())
      this.emit({ assets, detected: probe, recommended: pickVariant(probe, assets) })
      return assets
    } catch (e) {
      this.emit({ error: `刷新失败: ${(e as Error).message}` })
      throw e
    }
  }
}

function relativeSafe(from: string, to: string): string {
  const rel = to.slice(from.length).replace(/^[\\/]/, '')
  return rel.replace(/\\/g, '/')
}

function findBinary(dir: string): string | undefined {
  // llama.cpp release zip 内通常是 build/bin/llama-server.exe 或根目录
  const candidates = [
    join(dir, 'build', 'bin', LAMA_BINARY_NAME),
    join(dir, 'bin', LAMA_BINARY_NAME),
    join(dir, LAMA_BINARY_NAME)
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // 兜底：递归找
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, entry.name)
      if (entry.isDirectory()) stack.push(p)
      else if (entry.name === LAMA_BINARY_NAME) return p
    }
  }
  return undefined
}

/** 流式解压 zip（yauzl），只提取 exe/dll/so 等二进制与必要文件 */
function extractZip(
  zipPath: string,
  destDir: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('无法打开 zip'))
      let done = 0
      const total = zip.entryCount
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        if (name.endsWith('/') || name.includes('__MACOSX') || name.includes('.DS_Store')) {
          zip.readNext()
          return
        }
        const out = join(destDir, name)
        // zip slip 防护
        if (!out.startsWith(destDir)) {
          zip.readNext()
          return
        }
        if (entry.type === 'directory') {
          mkdirSync(out, { recursive: true })
          zip.readNext()
          return
        }
        mkdirSync(dirname(out), { recursive: true })
        const ws = createWriteStream(out)
        zip.pipe(ws)
        ws.on('finish', () => {
          done++
          if (done % 5 === 0 || done === total) onProgress(done, total)
          zip.readNext()
        })
        ws.on('error', reject)
      })
      zip.on('end', () => {
        onProgress(total, total)
        resolve()
      })
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** 验证二进制可执行（--version 快速探测） */
export function verifyBinary(binaryPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, ['--version'], { timeout: 10000 }, (err) => {
      if (err) reject(new Error(`llama-server --version 执行失败: ${err.message}`))
      else resolve()
    })
  })
}
