import { openSync, readSync, closeSync, statSync } from 'fs'
import type { ModelInfo, ModelMeta } from '@shared/types'
import { basename } from 'path'

const GGUF_MAGIC = 0x46554747 // "GGUF" little-endian

// value type size（0-7 固定，8=string 变长，9-11 固定）
const FIXED_SIZES = [1, 1, 2, 2, 4, 4, 4, 1]

export interface GgufHeader {
  arch?: string
  name?: string
  blockCount?: number
  nHead?: number
  nHeadKV?: number
  nEmbed?: number
  contextLength?: number
}

/** 各 value type 的固定字节长度（8=string 变长单独处理） */
const TYPE_SIZE: Record<number, number> = {
  0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8
}

/** 读一个值（用于跳过/取值）；string 返回字符串，数值返回 number，未知返回 undefined */
function readValue(
  view: DataView,
  buf: Buffer,
  bytes: number,
  offset: { v: number },
  type: number
): string | number | undefined {
  const at = (size: number): boolean => offset.v + size <= bytes
  switch (type) {
    case 0:
      if (!at(1)) return undefined
      return view.getUint8(offset.v)
    case 1:
      if (!at(1)) return undefined
      return view.getInt8(offset.v)
    case 2:
      if (!at(2)) return undefined
      return view.getUint16(offset.v, true)
    case 3:
      if (!at(2)) return undefined
      return view.getInt16(offset.v, true)
    case 4:
      if (!at(4)) return undefined
      return view.getUint32(offset.v, true)
    case 5:
      if (!at(4)) return undefined
      return view.getInt32(offset.v, true)
    case 6:
      if (!at(4)) return undefined
      return view.getFloat32(offset.v, true)
    case 7:
      if (!at(1)) return undefined
      return view.getUint8(offset.v) === 1
    case 10:
      if (!at(8)) return undefined
      return Number(view.getBigUint64(offset.v, true))
    case 11:
      if (!at(8)) return undefined
      return Number(view.getBigInt64(offset.v, true))
    case 12:
      if (!at(8)) return undefined
      return view.getFloat64(offset.v, true)
    case 8: {
      // string: u64 len + bytes
      if (!at(8)) return undefined
      const len = Number(view.getBigUint64(offset.v, true))
      offset.v += 8
      if (len > 1024 * 1024 || offset.v + len > bytes) return undefined
      const s = buf.toString('utf8', offset.v, offset.v + len)
      offset.v += len
      return s
    }
    case 9: {
      // array: u64 count + u32 elem_type + count 个元素（这里只跳过）
      if (!at(12)) return undefined
      const count = Number(view.getBigUint64(offset.v, true))
      const elemType = view.getUint32(offset.v + 8, true)
      offset.v += 12
      if (count > 100000) return undefined // 异常保护
      const elemSize = TYPE_SIZE[elemType]
      if (elemType !== 8 && elemSize) {
        if (!at(elemSize * count)) return undefined
        offset.v += elemSize * count
      } else if (elemType === 8) {
        for (let i = 0; i < count; i++) {
          if (!at(8)) return undefined
          const len = Number(view.getBigUint64(offset.v, true))
          offset.v += 8
          if (offset.v + len > bytes) return undefined
          offset.v += len
        }
      } else {
        return undefined // 未知元素类型：放弃（无法可靠跳过）
      }
      return undefined
    }
    default:
      return undefined
  }
}

/**
 * 解析 GGUF 文件头，取 general 与架构相关元数据。
 * 只读前 512KB：metadata 区在文件最前面，足够覆盖常见 KV。
 *
 * 收集：arch / name（string）+ block_count / n_head / n_head_kv / n_embd / context_length（数值）。
 * 架构键名因架构而异（llama / qwen2 / gemma ... 前缀），所以先记下 arch，
 * 再按 `${arch}.<field>` 匹配同名字段。
 */
export function parseGgufHeader(filePath: string): GgufHeader {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(512 * 1024)
    const bytes = readSync(fd, buf, 0, buf.length, 0)
    if (bytes < 16 || new DataView(buf.buffer, 0, bytes).getUint32(0, true) !== GGUF_MAGIC) return {}
    const view = new DataView(buf.buffer, 0, bytes)
    const off = { v: 4 }

    const u64 = (): number => {
      const v = Number(view.getBigUint64(off.v, true))
      off.v += 8
      return v
    }
    u64() // tensor_count
    const kvCount = u64()
    if (kvCount > 10000) return {} // 异常保护

    const header: GgufHeader = {}
    for (let i = 0; i < kvCount; i++) {
      if (off.v + 8 > bytes) break
      const keyLen = u64()
      if (keyLen > 1024 || off.v + keyLen > bytes) break
      const key = buf.toString('utf8', off.v, off.v + keyLen)
      off.v += keyLen
      const type = view.getUint32(off.v, true)
      off.v += 4
      const value = readValue(view, buf, bytes, off, type)
      if (value === undefined) continue
      if (typeof value === 'string') {
        if (key === 'general.architecture') header.arch = value
        else if (key === 'general.name') header.name = value
      } else if (typeof value === 'number' && header.arch && key === `${header.arch}.block_count`) {
        header.blockCount = value
      } else if (typeof value === 'number' && header.arch && key === `${header.arch}.n_head`) {
        header.nHead = value
      } else if (typeof value === 'number' && header.arch && key === `${header.arch}.n_head_kv`) {
        header.nHeadKV = value
      } else if (typeof value === 'number' && header.arch && key === `${header.arch}.n_embd`) {
        header.nEmbed = value
      } else if (typeof value === 'number' && header.arch && key === `${header.arch}.context_length`) {
        header.contextLength = value
      }
    }
    return header
  } catch {
    return {}
  } finally {
    closeSync(fd)
  }
}

/** GgufHeader → ModelMeta（ModelInfo.meta 落库用） */
export function toModelMeta(h: GgufHeader): ModelMeta {
  return {
    arch: h.arch,
    name: h.name,
    blockCount: h.blockCount,
    nHead: h.nHead,
    nHeadKV: h.nHeadKV,
    nEmbed: h.nEmbed,
    contextLength: h.contextLength
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
    meta: toModelMeta(header),
    addedAt
  }
}
