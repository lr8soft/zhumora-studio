import { openSync, readSync, closeSync, statSync } from 'fs'
import type { ModelInfo } from '@shared/types'
import { basename } from 'path'

const GGUF_MAGIC = 0x46554747 // "GGUF" little-endian

// value type size（0-7 固定，8=string 变长，9-11 固定）
const FIXED_SIZES = [1, 1, 2, 2, 4, 4, 4, 1]

export interface GgufHeader {
  arch?: string
  name?: string
}

/**
 * 解析 GGUF 文件头，取 general.architecture / general.name。
 * 只读前 512KB：metadata 区在文件最前面，足够覆盖常见 KV。
 */
export function parseGgufHeader(filePath: string): GgufHeader {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(512 * 1024)
    const bytes = readSync(fd, buf, 0, buf.length, 0)
    const view = new DataView(buf.buffer, 0, bytes)
    let offset = 0

    const u64 = (): number => {
      const v = Number(view.getBigUint64(offset, true))
      offset += 8
      return v
    }
    const u32 = (): number => {
      const v = view.getUint32(offset, true)
      offset += 4
      return v
    }
    const str = (len: number): string => {
      const s = buf.toString('utf8', offset, offset + len)
      offset += len
      return s
    }

    if (bytes < 16 || view.getUint32(0, true) !== GGUF_MAGIC) return {}
    offset = 4
    u64() // tensor_count
    const kvCount = u64()
    if (kvCount > 10000) return {} // 异常保护

    const header: GgufHeader = {}
    for (let i = 0; i < kvCount; i++) {
      if (offset + 8 > bytes) break
      const key = str(u64())
      const type = u32()
      if (type === 8) {
        // string
        const len = u64()
        if (len > 1024 * 1024 || offset + len > bytes) break
        const value = str(len)
        if (key === 'general.architecture') header.arch = value
        else if (key === 'general.name') header.name = value
        if (header.arch && header.name) break
      } else {
        const size = type < FIXED_SIZES.length ? FIXED_SIZES[type] : 8
        if (offset + size > bytes) break
        offset += size
      }
    }
    return header
  } catch {
    return {}
  } finally {
    closeSync(fd)
  }
}

/** 从文件名猜量化（q4_k_m / iq2_xxs / f16 ...），兜底用 */
export function guessQuantFromName(fileName: string): string | undefined {
  const m = fileName.match(/\b(f16|f32|bf16|q[2-8]_[a-z0-9_]+|iq[2-8]_[a-z0-9_]+)\b/i)
  return m ? m[1].toLowerCase() : undefined
}

export function modelInfoFromPath(filePath: string, id: string, addedAt: number): ModelInfo {
  const name = basename(filePath).replace(/\.gguf$/i, '')
  const lower = name.toLowerCase()
  const kind = lower.startsWith('mmproj') || lower.includes('projector') || lower.includes('clip')
    ? ('mmproj' as const)
    : ('model' as const)
  const header = parseGgufHeader(filePath)
  let size = 0
  try {
    size = statSync(filePath).size
  } catch {
    // 文件被移走：保留记录，size 0
  }
  return {
    id,
    name: header.name || name,
    path: filePath,
    size,
    kind,
    arch: header.arch,
    quant: guessQuantFromName(name),
    addedAt
  }
}
