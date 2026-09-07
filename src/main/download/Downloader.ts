import { createWriteStream, existsSync, statSync, renameSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'

export interface DownloadProgress {
  done: number
  total: number
  speed: number // bytes/sec
}

export interface DownloadOptions {
  url: string
  dest: string // 最终文件路径
  expectedSha256?: string
  onProgress: (p: DownloadProgress) => void
  signal: AbortSignal
}

const SPEED_WINDOW_MS = 500

/**
 * 通用流式下载：Range 断点续传 + 进度 + sha256 校验 + 取消。
 * 下载写 `<dest>.part`，完成后改名。失败/取消保留 .part 供续传。
 */
export async function downloadFile(opts: DownloadOptions): Promise<void> {
  const part = opts.dest + '.part'
  mkdirSync(dirname(part), { recursive: true })

  let existing = 0
  if (existsSync(part)) {
    existing = statSync(part).size
  }

  const headers: Record<string, string> = {}
  if (existing > 0) headers['Range'] = `bytes=${existing}-`

  let res: Response
  try {
    res = await fetch(opts.url, { headers, signal: opts.signal, redirect: 'follow' })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new Error(`下载请求失败: ${(err as Error).message}`)
  }

  // 200 = 服务器不支持断点（或从头返回）→ 重置；206 = 续传
  if (res.status === 200 && existing > 0) {
    existing = 0
  }
  if (!res.ok && res.status !== 206) {
    throw new Error(`下载失败: HTTP ${res.status}`)
  }

  const total = parseTotal(res, existing)
  const hash = createHash('sha256')
  if (existing > 0) {
    // 续传时已有字节无法补算 hash；若需要校验则从头重下
    if (opts.expectedSha256) {
      unlinkSync(part)
      throw new Error('RESUME_WITH_HASH') // 调用方应重试
    }
  }

  const body = res.body
  if (!body) throw new Error('下载响应无 body')

  const ws = createWriteStream(part, { flags: existing > 0 ? 'a' : 'w' })
  let done = existing
  let lastTick = Date.now()
  let lastDone = existing
  let speed = 0

  try {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      if (opts.signal.aborted) break
      const buf = Buffer.from(chunk)
      hash.update(buf)
      ws.write(buf)
      done += buf.length

      const now = Date.now()
      const dt = now - lastTick
      if (dt >= SPEED_WINDOW_MS) {
        speed = ((done - lastDone) / dt) * 1000
        lastTick = now
        lastDone = done
        opts.onProgress({ done, total, speed })
      }
    }
    ws.end()
    await new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('error', reject)
    })
  } finally {
    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  if (opts.signal.aborted) {
    throw new Error('ABORTED')
  }

  if (opts.expectedSha256) {
    const actual = hash.digest('hex')
    if (actual.toLowerCase() !== opts.expectedSha256.toLowerCase()) {
      throw new Error(`SHA256 校验失败: 期望 ${opts.expectedSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`)
    }
  }

  renameSync(part, opts.dest)
  opts.onProgress({ done: total, total, speed: 0 })
}

function parseTotal(res: Response, existing: number): number {
  const contentLength = Number(res.headers.get('content-length') ?? '0')
  const contentRange = res.headers.get('content-range') // e.g. bytes 100-999/1000
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)\s*$/)
    if (m) return Number(m[1])
  }
  if (res.status === 206) return existing + contentLength
  return contentLength
}
