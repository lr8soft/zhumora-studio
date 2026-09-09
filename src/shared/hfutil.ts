// 跨进程纯函数：HF 文件名解析（无 Node / Electron 依赖）

/** 从文件路径推断量化标签（q4_k_m / iq2_xxs / f16 …） */
export function quantFromPath(filePath: string): string | undefined {
  const base = filePath.split('/').pop() ?? ''
  const m = base.match(/\b(f16|f32|bf16|q[2-8]_[a-z0-9_]+|iq[2-8]_[a-z0-9_]+)\b/i)
  return m ? m[1].toLowerCase() : undefined
}

/** 是否为多模态投影文件 */
export function isMmprojPath(filePath: string): boolean {
  const base = (filePath.split('/').pop() ?? '').toLowerCase()
  return base.startsWith('mmproj') || base.includes('projector') || base.includes('clip')
}
