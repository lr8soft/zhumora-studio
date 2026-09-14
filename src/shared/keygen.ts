// 随机 API key 生成（纯函数，可单测；main / renderer 共用）

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const KEY_BYTES = 24

/** 生成形如 sk-zs-xxxxxxxxxxxxxxxxxxxxxxxx 的随机 key（128bit 熵，去易混淆字符） */
export function generateApiKey(): string {
  const bytes = new Uint8Array(KEY_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return `sk-zs-${out}`
}

/** 生成一个不与已有 key 冲突的 key */
export function generateApiKeyUnique(exists: (k: string) => boolean): string {
  for (let i = 0; i < 64; i++) {
    const k = generateApiKey()
    if (!exists(k)) return k
  }
  // 理论不可达；兜底加随机后缀
  return `${generateApiKey()}-${Math.random().toString(36).slice(2, 8)}`
}
