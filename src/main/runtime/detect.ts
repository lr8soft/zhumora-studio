import { execFile } from 'child_process'
import { promisify } from 'util'
import { cpus } from 'os'
import type { GpuProbeResult, RuntimeAsset } from '@shared/types'

const pexecFile = promisify(execFile)

/** GPU 探测：架构 + 视频适配器 + NVIDIA 驱动版本。失败不抛，返回 error。 */
export async function probeGpu(): Promise<GpuProbeResult> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const result: GpuProbeResult = { arch, adapters: [] }
  try {
    const { stdout } = await pexecFile('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
    ])
    result.adapters = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch (err) {
    result.error = (err as Error).message
  }
  if (result.adapters.some((a) => /nvidia/i.test(a))) {
    try {
      const { stdout } = await pexecFile('nvidia-smi', [
        '--query-gpu=driver_version',
        '--format=csv,noheader'
      ])
      result.nvidiaDriver = stdout.split(/\r?\n/)[0]?.trim()
    } catch {
      // nvidia-smi 不可用，驱动未知
    }
  }
  return result
}

function driverMajor(driver?: string): number {
  if (!driver) return 0
  const m = driver.match(/(\d{3})/)
  return m ? Number(m[1]) : 0
}

/**
 * 纯函数：根据探测结果 + 可用 assets 推荐变体。
 * 同族选最高版本（cuda 取最大版本号）。
 */
export function pickVariant(probe: GpuProbeResult, assets: RuntimeAsset[]): string {
  // 先按本机架构过滤；无匹配则不过滤（下载时会再校验）
  let pool = assets.filter((a) => a.arch === probe.arch)
  if (pool.length === 0) pool = assets

  const has = (family: string) => pool.some((a) => a.variant.startsWith(family))
  const best = (family: string): string | undefined => {
    const list = pool
      .filter((a) => a.variant.startsWith(family))
      .sort((a, b) => variantVersion(b.variant) - variantVersion(a.variant))
    return list[0]?.variant
  }

  const driver = driverMajor(probe.nvidiaDriver)
  const isNvidia = probe.adapters.some((a) => /nvidia/i.test(a))
  const isAmd = probe.adapters.some((a) => /amd|radeon/i.test(a))
  const isIntel = probe.adapters.some((a) => /intel|iris|arc/i.test(a))

  if (isNvidia) {
    if (driver >= 580 && has('cuda-13')) return best('cuda-13') ?? 'cuda'
    if (driver >= 528 && has('cuda-12')) return best('cuda-12') ?? 'cuda'
    // 驱动未知/过旧：给 cuda（保守），UI 可手改
    return has('cuda') ? best('cuda') ?? 'cuda' : 'cpu'
  }
  if (isAmd && has('vulkan')) return best('vulkan') ?? 'vulkan'
  if (isIntel && has('vulkan')) return best('vulkan') ?? 'vulkan'
  if (has('cpu')) return 'cpu'
  return pool[0]?.variant ?? 'cpu'
}

function variantVersion(variant: string): number {
  const m = variant.match(/(\d+)\.?(\d+)?/)
  if (!m) return 0
  return Number(m[1]) * 1000 + Number(m[2] ?? 0)
}

export function cpuThreadHint(): number {
  return cpus().length
}
