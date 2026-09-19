import { execFile, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, createWriteStream, statSync } from 'fs'
import { join, dirname } from 'path'
import yauzl from 'yauzl'
import { downloadFile, type DownloadOptions } from '../download/Downloader'
import { DownloadHub } from '../download/DownloadHub'
import { fetchPlatformAssets } from './github'
import { pickVariant, probeGpu } from './detect'
import type { RuntimeAsset, RuntimeStatus } from '@shared/types'

type Platform = 'win' | 'linux' | 'macos'

function platformOf(): Platform {
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'
}

function binaryName(): string {
  return platformOf() === 'win' ? 'llama-server.exe' : 'llama-server'
}

interface Manifest {
  version: string
  variant: string
  /** 安装时的本机架构（x64/arm64）；旧 manifest 无此字段，读取时用 process.arch 兜底 */
  arch?: string
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
  private hub: DownloadHub | null = null

  constructor(private baseDir: string, hub?: DownloadHub) {
    this.hub = hub ?? null
  }

  /** 挂全局下载队列（composition 装配时注入） */
  attachHub(hub: DownloadHub): void {
    this.hub = hub
  }

  onStatus(cb: RuntimeListener): void {
    this.listener = cb
  }

  getStatus(): RuntimeStatus {
    return this.status
  }

  private emit(patch: Partial<RuntimeStatus>): void {
    const next: RuntimeStatus = { ...this.status, ...patch }
    next.info = this.infoText(next)
    next.installed = this.listInstalled()
    this.status = next
    this.listener?.(this.status)
  }

  /** 非阻塞提示：有更新 build 但资产未传完时，说明当前列表版本是稍旧的 */
  private infoText(status: RuntimeStatus): string | undefined {
    const skipped = status.skippedNewer
    if (skipped && skipped.length > 0 && status.assets && status.assets.length > 0) {
      return `最新 nightly（${skipped.join('、')}）的构建包还在上传中，当前展示 ${status.assets[0].version}（稍后刷新可获得最新版）`
    }
    return undefined
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
          binaryPath: bin,
          installed: this.listInstalled()
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
    let skippedNewer: string[] = []
    try {
      const r = await fetchPlatformAssets()
      assets = r.assets
      skippedNewer = r.skippedNewer ?? []
    } catch (e) {
      const offline =
        probe.platform === 'linux' && probe.adapters.some((a) => /nvidia/i.test(a))
          ? '本机是 NVIDIA 显卡：官方 Linux 构建不含 CUDA 版，建议在设置中指定你自己编译的 llama-server 路径。'
          : '可离线使用：在设置中手动指定 llama-server 路径。'
      this.emit({
        state: 'error',
        detected: probe,
        error: `获取 GitHub release 失败: ${(e as Error).message}。${offline}`
      })
      return this.status
    }
    const recommended = pickVariant(probe, assets)
    this.emit({ state: 'detected', detected: probe, recommended, assets, skippedNewer, error: undefined })
    return this.status
  }

  /** 下载 + 解压指定变体（或推荐变体）；同变体多架构时只匹配本机架构 */
  async download(variant?: string): Promise<void> {
    if (this.busy) throw new Error('已有下载任务进行中')
    const arch = this.status.detected?.arch ?? (process.arch === 'arm64' ? 'arm64' : 'x64')
    // 若 asset 列表尚未就绪（首启未探测 / 未手动刷新 / 应用重启后），主动拉一次，
    // 否则会出现"点了下载但状态是'没有匹配本机架构的可下载构建，请先刷新'"的卡死路径
    if (!this.status.assets || this.status.assets.length === 0) {
      await this.refreshAssets()
    }
    const pool = (this.status.assets ?? []).filter((a) => a.arch === arch)
    const wanted = variant ?? this.status.recommended
    const asset = pool.find((a) => a.variant === wanted) ?? pool[0]
    if (!asset) throw new Error('没有匹配本机架构的可下载构建，请先刷新')

    this.busy = true
    this.abort = new AbortController()
    // 全局下载队列登记（titlebar 铃铛面板可见/可取消）
    const hubId = `runtime:${asset.version}-${asset.variant}`
    const hubTotal = asset.size + (asset.companion?.size ?? 0)
    this.hub?.add(
      hubId,
      {
        kind: 'runtime',
        name: `llama.cpp ${asset.version} (${asset.variant})`,
        detail: asset.name,
        done: 0,
        total: hubTotal,
        speed: 0,
        status: 'downloading'
      },
      () => this.cancel()
    )
    try {
      const dir = this.installDir(asset.version, asset.variant)
      mkdirSync(dir, { recursive: true })
      const zipPath = join(dir, asset.name)

      this.emit({ state: 'downloading', progress: { done: 0, total: asset.size, speed: 0, phase: 'downloading' } })
      await downloadWithRetry({
        url: asset.url,
        dest: zipPath,
        expectedSha256: asset.sha256,
        signal: this.abort.signal,
        onProgress: (p) => {
          this.emit({ progress: { ...p, phase: 'downloading' } })
          this.hub?.update(hubId, { done: p.done, total: hubTotal, speed: p.speed })
        }
      })

      this.emit({ state: 'extracting', progress: { done: 0, total: 0, speed: 0, phase: 'extracting' } })
      this.hub?.update(hubId, { detail: '解压中…' })
      if (asset.name.endsWith('.zip')) {
        await extractZip(zipPath, dir, (done, total) =>
          this.emit({ progress: { done, total, speed: 0, phase: 'extracting' } })
        )
      } else {
        await extractTarGz(zipPath, dir)
      }
      try {
        unlinkSync(zipPath)
      } catch {
        // ignore
      }

      // CUDA 变体的运行时 dll（cudart/cublas）在独立伴生包，需解到同一目录
      if (asset.companion) {
        this.emit({ state: 'downloading', progress: { done: 0, total: asset.companion.size, speed: 0, phase: 'downloading' } })
        const compPath = join(dir, asset.companion.name)
        await downloadWithRetry({
          url: asset.companion.url,
          dest: compPath,
          expectedSha256: asset.companion.sha256,
          signal: this.abort.signal,
          onProgress: (p) => {
            this.emit({ progress: { ...p, phase: 'downloading' } })
            this.hub?.update(hubId, {
              done: asset.size + p.done,
              total: hubTotal,
              speed: p.speed,
              detail: '下载 CUDA 运行时组件…'
            })
          }
        })
        await extractZip(compPath, dir, () => {})
        try {
          unlinkSync(compPath)
        } catch {
          // ignore
        }
      }

      const binary = findBinary(dir)
      if (!binary) throw new Error(`解压完成但未找到 ${binaryName()}`)

      // 验证二进制可执行（--version 探测；失败 = DLL 缺失/架构不符/损坏）
      this.hub?.update(hubId, { detail: '验证二进制…' })
      await verifyBinary(binary)
      const manifest: Manifest = {
        version: asset.version,
        variant: asset.variant,
        arch,
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
        assets: this.status.assets,
        installed: this.listInstalled()
      }
      this.listener?.(this.status)
      this.hub?.finish(hubId, true)
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'ABORTED') {
        this.emit({ state: 'detected', progress: undefined, error: '下载已取消，可断点续传' })
        this.hub?.finish(hubId, false, '已取消（进度已保留，可续传）')
      } else {
        this.emit({ state: 'error', progress: undefined, error: msg })
        this.hub?.finish(hubId, false, msg)
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
      const r = await fetchPlatformAssets()
      const probe = this.status.detected ?? (await probeGpu())
      this.emit({
        assets: r.assets,
        detected: probe,
        recommended: pickVariant(probe, r.assets),
        skippedNewer: r.skippedNewer ?? [],
        error: undefined
      })
      return r.assets
    } catch (e) {
      // 失败：写入 error 供 UI 展示（state 保持现状，不破坏已就绪的状态机）
      this.emit({ error: `刷新失败: ${(e as Error).message}` })
      throw e
    }
  }

  /**
   * 已安装的 runtime（从磁盘 manifest 读取，多版本共存时全部返回）。
   * 供 UI 判断"某变体已装 → 是否可升级到最新"。arch 由 UI 用本机 arch 过滤。
   */
  listInstalled(): { version: string; variant: string }[] {
    const out: { version: string; variant: string }[] = []
    if (!existsSync(this.baseDir)) return out
    for (const entry of readdirSync(this.baseDir)) {
      const dir = join(this.baseDir, entry)
      const manifestFile = join(dir, 'manifest.json')
      if (!existsSync(manifestFile)) continue
      try {
        const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
        if (m.version && m.variant) {
          out.push({ version: m.version, variant: m.variant })
        }
      } catch {
        // 损坏 manifest 跳过
      }
    }
    return out
  }
}

function relativeSafe(from: string, to: string): string {
  const rel = to.slice(from.length).replace(/^[\\/]/, '')
  return rel.replace(/\\/g, '/')
}

function findBinary(dir: string): string | undefined {
  // llama.cpp release 包内通常是 build/bin/llama-server(.exe) 或根目录
  const name = binaryName()
  const candidates = [join(dir, 'build', 'bin', name), join(dir, 'bin', name), join(dir, name)]
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
      else if (entry.name === name) return p
    }
  }
  return undefined
}

/**
 * 流式解压 zip。
 * yauzl v3 API（Context7 核实）：
 * - 推进条目：zip.readEntry()（不是 v2 的 readNext）
 * - 读文件：zip.openReadStream(entry, (err, stream) => ...)
 * - 读完一个条目（stream end）后再 zip.readEntry() 推进
 */
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
        // 目录 / mac 元数据：跳过（直接推进）
        if (
          name.endsWith('/') ||
          name.includes('__MACOSX') ||
          name.includes('.DS_Store')
        ) {
          zip.readEntry()
          return
        }
        const out = join(destDir, name)
        // zip slip 防护：目标必须在 destDir 内
        if (!out.startsWith(destDir)) {
          zip.readEntry()
          return
        }
        mkdirSync(dirname(out), { recursive: true })
        zip.openReadStream(entry, (rerr, stream) => {
          if (rerr || !stream) {
            reject(rerr ?? new Error('无法读取 zip 条目'))
            return
          }
          const ws = createWriteStream(out)
          stream.on('error', reject)
          ws.on('error', reject)
          stream.pipe(ws)
          stream.on('end', () => {
            ws.close()
            done++
            if (done % 5 === 0 || done === total) onProgress(done, total)
            zip.readEntry()
          })
        })
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

/**
 * 下载，遇到 RESUME_WITH_HASH（续传分块无法校验 hash）删 .part 从头重下一次。
 * 其余错误原样抛出。
 */
async function downloadWithRetry(opts: DownloadOptions): Promise<void> {
  try {
    await downloadFile(opts)
  } catch (err) {
    if ((err as Error).message === 'RESUME_WITH_HASH') {
      try {
        unlinkSync(opts.dest + '.part')
      } catch {
        // ignore
      }
      await downloadFile(opts)
    } else {
      throw err
    }
  }
}

/**
 * 解压 tar.gz（Linux / macOS 发行包）。用系统 tar 命令：
 * 二进制文件的执行位由 tar 自动恢复，无需额外 chmod。
 */
function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    spawn('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'pipe' })
      .on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ENOENT'
            ? new Error('系统缺少 tar 命令，无法解压。请安装 tar 后重试，或在设置中手动指定 llama-server 路径')
            : new Error(`tar 解压失败: ${err.message}`)
        )
      })
      .on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar 解压失败（退出码 ${code}）`))
      })
  })
}

/** 验证二进制可执行（--version 快速探测） */
export function verifyBinary(binaryPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, ['--version'], { timeout: 10000 }, (err) => {
      if (err) reject(new Error(`${binaryName()} --version 执行失败: ${err.message}`))
      else resolve()
    })
  })
}
